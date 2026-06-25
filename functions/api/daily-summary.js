/**
 * /api/daily-summary — Cloudflare Pages Function
 * GitHub Actions เรียกทุกวัน 08:00 ICT
 *
 * Snapshot เก็บแยกใน public/daily-snapshot.json (ไม่แตะ portfolio-data.json
 * เพื่อเลี่ยง race condition กับ auto-save ของ app)
 *
 * Env (Cloudflare Pages → Variables and secrets):
 *   LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID  — บังคับ
 *   GITHUB_TOKEN                              — ต้องมี scope repo + valid
 *                                               (ใช้เขียน snapshot กลับ; ถ้าไม่มี
 *                                                day-over-day ของพอร์ตจะไม่ทำงาน)
 */

const REPO          = 'claimloss-lab/trade-desk';
const DATA_PATH     = 'public/portfolio-data.json';
const SNAPSHOT_PATH = 'public/daily-snapshot.json';

// ── Formatters ────────────────────────────────────────────────────────────────
function fm(n, dec = 2) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmSign(n, dec = 2) {
  return (n >= 0 ? '+' : '-') + fm(Math.abs(n), dec);
}
function arrow(n) { return n > 0 ? '▲' : n < 0 ? '▼' : '─'; }
function dot(n)   { return n >= 0 ? '🟢' : '🔴'; }

// ── Fetch price via /api/price ────────────────────────────────────────────────
async function fetchPrice(ticker, baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/price?ticker=${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return (typeof d.price === 'number' && d.price > 0) ? d.price : null;
  } catch { return null; }
}

// ── Send LINE text message ────────────────────────────────────────────────────
async function sendLine(token, userId, text) {
  return fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
  });
}

// ── Read snapshot file (raw, public) ──────────────────────────────────────────
async function readSnapshot() {
  try {
    const r = await fetch(
      `https://raw.githubusercontent.com/${REPO}/main/${SNAPSHOT_PATH}?t=${Date.now()}`,
      { headers: { 'Cache-Control': 'no-cache' } }
    );
    if (!r.ok) return null;       // ยังไม่มีไฟล์ (วันแรก)
    return await r.json();
  } catch { return null; }
}

// ── Write snapshot file via GitHub API ────────────────────────────────────────
// คืน true ถ้าเขียนสำเร็จ
async function writeSnapshot(ghToken, snapshot) {
  if (!ghToken) return false;
  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${SNAPSHOT_PATH}`;
  const ghHeaders = {
    Authorization: `token ${ghToken}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'TradeDesk',
    'Content-Type': 'application/json',
  };

  // หา sha เดิม (ถ้ามี) เพื่อ update; ถ้าไม่มี = สร้างใหม่
  let sha = null;
  try {
    const head = await fetch(apiUrl, { headers: ghHeaders });
    if (head.ok) sha = (await head.json()).sha;
  } catch {}

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(snapshot, null, 2))));
  const body = { message: 'chore: update daily-snapshot', content };
  if (sha) body.sha = sha;

  try {
    const res = await fetch(apiUrl, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(body) });
    return res.ok;
  } catch { return false; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const env  = context.env;
  const req  = context.request;

  const LINE_TOKEN = env.LINE_CHANNEL_ACCESS_TOKEN;
  const LINE_USER  = env.LINE_USER_ID;
  const GH_TOKEN   = env.GITHUB_TOKEN;

  if (!LINE_TOKEN || !LINE_USER) {
    return new Response(JSON.stringify({ error: 'LINE env not set' }), { status: 500, headers: cors });
  }

  try {
    // ── 1. โหลด portfolio + snapshot เมื่อวาน (parallel) ──
    const [dataRes, snapshot] = await Promise.all([
      fetch(`https://raw.githubusercontent.com/${REPO}/main/${DATA_PATH}?t=${Date.now()}`,
            { headers: { 'Cache-Control': 'no-cache' } }),
      readSnapshot(),
    ]);
    if (!dataRes.ok) throw new Error('portfolio-data fetch failed: ' + dataRes.status);
    const portfolioData = await dataRes.json();
    const portfolios    = portfolioData.portfolios || [];

    // ── 2. รวบรวม tickers + ดึงราคา parallel ──
    const tickerSet = new Set();
    portfolios.forEach(p => (p.stocks || []).forEach(s => s.ticker && tickerSet.add(s.ticker)));
    const baseUrl  = new URL(req.url).origin;
    const priceMap = {};
    await Promise.all([...tickerSet].map(async t => {
      const p = await fetchPrice(t, baseUrl);
      if (p) priceMap[t] = p;
    }));

    // ── 3. คำนวณ net worth + per-stock P/L (เทียบราคาซื้อ) ──
    let totalNetWorth = 0;
    const stockValues = [];
    portfolios.forEach(p => {
      (p.stocks || []).forEach(s => {
        const price = priceMap[s.ticker];
        if (!price || !s.qty) return;
        const value  = price * s.qty;
        const cost   = (s.buyPrice || 0) * s.qty;
        const pnlPct = cost > 0 ? ((value - cost) / cost) * 100 : null;
        totalNetWorth += value;
        if (pnlPct != null) stockValues.push({ ticker: s.ticker, price, pnlPct });
      });
    });

    // ── 4. net worth เทียบเมื่อวาน (day-over-day) ──
    const prevNW      = (snapshot && typeof snapshot.netWorth === 'number') ? snapshot.netWorth : null;
    const nwChange    = prevNW != null ? totalNetWorth - prevNW : null;
    const nwChangePct = (prevNW != null && prevNW > 0) ? (nwChange / prevNW) * 100 : null;

    // ── 5. หุ้นขึ้น/ลงมากสุด — % เปลี่ยนแปลงราคาวันต่อวัน ──
    const prevPrices = (snapshot && snapshot.prices) ? snapshot.prices : {};
    const byTicker = {};
    stockValues.forEach(s => {
      const prev = prevPrices[s.ticker];
      if (!prev || prev <= 0) return;
      const dayChg = ((s.price - prev) / prev) * 100;
      // dedup: เก็บตัวที่ dayChg สูงสุดของแต่ละ ticker
      if (!byTicker[s.ticker] || dayChg > byTicker[s.ticker].dayChg) {
        byTicker[s.ticker] = { ...s, dayChg };
      }
    });
    const uniq = Object.values(byTicker).sort((a, b) => b.dayChg - a.dayChg);
    const topGainer = uniq[0] || null;
    const topLoser  = uniq.length > 1 ? uniq[uniq.length - 1] : null;

    // ── 6. Format message ──
    const today = new Date().toLocaleDateString('th-TH', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
    });

    const nwLine3 = nwChange != null
      ? `${arrow(nwChange)} ${fmSign(nwChange)} บาท  (${fmSign(nwChangePct)}%)`
      : `─ ยังไม่มีข้อมูลเมื่อวาน`;

    const fmtStock = (s, label) =>
      `${dot(s.dayChg)} ${label}: ${s.ticker.replace('.BK','')}\n   ${arrow(s.dayChg)} ${fmSign(s.dayChg)}%  ฿${fm(s.price)}`;

    const lines = [
      `📊 TradeDesk Daily Summary`,
      `📅 ${today}`,
      ``,
      `💰 มูลค่าพอร์ตรวม`,
      `฿${fm(totalNetWorth)}`,
      nwLine3,
      ``,
      `┄┄┄ วันนี้ vs เมื่อวาน ┄┄┄`,
      topGainer ? fmtStock(topGainer, 'ขึ้นมากสุด') : (uniq.length === 0 ? '─ ยังไม่มีข้อมูลเมื่อวาน' : ''),
      (topLoser && topLoser.ticker !== topGainer?.ticker) ? fmtStock(topLoser, 'ลงมากสุด') : '',
      ``,
      `🔗 trade-desk.pages.dev`,
    ].filter(l => l !== '');

    const message = lines.join('\n');

    // ── 7. ส่ง LINE ──
    const lineRes = await sendLine(LINE_TOKEN, LINE_USER, message);
    if (!lineRes.ok) {
      throw new Error('LINE send failed: ' + (await lineRes.text()));
    }

    // ── 8. เขียน snapshot วันนี้ (netWorth + prices ทุกตัว) ──
    const snapshotSaved = await writeSnapshot(GH_TOKEN, {
      date:     new Date().toISOString(),
      netWorth: totalNetWorth,
      prices:   priceMap,   // ← เก็บราคาทุกตัวสำหรับ day-over-day พรุ่งนี้
    });

    return new Response(JSON.stringify({
      ok: true,
      totalNetWorth,
      nwChange,
      snapshotSaved,
      stockCount: stockValues.length,
      message,
    }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
