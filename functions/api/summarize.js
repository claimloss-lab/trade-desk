export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const { items, prompt } = await context.request.json();
    if (!items?.length) return new Response(JSON.stringify({ summaries: [] }), { headers: cors });

    let userContent;

    if (prompt) {
      // Custom prompt mode (Portfolio Commentary, DCA Advisor, SA Analysis)
      userContent = prompt;
    } else {
      // Default news summarize mode
      const newsList = items.map((n, i) =>
        `${i+1}. [${n.ticker}] ${n.title}${n.description ? ' — ' + n.description.slice(0, 120) : ''}`
      ).join('\n');

      userContent = `สรุปข่าวหุ้นต่อไปนี้เป็นภาษาไทย แต่ละข้อ 1 ประโยคสั้น กระชับ ตรงประเด็น
ตอบเป็น JSON array เท่านั้น ไม่มีข้อความอื่น: ["สรุปข้อ1","สรุปข้อ2",...]

ข่าว:
${newsList}`;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': context.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Claude error', detail: err }), { status: 502, headers: cors });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || '[]';

    if (prompt) {
      // Return as single summary for custom prompt
      return new Response(JSON.stringify({ summaries: [text] }), { headers: cors });
    }

    // Parse JSON array for news mode
    let summaries = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) summaries = JSON.parse(match[0]);
    } catch { summaries = []; }

    return new Response(JSON.stringify({ summaries }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
