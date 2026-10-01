const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/allocation.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

async function page(quotes) {
  const elements = Object.fromEntries(['live-status', 'live-market', 'live-cash', 'live-cash-floor', 'allocation-tbody'].map(id => [id, { textContent: '', innerHTML: '', style: {} }]));
  let responses = quotes;
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    Intl, Date, setInterval() {},
    async fetch(url) {
      if (url.startsWith('/portfolio-data.json')) return { ok: true, json: async () => ({ portfolios: [{ id: 'dr1', cash: 100, stocks: [
        { ticker: 'MSFT80', parentTicker: 'MSFT', qty: 10 },
        { ticker: 'NVDA80', parentTicker: 'NVDA', qty: 10 }
      ] }] }) };
      const quote = responses[new URL(url, 'https://example.test').searchParams.get('ticker')];
      if (quote instanceof Error) throw quote;
      return { ok: quote?.ok !== false, status: quote?.ok === false ? 503 : 200, json: async () => quote?.body ?? {} };
    }
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, async reload(next) { responses = next; await context.loadLiveAllocation(); } };
}
test('invalid or unsuccessful quotes cannot be counted as complete', async t => {
  for (const [name, quote] of Object.entries({
    negative: { body: { price: -1 } }, infinite: { body: { price: 'Infinity' } },
    zero: { body: { price: 0 } }, null: { body: { price: null } },
    invalid: { body: { price: 'bad' } }, boolean: { body: { price: true } },
    array: { body: { price: [20] } }, httpError: { ok: false, body: { price: 20 } },
    networkError: new Error('offline')
  })) await t.test(name, async () => {
    const { elements } = await page({ MSFT80: good.MSFT80, NVDA80: quote });
    assertUnavailable(elements);
  });
});

test('failed refresh clears previously complete valuation metrics and can recover', async () => {
  const view = await page(good);
  assert.match(view.elements['live-status'].textContent, /^LIVE/);
  assert.match(view.elements['allocation-tbody'].innerHTML, /33\.33%/);
  assert.match(view.elements['allocation-tbody'].innerHTML, /66\.67%/);
  await view.reload({ MSFT80: good.MSFT80 });
  assertUnavailable(view.elements);
  for (const id of ['live-market', 'live-cash', 'live-cash-floor']) assert.equal(view.elements[id].textContent, '—', id);
  await view.reload(good);
  assert.match(view.elements['live-status'].textContent, /^LIVE/);
  assert.match(view.elements['allocation-tbody'].innerHTML, /33\.33%/);
});

const good = { MSFT80: { body: { price: 10 } }, NVDA80: { body: { price: 20 } } };

function assertUnavailable(elements) {
  assert.doesNotMatch(elements['live-status'].textContent, /^LIVE/);
  assert.doesNotMatch(elements['allocation-tbody'].innerHTML, /OVERWEIGHT|UNDERWEIGHT|ON TARGET|100\.00%/);
}

test('one missing held quote cannot produce LIVE or normalized partial weights', async () => {
  const { elements } = await page({ MSFT80: good.MSFT80 });
  assertUnavailable(elements);
  assert.match(elements['live-status'].textContent, /NVDA80/);
});
