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
    // Response format: { status: true, service_code: "69", data: { ... } }
    const d = data?.data || data;
    const nav    = d?.last_val   || d?.nav        || d?.NAV ||
                   d?.last_nav   || d?.price       || d?.nav_price;
    const date   = d?.nav_date   || d?.last_date  || d?.date || d?.as_of_date;
    const name   = d?.name_th    || d?.name       || d?.fund_name ||
                   d?.fund_name_th || fund;
    const change    = d?.diff_val     || d?.change;
    const changePct = d?.diff_percent || d?.change_percent;

    if (!nav) {
      const d2 = data?.data || data;
      return new Response(JSON.stringify({
        error: 'NAV field not found', fund,
        topKeys: Object.keys(data).slice(0, 10),
        dataKeys: typeof d2 === 'object' ? Object.keys(d2).slice(0, 20) : [],
        sample: JSON.stringify(d2).slice(0, 400),
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
