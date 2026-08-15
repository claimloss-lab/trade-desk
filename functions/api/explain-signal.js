// ── /api/explain-signal ──────────────────────────────────────────────
// POST { ticker, trendScoreResult }  (ผลลัพธ์จาก /api/trend-score ต่อหุ้นตัวเดียว)
// ให้ Claude Haiku อธิบายสั้นๆ ภาษาไทยว่าทำไม Trend Score ถึงออกมาแบบนี้
// เช่น "ทำไมรอบนี้ถึงเข้า Long" — ใช้ Haiku เพราะเป็น text สั้น ไม่ต้อง reasoning ลึก
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
    const { ticker, trendScoreResult } = await context.request.json();
    if (!ticker || !trendScoreResult)
      return new Response(JSON.stringify({ error: 'ticker และ trendScoreResult จำเป็น' }), { status: 400, headers: cors });

    const { score, label, price, detail } = trendScoreResult;
    if (score == null)
      return new Response(JSON.stringify({ error: 'ยังไม่มี trend score (ข้อมูลราคาไม่พอ)' }), { status: 400, headers: cors });

    const prompt = `หุ้น/สินทรัพย์ ${ticker} ราคาปัจจุบัน ${price}
Trend Score = ${score} (${label})

องค์ประกอบของคะแนน:
- EMA20=${detail.ema.e20 ?? '-'}, EMA50=${detail.ema.e50 ?? '-'}, EMA200=${detail.ema.e200 ?? '-'}
- RSI(14)=${detail.rsi.value ?? '-'} ${detail.rsi.overbought ? '(overbought)' : detail.rsi.oversold ? '(oversold)' : ''}
- Volume ratio เทียบเฉลี่ย 20 วัน = ${detail.volume.ratio ?? '-'}
- ATR(14) = ${detail.atr.value ?? '-'}

อธิบายเป็นภาษาไทย 2-3 ประโยค ตรงประเด็น ว่าทำไมคะแนนถึงออกมาเป็น "${label}" โดยอ้างอิงตัวเลขข้างต้นจริงๆ (เช่น ราคายืนเหนือ/ต่ำกว่า EMA ไหน, RSI อยู่โซนไหน, วอลุ่มยืนยันหรือไม่) ห้าม disclaimer ห้ามคำแนะนำการลงทุนทั่วไปที่ไม่เกี่ยวกับตัวเลขนี้`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': context.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Claude error', detail: err }), { status: 502, headers: cors });
    }
    const data = await res.json();
    const explanation = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    return new Response(JSON.stringify({ ticker, score, label, explanation }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
