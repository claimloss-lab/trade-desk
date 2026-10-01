const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../functions/api/daily-summary.js');
const raw = fs.readFileSync(sourcePath, 'utf8');
const onRequestFactory = new Function('fetch', raw.replace(/^export\s+async\s+function\s+onRequest/m, 'async function onRequest') + '\nreturn onRequest;');

function request(auth) {
  return new Request('https://trade-desk.pages.dev/api/daily-summary', {
    method: 'GET', headers: auth ? { Authorization: auth } : {},
  });
}

test('daily summary fails closed if its shared secret is not configured', async () => {
  const calls = [];
  const onRequest = onRequestFactory(async url => { calls.push(String(url)); return new Response('{}', { status: 200 }); });
  const response = await onRequest({ request: request(null), env: { LINE_CHANNEL_ACCESS_TOKEN: 'server-token', LINE_USER_ID: 'server-user', GITHUB_TOKEN: 'service-token' } });
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0, 'must not read portfolio or send LINE when no secret is configured');
});

test('daily summary rejects requests without the configured secret', async () => {
  const calls = [];
  const onRequest = onRequestFactory(async url => { calls.push(String(url)); return new Response('{}', { status: 200 }); });
  const response = await onRequest({ request: request(null), env: { SUMMARY_SECRET: 'fixture-secret', LINE_CHANNEL_ACCESS_TOKEN: 'server-token', LINE_USER_ID: 'server-user', GITHUB_TOKEN: 'service-token' } });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('scheduled summary accepts the secret in Authorization and completes its side effects', async () => {
  const calls = [];
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET' });
    if (url.includes('/portfolio-data.json')) return new Response(JSON.stringify({ portfolios: [] }), { status: 200 });
    if (url.includes('/daily-snapshot.json')) return new Response(JSON.stringify({ netWorth: 0, prices: {} }), { status: 200 });
    if (url.includes('/api/price?')) return new Response(JSON.stringify({ price: 34 }), { status: 200 });
    if (url.includes('api.line.me/v2/bot/message/push')) return new Response('{}', { status: 200 });
    if (url.includes('api.github.com/repos/claimloss-lab/trade-desk/contents/')) {
      if (init.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 404 });
    }
    return new Response('{}', { status: 404 });
  };
  const onRequest = onRequestFactory(fakeFetch);
  const response = await onRequest({
    request: request('Bearer fixture-secret'),
    env: { SUMMARY_SECRET: 'fixture-secret', LINE_CHANNEL_ACCESS_TOKEN: 'server-line-token', LINE_USER_ID: 'server-user', GITHUB_TOKEN: 'service-token' },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.filter(x => x.url.includes('api.line.me/v2/bot/message/push')).length, 1);
});
