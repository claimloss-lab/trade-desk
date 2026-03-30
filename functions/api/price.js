export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  if (!ticker) {
    return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });
  }

  const t = ticker.toUpperCase().trim();

  // Skip mutual funds (no realtime price)
  if (t.includes('-A') || t.includes('(A)') || t.startsWith('K-') || t.startsWith('MEGA')) {
    return new Response(JSON.stringify({ error: 'mutual fund - no realtime price', ticker: t }), { status: 404, headers: cors });
  }

  // Determine Yahoo Finance symbol:
  // - Already has .BK suffix → use as-is (SET DR / Thai stocks)
  // - Looks like SET DR (ends in digits) → add .BK
  // - Looks like US stock (no suffix, no digits at end) → use raw
  let sym;
  if (t.endsWith('.BK')) {
    sym = t;
  } else if (/\d{2,}$/.test(t)) {
    // SET DR: AMZN80, ASML01, etc.
    sym = t + '.BK';
  } else if (/^[A-Z]{1,5}$/.test(t) || t.includes('.')) {
    // US stock/ETF: BRK.B, VOO, SCHD, etc.
    sym = t;
  } else {
    // Default: assume Thai SET stock → add .BK
    sym = t + '.BK';
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
  };

  // Try v8 chart API
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`,
      { headers, cf: { cacheTtl: 60 } }
    );
    if (res.ok) {
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) {
        return new Response(JSON.stringify({
          ticker: t, symbol: sym,
          price: meta.regularMarketPrice,
          prevClose: meta.chartPreviousClose || meta.previousClose || null,
          currency: meta.currency || 'THB',
          marketState: meta.marketState || 'UNKNOWN',
          timestamp: Date.now(),
        }), { headers: cors });
      }
    }
  } catch {}

  // Fallback: v7 quote
  try {
    const res2 = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}`,
      { headers }
    );
    if (res2.ok) {
      const data2 = await res2.json();
      const q = data2?.quoteResponse?.result?.[0];
      if (q?.regularMarketPrice) {
        return new Response(JSON.stringify({
          ticker: t, symbol: sym,
          price: q.regularMarketPrice,
          prevClose: q.regularMarketPreviousClose || null,
          currency: q.currency || 'THB',
          marketState: q.marketState || 'UNKNOWN',
          timestamp: Date.now(),
        }), { headers: cors });
      }
    }
  } catch {}

  return new Response(JSON.stringify({
    error: 'Price not found', ticker: t, symbol: sym,
  }), { status: 404, headers: cors });
}
