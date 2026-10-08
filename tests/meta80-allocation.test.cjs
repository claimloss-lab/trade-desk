const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/portfolio-data.json'), 'utf8'));
const dr1 = data.portfolios.find(p => p.id === 'dr1');
const meta = dr1.stocks.find(s => s.ticker === 'META80');
const trades = data.transactions.filter(t => t.ticker === 'META80' && t.type === 'buy' && t.date === '2026-09-29');
const allocation = fs.readFileSync(path.join(root, 'public/allocation.html'), 'utf8');
const researchIndex = fs.readFileSync(path.join(root, 'public/research/index.html'), 'utf8');
const metaResearch = fs.readFileSync(path.join(root, 'public/research/META.html'), 'utf8');

test('META80 transaction records the user-confirmed gross price and fees exactly', () => {
  assert.equal(meta.qty, 3244);
  assert.ok(Math.abs(meta.buyPrice - (9748.35 / 3244)) < 1e-9);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].price, 3.00);
  assert.equal(trades[0].fee, 16.35);
  assert.match(trades[0].note, /ยอดสุทธิ.*9,748\.35/);
  assert.ok(Math.abs((trades[0].price * trades[0].qty + trades[0].fee) - 9748.35) < 1e-9);
});

test('SHOP06 transaction includes the user-confirmed fee-adjusted cost basis', () => {
  const shop = dr1.stocks.find(s => s.ticker === 'SHOP06');
  const trades = data.transactions.filter(t => t.ticker === 'SHOP06' && t.type === 'buy' && t.date === '2026-09-28');
  assert.equal(shop.qty, 4000);
  assert.equal(shop.issuer, 'KKPS');
  assert.ok(Math.abs(shop.buyPrice - 2.404) < 1e-9);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].price, 2.40);
  assert.equal(trades[0].fee, 16.14);
  assert.ok(Math.abs(trades[0].price * trades[0].qty + trades[0].fee - 9616.14) < 1e-9);
});

test('restored backup counts match the actual holdings and transactions without stale net-worth metadata', () => {
  assert.equal(data.summary.totalStocks, data.portfolios.reduce((n, p) => n + p.stocks.length, 0));
  assert.equal(data.summary.totalTransactions, data.transactions.length);
  assert.equal(data.summary.totalStocks, 45);
  assert.equal(data.summary.totalTransactions, data.transactions.length);
  assert.ok(data.summary.totalNetWorth === null || (typeof data.summary.totalNetWorth === 'string' && data.summary.totalNetWorth.length > 0));
});

test('META target is 2% of the full SET-DR account and equity targets sum to 100%', () => {
  const match = allocation.match(/const ALLOC_TARGET\s*=\s*(\{[^;]+\});/);
  assert.ok(match, 'ALLOC_TARGET map exists');
  const targets = Function(`return (${match[1]})`)();
  assert.ok(Math.abs(targets.META * 0.95 - 2.0) < 0.005);
  assert.ok(Math.abs(Object.values(targets).reduce((a, b) => a + b, 0) - 100) < 0.00001);
  assert.match(allocation, /Target<br>\(บัญชี SET DR\)/);
});

test('META research is current and listed under Focus holdings', () => {
  const focus = researchIndex.split('id="grid-hold">')[1].split('</section>')[0];
  const all = researchIndex.split('id="grid-all">')[1].split('</section>')[0];
  assert.match(focus, /href="META\.html"/);
  assert.match(focus, /tag-hold/);
  assert.doesNotMatch(all, /href="META\.html"/);
  const publishedDate = metaResearch.match(/class="meta">[^<]*?(\d{4}-\d{2}-\d{2})/);
  assert.ok(publishedDate && publishedDate[1] >= '2026-09-29', 'research must not regress to an older revision');
  assert.match(metaResearch, /3,244 DR/);
});
