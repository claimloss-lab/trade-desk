// functions/oil-data.js
// Proxies /oil-data (public read-only JSON) through to the watchlist-alert Worker.
export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);
  const workerUrl = 'https://trade-desk-watchlist-alert.claimloss.workers.dev/oil-data' + reqUrl.search;
  const res = await fetch(workerUrl, { cf: { cacheTtl: 0 } });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
