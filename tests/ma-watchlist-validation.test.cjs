const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const routePath = path.join(root, 'functions/api/ma-watchlist.js');
const authPath = path.join(root, 'functions/_lib/repo-auth.js');

function compileRoute(fetchImpl) {
  const auth = fs.readFileSync(authPath, 'utf8').replace(/^export\s+async\s+function\s+/m, 'async function ');
  const route = fs.readFileSync(routePath, 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export\s+async\s+function\s+/m, 'async function ');
  return new Function('fetch', `${auth}\n${route}\nreturn onRequest;`)(fetchImpl);
}

test('rejects unsafe MA watchlist tickers before reading or writing GitHub', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ login: 'owner' }), { status: 200 });
    if (String(url).endsWith('/repos/claimloss-lab/trade-desk')) return new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 });
    if ((init.method || 'GET') === 'GET') return new Response('', { status: 404 });
    return new Response('{}', { status: 200 });
  };
  const onRequest = compileRoute(fetchImpl);
  const request = new Request('https://trade-desk.pages.dev/api/ma-watchlist', {
    method: 'POST',
    headers: { Authorization: 'Bearer fixture-user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker: '<img src=x onerror=alert(1)>' }),
  });
  const response = await onRequest({ request, env: { GITHUB_TOKEN: 'fixture-service-token' } });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 2, 'only GitHub identity and repository permission checks should run');
  assert.equal(calls.some(c => c.url.includes('/contents/')), false);
});
