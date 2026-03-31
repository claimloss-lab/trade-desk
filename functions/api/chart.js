export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker  = url.searchParams.get('ticker');
  const range    = url.searchParams.get('range')    || '1mo';
  const interval = url.searchParams.get('interval') || '1d';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  const sym = ticker.toUpperCase().replace(/\./g, '-');

  const yHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
  };

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
      { headers: yHeaders, cf: { cacheTtl: 300 } }
    );
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: cors });
  } catch (e) {
    // Fallback: try query2
    try {
      const res2 = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
        { headers: yHeaders }
      );
      if (!res2.ok) throw new Error(`Yahoo2 returned ${res2.status}`);
      const data2 = await res2.json();
      return new Response(JSON.stringify(data2), { headers: cors });
    } catch (e2) {
      return new Response(JSON.stringify({ error: e2.message, ticker: sym }), { status: 502, headers: cors });
    }
  }
}
