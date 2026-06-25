/**
 * /api/daily-summary  (Cloudflare Cron Trigger)
 *
 * Schedule: 0 1 * * *  (01:00 UTC = 08:00 ICT)
 *
 * สิ่งที่ทำ:
 *  1. ดึง portfolio-data.json จาก GitHub (ข้อมูลล่าสุด auto-saved)
 *  2. ดึงราคาปัจจุบันของทุกหุ้นจาก /api/price
 *  3. คำนวณ net worth และเทียบกับ snapshot เมื่อวาน (เก็บใน KV)
 *  4. หาหุ้นขึ้นมากสุด / ลงมากสุด
 *  5. ส่ง LINE OA
 *
 * Cloudflare env vars required:
 *   GITHUB_TOKEN               — PAT สำหรับดึง portfolio-data.json
 *   LINE_CHANNEL_ACCESS_TOKEN  — Channel Access Token
 *   LINE_USER_ID               — User ID ผู้รับ
 *   TRADEDESK_KV               — KV Namespace binding (เก็บ snapshot เมื่อวาน)
 *
 * wrangler.toml (เพิ่ม):
 *   [[triggers.crons]]
 *   crons = ["0 1 * * *"]
 *
 *   [[kv_namespaces]]
 *   binding = "TRADEDESK_KV"
 *   id = "<your-kv-id>"
 */

const REPO = 'claimloss-lab/trade-desk';
const FILE_PATH = 'public/portfolio-data.json';
const PRICE_API = 'https://trade-desk.pages.dev/api/price';
const KV_KEY_SNAPSHOT = 'daily_snapshot';

// ── Helpers ──────────────────────────────────────────────────────────────────
function fm(n, dec = 2) {
  if (n == null || isNaN(n)) return '0';
  return n.toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmSign(n) {
  const sign = n >= 0 ? '+' : '';
  return sign + fm(n);
}

async function fetchPrice(ticker) {
  try {
    const r = await fetch(`${PRICE_API}?ticker=${encodeURIComponent(ticker)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.price || null;
  } catch {
    return null;
  }
}

async function sendLine(token, userId, message) {
  return fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: message }],
    }),
  });
}

// ── Main Cron Handler ─────────────────────────────────────────────────────────
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailySummary(env));
  },

  // Also allow manual trigger via GET /api/daily-summary
  async fetch(request, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    // ป้องกันคนอื่นเรียก endpoint นี้โดยตรง
    const secret = env.CRON_SECRET;
    if (secret) {
      const reqSecret = request.headers.get('X-Cron-Secret');
      if (reqSecret !== secret) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
      }
    }

    try {
      const result = await runDailySummary(env);
      return new Response(JSON.stringify({ ok: true, ...result }), { headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
    }
  },
};

async function runDailySummary(env) {
  const TOKEN = env.LINE_CHANNEL_ACCESS_TOKEN;
  const USER_ID = env.LINE_USER_ID;
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  const KV = env.TRADEDESK_KV;

  if (!TOKEN || !USER_ID) throw new Error('LINE env vars not configured');
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not configured');

  // ── 1. โหลด portfolio-data.json จาก GitHub ──
  const ghRes = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'TradeDesk-DailySummary',
      },
    }
  );
  if (!ghRes.ok) throw new Error('Failed to load portfolio data from GitHub: ' + ghRes.status);
  const ghData = await ghRes.json();
  const portfolioData = JSON.parse(atob(ghData.content.replace(/\n/g, '')));
  const portfolios = portfolioData.portfolios || [];

  // ── 2. รวบรวม tickers ทั้งหมด (deduplicated) ──
  const tickerSet = new Set();
  portfolios.forEach(p => {
    (p.stocks || []).forEach(s => {
      if (s.ticker) tickerSet.add(s.ticker);
    });
  });
  const tickers = [...tickerSet];

  // ── 3. ดึงราคาปัจจุบัน (parallel) ──
  const priceResults = await Promise.all(
    tickers.map(async t => ({ ticker: t, price: await fetchPrice(t) }))
  );
  const priceMap = {};
  priceResults.forEach(r => { if (r.price) priceMap[r.ticker] = r.price; });

  // ── 4. คำนวณ net worth ปัจจุบัน และ per-stock value ──
  let totalNetWorth = 0;
  const stockValues = []; // { ticker, portName, value, cost, pnl, pnlPct }

  portfolios.forEach(p => {
    (p.stocks || []).forEach(s => {
      const price = priceMap[s.ticker];
      if (!price || !s.qty) return;
      const value = price * s.qty;
      const cost = (s.buyPrice || 0) * s.qty;
      const pnl = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      totalNetWorth += value;
      stockValues.push({ ticker: s.ticker, portName: p.name || p.id, value, cost, pnl, pnlPct, price });
    });
  });

  // ── 5. เทียบกับ snapshot เมื่อวาน (จาก KV) ──
  let yesterdayNetWorth = null;
  let netWorthChange = null;
  let netWorthChangePct = null;

  if (KV) {
    try {
      const snap = await KV.get(KV_KEY_SNAPSHOT, 'json');
      if (snap?.netWorth) {
        yesterdayNetWorth = snap.netWorth;
        netWorthChange = totalNetWorth - yesterdayNetWorth;
        netWorthChangePct = (netWorthChange / yesterdayNetWorth) * 100;
      }
      // บันทึก snapshot วันนี้ทับ
      await KV.put(KV_KEY_SNAPSHOT, JSON.stringify({
        netWorth: totalNetWorth,
        date: new Date().toISOString(),
        priceMap,
      }));
    } catch (e) {
      console.warn('KV error:', e.message);
    }
  }

  // ── 6. หาหุ้นขึ้นมากสุด / ลงมากสุด (by pnlPct) ──
  const sorted = [...stockValues].sort((a, b) => b.pnlPct - a.pnlPct);
  const topGainer = sorted[0] || null;
  const topLoser = sorted[sorted.length - 1] || null;

  // ── 7. Format LINE message ──
  const today = new Date().toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Bangkok',
  });

  const arrowNW = netWorthChange == null ? '' : netWorthChange >= 0 ? '📈' : '📉';
  const nwLine = netWorthChange != null
    ? `${arrowNW} เปลี่ยนแปลง: ${fmSign(netWorthChange)} บาท (${fmSign(netWorthChangePct)}%)`
    : '📊 (ยังไม่มีข้อมูลเมื่อวาน)';

  const gainerLine = topGainer
    ? `🟢 ขึ้นมากสุด: ${topGainer.ticker} +${fm(topGainer.pnlPct)}% (฿${fm(topGainer.price)})`
    : '';
  const loserLine = topLoser && topLoser !== topGainer
    ? `🔴 ลงมากสุด: ${topLoser.ticker} ${fm(topLoser.pnlPct)}% (฿${fm(topLoser.price)})`
    : '';

  const message = [
    `📋 TradeDesk Daily Summary`,
    today,
    `─────────────────────`,
    `💰 มูลค่าพอร์ตรวม: ฿${fm(totalNetWorth)} บาท`,
    nwLine,
    `─────────────────────`,
    gainerLine,
    loserLine,
    `─────────────────────`,
    `🕗 ข้อมูล ณ เวลาส่ง report`,
    `trade-desk.pages.dev`,
  ].filter(Boolean).join('\n');

  // ── 8. ส่ง LINE ──
  const lineRes = await sendLine(TOKEN, USER_ID, message);
  if (!lineRes.ok) {
    const err = await lineRes.text();
    throw new Error('LINE send failed: ' + err);
  }

  return { totalNetWorth, netWorthChange, stockCount: stockValues.length };
}
