/**
 * /api/line-message
 * POST { message: string } → ส่ง LINE Messaging API (push message)
 *
 * Token resolution order:
 *   1. Cloudflare env vars (LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID)  ← production
 *   2. Request headers (X-Line-Token, X-Line-Userid)                  ← client-side fallback
 */
export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Line-Token, X-Line-Userid',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });
  }

  // Resolve token & userId — env vars first, then request headers
  const TOKEN   = context.env.LINE_CHANNEL_ACCESS_TOKEN
                  || context.request.headers.get('X-Line-Token');
  const USER_ID = context.env.LINE_USER_ID
                  || context.request.headers.get('X-Line-Userid');

  if (!TOKEN || !USER_ID) {
    return new Response(JSON.stringify({ error: 'LINE token/userId not configured' }), { status: 500, headers: cors });
  }

  try {
    const body = await context.request.json();
    const { message, altText, flex } = body;
    let messages;
    if (flex) {
      messages = [{ type: 'flex', altText: String(altText || 'TradeDesk').slice(0, 400), contents: flex }];
    } else if (message) {
      messages = [{ type: 'text', text: message }];
    } else {
      return new Response(JSON.stringify({ error: 'message or flex is required' }), { status: 400, headers: cors });
    }

    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        to: USER_ID,
        messages,
      }),
    });

    if (!lineRes.ok) {
      const err = await lineRes.text();
      return new Response(JSON.stringify({ error: 'LINE API error', detail: err }), { status: 502, headers: cors });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
