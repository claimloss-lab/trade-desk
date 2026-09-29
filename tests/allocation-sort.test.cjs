const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sortRows } = require('../public/allocation-sort.js');

const html = fs.readFileSync(path.join(__dirname, '../public/allocation.html'), 'utf8');
const row = (...values) => ({ cells: values.map(innerText => ({ innerText })) });
const firstColumn = rows => rows.map(r => r.cells[0].innerText);

test('every allocation column has a sort control', () => {
  const header = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] || '';
  const columns = [...header.matchAll(/data-sort-col="(\d+)"/g)].map(m => Number(m[1]));
  assert.deepEqual(columns, [0, 1, 2, 3, 4, 5, 6]);
  assert.match(html, /<script src="\/allocation-sort\.js"><\/script>/);
});

test('loads the sorter API in a browser-style global context', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/allocation-sort.js'), 'utf8');
  const browserContext = {};
  vm.runInNewContext(source, browserContext);
  assert.equal(typeof browserContext.AllocationSorting.sortRows, 'function');
});

test('sorts percentage columns numerically rather than lexicographically', () => {
  const rows = [row('A', '10.00%'), row('B', '2.00%'), row('C', '1.50%')];
  assert.deepEqual(firstColumn(sortRows(rows, 1, 'asc')), ['C', 'B', 'A']);
  assert.deepEqual(firstColumn(sortRows(rows, 1, 'desc')), ['A', 'B', 'C']);
});

test('sorts signed currency gaps numerically', () => {
  const rows = [row('A', '', '', '', '+฿300.00'), row('B', '', '', '', '-฿1,250.50'), row('C', '', '', '', '+฿20.00')];
  assert.deepEqual(firstColumn(sortRows(rows, 4, 'asc')), ['B', 'C', 'A']);
  assert.deepEqual(firstColumn(sortRows(rows, 4, 'desc')), ['A', 'C', 'B']);
});

test('sorts ticker and role columns as case-insensitive text', () => {
  const rows = [row('SHOP'), row('amzn'), row('MRVL')];
  assert.deepEqual(firstColumn(sortRows(rows, 0, 'asc')), ['amzn', 'MRVL', 'SHOP']);
  assert.deepEqual(firstColumn(sortRows(rows, 0, 'desc')), ['SHOP', 'MRVL', 'amzn']);
});

test('sorts status by its numeric deviation', () => {
  const rows = [row('A', '', '', '', '', '', 'OVERWEIGHT +10.00จุด'), row('B', '', '', '', '', '', 'UNDERWEIGHT -2.00จุด'), row('C', '', '', '', '', '', 'ON TARGET +0.25จุด')];
  assert.deepEqual(firstColumn(sortRows(rows, 6, 'asc')), ['B', 'C', 'A']);
});

test('keeps non-numeric values last in either direction', () => {
  const rows = [row('No data', '—'), row('Has 10', '10.00%'), row('Has 2', '2.00%')];
  assert.deepEqual(firstColumn(sortRows(rows, 1, 'asc')), ['Has 2', 'Has 10', 'No data']);
  assert.deepEqual(firstColumn(sortRows(rows, 1, 'desc')), ['Has 10', 'Has 2', 'No data']);
});

test('clicking a column header sorts ascending then toggles descending', () => {
  let rows = [row('SHOP', '10.00%', '', '', '', '', ''), row('AMZN', '2.00%', '', '', '', '', '')];
  const tbody = {
    querySelectorAll: () => rows.slice(),
    appendChild(item) { rows = rows.filter(existing => existing !== item); rows.push(item); },
  };
  const buttons = Array.from({ length: 7 }, (_, col) => {
    const header = { sort: 'none', setAttribute(name, value) { if (name === 'aria-sort') this.sort = value; } };
    const indicator = { textContent: '↕' };
    return { dataset: { sortCol: String(col) }, closest: () => header, querySelector: () => indicator, header, indicator };
  });
  const status = { style: {}, textContent: '' };
  const context = {
    AllocationSorting: { sortRows },
    document: {
      getElementById(id) { return id === 'allocation-tbody' ? tbody : status; },
      querySelectorAll() { return buttons; },
    },
    fetch: () => new Promise(() => {}),
    setInterval() {},
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline allocation script exists');
  vm.runInNewContext(script, context);

  context.sortAllocationTable(1);
  assert.deepEqual(firstColumn(rows), ['AMZN', 'SHOP']);
  assert.equal(buttons[1].header.sort, 'ascending');
  assert.equal(buttons[1].indicator.textContent, '↑');

  context.sortAllocationTable(1);
  assert.deepEqual(firstColumn(rows), ['SHOP', 'AMZN']);
  assert.equal(buttons[1].header.sort, 'descending');
  assert.equal(buttons[1].indicator.textContent, '↓');
});
