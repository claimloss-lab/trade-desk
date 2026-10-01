const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'workers/trade-desk-watchlist-alert.js'), 'utf8');
const apiAuthSource = fs.readFileSync(path.join(root, 'public/api-auth.js'), 'utf8');

test('unused daily brief and signal cards are removed from Overview and sidebar', () => {
  for (const id of [
    'ov-brief-btn', 'ov-trend-btn', 'rv-btn', 'bz-btn', 'sz-btn',
    'bt-run-btn', 'journal-btn', 'sb-brief', 'feat-brief',
  ]) assert.doesNotMatch(html, new RegExp(`id=[\"']${id}[\"']`), `${id} should be gone`);
  for (const fn of [
    'runBrief', 'runBriefOverview', 'runTrendScanner', 'runReversalScan',
    'runBuyZoneScan', 'runSellZoneScan', 'runBacktest', 'runJournalAnalysis',
  ]) assert.doesNotMatch(html, new RegExp(`function ${fn}\\s*\\(`), `${fn} should be gone`);
  assert.match(html, /id="sb-news"/); // The normal portfolio-news feed remains.
  assert.match(html, /id="pt-result"/); // Paper Trading is a separate retained feature.
});

test('retired signal and journal API endpoints are removed, shared services remain', () => {
  for (const file of [
    'backtest.js', 'buy-zone.js', 'explain-signal.js', 'journal.js',
    'reversal-signal.js', 'sell-zone.js', 'trend-score.js',
  ]) assert.equal(fs.existsSync(path.join(root, 'functions/api', file)), false, `${file} should be deleted`);
  for (const file of ['buyzone.js', 'journal-stats.js', 'reversal.js', 'sellzone.js', 'timeframe.js']) {
    assert.equal(fs.existsSync(path.join(root, 'functions/_lib', file)), false, `${file} should be deleted`);
  }
  assert.equal(fs.existsSync(path.join(root, 'functions/api/news.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'functions/api/price.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'functions/api/paper-trade.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'functions/api/screener.js')), true);
  assert.doesNotMatch(apiAuthSource, /\/api\/(?:backtest|buy-zone|explain-signal|journal|reversal-signal|sell-zone|trend-score)/);
});

test('retired scheduled signal alerts are no longer run by the watchlist worker', async () => {
  for (const name of ['checkTrendAlerts', 'checkReversalAlerts', 'checkBuyZoneAlerts', 'checkSellZoneAlerts']) {
    assert.doesNotMatch(workerSource, new RegExp(`function ${name}\\s*\\(`));
  }
  const worker = new Function(workerSource.replace('export default {', 'return {'))();
  for (const route of ['/trend-trigger', '/reversal-trigger', '/buyzone-trigger', '/sellzone-trigger']) {
    const response = await worker.fetch(new Request(`https://test.invalid${route}`), {}, {});
    assert.equal(response.status, 410, `${route} must clearly report retired`);
  }
});

test('Paper Trading mark-to-market uses the general price API, not Trend Score', async () => {
  const match = html.match(/async function loadPaperTrade\(\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'loadPaperTrade exists');
  const requested = [];
  let postedPrices;
  const ctx = {
    safeSignal: () => undefined,
    document: { getElementById: () => ({ textContent: '', innerHTML: '' }) },
    renderPaperTrade: () => {},
    fetch: async (url, options = {}) => {
      requested.push(String(url));
      if (url === '/api/paper-trade' && !options.method) return { json: async () => ({ positions: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }] }) };
      if (String(url).startsWith('/api/price?ticker=')) {
        const ticker = new URL(String(url), 'https://test.invalid').searchParams.get('ticker');
        return { ok: true, json: async () => ({ price: ticker === 'AAPL' ? 190 : 420 }) };
      }
      if (url === '/api/paper-trade' && options.method === 'POST') {
        postedPrices = JSON.parse(options.body).prices;
        return { json: async () => ({ cash: 0, positions: [] }) };
      }
      throw new Error(`Unexpected request ${url}`);
    },
  };
  await vm.runInNewContext(`(async () => { ${match[0]}; await loadPaperTrade(); })()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(postedPrices)), { AAPL: 190, MSFT: 420 });
  assert.ok(requested.some(url => String(url).startsWith('/api/price?ticker=')));
  assert.ok(!requested.some(url => String(url).includes('/api/trend-score')));
});
