const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../functions/api/backup.js');
const authPath = path.resolve(__dirname, '../functions/_lib/repo-auth.js');
const raw = fs.readFileSync(sourcePath, 'utf8').replace(/^import .*repo-auth\.js';\s*/m, '');
const authSource = fs.readFileSync(authPath, 'utf8').replace(/^export\s+async\s+function\s+requireRepoWriter/m, 'async function requireRepoWriter');
const compiled = new Function('fetch', authSource + '\n' + raw.replace(/^export\s+async\s+function\s+onRequest/m, 'async function onRequest') + '\nreturn onRequest;');

function request(auth, body = { portfolios: [{ id: 'dr1', stocks: [] }], transactions: [] }) {
  return new Request('https://trade-desk.pages.dev/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

test('unauthenticated POST cannot overwrite the shared GitHub backup', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return new Response(JSON.stringify({ sha: 'fixture-sha' }), { status: 200 });
  };
  const onRequest = compiled(fakeFetch);
  const response = await onRequest({ request: request(null), env: { GITHUB_TOKEN: 'fixture-only' } });

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0, 'reject before making any GitHub request');
});

test('a valid GitHub token without repository push permission cannot save', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ login: 'reader' }), { status: 200 });
    if (String(url).endsWith('/repos/claimloss-lab/trade-desk')) return new Response(JSON.stringify({ permissions: { push: false } }), { status: 200 });
    return new Response(JSON.stringify({ sha: 'should-not-read' }), { status: 200 });
  };
  const onRequest = compiled(fakeFetch);
  const response = await onRequest({ request: request('Bearer reader-token'), env: { GITHUB_TOKEN: 'fixture-only' } });

  assert.equal(response.status, 403);
  assert.equal(calls.length, 2, 'stop after permission check, before reading or writing the file');
});

test('an authenticated repository writer can save a valid backup', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', authorization: new Headers(init.headers).get('Authorization') });
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ login: 'writer' }), { status: 200 });
    if (String(url).endsWith('/repos/claimloss-lab/trade-desk')) return new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 });
    if (init.method === 'PUT') return new Response(JSON.stringify({ content: { sha: 'saved-sha' } }), { status: 200 });
    return new Response(JSON.stringify({ sha: 'current-sha' }), { status: 200 });
  };
  const onRequest = compiled(fakeFetch);
  const response = await onRequest({ request: request('Bearer writer-token'), env: { GITHUB_TOKEN: 'service-token' } });

  assert.equal(response.status, 200);
  assert.equal(calls.filter(x => x.method === 'PUT').length, 1);
  assert.equal(calls.find(x => x.url.endsWith('/user')).authorization, 'Bearer writer-token');
  assert.equal(calls.find(x => x.method === 'PUT').authorization, 'Bearer writer-token');
});

test('a verified writer can save even when the unrelated service token is not configured', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', authorization: new Headers(init.headers).get('Authorization') });
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ login: 'writer' }), { status: 200 });
    if (String(url).endsWith('/repos/claimloss-lab/trade-desk')) return new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 });
    if (init.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ sha: 'current-sha' }), { status: 200 });
  };
  const response = await compiled(fakeFetch)({ request: request('Bearer valid-writer-token'), env: {} });
  assert.equal(response.status, 200);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
  assert.equal(calls.find(c => c.method === 'PUT').authorization, 'Bearer valid-writer-token');
});

test('public backup reads can recover from an expired optional server secret', async () => {
  const calls = [];
  const snapshot = { portfolios: [{ id: 'dr1', stocks: [] }], transactions: [] };
  const fakeFetch = async (url, init = {}) => {
    const auth = new Headers(init.headers).get('Authorization');
    calls.push(auth);
    if (auth) return new Response('{}', { status: 401 });
    const content = Buffer.from(JSON.stringify(snapshot)).toString('base64');
    return new Response(JSON.stringify({ content }), { status: 200 });
  };
  const response = await compiled(fakeFetch)({
    request: new Request('https://trade-desk.pages.dev/api/backup'),
    env: { GITHUB_TOKEN: 'expired-service-token' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
  assert.deepEqual(calls, ['Bearer expired-service-token', null]);
});
