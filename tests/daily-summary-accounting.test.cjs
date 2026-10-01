const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../functions/api/daily-summary.js');
const raw = fs.readFileSync(sourcePath, 'utf8');
const onRequestFactory = new Function('fetch', raw.replace(/^export\s+async\s+function\s+onRequest/m, 'async function onRequest') + '\nreturn onRequest;');

const portfolioData = {
  portfolios: [
    { id: 'dr1', type: 'realtime_dr', cash: 100, stocks: [{ ticker: 'TST80', qty: 10, buyPrice: 10 }] },
    { id: 'dime1', type: 'dime_mixed', cash: 50, stocks: [
      { ticker: 'FUND', qty: 10, buyPrice: 10, currentNav: 11, currency: 'THB' },
      { ticker: 'USX', qty: 2, buyPrice: 20, currency: 'USD' },
    ] },
    { id: 'snap1', type: 'snapshot', cash: 25, stocks: [], snapshots: [{ date: '2026-09-29', value: 500 }] },
  ],
};

function decodeGithubContent(content) {
  return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

test('daily summary matches dashboard net worth: cash, mixed USD holdings, and snapshot portfolios', async () => {
  const calls = [];
  const prices = { TST80: 12, USX: 25, 'USDTHB=X': 35 };
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url.includes('/portfolio-data.json')) return new Response(JSON.stringify(portfolioData), { status: 200 });
    if (url.includes('/daily-snapshot.json')) return new Response(JSON.stringify({ netWorth: 0, fx: 35, prices: { TST80: 11, USX: 24 } }), { status: 200 });
    if (url.includes('/api/price?')) {
      const ticker = new URL(url).searchParams.get('ticker');
      return new Response(JSON.stringify({ price: prices[ticker] }), { status: 200 });
    }
    if (url.includes('api.line.me/v2/bot/message/push')) return new Response('{}', { status: 200 });
    if (url.includes('api.github.com/repos/claimloss-lab/trade-desk/contents/')) {
      if (init.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 404 });
    }
    return new Response('{}', { status: 404 });
  };
  const onRequest = onRequestFactory(fakeFetch);
  const request = new Request('https://trade-desk.pages.dev/api/daily-summary', {
    headers: { Authorization: 'Bearer fixture-secret' },
  });
  const response = await onRequest({ request, env: {
    SUMMARY_SECRET: 'fixture-secret', LINE_CHANNEL_ACCESS_TOKEN: 'fixture-line-token',
    LINE_USER_ID: 'fixture-user', GITHUB_TOKEN: 'fixture-github-token',
  } });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.totalNetWorth, 2655);
  const historyWrite = calls.find(x => x.method === 'PUT' && x.url.includes('portfolio-history.json'));
  assert.ok(historyWrite, 'equity history was written');
  const historyPayload = JSON.parse(historyWrite.body);
  const history = decodeGithubContent(historyPayload.content);
  assert.deepEqual(history[0].byPortfolio, { dr1: 220, dime1: 1910, snap1: 525 });
});
