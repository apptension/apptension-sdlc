"""Capture proposed corrections as data; the publisher never executes this diff."""
import re
import subprocess
from pathlib import Path, PurePosixPath


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(['git', '-C', str(root), *args])


def collect(root: Path, config: dict, report: dict, base_sha: str) -> dict:
    root = root.resolve()
    if not re.fullmatch(r'[0-9a-f]{40}', base_sha):
        raise ValueError('Invalid base SHA')
    if git(root, 'rev-parse', 'HEAD').decode().strip() != base_sha:
        raise ValueError('Agent changed HEAD; retain the original base without committing')
    target = PurePosixPath(config['target'])
    if target.is_absolute() or '..' in target.parts or target.name != 'SKILL.md' or len(target.parts) < 2:
        raise ValueError('Invalid target')
    if target.parts[0] in {'.verification-output', '.verification-evidence', '.verification-report.json'}:
        raise ValueError('Invalid target: reserved output root')
    directory = target.parent.as_posix()
    names = set(git(root, 'diff', '--name-only', '-z', base_sha, '--').decode().split('\0'))
    names.update(git(root, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
    # Include new helpers even when a project's global ignore rule hides their extension.
    tracked = set(git(root, 'ls-files', '-z').decode().split('\0'))
    owned = root / directory
    for path in owned.rglob('*'):
        if '__pycache__' not in path.parts and (path.is_file() or path.is_symlink()):
            name = path.relative_to(root).as_posix()
            if name not in tracked:
                names.add(name)
    files = []
    for name in sorted(names - {''}):
        if name == '.verification-report.json' or name.startswith(('.verification-evidence/', '.verification-output/')):
            continue
        if not name.startswith(directory + '/'):
            raise ValueError(f'Change outside verification skill: {name}')
        path = root / name
        if any(p.is_symlink() for p in [path, *path.parents] if p != root and p.is_relative_to(root)):
            raise ValueError(f'Correction contains symlink: {name}')
        old = git(root, 'ls-tree', base_sha, '--', name).decode().strip()
        content = None
        mode = '100644'
        if path.exists():
            if not path.is_file() or path.stat().st_size > 1_000_000:
                raise ValueError(f'Correction is not a small text file: {name}')
            content = path.read_text(encoding='utf-8')
            mode = '100755' if path.stat().st_mode & 0o111 else '100644'
        if old:
            old_mode = old.split()[0]
            old_content = git(root, 'show', f'{base_sha}:{name}').decode('utf-8')
            if old_content == content and old_mode == mode:
                continue
        elif content is None:
            continue
        files.append({'path': name, 'content': content, 'mode': mode})
    if report.get('outcome') == 'clean' and files:
        raise ValueError('A clean report cannot contain corrections')
    base_evidence = set(git(root, 'ls-tree', '-r', '--name-only', '-z', base_sha,
                            '--', '.verification-evidence/').decode().split('\0'))
    for entry in report.get('coverage', []):
        for name in entry.get('evidence', []):
            path = root / name
            if PurePosixPath(name).as_posix() in base_evidence:
                raise ValueError(f'Evidence cannot reuse a file tracked in the base revision: {name}')
            if (not isinstance(name, str) or not name.startswith('.verification-evidence/')
                    or '..' in PurePosixPath(name).parts or not path.is_file()
                    or not path.resolve().is_relative_to(root / '.verification-evidence')
                    or path.stat().st_size == 0):
                raise ValueError(f'Evidence missing after cleanup: {name}')
    return {**report, 'target': config['target'], 'base_sha': base_sha, 'files': files}
