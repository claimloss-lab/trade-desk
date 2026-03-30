export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker');

  // CORS headers - allow browser to call this API
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (!ticker) {
    return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });
  }

  const sym = ticker.toUpperCase() + '.BK';

  // Try Yahoo Finance v8 chart API
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Referer': 'https://finance.yahoo.com',
        },
        cf: { cacheTtl: 60, cacheEverything: false }, // cache 60s at edge
      }
    );

    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);

    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;

    if (!meta || !meta.regularMarketPrice) {
      throw new Error('No price data in response');
    }

    return new Response(JSON.stringify({
      ticker: ticker.toUpperCase(),
      symbol: sym,
      price: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose || meta.previousClose || null,
      currency: meta.currency || 'THB',
      marketState: meta.marketState || 'UNKNOWN',
      timestamp: Date.now(),
    }), { headers: cors });

  } catch (err) {
    // Fallback: try v7 quote API
    try {
      const res2 = await fetch(
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${sym}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://finance.yahoo.com',
          },
        }
      );

      const data2 = await res2.json();
      const q = data2?.quoteResponse?.result?.[0];

      if (!q || !q.regularMarketPrice) throw new Error('No fallback data');

      return new Response(JSON.stringify({
        ticker: ticker.toUpperCase(),
        symbol: sym,
        price: q.regularMarketPrice,
        prevClose: q.regularMarketPreviousClose || null,
        currency: q.currency || 'THB',
        marketState: q.marketState || 'UNKNOWN',
        timestamp: Date.now(),
      }), { headers: cors });

    } catch (err2) {
      return new Response(JSON.stringify({
        error: 'Failed to fetch price',
        ticker: ticker.toUpperCase(),
        symbol: sym,
        details: err2.message,
      }), { status: 502, headers: cors });
    }
  }
}
