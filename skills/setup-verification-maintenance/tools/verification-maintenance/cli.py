#!/usr/bin/env python3
"""Project verification discovery, installation and scheduled maintenance."""
import argparse
import html
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPException
from pathlib import Path

from discovery import discover, setup_gap


def load(path):
    return json.loads(Path(path).read_text())


def save(path, data):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2) + '\n')


def api(method, path, body=None):
    token = os.environ.get('GH_TOKEN')
    if not token:
        raise ValueError('GH_TOKEN is required for the GitHub preflight or publisher')
    base = os.environ.get('GITHUB_API_URL', 'https://api.github.com')
    request = urllib.request.Request(base + '/' + path.lstrip('/'),
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPException as error:
        raise ValueError(f'GitHub API transport failed ({type(error).__name__})') from None


def prepare(root, config):
    base = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    result = {'base_sha': base, 'provider': config['provider'], 'ready': False,
              'outcome': 'blocked', 'summary': '', 'recovery': False}
    found = discover(root, config['target'])
    if found['status'] != 'present':
        result['summary'] = found.get('reason', 'Verification skill is missing or ambiguous')
        return result
    # Publisher rejects aliases, so record the canonical path during installation.
    if found['paths'] != [config['target']]:
        result['summary'] = 'Configure the canonical project skill path before scheduling maintenance'
        return result
    import publisher
    repository = config['repository']
    try:
        settings = publisher._config(Path(root), config)
        branch = publisher.branch_name(config['target'])
        result['branch'] = branch
        prs = publisher._pulls(api, settings, branch, 'open')
        if prs:
            result.update(publisher._existing(branch, prs), summary=f'Existing maintenance PR: {prs[0]["html_url"]}')
            return result
        tip = publisher._ref_tip(api, f'/repos/{repository}', branch)
        publisher._current_base(api, settings, base)
        if tip is not None and not (
            publisher._is_ancestor(Path(root), tip, base)
            or publisher._merged_retained_head(Path(root), api, f'/repos/{repository}',
                                               settings['owner'], settings['repo'], branch,
                                               tip, settings['branch'], base)
        ):
            result.update(recovery=True, observed_tip=tip,
                          summary='Retained branch requires independent recovery inspection; analysis suppressed')
            return result
    except (ValueError, TypeError, OSError, KeyError, subprocess.CalledProcessError) as error:
        reason = str(error) if isinstance(error, ValueError) else type(error).__name__
        result['summary'] = f'Cannot classify maintenance branch: {reason}. Restore service or permissions and retry.'
        return result
    result.update(ready=True, outcome='clean', summary='Target resolved and maintenance branch is eligible for analysis')
    return result


def actions_result(result):
    """Expose only bounded single-line control values; render diagnostics as inert text."""
    patterns = {'outcome': r'clean|blocked|existing|prepared|published|manual',
                'ready': r'true|false', 'recovery': r'true|false',
                'base_sha': r'[0-9a-f]{40}', 'provider': r'claude|codex'}
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key, pattern in patterns.items():
                value = result.get(key)
                text = str(value).lower() if isinstance(value, bool) else str(value)
                if re.fullmatch(pattern, text):
                    output.write(f'{key}={text}\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write('### Verification maintenance\n\n')
            for key in ('outcome', 'summary', 'reason', 'branch', 'observed_tip', 'expected_tip',
                        'url', 'evidence_url', 'manual_guidance'):
                if key in result:
                    text = str(result[key]).encode('ascii', 'backslashreplace').decode()[:1000]
                    text = ''.join(max(c, ' ') for c in text)
                    summary.write(f'{key}: <code>{html.escape(text)}</code>\n\n')


def actions_id(name):
    from artifacts import positive_id
    value = os.environ.get(name, '')
    if not re.fullmatch(r'[1-9][0-9]{0,19}', value):
        raise ValueError(f'{name} must be a positive Actions ID or attempt')
    try:
        return positive_id(int(value))
    except ValueError:
        raise ValueError(f'{name} must be a positive Actions ID or attempt below 2**63') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('discover', 'install', 'prepare', 'bootstrap', 'prompt', 'bundle',
                 'prepare-publication', 'finalize-publication', 'recover'):
        command = sub.add_parser(name)
        command.add_argument('--root', type=Path, default=Path.cwd())
        if name != 'discover':
            command.add_argument('--config', type=Path, required=True)
        if name in ('prepare', 'prompt', 'bundle', 'prepare-publication'):
            command.add_argument('--output', type=Path, required=True)
        if name == 'discover':
            command.add_argument('--target')
            command.add_argument('--issues', type=Path, help='JSON list, or paginated list of lists of existing issues')
        if name == 'install':
            command.add_argument('--templates', type=Path, required=True)
            command.add_argument('--maintenance-skill', type=Path)
            command.add_argument('--write', action='store_true')
            command.add_argument('--replace', action='store_true')
        if name == 'bundle':
            command.add_argument('--report', type=Path, required=True)
            command.add_argument('--base-sha', required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == 'discover':
        result = discover(root, args.target)
        if args.issues:
            issues = load(args.issues)
            if issues and isinstance(issues[0], list):
                issues = [issue for page in issues for issue in page]
            result['gap'] = setup_gap(result, issues)
    else:
        config = load(args.config)
        if args.command == 'install':
            from installer import install
            result = install(root, config, args.templates, write=args.write, replace=args.replace,
                             maintenance_skill=args.maintenance_skill)
        elif args.command == 'prepare':
            result = prepare(root, config)
            save(args.output, result)
            if not result['ready']:
                save(root / '.verification-report.json', {
                    'outcome': 'blocked', 'summary': result['summary'], 'coverage': []})
        elif args.command == 'bootstrap':
            commands = config['bootstrap']
            if not isinstance(commands, list) or not all(isinstance(c, str) for c in commands):
                raise ValueError('bootstrap must be a list of project commands')
            for command in commands:
                subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', command], cwd=root, check=True)
            result = {'outcome': 'prepared'}
        elif args.command == 'prompt':
            template = args.config.parent / 'prompt.md'
            text = template.read_text().replace('%%TARGET%%', config['target'])
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(text)
            result = {'prompt': str(args.output)}
        elif args.command == 'bundle':
            from bundle import collect
            result = collect(root, config, load(args.report), args.base_sha)
            save(args.output, result)
        else:
            from artifacts import binary_downloader, validate_run
            from recovery import (
                _evidence_root,
                _manifest,
                _original,
                prepare_receipt,
                receipt_bytes,
                recover,
                seal_and_publish,
            )
            if args.command != 'recover':
                run_id, attempt = actions_id('GITHUB_RUN_ID'), actions_id('GITHUB_RUN_ATTEMPT')
            download = binary_downloader(os.environ.get('GH_TOKEN', ''),
                                         os.environ.get('GITHUB_API_URL', 'https://api.github.com'))
            if args.command == 'prepare-publication':
                bundle_id = actions_id('VERIFICATION_BUNDLE_ARTIFACT_ID')
                evidence_id = actions_id('VERIFICATION_EVIDENCE_ARTIFACT_ID')
                validate_run(api, config['repository'], run_id, attempt, config['integration_branch'])
                raw, bundle, evidence = _original(api, download, config, run_id, attempt, bundle_id, evidence_id)
                manifest = _manifest(bundle, evidence)
                # Decode both archives before staging only needed data outside the checkout.
                # The view shares trusted Git metadata, so the private upload witness survives.
                with _evidence_root(root, {item['path']: evidence[item['path']] for item in manifest}) as view:
                    bundle_path = view / '.verification-output/bundle.json'
                    bundle_path.parent.mkdir()
                    bundle_path.write_bytes(raw)
                    result = prepare_receipt(view, bundle_path, config, api, download, run_id, attempt,
                                             bundle_id, evidence_id)
                if result['outcome'] == 'prepared':
                    args.output.parent.mkdir(parents=True, exist_ok=True)
                    args.output.write_bytes(receipt_bytes(result))
            elif args.command == 'finalize-publication':
                result = seal_and_publish(root, config, api, download,
                                          actions_id('VERIFICATION_RECEIPT_ARTIFACT_ID'), run_id, attempt)
            else:
                result = recover(root, config, api, download)
    actions_result(result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError, TypeError) as error:
        reason = str(error) if isinstance(error, ValueError) else f'API or filesystem failure ({type(error).__name__})'
        actions_result({'outcome': 'blocked', 'reason': reason,
                        'manual_guidance': 'Inspect the failure and retained evidence. Restore service or permissions and retry; do not remove retained work to bypass validation.'})
        print(f'verification-maintenance: {reason}', file=sys.stderr)
        sys.exit(1)
