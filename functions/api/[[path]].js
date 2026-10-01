// Catch missing /api routes before Pages falls back to the SPA's index.html.
const retiredRoutes = new Set([
  '/api/backtest',
  '/api/buy-zone',
  '/api/explain-signal',
  '/api/journal',
  '/api/reversal-signal',
  '/api/sell-zone',
  '/api/trend-score',
]);

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;
  const retired = retiredRoutes.has(pathname);
  return new Response(JSON.stringify({ error: retired ? 'Endpoint retired' : 'Not found' }), {
    status: retired ? 410 : 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
