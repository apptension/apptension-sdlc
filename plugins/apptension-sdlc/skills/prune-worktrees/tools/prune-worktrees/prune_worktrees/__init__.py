from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Worktree:
    path: Path
    branch: str | None
    locked: bool = False
    prunable: bool = False


def _git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=check,
        capture_output=True,
        text=True,
    )


def _list_worktrees(cwd: Path) -> list[Worktree]:
    stdout = _git(cwd, "worktree", "list", "--porcelain").stdout
    worktrees: list[Worktree] = []
    path: Path | None = None
    branch: str | None = None
    locked = False
    prunable = False
    for line in stdout.splitlines():
        if line.startswith("worktree "):
            if path is not None:
                worktrees.append(
                    Worktree(path=path, branch=branch, locked=locked, prunable=prunable)
                )
            path = Path(line[len("worktree ") :])
            branch = None
            locked = False
            prunable = False
        elif line.startswith("branch "):
            ref = line[len("branch ") :]
            branch = ref.removeprefix("refs/heads/")
        elif line.startswith("locked"):
            locked = True
        elif line.startswith("prunable"):
            prunable = True
        elif line == "":
            if path is not None:
                worktrees.append(
                    Worktree(path=path, branch=branch, locked=locked, prunable=prunable)
                )
                path = None
                branch = None
                locked = False
                prunable = False
    if path is not None:
        worktrees.append(Worktree(path=path, branch=branch, locked=locked, prunable=prunable))
    return worktrees


class GhError(Exception):
    pass


# Ignored directories every checkout rebuilds from its lockfiles. An ignored
# entry inside one of these is no reason to keep a worktree; any other ignored
# file, such as a local `.env`, is.
REBUILDABLE_DIRS = frozenset(
    {"node_modules", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache"}
)


def _status(path: Path) -> str | None:
    # `matching` names the ignored path a pattern matched, such as
    # `tools/x/node_modules/`, where the default collapses it to `tools/`.
    result = _git(path, "status", "--porcelain", "--ignored=matching", check=False)
    if result.returncode != 0:
        return None
    return result.stdout


def _holds_work(status: str) -> bool:
    for line in status.splitlines():
        if not line.strip():
            continue
        if line.startswith("!! ") and REBUILDABLE_DIRS.intersection(line[3:].split("/")):
            continue
        return True
    return False


def _current_worktree(cwd: Path, worktrees: list[Worktree]) -> Path | None:
    resolved = cwd.resolve()
    for wt in worktrees:
        root = wt.path.resolve()
        if resolved == root or root in resolved.parents:
            return root
    return None


def gh_pr_status(branch: str, *, cwd: Path) -> str | None:
    result = subprocess.run(
        [
            "gh",
            "pr",
            "list",
            "--head",
            branch,
            "--state",
            "all",
            "--json",
            "state,createdAt,headRefOid",
        ],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise GhError(result.stderr.strip() or "gh pr list failed")
    try:
        items = json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        return None
    if not isinstance(items, list):
        return None
    records = [item for item in items if isinstance(item, dict)]
    if not records:
        return None
    if any(item.get("state") == "OPEN" for item in records):
        return "OPEN"
    records.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
    newest = records[0]
    state = newest.get("state")
    if state == "CLOSED":
        return "CLOSED"
    if state != "MERGED":
        return None
    pr_head = newest.get("headRefOid")
    if not isinstance(pr_head, str) or not pr_head:
        return None
    local = _git(cwd, "rev-parse", f"refs/heads/{branch}", check=False)
    if local.returncode != 0 or local.stdout.strip() != pr_head:
        return None
    return "MERGED"


def prune_merged_worktrees(*, cwd: Path, pr_status: Callable[[str], str | None]) -> None:
    cwd = cwd.resolve()
    worktrees = _list_worktrees(cwd)
    if not worktrees:
        return
    main = worktrees[0].path.resolve()
    current = _current_worktree(cwd, worktrees)
    for wt in worktrees:
        path = wt.path.resolve()
        if path == main:
            continue
        if current is not None and path == current:
            continue
        if not path.exists() or wt.locked or wt.prunable:
            continue
        if wt.branch is None or pr_status(wt.branch) != "MERGED":
            continue
        status = _status(path)
        if status is None or _holds_work(status):
            continue
        _git(main, "worktree", "remove", str(path), check=False)
    _git(main, "worktree", "prune")


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    cwd = Path(args[0]).resolve() if args else Path.cwd()
    try:
        prune_merged_worktrees(cwd=cwd, pr_status=lambda branch: gh_pr_status(branch, cwd=cwd))
    except GhError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0
