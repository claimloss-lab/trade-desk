// ── /api/paper-trade ─────────────────────────────────────────────────
// State stored at public/paper-trading.json (separate from portfolio-data.json
// to avoid the auto-save race condition documented for daily-snapshot.json).
//
// GET               → คืนสถานะปัจจุบัน (positions, closedTrades, cash)
// POST { action }   → 'open' | 'close' | 'reset' | 'status'
//   open:  { ticker, price, qty, note? }
//   close: { ticker, price, qty? }              (qty ว่าง = ปิดทั้งหมด, FIFO)
//   reset: { initialCapital? }                  (ล้างและเริ่มใหม่)
//   status:{ prices?: { ticker: price } }        (mark-to-market ถ้าส่งราคามาด้วย)
import { freshState, openPosition, closePosition, markToMarket } from '../_lib/paper-trading-logic.js';

const REPO = 'claimloss-lab/trade-desk';
const FILE_PATH = 'public/paper-trading.json';
const API_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

function ghHeaders(token) {
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TradeDesk-PaperTrade',
    'Content-Type': 'application/json',
  };
}

function b64encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
  let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// Read current state. Returns { state, sha } where sha is null if file doesn't exist yet (404).
// Any non-200/non-404 response is a HARD FAIL (do not proceed to write) — see project learning
// about never treating unauthenticated/ambiguous read failures as "file doesn't exist".
async function loadState(headers) {
  const res = await fetch(API_BASE, { headers });
  if (res.status === 404) return { state: freshState(), sha: null };
  if (!res.ok) return { error: `read failed: HTTP ${res.status}` };
  const data = await res.json();
  try {
    const state = JSON.parse(b64decode(data.content));
    return { state, sha: data.sha };
  } catch (e) {
    return { error: `parse failed: ${e.message}` };
  }
}

async function saveState(headers, state, message) {
  // Fetch SHA immediately before PUT to avoid 409 conflicts.
  const shaRes = await fetch(API_BASE, { headers });
  const sha = shaRes.ok ? (await shaRes.json()).sha : undefined;
  const payload = { message, content: b64encode(state), ...(sha ? { sha } : {}) };
  const putRes = await fetch(API_BASE, { method: 'PUT', headers, body: JSON.stringify(payload) });
  if (!putRes.ok) {
    const err = await putRes.text();
    return { ok: false, error: err };
  }
  return { ok: true };
}

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const headers = ghHeaders(context.env.GITHUB_TOKEN);

  if (context.request.method === 'GET') {
    const loaded = await loadState(headers);
    if (loaded.error) return new Response(JSON.stringify({ error: loaded.error }), { status: 502, headers: cors });
    return new Response(JSON.stringify(loaded.state), { headers: cors });
  }

  if (context.request.method !== 'POST')
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  try {
    const body = await context.request.json();
    const action = body.action;

    if (action === 'reset') {
      const state = freshState(body.initialCapital > 0 ? body.initialCapital : 1000000);
      const saved = await saveState(headers, state, `paper-trade: reset (${new Date().toISOString()})`);
      if (!saved.ok) return new Response(JSON.stringify({ error: 'save failed', detail: saved.error }), { status: 502, headers: cors });
      return new Response(JSON.stringify(state), { headers: cors });
    }

    if (action === 'status') {
      const loaded = await loadState(headers);
      if (loaded.error) return new Response(JSON.stringify({ error: loaded.error }), { status: 502, headers: cors });
      const mtm = body.prices ? markToMarket(loaded.state, body.prices) : null;
      return new Response(JSON.stringify({ ...loaded.state, markToMarket: mtm }), { headers: cors });
    }

    if (action === 'open' || action === 'close') {
      const loaded = await loadState(headers);
      if (loaded.error) return new Response(JSON.stringify({ error: loaded.error }), { status: 502, headers: cors });

      const result = action === 'open'
        ? openPosition(loaded.state, body)
        : closePosition(loaded.state, body);

      if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: 400, headers: cors });

      const saved = await saveState(headers, result.state, `paper-trade: ${action} ${body.ticker} (${new Date().toISOString()})`);
      if (!saved.ok) return new Response(JSON.stringify({ error: 'save failed', detail: saved.error }), { status: 502, headers: cors });

      return new Response(JSON.stringify({
        ok: true, state: result.state,
        ...(result.closedLots ? { closedLots: result.closedLots } : {}),
      }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'action ต้องเป็น open | close | reset | status' }), { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
