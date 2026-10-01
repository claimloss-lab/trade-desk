const { test } = require('node:test');
const assert = require('node:assert/strict');

test('daily cron sends secret in Authorization and not the URL', async () => {
  const { sendSummary } = await import('../workers/trade-desk-daily-cron.mjs');
  const requests = [];
  const result = await sendSummary({ SUMMARY_SECRET: 'local-fixture-secret', fetch: async (url, options) => { requests.push({url:String(url), options}); return new Response('{"ok":true}', {status:200}); } });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.includes('key='), false);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer local-fixture-secret');
});
