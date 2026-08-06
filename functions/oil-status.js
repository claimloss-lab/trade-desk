// functions/oil-status.js
// Proxies /oil-status on trade-desk.pages.dev through to the
// trade-desk-watchlist-alert Worker, so the OIL03 signal page lives under
// the same domain instead of a separate *.workers.dev URL.
export async function onRequest(context) {
  const reqUrl = new URL(context.request.url);
  const workerUrl = 'https://trade-desk-watchlist-alert.claimloss.workers.dev/oil-status' + reqUrl.search;
  const res = await fetch(workerUrl, { cf: { cacheTtl: 0 } });
  const html = await res.text();
  return new Response(html, {
    status: res.status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
