/**
 * /api/daily-summary — Cloudflare Pages Function
 */

const REPO          = 'claimloss-lab/trade-desk';
const DATA_PATH     = 'public/portfolio-data.json';
const SNAPSHOT_PATH = 'public/daily-snapshot.json';
const HISTORY_PATH  = 'public/portfolio-history.json';
const HISTORY_MAX   = 1000; // กันไฟล์บวมไม่จำกัด (~2 records/วัน ~500 วัน)

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
  // ── ธีมฟ้า-ขาว อ่านง่าย (เดิมเป็นธีมมืด #161625 ตัวอักษรเล็ก) ──────────────
  const BLUE      = '#2F6FED';   // หัวการ์ด / ปุ่ม
  const BLUE_SOFT = '#EAF2FF';   // แถบพื้นหลังอ่อนสำหรับ footer
  const NAVY      = '#0F172A';   // ตัวเลขหลัก อ่านชัดบนพื้นขาว
  const GRAY      = '#64748B';   // label รอง
  const GREEN     = '#059669';   // กำไร (เข้มพออ่านบนพื้นขาว ต่างจาก #00C896 เดิมที่ใช้กับพื้นดำ)
  const RED       = '#DC2626';   // ขาดทุน
  const AMBER     = '#B45309';   // แจ้งเตือน stale
  const SEP       = '#E2E8F0';   // เส้นคั่น

  const isUp     = nwChange == null ? null : nwChange >= 0;
  const chgColor = isUp == null ? GRAY : isUp ? GREEN : RED;
  const chgArrow = isUp == null ? '─' : isUp ? '▲' : '▼';
  const chgText  = nwChange == null
    ? 'ยังไม่มีข้อมูลเมื่อวาน'
    : `${chgArrow} ${fmSign(nwChange, 0)} บาท (${fmSign(nwChangePct)}%)`;

  // Stock row — ใช้แค่ properties ที่ LINE รองรับ
  function stockRow(s, label) {
    if (!s) return null;
    const up    = s.dayChg >= 0;
    const color = up ? GREEN : RED;
    const arrow = up ? '▲' : '▼';
    const name  = s.ticker.replace('.BK', '');
    return {
      type: 'box', layout: 'horizontal', margin: 'lg',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 0,
          contents: [
            { type: 'text', text: label, size: 'sm', color: GRAY, weight: 'bold' },
            { type: 'text', text: name,  size: 'xl', color: NAVY, weight: 'bold', margin: 'xs' },
          ]
        },
        { type: 'filler' },
        {
          type: 'box', layout: 'vertical', flex: 0, alignItems: 'flex-end',
          contents: [
            { type: 'text', text: `${arrow} ${fmSign(s.dayChg)}%`, size: 'xl', color, weight: 'bold', align: 'end' },
            { type: 'text', text: `${s.cur || '฿'}${fm(s.price)}`, size: 'sm', color: GRAY, align: 'end', margin: 'xs' },
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
    { type: 'separator', margin: 'xl', color: SEP },
    { type: 'text', text: 'เคลื่อนไหวโดดเด่น', size: 'sm', color: GRAY, weight: 'bold', margin: 'xl' },
    ...(gRow ? [gRow] : []),
    ...(lRow ? [lRow] : []),
  ] : [];

  const staleNote = staleCount > 0 ? [
    { type: 'text', text: `⚠️ ${staleCount} ตัวใช้ราคาล่าสุดที่มี (ดึงราคาวันนี้ไม่สำเร็จ)`,
      size: 'sm', color: AMBER, margin: 'lg', wrap: true },
  ] : [];

  return {
    type: 'bubble',
    size: 'kilo',
    styles: {
      header: { backgroundColor: BLUE },
      body:   { backgroundColor: '#FFFFFF' },
      footer: { backgroundColor: BLUE_SOFT },
    },
    header: {
      type: 'box', layout: 'horizontal', paddingAll: 'lg', alignItems: 'center',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 1,
          contents: [
            { type: 'text', text: '📈 TradeDesk', size: 'lg', color: '#FFFFFF', weight: 'bold' },
            { type: 'text', text: 'Daily Summary', size: 'sm', color: '#DCEBFF', margin: 'xs' },
          ]
        },
        { type: 'text', text: today, size: 'sm', color: '#DCEBFF', align: 'end', flex: 0, wrap: false },
      ]
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: 'lg',
      contents: [
        { type: 'text', text: 'มูลค่าพอร์ตรวม', size: 'sm', color: GRAY, weight: 'bold' },
        { type: 'text', text: `฿${fm(totalNetWorth, 0)}`, size: '3xl', color: NAVY, weight: 'bold', margin: 'sm', adjustMode: 'shrink-to-fit' },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'vs เมื่อวาน', size: 'sm', color: GRAY, flex: 0 },
            { type: 'text', text: chgText, size: 'md', color: chgColor, weight: 'bold', align: 'end', flex: 1, adjustMode: 'shrink-to-fit' },
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
        style: 'primary', color: BLUE, height: 'sm',
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

// ── Read/write history (equity curve) ────────────────────────────────────────
// สำคัญ: ใช้ Contents API (authenticated, ไม่มี CDN cache) แทน raw.githubusercontent
// เพราะไฟล์นี้สะสมข้อมูลย้อนหลัง — ถ้า read fail แล้วเงียบๆ คืน [] เหมือน readSnapshot()
// รอบ cron ถัดไปจะ push ทับด้วย record เดียว ล้างประวัติทั้งไฟล์หายหมด (บั๊กคลาสเดียวกับ
// ที่เคยเกิดกับ drConversions ตอน buildBackupData() ลืมใส่ฟิลด์)
async function readHistoryWithSha(ghToken) {
  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${HISTORY_PATH}`;
  const ghHeaders = {
    Authorization: `token ${ghToken}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'TradeDesk',
  };
  try {
    const r = await fetch(apiUrl, { headers: ghHeaders });
    if (r.ok) {
      const j = await r.json();
      const decoded = atob(j.content.replace(/\n/g, ''));
      const arr = JSON.parse(decoded);
      return { list: Array.isArray(arr) ? arr : [], sha: j.sha, ok: true };
    }
    if (r.status === 404) return { list: [], sha: null, ok: true }; // ไฟล์ยังไม่เคยถูกสร้าง — ว่างจริง ไม่ใช่ fetch fail
  } catch {}
  return { list: null, sha: null, ok: false }; // fetch/parse fail จริง — ok:false ต้อง "ไม่เขียนทับ"
}

async function writeHistory(ghToken, historyArr, sha) {
  if (!ghToken) return false;
  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${HISTORY_PATH}`;
  const ghHeaders = {
    Authorization: `token ${ghToken}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'TradeDesk',
    'Content-Type': 'application/json',
  };

  const raw   = JSON.stringify(historyArr, null, 2);
  const bytes = new TextEncoder().encode(raw);
  let b64str  = '';
  bytes.forEach(b => { b64str += String.fromCharCode(b); });
  const b64  = btoa(b64str);
  const body = { message: 'chore: append portfolio-history snapshot', content: b64 };
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

    // FIX: กองทุนรวม (มี currentNav manual ในไฟล์) ไม่ต้องยิง price API —
    // เดิมยิงแล้ว 404 ทุกครั้ง ทำให้ทั้งพอร์ต DIME/BBL-Tax/WealthX หายจาก net worth
    const tickerSet = new Set();
    portfolios.forEach(p => (p.stocks || []).forEach(s => {
      if (s.ticker && !(s.currentNav > 0)) tickerSet.add(s.ticker);
    }));
    const baseUrl  = new URL(req.url).origin;
    const priceMap = {};
    await Promise.all([...tickerSet].map(async t => {
      const p = await fetchPrice(t, baseUrl);
      if (p) priceMap[t] = p;
    }));

    // FIX: หุ้น US (พอร์ต type realtime_us) ต้องแปลง USD → THB ก่อนบวกรวม
    // เดิมบวกราคา USD ดิบๆ ทำให้ net worth ต่ำกว่าจริงเป็นแสนบาท
    // fallback: FX จาก snapshot เมื่อวาน → ค่าคงที่สุดท้ายกันหารด้วยศูนย์
    const fxLive = await fetchPrice('USDTHB=X', baseUrl);
    const usdThb = fxLive || ((snapshot && snapshot.fx > 0) ? snapshot.fx : 33.6);

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
    const byPortfolio = {}; // มูลค่ารวมแยกตามพอร์ต (สำหรับ equity curve)
    portfolios.forEach(p => {
      const isUS = p.type === 'realtime_us';
      let portfolioTotal = 0;
      (p.stocks || []).forEach(s => {
        if (!s.qty) return;
        // กองทุนรวม: ใช้ NAV (THB) จาก portfolio-data.json ตรงๆ ไม่เข้าชิง gainer/loser
        if (s.currentNav > 0) { totalNetWorth += s.currentNav * s.qty; portfolioTotal += s.currentNav * s.qty; return; }
        const price = effPrice[s.ticker];          // ราคา native (US = USD)
        if (!price) return;
        const value  = price * s.qty;              // มูลค่า native
        const cost   = (s.buyPrice || 0) * s.qty;  // ต้นทุน native สกุลเดียวกัน
        const pnlPct = cost > 0 ? ((value - cost) / cost) * 100 : null;
        const valueThb = value * (isUS ? usdThb : 1);
        totalNetWorth += valueThb;
        portfolioTotal += valueThb;
        // เฉพาะตัวที่ได้ราคาสดจริงเท่านั้นถึงเข้าชิง gainer/loser
        if (pnlPct != null && priceMap[s.ticker]) {
          stockValues.push({ ticker: s.ticker, price, pnlPct, cur: isUS ? '$' : '฿' });
        }
      });
      byPortfolio[p.id] = Math.round(portfolioTotal * 100) / 100;
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
      fx:       usdThb,
      prices:   effPrice,
    });

    // Equity curve: append record จริง (ไม่ approximate) ทุกครั้งที่ cron รัน
    let historySaved = false;
    try {
      const { list, sha, ok } = await readHistoryWithSha(GH_TOKEN);
      if (ok) {
        list.push({
          date:        new Date().toISOString(),
          totalTHB:    Math.round(totalNetWorth * 100) / 100,
          byPortfolio, // ของจริงจากรอบนี้ ไม่ใช่ approximation
        });
        // กันไฟล์บวมไม่จำกัด — เก็บแค่ N record ล่าสุด
        const trimmed = list.length > HISTORY_MAX ? list.slice(list.length - HISTORY_MAX) : list;
        historySaved = await writeHistory(GH_TOKEN, trimmed, sha);
      }
      // ok:false = อ่านไฟล์เดิมไม่สำเร็จ (network/parse error) → "ไม่เขียน" แทนที่จะเขียนทับด้วย
      // record เดียว (ป้องกันบั๊กคลาสเดียวกับที่เคยล้าง drConversions หายทั้งลิสต์)
    } catch {}

    return new Response(JSON.stringify({ ok: true, totalNetWorth, nwChange, snapshotSaved, historySaved, staleCount, stockCount: stockValues.length }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
