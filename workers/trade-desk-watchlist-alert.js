/**
 * trade-desk-watchlist-alert — Cloudflare Worker
 * เช็ค DCA buy watchlist ทุก 5 นาที (cron เดิม: every5min 3-10 * * 1-5 = 10:00-17:00 ICT จ-ศ)
 *
 * Features:
 *   - ราคาถึงเป้า → LINE Flex Message (ธีมเดียวกับ Daily Summary)
 *   - 🔻🔺 S/R Alert — แนวรับ/แนวต้าน underlying + แผน (วันละครั้ง 10:00-10:04 ICT)
 *       [จำกัดขอบเขต] คำนวณเฉพาะหุ้นในพอร์ต dr1 (SET DR) + DIME-USA เท่านั้น (ไม่รวมพอร์ตอื่น)
 *       เก็บค่าแนวรับ/แนวต้านลง stock.srSupport / stock.srResist ให้หน้าเว็บโชว์ในตาราง
 *       (DR แปลงเป็น THB ผ่าน conversion ratio, US ใช้ USD ตรงๆ) · alert LINE จำกัด SR_MAX_ALERTS ตัว/รอบ
 *   - [ใหม่] 🛢️ OIL03 Signal — 3 สัญญาณอิสระ (วันละครั้ง 10:05-10:09 ICT):
 *       value buy : WTI < $65  AND  USDTHB < 32.50
 *       rsi_buy   : RSI(WTI,14) < 30
 *       rsi_sell  : RSI(WTI,14) > 70
 *     dedup ต่อสัญญาณ 1 ครั้ง/วัน — เก็บใน _srAlerts (key ขึ้นต้น "oil03:") ซึ่ง frontend preserve อยู่แล้ว
 *   - 📈 Trend Score Alert — Strong Buy/Sell จาก /api/trend-score (วันละครั้ง 10:10-10:14 ICT):
 *       สโคปเฉพาะหุ้นแม่ของ SET DR (dr1, ใช้ parentTicker) + หุ้นใน DIME-USA เท่านั้น (ไม่รวมพอร์ตอื่น/watchlist กันเปลือง)
 *       ยิง 1 request ไป /api/trend-score (ไม่ fetch Yahoo ตรงจาก worker เอง กันชน subrequest limit) · score > 50 = Strong Buy, < -50 = Strong Sell
 *     dedup ต่อ ticker+label 1 ครั้ง/วัน — เก็บใน _srAlerts (key ขึ้นต้น "trend:")
 *   - 🔄 Reversal Signal Alert — Bullish Divergence/Volume Exhaustion/Hammer/Engulfing
 *       จาก /api/reversal-signal timeframe='day' (วันละครั้ง 10:15-10:19 ICT) สโคปเดียวกับ Trend Score
 *     dedup ต่อ ticker+ชุดสัญญาณ 1 ครั้ง/วัน — เก็บใน _srAlerts (key ขึ้นต้น "reversal:")
 *   - GET /trigger /sr-trigger /oil-trigger /trend-trigger /reversal-trigger /watchlist
 *
 * env: LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID, GITHUB_TOKEN (+ ALERT_SECRET เสริม)
 */

const REPO       = 'claimloss-lab/trade-desk';
const DATA_PATH  = 'public/portfolio-data.json';
const BASE_URL   = 'https://trade-desk.pages.dev';
const GITHUB_API = 'https://api.github.com';
const SELF_URL   = 'https://trade-desk-watchlist-alert.claimloss.workers.dev';

// S/R config
const SR_ZONE_PCT   = 2;
const SR_DEDUP_DAYS = 7;
const SR_MAX_SYMBOLS = 40;
// พอร์ตที่จะเขียนค่าแนวรับ/แนวต้าน (srSupport/srResist) ลงในแต่ละหุ้น เพื่อโชว์ในตารางเว็บ
const SR_DISPLAY_PORT_IDS = ['dr1', 'p_1778723407199']; // SET DR, DIME-USA
// จำกัดจำนวน alert ที่จะยิง LINE ต่อรอบ (แต่ละ alert ต้อง fetch ราคาเพิ่ม 1 ครั้ง) — กัน "Too many subrequests"
// บน Cloudflare Free Plan (จำกัด 50 subrequest/การรัน — ใช้ไปแล้ว ~36 ครั้งกับ fetchTechnicals ของทุกพอร์ตรวมกัน)
const SR_MAX_ALERTS = 8;

// OIL03 config (สัญญาณแยกอิสระ)
const OIL03_WTI_MAX  = 65.0;    // น้ำมันลงเยอะ (USD/bbl)
const OIL03_FX_MAX   = 32.50;   // บาทแข็ง (USDTHB)
const OIL03_RSI_P    = 14;
const OIL03_RSI_BUY  = 30;      // oversold → ซื้อ
const OIL03_RSI_SELL = 70;      // overbought → ขาย

// Trend Score alert config
const TREND_MAX_SYMBOLS = 40;   // จำกัด ticker/รอบ กัน payload ใหญ่เกิน (เหมือน SR_MAX_SYMBOLS)
const TREND_STRONG_BUY  = 50;   // score > นี้ = Strong Buy
const TREND_STRONG_SELL = -50;  // score < นี้ = Strong Sell
const TREND_MAX_ALERTS  = 8;    // จำกัดจำนวน LINE alert/รอบ (เหมือน SR_MAX_ALERTS)

// Reversal Signal alert config
const REVERSAL_MAX_ALERTS = 8;  // จำกัดจำนวน LINE alert/รอบ

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  bgHead: '#2F6FED', bgBody: '#FFFFFF', bgFoot: '#EAF2FF',
  headerTitle: '#FFFFFF', headerSub: '#DCEBFF',
  blue: '#2F6FED', green: '#059669', red: '#DC2626',
  txt: '#0F172A', dim: '#64748B', dim2: '#94A3B8', sep: '#E2E8F0',
  gold: '#B45309',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (env.ALERT_SECRET) {
      const key = url.searchParams.get('key');
      const guarded = ['/trigger', '/watchlist', '/sr-trigger', '/oil-trigger', '/trend-trigger', '/reversal-trigger']; // /oil-status, /oil-data เปิดสาธารณะ (read-only)
      if (guarded.includes(url.pathname) && key !== env.ALERT_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }
    }

    if (url.pathname === '/trigger') {
      try {
        const result = await checkWatchlist(env);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/sr-trigger') {
      try {
        const result = await checkSupportResistance(env);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/oil-trigger') {
      try {
        const result = await checkOil03(env);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/trend-trigger') {
      try {
        const result = await checkTrendAlerts(env);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/reversal-trigger') {
      try {
        const result = await checkReversalAlerts(env);
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/oil-status') {
      const html = await renderOil03Status(env);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Public read-only data API — ระบบ/สคริปต์ภายนอกยิง GET มาแล้วรับค่ากลับเป็น JSON
    // (ไม่ยิง LINE ไม่เขียน state ต่างจาก /oil-trigger)
    if (url.pathname === '/oil-data') {
      let ev, err = null;
      try { ev = await evalOil03(env); } catch (e) { err = e.message; ev = { ok: false }; }
      const payload = {
        ok: !!ev.ok,
        error: err,
        checkedAt: new Date().toISOString(),
        wti: ev.wti ?? null,
        usdthb: ev.fx ?? null,
        rsi: ev.rsi != null ? +ev.rsi.toFixed(2) : null,
        thresholds: { wtiMax: OIL03_WTI_MAX, fxMax: OIL03_FX_MAX, rsiBuy: OIL03_RSI_BUY, rsiSell: OIL03_RSI_SELL },
        signals: ev.met || { value: false, rsi_buy: false, rsi_sell: false },
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (url.pathname === '/watchlist') {
      const result = await sendWatchlistSummary(env);
      const ok = result && result.ok;
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<body style="font-family:sans-serif;background:#0F0F1A;color:#E2E8F0;display:flex;align-items:center;justify-content:center;height:90vh;margin:0">` +
        `<div style="text-align:center"><div style="font-size:42px">${ok ? '✅' : '❌'}</div>` +
        `<p>${ok ? 'ส่งสรุป watchlist เข้า LINE แล้ว<br>ปิดหน้านี้ได้เลย' : 'ส่งไม่สำเร็จ: ' + (result.error || 'unknown')}</p></div></body>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: ok ? 200 : 500 }
      );
    }

    return new Response('trade-desk-watchlist-alert running.\nGET /trigger · /sr-trigger · /oil-trigger · /oil-status · /oil-data · /watchlist', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    // รันเรียงลำดับ (await ต่อกัน) แทนการยิง ctx.waitUntil หลายอันพร้อมกัน
    // เพื่อกันชนการอ่าน/เขียน SHA ของ portfolio-data.json ซ้อนกัน (409 conflict / เขียนทับกันเงียบๆ)
    ctx.waitUntil((async () => {
      await checkWatchlist(env);
      const now = new Date();
      const h = now.getUTCHours(), m = now.getUTCMinutes();
      // S/R: รอบแรกของวัน 10:00-10:04 ICT (03:00-03:04 UTC) — เขียน srSupport/srResist ให้ dr1+DIME-USA ด้วย
      if (h === 3 && m < 5) await checkSupportResistance(env);
      // OIL03: รอบถัดไป 10:05-10:09 ICT (03:05-03:09 UTC)
      if (h === 3 && m >= 5 && m < 10) await checkOil03(env);
      // Trend Score: รอบถัดไป 10:10-10:14 ICT (03:10-03:14 UTC)
      if (h === 3 && m >= 10 && m < 15) await checkTrendAlerts(env);
      // Reversal Signal: รอบถัดไป 10:15-10:19 ICT (03:15-03:19 UTC)
      if (h === 3 && m >= 15 && m < 20) await checkReversalAlerts(env);
    })());
  },
};

// ── Data helpers ─────────────────────────────────────────────────────────────
async function fetchPortfolioData(env) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${DATA_PATH}`, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'TradeDesk-Watchlist',
    },
  });
  if (!res.ok) throw new Error('GitHub fetch failed: ' + res.status);
  const j = await res.json();
  const bin = atob(j.content.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { data: JSON.parse(new TextDecoder('utf-8').decode(bytes)), sha: j.sha };
}

async function savePortfolioData(env, data, sha, message) {
  const jsonStr = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(jsonStr);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${DATA_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'TradeDesk-Watchlist',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, content: btoa(bin), sha }),
  });
  return res.ok;
}

async function fetchPrice(ticker) {
  try {
    const r = await fetch(`${BASE_URL}/api/price?ticker=${encodeURIComponent(ticker)}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d.price === 'number' && d.price > 0 ? d.price : null;
  } catch { return null; }
}

async function pushFlex(env, altText, contents) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'flex', altText, contents }] }),
  });
  return res.ok;
}

function fn(n, d = 2) {
  if (n == null || isNaN(n)) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function watchlistUrl(env) {
  return SELF_URL + '/watchlist' + (env.ALERT_SECRET ? `?key=${env.ALERT_SECRET}` : '');
}

// ── Flex builders (shared) ───────────────────────────────────────────────────
function rowKV(label, value, valueColor, bold) {
  return {
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'md', color: C.dim, flex: 0 },
      { type: 'text', text: value, size: 'md', color: valueColor || C.txt,
        weight: bold ? 'bold' : 'regular', align: 'end', flex: 1 },
    ],
  };
}

function pendingRows(pending, priceMap) {
  const rows = [];
  pending.forEach(w => {
    const cur = priceMap[w.ticker];
    const away = (cur && w.targetPrice > 0) ? ((cur - w.targetPrice) / w.targetPrice) * 100 : null;
    rows.push({
      type: 'box', layout: 'horizontal', margin: 'md',
      contents: [
        {
          type: 'box', layout: 'vertical', flex: 1,
          contents: [
            { type: 'text', text: String(w.ticker), size: 'lg', color: C.txt, weight: 'bold' },
            { type: 'text', text: `เป้า ฿${fn(w.targetPrice)} · ${w.qty || '-'} หุ้น`, size: 'sm', color: C.dim, margin: 'xs' },
          ],
        },
        {
          type: 'box', layout: 'vertical', flex: 0, alignItems: 'flex-end',
          contents: [
            { type: 'text', text: cur ? `฿${fn(cur)}` : 'n/a', size: 'lg', color: C.txt, align: 'end' },
            { type: 'text',
              text: away == null ? '' : (away <= 0 ? 'ต่ำกว่าเป้า!' : `ห่าง +${fn(away, 1)}%`),
              size: 'sm', color: away != null && away <= 0 ? C.green : C.dim2, align: 'end', margin: 'xs' },
          ],
        },
      ],
    });
  });
  return rows;
}

function footerButtons(env) {
  return {
    type: 'box', layout: 'vertical', paddingAll: 'md', spacing: 'sm',
    contents: [
      { type: 'button', style: 'primary', color: C.blue, height: 'sm',
        action: { type: 'uri', label: 'เปิด TradeDesk', uri: BASE_URL } },
      { type: 'button', style: 'secondary', height: 'sm',
        action: { type: 'uri', label: '📋 ดู watchlist ที่เหลือ', uri: watchlistUrl(env) } },
    ],
  };
}

function headerBox(title, subtitle) {
  return {
    type: 'box', layout: 'vertical', paddingAll: 'lg',
    contents: [
      { type: 'text', text: title, size: 'lg', color: C.headerTitle, weight: 'bold' },
      { type: 'text', text: subtitle, size: 'sm', color: C.headerSub, margin: 'xs' },
    ],
  };
}

function bubbleStyles() {
  return {
    header: { backgroundColor: C.bgHead },
    body:   { backgroundColor: C.bgBody },
    footer: { backgroundColor: C.bgFoot },
  };
}

function buildHitFlex(env, hits, remaining, priceMap) {
  const hitBoxes = [];
  hits.forEach((h, i) => {
    if (i > 0) hitBoxes.push({ type: 'separator', margin: 'lg', color: C.sep });
    hitBoxes.push({
      type: 'box', layout: 'vertical', margin: i > 0 ? 'lg' : 'none',
      contents: [
        { type: 'text', text: String(h.ticker), size: 'xl', color: C.txt, weight: 'bold' },
        rowKV('ราคาปัจจุบัน', `฿${fn(h.price)}`, C.green, true),
        rowKV(`เป้าซื้อ (${h.cond === 'below' ? '≤' : '≥'})`, `฿${fn(h.targetPrice)}`, C.txt),
        ...(h.qty ? [rowKV('จำนวนที่วางแผน', `${h.qty} หุ้น ≈ ฿${fn(h.price * h.qty, 0)}`, C.txt)] : []),
        ...(h.note ? [{ type: 'text', text: `📝 ${h.note}`, size: 'sm', color: C.dim2, margin: 'sm', wrap: true }] : []),
      ],
    });
  });

  const remainSection = remaining.length ? [
    { type: 'separator', margin: 'xl', color: C.sep },
    { type: 'text', text: `รอซื้ออีก ${remaining.length} ตัว`, size: 'sm', color: C.dim, weight: 'bold', margin: 'xl' },
    ...pendingRows(remaining, priceMap),
  ] : [
    { type: 'separator', margin: 'xl', color: C.sep },
    { type: 'text', text: '🎉 ไม่เหลือรายการรอซื้อแล้ว', size: 'sm', color: C.dim, margin: 'xl' },
  ];

  return {
    type: 'bubble', size: 'kilo',
    styles: bubbleStyles(),
    header: headerBox('🎯 TradeDesk · ราคาถึงเป้า!', 'Buy Watchlist (DCA)'),
    body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents: [...hitBoxes, ...remainSection] },
    footer: footerButtons(env),
  };
}

function buildSummaryFlex(env, pending, priceMap) {
  const today = new Date().toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });
  const body = pending.length
    ? [
        { type: 'text', text: `รอซื้อ ${pending.length} ตัว`, size: 'sm', color: C.dim, weight: 'bold' },
        ...pendingRows(pending, priceMap),
      ]
    : [{ type: 'text', text: '🎉 ไม่มีรายการรอซื้อใน watchlist', size: 'lg', color: C.txt }];

  return {
    type: 'bubble', size: 'kilo',
    styles: bubbleStyles(),
    header: headerBox('📋 TradeDesk · Buy Watchlist', today),
    body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents: body },
    footer: footerButtons(env),
  };
}

// ── Core: Watchlist ──────────────────────────────────────────────────────────
function getPending(data) {
  const watchlist = data.watchlist || [];
  return watchlist.filter(w => w.status === 'pending' && !w._notified);
}

async function priceMapFor(items) {
  const map = {};
  await Promise.all(items.map(async w => {
    const p = await fetchPrice(w.ticker);
    if (p) map[w.ticker] = p;
  }));
  return map;
}

async function checkWatchlist(env) {
  const { data, sha } = await fetchPortfolioData(env);
  const pending = getPending(data);
  if (!pending.length) return { checked: 0, alerts: [] };

  const priceMap = await priceMapFor(pending);

  const hits = [];
  pending.forEach(w => {
    const price = priceMap[w.ticker];
    if (!price || !w.targetPrice) return;
    const hit = (w.cond === 'below' && price <= w.targetPrice) ||
                (w.cond === 'above' && price >= w.targetPrice);
    if (hit) hits.push({ ...w, price });
  });

  if (!hits.length) return { checked: pending.length, alerts: [] };

  const remaining = pending.filter(w => !hits.find(h => h.ticker === w.ticker && h.targetPrice === w.targetPrice));
  const altText = `🎯 ราคาถึงเป้า: ${hits.map(h => `${h.ticker} ฿${fn(h.price)}`).join(', ')}`;
  const sent = await pushFlex(env, altText, buildHitFlex(env, hits, remaining, priceMap));

  let saved = false;
  if (sent) {
    hits.forEach(h => {
      const w = (data.watchlist || []).find(x => x.ticker === h.ticker && x.targetPrice === h.targetPrice && x.status === 'pending');
      if (w) { w._notified = true; w._notifiedAt = new Date().toISOString(); w._notifiedPrice = h.price; }
    });
    saved = await savePortfolioData(env, data, sha, 'chore: watchlist alert notified flags');
  }

  return { checked: pending.length, alerts: hits.map(h => h.ticker), lineSent: sent, flagsSaved: saved };
}

// ── Core: Support / Resistance ───────────────────────────────────────────────
function yahooSym(t) {
  if (/\.(BK|HK|PA|T|CO|DE|MI|L|AX)$/i.test(t)) return t;
  return t.replace('.', '-');
}

function isMFTicker(t) {
  return t.includes('(A)') || t.startsWith('K-') || t.startsWith('MEGA') ||
         t.includes('RMF') || t.includes('BGOLD') || t.includes('ESG');
}

function collectHoldings(data) {
  const bySym = {};
  const portsArr = Array.isArray(data.portfolios) ? data.portfolios : Object.values(data.portfolios || {});
  // จำกัดเฉพาะ dr1 (SET DR) + DIME-USA — ไม่คำนวณ S/R ให้พอร์ตอื่นแล้ว (ลด subrequest + ตรงตามที่ต้องการ)
  portsArr.filter(p => SR_DISPLAY_PORT_IDS.includes(p.id)).forEach(port => {
    (port.stocks || []).forEach(s => {
      if (!s.ticker || isMFTicker(s.ticker)) return;
      const uSym = s.ticker.includes('.') ? s.ticker
                 : (port.type === 'realtime_us' ? s.ticker : s.ticker.replace(/\d+$/, ''));
      if (!uSym || bySym[uSym]) return;
      bySym[uSym] = { uSym, holdTicker: s.ticker, buyPrice: s.buyPrice, qty: s.qty, portId: port.id };
    });
  });
  return Object.values(bySym).slice(0, SR_MAX_SYMBOLS);
}

async function fetchTechnicals(uSym) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(uSym))}?range=1y&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j.chart?.result?.[0];
    const closes = (res?.indicators?.quote?.[0]?.close || []).filter(x => x != null);
    if (closes.length < 70) return null;
    const last = closes[closes.length - 1];
    const win = closes.slice(-68, -5);
    const support = Math.min(...win);
    const resist  = Math.max(...win);
    const cur = res.meta?.currency || '';
    return { last, support, resist, currency: cur };
  } catch { return null; }
}

function srPlan(side, pnlPct) {
  if (side === 'support') {
    if (pnlPct != null && pnlPct < 0)
      return 'แผน: ราคาลงมาที่แนวรับและต่ำกว่าทุน — ถ้ายืนแนวรับได้ (ไม่ปิดต่ำกว่าเส้น 2-3 วัน) เป็นจังหวะทยอยสะสม/DCA · ถ้าหลุดแนวรับ ชะลอการถัว รอฐานใหม่ก่อน';
    return 'แผน: ย่อลงมาใกล้แนวรับแต่ยังมีกำไร — รอดูการยืนแนวรับ ถ้าเด้งกลับ = โอกาสเพิ่มสถานะ · ถ้าหลุด พิจารณาลดความเสี่ยงบางส่วน';
  }
  if (pnlPct != null && pnlPct > 20)
    return 'แผน: ใกล้แนวต้าน + กำไรสะสมสูง — พิจารณา trim บางส่วนตามแผน rebalance ล็อกกำไร · ถ้าทะลุแนวต้านพร้อมวอลุ่ม ถือส่วนที่เหลือต่อ';
  return 'แผน: กำลังทดสอบแนวต้าน — ทะลุได้ = สัญญาณแข็งแรง ถือต่อ · ทดสอบไม่ผ่าน 2-3 รอบ พิจารณาแบ่งขายบางส่วน';
}

function buildSRFlex(env, alerts) {
  const boxes = [];
  alerts.forEach((a, i) => {
    if (i > 0) boxes.push({ type: 'separator', margin: 'lg', color: C.sep });
    const isSup = a.side === 'support';
    boxes.push({
      type: 'box', layout: 'vertical', margin: i > 0 ? 'lg' : 'none',
      contents: [
        { type: 'text', text: `${isSup ? '🔻' : '🔺'} ${a.uSym}`, size: 'xl',
          color: isSup ? C.red : C.gold, weight: 'bold' },
        rowKV('ราคา (underlying)', `${fn(a.last)} ${a.currency}`, C.txt, true),
        rowKV(isSup ? 'แนวรับ 3 เดือน' : 'แนวต้าน 3 เดือน', `${fn(a.level)} ${a.currency}`, isSup ? C.red : C.gold),
        rowKV('ระยะห่าง', `${a.dist >= 0 ? '' : '-'}${fn(Math.abs(a.dist), 1)}%${a.crossed ? (isSup ? ' (หลุดแล้ว!)' : ' (ทะลุแล้ว!)') : ''}`,
          a.crossed ? (isSup ? C.red : C.green) : C.txt),
        ...(a.pnlPct != null ? [rowKV(`P&L ${a.holdTicker}`, `${a.pnlPct >= 0 ? '+' : ''}${fn(a.pnlPct, 1)}%`,
          a.pnlPct >= 0 ? C.green : C.red)] : []),
        { type: 'text', text: srPlan(a.side, a.pnlPct), size: 'sm', color: C.dim2, margin: 'sm', wrap: true },
      ],
    });
  });

  const today = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });

  return {
    type: 'bubble', size: 'kilo',
    styles: bubbleStyles(),
    header: headerBox('📐 TradeDesk · แนวรับ-แนวต้าน', `Support/Resistance Alert · ${today}`),
    body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents: boxes },
    footer: footerButtons(env),
  };
}

function uSymFor(s, portType) {
  if (s.ticker.includes('.')) return s.ticker;
  return portType === 'realtime_us' ? s.ticker : s.ticker.replace(/\d+$/, '');
}

// Fibonacci Extension — หาแนวต้านถัดไปเมื่อราคาทะลุแนวต้านเดิมไปแล้ว (ทำจุดสูงสุดใหม่ ไม่มีประวัติราคาสูงกว่าให้อ้างอิง)
// วัด swing move จาก support (จุดต่ำสุดในช่วง) → resist (จุดสูงสุดเดิมที่เพิ่งถูกทะลุ) แล้วโปรเจกต์ต่อ
// เลือกระดับ extension ที่ต่ำที่สุดซึ่งยังอยู่ "เหนือ" ราคาปัจจุบัน (เผื่อราคาวิ่งทะลุไปหลายระดับแล้ว)
const FIB_EXTENSIONS = [1.272, 1.618, 2.0, 2.618];
function nextFibResistance(support, resist, last) {
  const move = resist - support;
  if (!(move > 0)) return resist;
  for (const r of FIB_EXTENSIONS) {
    const level = support + move * r;
    if (level > last) return level;
  }
  // ราคาวิ่งทะลุทุกระดับมาตรฐานแล้ว (เคสรุนแรงมาก) — ขยับ ratio ต่อไปเรื่อยๆ ทีละ 0.618 จนกว่าจะเหนือราคาปัจจุบัน
  let r = FIB_EXTENSIONS[FIB_EXTENSIONS.length - 1];
  let level = support + move * r;
  while (level <= last) { r += 0.618; level = support + move * r; }
  return level;
}

async function fetchUSDTHB() {
  try {
    const r = await yfChart('USDTHB=X', '1d');
    const fx = r.meta?.regularMarketPrice;
    return typeof fx === 'number' ? fx : null;
  } catch { return null; }
}

async function checkSupportResistance(env) {
  const { data, sha } = await fetchPortfolioData(env);
  const holdings = collectHoldings(data);
  if (!holdings.length) return { checked: 0, alerts: [] };

  const state = data._srAlerts || {};
  const now = Date.now();
  const fresh = key => {
    const t = state[key] ? Date.parse(state[key]) : 0;
    return t && (now - t) < SR_DEDUP_DAYS * 86400e3;
  };

  const techMap = {}; // uSym -> { last, support, resist, currency }
  const alerts = [];
  await Promise.all(holdings.map(async h => {
    const t = await fetchTechnicals(h.uSym);
    if (!t) return;
    techMap[h.uSym] = t;
    const distSup = (t.last - t.support) / t.support * 100;
    const distRes = (t.resist - t.last) / t.resist * 100;
    let side = null, level = null, dist = null;
    const inSup = distSup <= SR_ZONE_PCT;
    const inRes = distRes <= SR_ZONE_PCT;
    if (inSup && (!inRes || Math.abs(distSup) <= Math.abs(distRes))) { side = 'support'; level = t.support; dist = distSup; }
    else if (inRes) { side = 'resist'; level = t.resist; dist = distRes; }
    if (!side) return;
    const key = `${h.uSym}_${side}`;
    if (fresh(key)) return;
    alerts.push({ ...h, side, level, dist, crossed: dist < 0, last: t.last, currency: t.currency });
  }));

  // เขียนแนวรับ/แนวต้านลงหุ้นแต่ละตัวใน SR_DISPLAY_PORT_IDS ให้เว็บโชว์ในตารางได้ (ทำเสมอ ไม่ขึ้นกับว่ามี alert หรือไม่)
  // DR: แปลงจากราคาหุ้นแม่ (USD) → THB ผ่าน conversion ratio (เหมือนเดิมที่เคยใช้ใน DR Fair Value)
  // US (DIME-USA): ใช้ตรงๆ เพราะราคาที่โชว์ในตารางก็เป็น USD อยู่แล้ว
  let srUpdated = 0;
  const portsArr = Array.isArray(data.portfolios) ? data.portfolios : Object.values(data.portfolios || {});
  const displayPorts = portsArr.filter(p => SR_DISPLAY_PORT_IDS.includes(p.id));
  if (displayPorts.length) {
    const needsFx = displayPorts.some(p => p.type === 'realtime_dr');
    const fx = needsFx ? await fetchUSDTHB() : null;
    const today = todayICT();
    displayPorts.forEach(port => {
      (port.stocks || []).forEach(s => {
        const uSym = uSymFor(s, port.type);
        const t = techMap[uSym];
        if (!t) return;
        // ถ้าราคาทะลุแนวต้านเดิมไปแล้ว (ทำจุดสูงสุดใหม่เหนือช่วง 3 เดือนที่ใช้คำนวณ) ใช้ Fibonacci Extension แทน
        const isBreakout = t.last > t.resist;
        const resistUnderlying = isBreakout ? nextFibResistance(t.support, t.resist, t.last) : t.resist;
        if (port.type === 'realtime_dr') {
          if (!s.conversion || !fx) return;
          s.srSupport = +(t.support * fx / s.conversion).toFixed(4);
          s.srResist  = +(resistUnderlying * fx / s.conversion).toFixed(4);
        } else {
          s.srSupport = +t.support.toFixed(4);
          s.srResist  = +resistUnderlying.toFixed(4);
        }
        s.srResistIsExt = isBreakout; // true = แนวต้านนี้เป็น Fib extension (โปรเจกต์) ไม่ใช่จุดสูงสุดจริงในอดีต
        s.srUpdated = today;
        srUpdated++;
      });
    });
  }

  if (!alerts.length && !srUpdated) return { checked: holdings.length, alerts: [] };

  const totalAlertsFound = alerts.length;
  // เรียงเอาที่ใกล้แนวรับ/แนวต้านที่สุดก่อน แล้วตัดเหลือ SR_MAX_ALERTS ตัว ก่อนไป fetch ราคาเพิ่ม (กัน subrequest เกิน)
  alerts.sort((x, y) => Math.abs(x.dist) - Math.abs(y.dist));
  const capped = alerts.slice(0, SR_MAX_ALERTS);

  let sent = false;
  if (capped.length) {
    await Promise.all(capped.map(async a => {
      const p = await fetchPrice(a.holdTicker);
      a.pnlPct = (p && a.buyPrice) ? (p - a.buyPrice) / a.buyPrice * 100 : null;
    }));
    const altText = `📐 แนวรับ-แนวต้าน: ${capped.map(a => `${a.side === 'support' ? '🔻' : '🔺'}${a.uSym}`).join(' ')}`
      + (totalAlertsFound > capped.length ? ` (+${totalAlertsFound - capped.length} ตัวอื่น)` : '');
    sent = await pushFlex(env, altText, buildSRFlex(env, capped));
  }

  let saved = false;
  if (sent || srUpdated) {
    if (sent) {
      const iso = new Date().toISOString();
      capped.forEach(a => { state[`${a.uSym}_${a.side}`] = iso; });
      Object.keys(state).forEach(k => {
        if (now - Date.parse(state[k]) > 30 * 86400e3) delete state[k];
      });
      data._srAlerts = state;
    }
    saved = await savePortfolioData(env, data, sha, srUpdated ? `chore: sync S/R levels (${srUpdated} รายการ) + alert dedupe state` : 'chore: S/R alert dedupe state');
  }

  return { checked: holdings.length, alertsFound: totalAlertsFound, alertsSent: capped.map(a => `${a.uSym}:${a.side}`), srUpdated, lineSent: sent, stateSaved: saved };
}

// ── Core: OIL03 Signal (สัญญาณแยกอิสระ) ───────────────────────────────────────
async function yfChart(sym, range) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`yf ${sym} ${r.status}`);
  const j = await r.json();
  const res = j.chart?.result?.[0];
  if (!res) throw new Error(`yf ${sym} no result`);
  return res;
}

// FRED fallback — ใช้เฉพาะตอน Yahoo ล่ม/ข้อมูลไม่ครบ (ไม่ใช่แหล่งหลัก)
// DCOILWTICO = WTI Cushing spot price รายวัน, อาจ lag 1 วันเทียบ Yahoo realtime
async function fetchFredSeries(env, seriesId, limit = 110) {
  const key = env.FRED_API_KEY;
  if (!key) throw new Error('FRED_API_KEY not set');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`FRED ${seriesId} fetch failed: ${r.status}`);
  const j = await r.json();
  const obs = (j.observations || [])
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: Number(o.value) }));
  if (!obs.length) throw new Error(`FRED ${seriesId} empty`);
  return obs; // newest first (sort_order=desc)
}

async function fetchFredWTI(env) {
  const obs = await fetchFredSeries(env, 'DCOILWTICO', 110);
  return {
    latest: obs[0].value,
    closesAsc: obs.slice().reverse().map(o => o.value), // oldest→newest for RSI calc
  };
}

// RSI แบบ Wilder smoothing
function rsiWilder(closes, p = OIL03_RSI_P) {
  if (closes.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function todayICT() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}

function buildOil03Flex(env, kind, m) {
  const isSell = kind === 'rsi_sell';
  const title = kind === 'value'   ? '🛢️ OIL03 · น้ำมันถูก + บาทแข็ง'
              : kind === 'rsi_buy' ? '🛢️ OIL03 · RSI Oversold'
              :                      '🔺 OIL03 · RSI Overbought';
  const sub   = kind === 'value'   ? 'Buy Signal · value zone'
              : kind === 'rsi_buy' ? 'Buy Signal · RSI < 30'
              :                      'Sell Signal · RSI > 70';

  const rows = [];
  if (kind === 'value') {
    rows.push(
      rowKV('WTI Crude', `$${fn(m.wti)}`, C.green, true),
      rowKV('เกณฑ์ WTI', `< $${OIL03_WTI_MAX.toFixed(0)}`, C.dim),
      rowKV('USDTHB', `฿${fn(m.fx)}`, C.green, true),
      rowKV('เกณฑ์บาท', `< ฿${OIL03_FX_MAX.toFixed(2)}`, C.dim),
      rowKV('RSI (WTI,14)', fn(m.rsi, 1), C.txt),
    );
  } else {
    rows.push(
      rowKV('RSI (WTI,14)', fn(m.rsi, 1), isSell ? C.red : C.green, true),
      rowKV('เกณฑ์', isSell ? `> ${OIL03_RSI_SELL}` : `< ${OIL03_RSI_BUY}`, C.dim),
      rowKV('WTI Crude', `$${fn(m.wti)}`, C.txt),
      rowKV('USDTHB', `฿${fn(m.fx)}`, C.txt),
    );
  }
  if (m.wtiSource === 'fred') {
    rows.push({ type: 'text', text: '⚠️ WTI จาก FRED (Yahoo ล่มชั่วคราว) — อาจ lag 1 วัน', size: 'sm', color: C.gold, margin: 'sm', wrap: true });
  }

  return {
    type: 'bubble', size: 'kilo',
    styles: bubbleStyles(),
    header: headerBox(title, sub),
    body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents: [
      ...rows,
      { type: 'separator', margin: 'lg', color: C.sep },
      { type: 'text', text: 'ℹ️ underlying = futures ETF (มี roll cost) เก็งเด้ง ไม่ใช่ถือยาว',
        size: 'sm', color: C.dim2, margin: 'md', wrap: true },
    ] },
    footer: footerButtons(env),
  };
}

// อ่านค่าอย่างเดียว (ใช้ร่วมกับหน้า /oil-status) — ไม่ยิง LINE ไม่เขียน state
async function evalOil03(env) {
  let wti, closes, wtiSource = 'yahoo';

  // Primary: Yahoo Finance (realtime intraday)
  try {
    const [pRes, hRes] = await Promise.all([
      yfChart('CL=F', '1d'),
      yfChart('CL=F', '3mo'),
    ]);
    const yWti = pRes.meta?.regularMarketPrice;
    const yCloses = (hRes.indicators?.quote?.[0]?.close || []).filter(x => x != null);
    if (typeof yWti !== 'number' || yCloses.length < OIL03_RSI_P + 1) throw new Error('yahoo wti incomplete');
    wti = yWti; closes = yCloses;
  } catch (e) {
    // Fallback: FRED (cross-check/backup only — Yahoo stays primary, this only kicks in if Yahoo fails)
    try {
      const f = await fetchFredWTI(env);
      wti = f.latest; closes = f.closesAsc; wtiSource = 'fred';
    } catch (e2) {
      wti = undefined; closes = [];
    }
  }

  let fx;
  try {
    const fxRes = await yfChart('USDTHB=X', '1d');
    fx = fxRes.meta?.regularMarketPrice;
    if (typeof fx !== 'number') throw new Error('yahoo fx incomplete');
  } catch (e) {
    fx = undefined;
  }

  const rsi = closes && closes.length ? rsiWilder(closes) : null;
  if (typeof wti !== 'number' || typeof fx !== 'number' || rsi == null)
    return { ok: false, wti, fx, rsi, wtiSource };

  const met = {
    value:    wti < OIL03_WTI_MAX && fx < OIL03_FX_MAX,
    rsi_buy:  rsi < OIL03_RSI_BUY,
    rsi_sell: rsi > OIL03_RSI_SELL,
  };
  return { ok: true, wti, fx, rsi, met, wtiSource };
}

async function checkOil03(env) {
  let ev;
  try { ev = await evalOil03(env); }
  catch (e) { return { error: e.message }; }
  if (!ev.ok) return { error: 'data incomplete', wti: ev.wti, fx: ev.fx, rsi: ev.rsi };

  const signals = Object.keys(ev.met).filter(k => ev.met[k]);
  const out = { checked: true, wti: ev.wti, fx: ev.fx, rsi: +ev.rsi.toFixed(1), wtiSource: ev.wtiSource, signals };
  if (!signals.length) return out;

  const { data, sha } = await fetchPortfolioData(env);
  const state = data._srAlerts || {};
  const today = todayICT();

  const sent = [];
  for (const kind of signals) {
    const k = `oil03:${kind}`;
    if (state[k] === today) continue;
    const ok = await pushFlex(env,
      `OIL03 ${kind} \u00b7 WTI $${fn(ev.wti)} \u00b7 RSI ${fn(ev.rsi, 1)}`,
      buildOil03Flex(env, kind, { wti: ev.wti, fx: ev.fx, rsi: ev.rsi, wtiSource: ev.wtiSource }));
    if (ok) { state[k] = today; sent.push(kind); }
  }

  let saved = false;
  if (sent.length) {
    data._srAlerts = state;
    saved = await savePortfolioData(env, data, sha, 'chore: OIL03 alert dedupe state');
  }
  out.sent = sent; out.saved = saved;
  return out;
}

// ── Trend Score Alert ────────────────────────────────────────────────────────
// สโคป: เฉพาะหุ้นแม่ (parentTicker) ของ SET DR (dr1) + หุ้นใน DIME-USA เท่านั้น
// (จำกัดขอบเขตกันเปลือง subrequest/Anthropic API — ไม่รวมพอร์ตอื่นหรือ watchlist)
function collectTrendTickers(data) {
  const seen = new Map(); // apiTicker -> displayTicker
  const targetPorts = (data.portfolios || []).filter(p => p.id === 'dr1' || p.name === 'DIME-USA');
  for (const p of targetPorts) {
    for (const s of (p.stocks || [])) {
      if (s.currentNav != null) continue; // กองทุน NAV-based ไม่มีใน Yahoo Finance ข้าม
      const api = s.parentTicker || s.ticker;
      if (api && !seen.has(api)) seen.set(api, s.ticker);
    }
  }
  return [...seen.entries()].slice(0, TREND_MAX_SYMBOLS).map(([api, display]) => ({ api, display }));
}

function buildTrendFlex(env, display, r) {
  const isBuy = r.label === 'Strong Buy';
  const title = isBuy ? `📈 ${display} · Strong Buy` : `📉 ${display} · Strong Sell`;
  const sub = `Trend Score ${r.score > 0 ? '+' : ''}${fn(r.score, 1)} · ${r.label}`;
  const rows = [
    rowKV('ราคา', fn(r.price), C.txt, true),
    rowKV('EMA20 / EMA50', `${fn(r.detail.ema.e20)} / ${fn(r.detail.ema.e50)}`, C.txt),
    ...(r.detail.ema.e200 != null ? [rowKV('EMA200', fn(r.detail.ema.e200), C.dim)] : []),
    rowKV('RSI(14)', `${fn(r.detail.rsi.value, 1)}${r.detail.rsi.overbought ? ' (overbought)' : r.detail.rsi.oversold ? ' (oversold)' : ''}`,
      isBuy ? C.green : C.red),
    rowKV('Volume ratio', r.detail.volume.ratio != null ? `${fn(r.detail.volume.ratio, 2)}x` : '-', C.txt),
  ];
  return {
    type: 'bubble', size: 'kilo',
    styles: bubbleStyles(),
    header: headerBox(title, sub),
    body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents: [
      ...rows,
      { type: 'separator', margin: 'lg', color: C.sep },
      { type: 'text', text: 'ℹ️ Trend Score = EMA(40) + RSI(30) + Volume(15) + ATR(15) · ไม่ใช่คำแนะนำการลงทุน',
        size: 'sm', color: C.dim2, margin: 'md', wrap: true },
    ] },
    footer: footerButtons(env),
  };
}

async function checkTrendAlerts(env) {
  const { data, sha } = await fetchPortfolioData(env);
  const tickers = collectTrendTickers(data);
  if (!tickers.length) return { checked: false, reason: 'no tickers' };

  let results;
  try {
    const r = await fetch(`${BASE_URL}/api/trend-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: tickers.map(t => t.api) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { error: 'trend-score fetch failed: ' + r.status };
    results = (await r.json()).results || {};
  } catch (e) {
    return { error: e.message };
  }

  const state = data._srAlerts || {};
  const today = todayICT();
  const candidates = [];
  for (const { api, display } of tickers) {
    const res = results[api];
    if (!res || res.error || res.score == null) continue;
    if (res.score > TREND_STRONG_BUY || res.score < TREND_STRONG_SELL) {
      const k = `trend:${api}:${res.label}`;
      if (state[k] === today) continue;
      candidates.push({ api, display, res, key: k });
    }
  }
  // ยิงตัวที่คะแนนสุดขั้วที่สุดก่อน (|score| มาก = สัญญาณแรง)
  candidates.sort((a, b) => Math.abs(b.res.score) - Math.abs(a.res.score));
  const capped = candidates.slice(0, TREND_MAX_ALERTS);

  const sent = [];
  for (const c of capped) {
    const ok = await pushFlex(env, `${c.display} · Trend Score ${fn(c.res.score, 1)} (${c.res.label})`,
      buildTrendFlex(env, c.display, c.res));
    if (ok) { state[c.key] = today; sent.push(c.display); }
  }

  let saved = false;
  if (sent.length) {
    data._srAlerts = state;
    saved = await savePortfolioData(env, data, sha, 'chore: Trend Score alert dedupe state');
  }
  return { checked: true, scanned: tickers.length, candidates: candidates.length, sent, saved };
}

// ── Reversal Signal Alert ────────────────────────────────────────────────────
// สโคปเดียวกับ Trend Score Alert (SET DR + DIME-USA) — เช็ค timeframe 'day' เท่านั้น
// (week/month ไม่ค่อยเปลี่ยนวันต่อวัน เหมาะกับดูเองในเว็บมากกว่ายิง alert อัตโนมัติ)
const REVERSAL_LABELS = {
  bullish_divergence: 'RSI Divergence (โมเมนตัมขาลงอ่อนแรง)',
  volume_exhaustion:  'วอลุ่มขาลงหมดแรง + วันนี้แท่งเขียว',
  hammer:             'แท่งเทียน Hammer',
  bullish_engulfing:  'แท่งเทียน Bullish Engulfing',
};

function buildReversalFlex(env, display, r) {
  const sigRows = r.signals.map(s => {
    const label = REVERSAL_LABELS[s.type] || s.type;
    let detail = '';
    if (s.type === 'bullish_divergence') detail = `ราคา ${fn(s.priorPrice)}→${fn(s.recentPrice)} · RSI ${fn(s.priorRsi,1)}→${fn(s.recentRsi,1)}`;
    if (s.type === 'volume_exhaustion') detail = `วอลุ่มพุ่ง ${fn(s.spikeRatio,2)}x (${s.downDaysCounted} แท่งขาลงก่อนหน้า)`;
    return {
      type: 'box', layout: 'vertical', margin: 'lg',
      contents: [
        { type: 'text', text: `🔄 ${label}`, size: 'md', color: C.green, weight: 'bold', wrap: true },
        ...(detail ? [{ type: 'text', text: detail, size: 'sm', color: C.dim, margin: 'xs', wrap: true }] : []),
      ],
    };
  });

  return {
    type: 'bubble', size: 'kilo',
    styles: bubbleStyles(),
    header: headerBox(`🔄 ${display} · Reversal Signal`, `${r.signalCount} สัญญาณ · Day timeframe`),
    body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents: [
      rowKV('ราคา', fn(r.price), C.txt, true),
      rowKV('RSI(14)', r.rsi != null ? fn(r.rsi, 1) : '-', C.txt),
      { type: 'separator', margin: 'lg', color: C.sep },
      ...sigRows,
      { type: 'separator', margin: 'lg', color: C.sep },
      { type: 'text', text: 'ℹ️ สัญญาณว่าขาลงอาจกำลังจะจบ ไม่ใช่คำแนะนำการลงทุน — ควรดูแนวรับ/ปริมาณซื้อขายประกอบ',
        size: 'sm', color: C.dim2, margin: 'md', wrap: true },
    ] },
    footer: footerButtons(env),
  };
}

async function checkReversalAlerts(env) {
  const { data, sha } = await fetchPortfolioData(env);
  const tickers = collectTrendTickers(data); // สโคปเดียวกับ Trend Score: SET DR + DIME-USA
  if (!tickers.length) return { checked: false, reason: 'no tickers' };

  let results;
  try {
    const r = await fetch(`${BASE_URL}/api/reversal-signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: tickers.map(t => t.api), timeframe: 'day' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { error: 'reversal-signal fetch failed: ' + r.status };
    results = (await r.json()).results || {};
  } catch (e) {
    return { error: e.message };
  }

  const state = data._srAlerts || {};
  const today = todayICT();
  const candidates = [];
  for (const { api, display } of tickers) {
    const res = results[api];
    if (!res || res.error || !res.hasSignal) continue;
    const sigTypes = res.signals.map(s => s.type).sort().join(',');
    const k = `reversal:${api}:${sigTypes}`;
    if (state[k] === today) continue;
    candidates.push({ api, display, res, key: k });
  }
  // ยิงตัวที่มีหลายสัญญาณพร้อมกันก่อน (ความมั่นใจสูงกว่า)
  candidates.sort((a, b) => b.res.signalCount - a.res.signalCount);
  const capped = candidates.slice(0, REVERSAL_MAX_ALERTS);

  const sent = [];
  for (const c of capped) {
    const ok = await pushFlex(env, `${c.display} · Reversal Signal (${c.res.signalCount})`,
      buildReversalFlex(env, c.display, c.res));
    if (ok) { state[c.key] = today; sent.push(c.display); }
  }

  let saved = false;
  if (sent.length) {
    data._srAlerts = state;
    saved = await savePortfolioData(env, data, sha, 'chore: Reversal Signal alert dedupe state');
  }
  return { checked: true, scanned: tickers.length, candidates: candidates.length, sent, saved };
}

// ── GUI: หน้า /oil-status (อ่านอย่างเดียว) ────────────────────────────────────
function oilStatusQS(env) { return env.ALERT_SECRET ? ('?key=' + env.ALERT_SECRET) : ''; }

// เลียนแบบหน้าตา LINE Flex bubble จริง (header/body/footer) เพื่อ preview ในหน้าเว็บ
function flexPreviewHTML(kind, m, active) {
  const isSell = kind === 'rsi_sell';
  const title = kind === 'value'   ? '🛢️ OIL03 · น้ำมันถูก + บาทแข็ง'
              : kind === 'rsi_buy' ? '🛢️ OIL03 · RSI Oversold'
              :                      '🔺 OIL03 · RSI Overbought';
  const sub   = kind === 'value'   ? 'Buy Signal · value zone'
              : kind === 'rsi_buy' ? 'Buy Signal · RSI < 30'
              :                      'Sell Signal · RSI > 70';

  const num = (v, d = 2) => v == null || isNaN(v) ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const row = (label, val, color) => `
    <div class="frow"><span class="flabel">${label}</span><span class="fval" style="color:${color || '#E2E8F0'}">${val}</span></div>`;

  let rows;
  if (kind === 'value') {
    rows = row('WTI Crude', '$' + num(m.wti), '#00C896')
         + row('เกณฑ์ WTI', '< $' + OIL03_WTI_MAX.toFixed(0), '#6B7280')
         + row('USDTHB', '\u0e3f' + num(m.fx), '#00C896')
         + row('เกณฑ์บาท', '< \u0e3f' + OIL03_FX_MAX.toFixed(2), '#6B7280')
         + row('RSI (WTI,14)', num(m.rsi, 1), '#E2E8F0');
  } else {
    rows = row('RSI (WTI,14)', num(m.rsi, 1), isSell ? '#FF5C5C' : '#00C896')
         + row('เกณฑ์', isSell ? ('> ' + OIL03_RSI_SELL) : ('< ' + OIL03_RSI_BUY), '#6B7280')
         + row('WTI Crude', '$' + num(m.wti), '#E2E8F0')
         + row('USDTHB', '\u0e3f' + num(m.fx), '#E2E8F0');
  }

  return `
    <div class="fbubble${active ? ' factive' : ''}">
      ${active ? '<div class="ftag">\u0e40\u0e02\u0e49\u0e32\u0e40\u0e07\u0e37\u0e48\u0e2d\u0e19\u0e44\u0e02\u0e15\u0e2d\u0e19\u0e19\u0e35\u0e49</div>' : ''}
      <div class="fhead"><div class="ftitle">${title}</div><div class="fsub">${sub}</div></div>
      <div class="fbody">${rows}
        <div class="fnote">\u2139\ufe0f underlying = futures ETF (\u0e21\u0e35 roll cost) \u0e40\u0e01\u0e47\u0e07\u0e40\u0e14\u0e49\u0e07 \u0e44\u0e21\u0e48\u0e43\u0e0a\u0e48\u0e16\u0e37\u0e2d\u0e22\u0e32\u0e27</div>
      </div>
      <div class="ffoot"><div class="fbtn fbtn-p">\u0e40\u0e1b\u0e34\u0e14 TradeDesk</div></div>
    </div>`;
}

async function renderOil03Status(env) {
  let ev = null, err = null;
  try { ev = await evalOil03(env); } catch (e) { err = e.message; }

  let last = { value: '-', rsi_buy: '-', rsi_sell: '-' };
  try {
    const { data } = await fetchPortfolioData(env);
    const st = data._srAlerts || {};
    last = {
      value:    st['oil03:value']    || '-',
      rsi_buy:  st['oil03:rsi_buy']  || '-',
      rsi_sell: st['oil03:rsi_sell'] || '-',
    };
  } catch (_) {}

  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
  const ok = ev && ev.ok;
  const wti = ok ? ev.wti : null, fx = ok ? ev.fx : null, rsi = ok ? ev.rsi : null;
  const wtiSource = ev?.wtiSource || 'yahoo';

  const num = (v, d = 2) => v == null || isNaN(v) ? '-' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const wtiOK = ok && wti < OIL03_WTI_MAX;
  const fxOK  = ok && fx < OIL03_FX_MAX;
  const rsiBuyOK  = ok && rsi < OIL03_RSI_BUY;
  const rsiSellOK = ok && rsi > OIL03_RSI_SELL;

  const metric = (label, val, sub, good) => `
    <div class="metric">
      <div class="mlabel">${label}</div>
      <div class="mval" style="color:${good ? '#00C896' : '#E2E8F0'}">${val}</div>
      <div class="msub">${sub}</div>
    </div>`;

  const card = (title, condText, met, lastDate, accent) => `
    <div class="card">
      <div class="ctop">
        <div class="ctitle">${title}</div>
        <div class="pill" style="background:${met ? accent + '22' : '#2A2A3E'};color:${met ? accent : '#8A8A9A'};border-color:${met ? accent : '#2A2A3E'}">
          ${met ? '\u2705 \u0e40\u0e02\u0e49\u0e32\u0e40\u0e07\u0e37\u0e48\u0e2d\u0e19\u0e44\u0e02\u0e41\u0e25\u0e49\u0e27' : '\u26aa \u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e40\u0e02\u0e49\u0e32'}
        </div>
      </div>
      <div class="ccond">${condText}</div>
      <div class="clast">\u0e2a\u0e48\u0e07\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14: ${lastDate}</div>
    </div>`;

  const banner = err
    ? `<div class="err">\u2757 \u0e14\u0e36\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08: ${err}</div>`
    : (!ok ? `<div class="err">\u2757 \u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e44\u0e21\u0e48\u0e04\u0e23\u0e1a (data incomplete)</div>` : '');

  const fredBanner = (ok && wtiSource === 'fred')
    ? `<div class="warn">\u26a0\ufe0f WTI \u0e08\u0e32\u0e01 FRED (Yahoo \u0e25\u0e48\u0e21\u0e0a\u0e31\u0e48\u0e27\u0e04\u0e23\u0e32\u0e27) \u0e2d\u0e32\u0e08 lag 1 \u0e27\u0e31\u0e19</div>`
    : '';

  const qs = oilStatusQS(env);

  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OIL03 Signal Monitor</title>
<style>
  :root{--bg:#0F0F1A;--panel:#161625;--head:#0F0F1A;--txt:#E2E8F0;--dim:#8A8A9A;--sep:#2A2A3E;--blue:#4A9EFF;--green:#00C896;--red:#FF5C5C;--gold:#F0B90B}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px}
  .wrap{max-width:480px;margin:0 auto}
  .topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}
  h1{font-size:18px;margin:0;color:var(--txt)}
  .hbtn{background:var(--panel);border:1px solid var(--sep);color:var(--txt);width:38px;height:38px;border-radius:10px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .hbtn:active{background:var(--sep)}
  .ts{font-size:12px;color:var(--dim);margin-bottom:16px}
  .err{background:#3a1a1a;border:1px solid var(--red);color:#ffb4b4;padding:10px 12px;border-radius:10px;font-size:13px;margin-bottom:14px}
  .warn{background:#3a2f0f;border:1px solid var(--gold);color:#ffe4a1;padding:8px 12px;border-radius:10px;font-size:12px;margin-bottom:14px}
  .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
  .metric{background:var(--panel);border:1px solid var(--sep);border-radius:12px;padding:12px 10px;text-align:center}
  .mlabel{font-size:11px;color:var(--dim)}
  .mval{font-size:20px;font-weight:700;margin:4px 0}
  .msub{font-size:10px;color:var(--dim)}
  .card{background:var(--panel);border:1px solid var(--sep);border-radius:12px;padding:14px;margin-bottom:10px}
  .ctop{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .ctitle{font-size:14px;font-weight:600}
  .pill{font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid;white-space:nowrap}
  .ccond{font-size:12px;color:var(--dim);margin-top:8px}
  .clast{font-size:11px;color:var(--dim);margin-top:6px}
  .btns{display:flex;flex-direction:column;gap:8px;margin-top:16px}
  button,a.btn{display:block;width:100%;text-align:center;padding:12px;border-radius:10px;font-size:14px;font-weight:600;border:none;cursor:pointer;text-decoration:none}
  .b-primary{background:var(--blue);color:#fff}
  .b-ghost{background:transparent;color:var(--txt);border:1px solid var(--sep)}
  #toast{font-size:12px;color:var(--dim);text-align:center;margin-top:10px;min-height:16px;white-space:pre-wrap}
  .secnote{font-size:12px;color:var(--dim);margin:20px 0 8px}
  .fwrap{display:flex;flex-direction:column;gap:14px;margin-bottom:16px}
  .fbubble{background:#161625;border:1px solid #2A2A3E;border-radius:16px;overflow:hidden;position:relative;box-shadow:0 4px 16px rgba(0,0,0,.35)}
  .fbubble.factive{border-color:#00C896;box-shadow:0 0 0 1px #00C896,0 4px 16px rgba(0,200,150,.25)}
  .ftag{position:absolute;top:10px;right:10px;background:#00C89622;color:#00C896;font-size:10px;padding:3px 8px;border-radius:999px;border:1px solid #00C896}
  .fhead{background:#0F0F1A;padding:14px 16px 10px}
  .ftitle{font-size:14px;font-weight:700;color:#E2E8F0}
  .fsub{font-size:11px;color:#6B7280;margin-top:3px}
  .fbody{background:#161625;padding:14px 16px}
  .frow{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}
  .flabel{color:#6B7280}
  .fval{font-weight:600}
  .fnote{font-size:10px;color:#8A8A9A;margin-top:10px;padding-top:10px;border-top:1px solid #2A2A3E;line-height:1.5}
  .ffoot{background:#0F0F1A;padding:10px 16px 14px}
  .fbtn{text-align:center;padding:9px;border-radius:8px;font-size:12px;font-weight:600}
  .fbtn-p{background:#4A9EFF;color:#fff}
  /* Hamburger drawer */
  .overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:40;opacity:0;pointer-events:none;transition:opacity .2s}
  .overlay.open{opacity:1;pointer-events:auto}
  .drawer{position:fixed;top:0;right:0;bottom:0;width:min(320px,85vw);background:var(--panel);border-left:1px solid var(--sep);z-index:50;transform:translateX(100%);transition:transform .25s ease;overflow-y:auto;padding:18px}
  .drawer.open{transform:translateX(0)}
  .dhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  .dtitle{font-size:15px;font-weight:700}
  .dclose{background:none;border:none;color:var(--dim);font-size:20px;cursor:pointer;padding:0;width:auto}
  .dsec{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;margin:18px 0 8px}
  .dsec:first-of-type{margin-top:0}
  .dlink{display:block;padding:10px 12px;background:var(--bg);border:1px solid var(--sep);border-radius:9px;color:var(--txt);text-decoration:none;font-size:13px;margin-bottom:8px;cursor:pointer}
  .dlink:active{background:var(--sep)}
</style></head><body>
<div class="wrap">
  <div class="topbar">
    <h1>\ud83d\udee2\ufe0f OIL03 Signal</h1>
    <button class="hbtn" onclick="openDrawer()" aria-label="\u0e40\u0e21\u0e19\u0e39">\u2630</button>
  </div>
  <div class="ts">\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15: ${now} ICT \u00b7 read-only</div>
  ${banner}
  ${fredBanner}
  <div class="metrics">
    ${metric('WTI Crude', ok ? '$' + num(wti) : '-', (wtiSource === 'fred' ? 'FRED · ' : '') + 'เกณฑ์ < $' + OIL03_WTI_MAX.toFixed(0), wtiOK)}
    ${metric('USDTHB', ok ? '\u0e3f' + num(fx) : '-', 'เกณฑ์ < ' + OIL03_FX_MAX.toFixed(2), fxOK)}
    ${metric('RSI (WTI,14)', ok ? num(rsi, 1) : '-', OIL03_RSI_BUY + ' / ' + OIL03_RSI_SELL, rsiBuyOK || rsiSellOK)}
  </div>
  ${card('\ud83d\udee2\ufe0f Value Buy', 'WTI &lt; $' + OIL03_WTI_MAX.toFixed(0) + ' \u0e41\u0e25\u0e30 USDTHB &lt; ' + OIL03_FX_MAX.toFixed(2), wtiOK && fxOK, last.value, '#00C896')}
  ${card('\ud83d\udcc9 RSI Buy', 'RSI &lt; ' + OIL03_RSI_BUY + ' (oversold)', rsiBuyOK, last.rsi_buy, '#00C896')}
  ${card('\ud83d\udcc8 RSI Sell', 'RSI &gt; ' + OIL03_RSI_SELL + ' (overbought)', rsiSellOK, last.rsi_sell, '#FF5C5C')}
  <div id="toast"></div>
</div>

<div class="overlay" id="overlay" onclick="closeDrawer()"></div>
<div class="drawer" id="drawer">
  <div class="dhead">
    <div class="dtitle">\u2630 \u0e40\u0e21\u0e19\u0e39</div>
    <button class="dclose" onclick="closeDrawer()">\u2715</button>
  </div>

  <div class="dsec">\u0e17\u0e31\u0e48\u0e27\u0e44\u0e1b</div>
  <button class="dlink" style="width:100%;text-align:left;font-family:inherit" onclick="location.reload()">\ud83d\udd04 \u0e23\u0e35\u0e40\u0e1f\u0e23\u0e0a</button>
  <a class="dlink" href="${BASE_URL}">\ud83c\udfe0 \u0e40\u0e1b\u0e34\u0e14 TradeDesk</a>
  <a class="dlink" href="/oil-data" target="_blank">\ud83d\udcc4 \u0e14\u0e39 Raw JSON (/oil-data)</a>

  <div class="dsec">LINE Flex Preview</div>
  <div class="fwrap">
    ${flexPreviewHTML('value', { wti, fx, rsi }, ok && wtiOK && fxOK)}
    ${flexPreviewHTML('rsi_buy', { wti, fx, rsi }, ok && rsiBuyOK)}
    ${flexPreviewHTML('rsi_sell', { wti, fx, rsi }, ok && rsiSellOK)}
  </div>

  <div class="dsec">\u0e14\u0e35\u0e1a\u0e31\u0e01 / \u0e17\u0e14\u0e2a\u0e2d\u0e1a</div>
  ${env.ALERT_SECRET
    ? '<div class="secnote">\ud83d\udd12 \u0e01\u0e32\u0e23\u0e2a\u0e48\u0e07\u0e08\u0e23\u0e34\u0e07\u0e15\u0e49\u0e2d\u0e07\u0e40\u0e02\u0e49\u0e32\u0e17\u0e35\u0e48 /oil-trigger?key=... \u0e42\u0e14\u0e22\u0e15\u0e23\u0e07</div>'
    : '<button class="dlink" style="width:100%;text-align:left;font-family:inherit" onclick="testSend()">\ud83d\udd14 \u0e17\u0e14\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 LINE (\u0e08\u0e23\u0e34\u0e07)</button>'}
  <div class="secnote">\u0e40\u0e01\u0e13\u0e11\u0e4c: WTI &lt; $${OIL03_WTI_MAX.toFixed(0)} \u00b7 USDTHB &lt; \u0e3f${OIL03_FX_MAX.toFixed(2)} \u00b7 RSI ${OIL03_RSI_BUY}/${OIL03_RSI_SELL}</div>
</div>

<script>
  function openDrawer(){ document.getElementById('drawer').classList.add('open'); document.getElementById('overlay').classList.add('open'); }
  function closeDrawer(){ document.getElementById('drawer').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); }
  async function testSend(){
    const t=document.getElementById('toast'); t.textContent='\u0e01\u0e33\u0e25\u0e31\u0e07\u0e2a\u0e48\u0e07...';
    try{
      const r=await fetch('/oil-trigger'); const j=await r.json();
      t.textContent = (j.sent&&j.sent.length) ? ('\u2705 \u0e2a\u0e48\u0e07\u0e41\u0e25\u0e49\u0e27: '+j.sent.join(', ')) : ('\u2139\ufe0f \u0e44\u0e21\u0e48\u0e40\u0e02\u0e49\u0e32\u0e40\u0e07\u0e37\u0e48\u0e2d\u0e19\u0e44\u0e02 (signals: '+JSON.stringify(j.signals||[])+')');
      closeDrawer();
    }catch(e){ t.textContent='\u274c '+e.message; }
  }
</script>
</body></html>`;
}

async function sendWatchlistSummary(env) {
  try {
    const { data } = await fetchPortfolioData(env);
    const pending = (data.watchlist || []).filter(w => w.status === 'pending');
    const priceMap = await priceMapFor(pending);
    const ok = await pushFlex(env, `📋 Watchlist: รอซื้อ ${pending.length} ตัว`,
      buildSummaryFlex(env, pending, priceMap));
    return { ok, count: pending.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
