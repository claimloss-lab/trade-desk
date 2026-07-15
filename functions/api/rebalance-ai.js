export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const { holdings, portName } = await context.request.json();
    if (!holdings?.length) return new Response(JSON.stringify({ error: 'no holdings' }), { status: 400, headers: cors });

    const list = holdings.map(h =>
      `- ${h.ticker}${h.underlying ? ' (' + h.underlying + ')' : ''}: มูลค่า ฿${Math.round(h.valueTHB).toLocaleString()} | weight ปัจจุบัน ${h.curWeight.toFixed(1)}% | P&L ${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(1)}%`
    ).join('\n');

    const prompt = `คุณคือนักวางกลยุทธ์พอร์ตการลงทุน วิเคราะห์พอร์ต "${portName || 'พอร์ต'}" ต่อไปนี้แบบ step-by-step:

${list}

ขั้นตอนการคิด:
1. จัดหุ้นแต่ละตัวเข้ากลุ่มอุตสาหกรรม (เช่น Core ETF, Mega-cap quality, AI/Semiconductor, Cybersecurity, High-growth software, Defensive/Healthcare, Financials ฯลฯ ตามความเหมาะสมของพอร์ตนี้จริงๆ)
2. ดูว่าตัวไหน/กลุ่มไหนขึ้นมาแรง (P&L สูง) จน weight บวมเกินไป และตัวไหน weight ต่ำเกินไป
3. กำหนด target weight รายตัว โดยยึดหลัก:
   - หุ้นรายตัวไม่ควรเกิน ~15% ของพอร์ต (ยกเว้น ETF กว้างๆ)
   - กลุ่มเดียวกันรวมกันไม่ควรกระจุกเกินไป (เช่น กลุ่มที่ร้อนแรงควรมีเพดาน)
   - ตัวที่กำไรมาก (>50-80%) แนะนำ trim บางส่วน ไม่ต้องขายหมด
   - รักษาการกระจายความเสี่ยงระหว่างกลุ่ม

ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON โครงสร้าง:
{
  "summary": "ภาพรวมพอร์ต 2-4 ประโยค ชี้จุดที่กระจุกตัว/เสี่ยง",
  "groups": [
    {"name": "ชื่อกลุ่ม", "tickers": ["A","B"], "curPct": 25.1, "targetPct": "15-20%", "reason": "เหตุผลสั้นๆ"}
  ],
  "stocks": [
    {"ticker": "ตรงกับ ticker ใน input เป๊ะๆ", "group": "ชื่อกลุ่ม", "targetPct": 8.5, "reason": "เหตุผลสั้นๆ เช่น กำไร +80% ควร trim"}
  ],
  "cashNote": "คำแนะนำเรื่องเงินสด เช่น ควรกันเงินสด 5-10% รอจังหวะ (ถ้าเห็นว่าจำเป็น)"
}

กฎสำคัญ:
- "stocks" ต้องครบทุกตัวใน input และ targetPct รายตัวรวมกันต้องเท่ากับ 100 พอดี
- targetPct เป็นตัวเลข (ทศนิยม 1 ตำแหน่ง)
- เหตุผลเป็นภาษาไทยสั้น กระชับ tech term อังกฤษปนได้
- ห้ามใส่ disclaimer`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': context.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Claude error', detail: err }), { status: 502, headers: cors });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || '{}';

    let result = null;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch { result = null; }

    if (!result || !result.stocks?.length) {
      return new Response(JSON.stringify({ error: 'parse failed', raw: text }), { status: 502, headers: cors });
    }

    // Normalize stock targets to exactly 100
    const sum = result.stocks.reduce((s, x) => s + (parseFloat(x.targetPct) || 0), 0);
    if (sum > 0 && Math.abs(sum - 100) > 0.5) {
      result.stocks.forEach(x => { x.targetPct = Math.round((parseFloat(x.targetPct) || 0) / sum * 1000) / 10; });
    }

    return new Response(JSON.stringify(result), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
