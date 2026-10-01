const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../functions/api/line-message.js');
const raw = fs.readFileSync(sourcePath, 'utf8');
const onRequestFactory = new Function('fetch', raw.replace(/^export\s+async\s+function\s+onRequest/m, 'async function onRequest') + '\nreturn onRequest;');

test('does not use server LINE credentials for anonymous requests', async () => {
  const calls = [];
  const onRequest = onRequestFactory(async (url, init) => {
    calls.push({ url: String(url), auth: new Headers(init.headers).get('Authorization') });
    return new Response('{}', { status: 200 });
  });
  const request = new Request('https://trade-desk.pages.dev/api/line-message', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello' }),
  });
  const response = await onRequest({ request, env: { LINE_CHANNEL_ACCESS_TOKEN: 'server-token', LINE_USER_ID: 'server-user' } });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test('uses only the caller-supplied LINE credentials', async () => {
  const calls = [];
  const onRequest = onRequestFactory(async (url, init) => {
    calls.push({ url: String(url), auth: new Headers(init.headers).get('Authorization'), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  });
  const request = new Request('https://trade-desk.pages.dev/api/line-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Line-Token': 'caller-token', 'X-Line-Userid': 'caller-user' },
    body: JSON.stringify({ message: 'hello' }),
  });
  const response = await onRequest({ request, env: { LINE_CHANNEL_ACCESS_TOKEN: 'server-token', LINE_USER_ID: 'server-user' } });
  assert.equal(response.status, 200);
  assert.equal(calls[0].auth, 'Bearer caller-token');
  assert.equal(calls[0].body.to, 'caller-user');
});
