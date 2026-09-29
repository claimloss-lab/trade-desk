(function attachAllocationSorting(root) {
  const numericColumns = new Set([1, 2, 3, 4, 6]);

  function numericValue(text) {
    const normalized = String(text ?? '')
      .replace(/[฿$]/g, '')
      .replace(/[−–]/g, '-')
      .trim();
    const match = normalized.match(/[+-]?\s*[\d,]+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0].replace(/[\s,]/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function valueFor(text, column) {
    const normalized = String(text ?? '').trim();
    if (!normalized || normalized === '—' || normalized === '-') return null;
    if (numericColumns.has(column)) return numericValue(normalized);
    return normalized.toLocaleLowerCase('th-TH');
  }

  function sortRows(rows, column, direction = 'asc') {
    const multiplier = direction === 'desc' ? -1 : 1;
    return Array.from(rows).sort((left, right) => {
      const a = valueFor(left.cells[column]?.innerText, column);
      const b = valueFor(right.cells[column]?.innerText, column);
      if (a === null) return b === null ? 0 : 1;
      if (b === null) return -1;
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? (a < b ? -1 : a > b ? 1 : 0)
        : a.localeCompare(b, 'th-TH', { numeric: true, sensitivity: 'base' });
      return comparison * multiplier;
    });
  }

  const api = { sortRows };
  root.AllocationSorting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
