const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const backup = JSON.parse(fs.readFileSync(path.join(root, 'public/portfolio-data.json'), 'utf8'));
const start = html.indexOf('function buildNav()');
const end = html.indexOf('\nfunction buildPanels()', start);
const navSource = html.slice(start, end);

test('Research, Allocation, and PVD live in one compact tools menu, not the portfolio tab strip', () => {
  assert.match(navSource, /<details[^>]+id="nav-tools-menu"/);
  const menu = navSource.slice(navSource.indexOf('<details'), navSource.indexOf('</details>') + '</details>'.length);
  assert.match(menu, /showTab\('research'\)/);
  assert.match(menu, /href="allocation\.html"/);
  assert.match(menu, /href="pvd\.html"/);
  assert.doesNotMatch(navSource, /nav-tab[^\n]*Research/);
  assert.doesNotMatch(navSource, /nav-tab[^\n]*Allocation/);
  assert.doesNotMatch(navSource, /nav-tab[^\n]*PVD/);
  assert.match(html, /\.nav-scroll\s*\{[^}]*overflow-x:\s*auto/s);
});

test('buildNav renders research tools separately from scrollable portfolio tabs', () => {
  const nav = { innerHTML: '' };
  vm.runInNewContext(`${navSource}\nbuildNav();`, {
    document: { getElementById: () => nav },
    activeTab: 'research',
    portfolios: [{ id: 'dr1', name: 'SET DR', color: '#123456' }],
  });
  assert.match(nav.innerHTML, /<div class="nav-scroll">/);
  assert.match(nav.innerHTML, /<details class="nav-tools on" id="nav-tools-menu">/);
  assert.match(nav.innerHTML, /📚 Research/);
  assert.match(nav.innerHTML, /href="allocation\.html"/);
  assert.match(nav.innerHTML, /href="pvd\.html"/);
  assert.equal((nav.innerHTML.match(/class="nav-tab/g) || []).length, 2);
});

test('MRVL80, SHOP06, and META80 have sourced S/R levels, conversion, and update date', () => {
  const port = backup.portfolios.find(p => p.id === 'dr1');
  const conversionByTicker = new Map((backup.drConversions || []).map(x => [x.dr, x.conv]));
  for (const [ticker, conversion] of [['MRVL80', 1000], ['SHOP06', 2000], ['META80', 8000]]) {
    const stock = port.stocks.find(s => s.ticker === ticker);
    assert.ok(stock, `${ticker} exists in SET DR`);
    assert.equal(stock.conversion, conversion, `${ticker} conversion`);
    assert.equal(stock.conversion, conversionByTicker.get(ticker), `${ticker} matches the DR registry`);
    assert.ok(Number.isFinite(stock.srSupport) && stock.srSupport > 0, `${ticker} has positive support`);
    assert.ok(Number.isFinite(stock.srResist) && stock.srResist > stock.srSupport, `${ticker} has resistance above support`);
    assert.match(stock.srUpdated || '', /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('S/R cells disclose the last refresh date and clarify close-based levels', () => {
  assert.match(html, /s\.srUpdated/);
  assert.match(html, /<th title="[^"]*ราคาปิด[^"]*">🔻 แนวรับ/);
  assert.doesNotMatch(html, /all-time high\) แล้ว/);
});
