/**
 * /api/daily-summary  — Cloudflare Pages Function
 * เรียกจาก GitHub Actions cron ทุกวัน 08:00 ICT
 *
 * Env vars (Cloudflare Pages → Settings → Variables and secrets):
 *   GITHUB_TOKEN               — PAT สำหรับดึง portfolio-data.json
 *   LINE_CHANNEL_ACCESS_TOKEN  — Channel Access Token
 *   LINE_USER_ID               — User ID ผู้รับ
 *   CRON_SECRET                — secret ป้องกันคนอื่นเรียก
 */

const REPO      = 'claimloss-lab/trade-desk';
const FILE_PATH = 'public/portfolio-data.json';

function fm(n, dec = 2) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmSign(n) { return (n >= 0 ? '+' : '') + fm(n); }

async function fetchPrice(ticker, baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/price?ticker=${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.price || null;
  } catch { return null; }
}

async function sendLine(token, userId, message) {
  return fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: message }] }),
  });
}

export async function onRequest(context) {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const env  = context.env;
  const req  = context.request;

  // ── ดึงค่า env ──
  const TOKEN    = env.LINE_CHANNEL_ACCESS_TOKEN;
  const USER_ID  = env.LINE_USER_ID;
  const GH_TOKEN = env.GITHUB_TOKEN;

  if (!TOKEN || !USER_ID)  return new Response(JSON.stringify({ error: 'LINE env not set' }),   { status: 500, headers: cors });
  if (!GH_TOKEN)           return new Response(JSON.stringify({ error: 'GITHUB_TOKEN not set' }),{ status: 500, headers: cors });

  try {
    // ── โหลด portfolio-data.json จาก GitHub ──
    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
      { headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'TradeDesk' } }
    );
    if (!ghRes.ok) throw new Error('GitHub fetch failed: ' + ghRes.status);
    const ghData       = await ghRes.json();
    const portfolioData = JSON.parse(atob(ghData.content.replace(/\n/g, '')));
    const portfolios    = portfolioData.portfolios || [];

    // ── รวบรวม tickers ──
    const tickerSet = new Set();
    portfolios.forEach(p => (p.stocks || []).forEach(s => s.ticker && tickerSet.add(s.ticker)));

    // ── ดึงราคา parallel ──
    const baseUrl = new URL(req.url).origin;
    const priceMap = {};
    await Promise.all([...tickerSet].map(async t => {
      const p = await fetchPrice(t, baseUrl);
      if (p) priceMap[t] = p;
    }));

    // ── คำนวณ net worth และ per-stock pnl% ──
    let totalNetWorth = 0;
    const stockValues = [];
    portfolios.forEach(p => {
      (p.stocks || []).forEach(s => {
        const price = priceMap[s.ticker];
        if (!price || !s.qty) return;
        const value   = price * s.qty;
        const cost    = (s.buyPrice || 0) * s.qty;
        const pnl     = value - cost;
        const pnlPct  = cost > 0 ? (pnl / cost) * 100 : 0;
        totalNetWorth += value;
        stockValues.push({ ticker: s.ticker, portName: p.name || p.id, value, pnl, pnlPct, price });
      });
    });

    // ── หาหุ้นขึ้นมากสุด / ลงมากสุด ──
    const sorted    = [...stockValues].sort((a, b) => b.pnlPct - a.pnlPct);
    const topGainer = sorted[0]    || null;
    const topLoser  = sorted[sorted.length - 1] || null;

    // ── Format message ──
    const today = new Date().toLocaleDateString('th-TH', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok',
    });

    const lines = [
      `📋 TradeDesk Daily Summary`,
      today,
      `─────────────────────`,
      `💰 มูลค่าพอร์ตรวม`,
      `฿${fm(totalNetWorth)} บาท`,
      `─────────────────────`,
    ];
    if (topGainer) lines.push(`🟢 ขึ้นมากสุด: ${topGainer.ticker} +${fm(topGainer.pnlPct)}%`);
    if (topLoser && topLoser.ticker !== topGainer?.ticker)
      lines.push(`🔴 ลงมากสุด: ${topLoser.ticker} ${fm(topLoser.pnlPct)}%`);
    lines.push(`─────────────────────`, `trade-desk.pages.dev`);

    const message = lines.join('\n');

    // ── ส่ง LINE ──
    const lineRes = await sendLine(TOKEN, USER_ID, message);
    if (!lineRes.ok) {
      const err = await lineRes.text();
      throw new Error('LINE send failed: ' + err);
    }

    return new Response(JSON.stringify({ ok: true, totalNetWorth, stockCount: stockValues.length, message }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
