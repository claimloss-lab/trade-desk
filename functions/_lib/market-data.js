// ── Shared Yahoo Finance daily OHLCV fetcher ─────────────────────────
// Used by screener.js (and available for future refactor of
// trend-score.js / backtest.js which currently inline the same fetch).

export function normSymbol(s) {
  return (s || '').replace('.', '-').replace(/-BK$/, '.BK'); // BRK.B→BRK-B, keep .BK
}

export async function fetchDailyOHLCV(rawTicker, range = '1y') {
  const sym = normSymbol(rawTicker);
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${encodeURIComponent(range)}&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!r.ok) return { ok: false, error: 'fetch failed' };
    const j = await r.json();
    const res = j.chart?.result?.[0];
    const q = res?.indicators?.quote?.[0];
    if (!res || !q) return { ok: false, error: 'no data' };

    const rows = (res.timestamp || []).map((t, i) => ({
      date: t, open: q.open?.[i], close: q.close?.[i], high: q.high?.[i], low: q.low?.[i], volume: q.volume?.[i],
    })).filter(x => x.close != null && x.high != null && x.low != null && x.open != null);

    if (!rows.length) return { ok: false, error: 'empty series' };

    return {
      ok: true,
      opens: rows.map(x => x.open),
      closes: rows.map(x => x.close),
      highs: rows.map(x => x.high),
      lows: rows.map(x => x.low),
      volumes: rows.map(x => x.volume || 0),
      dates: rows.map(x => new Date(x.date * 1000).toISOString().slice(0, 10)),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
