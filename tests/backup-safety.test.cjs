const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helperPath = path.resolve(__dirname, '../public/backup-safety.js');
const htmlPath = path.resolve(__dirname, '../public/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function loadSafety() {
  assert.ok(fs.existsSync(helperPath), 'backup-safety helper is included in the public app');
  return require(helperPath);
}

function createSaveHarness({ remote, local, confirmResult = false, failGuard = false }) {
  const calls = [];
  const failures = [];
  let confirmCalls = 0;
  const context = {
    window: { TradeDeskBackupSafety: loadSafety() },
    buildBackupData: () => local,
    getGHConfig: () => ({ token: 'fixture-user-token', user: 'claimloss-lab', repo: 'trade-desk' }),
    confirm: () => { confirmCalls++; return confirmResult; },
    markGHSaveFailed: message => failures.push(message),
    markGHSaveOk() {},
    showToast() {},
    AbortSignal,
    console,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} });
      if (failGuard) throw new Error('offline');
      if ((options.method || 'GET') === 'GET') return new Response(JSON.stringify(remote), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
  const start = html.indexOf('async function doGHSave(){');
  const end = html.indexOf('// ── Auto-save health', start);
  assert.ok(start >= 0 && end > start, 'doGHSave function source exists');
  vm.runInNewContext(html.slice(start, end), context);
  return { context, calls, failures, confirmCalls: () => confirmCalls, save: () => context.doGHSave() };
}

test('loads snapshot safety before main app and blocks stale same-portfolio data', async () => {
  const helperTag = html.indexOf('<script src="/backup-safety.js"></script>');
  const mainScript = html.indexOf('<script>', helperTag);
  assert.ok(helperTag >= 0 && mainScript > helperTag, 'safety helper loads before the main app script');

  const remote = {
    portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [{ ticker: 'TST80', qty: 100 }] }],
    transactions: [{ id: 101, portId: 'dr1', ticker: 'TST80', type: 'buy', qty: 100, price: 1 }],
  };
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] }], transactions: [] };
  const losses = loadSafety().findSnapshotLosses(remote, local);
  assert.equal(losses.invalidSnapshot, false);
  assert.equal(losses.missingHoldings.length, 1);
  const h = createSaveHarness({ remote, local, confirmResult: false });
  await h.save();

  assert.equal(h.calls.length, 1, 'only the safety GET is sent; no write request');
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.failures.length, 1);
});

test('accepts a recorded sell transaction that fully explains a holding reduction', () => {
  const buy = { id: 1, ticker: 'TST80', type: 'buy', date: '2026-09-01', qty: 100, price: 1, fee: 0, portId: 'dr1' };
  const sell = { id: 2, ticker: 'TST80', type: 'sell', date: '2026-09-02', qty: 40, price: 1, fee: 0, portId: 'dr1' };
  const remote = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [{ id: 7, ticker: 'TST80', qty: 100, buyPrice: 1 }] }], transactions: [buy] };
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [{ id: 7, ticker: 'TST80', qty: 60, buyPrice: 1 }] }], transactions: [buy, sell] };
  const result = loadSafety().findSnapshotLosses(remote, local);
  assert.equal(result.invalidSnapshot, false);
  assert.equal(result.missingHoldings.length, 0);
  assert.equal(result.missingTransactions.length, 0);
  assert.equal(result.hasLoss, false);
});

test('detects changed transaction fields when an existing transaction ID is reused', () => {
  const remote = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] }], transactions: [
    { id: 9, ticker: 'SHOP06', type: 'buy', date: '2026-09-28', qty: 4000, price: 2.4, fee: 0 },
  ] };
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] }], transactions: [
    { id: 9, ticker: 'SHOP06', type: 'buy', date: '2026-09-28', qty: 4000, price: 2.4, fee: 16.14 },
  ] };
  const result = loadSafety().findSnapshotLosses(remote, local);
  assert.equal(result.invalidSnapshot, false);
  assert.equal(result.changedTransactions?.length, 1);
  assert.equal(result.hasLoss, true);
});

test('NAV refresh autosaves updated price and date without confirmation', async () => {
  const remote = { portfolios: [{ id: 'fund1', type: 'manual', cash: 0, stocks: [{ id: 7, ticker: 'BGOLDRMF', qty: 10, buyPrice: 20, currentNav: 28, navDate: '2026-09-30' }] }], transactions: [] };
  const local = structuredClone(remote);
  local.portfolios[0].stocks[0].currentNav = 29;
  local.portfolios[0].stocks[0].navDate = '2026-10-01';
  assert.equal(loadSafety().findSnapshotLosses(remote, local).hasLoss, false);
  const h = createSaveHarness({ remote, local });
  await h.save();
  assert.equal(h.confirmCalls(), 0);
  assert.ok(h.calls.some(call => call.method !== 'GET'), 'updated NAV is saved');
  assert.equal(h.failures.length, 0);
});

test('NAV refresh does not bypass financial or unknown holding changes', () => {
  const remote = { portfolios: [{ id: 'fund1', type: 'manual', cash: 0, stocks: [{ id: 7, ticker: 'BGOLDRMF', qty: 10, buyPrice: 20, currentNav: 28, navDate: '2026-09-30' }] }], transactions: [] };
  for (const [field, value] of [['buyPrice', 21], ['qty', 9], ['id', 8], ['unexpectedField', 'changed']]) {
    const local = structuredClone(remote);
    Object.assign(local.portfolios[0].stocks[0], { currentNav: 29, navDate: '2026-10-01', [field]: value });
    assert.equal(loadSafety().findSnapshotLosses(remote, local).hasLoss, true, field + ' remains protected');
  }
});

test('detects cost-basis changes when a holding quantity is unchanged', () => {
  const remote = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [{ id: 7, ticker: 'TST80', qty: 10, buyPrice: 5 }] }], transactions: [] };
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [{ id: 7, ticker: 'TST80', qty: 10, buyPrice: 4 }] }], transactions: [] };
  const result = loadSafety().findSnapshotLosses(remote, local);
  assert.equal(result.invalidSnapshot, false);
  assert.equal(result.changedHoldings?.length, 1);
  assert.equal(result.hasLoss, true);
});

test('same-ID transaction edits require confirmation before autosave', async () => {
  const portfolio = { id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] };
  const remote = { portfolios: [portfolio], transactions: [{ id: 9, ticker: 'SHOP06', type: 'buy', date: '2026-09-28', qty: 4000, price: 2.4, fee: 0 }] };
  const local = { portfolios: [portfolio], transactions: [{ id: 9, ticker: 'SHOP06', type: 'buy', date: '2026-09-28', qty: 4000, price: 2.4, fee: 16.14 }] };
  const h = createSaveHarness({ remote, local, confirmResult: false });
  await h.save();
  assert.equal(h.confirmCalls(), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.failures.length, 1);
});

test('cost-basis edits require confirmation before autosave', async () => {
  const remote = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [{ id: 7, ticker: 'TST80', qty: 10, buyPrice: 5 }] }], transactions: [] };
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [{ id: 7, ticker: 'TST80', qty: 10, buyPrice: 4 }] }], transactions: [] };
  const h = createSaveHarness({ remote, local, confirmResult: false });
  await h.save();
  assert.equal(h.confirmCalls(), 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.failures.length, 1);
});

test('detects cash balance divergence even when holdings and trades are unchanged', () => {
  const safety = loadSafety();
  const remote = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 1000, stocks: [] }], transactions: [] };
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] }], transactions: [] };
  const losses = safety.findSnapshotLosses(remote, local);
  assert.equal(losses.hasLoss, true);
  assert.deepEqual(losses.cashChanges, [{ portfolioId: 'dr1', remoteCash: 1000, localCash: 0 }]);
});

test('cash divergence blocks autosave unless explicitly confirmed', async () => {
  const remote = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 1000, stocks: [] }], transactions: [] };
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] }], transactions: [] };
  const denied = createSaveHarness({ remote, local, confirmResult: false });
  await denied.save();
  assert.equal(denied.confirmCalls(), 1);
  assert.equal(denied.calls.length, 1, 'cancelling cash confirmation prevents POST');
  assert.equal(denied.failures.length, 1);

  const approved = createSaveHarness({ remote, local, confirmResult: true });
  await approved.save();
  assert.equal(approved.confirmCalls(), 1);
  assert.equal(approved.calls.length, 2, 'explicit confirmation allows the intended update');
});

test('treats malformed remote snapshots and rows as invalid and unsafe to overwrite', () => {
  const safety = loadSafety();
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] }], transactions: [] };
  const malformed = [
    { foo: 'not a portfolio backup' },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 20, stocks: [{}] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 20, stocks: [] }], transactions: [null] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 20, stocks: [{ ticker: 'META80', qty: null }] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 20, stocks: [{ ticker: 'META80', qty: '' }] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 20, stocks: [] }], transactions: [{ ticker: 'META80', type: 'buy', qty: 1, price: null }] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 20, stocks: [] }], transactions: [{ ticker: 'META80', type: 'buy', qty: 1, price: 1, fee: null }] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 20, stocks: [] }], transactions: [{ ticker: 'META80', type: 'buy', qty: 1, price: 1, fee: '' }] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: null, stocks: [] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: '', stocks: [] }], transactions: [] },
    { portfolios: [{ id: { value: 'dr1' }, cash: 20, stocks: [] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: { value: 'dr' }, cash: 20, stocks: [] }], transactions: [] },
    { portfolios: [
      { id: 12, type: 'realtime_dr', cash: 0, stocks: [{ id: 1, ticker: 'TST80', qty: 10, buyPrice: 1 }] },
      { id: '12', type: 'realtime_dr', cash: 0, stocks: [{ id: 1, ticker: 'TST80', qty: 10, buyPrice: 1 }] },
    ], transactions: [] },
    { portfolios: [
      { id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] },
      { id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] },
    ], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [] }], transactions: [
      { id: 2, ticker: 'TST80', type: 'buy', qty: 1, price: 1 },
      { id: 2, ticker: 'TST80', type: 'buy', qty: 1, price: 1 },
    ] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 0, stocks: [
      { id: 1, ticker: 'TST80', qty: 5, buyPrice: 1 },
      { id: 1, ticker: 'TST80', qty: 5, buyPrice: 1 },
    ] }], transactions: [] },
  ];
  for (const [index, remote] of malformed.entries()) {
    const losses = safety.findSnapshotLosses(remote, local);
    assert.equal(losses.invalidSnapshot, true, `malformed case ${index}`);
    assert.equal(losses.hasLoss, true);
  }
});

test('does not offer overwrite confirmation for malformed remote rows', async () => {
  const local = { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] }], transactions: [] };
  const malformed = [
    { broken: true },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [{}] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] }], transactions: [null] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [{ ticker: 'META80', qty: null }] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [{ ticker: 'META80', qty: '' }] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] }], transactions: [{ ticker: 'META80', type: 'buy', qty: 1, price: null }] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] }], transactions: [{ ticker: 'META80', type: 'buy', qty: 1, price: 1, fee: null }] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] }], transactions: [{ ticker: 'META80', type: 'buy', qty: 1, price: 1, fee: '' }] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: null, stocks: [] }], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: '', stocks: [] }], transactions: [] },
    { portfolios: [
      { id: 12, type: 'realtime_dr', cash: 5, stocks: [{ id: 1, ticker: 'TST80', qty: 10 }] },
      { id: '12', type: 'realtime_dr', cash: 5, stocks: [{ id: 1, ticker: 'TST80', qty: 10 }] },
    ], transactions: [] },
    { portfolios: [
      { id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] },
      { id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] },
    ], transactions: [] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [] }], transactions: [
      { id: 2, ticker: 'TST80', type: 'buy', qty: 1, price: 1 },
      { id: 2, ticker: 'TST80', type: 'buy', qty: 1, price: 1 },
    ] },
    { portfolios: [{ id: 'dr1', type: 'realtime_dr', cash: 5, stocks: [
      { id: 1, ticker: 'TST80', qty: 5, buyPrice: 1 },
      { id: 1, ticker: 'TST80', qty: 5, buyPrice: 1 },
    ] }], transactions: [] },
  ];
  for (const [index, remote] of malformed.entries()) {
    const h = createSaveHarness({ remote, local, confirmResult: true });
    await h.save();
    assert.equal(h.confirmCalls(), 0, `malformed case ${index} must not offer overwrite confirmation`);
    assert.equal(h.calls.length, 1, 'invalid snapshot must never POST');
    assert.equal(h.failures.length, 1);
  }
});

test('fails closed when the current remote backup cannot be checked', async () => {
  const remote = { portfolios: [{ id: 'dr1', stocks: [] }], transactions: [] };
  const h = createSaveHarness({ remote, local: remote, failGuard: true });
  await h.save();

  assert.equal(h.calls.length, 1, 'does not attempt POST after safety lookup fails');
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.failures.length, 1);
});

test('sends the configured GitHub authorization with the guarded save', async () => {
  const data = { portfolios: [{ id: 'dr1', type: 'realtime_dr', stocks: [] }], transactions: [] };
  const h = createSaveHarness({ remote: data, local: data });
  await h.save();

  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].method, 'POST');
  assert.equal(h.calls[1].headers.Authorization, 'Bearer fixture-user-token');
});

test('rejects imported backup markup before it can reach innerHTML renderers', () => {
  const safety = loadSafety();
  assert.equal(typeof safety.validateImportedBackup, 'function');
  const importStart = html.indexOf('function importBackup');
  const validationAt = html.indexOf('validateImportedBackup', importStart);
  const persistAt = html.indexOf("localStorage.setItem('td_ports'", importStart);
  assert.ok(importStart >= 0 && validationAt > importStart && persistAt > validationAt, 'validate before persisting imported data');
  const result = safety.validateImportedBackup({
    portfolios: [{ id: 'dr1', name: 'Portfolio', type: 'realtime_dr', color: '#0071e3', stocks: [] }],
    notes: [{ id: 1, text: '<img src=x onerror=alert(1)>' }],
  });
  assert.equal(result.ok, false);
});

test('allows valid imported punctuation and blocks unsafe portfolio identifiers', () => {
  const safety = loadSafety();
  assert.equal(typeof safety.validateImportedBackup, 'function');
  const valid = {
    portfolios: [{ id: 'dr1', name: "Tong's DR", type: 'realtime_dr', color: '#0071e3', stocks: [{ id: 1, ticker: 'K-GA-A(A)', underlying: "L'Oréal", qty: 4, buyPrice: 2.4 }] }],
    transactions: [], notes: [{ id: 1, text: 'buy below 3 < 4, not a tag' }],
  };
  assert.equal(safety.validateImportedBackup(valid).ok, true);
  const currentBackup = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/portfolio-data.json'), 'utf8'));
  assert.equal(safety.validateImportedBackup(currentBackup).ok, true, 'current portfolio backup remains importable');
  valid.portfolios[0].id = "x');alert(1);//";
  assert.equal(safety.validateImportedBackup(valid).ok, false);
});

test('escapes user-authored note content and restricts note links before HTML rendering', () => {
  const start = html.indexOf('function renderNotes(){');
  const end = html.indexOf('// DIVIDENDS', start);
  const source = html.slice(start, end);
  assert.match(source, /escHTML\(n\.text\)/);
  assert.match(source, /safeExternalHttpURL\(n\.link\)/);
  assert.doesNotMatch(source, /\$\{n\.text\}/);
});

test('renders remote news and model summaries only as escaped or text content', () => {
  const feedAt = html.indexOf('feed.innerHTML = flat.map');
  const feedEnd = html.indexOf("}).join('');", feedAt);
  const feedSource = html.slice(feedAt, feedEnd);
  assert.match(feedSource, /escHTML\(n\.title\)/);
  assert.match(feedSource, /safeExternalHttpURL\(n\.link\)/);

  const summaryAt = html.indexOf('async function summarizeNewsItems');
  const summaryEnd = html.indexOf('// MANUAL SUMMARIZE ALL NEWS', summaryAt);
  const summarySource = html.slice(summaryAt, summaryEnd);
  assert.match(summarySource, /el\.textContent\s*=/);
  assert.doesNotMatch(summarySource, /el\.innerHTML\s*=\s*newsSummaryCache/);

  const manualAt = html.indexOf('async function manualSummarizeAll');
  const manualEnd = html.indexOf('// ──────────────────────────────────────────────────────────', manualAt);
  const manualSource = html.slice(manualAt, manualEnd);
  assert.match(manualSource, /el\.textContent\s*=/);
  assert.doesNotMatch(manualSource, /el\.innerHTML\s*=.*summary/);
});

test('renders user-entered dividend notes as escaped text', () => {
  const start = html.indexOf('function renderDividends(){');
  const end = html.indexOf('function renderDivTickerSummary()', start);
  const source = html.slice(start, end);
  assert.match(source, /escHTML\(d\.note/);
  assert.match(source, /escHTML\(d\.date/);
  assert.doesNotMatch(source, /\$\{d\.note\}/);
});

test('escapes server error messages before inserting them as HTML', () => {
  const matches = [...html.matchAll(/\$\{data\.error\}/g)];
  assert.equal(matches.length, 0, 'raw API error text must not enter HTML templates');
  assert.match(html, /contentEl\.textContent = data\.analysis \|\| data\.error/);
  assert.match(html, /status\.textContent = '❌ ' \+ data\.error/);
});

test('escapes local watchlist ticker, note, and date fields before HTML rendering', () => {
  const start = html.indexOf('function renderWatchlist(){');
  const end = html.indexOf('// DCA CALCULATOR', start);
  const source = html.slice(start, end);
  assert.match(source, /escHTML\(w\.ticker\)/);
  assert.match(source, /escHTML\(w\.note\)/);
  assert.match(source, /escHTML\(w\.addedDate\)/);
  assert.match(source, /escHTML\(w\.doneDate\)/);
});
