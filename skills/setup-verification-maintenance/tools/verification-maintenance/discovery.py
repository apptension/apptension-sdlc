"""Find a project-owned verification skill without choosing among multiple apps."""
import re
from pathlib import Path

SKILL_ROOTS = ('.agents/skills', '.claude/skills', '.cursor/skills', '.codex/skills', '.opencode/skills')


def binding(root: Path) -> str | None:
    for name in ('CLAUDE.md', 'AGENTS.md'):
        path = root / name
        if not path.exists():
            continue
        text = path.read_text()
        section = re.search(r'^### Dev flow bindings\s*\n(.*?)(?=^#{1,3} |\Z)', text, re.MULTILINE | re.DOTALL)
        if section:
            match = re.search(r'^\|\s*Verification skill\s*\|\s*([^|]+)\|', section[1], re.MULTILINE)
            if match:
                value = match[1].strip().strip('`')
                if value not in ('unknown', 'none', 'N/A', ''):
                    return value
    return None


def has_section(content: str, section: str) -> bool:
    """Accept a heading that starts with the named verification section."""
    headings = re.findall(r'^#{1,6}\s+([^\n]+)', content, re.MULTILINE)
    return any(heading.lower().strip().startswith(section.lower()) for heading in headings)


def usable(path: Path, root: Path) -> bool:
    text = path.read_text()
    front = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', text, re.DOTALL)
    if not front or not all(re.search(rf'^{key}:\s*\S', front[1], re.MULTILINE) for key in ('name', 'description')):
        return False
    features = path.parent / 'features'
    if features.is_symlink():
        raise ValueError(f'Feature map contains a symlink: {features}')
    entries = []
    for entry in features.rglob('*'):
        if entry.is_symlink():
            raise ValueError(f'Feature map contains a symlink: {entry}')
        if entry.is_file() and entry.suffix.lower() == '.md' and entry.name.lower() != 'readme.md':
            entries.append(entry)
    index = features / 'README.md'
    if not index.is_file():
        return False
    entries.insert(0, index)
    for entry in entries:
        if not entry.resolve().is_relative_to(root):
            raise ValueError(f'Feature map leaves repository: {entry}')
        if not entry.is_file():
            return False
        entry.read_text()  # An unreadable map cannot establish a usable skill.
    return (has_section(text, 'Launch')
            and has_section(text, 'Drive')
            and len(entries) > 1)



def discover(root: Path, explicit: str | None = None) -> dict:
    root = root.resolve()
    try:
        selected = explicit if explicit is not None else binding(root)
        candidates = [root / selected] if selected else [
            p for directory in SKILL_ROOTS for p in (root / directory).glob('*/SKILL.md')
        ]
        found = set()
        for candidate in candidates:
            resolved = candidate.resolve()
            if not resolved.is_relative_to(root):
                raise ValueError(f'Skill leaves repository: {candidate}')
            if not resolved.is_file():
                if selected:
                    raise ValueError(f'Bound skill is missing: {selected}')
                continue
            if usable(resolved, root):
                found.add(resolved.relative_to(root).as_posix())
            elif selected:
                raise ValueError(f'Bound skill needs metadata, Launch, Drive and feature map: {selected}')
        paths = sorted(found)
        return {'status': 'present' if len(paths) == 1 else 'ambiguous' if paths else 'missing', 'paths': paths}
    except (OSError, ValueError) as error:
        return {'status': 'invalid', 'paths': [], 'reason': str(error)}


def setup_gap(discovery: dict, issues: list[dict]) -> dict:
    if discovery['status'] == 'present':
        return {'action': 'skip'}
    if discovery['status'] != 'missing':
        return {'action': 'report', 'reason': discovery.get('reason', 'Select one verification skill')}
    marker = re.compile(r'<!--\s*repo-setup:project-verification-skill(?=\s|-->)')
    for issue in issues:
        if 'pull_request' in issue:
            continue
        if marker.search(issue.get('body') or ''):
            return {'action': 'skip', 'issue': issue['number']}
    return {'action': 'create'}
