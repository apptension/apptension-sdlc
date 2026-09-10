"""Render and install the trusted verification-maintenance bundle."""

from __future__ import annotations

import difflib
import json
import re
import subprocess
from pathlib import Path
from typing import Any

INSTALL_ROOT = Path(".github/verification-maintenance")
WORKFLOW_TARGET = Path(".github/workflows/verification-maintenance.yml")
INSTRUCTION_TARGET = INSTALL_ROOT / "instructions/maintain-verification-skill"
RESERVED_ENV = {
    "ANTHROPIC_API_KEY",
    "BASH_ENV",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "LD_PRELOAD",
    "NODE_OPTIONS",
    "OPENAI_API_KEY",
}
REQUIRED_CONFIG = {
    "target",
    "integration_branch",
    "repository",
    "provider",
    "schedule",
    "bootstrap",
}


def _plain_line(value: Any, field: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value):
        raise ValueError(f"{field} must be a nonempty string")
    if "\n" in value or "\r" in value or "\0" in value:
        raise ValueError(f"{field} must fit on one line")
    return value


def _cron_number(value: str, low: int, high: int, aliases: dict[str, int]) -> int:
    if value.upper() in aliases:
        return aliases[value.upper()]
    if not re.fullmatch(r"[0-9]{1,2}", value) or not low <= int(value) <= high:
        raise ValueError(f"schedule has an invalid field value: {value}")
    return int(value)


def _validate_schedule(schedule: str) -> None:
    fields = schedule.split()
    if len(fields) != 5:
        raise ValueError("schedule must be a five-field cron expression")
    # GitHub Actions supports numeric fields, names, lists, ranges and steps.
    bounds = [(0, 59, ""), (0, 23, ""), (1, 31, ""),
              (1, 12, "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC"),
              (0, 6, "SUN MON TUE WED THU FRI SAT")]
    for field, (low, high, names) in zip(fields, bounds, strict=True):
        aliases = {name: low + index for index, name in enumerate(names.split())}

        for item in field.split(","):
            base, separator, step = item.partition("/")
            if separator and (not re.fullmatch(r"[0-9]+", step) or int(step) < 1):
                raise ValueError(f"schedule has an invalid step: {item}")
            if base == "*":
                continue
            start, separator, end = base.partition("-")
            first = _cron_number(start, low, high, aliases)
            if separator and first > _cron_number(end, low, high, aliases):
                raise ValueError(f"schedule has a reversed range: {base}")


def _validate_config(config: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise TypeError("config must be an object")
    missing = REQUIRED_CONFIG - config.keys()
    if missing:
        raise ValueError(f"config is missing: {', '.join(sorted(missing))}")

    normalized = dict(config)
    provider = _plain_line(normalized["provider"], "provider")
    if provider not in {"claude", "codex"}:
        raise ValueError("provider must be claude or codex")

    target_text = _plain_line(normalized["target"], "target")
    target = Path(target_text)
    if (target.is_absolute() or target.name != "SKILL.md" or len(target.parts) < 2
            or any(part in {"", ".", "..", ".git"} for part in target.parts)
            or "\\" in target_text or ":" in target_text or any(ord(character) < 32 for character in target_text)):
        raise ValueError("target must name one repository-local project skill")
    if target.parts[0] in {".verification-output", ".verification-evidence", ".verification-report.json"}:
        raise ValueError("target cannot use a reserved maintenance output root")
    target_directory = target.parent
    for protected in (INSTALL_ROOT, WORKFLOW_TARGET.parent):
        if (target_directory == protected or target_directory in protected.parents
                or protected in target_directory.parents):
            raise ValueError("target scope overlaps the installed workflow or trusted runtime")
    normalized["target"] = target.as_posix()

    branch = _plain_line(normalized["integration_branch"], "integration_branch")
    if branch.startswith(("-", ".")) or branch.endswith((".", "/", ".lock")):
        raise ValueError("integration_branch is not a safe Git ref")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", branch) or any(
        token in branch for token in ("..", "//", "@{")
    ):
        raise ValueError("integration_branch is not a safe Git ref")

    try:
        ref_check = subprocess.run(
            ["git", "check-ref-format", f"refs/heads/{branch}"],
            capture_output=True, check=False,
        )
    except OSError as error:
        raise ValueError("integration_branch validation requires Git") from error
    if ref_check.returncode:
        raise ValueError("integration_branch is not a safe Git ref")

    repository = _plain_line(normalized["repository"], "repository")
    if (not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)
            or any(part in {".", ".."} for part in repository.split("/"))):
        raise ValueError("repository must have owner/name form")

    schedule = _plain_line(normalized["schedule"], "schedule")
    _validate_schedule(schedule)

    bootstrap = normalized["bootstrap"]
    if not isinstance(bootstrap, list) or not all(isinstance(item, str) for item in bootstrap):
        raise ValueError("bootstrap must be a list of shell commands")
    normalized["bootstrap"] = [
        _plain_line(command, f"bootstrap[{index}]")
        for index, command in enumerate(bootstrap)
    ]

    model = _plain_line(normalized.get("model", ""), "model", allow_empty=True)
    if model and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*", model):
        raise ValueError("model must be a model identifier without shell whitespace")
    normalized["model"] = model

    app_secrets = normalized.get("app_secrets", {})
    if not isinstance(app_secrets, dict):
        raise TypeError("app_secrets must map environment names to GitHub secret names")
    for environment, secret in app_secrets.items():
        if not isinstance(environment, str) or not re.fullmatch(r"[A-Z_][A-Z0-9_]*", environment):
            raise ValueError("app_secrets environment names must be uppercase shell identifiers")
        if environment in RESERVED_ENV or environment.startswith(("ACTIONS_", "GITHUB_", "RUNNER_")):
            raise ValueError(f"app_secrets cannot override reserved environment name {environment}")
        if not isinstance(secret, str) or not re.fullmatch(r"[A-Z_][A-Z0-9_]*", secret):
            raise ValueError("app_secrets values must be GitHub secret names")
        if secret in {"ANTHROPIC_API_KEY", "GITHUB_TOKEN", "OPENAI_API_KEY"}:
            raise ValueError("provider and GitHub credentials cannot be exposed as app secrets")
    normalized["app_secrets"] = dict(sorted(app_secrets.items()))
    normalized["provider"] = provider
    normalized["integration_branch"] = branch
    normalized["repository"] = repository
    normalized["schedule"] = schedule
    return normalized


def _maintenance_source(templates: Path, maintenance_skill: Path | None) -> Path:
    source = Path(maintenance_skill) if maintenance_skill else (
        templates.parent.parent / "maintain-verification-skill"
    )
    if source.is_file() and source.name == "SKILL.md":
        source = source.parent
    if not (source / "SKILL.md").is_file() or not (source / "LICENSE").is_file():
        raise ValueError(
            "maintenance skill source must contain SKILL.md and LICENSE; "
            "an isolated setup skill must pass --maintenance-skill from the installed plugin"
        )
    return source


def _render(config: dict[str, Any], templates: Path, maintenance_skill: Path | None) -> dict[Path, bytes]:
    templates = Path(templates)
    workflow = templates / "verification-maintenance.yml"
    prompt = templates / "prompt.md"
    if not workflow.is_file() or not prompt.is_file():
        raise ValueError("templates must contain verification-maintenance.yml and prompt.md")
    skill = _maintenance_source(templates, maintenance_skill)

    if config["app_secrets"]:
        secret_env = "        env:\n" + "".join(
            f"          {environment}: ${{{{ secrets.{secret} }}}}\n"
            for environment, secret in config["app_secrets"].items()
        )
    else:
        secret_env = "        env: {}\n"
    workflow_text = workflow.read_text().replace(
        "%%SCHEDULE%%", json.dumps(config["schedule"])
    ).replace(
        "%%INTEGRATION_BRANCH%%", json.dumps(config["integration_branch"])
    ).replace(
        "%%APP_SECRET_ENV%%", secret_env.rstrip("\n")
    )
    if "%%" in workflow_text:
        raise ValueError("workflow contains an unresolved template token")

    rendered: dict[Path, bytes] = {
        WORKFLOW_TARGET: workflow_text.encode(),
        INSTALL_ROOT / "prompt.md": prompt.read_bytes(),
        INSTALL_ROOT / "config.json": (
            json.dumps(config, indent=2, sort_keys=True) + "\n"
        ).encode(),
        INSTRUCTION_TARGET / "SKILL.md": (skill / "SKILL.md").read_bytes(),
        INSTRUCTION_TARGET / "LICENSE": (skill / "LICENSE").read_bytes(),
    }
    for source in sorted(Path(__file__).parent.glob("*.py")):
        rendered[INSTALL_ROOT / source.name] = source.read_bytes()
    return rendered


def _check_destination(root: Path, relative: Path) -> Path:
    destination = root / relative
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"install destination contains a symlink: {current}")
        if current != destination and current.exists() and not current.is_dir():
            raise ValueError(f"install parent must be a directory: {current}")
    return destination


def _preview(path: str, previous: bytes | None, content: bytes) -> dict[str, str]:
    before = previous.decode(errors="replace") if previous is not None else ""
    after = content.decode(errors="replace")
    diff = "".join(difflib.unified_diff(
        before.splitlines(keepends=True),
        after.splitlines(keepends=True),
        fromfile=f"a/{path}" if previous is not None else "/dev/null",
        tofile=f"b/{path}",
    ))
    return {"path": path, "content": after, "diff": diff}


def install(
    root: Path,
    config: dict[str, Any],
    templates: Path,
    write: bool = False,
    replace: bool = False,
    maintenance_skill: Path | None = None,
) -> dict[str, Any]:
    """Preview or install the bundle, refusing partial conflict writes."""
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("root must be an existing repository directory, not a symlink")
    normalized = _validate_config(config)
    configured_target = root / normalized["target"]
    current = root
    for part in Path(normalized["target"]).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"configured target contains a symlink: {current}")
    if configured_target.exists() and not configured_target.resolve().is_relative_to(root.resolve()):
        raise ValueError("configured target leaves the repository")
    rendered = _render(normalized, Path(templates), maintenance_skill)

    files: list[dict[str, str]] = []
    conflicts: list[str] = []
    destinations: list[tuple[Path, bytes]] = []
    for relative, content in sorted(rendered.items(), key=lambda item: item[0].as_posix()):
        destination = _check_destination(root, relative)
        previous = destination.read_bytes() if destination.exists() else None
        if previous == content:
            continue
        path = relative.as_posix()
        files.append(_preview(path, previous, content))
        destinations.append((destination, content))
        if previous is not None:
            conflicts.append(path)

    result: dict[str, Any] = {
        "changed": [item["path"] for item in files],
        "files": files,
        "conflicts": conflicts,
    }
    if not write:
        return result
    if conflicts and not replace:
        raise ValueError("install conflict in: " + ", ".join(conflicts))

    for destination, content in destinations:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    return result
