const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function loadSync() {
  const helper = html.match(/^function syncNavMetadata\([\s\S]*?^}/m);
  assert.ok(helper, 'NAV metadata sync helper exists');
  return vm.runInNewContext(`${helper[0]}\nsyncNavMetadata;`);
}

test('newer Thai NAV metadata updates only matched holdings and preserves user data', () => {
  const sync = loadSync();
  const local = [{ id: 'funds', cash: 123, transactions: [{ qty: 9 }], pvd: { value: 88 }, stocks: [
    { id: 1, ticker: 'RMFBINNOTECH', qty: 12, buyPrice: 30, currentNav: 34, navDate: '11 พ.ค. 69', srSupport: 20 },
    { id: 2, ticker: 'KEEP', qty: 3, buyPrice: 2 },
  ] }];
  const remote = [{ id: 'funds', cash: 0, transactions: [], pvd: {}, stocks: [
    { id: 1, ticker: 'RMFBINNOTECH', qty: 999, buyPrice: 99, currentNav: 35, navDate: '30 ก.ย. 69', srSupport: 99 },
    { id: 3, ticker: 'NEW', currentNav: 9, navDate: '2026-10-01' },
  ] }];
  const expected = structuredClone(local);
  expected[0].stocks[0].currentNav = 35;
  expected[0].stocks[0].navDate = '30 ก.ย. 69';
  const remoteBefore = structuredClone(remote);
  assert.equal(sync(local, remote), true);
  assert.deepEqual(local, expected);
  assert.deepEqual(remote, remoteBefore);
  assert.equal(sync(local, remote), false, 'same date is idempotent');
});

test('ISO NAV dates compare with Thai Buddhist dates without downgrading', () => {
  const sync = loadSync();
  for (const [localDate, remoteDate, updates] of [
    ['30 ก.ย. 69', '2026-10-01', true],
    ['2026-10-02', '2026-10-01', false],
    ['2 ต.ค. 2569', '2026-10-01', false],
    ['2026-10-02', '30 ก.ย. 69', false],
    [undefined, '2026-10-01', true],
  ]) {
    const local = [{ id: 'funds', stocks: [{ ticker: 'FUND', currentNav: 10, navDate: localDate }] }];
    const remote = [{ id: 'funds', stocks: [{ ticker: 'FUND', currentNav: 11, navDate: remoteDate }] }];
    assert.equal(sync(local, remote), updates, `${localDate} -> ${remoteDate}`);
    assert.equal(local[0].stocks[0].currentNav, updates ? 11 : 10);
    assert.equal(local[0].stocks[0].navDate, updates ? remoteDate : localDate);
  }
});

test('same-day price corrections apply without needless writes for equivalent dates', () => {
  const sync = loadSync();
  const local = [{ id: 'funds', stocks: [{ ticker: 'BGOLDRMF', currentNav: 28.2897, navDate: '30 ก.ย. 69' }] }];
  const remote = [{ id: 'funds', stocks: [{ ticker: 'BGOLDRMF', currentNav: 28.541, navDate: '2026-09-30' }] }];
  assert.equal(sync(local, remote), true);
  assert.equal(local[0].stocks[0].currentNav, 28.541);
  assert.equal(local[0].stocks[0].navDate, '2026-09-30');
  remote[0].stocks[0].navDate = '30 ก.ย. 69';
  assert.equal(sync(local, remote), false);
});

test('invalid NAV values and calendar dates are ignored', () => {
  const sync = loadSync();
  for (const currentNav of [NaN, Infinity, -Infinity, 0, -1, null, undefined, '12.3']) {
    const local = [{ id: 'f', stocks: [{ ticker: 'F', currentNav: 10 }] }];
    assert.equal(sync(local, [{ id: 'f', stocks: [{ ticker: 'F', currentNav, navDate: '2026-10-01' }] }]), false);
    assert.equal(local[0].stocks[0].currentNav, 10);
  }
  for (const navDate of [null, '', 'garbage', '2026-02-30', '2026-13-01', '2026-00-01', '2026-10-00', '31 ก.ย. 69', '29 ก.พ. 69', '1 bogus 69']) {
    const local = [{ id: 'f', stocks: [{ ticker: 'F', currentNav: 10 }] }];
    assert.equal(sync(local, [{ id: 'f', stocks: [{ ticker: 'F', currentNav: 12, navDate }] }]), false, String(navDate));
    assert.equal(local[0].stocks[0].currentNav, 10);
  }
});

test('matching requires portfolio id and ticker, with stock id checked when both available', () => {
  const sync = loadSync();
  const stock = { id: 1, ticker: 'F', currentNav: 10, navDate: '2026-09-30' };
  for (const [portId, source] of [
    ['other', { ...stock, currentNav: 12 }],
    ['f', { ...stock, id: 2, currentNav: 12 }],
    ['f', { ...stock, ticker: 'OTHER', currentNav: 12 }],
  ]) {
    const local = [{ id: 'f', stocks: [{ ...stock }] }];
    assert.equal(sync(local, [{ id: portId, stocks: [source] }]), false);
    assert.deepEqual(local[0].stocks[0], stock);
  }
  const local = [{ id: 'f', stocks: [{ ...stock }] }];
  assert.equal(sync(local, [{ id: 'f', stocks: [{ ticker: 'F', currentNav: 12, navDate: '2026-10-01' }] }]), true);
});

test('malformed records cannot match missing portfolio ids or tickers', () => {
  const sync = loadSync();
  assert.equal(sync(null, []), false);
  assert.equal(sync([], {}), false);
  assert.equal(sync([{}], [{}]), false);
  assert.equal(sync([{ stocks: [{ ticker: 'F' }] }], [{ stocks: [{ ticker: 'F', currentNav: 12, navDate: '2026-10-01' }] }]), false);
  assert.equal(sync([{ id: 'f', stocks: [{}] }], [{ id: 'f', stocks: [{ currentNav: 12, navDate: '2026-10-01' }] }]), false);
  assert.equal(sync([null, { id: 'f', stocks: [null] }], [null, { id: 'f', stocks: [null] }]), false);
});

test('boot merges NAV from the existing live backup read before rendering without autosave', async () => {
  const helper = html.match(/^function syncNavMetadata\([\s\S]*?^}/m)?.[0];
  const srHelper = html.match(/^function syncSrMetadata\([\s\S]*?^}/m)?.[0];
  const bootSource = html.match(/^async function boot\([\s\S]*?^}/m)?.[0];
  assert.ok(bootSource);
  const local = [{ id: 'f', cash: 123, stocks: [{ id: 1, ticker: 'F', qty: 2, buyPrice: 3, currentNav: 10, navDate: '11 พ.ค. 69' }] }];
  const remote = [{ id: 'f', cash: 0, stocks: [{ id: 1, ticker: 'F', qty: 99, buyPrice: 99, currentNav: 12, navDate: '2026-10-01' }] }];
  const writes = [], reads = [], events = [];
  const storage = new Map([['gh_user', 'user'], ['td_tx', 'original'], ['td_pvd', 'private']]);
  const context = {
    portfolios: local, currency: 'THB', window: {}, console,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => { storage.set(k, v); writes.push(k); events.push(`write:${k}`); } },
    fetch: async (url, options) => { reads.push([url, options]); return { ok: true, json: async () => ({ portfolios: remote, transactions: [], pvd: {} }) }; },
    setTimeout() {}, setInterval() {},
    renderOverview() { events.push('render'); }, renderAll() { events.push('render'); },
    savePorts() { assert.fail('boot metadata sync must not autosave'); },
    saveFeatures() { assert.fail('boot metadata sync must not autosave'); },
    scheduleGHSave() { assert.fail('boot metadata sync must not autosave'); },
  };
  for (const name of ['initPin', 'setCur', 'updateGHBadge', 'updateLineBadge', 'migrateUSPortPrices', 'buildNav', 'buildPanels', 'loadDiscordCards', 'refreshAll', 'checkGHHealthOnLoad', 'checkDailyRefresh']) context[name] = () => {};
  await vm.runInNewContext(`${helper}\n${srHelper}\n${bootSource}\nboot();`, context);
  assert.deepEqual(reads.map(([url]) => url), ['/api/backup']);
  assert.equal(reads[0][1].cache, 'no-cache');
  assert.deepEqual(writes, ['td_ports']);
  assert.equal(local[0].stocks[0].currentNav, 12);
  assert.equal(local[0].cash, 123);
  assert.equal(local[0].stocks[0].qty, 2);
  assert.equal(local[0].stocks[0].buyPrice, 3);
  assert.deepEqual(JSON.parse(storage.get('td_ports')), local);
  assert.equal(storage.get('td_tx'), 'original');
  assert.equal(storage.get('td_pvd'), 'private');
  assert.ok(events.indexOf('write:td_ports') < events.indexOf('render'));
  writes.length = 0;
  await vm.runInNewContext(`${helper}\n${srHelper}\n${bootSource}\nboot();`, context);
  assert.deepEqual(writes, [], 'unchanged NAV causes no persistence write');
});
