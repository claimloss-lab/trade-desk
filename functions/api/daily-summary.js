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

// ── Send LINE Flex message ────────────────────────────────────────────────────
async function sendLineFlex(token, userId, altText, flexContents) {
  return fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'flex', altText, contents: flexContents }]
    }),
  });
}

// ── Build Flex Message bubble ─────────────────────────────────────────────────
function buildFlex({ today, totalNetWorth, nwChange, nwChangePct, topGainer, topLoser }) {
  const isUp    = nwChange == null ? null : nwChange >= 0;
  const chgColor = isUp == null ? '#8A8A9A' : isUp ? '#00C896' : '#FF5C5C';
  const chgArrow = isUp == null ? '─' : isUp ? '▲' : '▼';
  const chgText  = nwChange == null
    ? 'ยังไม่มีข้อมูลเมื่อวาน'
    : `${chgArrow} ${fmSign(nwChange)} บาท  (${fmSign(nwChangePct)}%)`;

  // stock row builder
  const stockRow = (s, label) => {
    if (!s) return null;
    const up    = s.dayChg >= 0;
    const color = up ? '#00C896' : '#FF5C5C';
    const arrow = up ? '▲' : '▼';
    const name  = s.ticker.replace('.BK', '');
    return {
      type: 'box', layout: 'horizontal', margin: 'md',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 0, width: '6px',
          contents: [{
            type: 'filler'
          }],
          borderWidth: '0px',
          backgroundColor: color,
          cornerRadius: '3px',
        },
        {
          type: 'box', layout: 'vertical', flex: 1, margin: 'md',
          contents: [
            { type: 'text', text: label, size: '10px', color: '#6B7280', weight: 'bold', wrap: false },
            { type: 'text', text: name, size: 'sm', color: '#E2E8F0', weight: 'bold', margin: 'xs' },
          ]
        },
        {
          type: 'box', layout: 'vertical', flex: 0, alignItems: 'flex-end',
          contents: [
            { type: 'text', text: `${arrow} ${fmSign(s.dayChg)}%`, size: 'sm', color, weight: 'bold', align: 'end' },
            { type: 'text', text: `฿${fm(s.price)}`, size: '10px', color: '#8A8A9A', align: 'end', margin: 'xs' },
          ]
        },
      ]
    };
  };

  const gainerRow = stockRow(topGainer, 'ขึ้นมากสุด');
  const loserRow  = topLoser && topLoser.ticker !== topGainer?.ticker ? stockRow(topLoser, 'ลงมากสุด') : null;

  const stockSection = (gainerRow || loserRow) ? [
    { type: 'separator', margin: 'xl', color: '#2A2A3E' },
    {
      type: 'box', layout: 'vertical', margin: 'xl',
      contents: [
        { type: 'text', text: 'เคลื่อนไหวโดดเด่น', size: '10px', color: '#6B7280', weight: 'bold' },
        ...(gainerRow ? [gainerRow] : []),
        ...(loserRow  ? [loserRow]  : []),
      ]
    }
  ] : [];

  return {
    type: 'bubble',
    size: 'kilo',
    styles: {
      header: { backgroundColor: '#0F0F1A' },
      body:   { backgroundColor: '#161625' },
      footer: { backgroundColor: '#0F0F1A' },
    },
    header: {
      type: 'box', layout: 'vertical', paddingAll: '16px',
      contents: [
        {
          type: 'box', layout: 'horizontal', alignItems: 'center',
          contents: [
            {
              type: 'box', layout: 'vertical', flex: 1,
              contents: [
                { type: 'text', text: '📈 TradeDesk', size: 'sm', color: '#4A9EFF', weight: 'bold' },
                { type: 'text', text: 'Daily Summary', size: 'xs', color: '#6B7280', margin: 'xs' },
              ]
            },
            { type: 'text', text: today, size: '10px', color: '#6B7280', align: 'end', flex: 0, wrap: false },
          ]
        }
      ]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '16px',
      contents: [
        // Net worth section
        {
          type: 'box', layout: 'vertical',
          contents: [
            { type: 'text', text: 'มูลค่าพอร์ตรวม', size: '10px', color: '#6B7280', weight: 'bold' },
            {
              type: 'text',
              text: `฿${fm(totalNetWorth, 0)}`,
              size: 'xxl', color: '#E2E8F0', weight: 'bold', margin: 'sm',
              adjustMode: 'shrink-to-fit',
            },
            {
              type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
              contents: [
                {
                  type: 'box', layout: 'vertical', flex: 0,
                  contents: [{ type: 'text', text: 'vs เมื่อวาน', size: '10px', color: '#6B7280' }],
                },
                {
                  type: 'text', text: chgText,
                  size: 'sm', color: chgColor, weight: 'bold', align: 'end', flex: 1,
                  adjustMode: 'shrink-to-fit',
                },
              ]
            },
          ]
        },
        ...stockSection,
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      contents: [{
        type: 'button',
        action: { type: 'uri', label: 'เปิด TradeDesk', uri: 'https://trade-desk.pages.dev' },
        style: 'primary',
        color: '#4A9EFF',
        height: 'sm',
        cornerRadius: '8px',
      }]
    }
  };
}

// ── Read snapshot file (raw, public) ──────────────────────────────────────────
async function readSnapshot() {
  try {
    const r = await fetch(
      `https://raw.githubusercontent.com/${REPO}/main/${SNAPSHOT_PATH}?t=${Date.now()}`,
      { headers: { 'Cache-Control': 'no-cache' } }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Write snapshot file via GitHub API ────────────────────────────────────────
async function writeSnapshot(ghToken, snapshot) {
  if (!ghToken) return false;
  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${SNAPSHOT_PATH}`;
  const ghHeaders = {
    Authorization: `token ${ghToken}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'TradeDesk',
    'Content-Type': 'application/json',
  };

  let sha = null;
  try {
    const head = await fetch(apiUrl, { headers: ghHeaders });
    if (head.ok) sha = (await head.json()).sha;
  } catch {}

  const raw     = JSON.stringify(snapshot, null, 2);
  const bytes   = new TextEncoder().encode(raw);
  const b64     = btoa(String.fromCharCode(...bytes));
  const body    = { message: 'chore: update daily-snapshot', content: b64 };
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

    // ── 3. คำนวณ net worth + per-stock P/L ──
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

    // ── 4. net worth เทียบเมื่อวาน ──
    const prevNW      = (snapshot && typeof snapshot.netWorth === 'number') ? snapshot.netWorth : null;
    const nwChange    = prevNW != null ? totalNetWorth - prevNW : null;
    const nwChangePct = (prevNW != null && prevNW > 0) ? (nwChange / prevNW) * 100 : null;

    // ── 5. หุ้นขึ้น/ลงมากสุด ──
    const prevPrices = (snapshot && snapshot.prices) ? snapshot.prices : {};
    const byTicker   = {};
    stockValues.forEach(s => {
      const prev = prevPrices[s.ticker];
      if (!prev || prev <= 0) return;
      const dayChg = ((s.price - prev) / prev) * 100;
      if (!byTicker[s.ticker] || dayChg > byTicker[s.ticker].dayChg) {
        byTicker[s.ticker] = { ...s, dayChg };
      }
    });
    const uniq      = Object.values(byTicker).sort((a, b) => b.dayChg - a.dayChg);
    const topGainer = uniq[0] || null;
    const topLoser  = uniq.length > 1 ? uniq[uniq.length - 1] : null;

    // ── 6. Build Flex Message ──
    const today = new Date().toLocaleDateString('th-TH', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
    });

    const flexContents = buildFlex({ today, totalNetWorth, nwChange, nwChangePct, topGainer, topLoser });
    const altText = `TradeDesk ${today} | ฿${fm(totalNetWorth, 0)}${nwChange != null ? ` (${fmSign(nwChangePct)}%)` : ''}`;

    // ── 7. ส่ง LINE ──
    const lineRes = await sendLineFlex(LINE_TOKEN, LINE_USER, altText, flexContents);
    if (!lineRes.ok) {
      throw new Error('LINE send failed: ' + (await lineRes.text()));
    }

    // ── 8. เขียน snapshot วันนี้ ──
    const snapshotSaved = await writeSnapshot(GH_TOKEN, {
      date:     new Date().toISOString(),
      netWorth: totalNetWorth,
      prices:   priceMap,
    });

    return new Response(JSON.stringify({
      ok: true,
      totalNetWorth,
      nwChange,
      snapshotSaved,
      stockCount: stockValues.length,
    }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
