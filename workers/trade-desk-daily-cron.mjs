const SUMMARY_URL = 'https://trade-desk.pages.dev/api/daily-summary';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendSummary(env));
  },

  // Manual runs require the secret in the Authorization header, not the URL.
  async fetch(req, env) {
    if (!env.SUMMARY_SECRET || req.headers.get('Authorization') !== `Bearer ${env.SUMMARY_SECRET}`) {
      return new Response('unauthorized', { status: 401 });
    }
    const result = await sendSummary(env);
    return Response.json(result, { status: result.ok ? 200 : 502 });
  },
};

export async function sendSummary(env) {
  if (!env.SUMMARY_SECRET) return { ok: false, error: 'SUMMARY_SECRET is not configured' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await (env.fetch || fetch)(SUMMARY_URL, {
        headers: { Authorization: `Bearer ${env.SUMMARY_SECRET}` },
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.text();
      console.log(`attempt ${attempt} → HTTP ${res.status}: ${body}`);
      if (res.ok) return { ok: true, attempt, body };
    } catch (e) {
      console.log(`attempt ${attempt} error: ${e.message}`);
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 15000));
  }
  return { ok: false };
}
