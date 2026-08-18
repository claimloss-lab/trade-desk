// functions/api/ma-watchlist.js
// CRUD สำหรับ watchlist ของ "MA Cross Signal" (เดิมคือหน้า Price Alert)
// เก็บแยกจาก portfolio-data.json:
//   public/ma-signal-watchlist.json  — รายชื่อ ticker (CRUD ผ่านหน้านี้)
//   public/ma-signal-data.json       — MA50/MA200 ที่ worker คำนวณไว้แล้ว (read-only จากฝั่งนี้)
// GET    → คืน { tickers: [...], data: {...} } (merge สองไฟล์ให้หน้าเว็บใช้ได้ในคอลเดียว)
// POST   → { ticker } เพิ่ม ticker เข้า watchlist
// DELETE → { ticker } เอา ticker ออกจาก watchlist (ไม่ลบ MA data เผื่อเพิ่มกลับมาทีหลัง)

const REPO = 'claimloss-lab/trade-desk';
const WATCHLIST_PATH = 'public/ma-signal-watchlist.json';
const DATA_PATH = 'public/ma-signal-data.json';

function ghHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'TradeDesk-MAWatchlist',
    'Content-Type': 'application/json',
  };
}

async function ghGet(token, path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: ghHeaders(token) });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  const j = await res.json();
  const bin = atob(j.content.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { data: JSON.parse(new TextDecoder('utf-8').decode(bytes)), sha: j.sha };
}

async function ghPut(token, path, data, sha, message) {
  const jsonStr = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(jsonStr);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const body = { message, content: btoa(bin) };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status}`);
  return true;
}

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const token = context.env.GITHUB_TOKEN;
  if (!token) return new Response(JSON.stringify({ error: 'GITHUB_TOKEN not configured' }), { status: 500, headers: cors });

  try {
    if (context.request.method === 'GET') {
      const [{ data: wl }, { data: maData }] = await Promise.all([
        ghGet(token, WATCHLIST_PATH),
        ghGet(token, DATA_PATH),
      ]);
      return new Response(JSON.stringify({ tickers: wl?.tickers || [], data: maData || {} }), { headers: cors });
    }

    if (context.request.method === 'POST') {
      const body = await context.request.json();
      const ticker = String(body.ticker || '').trim().toUpperCase();
      if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: cors });

      const { data: wl, sha } = await ghGet(token, WATCHLIST_PATH);
      const tickers = wl?.tickers || [];
      if (tickers.includes(ticker)) {
        return new Response(JSON.stringify({ tickers, note: 'already in watchlist' }), { headers: cors });
      }
      tickers.push(ticker);
      await ghPut(token, WATCHLIST_PATH, { tickers }, sha, `feat: add ${ticker} to MA Cross Signal watchlist`);
      return new Response(JSON.stringify({ tickers }), { headers: cors });
    }

    if (context.request.method === 'DELETE') {
      const body = await context.request.json();
      const ticker = String(body.ticker || '').trim().toUpperCase();
      if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400, headers: cors });

      const { data: wl, sha } = await ghGet(token, WATCHLIST_PATH);
      const tickers = (wl?.tickers || []).filter(t => t !== ticker);
      await ghPut(token, WATCHLIST_PATH, { tickers }, sha, `chore: remove ${ticker} from MA Cross Signal watchlist`);
      return new Response(JSON.stringify({ tickers }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
