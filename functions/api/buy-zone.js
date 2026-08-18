// ── /api/buy-zone ────────────────────────────────────────────────────
// POST { tickers: [...], range? (default '1y'), proximityPct?, undershootPct? }
// ตอบคำถาม "ตอนนี้หุ้นตัวนี้ลงมาอยู่ในแนวรับแล้ว ซื้อได้ไหม" — รวม S/R engine
// (แนวรับที่ยืนยันด้วย pivot จริง ไม่ใช่จุดต่ำสุดชั่วคราว) + หลักฐานว่ากำลังรับอยู่
// (RSI เริ่มดีดตัว / มี Reversal Signal / ไม่ได้ปิดที่จุดต่ำสุดของวัน)
import { fetchDailyOHLCV } from '../_lib/market-data.js';
import { detectBuyZone } from '../_lib/buyzone.js';

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
    const { tickers, range = '1y', proximityPct, undershootPct } = await context.request.json();
    if (!tickers?.length)
      return new Response(JSON.stringify({ error: 'no tickers' }), { status: 400, headers: cors });
    if (tickers.length > 60)
      return new Response(JSON.stringify({ error: 'ส่งได้ไม่เกิน 60 tickers ต่อครั้ง' }), { status: 400, headers: cors });

    const results = {};
    await Promise.all(tickers.map(async raw => {
      const d = await fetchDailyOHLCV(raw, range);
      if (!d.ok) { results[raw] = { error: d.error }; return; }
      results[raw] = detectBuyZone(d, { proximityPct, undershootPct });
    }));

    const inZone = Object.entries(results).filter(([, r]) => r.inBuyZone).map(([t]) => t);

    return new Response(JSON.stringify({
      scanned: tickers.length, inZoneCount: inZone.length, results,
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
