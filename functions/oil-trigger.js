// functions/oil-trigger.js
// Proxies /oil-trigger through to the watchlist-alert Worker.
// Guarded server-side by ALERT_SECRET inside the Worker itself (if set) —
// this proxy just forwards whatever query string it was given.
export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);
  const workerUrl = 'https://trade-desk-watchlist-alert.claimloss.workers.dev/oil-trigger' + reqUrl.search;
  const res = await fetch(workerUrl, { cf: { cacheTtl: 0 } });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
