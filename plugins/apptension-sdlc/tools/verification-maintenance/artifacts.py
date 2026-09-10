"""Bounded artifact downloads and immutable Actions provenance checks."""
from __future__ import annotations

import io
import re
import stat
from datetime import UTC, datetime
from pathlib import PurePosixPath
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zipfile import BadZipFile, ZipFile

MAX_COMPRESSED = 100 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_MEMBERS = 10_000
WORKFLOW_PATH = '.github/workflows/verification-maintenance.yml'


def positive_id(value):
    if type(value) is not int or not 0 < value < 2**63:
        raise ValueError('invalid positive identity')
    return value


def normal_path(value):
    if (not isinstance(value, str) or not value or len(value.encode()) > 1024
            or any(ord(c) < 32 for c in value) or '\\' in value or ':' in value
            or value.startswith('/') or value != PurePosixPath(value).as_posix()
            or any(p in {'', '.', '..'} or p.lower() == '.git' for p in value.split('/'))):
        raise ValueError('invalid archive path')
    return value


def decode_archive(raw: bytes) -> dict[str, bytes]:
    """Decode data in memory, never extract ZIP-selected paths to disk."""
    if not isinstance(raw, bytes) or len(raw) > MAX_COMPRESSED:
        raise ValueError('compressed archive limit exceeded')
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            members = archive.infolist()
            if len(members) > MAX_MEMBERS or sum(m.file_size for m in members) > MAX_EXPANDED:
                raise ValueError('expanded archive limit exceeded')
            seen, files, total = set(), {}, 0
            for member in members:
                name = normal_path(member.orig_filename[:-1] if member.is_dir() else member.orig_filename)
                if name in seen:
                    raise ValueError('duplicate archive path')
                seen.add(name)
                kind = stat.S_IFMT(member.external_attr >> 16)
                if kind not in ({0, stat.S_IFDIR} if member.is_dir() else {0, stat.S_IFREG}):
                    raise ValueError('archive member is not a regular file or directory')
                if member.flag_bits & 1:
                    raise ValueError('encrypted archive file')
                if member.is_dir():
                    if member.file_size:
                        raise ValueError('directory contains file data')
                    continue
                with archive.open(member) as source:
                    data = source.read(MAX_EXPANDED - total + 1)
                total += len(data)
                if total > MAX_EXPANDED:
                    raise ValueError('expanded archive limit exceeded')
                files[name] = data
            if any(parent.as_posix() in files for name in seen for parent in PurePosixPath(name).parents):
                raise ValueError('archive path collides with file')
            return files
    except (BadZipFile, RuntimeError, NotImplementedError) as error:
        raise ValueError('invalid artifact archive') from error


class SafeRedirect(HTTPRedirectHandler):
    """Signed storage URLs must never receive API credentials."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('unsafe artifact redirect')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            for name in list(redirected.headers):
                if name.lower() not in {'accept', 'user-agent'}:
                    redirected.remove_header(name)
        return redirected


def binary_downloader(token: str, api_url: str = 'https://api.github.com'):
    """Return download(path)->bytes; timeout 30s, HTTPS only, bounded reads."""
    parsed = urlsplit(api_url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
        raise ValueError('invalid artifact API URL')
    opener = build_opener(SafeRedirect())

    def download(path: str) -> bytes:
        if not re.fullmatch(r'/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/artifacts/[1-9][0-9]*/zip', path):
            raise ValueError('invalid artifact download path')
        request = Request(api_url.rstrip('/') + path, headers={'Accept': 'application/vnd.github+json'})
        request.add_unredirected_header('Authorization', f'Bearer {token}')
        try:
            with opener.open(request, timeout=30) as response:
                raw = response.read(MAX_COMPRESSED + 1)
        except Exception as error:  # noqa: BLE001 - redact transport exceptions, including signed URLs
            # HTTP exceptions contain signed URLs. Do not expose them to summaries.
            raise ValueError(f'artifact download failed ({type(error).__name__})') from None
        if len(raw) > MAX_COMPRESSED:
            raise ValueError('compressed archive limit exceeded')
        return raw

    return download


def repository_metadata(api, repository):
    if not isinstance(repository, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('invalid repository')
    result = api('GET', f'/repos/{repository}')
    if not isinstance(result, dict) or result.get('full_name') != repository:
        raise ValueError('repository identity mismatch')
    positive_id(result.get('id'))
    return result


def validate_run(api, repository, run_id, attempt, integration_branch) -> dict:
    """Validate the original attempt, including failed or cancelled attempts."""
    positive_id(run_id)
    positive_id(attempt)
    repo = repository_metadata(api, repository)
    run = api('GET', f'/repos/{repository}/actions/runs/{run_id}/attempts/{attempt}')
    if not isinstance(run, dict):
        raise ValueError('invalid workflow run metadata')  # noqa: TRY004 - untrusted input refusal
    positive_id(run.get('id'))
    positive_id(run.get('run_attempt'))
    if (run.get('id') != run_id or run.get('run_attempt') != attempt
            or run.get('event') not in {'schedule', 'workflow_dispatch'}
            or not isinstance(repo.get('default_branch'), str)
            or not run.get('head_branch')
            or run.get('head_branch') not in {repo['default_branch'], integration_branch}
            or run.get('path') != WORKFLOW_PATH):
        raise ValueError('untrusted workflow run or attempt')
    for key in ('repository', 'head_repository'):
        identity = run.get(key)
        if not isinstance(identity, dict) or identity.get('id') != repo['id'] or identity.get('full_name') != repository:
            raise ValueError('workflow repository identity mismatch')
        positive_id(identity.get('id'))
    workflow_id = positive_id(run.get('workflow_id'))
    workflow = api('GET', f'/repos/{repository}/actions/workflows/{workflow_id}')
    if not isinstance(workflow, dict) or workflow.get('id') != workflow_id or workflow.get('path') != WORKFLOW_PATH:
        raise ValueError('workflow identity mismatch')
    positive_id(workflow.get('id'))
    return run


def read_artifact(api, download, repository, artifact_id, run_id, expected_name) -> dict[str, bytes]:
    """Fetch one immutable ID after validating repository, run, name and retention."""
    positive_id(artifact_id)
    positive_id(run_id)
    repo = repository_metadata(api, repository)
    artifact = api('GET', f'/repos/{repository}/actions/artifacts/{artifact_id}')
    if not isinstance(artifact, dict):
        raise ValueError('invalid artifact metadata')  # noqa: TRY004 - untrusted input refusal
    positive_id(artifact.get('id'))
    run = artifact.get('workflow_run')
    if (artifact.get('id') != artifact_id or artifact.get('name') != expected_name
            or artifact.get('expired') is not False or not isinstance(run, dict)
            or run.get('id') != run_id or run.get('repository_id') != repo['id']
            or run.get('head_repository_id') != repo['id']):
        raise ValueError('artifact provenance or retention mismatch')
    for key in ('id', 'repository_id', 'head_repository_id'):
        positive_id(run.get(key))
    try:
        expiration = datetime.fromisoformat(artifact['expires_at'])
        if expiration <= datetime.now(UTC):
            raise ValueError('expired artifact')
    except (KeyError, TypeError, AttributeError, ValueError) as error:
        raise ValueError('artifact expiration missing, invalid or expired') from error
    return decode_archive(download(f'/repos/{repository}/actions/artifacts/{artifact_id}/zip'))
