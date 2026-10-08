"""Validate verification maintenance output and publish it through GitHub's REST API."""

from __future__ import annotations

import hashlib
import os
import posixpath
import re
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote, unquote, urlencode, urlsplit

from discovery import has_section

MAX_FILES = 500
MAX_COVERAGE = 500
MAX_EVIDENCE_PER_FEATURE = 100
MAX_FILE_BYTES = 1_000_000
MAX_TOTAL_BYTES = 5_000_000
MAX_SUMMARY_BYTES = 20_000
MAX_TEXT_BYTES = 4_000
SHA = re.compile(r"^[0-9a-f]{40}$")
FRONTMATTER_FIELD = r"(?m)^{}:\s*(\S(?:.*\S)?)\s*$"


class PublisherError(ValueError):
    """The untrusted bundle or trusted publication context is invalid."""


def branch_name(target: str) -> str:
    """Return the stable maintenance branch assigned to one target skill."""
    normalized = _normal_path(target, "target")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return f"verification-maintenance/{digest}"


def _fail(message: str) -> None:
    raise PublisherError(message)


def _text(value: Any, label: str, *, limit: int = MAX_TEXT_BYTES) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{label} must be a nonempty string")
    if len(value.encode("utf-8")) > limit:
        _fail(f"{label} exceeds the size limit")
    if "\x00" in value:
        _fail(f"{label} contains a null byte")
    return value


def _normal_path(value: Any, label: str) -> str:
    value = _text(value, label, limit=1_024)
    if "\\" in value or ":" in value or any(ord(char) < 32 for char in value):
        _fail(f"{label} is not a normal repository path")
    path = PurePosixPath(value)
    if path.is_absolute() or value != path.as_posix():
        _fail(f"{label} is not a normal repository path")
    if any(part in {"", ".", ".."} or part.lower() == ".git" for part in path.parts):
        _fail(f"{label} contains a forbidden path segment")
    return value


def _git(
    root: Path, *args: str, text: bool = True,
    input: str | None = None, env: dict[str, str] | None = None,
) -> str | bytes:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            capture_output=True,
            text=text,
            input=input,
            env=env,
        )
    except (OSError, subprocess.CalledProcessError):
        _fail(f"git repository validation failed: {' '.join(args)}")
    return result.stdout


def _tree(root: Path, revision: str) -> dict[str, dict[str, str]]:
    raw = _git(root, "ls-tree", "-r", "-z", revision, text=False)
    try:
        records = raw.decode("utf-8").split("\0")
    except UnicodeDecodeError:
        _fail("the base tree contains a path that is not UTF-8")
    result = {}
    for record in records:
        if not record:
            continue
        metadata, separator, path = record.partition("\t")
        parts = metadata.split(" ")
        if not separator or len(parts) != 3:
            _fail("git returned a malformed base tree")
        mode, kind, sha = parts
        result[path] = {"mode": mode, "type": kind, "sha": sha}
    return result


def _blob(root: Path, sha: str, label: str) -> str:
    size_raw = _git(root, "cat-file", "-s", sha)
    try:
        size = int(size_raw.strip())
    except ValueError:
        _fail(f"git returned an invalid size for {label}")
    if size > MAX_FILE_BYTES:
        _fail(f"{label} exceeds the size limit")
    raw = _git(root, "cat-file", "blob", sha, text=False)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        _fail(f"{label} is not UTF-8 text")


def _check_filesystem_symlinks(root: Path, path: str, label: str) -> None:
    current = root
    if current.is_symlink():
        _fail(f"{label} crosses a symlink")
    for part in PurePosixPath(path).parts:
        current = current / part
        if current.is_symlink():
            _fail(f"{label} crosses a symlink at {current.relative_to(root)}")


def _check_tree_symlinks(
    tree: dict[str, dict[str, str]], path: str, label: str
) -> None:
    parts = PurePosixPath(path).parts
    for length in range(1, len(parts) + 1):
        candidate = "/".join(parts[:length])
        if tree.get(candidate, {}).get("mode") == "120000":
            _fail(f"{label} crosses an existing symlink at {candidate}")


def _frontmatter(content: str, label: str) -> None:
    content = content.replace("\r\n", "\n")
    if not content.startswith("---\n"):
        _fail(f"{label} has invalid frontmatter")
    end = content.find("\n---", 4)
    if end < 0 or content[end + 4 : end + 5] not in {"", "\n", "\r"}:
        _fail(f"{label} has invalid frontmatter")
    metadata = content[4:end]
    for field in ("name", "description"):
        match = re.search(FRONTMATTER_FIELD.format(field), metadata)
        if match is None or match.group(1) in {"null", "~", "''", '""'}:
            _fail(f"{label} frontmatter needs a nonempty {field}")


def _repository(config: dict[str, Any]) -> tuple[str, str]:
    repository = _text(config.get("repository"), "config.repository", limit=256)
    parts = repository.split("/")
    if len(parts) != 2 or not all(
        part not in {".", ".."} and re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts
    ):
        _fail("config.repository must have the form owner/repo")
    return parts[0], parts[1]


def _config(root: Path, config: Any) -> dict[str, str]:
    if not isinstance(config, dict):
        _fail("config must be an object")
    target = _normal_path(config.get("target"), "config.target")
    target_path = PurePosixPath(target)
    if target_path.name != "SKILL.md" or target_path.parent == PurePosixPath("."):
        _fail("config.target must name a project skill SKILL.md")
    if target_path.parts[0] in {".verification-output", ".verification-evidence", ".verification-report.json"}:
        _fail("config.target cannot use a reserved output root")
    target_dir = target_path.parent
    for protected in (
        PurePosixPath(".github/verification-maintenance"),
        PurePosixPath(".github/workflows"),
    ):
        if (
            target_dir == protected
            or target_dir in protected.parents
            or protected in target_dir.parents
        ):
            _fail("config.target scope overlaps protected publisher files")
    branch = _text(
        config.get("integration_branch"), "config.integration_branch", limit=255
    )
    if (
        branch.startswith("/")
        or branch.endswith("/")
        or ".." in branch
        or "@{" in branch
        or "\\" in branch
        or any(char.isspace() or ord(char) < 32 for char in branch)
    ):
        _fail("config.integration_branch is not a valid branch name")
    check = subprocess.run(
        ["git", "-C", str(root), "check-ref-format", "--branch", branch],
        check=False,
        capture_output=True,
    )
    if check.returncode:
        _fail("config.integration_branch is not a valid branch name")
    owner, repo = _repository(config)
    evidence_url = config.get("evidence_url")
    if evidence_url is not None:
        evidence_url = _text(evidence_url, "config.evidence_url", limit=2_048)
        parsed = urlsplit(evidence_url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username
        ):
            _fail("config.evidence_url must be an HTTP URL without credentials")
    return {
        "target": target,
        "branch": branch,
        "owner": owner,
        "repo": repo,
        "evidence_url": evidence_url,
    }


def _coverage(
    root: Path,
    items: Any,
    expected: set[str],
    *,
    require_complete: bool,
    require_evidence: bool,
) -> list[dict[str, Any]]:
    if not isinstance(items, list) or len(items) > MAX_COVERAGE:
        _fail("coverage must be a bounded list")
    base_evidence = set(_git(
        root, "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ".verification-evidence/"
    ).split("\0")) if require_evidence else set()
    seen = set()
    validated = []
    for index, item in enumerate(items):
        label = f"coverage[{index}]"
        if not isinstance(item, dict):
            _fail(f"{label} must be an object")
        live = item.get("live")
        allowed = {"feature", "source", "live", "evidence"}
        if live == "verified-unreachable":
            allowed |= {"prerequisite", "attempted_route"}
        if set(item) - allowed:
            _fail(f"{label} contains unsupported fields")
        feature = _normal_path(item.get("feature"), f"{label}.feature")
        if feature in seen:
            _fail(f"coverage repeats {feature}")
        seen.add(feature)
        source = _text(item.get("source"), f"{label}.source")
        if live not in {"verified", "verified-unreachable"}:
            _fail(f"{label}.live must be verified or verified-unreachable")
        evidence = item.get("evidence")
        if (
            not isinstance(evidence, list)
            or len(evidence) > MAX_EVIDENCE_PER_FEATURE
            or (require_evidence and not evidence)
        ):
            _fail(
                f"{label}.evidence must be a bounded list with proof when publishable"
            )
        normalized_evidence = []
        for evidence_index, value in enumerate(evidence):
            evidence_path = _normal_path(value, f"{label}.evidence[{evidence_index}]")
            if not evidence_path.startswith(".verification-evidence/"):
                _fail(f"{label}.evidence must stay under .verification-evidence")
            if require_evidence:
                if evidence_path in base_evidence:
                    _fail(f"{label}.evidence cannot reuse a file tracked in the base revision")
                _check_filesystem_symlinks(root, evidence_path, f"{label}.evidence")
                evidence_file = root / evidence_path
                if not evidence_file.is_file() or evidence_file.stat().st_size == 0:
                    _fail(
                        f"{label}.evidence must name a regular nonempty evidence file"
                    )
            normalized_evidence.append(evidence_path)
        normalized = {
            "feature": feature,
            "source": source,
            "live": live,
            "evidence": normalized_evidence,
        }
        if live == "verified-unreachable":
            normalized["prerequisite"] = _text(
                item.get("prerequisite"), f"{label}.prerequisite"
            )
            normalized["attempted_route"] = _text(
                item.get("attempted_route"), f"{label}.attempted_route"
            )
        validated.append(normalized)
    extra = sorted(seen - expected)
    if extra:
        _fail(f"coverage names unknown feature files: {', '.join(extra)}")
    if require_complete:
        missing = sorted(expected - seen)
        if missing:
            _fail(f"coverage is missing feature files: {', '.join(missing)}")
    return validated


def _link_destination(value: str) -> str | None:
    match = re.fullmatch(
        r"(<[^>\n]+>|[^\s]+)(?:[ \t]+(?:\"[^\"\n]*\"|'[^'\n]*'|\([^\n]*\)))?[ \t]*",
        value.strip(),
    )
    if not match:
        return None
    target = match[1]
    if not target.startswith("<"):
        depth, escaped = 0, False
        for char in target:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth < 0:
                    return None
        if depth:
            return None
    return re.sub(r"\\([\\()])", r"\1", target)


def _inline_link_destinations(body: str) -> list[str]:
    links = []
    for match in re.finditer(r"(?<!!)\[[^]\n]*\]\(", body):
        start = match.end()
        depth, escaped, angle, quoted = 1, False, False, None
        for end in range(start, len(body)):
            char = body[end]
            if escaped:
                escaped = False
                continue
            if char == "\\":
                escaped = True
                continue
            if quoted:
                if char == quoted:
                    quoted = None
                continue
            if angle:
                if char == ">":
                    angle = False
                continue
            if char == "<" and not body[start:end].strip():
                angle = True
            elif char in "\"'" and (end == start or body[end - 1].isspace()):
                quoted = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    break
        else:
            continue
        if target := _link_destination(body[start:end]):
            links.append(target)
    return links


def _validate_feature_index(content: str, index: str, features: set[str], paths: set[str]) -> None:
    # Ignore examples in code blocks and inline code when reading the actual map.
    content = re.sub(r"(?ms)^ *(`{3,}|~{3,})[^\n]*\n.*?^ *\1[^\n]*$", "", content)
    content = re.sub(r"(?s)<!--.*?-->", "", content)
    content = re.sub(r"(?m)^(?: {4}|\t)(?![ \t]*(?:[-+*]|[0-9]+[.)])[ \t])[^\n]*$", "", content)
    content = re.sub(r"`[^`\n]*`", "", content)
    definitions = {}
    for label, value in re.findall(r"(?m)^ {0,3}\[([^]\n]+)\]:[ \t]*([^\n]*)$", content):
        if target := _link_destination(value):
            definitions[" ".join(label.lower().split())] = target
    body = re.sub(r"(?m)^ {0,3}\[[^]\n]+\]:[^\n]*$", "", content)
    links = _inline_link_destinations(body)
    for label, reference in re.findall(r"(?<!!)\[([^]\n]+)\]\[([^]\n]*)\]", body):
        key = " ".join((reference or label).lower().split())
        if key not in definitions:
            _fail(f"feature index has an undefined reference: {reference or label}")
        links.append(definitions[key])
    for label in re.findall(r"(?<!!)\[([^]\n]+)\](?!\[|\()", body):
        key = " ".join(label.lower().split())
        if key in definitions:
            links.append(definitions[key])
    mapped = set()
    for link in links:
        url = urlsplit(link.strip("<>"))
        if url.scheme or url.netloc or not url.path:
            continue
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(index), unquote(url.path)))
        if resolved not in paths:
            _fail(f"feature index has a missing link target: {link}")
        if resolved in features:
            mapped.add(resolved)
    if missing := features - mapped:
        _fail("feature index must link every feature: " + ", ".join(sorted(missing)))


def validate_bundle(
    root: Path, bundle: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    """Validate an untrusted result against the committed base and return normalized data."""
    root = Path(root)
    if not root.is_dir():
        _fail("root must be a Git repository directory")
    settings = _config(root, config)
    if not isinstance(bundle, dict):
        _fail("bundle must be an object")
    required = {"base_sha", "target", "outcome", "summary", "coverage", "files"}
    if set(bundle) != required:
        _fail(
            "bundle fields must be base_sha, target, outcome, summary, coverage and files"
        )
    base_sha = bundle.get("base_sha")
    if not isinstance(base_sha, str) or SHA.fullmatch(base_sha) is None:
        _fail("base_sha must be a 40-character lowercase commit SHA")
    head = _git(root, "rev-parse", "HEAD").strip()
    if head != base_sha:
        _fail("base_sha does not match the trusted checkout HEAD")
    target = _normal_path(bundle.get("target"), "target")
    if target != settings["target"]:
        _fail("target does not match config.target")
    outcome = bundle.get("outcome")
    if outcome not in {"clean", "blocked", "changed"}:
        _fail("outcome must be clean, blocked or changed")
    summary = _text(bundle.get("summary"), "summary", limit=MAX_SUMMARY_BYTES)
    tree = _tree(root, base_sha)
    target_entry = tree.get(target)
    if target_entry is None or target_entry["type"] != "blob":
        _fail("target SKILL.md must exist in the base revision")
    if target_entry["mode"] not in {"100644", "100755"}:
        _fail("target SKILL.md cannot be a symlink")
    _check_tree_symlinks(tree, target, "target")
    _check_filesystem_symlinks(root, target, "target")
    base_target = _blob(root, target_entry["sha"], "target SKILL.md")
    _frontmatter(base_target, "target SKILL.md")

    files = bundle.get("files")
    if not isinstance(files, list) or len(files) > MAX_FILES:
        _fail("files must be a bounded list")
    target_dir = PurePosixPath(target).parent
    base_directories = {
        parent.as_posix()
        for path in tree
        for parent in PurePosixPath(path).parents
        if parent != PurePosixPath(".")
    }
    seen_paths = set()
    total_bytes = 0
    normalized_files = []
    effective_files = []
    for index, item in enumerate(files):
        label = f"files[{index}]"
        if not isinstance(item, dict) or set(item) != {"path", "content", "mode"}:
            _fail(f"{label} must contain path, content and mode")
        path = _normal_path(item.get("path"), f"{label}.path")
        if path in seen_paths:
            _fail(f"files repeats path {path}")
        seen_paths.add(path)
        path_object = PurePosixPath(path)
        if target_dir not in path_object.parents:
            _fail(f"{label}.path escapes the target skill scope")
        if path in base_directories:
            _fail(f"{label}.path collides with an existing directory")
        if any(parent.as_posix() in tree for parent in path_object.parents):
            _fail(f"{label}.path collides with an existing file")
        for other in seen_paths:
            other_path = PurePosixPath(other)
            if path_object in other_path.parents or other_path in path_object.parents:
                _fail(f"{label}.path collides with another changed path")
        mode = item.get("mode")
        if mode not in {"100644", "100755"}:
            _fail(f"{label}.mode must be 100644 or 100755")
        content = item.get("content")
        if content is not None and not isinstance(content, str):
            _fail(f"{label}.content must be a string or null")
        if isinstance(content, str):
            content_bytes = len(content.encode("utf-8"))
            if content_bytes > MAX_FILE_BYTES:
                _fail(f"{label}.content exceeds the per-file size limit")
            total_bytes += content_bytes
            if total_bytes > MAX_TOTAL_BYTES:
                _fail("file contents exceed the total size limit")
        _check_tree_symlinks(tree, path, label)
        _check_filesystem_symlinks(root, path, label)
        existing = tree.get(path)
        if existing is not None and existing["mode"] == "120000":
            _fail(f"{label}.path names an existing symlink")
        if existing is not None and existing["type"] != "blob":
            _fail(f"{label}.path does not name a regular file")
        normalized = {"path": path, "content": content, "mode": mode}
        normalized_files.append(normalized)
        if content is None:
            if existing is not None:
                effective_files.append(normalized)
        elif (
            existing is None
            or mode != existing["mode"]
            or content != _blob(root, existing["sha"], path)
        ):
            effective_files.append(normalized)

    final_target = base_target
    for item in normalized_files:
        if item["path"] == target:
            if item["content"] is None:
                _fail("target SKILL.md cannot be deleted")
            final_target = item["content"]
    _frontmatter(final_target, "final target SKILL.md")
    for section in ("Launch", "Drive"):
        if not has_section(final_target, section):
            _fail(f"final target SKILL.md must retain a {section} section")

    feature_prefix = f"{target_dir.as_posix()}/features/"

    def is_feature(path: str) -> bool:
        candidate = PurePosixPath(path)
        return (
            path.startswith(feature_prefix)
            and candidate.suffix.lower() == ".md"
            and candidate.name.lower() != "readme.md"
        )

    original_features = {path for path in tree if is_feature(path)}
    for feature in original_features:
        if (
            tree[feature]["mode"] not in {"100644", "100755"}
            or tree[feature]["type"] != "blob"
        ):
            _fail(f"feature file cannot be a symlink: {feature}")
    final_features = set(original_features)
    final_paths = set(tree)
    final_modes = {path: item["mode"] for path, item in tree.items()}
    for item in normalized_files:
        path = item["path"]
        if item["content"] is None:
            final_paths.discard(path)
            final_modes.pop(path, None)
            final_features.discard(path)
        else:
            final_paths.add(path)
            final_modes[path] = item["mode"]
            if is_feature(path):
                final_features.add(path)
    feature_index = f"{target_dir.as_posix()}/features/README.md"
    if feature_index not in final_paths or final_modes.get(feature_index) not in {
        "100644",
        "100755",
    }:
        _fail("final target must retain a regular features/README.md index")
    if not final_features:
        _fail("final target must retain at least one feature file")
    coverage = _coverage(
        root,
        bundle.get("coverage"),
        original_features | final_features,
        require_complete=outcome != "blocked",
        require_evidence=outcome != "blocked",
    )
    if outcome != "blocked":
        changed_index = next(
            (item for item in normalized_files if item["path"] == feature_index), None
        )
        index_content = changed_index["content"] if changed_index is not None else _blob(
            root, tree[feature_index]["sha"], "feature index"
        )
        _validate_feature_index(index_content, feature_index, final_features, final_paths)
    return {
        "base_sha": base_sha,
        "target": target,
        "outcome": outcome,
        "summary": summary,
        "coverage": coverage,
        "files": normalized_files,
        "effective_files": effective_files,
        "settings": settings,
    }


def _api_list(api: Callable[..., Any], path: str, label: str) -> list[Any]:
    response = api("GET", path)
    if not isinstance(response, list):
        _fail(f"GitHub returned an invalid {label} response")
    return response


def expected_tree(root: Path, validated: dict[str, Any]) -> str:
    """Rebuild the complete correction tree without touching the checkout or index."""
    with tempfile.TemporaryDirectory(prefix="verification-tree-") as directory:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(directory) / "index")}
        _git(root, "read-tree", validated["base_sha"], env=env)
        for item in validated["effective_files"]:
            if item["content"] is None:
                _git(root, "update-index", "--force-remove", "--", item["path"], env=env)
            else:
                sha = _git(root, "hash-object", "-w", "--stdin", input=item["content"]).strip()
                _git(root, "update-index", "--add", "--cacheinfo",
                     item["mode"], sha, item["path"], env=env)
        return _git(root, "write-tree", env=env).strip()


def _pulls(api: Callable[..., Any], settings: dict[str, Any], branch: str, state: str) -> list[Any]:
    result = []
    page = 1
    while True:
        query = urlencode({"state": state, "head": f"{settings['owner']}:{branch}",
                           "per_page": "100", "page": str(page)})
        pulls = _api_list(api, f"/repos/{settings['owner']}/{settings['repo']}/pulls?{query}",
                          "pull request list")
        for pull in pulls:
            try:
                valid = _pull_url(pull) is not None and pull["state"] == state
                for side in ("head", "base"):
                    part = pull[side]
                    valid = (valid and isinstance(part["ref"], str) and bool(part["ref"])
                             and isinstance(part["sha"], str) and bool(SHA.fullmatch(part["sha"]))
                             and isinstance(part["repo"]["full_name"], str)
                             and bool(part["repo"]["full_name"]))
            except (KeyError, TypeError):
                valid = False
            if not valid:
                _fail("GitHub returned an invalid pull request list entry")
        result.extend(pulls)
        if len(pulls) < 100:
            return result
        page += 1


def _existing(branch: str, pulls: list[Any]) -> dict[str, Any]:
    result = {"outcome": "existing", "branch": branch}
    if pulls and isinstance(pulls[0], dict) and isinstance(pulls[0].get("html_url"), str):
        result["url"] = pulls[0]["html_url"]
    return result


def _ref_tip(api: Callable[..., Any], repository: str, branch: str) -> str | None:
    refs = _api_list(api, f"{repository}/git/matching-refs/heads/{quote(branch, safe='')}",
                     "reference list")
    ref = _exact_ref(refs, branch)
    if ref is None:
        return None
    try:
        tip = ref["object"]["sha"]
    except (KeyError, TypeError):
        _fail("GitHub returned an invalid maintenance branch reference")
    if not isinstance(tip, str) or not SHA.fullmatch(tip):
        _fail("GitHub returned an invalid maintenance branch reference")
    return tip


def _current_base(api: Callable[..., Any], settings: dict[str, Any], base_sha: str) -> None:
    path = f"/repos/{settings['owner']}/{settings['repo']}/git/ref/heads/{quote(settings['branch'], safe='')}"
    response = api("GET", path)
    try:
        tip = response["object"]["sha"]
    except (KeyError, TypeError):
        _fail("GitHub returned an invalid integration branch reference")
    if tip != base_sha:
        _fail("stale base: the integration branch moved after analysis")


def _exact_ref(refs: list[Any], branch: str) -> dict[str, Any] | None:
    expected = f"refs/heads/{branch}"
    found = None
    for ref in refs:
        if not isinstance(ref, dict) or not isinstance(ref.get("ref"), str):
            _fail("GitHub returned an invalid reference list entry")
        if ref["ref"] == expected:
            if found is not None:
                _fail("GitHub returned duplicate branch references")
            found = ref
    return found


def _is_ancestor(root: Path, ancestor: Any, descendant: str) -> bool:
    if not isinstance(ancestor, str) or SHA.fullmatch(ancestor) is None:
        return False
    result = subprocess.run(
        ["git", "-C", str(root), "merge-base", "--is-ancestor", ancestor, descendant],
        check=False,
        capture_output=True,
    )
    return result.returncode == 0


def _merged_retained_head(
    root: Path,
    api: Callable[..., Any],
    repository_path: str,
    owner: str,
    repo: str,
    branch: str,
    tip: Any,
    base_branch: str,
    base_sha: str,
) -> bool:
    """Prove a retained head was merged into the current integration history."""
    if not isinstance(tip, str) or SHA.fullmatch(tip) is None:
        return False
    page = 1
    while True:
        query = urlencode(
            {
                "state": "closed",
                "head": f"{owner}:{branch}",
                "base": base_branch,
                "per_page": "100",
                "page": str(page),
            }
        )
        pulls = _api_list(
            api, f"{repository_path}/pulls?{query}", "closed pull request list"
        )
        for pull in pulls:
            if not isinstance(pull, dict) or not pull.get("merged_at"):
                continue
            head, base = pull.get("head"), pull.get("base")
            if not isinstance(head, dict) or not isinstance(base, dict):
                continue
            if (
                head.get("sha") == tip
                and head.get("ref") == branch
                and base.get("ref") == base_branch
                and head.get("repo", {}).get("full_name") == f"{owner}/{repo}"
                and base.get("repo", {}).get("full_name") == f"{owner}/{repo}"
                and _is_ancestor(root, pull.get("merge_commit_sha"), base_sha)
            ):
                return True
        if len(pulls) < 100:
            return False
        page += 1


def _pull_body(validated: dict[str, Any]) -> str:
    lines = [
        validated["summary"],
        "",
        f"Target: `{validated['target']}`",
        "",
        "Live verification coverage:",
    ]
    for item in validated["coverage"]:
        lines.append(f"- `{item['feature']}`: {item['live']} from `{item['source']}`")
        lines.append(
            "  - Evidence: " + ", ".join(f"`{path}`" for path in item["evidence"])
        )
        if item["live"] == "verified-unreachable":
            lines.append(f"  - Prerequisite: {item['prerequisite']}")
            lines.append(f"  - Attempted route: `{item['attempted_route']}`")
    evidence_url = validated["settings"].get("evidence_url")
    if evidence_url:
        lines.extend(["", f"Workflow artifacts: {evidence_url}"])
    return "\n".join(lines)


def prepare_publication(
    root: Path,
    bundle: dict[str, Any],
    config: dict[str, Any],
    api: Callable[[str, str, dict[str, Any] | None], Any],
) -> dict[str, Any]:
    """Validate and create unattached objects, before receipt retention/authentication."""
    validated = validate_bundle(root, bundle, config)
    outcome = validated["outcome"]
    if outcome in {"clean", "blocked"}:
        return {"outcome": outcome}
    if not validated["effective_files"]:
        return {"outcome": "clean"}

    settings = validated["settings"]
    owner = settings["owner"]
    repo = settings["repo"]
    base_branch = settings["branch"]
    repository_path = f"/repos/{owner}/{repo}"
    maintenance_branch = branch_name(validated["target"])
    pulls = _pulls(api, settings, maintenance_branch, "open")
    if pulls:
        return _existing(maintenance_branch, pulls)

    tip = _ref_tip(api, repository_path, maintenance_branch)
    action = "create"
    if tip is not None:
        if _is_ancestor(Path(root), tip, validated["base_sha"]):
            action = "reuse"
        elif _merged_retained_head(
            Path(root),
            api,
            repository_path,
            owner,
            repo,
            maintenance_branch,
            tip,
            base_branch,
            validated["base_sha"],
        ):
            action = "retire"
        else:
            return {"outcome": "existing", "branch": maintenance_branch}

    _current_base(api, settings, validated["base_sha"])

    commit_path = f"{repository_path}/git/commits/{validated['base_sha']}"
    base_commit = api("GET", commit_path)
    try:
        base_tree = base_commit["tree"]["sha"]
    except (KeyError, TypeError):
        _fail("GitHub returned an invalid base commit")
    if base_tree != _git(root, "rev-parse", f"{validated['base_sha']}^{{tree}}").strip():
        _fail("GitHub returned an incorrect base tree")
    correction_tree = expected_tree(root, validated)

    tree_items = []
    for item in validated["effective_files"]:
        if item["content"] is None:
            blob_sha = None
        else:
            blob = api(
                "POST",
                f"{repository_path}/git/blobs",
                {"content": item["content"], "encoding": "utf-8"},
            )
            if not isinstance(blob, dict) or not isinstance(blob.get("sha"), str):
                _fail("GitHub returned an invalid blob")
            blob_sha = blob["sha"]
        tree_items.append(
            {
                "path": item["path"],
                "mode": item["mode"],
                "type": "blob",
                "sha": blob_sha,
            }
        )
    tree_response = api(
        "POST",
        f"{repository_path}/git/trees",
        {"base_tree": base_tree, "tree": tree_items},
    )
    if not isinstance(tree_response, dict) or not isinstance(
        tree_response.get("sha"), str
    ):
        _fail("GitHub returned an invalid tree")
    if tree_response["sha"] != correction_tree:
        _fail("GitHub returned an incorrect correction tree")

    commit_response = api(
        "POST",
        f"{repository_path}/git/commits",
        {
            "message": f"chore: maintain verification skill {validated['target']}",
            "tree": tree_response["sha"],
            "parents": [validated["base_sha"]],
        },
    )
    if (not isinstance(commit_response, dict)
            or not isinstance(commit_response.get("sha"), str)
            or not SHA.fullmatch(commit_response["sha"])):
        _fail("GitHub returned an invalid commit")
    prepared = {
        "outcome": "prepared", "base_sha": validated["base_sha"],
        "target": validated["target"], "branch": maintenance_branch,
        "head_sha": commit_response["sha"], "tree_sha": correction_tree,
        "previous_tip": tip, "ref_action": action,
    }
    _correction_commit(api, settings, prepared)
    return prepared


def _prepared_bundle(root, bundle, config, api, prepared):
    validated = validate_bundle(root, bundle, config)
    if (not isinstance(prepared, dict) or prepared.get("outcome") != "prepared"
            or validated["outcome"] != "changed" or not validated["effective_files"]
            or any(prepared.get(key) != validated[key] for key in ("base_sha", "target"))
            or prepared.get("branch") != branch_name(validated["target"])):
        _fail("prepared publication does not match the validated correction")
    for key in ("head_sha", "tree_sha"):
        if not isinstance(prepared.get(key), str) or not SHA.fullmatch(prepared[key]):
            _fail(f"prepared {key} must be a commit/tree SHA")
    if expected_tree(root, validated) != prepared["tree_sha"]:
        _fail("prepared correction tree changed")
    _correction_commit(api, validated["settings"], prepared)
    return validated


def _correction_commit(api, settings, prepared):
    commit = api("GET", f"/repos/{settings['owner']}/{settings['repo']}/git/commits/{prepared['head_sha']}")
    try:
        valid = (commit["sha"] == prepared["head_sha"]
                 and commit["tree"]["sha"] == prepared["tree_sha"]
                 and isinstance(commit["parents"], list)
                 and len(commit["parents"]) == 1
                 and commit["parents"][0]["sha"] == prepared["base_sha"])
    except (KeyError, TypeError):
        valid = False
    if not valid:
        _fail("prepared correction commit must have the exact tree and sole base parent")


def _matches_pull(pull, settings, prepared, *, closed=False):
    try:
        repository = f"{settings['owner']}/{settings['repo']}"
        return (pull["head"]["sha"] == prepared["head_sha"]
                and pull["head"]["ref"] == prepared["branch"]
                and pull["head"]["repo"]["full_name"] == repository
                and pull["base"]["repo"]["full_name"] == repository
                and (closed or pull["base"]["ref"] == settings["branch"]))
    except (KeyError, TypeError):
        return False


def _pull_url(pull):
    if not isinstance(pull, dict) or type(pull.get("number")) is not int or pull["number"] <= 0:
        return None
    url = pull.get("html_url")
    if not isinstance(url, str):
        return None
    try:
        parsed = urlsplit(url)
        repository = pull["base"]["repo"]["full_name"]
    except (ValueError, KeyError, TypeError):
        return None
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username
            or parsed.path != f"/{repository}/pull/{pull['number']}"):
        return None
    return url


def _closed_correction(api, settings, prepared):
    for pull in _pulls(api, settings, prepared["branch"], "closed"):
        # Retargeting a PR before closing it does not authorize another PR.
        if _matches_pull(pull, settings, prepared, closed=True):
            if not pull.get("merged_at"):
                _fail("closed unmerged PR already records this correction; inspect it manually")
            _fail("this correction already has a merged PR; inspect it manually")


def _publication_state(api, settings, prepared):
    _current_base(api, settings, prepared["base_sha"])
    repository = f"/repos/{settings['owner']}/{settings['repo']}"
    tip = _ref_tip(api, repository, prepared["branch"])
    if tip != prepared["head_sha"]:
        _fail(f"maintenance branch changed: expected {prepared['head_sha']}, observed {tip}")


def _publish_pull(validated, api, prepared):
    settings = validated["settings"]
    branch = prepared["branch"]
    pulls = _pulls(api, settings, branch, "open")
    if pulls:
        return _existing(branch, pulls)
    _closed_correction(api, settings, prepared)
    pulls = _pulls(api, settings, branch, "open")
    if pulls:
        return _existing(branch, pulls)
    _publication_state(api, settings, prepared)
    response = None
    request_error = None
    try:
        response = api("POST", f"/repos/{settings['owner']}/{settings['repo']}/pulls", {
            "title": "chore: maintain project verification skill", "head": branch,
            "base": settings["branch"], "body": _pull_body(validated), "draft": True,
        })
    except Exception as error:  # noqa: BLE001 - reconcile a possibly completed POST
        request_error = error
    url = _pull_url(response)
    try:
        pulls = _pulls(api, settings, branch, "open")
    except Exception as error:
        raise PublisherError(f"PR publication uncertain; lookup failed; inspect PR {url or 'unknown'}") from error
    exact = [pull for pull in pulls if _matches_pull(pull, settings, prepared) and _pull_url(pull)]
    if exact:
        url = _pull_url(exact[0])
    elif not url and pulls:
        url = _pull_url(pulls[0])
    try:
        _publication_state(api, settings, prepared)
    except PublisherError as error:
        raise PublisherError(f"publication concurrency failure: {error}; inspect PR {url or 'unknown'}") from error
    except Exception as error:
        raise PublisherError(f"PR publication uncertain; branch/base lookup failed; inspect PR {url or 'unknown'}") from error
    if len(exact) == 1:
        pull = exact[0]
        # Missing POST metadata is ambiguous, not proof of a race with the readback.
        try:
            response_complete = all(
                isinstance(value, str) and bool(value)
                for side in ("head", "base")
                for value in (response[side]["ref"], response[side]["sha"],
                              response[side]["repo"]["full_name"])
            )
        except (KeyError, TypeError):
            response_complete = False
        if (pull.get("state") != "open" or pull.get("base", {}).get("sha") != prepared["base_sha"]
                or (response_complete and _pull_url(response)
                    and (not _matches_pull(response, settings, prepared)
                         or response.get("base", {}).get("sha") != prepared["base_sha"]))):
            _fail(f"publication concurrency failure: resulting PR changed; inspect PR {url}")
        return {"outcome": "published", "branch": branch, "url": url}
    if pulls or url:
        _fail(f"publication concurrency failure: resulting PR does not match the correction; inspect PR {url or 'unknown'}")
    try:
        _closed_correction(api, settings, prepared)
    except Exception as error:
        raise PublisherError("PR publication uncertain; closed history lookup failed or correction was closed") from error
    detail = type(request_error).__name__ if request_error else "invalid response"
    if isinstance(getattr(request_error, "code", None), int):
        detail += f" HTTP {request_error.code}"
    raise PublisherError(
        f"PR creation failed ({detail}); exact PR absence confirmed; retained branch may be recovered later"
    ) from request_error


def finalize_publication(root, bundle, config, api, prepared) -> dict[str, Any]:
    """Attach a prepared head after the caller authenticates its retained receipt."""
    validated = _prepared_bundle(root, bundle, config, api, prepared)
    settings = validated["settings"]
    branch = prepared["branch"]
    repository = f"/repos/{settings['owner']}/{settings['repo']}"
    action, previous = prepared.get("ref_action"), prepared.get("previous_tip")
    if (action not in {"create", "reuse", "retire"}
            or (action == "create" and previous is not None)
            or (action != "create" and (not isinstance(previous, str) or not SHA.fullmatch(previous)))):
        _fail("prepared reference action is invalid")
    pulls = _pulls(api, settings, branch, "open")
    if pulls:
        return _existing(branch, pulls)
    _current_base(api, settings, prepared["base_sha"])
    if _ref_tip(api, repository, branch) != previous:
        _fail("maintenance branch changed after preparation")
    if action == "reuse" and not _is_ancestor(Path(root), previous, prepared["base_sha"]):
        _fail("prepared branch no longer qualifies for reuse")
    if action == "retire" and not _merged_retained_head(
        Path(root), api, repository, settings["owner"], settings["repo"], branch,
        previous, settings["branch"], prepared["base_sha"],
    ):
        _fail("prepared branch no longer qualifies for retirement")
    _closed_correction(api, settings, prepared)
    pulls = _pulls(api, settings, branch, "open")
    if pulls:
        return _existing(branch, pulls)
    _current_base(api, settings, prepared["base_sha"])
    if _ref_tip(api, repository, branch) != previous:
        _fail("maintenance branch changed after preparation")
    ref_path = f"{repository}/git/refs/heads/{quote(branch, safe='')}"
    if action == "retire":
        # GitHub DELETE has no expected-SHA argument. Concurrency serializes our
        # workflow, not human pushes; never broaden this merged-head exception.
        try:
            api("DELETE", ref_path)
        except Exception:  # noqa: BLE001 - reconcile a possibly completed DELETE
            try:
                tip = _ref_tip(api, repository, branch)
            except Exception as error:
                raise PublisherError("reference retirement uncertain; lookup failed") from error
            if tip is not None:
                _fail("reference retirement failed; retained branch left untouched")
        _current_base(api, settings, prepared["base_sha"])
        if _ref_tip(api, repository, branch) is not None:
            _fail("maintenance branch changed during retirement")
    try:
        if action == "reuse":
            api("PATCH", ref_path, {"sha": prepared["head_sha"], "force": False})
        else:
            api("POST", f"{repository}/git/refs", {
                "ref": f"refs/heads/{branch}", "sha": prepared["head_sha"],
            })
    except Exception:  # noqa: BLE001 - reconcile a possibly completed ref write
        try:
            tip = _ref_tip(api, repository, branch)
        except Exception as error:
            raise PublisherError("reference publication uncertain; lookup failed") from error
        if tip != prepared["head_sha"]:
            _fail(f"reference publication failed: expected {prepared['head_sha']}, observed {tip}")
    _publication_state(api, settings, prepared)
    return _publish_pull(validated, api, prepared)


def recover_publication(root, bundle, config, api, prepared) -> dict[str, Any]:
    """Recover an authenticated retained correction. The only remote write is PR creation."""
    validated = _prepared_bundle(root, bundle, config, api, prepared)
    _publication_state(api, validated["settings"], prepared)
    result = _publish_pull(validated, api, prepared)
    if validated["settings"]["evidence_url"]:
        result["evidence_url"] = validated["settings"]["evidence_url"]
    return result


def publish(root, bundle, config, api) -> dict[str, Any]:
    """Shipped direct-call wrapper; workflow callers must retain/authenticate between phases."""
    prepared = prepare_publication(root, bundle, config, api)
    if prepared["outcome"] != "prepared":
        return prepared
    return finalize_publication(root, bundle, config, api, prepared)
