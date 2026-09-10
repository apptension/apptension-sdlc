"""Authenticate retained publication receipts before delegating Git/PR writes."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path

import publisher
from artifacts import (
    MAX_EXPANDED,
    MAX_MEMBERS,
    WORKFLOW_PATH,
    normal_path,
    positive_id,
    read_artifact,
    validate_run,
)

MAX_RECEIPT = 4 * 1024 * 1024
MAX_BUNDLE = 16 * 1024 * 1024
DIGEST = re.compile(r'[0-9a-f]{64}')
FIELDS = {'version', 'repository', 'repository_id', 'target', 'integration_branch',
          'base_sha', 'branch', 'head_sha', 'tree_sha', 'workflow_id', 'workflow_path',
          'run_id', 'attempt', 'bundle_artifact_id', 'evidence_artifact_id',
          'bundle_sha256', 'evidence', 'outcome', 'previous_tip', 'ref_action'}
MANUAL = ('Inspect the retained branch diff and original evidence. Publish the inspected '
          'correction manually, or preserve wanted work before manually removing the '
          'obstruction and running fresh verification. For service or permission failures, '
          'restore access and retry recovery without changing the branch.')


def _json(raw, limit):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON field')
            result[key] = value
        return result
    if not isinstance(raw, bytes) or len(raw) > limit:
        raise ValueError('JSON size limit exceeded')
    try:
        value = json.loads(raw, object_pairs_hook=pairs)
    except (UnicodeError, RecursionError) as error:
        raise ValueError('invalid JSON encoding or nesting') from error
    if not isinstance(value, dict):
        raise ValueError('JSON must be an object')  # noqa: TRY004 - untrusted input refusal
    return value


def receipt_bytes(receipt: dict) -> bytes:
    """The workflow must upload these bytes verbatim as receipt.json."""
    raw = (json.dumps(receipt, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False) + '\n').encode()
    if len(raw) > MAX_RECEIPT:
        raise ValueError('receipt size limit exceeded')
    return raw


def verify_receipt_bytes(raw: bytes, expected_digest: str) -> dict:
    if (not isinstance(expected_digest, str) or not DIGEST.fullmatch(expected_digest)
            or not isinstance(raw, bytes)
            or not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), expected_digest)):
        raise ValueError('receipt digest mismatch')
    return _json(raw, MAX_RECEIPT)


def _receipt(receipt, config):
    if set(receipt) != FIELDS or type(receipt['version']) is not int or receipt['version'] != 1:
        raise ValueError('invalid receipt version or fields')
    for key in ('repository_id', 'workflow_id', 'run_id', 'attempt', 'bundle_artifact_id', 'evidence_artifact_id'):
        positive_id(receipt[key])
    for key in ('base_sha', 'head_sha', 'tree_sha'):
        if not isinstance(receipt[key], str) or not publisher.SHA.fullmatch(receipt[key]):
            raise ValueError('invalid receipt SHA')
    if (receipt['repository'] != config['repository'] or receipt['target'] != config['target']
            or receipt['integration_branch'] != config['integration_branch']
            or receipt['branch'] != publisher.branch_name(config['target'])
            or receipt['workflow_path'] != WORKFLOW_PATH or receipt['outcome'] != 'prepared'):
        raise ValueError('receipt identity does not match trusted configuration')
    if not isinstance(receipt['bundle_sha256'], str) or not DIGEST.fullmatch(receipt['bundle_sha256']):
        raise ValueError('invalid bundle digest')
    previous, action = receipt['previous_tip'], receipt['ref_action']
    if (action not in {'create', 'reuse', 'retire'}
            or (action == 'create' and previous is not None)
            or (action != 'create' and (not isinstance(previous, str) or not publisher.SHA.fullmatch(previous)))):
        raise ValueError('invalid receipt reference action')
    evidence = receipt['evidence']
    if not isinstance(evidence, list) or not 0 < len(evidence) <= MAX_MEMBERS:
        raise ValueError('invalid evidence manifest size')
    seen, total = set(), 0
    for item in evidence:
        if not isinstance(item, dict) or set(item) != {'path', 'size', 'sha256'}:
            raise ValueError('invalid evidence manifest entry')
        path = normal_path(item['path'])
        if (path in seen or type(item['size']) is not int or not 0 < item['size'] <= MAX_EXPANDED
                or not isinstance(item['sha256'], str) or not DIGEST.fullmatch(item['sha256'])):
            raise ValueError('invalid evidence manifest path, size or digest')
        seen.add(path)
        total += item['size']
    if total > MAX_EXPANDED:
        raise ValueError('evidence manifest size limit exceeded')
    return receipt


def _name(kind, attempt):
    return f'verification-maintenance-{kind}-{positive_id(attempt)}'


def _private_path(root, run_id, attempt):
    positive_id(run_id)
    positive_id(attempt)
    git_dir = publisher._git(Path(root), 'rev-parse', '--absolute-git-dir').strip()
    return Path(git_dir) / f'verification-maintenance-receipt-{run_id}-{attempt}.json'


def _manifest(bundle, evidence):
    paths = set()
    for item in bundle['coverage']:
        for path in item['evidence']:
            normal_path(path)
            if not path.startswith('.verification-evidence/'):
                raise ValueError('evidence path outside evidence root')
            paths.add(path.removeprefix('.verification-evidence/'))
    manifest = []
    for path in sorted(paths):
        data = evidence.get(path)
        if not isinstance(data, bytes) or not data:
            raise ValueError('missing or empty original evidence')
        manifest.append({'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    return manifest


def _original(api, download, config, run_id, attempt, bundle_id, evidence_id):
    output = read_artifact(api, download, config['repository'], bundle_id, run_id, _name('output', attempt))
    raw = output.get('.verification-output/bundle.json')
    bundle = _json(raw, MAX_BUNDLE)
    evidence = read_artifact(api, download, config['repository'], evidence_id, run_id, _name('evidence', attempt))
    return raw, bundle, evidence


def prepare_receipt(root, bundle_path, config, api, download, run_id, attempt,
                    bundle_artifact_id, evidence_artifact_id) -> dict:
    """Validate local/retained bytes, prepare objects, and save a private upload witness."""
    root = Path(root)
    with Path(bundle_path).open('rb') as source:
        local = source.read(MAX_BUNDLE + 1)
    bundle = _json(local, MAX_BUNDLE)
    validated = publisher.validate_bundle(root, bundle, config)
    if validated['outcome'] != 'changed' or not validated['effective_files']:
        return {'outcome': validated['outcome'] if validated['outcome'] != 'changed' else 'clean'}
    run = validate_run(api, config['repository'], run_id, attempt, config['integration_branch'])
    raw, original, evidence = _original(api, download, config, run_id, attempt, bundle_artifact_id, evidence_artifact_id)
    if raw != local:
        raise ValueError('retained bundle bytes differ from local bundle')
    manifest = _manifest(original, evidence)
    for item in manifest:
        path = root / '.verification-evidence' / item['path']
        publisher._check_filesystem_symlinks(root, '.verification-evidence/' + item['path'], 'evidence')
        with path.open('rb') as source:
            data = source.read(item['size'] + 1)
        if data != evidence[item['path']]:
            raise ValueError('retained evidence bytes differ from local evidence')
    prepared = publisher.prepare_publication(root, bundle, config, api)
    if prepared['outcome'] != 'prepared':
        return prepared
    receipt = {**prepared, 'version': 1, 'repository': config['repository'],
               'repository_id': run['repository']['id'], 'integration_branch': config['integration_branch'],
               'workflow_id': run['workflow_id'], 'workflow_path': WORKFLOW_PATH,
               'run_id': run_id, 'attempt': attempt, 'bundle_artifact_id': bundle_artifact_id,
               'evidence_artifact_id': evidence_artifact_id,
               'bundle_sha256': hashlib.sha256(raw).hexdigest(), 'evidence': manifest}
    _receipt(receipt, config)
    path = _private_path(root, run_id, attempt)
    # This witness stays in the trusted publisher checkout across the upload step.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(receipt_bytes(receipt))
    return receipt


def _context(config):
    return 'verification-maintenance/receipt/' + publisher.branch_name(config['target']).split('/')[-1]


def _run_url(config, run_id):
    return f'https://github.com/{config["repository"]}/actions/runs/{positive_id(run_id)}'


def _status(api, config, head_sha):
    if not isinstance(head_sha, str) or not publisher.SHA.fullmatch(head_sha):
        raise ValueError('invalid status commit SHA')
    records, page = set(), 1
    while True:
        values = api('GET', f'/repos/{config["repository"]}/commits/{head_sha}/statuses?per_page=100&page={page}')
        if not isinstance(values, list) or len(values) > 100:
            raise ValueError('invalid commit status page')
        for value in values:
            if not isinstance(value, dict) or not isinstance(value.get('context'), str):
                raise ValueError('invalid commit status metadata')  # noqa: TRY004 - untrusted input refusal
            if value['context'] != _context(config):
                continue
            creator = value.get('creator')
            if (not isinstance(creator, dict) or type(creator.get('id')) is not int
                    or creator['id'] != 41898282 or creator.get('login') != 'github-actions[bot]'
                    or creator.get('type') != 'Bot' or value.get('state') != 'success'):
                raise ValueError('receipt status is not authenticated by the expected Actions bot')
            description, url = value.get('description'), value.get('target_url')
            match = re.fullmatch(r'v1:sha256:([0-9a-f]{64})', description) if isinstance(description, str) else None
            location = re.fullmatch(re.escape(f'https://github.com/{config["repository"]}/actions/runs/')
                                    + r'([1-9][0-9]*)/artifacts/([1-9][0-9]*)', url) if isinstance(url, str) else None
            if not match or not location:
                raise ValueError('invalid receipt status digest or artifact URL')
            records.add((match[1], positive_id(int(location[1])), positive_id(int(location[2]))))
        if len(values) < 100:
            break
        page += 1
    if len(records) != 1:
        raise ValueError('conflicting receipt statuses' if records else 'no authenticated receipt status; old or unproved orphan')
    return records.pop()


@contextmanager
def _evidence_root(root, evidence):
    # A data-only view shares trusted Git objects/HEAD, but not checkout files.
    # No checkout, archive extraction, retained script, or Git hook is executed.
    git_dir = publisher._git(Path(root), 'rev-parse', '--absolute-git-dir').strip()
    with tempfile.TemporaryDirectory(prefix='verification-recovery-') as directory:
        view = Path(directory)
        (view / '.git').write_text(f'gitdir: {git_dir}\n')
        for name, data in evidence.items():
            path = view / '.verification-evidence' / normal_path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        yield view


def _validate_original(root, config, api, download, receipt):
    _receipt(receipt, config)
    run = validate_run(api, config['repository'], receipt['run_id'], receipt['attempt'], config['integration_branch'])
    if run['repository']['id'] != receipt['repository_id'] or run['workflow_id'] != receipt['workflow_id']:
        raise ValueError('receipt workflow or repository identity changed')
    raw, bundle, evidence = _original(api, download, config, receipt['run_id'], receipt['attempt'],
                                      receipt['bundle_artifact_id'], receipt['evidence_artifact_id'])
    if hashlib.sha256(raw).hexdigest() != receipt['bundle_sha256']:
        raise ValueError('original bundle digest mismatch')
    if _manifest(bundle, evidence) != receipt['evidence']:
        raise ValueError('original evidence manifest mismatch')
    settings = {**config, 'evidence_url': _run_url(config, receipt['run_id'])}
    with _evidence_root(root, {item['path']: evidence[item['path']] for item in receipt['evidence']}) as view:
        validated = publisher.validate_bundle(view, bundle, settings)
        if (validated['outcome'] != 'changed' or not validated['effective_files']
                or validated['base_sha'] != receipt['base_sha']
                or publisher.expected_tree(view, validated) != receipt['tree_sha']):
            raise ValueError('receipt does not describe the full validated correction')
        publisher._correction_commit(api, validated['settings'], receipt)
        publisher._current_base(api, validated['settings'], receipt['base_sha'])
    return bundle, evidence, settings


def _refusal(config, error, tip=None, receipt=None):
    reason = str(error) if isinstance(error, ValueError) else f'API or filesystem failure ({type(error).__name__})'
    result = {'outcome': 'manual', 'branch': publisher.branch_name(config['target']),
              'observed_tip': tip, 'reason': reason, 'manual_guidance': MANUAL}
    if receipt:
        result.update(expected_tip=receipt['head_sha'], evidence_url=_run_url(config, receipt['run_id']))
    return result


def seal_and_publish(root, config, api, download, receipt_artifact_id, run_id, attempt) -> dict:
    """Read back the upload, authenticate a status, then allow branch attachment."""
    receipt = None
    try:
        validate_run(api, config['repository'], run_id, attempt, config['integration_branch'])
        files = read_artifact(api, download, config['repository'], receipt_artifact_id, run_id, _name('receipt', attempt))
        if set(files) != {'receipt.json'}:
            raise ValueError('receipt archive must contain only receipt.json')
        path = _private_path(root, run_id, attempt)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as source:
            trusted = source.read(MAX_RECEIPT + 1)
        digest = hashlib.sha256(trusted).hexdigest()
        candidate = verify_receipt_bytes(files['receipt.json'], digest)
        _receipt(candidate, config)
        if candidate['run_id'] != run_id or candidate['attempt'] != attempt:
            raise ValueError('uploaded receipt run or attempt mismatch')
        receipt = candidate
        bundle, evidence, settings = _validate_original(root, config, api, download, receipt)
        body = {'state': 'success', 'context': _context(config), 'description': f'v1:sha256:{digest}',
                'target_url': _run_url(config, run_id) + f'/artifacts/{positive_id(receipt_artifact_id)}'}
        try:
            api('POST', f'/repos/{config["repository"]}/statuses/{receipt["head_sha"]}', body)
        except Exception:  # noqa: BLE001, S110 - reconcile ambiguous writes, never log signed URLs
            pass  # A timed-out status write is authorized only by exact readback below.
        if _status(api, config, receipt['head_sha']) != (digest, run_id, receipt_artifact_id):
            raise ValueError('receipt status readback mismatch')
        with _evidence_root(root, {item['path']: evidence[item['path']] for item in receipt['evidence']}) as view:
            result = publisher.finalize_publication(view, bundle, settings, api, receipt)
        result['evidence_url'] = settings['evidence_url']
        return result
    except Exception as error:  # noqa: BLE001 - command boundary returns structured refusal
        tip = None
        if receipt:
            try:
                tip = publisher._ref_tip(api, f'/repos/{config["repository"]}', receipt['branch'])
            except Exception:  # noqa: BLE001, S110 - best-effort diagnostic, original failure is retained
                pass  # Preserve the original blocker when the diagnostic lookup fails too.
        return _refusal(config, error, tip, receipt)


def recover(root, config, api, download) -> dict:
    """Independently authenticate an orphan; the only remote write is PR creation."""
    tip, receipt = None, None
    try:
        settings = publisher._config(Path(root), config)
        branch = publisher.branch_name(config['target'])
        pulls = publisher._pulls(api, settings, branch, 'open')
        if pulls:
            return publisher._existing(branch, pulls)
        tip = publisher._ref_tip(api, f'/repos/{config["repository"]}', branch)
        if tip is None:
            return {'outcome': 'clean', 'branch': branch}
        base = publisher._git(Path(root), 'rev-parse', 'HEAD').strip()
        publisher._current_base(api, settings, base)
        if (publisher._is_ancestor(Path(root), tip, base)
                or publisher._merged_retained_head(Path(root), api, f'/repos/{config["repository"]}',
                                                   settings['owner'], settings['repo'], branch,
                                                   tip, settings['branch'], base)):
            return {'outcome': 'clean', 'branch': branch}
        digest, run_id, artifact_id = _status(api, config, tip)
        metadata = api('GET', f'/repos/{config["repository"]}/actions/artifacts/{artifact_id}')
        name = metadata.get('name') if isinstance(metadata, dict) else None
        match = re.fullmatch(r'verification-maintenance-receipt-([1-9][0-9]*)', name) if isinstance(name, str) else None
        if not match:
            raise ValueError('invalid receipt artifact attempt name')
        attempt = positive_id(int(match[1]))
        files = read_artifact(api, download, config['repository'], artifact_id, run_id, _name('receipt', attempt))
        if set(files) != {'receipt.json'}:
            raise ValueError('receipt archive must contain only receipt.json')
        candidate = verify_receipt_bytes(files['receipt.json'], digest)
        _receipt(candidate, config)
        if candidate['run_id'] != run_id or candidate['attempt'] != attempt:
            raise ValueError('receipt does not match original run or attempt')
        receipt = candidate
        if receipt['head_sha'] != tip:
            raise ValueError('receipt does not match exact branch tip')
        bundle, evidence, settings = _validate_original(root, config, api, download, receipt)
        with _evidence_root(root, {item['path']: evidence[item['path']] for item in receipt['evidence']}) as view:
            return publisher.recover_publication(view, bundle, settings, api, receipt)
    except Exception as error:  # noqa: BLE001 - command boundary returns structured refusal
        return _refusal(config, error, tip, receipt)
