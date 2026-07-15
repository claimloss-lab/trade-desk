export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (context.request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const { holdings, portName, universe } = await context.request.json();
    if (!holdings?.length) return new Response(JSON.stringify({ error: 'no holdings' }), { status: 400, headers: cors });

    // ── Fetch Yahoo 1y daily chart per holding, compute technicals ──
    const norm = s => (s || '').replace('.', '-').replace(/-BK$/, '.BK'); // BRK.B→BRK-B but keep .BK
    const tech = {};
    await Promise.all(holdings.map(async h => {
      const sym = norm(h.underlyingSymbol || h.ticker);
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return;
        const j = await r.json();
        const res = j.chart?.result?.[0];
        const closes = (res?.indicators?.quote?.[0]?.close || []).filter(x => x != null);
        if (closes.length < 60) return;
        const last = closes[closes.length - 1];
        const sma = n => closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null;
        const hi52 = Math.max(...closes), lo52 = Math.min(...closes);
        const support3m = Math.min(...closes.slice(-63)); // low ~3 เดือน
        tech[h.ticker] = {
          last: +last.toFixed(2),
          sma50: sma(50) ? +sma(50).toFixed(2) : null,
          sma200: sma(200) ? +sma(200).toFixed(2) : null,
          pctFrom52wHigh: +((last - hi52) / hi52 * 100).toFixed(1),
          pctAbove52wLow: +((last - lo52) / lo52 * 100).toFixed(1),
          support3m: +support3m.toFixed(2),
          pctAboveSupport: +((last - support3m) / support3m * 100).toFixed(1),
        };
      } catch { /* skip */ }
    }));

    const list = holdings.map(h => {
      const t = tech[h.ticker];
      let tstr = '';
      if (t) {
        tstr = ` | ราคา ${t.last} | SMA50 ${t.sma50 ?? '-'} | SMA200 ${t.sma200 ?? '-'}` +
               ` | ห่าง 52w-high ${t.pctFrom52wHigh}% | เหนือ 52w-low +${t.pctAbove52wLow}%` +
               ` | แนวรับ 3 เดือน ${t.support3m} (เหนือแนวรับ +${t.pctAboveSupport}%)`;
      }
      return `- ${h.ticker}${h.underlyingSymbol ? ' (' + h.underlyingSymbol + ')' : ''}: weight ${h.curWeight.toFixed(1)}% | P&L ${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(1)}%${tstr}`;
    }).join('\n');

    const uniq = {};
    (universe || []).forEach(u => { if (u.sym && !uniq[u.sym]) uniq[u.sym] = u.name || ''; });
    const heldSyms = new Set(holdings.map(h => h.underlyingSymbol || h.ticker));
    const uniList = Object.entries(uniq).filter(([s]) => !heldSyms.has(s))
      .map(([s, n]) => `${s}${n ? ' (' + n + ')' : ''}`).join(', ');

    const prompt = `คุณคือนักวางกลยุทธ์พอร์ตการลงทุน วิเคราะห์พอร์ต "${portName || 'พอร์ต'}" แบบ step-by-step
ข้อมูลเทคนิคัลด้านล่างคำนวณจากราคาจริง 1 ปีล่าสุด (Yahoo Finance)

Holdings:
${list}
${uniList ? `\nหุ้นอื่นที่ซื้อได้ในตลาดเดียวกัน (DR universe): ${uniList}\n` : ''}
ขั้นตอนการคิด:
1. จัดหุ้นแต่ละตัวเข้ากลุ่มอุตสาหกรรม
2. ดูความกระจุกตัว + ตัวที่ weight บวมจากการขึ้นแรง
3. กำหนด target weight รายตัว (หุ้นรายตัว ≤ ~15%, กลุ่มร้อนแรงมีเพดาน, กำไรมากแนะนำ trim บางส่วน)
4. อ่านเทคนิคัล: ตัวที่ถืออยู่ตัวไหนราคาใกล้แนวรับ/ต่ำกว่า SMA200/ย่อลึกจาก 52w-high = จังหวะสะสม, ตัวไหนวิ่งเหนือแนวรับมาก = ระวังไล่ราคา
5. ใช้ web search เช็คข่าว/กระแสล่าสุดของกลุ่มที่น่าสนใจ (ค้นได้ไม่เกิน 3 ครั้ง เลือกค้นเฉพาะที่สำคัญ)
6. ถ้ามี DR universe: เสนอไอเดียสลับตัว ขายตัวที่แพง/อ่อนแอ ไปเข้าตัวใน universe ที่พื้นฐานดีและราคาน่าสนใจกว่า (ไม่เกิน 3 ไอเดีย, "to" ต้องอยู่ใน universe เท่านั้น)

คำตอบสุดท้ายต้องเป็น JSON ก้อนเดียว ไม่มีข้อความอื่นนอก JSON:
{
  "summary": "ภาพรวม 2-4 ประโยค",
  "groups": [{"name":"...","tickers":["A"],"curPct":25.1,"targetPct":"15-20%","reason":"..."}],
  "stocks": [{"ticker":"ตรงกับ input เป๊ะ","group":"...","targetPct":8.5,"reason":"..."}],
  "opportunities": [{"ticker":"ตัวที่ถืออยู่","note":"เช่น ราคาใกล้แนวรับ 3 เดือน ย่อ -18% จาก high น่าทยอยสะสม"}],
  "switchIdeas": [{"from":"ตัวที่ถือ","to":"symbol จาก universe","toName":"ชื่อบริษัท","reason":"ทำไมถึงน่าสลับ"}],
  "cashNote": "คำแนะนำเงินสด (ถ้าจำเป็น)"
}

กฎ: stocks ครบทุกตัว, targetPct รวม = 100 พอดี, เหตุผลภาษาไทยสั้นกระชับ, ห้าม disclaimer`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': context.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Claude error', detail: err }), { status: 502, headers: cors });
    }

    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    let result = null;
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) result = JSON.parse(text.slice(start, end + 1));
    } catch { result = null; }

    if (!result || !result.stocks?.length) {
      return new Response(JSON.stringify({ error: 'parse failed', raw: text.slice(0, 500) }), { status: 502, headers: cors });
    }

    const sum = result.stocks.reduce((s, x) => s + (parseFloat(x.targetPct) || 0), 0);
    if (sum > 0 && Math.abs(sum - 100) > 0.5) {
      result.stocks.forEach(x => { x.targetPct = Math.round((parseFloat(x.targetPct) || 0) / sum * 1000) / 10; });
    }
    result.technicals = tech;

    return new Response(JSON.stringify(result), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
