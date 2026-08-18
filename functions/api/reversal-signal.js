// ── /api/reversal-signal ─────────────────────────────────────────────
// POST { tickers: [...], timeframe: 'day'|'week'|'month' (default 'day'), range? }
// หาสัญญาณว่าขาลงอาจกำลังจะจบ (ก่อน Trend Score จะพลิกบวกด้วยซ้ำ):
//   - Bullish RSI Divergence, Volume Exhaustion, Hammer, Bullish Engulfing
// ใช้ timeframe เดียวกับที่นักลงทุนดูจริง — day สำหรับจังหวะสั้น, week/month
// สำหรับดูจุดกลับตัวใหญ่ (ต้องดึงราคาย้อนหลังนานขึ้นเพื่อให้มีแท่ง week/month พอ)
import { fetchDailyOHLCV } from '../_lib/market-data.js';
import { resampleOHLCV } from '../_lib/timeframe.js';
import { detectReversalSignals } from '../_lib/reversal.js';

const DEFAULT_RANGE = { day: '1y', week: '3y', month: '10y' };

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
    const { tickers, timeframe = 'day', range } = await context.request.json();
    if (!tickers?.length)
      return new Response(JSON.stringify({ error: 'no tickers' }), { status: 400, headers: cors });
    if (!['day', 'week', 'month'].includes(timeframe))
      return new Response(JSON.stringify({ error: "timeframe ต้องเป็น 'day' | 'week' | 'month'" }), { status: 400, headers: cors });
    if (tickers.length > 60)
      return new Response(JSON.stringify({ error: 'ส่งได้ไม่เกิน 60 tickers ต่อครั้ง' }), { status: 400, headers: cors });

    const useRange = range || DEFAULT_RANGE[timeframe];
    const results = {};

    await Promise.all(tickers.map(async raw => {
      const d = await fetchDailyOHLCV(raw, useRange);
      if (!d.ok) { results[raw] = { error: d.error }; return; }

      const resampled = resampleOHLCV(d, timeframe);
      if (resampled.closes.length < 20) {
        results[raw] = { error: `ข้อมูลไม่พอสำหรับ timeframe=${timeframe} (มี ${resampled.closes.length} แท่ง ต้องการอย่างน้อย 20)` };
        return;
      }

      const signal = detectReversalSignals(resampled);
      results[raw] = { timeframe, lastDate: resampled.dates[resampled.dates.length - 1], ...signal };
    }));

    const withSignal = Object.entries(results).filter(([, r]) => r.hasSignal).map(([t]) => t);

    return new Response(JSON.stringify({
      timeframe, scanned: tickers.length, withSignal: withSignal.length,
      results,
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
