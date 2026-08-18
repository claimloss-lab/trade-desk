// ── /api/sell-zone ────────────────────────────────────────────────────
// POST { tickers: [...], range? (default '1y'), proximityPct?, overshootPct?, minRsi? }
// ตอบคำถาม "ตอนนี้หุ้นตัวนี้ขึ้นมาอยู่ในแนวต้านแล้ว ควรพิจารณาขาย/ทำกำไรไหม"
// mirror ของ /api/buy-zone แต่ฝั่งแนวต้าน
import { fetchDailyOHLCV } from '../_lib/market-data.js';
import { detectSellZone } from '../_lib/sellzone.js';

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
    const { tickers, range = '1y', proximityPct, overshootPct, minRsi } = await context.request.json();
    if (!tickers?.length)
      return new Response(JSON.stringify({ error: 'no tickers' }), { status: 400, headers: cors });
    if (tickers.length > 60)
      return new Response(JSON.stringify({ error: 'ส่งได้ไม่เกิน 60 tickers ต่อครั้ง' }), { status: 400, headers: cors });

    const results = {};
    await Promise.all(tickers.map(async raw => {
      const d = await fetchDailyOHLCV(raw, range);
      if (!d.ok) { results[raw] = { error: d.error }; return; }
      results[raw] = detectSellZone(d, { proximityPct, overshootPct, minRsi });
    }));

    const inZone = Object.entries(results).filter(([, r]) => r.inSellZone).map(([t]) => t);

    return new Response(JSON.stringify({
      scanned: tickers.length, inZoneCount: inZone.length, results,
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
