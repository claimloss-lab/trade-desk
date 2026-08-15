// ── /api/screener ─────────────────────────────────────────────────────
// POST { tickers: [...], range='1y', filters: {
//   minScore, maxScore, rsiMax, rsiMin, minVolumeRatio, labels: [...]
// } }
// คัดหุ้น/DR ตาม Trend Score + เงื่อนไขที่กำหนด จากรายการ ticker ที่ส่งมา
// (เช่น universe จาก drConversions หรือ watchlist ที่มีอยู่แล้วใน portfolio-data.json)
import { fetchDailyOHLCV } from '../_lib/market-data.js';
import { trendScore } from '../_lib/technicals.js';

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
    const { tickers, range = '1y', filters = {} } = await context.request.json();
    if (!tickers?.length)
      return new Response(JSON.stringify({ error: 'no tickers' }), { status: 400, headers: cors });
    if (tickers.length > 100)
      return new Response(JSON.stringify({ error: 'ส่งได้ไม่เกิน 100 tickers ต่อครั้ง' }), { status: 400, headers: cors });

    const {
      minScore = -100, maxScore = 100,
      rsiMin = 0, rsiMax = 100,
      minVolumeRatio = 0,
      labels = null, // e.g. ['Strong Buy', 'Buy']
    } = filters;

    const matches = [];
    const errors = [];

    await Promise.all(tickers.map(async raw => {
      const d = await fetchDailyOHLCV(raw, range);
      if (!d.ok) { errors.push({ ticker: raw, error: d.error }); return; }
      if (d.closes.length < 60) { errors.push({ ticker: raw, error: 'insufficient history' }); return; }

      const ts = trendScore(d);
      if (ts.score == null) { errors.push({ ticker: raw, error: 'score unavailable' }); return; }

      const rsi = ts.detail.rsi.value;
      const volRatio = ts.detail.volume.ratio;

      const passScore = ts.score >= minScore && ts.score <= maxScore;
      const passRsi = rsi == null || (rsi >= rsiMin && rsi <= rsiMax);
      const passVol = volRatio == null || volRatio >= minVolumeRatio;
      const passLabel = !labels || labels.includes(ts.label);

      if (passScore && passRsi && passVol && passLabel) {
        matches.push({ ticker: raw, ...ts });
      }
    }));

    matches.sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({
      scanned: tickers.length,
      matched: matches.length,
      filters: { minScore, maxScore, rsiMin, rsiMax, minVolumeRatio, labels },
      results: matches,
      errors,
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
