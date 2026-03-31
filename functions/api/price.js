export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  const t = ticker.toUpperCase().trim();

  const yHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
  };

  // Skip Thai mutual funds
  if (t.includes('(A)') || t.startsWith('K-') || t.startsWith('MEGA') || t.startsWith('BGOLD') || t.startsWith('RMF') || t.startsWith('ESGSI')) {
    return new Response(JSON.stringify({ error: 'mutual fund — no realtime price', ticker: t }), { status: 404, headers: cors });
  }

  // Determine Yahoo Finance symbol
  let sym;
  if (t.endsWith('.BK')) {
    sym = t;                        // SET stock: PTT.BK
  } else if (t.includes('=X')) {
    sym = t;                        // FX: USDTHB=X
  } else if (/\d{2,}$/.test(t)) {
    sym = t + '.BK';                // SET DR: AMZN80 → AMZN80.BK
  } else if (t.includes('.')) {
    sym = t.replace(/\./g, '-');    // US dotted: BRK.B → BRK-B
  } else if (/^[A-Z]{1,5}$/.test(t)) {
    sym = t;                        // US clean: VOO, SCHD, JEPQ
  } else {
    sym = t + '.BK';                // Default: Thai SET
  }

  async function fetchV8(symbol) {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      { headers: yHeaders, cf: { cacheTtl: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return { ticker: t, symbol, price: meta.regularMarketPrice, prevClose: meta.chartPreviousClose || meta.previousClose || null, currency: meta.currency || 'THB', marketState: meta.marketState || 'UNKNOWN', timestamp: Date.now() };
  }

  async function fetchV7(symbol) {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
      { headers: yHeaders }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const q = data?.quoteResponse?.result?.[0];
    if (!q?.regularMarketPrice) return null;
    return { ticker: t, symbol, price: q.regularMarketPrice, prevClose: q.regularMarketPreviousClose || null, currency: q.currency || 'THB', marketState: q.marketState || 'UNKNOWN', timestamp: Date.now() };
  }

  try { const r = await fetchV8(sym); if (r) return new Response(JSON.stringify(r), { headers: cors }); } catch {}
  try { const r = await fetchV7(sym); if (r) return new Response(JSON.stringify(r), { headers: cors }); } catch {}

  return new Response(JSON.stringify({ error: 'Price not found', ticker: t, symbol: sym }), { status: 502, headers: cors });
}
