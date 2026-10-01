const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const authSource = fs.readFileSync(path.join(root, 'functions/_lib/repo-auth.js'), 'utf8')
  .replace(/^export\s+async\s+function\s+requireRepoWriter/m, 'async function requireRepoWriter');
const protectedRoutes = [
  'analyze', 'rebalance-ai', 'research', 'summarize',
  'paper-trade', 'ma-watchlist', 'backup',
];

for (const route of protectedRoutes) {
  test(`/api/${route} rejects an anonymous mutation before side effects`, async () => {
    const file = path.join(root, `functions/api/${route}.js`);
    let source = fs.readFileSync(file, 'utf8');
    source = source.replace(/^import[^\n]*\n/gm, '');
    source = source.replace(/^export\s+async\s+function\s+onRequest/m, 'async function onRequest');
    const calls = [];
    const fakeFetch = async url => { calls.push(String(url)); return new Response('{}', { status: 200 }); };
    const onRequest = new Function('fetch', authSource + '\n' + source + '\nreturn onRequest;')(fakeFetch);
    const request = new Request(`https://trade-desk.pages.dev/api/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }),
    });
    const response = await onRequest({ request, env: {
      GITHUB_TOKEN: 'fixture-service-token', ANTHROPIC_API_KEY: 'fixture-service-token',
    } });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0, 'no GitHub/LLM side effect should occur');
  });
}
