const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'workers/trade-desk-watchlist-alert.js'), 'utf8');
const apiAuthSource = fs.readFileSync(path.join(root, 'public/api-auth.js'), 'utf8');

test('unused daily brief and signal cards are removed from Overview and sidebar', () => {
  for (const id of [
    'ov-brief-btn', 'ov-trend-btn', 'rv-btn', 'bz-btn', 'sz-btn',
    'bt-run-btn', 'journal-btn', 'sb-brief', 'feat-brief', 'pt-sub', 'pt-result',
  ]) assert.doesNotMatch(html, new RegExp(`id=[\"']${id}[\"']`), `${id} should be gone`);
  for (const fn of [
    'runBrief', 'runBriefOverview', 'runTrendScanner', 'runReversalScan',
    'runBuyZoneScan', 'runSellZoneScan', 'runBacktest', 'runJournalAnalysis',
  ]) assert.doesNotMatch(html, new RegExp(`function ${fn}\\s*\\(`), `${fn} should be gone`);
  assert.match(html, /id="sb-news"/); // The normal portfolio-news feed remains.
  assert.doesNotMatch(html, /Paper Trading/);
});

test('retired signal and journal API endpoints are removed, shared services remain', () => {
  for (const file of [
    'backtest.js', 'buy-zone.js', 'explain-signal.js', 'journal.js',
    'reversal-signal.js', 'sell-zone.js', 'trend-score.js', 'paper-trade.js',
  ]) assert.equal(fs.existsSync(path.join(root, 'functions/api', file)), false, `${file} should be deleted`);
  for (const file of ['buyzone.js', 'journal-stats.js', 'reversal.js', 'sellzone.js', 'timeframe.js', 'paper-trading-logic.js']) {
    assert.equal(fs.existsSync(path.join(root, 'functions/_lib', file)), false, `${file} should be deleted`);
  }
  assert.equal(fs.existsSync(path.join(root, 'functions/api/news.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'functions/api/price.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'public/paper-trading.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'functions/api/screener.js')), true);
  assert.doesNotMatch(apiAuthSource, /\/api\/(?:backtest|buy-zone|explain-signal|journal|paper-trade|reversal-signal|sell-zone|trend-score)/);
});

test('removed Pages API endpoints return 410 instead of the SPA fallback', async () => {
  const file = path.join(root, 'functions/api/[[path]].js');
  assert.equal(fs.existsSync(file), true, 'API fallback route exists');
  const source = fs.readFileSync(file, 'utf8').replace(/^export\s+async\s+function\s+onRequest/m, 'async function onRequest');
  const onRequest = new Function(source + '\nreturn onRequest;')();
  for (const route of ['backtest', 'buy-zone', 'explain-signal', 'journal', 'paper-trade', 'reversal-signal', 'sell-zone', 'trend-score']) {
    const response = await onRequest({ request: new Request(`https://trade-desk.pages.dev/api/${route}`) });
    assert.equal(response.status, 410, `/api/${route} is retired`);
  }
  const unknown = await onRequest({ request: new Request('https://trade-desk.pages.dev/api/not-a-route') });
  assert.equal(unknown.status, 404);
});

test('former public Paper Trading state URL returns 410 without disclosing saved state', async () => {
  const file = path.join(root, 'functions/paper-trading.json.js');
  assert.equal(fs.existsSync(file), true, 'retired state route exists');
  const source = fs.readFileSync(file, 'utf8').replace(/^export\s+async\s+function\s+onRequest/m, 'async function onRequest');
  const onRequest = new Function(source + '\nreturn onRequest;')();
  const response = await onRequest({ request: new Request('https://trade-desk.pages.dev/paper-trading.json') });
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: 'Paper Trading state retired' });
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

test('Paper Trading UI, logic, API, and currently published state are removed', () => {
  for (const name of ['loadPaperTrade', 'renderPaperTrade', 'paperOpenPrompt', 'paperClosePrompt', 'paperResetPrompt', 'paperTradeAction']) {
    assert.doesNotMatch(html, new RegExp(`function ${name}\\s*\\(`));
  }
  assert.doesNotMatch(html, /\/api\/paper-trade|paper-trading\.json|pt-result/);
  assert.equal(fs.existsSync(path.join(root, 'functions/api/paper-trade.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'functions/_lib/paper-trading-logic.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'public/paper-trading.json')), false);
});
