const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../functions/_lib/repo-auth.js');

test('shared repo-writer authorization rejects missing tokens before network calls', async () => {
  assert.ok(fs.existsSync(sourcePath), 'shared repo authorization helper exists');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const factory = new Function('fetch', source.replace(/^export\s+async\s+function\s+requireRepoWriter/m, 'async function requireRepoWriter') + '\nreturn requireRepoWriter;');
  let calls = 0;
  const authorize = factory(async () => { calls++; return new Response('{}'); });
  const result = await authorize(new Request('https://trade-desk.pages.dev/api/backup', { method: 'POST' }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
});

test('shared repo-writer authorization allows only verified push-capable accounts', async () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const factory = new Function('fetch', source.replace(/^export\s+async\s+function\s+requireRepoWriter/m, 'async function requireRepoWriter') + '\nreturn requireRepoWriter;');
  const calls = [];
  const authorize = factory(async url => {
    calls.push(String(url));
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ login: 'owner' }), { status: 200 });
    return new Response(JSON.stringify({ permissions: { push: true } }), { status: 200 });
  });
  const result = await authorize(new Request('https://trade-desk.pages.dev/api/backup', { method: 'POST', headers: { Authorization: 'Bearer test-token' } }));
  assert.equal(result.ok, true);
  assert.equal(result.login, 'owner');
  assert.equal(calls.length, 2);
});
