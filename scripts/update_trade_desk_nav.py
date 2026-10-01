#!/usr/bin/env python3
"""NAV-only updater; standard library, no LLM, no local portfolio reads."""
from __future__ import annotations
import copy
import re
import math
import argparse, base64, json, os, subprocess, sys
import urllib.request, urllib.error, urllib.parse
from datetime import date, datetime, timezone, timedelta

KNOWN_FUNDS = {'K-GA-A(A)', 'MEGAWORLD30-A', 'BGOLDRMF', 'RMFBINNOTECH', 'ESGSI', 'TLNDQINCOME-UH-X'}
THAI_MONTHS = dict(zip(['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'], range(1, 13)))

def parse_date(value):
    if not isinstance(value, str):
        raise ValueError('date must be a string')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return date.fromisoformat(value)
    match = re.fullmatch(r'(\d{1,2})\s+(\S+)\s+(\d{2}|\d{4})', value.strip())
    if match:
        day, month, year = match.groups()
        year = int(year)
        if year < 100:
            year += 2500
        return date(year - 543, THAI_MONTHS[month], int(day))
    raise ValueError('unsupported date')

def is_fund(ticker):
    # Match app classification, with explicit known funds and safety exclusions:
    # app regex misclassifies long Thai stock tickers and excludes ESGSI.
    return isinstance(ticker, str) and bool(ticker) and (ticker in KNOWN_FUNDS or (
        not ticker.endswith('.BK') and not re.fullmatch(r'[A-Z]{1,5}', ticker)
        and not re.fullmatch(r'[A-Z]+\d+', ticker)))

def merge_nav(current, quotes):
    merged = copy.deepcopy(current)
    changes = []
    for port in merged['portfolios']:
        for stock in port.get('stocks', []):
            ticker = stock.get('ticker')
            if not is_fund(ticker) or ticker not in quotes:
                continue
            quote = quotes[ticker]
            try:
                nav = quote['nav']
                if isinstance(nav, bool) or not isinstance(nav, (int, float)) or not math.isfinite(nav) or nav <= 0:
                    continue
                new_date = parse_date(quote['date'])
                if new_date > datetime.now(timezone(timedelta(hours=7))).date():
                    continue
                old_date = parse_date(stock['navDate']) if stock.get('navDate') else None
            except (ValueError, TypeError, KeyError, OverflowError):
                continue
            if old_date and (new_date < old_date or (new_date == old_date and nav == stock.get('currentNav'))):
                continue
            stock.update(currentNav=quote['nav'], navDate=new_date.isoformat())
            changes.append({'portfolio': port.get('id'), 'fund': ticker, 'nav': quote['nav'], 'date': new_date.isoformat()})
    return merged, changes


def sync(store, fetch_quotes, dry_run=False):
    quotes = {}
    failures = []
    for attempt in range(3):
        current, sha = store.read()
        tickers = sorted({s['ticker'] for p in current['portfolios'] for s in p.get('stocks', []) if is_fund(s.get('ticker'))})
        missing = [t for t in tickers if t not in quotes]
        if missing:
            fresh, errors = fetch_quotes(missing)
            quotes.update(fresh)
            failures.extend(errors)
        merged, changes = merge_nav(current, quotes)
        result = {'dry_run': dry_run, 'would_write': bool(changes), 'changes': changes,
                  'quotes': quotes, 'failures': failures, 'attempts': attempt + 1}
        if dry_run or not changes:
            return result
        commit = store.write(merged, sha)
        if commit is None:
            continue
        # Read immutable committed target as well as current main. Verify entire backup,
        # not just NAV, so preservation is a runtime invariant.
        committed, _ = store.read(ref=commit)
        if committed != merged:
            raise RuntimeError('Committed portfolio readback mismatch')
        latest, _ = store.read()
        if latest != merged:
            raise RuntimeError('Portfolio changed after NAV commit; manual inspection needed')
        result.update(commit=commit, verified=True)
        return result
    raise RuntimeError('Portfolio changed concurrently; exhausted three merge retries')


def request_json(url, method='GET', headers=None, body=None):
    request_headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Cache-Control': 'no-cache'}
    request_headers.update(headers or {})
    payload = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
        request_headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, headers=request_headers, data=payload, method=method)
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.status, json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        return status, None
    except Exception as error:
        raise RuntimeError(f'HTTP transport failed: {type(error).__name__}') from None


def github_token_from_credential_manager():
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never')
    result = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                            text=True, capture_output=True, timeout=15, check=False, env=env)
    credentials = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    token = credentials.get('password', '').strip()
    if result.returncode != 0 or not token:
        raise RuntimeError('Git credential helper did not provide GitHub authorization')
    return token


class GitHubStore:
    def __init__(self, token):
        self.url = 'https://api.github.com/repos/claimloss-lab/trade-desk/contents/public/portfolio-data.json'
        self.headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'}

    def read(self, ref='main'):
        status, response = request_json(self.url + '?ref=' + urllib.parse.quote(ref, safe=''), headers=self.headers)
        if status != 200:
            raise RuntimeError(f'GitHub portfolio read failed (HTTP {status})')
        current = json.loads(base64.b64decode(response['content']).decode('utf-8'))
        if not isinstance(current, dict) or not isinstance(current.get('portfolios'), list):
            raise RuntimeError('Unsupported portfolio backup schema')
        return current, response['sha']

    def write(self, data, sha):
        encoded = base64.b64encode(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')).decode('ascii')
        payload = {'message': 'chore: refresh mutual fund NAV only', 'content': encoded, 'sha': sha, 'branch': 'main'}
        status, response = request_json(self.url, 'PUT', self.headers, payload)
        if status in (409, 422):
            return None
        if status not in (200, 201):
            raise RuntimeError(f'GitHub portfolio write failed (HTTP {status})')
        return response['commit']['sha']


def fetch_quotes(tickers):
    quotes, failures = {}, []
    for ticker in tickers:
        # Explicitly verified Finnomena alias; never change portfolio ticker.
        query = {'RMFBINNOTECH': 'B-INNOTECHRMF'}.get(ticker, ticker)
        try:
            url = 'https://trade-desk.pages.dev/api/nav?fund=' + urllib.parse.quote(query, safe='')
            status, quote = request_json(url)
            if status != 200 or not isinstance(quote, dict):
                raise ValueError(f'HTTP {status}')
            if quote.get('fund') != query or quote.get('source') != 'finnomena':
                raise ValueError('source or fund identity mismatch')
            nav = quote.get('nav')
            if isinstance(nav, bool) or not isinstance(nav, (int, float)) or not math.isfinite(nav) or nav <= 0:
                raise ValueError('invalid NAV')
            nav_date = parse_date(quote.get('date'))
            if nav_date > datetime.now(timezone(timedelta(hours=7))).date():
                raise ValueError('future NAV date')
            quotes[ticker] = {'nav': nav, 'date': nav_date.isoformat(), 'source': 'finnomena', 'query': query}
        except Exception as error:
            failures.append({'fund': ticker, 'reason': str(error) if isinstance(error, (ValueError, RuntimeError)) else type(error).__name__})
    return quotes, failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Fetch and validate without writing GitHub')
    args = parser.parse_args()
    result = sync(GitHubStore(github_token_from_credential_manager()), fetch_quotes, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))
    # Empty source coverage is a broken run, not silent success.
    return 0 if result['quotes'] or not result['failures'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'NAV updater failed: {type(error).__name__}: {error}', file=sys.stderr)
        raise SystemExit(1)
