// ── /api/trend-score ─────────────────────────────────────────────────
// POST { tickers: ["AAPL","PTT.BK",...] }
// Fetches 1y daily OHLCV from Yahoo Finance per ticker, computes composite
// Trend Score (EMA+RSI+Volume+ATR) and pivot-based Support/Resistance.
import { trendScore, nearestSupportResistance } from '../_lib/technicals.js';

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST')
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const { tickers } = await context.request.json();
    if (!tickers?.length)
      return new Response(JSON.stringify({ error: 'no tickers' }), { status: 400, headers: cors });

    const norm = s => (s || '').replace('.', '-').replace(/-BK$/, '.BK'); // BRK.B→BRK-B, keep .BK
    const results = {};

    await Promise.all(tickers.map(async raw => {
      const sym = norm(raw);
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (!r.ok) { results[raw] = { error: 'fetch failed' }; return; }
        const j = await r.json();
        const res = j.chart?.result?.[0];
        const q = res?.indicators?.quote?.[0];
        if (!res || !q) { results[raw] = { error: 'no data' }; return; }

        const rows = (res.timestamp || []).map((t, i) => ({
          close: q.close?.[i], high: q.high?.[i], low: q.low?.[i], volume: q.volume?.[i],
        })).filter(x => x.close != null && x.high != null && x.low != null);

        if (rows.length < 60) { results[raw] = { error: 'insufficient history' }; return; }

        const closes = rows.map(x => x.close);
        const highs = rows.map(x => x.high);
        const lows = rows.map(x => x.low);
        const volumes = rows.map(x => x.volume || 0);

        const ts = trendScore({ closes, highs, lows, volumes });
        const sr = nearestSupportResistance(highs, lows, closes);

        results[raw] = {
          ...ts,
          support: +sr.support.toFixed(4),
          resistance: +sr.resistance.toFixed(4),
          allSupports: sr.allSupports,
          allResistances: sr.allResistances,
        };
      } catch (e) {
        results[raw] = { error: e.message };
      }
    }));

    return new Response(JSON.stringify({ results }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
