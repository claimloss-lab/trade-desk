const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const safety = require('../public/backup-safety.js');
const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');

function harness(response, failure) {
  const el = { style: { display: 'none' }, dataset: {}, innerHTML: '', textContent: '' };
  const calls = [];
  const context = {
    window: { TradeDeskBackupSafety: safety },
    document: { getElementById: () => el },
    _lastTrendScan: { results: { TEST: { score: 1 } } },
    safeSignal: () => undefined,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (failure) throw failure;
      return { json: async () => response };
    },
  };
  const esc = html.match(/^const escHTML = .*;$/m);
  const start = html.indexOf('async function toggleExplain(');
  const end = html.indexOf('// ── Backtest', start);
  assert.ok(esc && start >= 0 && end > start, 'production renderer exists');
  vm.runInNewContext(esc[0] + '\n' + html.slice(start, end), context);
  return { el, calls, render: () => context.toggleExplain('TEST', 'TEST') };
}

test('explanation escapes API markup while preserving newline breaks and caching', async () => {
  const h = harness({ explanation: '<img src=x onerror="alert(1)">\nA & B <script>alert(2)</script>' });
  await h.render();
  assert.equal(h.el.innerHTML, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;<br>A &amp; B &lt;script&gt;alert(2)&lt;/script&gt;');
  assert.equal(h.el.dataset.loaded, '1');
  assert.equal(h.calls[0].url, '/api/explain-signal');
  await h.render();
  assert.equal(h.el.style.display, 'none');
  await h.render();
  assert.equal(h.el.style.display, 'block');
  assert.equal(h.calls.length, 1);
});

test('API error markup is escaped instead of inserted as HTML', async () => {
  const h = harness({ error: '<svg onload="alert(1)"> & failed' });
  await h.render();
  assert.equal(h.el.innerHTML, 'อธิบายไม่สำเร็จ: &lt;svg onload=&quot;alert(1)&quot;&gt; &amp; failed');
});

test('thrown error messages use textContent and leave failure retryable', async () => {
  const message = '<img src=x onerror="alert(1)">';
  const h = harness(null, new Error(message));
  await h.render();
  assert.equal(h.el.textContent, 'โหลดไม่สำเร็จ: ' + message);
  assert.ok(!h.el.innerHTML.includes(message));
  assert.equal(h.el.dataset.loaded, undefined);
  await h.render();
  await h.render();
  assert.equal(h.calls.length, 2);
});
