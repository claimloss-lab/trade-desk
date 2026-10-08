import { requireRepoWriter } from '../_lib/repo-auth.js';

export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const REPO = 'claimloss-lab/trade-desk';
  const FILE_PATH = 'public/portfolio-data.json';
  const API_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const GITHUB_TOKEN = context.env.GITHUB_TOKEN;
  const publicHeaders = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TradeDesk-Backup',
    'Content-Type': 'application/json',
  };
  const ghHeaders = {
    ...publicHeaders,
    ...(GITHUB_TOKEN ? { 'Authorization': `Bearer ${GITHUB_TOKEN}` } : {}),
  };

  // ── GET: Load the public backup ──
  if (context.request.method === 'GET') {
    try {
      let res = await fetch(API_BASE, { headers: ghHeaders });
      // A stale optional service credential must not break safe READS of a public backup.
      if (GITHUB_TOKEN && (res.status === 401 || res.status === 403)) {
        res = await fetch(API_BASE, { headers: publicHeaders });
      }
      if (!res.ok) return new Response(JSON.stringify({ error: 'Load failed', status: res.status }), { status: 502, headers: cors });
      const data = await res.json();
      const binary = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Response(new TextDecoder('utf-8').decode(bytes), { headers: { ...cors, 'Content-Type': 'application/json' } });
    } catch {
      return new Response(JSON.stringify({ error: 'Load failed' }), { status: 502, headers: cors });
    }
  }

  // ── POST: Save backup to GitHub ──
  if (context.request.method === 'POST') {
    const auth = await requireRepoWriter(context.request, REPO);
    if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: cors });
    // Use the verified push-capable caller's credential to write. This avoids coupling
    // user saves to an unrelated server token which can be missing or expired.
    // Never accept unauthenticated writes, and never send the caller token to the browser.
    const writerHeaders = { ...publicHeaders, Authorization: context.request.headers.get('Authorization') };

    let body;
    try {
      body = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: cors });
    }
    if (!body || typeof body !== 'object' || !Array.isArray(body.portfolios) ||
        body.portfolios.some(p => !p || p.id == null || !Array.isArray(p.stocks))) {
      return new Response(JSON.stringify({ error: 'Invalid portfolio backup shape' }), { status: 400, headers: cors });
    }

    try {
      // Get current file SHA (required by GitHub to update an existing file).
      const shaRes = await fetch(API_BASE, { headers: writerHeaders });
      if (!shaRes.ok) return new Response(JSON.stringify({ error: 'Could not read the current backup', status: shaRes.status }), { status: 502, headers: cors });
      const shaData = await shaRes.json();
      const now = new Date().toISOString();

      const jsonBytes = new TextEncoder().encode(JSON.stringify(body, null, 2));
      let binary = '';
      for (let i = 0; i < jsonBytes.length; i++) binary += String.fromCharCode(jsonBytes[i]);
      const payload = {
        message: `backup: auto-save ${now}`,
        content: btoa(binary),
        sha: shaData.sha,
      };

      const updateRes = await fetch(API_BASE, {
        method: 'PUT',
        headers: writerHeaders,
        body: JSON.stringify(payload),
      });
      if (!updateRes.ok) {
        const message = updateRes.status === 401 ? 'GitHub Token is invalid or expired'
          : updateRes.status === 403 ? 'GitHub Token needs repository Contents write permission'
          : updateRes.status === 409 ? 'Backup changed on GitHub; reload and retry'
          : 'Save failed';
        return new Response(JSON.stringify({ error: message, status: updateRes.status }), { status: 502, headers: cors });
      }
      return new Response(JSON.stringify({ ok: true, savedAt: now }), { headers: cors });
    } catch {
      return new Response(JSON.stringify({ error: 'Backup service request failed' }), { status: 502, headers: cors });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });
}
