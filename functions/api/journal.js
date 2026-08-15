// ── /api/journal ─────────────────────────────────────────────────────
// POST { transactions: [...] }  (ส่ง array ที่ client โหลดจาก portfolio-data.json มาแล้ว)
// คำนวณสถิติเชิงปริมาณจากรายการปิดสถานะ (sell + realizedPnl) แล้วให้
// Claude Sonnet สรุปเป็นภาษาไทยว่ามี pattern อะไรบ้าง แพ้/ชนะเพราะอะไร
import { computeJournalStats } from '../_lib/journal-stats.js';

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
    const { transactions } = await context.request.json();
    if (!Array.isArray(transactions))
      return new Response(JSON.stringify({ error: 'transactions must be an array' }), { status: 400, headers: cors });

    const stats = computeJournalStats(transactions);

    if (!stats.totalClosedTrades) {
      return new Response(JSON.stringify({ stats, narrative: null, patterns: [] }), { headers: cors });
    }

    const prompt = `คุณคือที่ปรึกษาที่ช่วยนักลงทุนอ่าน pattern การเทรดของตัวเองจากสถิติที่คำนวณไว้แล้วด้านล่าง (ห้ามสมมติเหตุผลที่ไม่มีในข้อมูล ใช้เฉพาะตัวเลขที่ให้มา)

สถิติรวม:
- ปิดสถานะทั้งหมด ${stats.totalClosedTrades} ครั้ง, win rate ${stats.winRate}%
- avgWin ${stats.avgWin} บาท, avgLoss ${stats.avgLoss} บาท, profit factor ${stats.profitFactor}
- กำไรสุทธิรวม ${stats.totalRealizedPnl} บาท
- ถือครองเฉลี่ยฝั่งกำไร ${stats.avgHoldDaysWin ?? '-'} วัน, ฝั่งขาดทุน ${stats.avgHoldDaysLoss ?? '-'} วัน
- streak ปัจจุบัน: ${stats.currentStreak.type === 'win' ? 'ชนะ' : 'แพ้'}ติดกัน ${stats.currentStreak.count} ครั้ง (สูงสุดที่เคยมี: win streak ${stats.maxWinStreak}, loss streak ${stats.maxLossStreak})
- เทรดที่ดีที่สุด: ${stats.bestTrade.ticker} +${stats.bestTrade.pnl} บาท (${stats.bestTrade.date})
- เทรดที่แย่ที่สุด: ${stats.worstTrade.ticker} ${stats.worstTrade.pnl} บาท (${stats.worstTrade.date})

แยกตามหุ้น (เรียงจากขาดทุนสุดไปกำไรสุด):
${stats.byTicker.map(t => `- ${t.ticker}: ${t.trades} เทรด, win rate ${t.winRate}%, กำไร/ขาดทุนรวม ${t.totalPnl} บาท`).join('\n')}

แยกตามพอร์ต:
${stats.byPortfolio.map(p => `- ${p.portId}: ${p.trades} เทรด, win rate ${p.winRate}%, รวม ${p.totalPnl} บาท`).join('\n')}

แยกตามวันที่ปิดสถานะ:
${stats.byDayOfWeek.map(d => `- วัน${d.dow}: ${d.trades} เทรด, win rate ${d.winRate}%, รวม ${d.totalPnl} บาท`).join('\n')}

เขียนคำตอบเป็น JSON ก้อนเดียว ไม่มีข้อความอื่นนอก JSON:
{
  "narrative": "สรุปภาพรวม 3-5 ประโยค ภาษาไทย พูดตรงๆ ไม่ประดิษฐ์คำ",
  "patterns": [
    {"finding": "สิ่งที่สังเกตเห็นจากตัวเลข (อ้างอิงตัวเลขจริง)", "suggestion": "ข้อเสนอแนะเชิงปฏิบัติ 1 ประโยค"}
  ]
}
กฎ: patterns ไม่เกิน 4 ข้อ, เฉพาะ pattern ที่ตัวเลขสนับสนุนจริง (เช่น ถ้าไม่มีเทรดขาดทุนพอที่จะสรุป pattern การขาดทุนได้ ให้ข้าม), ห้าม disclaimer, ห้ามสมมติเหตุผลทางจิตวิทยาที่ไม่มีหลักฐานตัวเลข`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': context.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ stats, error: 'Claude error', detail: err }), { status: 502, headers: cors });
    }
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    function extractJson(t) {
      const end = t.lastIndexOf('}');
      if (end < 0) return null;
      let depth = 0;
      for (let i = end; i >= 0; i--) {
        if (t[i] === '}') depth++;
        else if (t[i] === '{') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(t.slice(i, end + 1)); } catch { /* keep scanning */ }
          }
        }
      }
      return null;
    }
    const parsed = extractJson(text) || { narrative: text.slice(0, 800), patterns: [] };

    return new Response(JSON.stringify({ stats, ...parsed }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
