/**
 * /api/daily-summary — Cloudflare Pages Function
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
  if (n == null || isNaN(n)) return '0';
  return (n >= 0 ? '+' : '-') + fm(Math.abs(n), dec);
}

// ── Fetch price ───────────────────────────────────────────────────────────────
async function fetchPrice(ticker, baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/price?ticker=${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return (typeof d.price === 'number' && d.price > 0) ? d.price : null;
  } catch { return null; }
}

// ── Send LINE Flex ────────────────────────────────────────────────────────────
async function sendLineFlex(token, userId, altText, contents) {
  return fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ to: userId, messages: [{ type: 'flex', altText, contents }] }),
  });
}

// ── Build Flex bubble ─────────────────────────────────────────────────────────
function buildFlex({ today, totalNetWorth, nwChange, nwChangePct, topGainer, topLoser, staleCount }) {
  const isUp     = nwChange == null ? null : nwChange >= 0;
  const chgColor = isUp == null ? '#8A8A9A' : isUp ? '#00C896' : '#FF5C5C';
  const chgArrow = isUp == null ? '─' : isUp ? '▲' : '▼';
  const chgText  = nwChange == null
    ? 'ยังไม่มีข้อมูลเมื่อวาน'
    : `${chgArrow} ${fmSign(nwChange, 0)} บาท (${fmSign(nwChangePct)}%)`;

  // Stock row — ใช้แค่ properties ที่ LINE รองรับ
  function stockRow(s, label) {
    if (!s) return null;
    const up    = s.dayChg >= 0;
    const color = up ? '#00C896' : '#FF5C5C';
    const arrow = up ? '▲' : '▼';
    const name  = s.ticker.replace('.BK', '');
    return {
      type: 'box', layout: 'horizontal', margin: 'md',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 0,
          contents: [
            { type: 'text', text: label, size: 'xxs', color: '#6B7280', weight: 'bold' },
            { type: 'text', text: name,  size: 'sm',  color: '#E2E8F0', weight: 'bold', margin: 'xs' },
          ]
        },
        { type: 'filler' },
        {
          type: 'box', layout: 'vertical', flex: 0, alignItems: 'flex-end',
          contents: [
            { type: 'text', text: `${arrow} ${fmSign(s.dayChg)}%`, size: 'sm', color, weight: 'bold', align: 'end' },
            { type: 'text', text: `฿${fm(s.price)}`, size: 'xxs', color: '#8A8A9A', align: 'end', margin: 'xs' },
          ]
        },
      ]
    };
  }

  // FIX: แสดง "ขึ้นมากสุด" เฉพาะเมื่อขึ้นจริง และ "ลงมากสุด" เฉพาะเมื่อลงจริง
  // (เดิม: วันที่หุ้นแดงทั้งกระดาน หุ้นที่ลงน้อยสุดถูก label ว่า "ขึ้นมากสุด")
  const gRow = (topGainer && topGainer.dayChg > 0) ? stockRow(topGainer, 'ขึ้นมากสุด') : null;
  const lRow = (topLoser && topLoser.dayChg < 0 && topLoser.ticker !== topGainer?.ticker)
    ? stockRow(topLoser, 'ลงมากสุด') : null;

  const stockSection = (gRow || lRow) ? [
    { type: 'separator', margin: 'xl', color: '#2A2A3E' },
    { type: 'text', text: 'เคลื่อนไหวโดดเด่น', size: 'xxs', color: '#6B7280', weight: 'bold', margin: 'xl' },
    ...(gRow ? [gRow] : []),
    ...(lRow ? [lRow] : []),
  ] : [];

  const staleNote = staleCount > 0 ? [
    { type: 'text', text: `⚠️ ${staleCount} ตัวใช้ราคาล่าสุดที่มี (ดึงราคาวันนี้ไม่สำเร็จ)`,
      size: 'xxs', color: '#B7791F', margin: 'md', wrap: true },
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
      type: 'box', layout: 'horizontal', paddingAll: 'lg', alignItems: 'center',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 1,
          contents: [
            { type: 'text', text: '📈 TradeDesk', size: 'sm', color: '#4A9EFF', weight: 'bold' },
            { type: 'text', text: 'Daily Summary', size: 'xxs', color: '#6B7280', margin: 'xs' },
          ]
        },
        { type: 'text', text: today, size: 'xxs', color: '#6B7280', align: 'end', flex: 0, wrap: false },
      ]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: 'lg',
      contents: [
        { type: 'text', text: 'มูลค่าพอร์ตรวม', size: 'xxs', color: '#6B7280', weight: 'bold' },
        { type: 'text', text: `฿${fm(totalNetWorth, 0)}`, size: 'xxl', color: '#E2E8F0', weight: 'bold', margin: 'sm', adjustMode: 'shrink-to-fit' },
        {
          type: 'box', layout: 'horizontal', margin: 'sm',
          contents: [
            { type: 'text', text: 'vs เมื่อวาน', size: 'xxs', color: '#6B7280', flex: 0 },
            { type: 'text', text: chgText, size: 'xs', color: chgColor, weight: 'bold', align: 'end', flex: 1, adjustMode: 'shrink-to-fit' },
          ]
        },
        ...staleNote,
        ...stockSection,
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: 'md',
      contents: [{
        type: 'button',
        action: { type: 'uri', label: 'เปิด TradeDesk', uri: 'https://trade-desk.pages.dev' },
        style: 'primary', color: '#4A9EFF', height: 'sm',
      }]
    }
  };
}

// ── Read snapshot ─────────────────────────────────────────────────────────────
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

// ── Write snapshot ────────────────────────────────────────────────────────────
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

  const raw   = JSON.stringify(snapshot, null, 2);
  const bytes = new TextEncoder().encode(raw);
  let b64str  = '';
  bytes.forEach(b => { b64str += String.fromCharCode(b); });
  const b64  = btoa(b64str);
  const body = { message: 'chore: update daily-snapshot', content: b64 };
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

  // Optional shared-secret guard: ตั้ง env SUMMARY_SECRET แล้วให้ cron worker
  // เรียกด้วย ?key=<secret> — ถ้าไม่ตั้ง env จะทำงานแบบเดิม (เปิด public)
  // Robust lookup — ชื่อตัวแปรใน dashboard อาจติด whitespace มาโดยไม่เห็นใน UI
  const SUMMARY_SECRET = (env.SUMMARY_SECRET
    ?? Object.entries(env).find(([k]) => k.trim() === 'SUMMARY_SECRET')?.[1]
    ?? '').trim();
  if (SUMMARY_SECRET) {
    const key = new URL(req.url).searchParams.get('key');
    if (key !== SUMMARY_SECRET) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
    }
  }

  if (!LINE_TOKEN || !LINE_USER) {
    return new Response(JSON.stringify({ error: 'LINE env not set' }), { status: 500, headers: cors });
  }

  try {
    const [dataRes, snapshot] = await Promise.all([
      fetch(`https://raw.githubusercontent.com/${REPO}/main/${DATA_PATH}?t=${Date.now()}`,
            { headers: { 'Cache-Control': 'no-cache' } }),
      readSnapshot(),
    ]);
    if (!dataRes.ok) throw new Error('portfolio-data fetch failed: ' + dataRes.status);
    const portfolioData = await dataRes.json();
    const portfolios    = portfolioData.portfolios || [];

    const prevPrices = (snapshot && snapshot.prices) ? snapshot.prices : {};

    const tickerSet = new Set();
    portfolios.forEach(p => (p.stocks || []).forEach(s => s.ticker && tickerSet.add(s.ticker)));
    const baseUrl  = new URL(req.url).origin;
    const priceMap = {};
    await Promise.all([...tickerSet].map(async t => {
      const p = await fetchPrice(t, baseUrl);
      if (p) priceMap[t] = p;
    }));

    // FIX: เดิมถ้าดึงราคาบางตัวไม่สำเร็จ หุ้นตัวนั้นหายจาก net worth ทั้งก้อน
    // → มูลค่าพอร์ต "ร่วง" ปลอมๆ ตอนนี้ fallback ไปใช้ราคาจาก snapshot เมื่อวาน
    // (ตัวที่ fallback จะไม่ถูกนับใน top gainer/loser เพราะ dayChg = 0)
    let staleCount = 0;
    const effPrice = {};
    tickerSet.forEach(t => {
      if (priceMap[t]) { effPrice[t] = priceMap[t]; }
      else if (prevPrices[t] > 0) { effPrice[t] = prevPrices[t]; staleCount++; }
    });

    let totalNetWorth = 0;
    const stockValues = [];
    portfolios.forEach(p => {
      (p.stocks || []).forEach(s => {
        const price = effPrice[s.ticker];
        if (!price || !s.qty) return;
        const value  = price * s.qty;
        const cost   = (s.buyPrice || 0) * s.qty;
        const pnlPct = cost > 0 ? ((value - cost) / cost) * 100 : null;
        totalNetWorth += value;
        // เฉพาะตัวที่ได้ราคาสดจริงเท่านั้นถึงเข้าชิง gainer/loser
        if (pnlPct != null && priceMap[s.ticker]) stockValues.push({ ticker: s.ticker, price, pnlPct });
      });
    });

    const prevNW      = (snapshot && typeof snapshot.netWorth === 'number') ? snapshot.netWorth : null;
    const nwChange    = prevNW != null ? totalNetWorth - prevNW : null;
    const nwChangePct = (prevNW != null && prevNW > 0) ? (nwChange / prevNW) * 100 : null;

    const byTicker = {};
    stockValues.forEach(s => {
      const prev = prevPrices[s.ticker];
      if (!prev || prev <= 0) return;
      const dayChg = ((s.price - prev) / prev) * 100;
      if (!byTicker[s.ticker]) byTicker[s.ticker] = { ...s, dayChg };
    });
    const uniq      = Object.values(byTicker).sort((a, b) => b.dayChg - a.dayChg);
    const topGainer = uniq[0] || null;
    const topLoser  = uniq.length > 1 ? uniq[uniq.length - 1] : null;

    const today = new Date().toLocaleDateString('th-TH', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
    });

    const flexContents = buildFlex({ today, totalNetWorth, nwChange, nwChangePct, topGainer, topLoser, staleCount });
    const altText = `TradeDesk ${today} | ฿${fm(totalNetWorth, 0)}${nwChange != null ? ` (${fmSign(nwChangePct)}%)` : ''}`;

    const lineRes = await sendLineFlex(LINE_TOKEN, LINE_USER, altText, flexContents);
    if (!lineRes.ok) {
      const errBody = await lineRes.text();
      throw new Error(`LINE send failed ${lineRes.status}: ${errBody}`);
    }

    // Snapshot เก็บ effPrice (carry-forward ราคาเก่าเมื่อดึงไม่สำเร็จ) เพื่อไม่ให้
    // ticker หลุดหายจากการเทียบวันถัดไป
    const snapshotSaved = await writeSnapshot(GH_TOKEN, {
      date:     new Date().toISOString(),
      netWorth: totalNetWorth,
      prices:   effPrice,
    });

    return new Response(JSON.stringify({ ok: true, totalNetWorth, nwChange, snapshotSaved, staleCount, stockCount: stockValues.length }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
