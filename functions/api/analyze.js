export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const { ticker, finData, extraContext } = await context.request.json();
    if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

    const systemPrompt = `คุณคือนักวิเคราะห์การลงทุนมืออาชีพที่มีความเชี่ยวชาญในหุ้นกลุ่ม Technology ทั่วโลก (Global Equity Analyst) คุณมีสไตล์การสรุปข้อมูลที่เฉียบคม เข้าใจง่าย ใช้ภาษากึ่งทางการที่สนุกเหมือนครูสอนการลงทุนที่คุยกับเพื่อนนักลงทุน โดยใช้โครงสร้างข้อมูลที่เน้น Insight มากกว่าแค่การรายงานตัวเลข แทนตัวเองว่า "ผม" และเรียกผู้ใช้ว่า "คุณต้อง" ตอบเป็นภาษาไทยเสมอ`;

    const userPrompt = `สรุปและวิเคราะห์หุ้น ${ticker} โดยใช้โครงสร้างนี้:

1. 🚀 ภาพรวมวันนี้ (จุดเปลี่ยนสำคัญ): ราคาล่าสุด, การเปลี่ยนแปลง (%), Market Cap, P/E, Dividend และ Narrative ที่ตลาดกำลังพูดถึง
2. 📉 ทำไมก่อนหน้านี้หุ้นถึงมีปัญหา (ถ้ามี): สรุปอดีตอันใกล้ว่าทำไมราคาถึงร่วงหรือตลาดกังวลเรื่องอะไร
3. 📈 สรุปงบการเงินล่าสุด (Financial Highlights): Revenue, Net Income, EPS เทียบ YoY พร้อม "🔥 จุดสำคัญ"
4. 🧠 Game Changer / Strategy: กลยุทธ์ที่ทำให้เหนือกว่าคู่แข่ง
5. 📦 Backlog / RPO / Future Revenue: รายได้ในอนาคตที่รอรับรู้
6. 🏗️ สถานะทางการเงินและการจัดการความเสี่ยง: CapEx, Margin, หนี้สิน
7. ⚠️ ความเสี่ยงที่ต้องจับตา: ประเด็นลบที่อาจเกิดขึ้น
8. 🪖 Catalyst (ตัวจุดชนวน): ปัจจัยบวกใหม่ๆ หรือข่าวสดๆ
9. 📊 Valuation: Fair Value (Conservative/Base/Bull case) และ Upside
10. 📈 Technical (ภาพกราฟ): แนวโน้ม, RSI, แนวรับ-แนวต้าน และ Target Price
11. 🧩 สรุปแบบตรงไปตรงมา: 2-3 บรรทัดว่าน่าสนใจเพราะอะไร

${finData ? `ข้อมูลงบการเงินที่มี:\n${JSON.stringify(finData, null, 2)}` : ''}
${extraContext ? `\nข้อมูลเพิ่มเติม:\n${extraContext}` : ''}

ใช้ Emoji ประกอบหัวข้อ ใช้ > สำหรับ Insight สำคัญ หากข้อมูลบางส่วนไม่มี ให้ใช้ความรู้ล่าสุดที่มีและระบุว่าเป็นการประมาณการ`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': context.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Claude error', detail: err }), { status: 502, headers: cors });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return new Response(JSON.stringify({ analysis: text }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
