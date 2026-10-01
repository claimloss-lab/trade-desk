const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helperPath = path.resolve(__dirname, '../public/api-auth.js');

function makeWindow(token) {
  const calls = [];
  const win = {
    location: { origin: 'https://trade-desk.pages.dev', href: 'https://trade-desk.pages.dev/' },
    localStorage: { getItem: key => key === 'gh_token' ? (token || '') : null },
    fetch: async (input, init = {}) => {
      calls.push({ input: String(input), method: init.method || 'GET', headers: new Headers(init.headers) });
      return new Response('ok');
    },
  };
  return { win, calls };
}

function install(win) {
  assert.ok(fs.existsSync(helperPath), 'API auth helper exists');
  const source = fs.readFileSync(helperPath, 'utf8');
  vm.runInNewContext(source, { window: win, URL, Headers, Response });
}

test('adds GitHub authorization only to protected same-origin mutation routes', async () => {
  const { win, calls } = makeWindow('fixture-token');
  install(win);
  await win.fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await win.fetch('/api/backup', { method: 'GET' });
  await win.fetch('https://example.org/api/analyze', { method: 'POST' });

  assert.equal(calls[0].headers.get('Authorization'), 'Bearer fixture-token');
  assert.equal(calls[1].headers.has('Authorization'), false);
  assert.equal(calls[2].headers.has('Authorization'), false);
});

test('leaves protected requests unauthenticated when no GitHub token is configured', async () => {
  const { win, calls } = makeWindow('');
  install(win);
  await win.fetch('/api/paper-trade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(calls[0].headers.has('Authorization'), false);
});
