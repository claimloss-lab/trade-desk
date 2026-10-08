const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compare } = require('../public/backup-diff.js');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

function backup() {
  return {
    portfolios: [{ id: 'dr1', name: 'SET DR', type: 'realtime_dr', cash: 100,
      stocks: [{ id: 1, ticker: 'META80', qty: 3244, buyPrice: 3.005, conversion: 8000, currentNav: 9, navDate: '2026-10-01' }]
    }],
    transactions: [{ id: 101, ticker: 'META80', portId: 'dr1', type: 'buy', qty: 3244, price: 3, fee: 16.35 }],
    notes: ['private text'], currency: 'THB',
  };
}

test('comparison identifies actual holding cost/metadata, cash, fee and supplementary differences', () => {
  const remote=backup(), local=structuredClone(remote);
  local.portfolios[0].cash = 200;
  local.portfolios[0].stocks[0].buyPrice = 3.01;
  delete local.portfolios[0].stocks[0].conversion;
  local.transactions[0].fee = 0;
  local.notes = ['another private note'];
  const original=structuredClone(local);
  const data=compare(remote, local);
  assert.ok(data.changes.some(c=>c.group==='หุ้น' && c.field==='buyPrice'));
  assert.ok(data.changes.some(c=>c.group==='หุ้น' && c.field==='conversion'));
  assert.ok(data.changes.some(c=>c.group==='พอร์ต' && c.field==='cash'));
  assert.ok(data.changes.some(c=>c.group==='ธุรกรรม' && c.field==='fee'));
  assert.ok(data.changes.some(c=>c.group==='ข้อมูลเสริม' && c.field==='notes' && c.github==='(ข้อมูลบน GitHub)'));
  assert.equal(data.counts.remoteTransactions,1);
  assert.deepEqual(local,original,'comparison must not mutate browser snapshot');
});

test('market NAV changes alone are ignored like the save guard', () => {
  const remote=backup(), local=structuredClone(remote);
  local.portfolios[0].stocks[0].currentNav=12;
  local.portfolios[0].stocks[0].navDate='2026-10-08';
  assert.equal(compare(remote,local).changes.length,0);
});

test('missing and new transactions and holdings are displayed, never silently merged', () => {
  const remote=backup(), local=structuredClone(remote);
  local.portfolios[0].stocks=[];
  local.transactions=[];
  const data=compare(remote,local);
  assert.ok(data.changes.some(c=>c.group==='หุ้น' && c.field==='สถานะ'));
  assert.ok(data.changes.some(c=>c.group==='ธุรกรรม' && c.field==='สถานะ'));
});

test('backup review UI remains explicitly read-only and old save guards remain present', () => {
  const helperAt=html.indexOf('<script src="/backup-diff.js"></script>');
  assert.ok(helperAt>0 && helperAt<html.indexOf('<script>',helperAt));
  const at=html.indexOf('async function openBackupCompare(){');
  assert.ok(at>0);
  const end=html.indexOf('function hideGHWarningBanner(',at);
  const source=html.slice(at,end);
  assert.match(source,/TradeDeskBackupSafety/);
  assert.match(source,/TradeDeskBackupDiff/);
  assert.match(source,/tradedesk-browser-before-reconcile\.json/);
  assert.match(source,/tradedesk-github-before-reconcile\.json/);
  assert.doesNotMatch(source, /method\s*:\s*['"]POST['"]|localStorage\.setItem\(|\.push\(/);
  assert.match(html,/if\(losses\.hasLoss\)\{/);
  assert.match(html,/compare\.addEventListener\('click',\(\)=>openBackupCompare\(\)\)/);
});
