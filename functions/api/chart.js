export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker   = url.searchParams.get('ticker');
  const range    = url.searchParams.get('range')    || '1mo';
  const interval = url.searchParams.get('interval') || '1d';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  const t = ticker.toUpperCase().trim();

  // Build Yahoo Finance symbol — same logic as price.js
  let sym;
  if (t.endsWith('.BK')) {
    sym = t;
  } else if (t.includes('=X')) {
    sym = t;
  } else if (/\d{2,}$/.test(t)) {
    // SET DR like AMZN80 → try AMZN80.BK first, fallback to parent (AMZN)
    sym = t + '.BK';
  } else if (t.includes('.')) {
    sym = t.replace(/\./g, '-');    // BRK.B → BRK-B
  } else if (/^[A-Z]{1,5}$/.test(t)) {
    sym = t;
  } else {
    sym = t + '.BK';
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
  };

  async function tryFetch(symbol) {
    for (const host of ['query1', 'query2']) {
      try {
        const res = await fetch(
          `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
          { headers, cf: { cacheTtl: 300 } }
        );
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.chart?.result?.[0]?.timestamp) return data;
      } catch {}
    }
    return null;
  }

  // Try primary symbol first
  let data = await tryFetch(sym);

  // If SET DR (ends with .BK but has digits before) fails → try US parent ticker
  // e.g. AMZN80.BK fails → try AMZN
  if (!data && /\d{2,}\.BK$/.test(sym)) {
    const parent = sym.replace(/\d+\.BK$/, '');  // AMZN80.BK → AMZN
    if (parent) data = await tryFetch(parent);
  }

  if (data) return new Response(JSON.stringify(data), { headers: cors });

  return new Response(
    JSON.stringify({ error: 'Chart not found', ticker: t, symbol: sym }),
    { status: 502, headers: cors }
  );
}
