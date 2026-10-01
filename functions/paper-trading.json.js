// The former public state file was removed; return Gone instead of the SPA shell.
export async function onRequest() {
  return new Response(JSON.stringify({ error: 'Paper Trading state retired' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
