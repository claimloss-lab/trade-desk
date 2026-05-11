export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(context.request.url);
  const fund = url.searchParams.get('fund')?.toUpperCase();
  if (!fund) return new Response(JSON.stringify({ error: 'missing fund' }), { status: 400, headers: cors });

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

  try {
    const res = await fetch(
      `https://www.finnomena.com/fn3/api/cms/public/charlie/fund/${encodeURIComponent(fund)}`,
      {
        headers: {
          'User-Agent': ua,
          'Accept': 'application/json',
          'Referer': `https://www.finnomena.com/fund/${fund}`,
          'Origin': 'https://www.finnomena.com',
        },
        cf: { cacheTtl: 1800 }
      }
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Finnomena ${res.status}`, fund }), { status: 502, headers: cors });
    }

    const data = await res.json();

    // Extract NAV fields from Finnomena charlie API
    const nav    = data?.last_val   || data?.nav       || data?.NAV;
    const date   = data?.nav_date   || data?.last_date || data?.date;
    const name   = data?.name_th    || data?.name      || data?.fund_name || fund;
    const change = data?.diff_val   || data?.change;
    const changePct = data?.diff_percent || data?.change_percent;

    if (!nav) {
      return new Response(JSON.stringify({
        error: 'NAV field not found', fund,
        keys: Object.keys(data).slice(0, 20),
        sample: JSON.stringify(data).slice(0, 300),
      }), { status: 404, headers: cors });
    }

    return new Response(JSON.stringify({
      fund,
      source: 'finnomena',
      nav: parseFloat(nav),
      date,
      name,
      change:    change    ? parseFloat(change)    : null,
      changePct: changePct ? parseFloat(changePct) : null,
    }), { headers: cors });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message, fund }), { status: 500, headers: cors });
  }
}
