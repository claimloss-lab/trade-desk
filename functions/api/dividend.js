export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker  = url.searchParams.get('ticker');
  const range   = url.searchParams.get('range') || '2y';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  const t = ticker.toUpperCase().trim();

  // Determine Yahoo symbol
  let sym;
  if (t.endsWith('.BK')) sym = t;
  else if (/\d{2,}$/.test(t)) sym = t + '.BK';   // SET DR
  else if (t.includes('.')) sym = t.replace(/\./g, '-');
  else if (/^[A-Z]{1,5}$/.test(t)) sym = t;
  else sym = t + '.BK';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
  };

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&events=div`,
      { headers, cf: { cacheTtl: 3600 } }
    );
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const events = result.events?.dividends || {};
    const meta = result.meta || {};

    // Convert dividends object to sorted array
    const dividends = Object.values(events)
      .map(d => ({
        date: new Date(d.date * 1000).toISOString().split('T')[0],
        amount: d.amount,
        currency: meta.currency || 'THB',
      }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first

    return new Response(JSON.stringify({
      ticker: t,
      symbol: sym,
      currency: meta.currency || 'THB',
      dividends,
      count: dividends.length,
    }), { headers: cors });

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message, ticker: t, symbol: sym }),
      { status: 502, headers: cors }
    );
  }
}
