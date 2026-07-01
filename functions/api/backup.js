export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const GITHUB_TOKEN = context.env.GITHUB_TOKEN;
  const REPO = 'claimloss-lab/trade-desk';
  const FILE_PATH = 'public/portfolio-data.json';
  const API_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TradeDesk-Backup',
    'Content-Type': 'application/json',
  };

  // ── GET: Load backup from GitHub ──
  if (context.request.method === 'GET') {
    try {
      const res = await fetch(API_BASE, { headers: ghHeaders });
      if (!res.ok) return new Response(JSON.stringify({ error: 'Load failed', status: res.status }), { status: 502, headers: cors });
      const data = await res.json();
      const content = atob(data.content.replace(/\n/g, ''));
      return new Response(content, { headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
    }
  }

  // ── POST: Save backup to GitHub ──
  if (context.request.method === 'POST') {
    try {
      const body = await context.request.json();

      // Get current file SHA (needed for update)
      const shaRes = await fetch(API_BASE, { headers: ghHeaders });
      let sha = null;
      if (shaRes.ok) {
        const shaData = await shaRes.json();
        sha = shaData.sha;
      }

      // Encode content to base64
      const _jsonStr = JSON.stringify(body, null, 2);
      const _bytes = new TextEncoder().encode(_jsonStr);
      let _bin = ''; for (let i = 0; i < _bytes.length; i++) _bin += String.fromCharCode(_bytes[i]);
      const content = btoa(_bin);
      const now = new Date().toISOString();

      const payload = {
        message: `backup: auto-save ${now}`,
        content,
        ...(sha ? { sha } : {}),
      };

      const updateRes = await fetch(API_BASE, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(payload),
      });

      if (!updateRes.ok) {
        const err = await updateRes.text();
        return new Response(JSON.stringify({ error: 'Save failed', detail: err }), { status: 502, headers: cors });
      }

      return new Response(JSON.stringify({ ok: true, savedAt: now }), { headers: cors });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });
}
