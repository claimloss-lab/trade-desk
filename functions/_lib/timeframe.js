// ── Timeframe resampling ─────────────────────────────────────────────
// Aggregates daily OHLCV bars into weekly (ISO week) or monthly bars.
// Used by reversal-signal.js so the same detection logic (divergence,
// volume exhaustion, candle patterns) works across day/week/month.

function periodKey(dateStr, timeframe) {
  if (timeframe === 'day') return dateStr;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (timeframe === 'month') return dateStr.slice(0, 7); // YYYY-MM
  if (timeframe === 'week') {
    // ISO 8601 week number
    const tmp = new Date(d);
    const day = tmp.getUTCDay() || 7; // Mon=1..Sun=7
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
  throw new Error(`unknown timeframe: ${timeframe}`);
}

// data: { dates, opens, highs, lows, closes, volumes } (all same length, ascending by date)
export function resampleOHLCV(data, timeframe) {
  if (timeframe === 'day') return data;
  const { dates, opens, highs, lows, closes, volumes } = data;

  const groups = new Map(); // periodKey -> [indices...], Map preserves insertion order (chronological)
  for (let i = 0; i < dates.length; i++) {
    const key = periodKey(dates[i], timeframe);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }

  const out = { dates: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  for (const idxs of groups.values()) {
    out.dates.push(dates[idxs[idxs.length - 1]]); // period-end date
    out.opens.push(opens[idxs[0]]);
    out.highs.push(Math.max(...idxs.map(i => highs[i])));
    out.lows.push(Math.min(...idxs.map(i => lows[i])));
    out.closes.push(closes[idxs[idxs.length - 1]]);
    out.volumes.push(idxs.reduce((s, i) => s + volumes[i], 0));
  }
  return out;
}
