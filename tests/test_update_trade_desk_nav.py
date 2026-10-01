import copy
import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).parents[1] / 'scripts/update_trade_desk_nav.py'
spec = importlib.util.spec_from_file_location('nav_updater', PATH)
u = importlib.util.module_from_spec(spec) if PATH.exists() else None
if u:
    spec.loader.exec_module(u)

class NavTests(unittest.TestCase):
    def test_nav_only_merge_preserves_all_other_fields(self):
        self.assertIsNotNone(u, 'NAV updater implementation missing')
        original = {'portfolios': [{'id': 'dime', 'cash': 123, 'stocks': [
            {'ticker': 'K-GA-A(A)', 'qty': 4, 'currentNav': 1, 'navDate': '30 ก.ย. 69'},
            {'ticker': 'AAPL', 'qty': 2}, {'ticker': 'LHHOTEL.BK', 'qty': 8},
            {'ticker': 'AMZN80', 'qty': 3}, {'ticker': 'ESGSI', 'currentNav': 1}]}],
            'transactions': [{'qty': 3}], 'summary': {'value': 88}, 'backup': {'private': True}}
        before = copy.deepcopy(original)
        quotes = {ticker: {'nav': 2, 'date': '2026-10-01'} for ticker in
                  ['K-GA-A(A)', 'ESGSI', 'AAPL', 'LHHOTEL.BK', 'AMZN80']}
        merged, changes = u.merge_nav(original, quotes)
        expected = copy.deepcopy(before)
        for i in [0, 4]:
            expected['portfolios'][0]['stocks'][i].update(currentNav=2, navDate='2026-10-01')
        self.assertEqual(merged, expected)
        self.assertEqual(original, before)
        self.assertEqual(len(changes), 2)

    def test_invalid_stale_and_same_date_correction(self):
        original = {'portfolios': [{'stocks': [{'ticker': 'BGOLDRMF', 'currentNav': 28.2897, 'navDate': '30 ก.ย. 69'}]}]}
        for nav in [0, -1, float('inf'), float('nan'), True, None, '2']:
            merged, changes = u.merge_nav(original, {'BGOLDRMF': {'nav': nav, 'date': '2026-10-01'}})
            self.assertEqual(merged, original)
            self.assertEqual(changes, [])
        for bad_date in ['2026-02-30', 'garbage', None, '2026-09-29', '2999-01-01']:
            self.assertEqual(u.merge_nav(original, {'BGOLDRMF': {'nav': 28.541, 'date': bad_date}})[0], original)
        corrected, changes = u.merge_nav(original, {'BGOLDRMF': {'nav': 28.541, 'date': '2026-09-30'}})
        self.assertEqual(corrected['portfolios'][0]['stocks'][0]['currentNav'], 28.541)
        self.assertEqual(len(changes), 1)
        self.assertEqual(u.merge_nav(corrected, {'BGOLDRMF': {'nav': 28.541, 'date': '2026-09-30'}})[1], [])
        self.assertEqual(u.parse_date('11 พ.ค. 69').isoformat(), '2026-05-11')
        self.assertEqual(u.parse_date('30 ก.ย. 2569').isoformat(), '2026-09-30')
        original['portfolios'][0]['stocks'][0]['navDate'] = 'unknown'
        self.assertEqual(u.merge_nav(original, {'BGOLDRMF': {'nav': 28.541, 'date': '2026-10-01'}})[0], original)

    def test_sync_refetches_after_conflict_and_verifies_no_overwrite(self):
        self.assertTrue(hasattr(u, 'sync'), 'sync implementation missing')
        class Store:
            def __init__(self):
                self.data = {'portfolios': [{'cash': 1, 'stocks': [{'ticker': 'BGOLDRMF', 'currentNav': 1, 'navDate': '2026-09-29'}]}], 'transactions': []}
                self.version = 1
                self.writes = 0
            def read(self, ref='main'):
                return copy.deepcopy(self.data), str(self.version)
            def write(self, data, sha):
                self.writes += 1
                if self.writes == 1:
                    self.data['portfolios'][0]['cash'] = 99
                    self.data['transactions'].append({'id': 'concurrent'})
                    self.version += 1
                    return None
                self.assert_sha = sha
                self.data = copy.deepcopy(data)
                self.version += 1
                return 'commit123'
        store = Store()
        quotes = {'BGOLDRMF': {'nav': 28.541, 'date': '2026-09-30'}}
        result = u.sync(store, lambda tickers: (quotes, []))
        self.assertEqual(result['commit'], 'commit123')
        self.assertTrue(result['verified'])
        self.assertEqual(store.assert_sha, '2')
        self.assertEqual(store.data['portfolios'][0]['cash'], 99)
        self.assertEqual(store.data['transactions'], [{'id': 'concurrent'}])
        self.assertEqual(u.sync(store, lambda tickers: (quotes, []))['would_write'], False)
        self.assertEqual(store.writes, 2)
        store.data['portfolios'][0]['stocks'][0]['currentNav'] = 1
        self.assertTrue(u.sync(store, lambda tickers: (quotes, []), dry_run=True)['would_write'])
        self.assertEqual(store.writes, 2)

    def test_transport_and_github_roundtrip(self):
        self.assertTrue(hasattr(u, 'request_json'), 'HTTP implementation missing')
        import base64, json, threading
        from http.server import BaseHTTPRequestHandler, HTTPServer
        data = {'portfolios': [], 'transactions': [1]}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                payload = {'sha': 'sha1', 'content': base64.b64encode(json.dumps(data).encode()).decode()}
                self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(payload).encode())
            def do_PUT(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if payload['sha'] != 'sha1' or payload['branch'] != 'main':
                    self.send_response(409); self.end_headers(); return
                self.server.written = json.loads(base64.b64decode(payload['content']))
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"commit":{"sha":"commit1"}}')
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            store = u.GitHubStore('test-token')
            store.url = f'http://127.0.0.1:{server.server_port}/contents/data'
            actual, sha = store.read()
            self.assertEqual(actual, data)
            self.assertEqual(store.write(data, sha), 'commit1')
            self.assertEqual(server.written, data)
            self.assertIsNone(store.write(data, 'old-sha'))
        finally:
            server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__':
    unittest.main()
