#!/usr/bin/env python3
"""Publish the latest scheduled Discord post into Trade Desk cards."""
from __future__ import annotations
import argparse, base64, json, subprocess, sys, time, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = 'claimloss-lab/trade-desk'
FILE_PATH = 'public/discord-cards.json'
API_URL = f'https://api.github.com/repos/{REPO}/contents/{FILE_PATH}'
DEFAULT_CARDS = {
    'signals': {'content': '', 'updatedAt': None, 'discordUrl': 'https://discord.com/channels/1542575495021985835/1543408231395893248', 'sourceJob': None},
    'morningAiNews': {'content': '', 'updatedAt': None, 'discordUrl': 'https://discord.com/channels/1542575495021985835/1554669655115829258', 'sourceJob': None},
}
MAX_CONTENT_LENGTH = 100_000


def merge_card(current, kind, content, updated_at, source_job):
    if kind not in DEFAULT_CARDS:
        raise ValueError('unsupported card kind')
    if not isinstance(content, str) or not content.strip():
        raise ValueError('post content must not be empty')
    if len(content) > MAX_CONTENT_LENGTH:
        raise ValueError('post content exceeds the card limit')
    if not isinstance(current, dict):
        raise ValueError('existing cards data must be an object')
    merged = dict(current)
    previous = current.get(kind, {})
    if not isinstance(previous, dict):
        previous = {}
    card = dict(DEFAULT_CARDS[kind])
    card.update(previous)
    card.update({'content': content, 'updatedAt': updated_at, 'sourceJob': source_job})
    merged[kind] = card
    for required_kind in DEFAULT_CARDS:
        if required_kind not in merged:
            merged[required_kind] = dict(DEFAULT_CARDS[required_kind])
    return merged


def github_token_from_credential_manager():
    result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                            text=True, capture_output=True, timeout=15, check=False)
    if result.returncode != 0:
        raise RuntimeError('Git credential helper could not provide GitHub authorization')
    credentials = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    token = credentials.get('password', '').strip()
    if not token:
        raise RuntimeError('No GitHub authorization is available in the credential helper')
    return token


def api_json(method, token, body=None):
    headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
               'User-Agent': 'TradeDesk-Discord-Card-Sync', 'X-GitHub-Api-Version': '2022-11-28'}
    payload = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
    request_url = API_URL + ('?ref=main' if method == 'GET' else '')
    request = urllib.request.Request(request_url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        if error.code in (409, 422):
            return error.code, None
        raise RuntimeError(f'GitHub API request failed with HTTP {error.code}') from None
    except Exception as error:
        raise RuntimeError(f'GitHub API request failed: {type(error).__name__}') from None


def publish(kind, content, source_job, dry_run=False):
    token = github_token_from_credential_manager()
    for attempt in range(3):
        status, file_data = api_json('GET', token)
        if status != 200:
            raise RuntimeError(f'Could not read card file (HTTP {status})')
        try:
            existing = json.loads(base64.b64decode(file_data['content']).decode('utf-8'))
        except Exception:
            raise RuntimeError('Existing card file is not valid JSON') from None
        updated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
        merged = merge_card(existing, kind, content, updated_at, source_job)
        encoded = base64.b64encode(json.dumps(merged, ensure_ascii=False, indent=2).encode('utf-8')).decode('ascii')
        if dry_run:
            return {'kind': kind, 'characters': len(content), 'updatedAt': updated_at, 'would_write': True}
        payload = {'message': f'chore: update latest {kind} Discord card', 'content': encoded,
                   'sha': file_data['sha'], 'branch': 'main'}
        status, result = api_json('PUT', token, payload)
        if status == 201:
            return {'kind': kind, 'characters': len(content), 'updatedAt': updated_at,
                    'commit': result.get('commit', {}).get('sha', '')[:12]}
        if attempt < 2:
            time.sleep(attempt + 1)
    raise RuntimeError('Card file changed concurrently; retry on the next scheduled run')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', required=True, choices=tuple(DEFAULT_CARDS))
    parser.add_argument('--file', required=True, type=Path)
    parser.add_argument('--source-job', required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    content = args.file.read_text(encoding='utf-8')
    if content.strip() == '[SILENT]':
        print('No Discord post produced; card unchanged.')
        return 0
    result = publish(args.kind, content, args.source_job, args.dry_run)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'Discord card sync failed: {error}', file=sys.stderr)
        raise SystemExit(1)
