/**
 * /api/daily-summary — Cloudflare Pages Function
 * GitHub Actions เรียกทุกวัน 08:00 ICT
 */

const REPO      = 'claimloss-lab/trade-desk';
const FILE_PATH = 'public/portfolio-data.json';

// ── Formatters ────────────────────────────────────────────────────────────────
function fm(n, dec = 2) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmSign(n, dec = 2) {
  const s = fm(Math.abs(n), dec);
  return (n >= 0 ? '+' : '−') + s;
}
function arrow(n) { return n > 0 ? '▲' : n < 0 ? '▼' : '─'; }
function bar(pct, max = 100) {
  const filled = Math.round(Math.min(Math.abs(pct), max) / max * 8);
  return '█'.repeat(filled) + '░'.repeat(8 - filled);
}

// ── Fetch price via /api/price ────────────────────────────────────────────────
async function fetchPrice(ticker, baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/price?ticker=${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.price || null;
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

// ── Push snapshot back to GitHub ──────────────────────────────────────────────
async function pushSnapshot(ghToken, snapshot, currentContent, fileSha) {
  const updated = { ...currentContent, daily_snapshot: snapshot };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2))));
  await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'TradeDesk',
    },
    body: JSON.stringify({
      message: 'chore: update daily_snapshot',
      content,
      sha: fileSha,
    }),
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const env  = context.env;
  const req  = context.request;

  const LINE_TOKEN = env.LINE_CHANNEL_ACCESS_TOKEN;
  const LINE_USER  = env.LINE_USER_ID;
  const GH_TOKEN   = env.GITHUB_TOKEN;

  if (!LINE_TOKEN || !LINE_USER) return new Response(JSON.stringify({ error: 'LINE env not set' }), { status: 500, headers: cors });

  try {
    // ── 1. โหลด portfolio-data.json ──
    const rawRes = await fetch(
      `https://raw.githubusercontent.com/${REPO}/main/${FILE_PATH}`,
      { headers: { 'Cache-Control': 'no-cache' } }
    );
    if (!rawRes.ok) throw new Error('GitHub fetch failed: ' + rawRes.status);
    const portfolioData = await rawRes.json();
    const portfolios    = portfolioData.portfolios || [];
    const snapshot      = portfolioData.daily_snapshot || null; // เมื่อวาน

    // ── 2. ดึง SHA สำหรับ push snapshot (ต้องการ GH_TOKEN) ──
    let fileSha = null;
    let rawContent = null;
    if (GH_TOKEN) {
      const apiRes = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
        { headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'TradeDesk' } }
      );
      if (apiRes.ok) {
        const apiData = await apiRes.json();
        fileSha      = apiData.sha;
        rawContent   = portfolioData;
      }
    }

    // ── 3. รวบรวม tickers + ดึงราคา parallel ──
    const tickerSet = new Set();
    portfolios.forEach(p => (p.stocks || []).forEach(s => s.ticker && tickerSet.add(s.ticker)));
    const baseUrl = new URL(req.url).origin;
    const priceMap = {};
    await Promise.all([...tickerSet].map(async t => {
      const p = await fetchPrice(t, baseUrl);
      if (p) priceMap[t] = p;
    }));

    // ── 4. คำนวณ net worth + per-stock ──
    let totalNetWorth = 0;
    const stockValues = [];
    portfolios.forEach(p => {
      (p.stocks || []).forEach(s => {
        const price = priceMap[s.ticker];
        if (!price || !s.qty) return;
        const value  = price * s.qty;
        const cost   = (s.buyPrice || 0) * s.qty;
        const pnl    = value - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        totalNetWorth += value;
        stockValues.push({ ticker: s.ticker, value, pnl, pnlPct, price });
      });
    });

    // ── 5. เปรียบเทียบกับ snapshot เมื่อวาน ──
    const prevNW      = snapshot?.netWorth || null;
    const nwChange    = prevNW != null ? totalNetWorth - prevNW : null;
    const nwChangePct = prevNW != null && prevNW > 0 ? (nwChange / prevNW) * 100 : null;

    // per-stock เทียบราคาเมื่อวาน
    const prevPrices = snapshot?.prices || {};
    const stockDiffs = stockValues.map(s => {
      const prev    = prevPrices[s.ticker] || null;
      const dayChg  = prev != null ? ((s.price - prev) / prev) * 100 : null;
      return { ...s, prev, dayChg };
    }).filter(s => s.dayChg != null);
    stockDiffs.sort((a, b) => b.dayChg - a.dayChg);
    const topGainer = stockDiffs[0]    || null;
    const topLoser  = stockDiffs[stockDiffs.length - 1] || null;

    // ── 6. Format message ──
    const today = new Date().toLocaleDateString('th-TH', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
    });

    const nwArrow  = nwChange != null ? arrow(nwChange) : '';
    const nwLine1  = `💰 มูลค่าพอร์ตรวม`;
    const nwLine2  = `฿${fm(totalNetWorth)}`;
    const nwLine3  = nwChange != null
      ? `${nwArrow} ${fmSign(nwChange)} บาท  (${fmSign(nwChangePct, 2)}%)`
      : `─ ยังไม่มีข้อมูลเมื่อวาน`;

    const gainLine = topGainer
      ? `🟢 ${topGainer.ticker.replace('.BK','')}\n   ▲ ${fm(topGainer.dayChg)}%  ฿${fm(topGainer.price)}`
      : '';
    const loseLine = topLoser && topLoser.ticker !== topGainer?.ticker
      ? `🔴 ${topLoser.ticker.replace('.BK','')}\n   ▼ ${fm(Math.abs(topLoser.dayChg))}%  ฿${fm(topLoser.price)}`
      : '';

    const lines = [
      `📊 TradeDesk Daily Summary`,
      `📅 ${today}`,
      ``,
      nwLine1,
      nwLine2,
      nwLine3,
      ``,
      `┄┄┄ วันนี้ vs เมื่อวาน ┄┄┄`,
      gainLine,
      loseLine || '',
      ``,
      `🔗 trade-desk.pages.dev`,
    ].filter(l => l !== undefined);

    const message = lines.join('\n');

    // ── 7. ส่ง LINE ──
    const lineRes = await sendLine(LINE_TOKEN, LINE_USER, message);
    if (!lineRes.ok) {
      const err = await lineRes.text();
      throw new Error('LINE send failed: ' + err);
    }

    // ── 8. บันทึก snapshot วันนี้กลับ GitHub ──
    if (GH_TOKEN && fileSha) {
      const newSnapshot = {
        date:     new Date().toISOString(),
        netWorth: totalNetWorth,
        prices:   priceMap,
      };
      await pushSnapshot(GH_TOKEN, newSnapshot, rawContent, fileSha);
    }

    return new Response(JSON.stringify({ ok: true, totalNetWorth, nwChange, message }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
