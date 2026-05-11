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
  const results = {};

  // ── SEC Open API (api.sec.or.th) ──
  const secEndpoints = [
    `https://api.sec.or.th/FundFactsheet/fund/dailynav/${encodeURIComponent(fund)}`,
    `https://api.sec.or.th/FundFactsheet/fund/navperdaterange/${encodeURIComponent(fund)}?startdate=2025-01-01&enddate=2099-12-31`,
    `https://api.sec.or.th/FundInfo/fund/${encodeURIComponent(fund)}`,
  ];

  for (const ep of secEndpoints) {
    try {
      const r = await fetch(ep, {
        headers: { 'User-Agent': ua, 'Accept': 'application/json', 'Ocp-Apim-Subscription-Key': '' },
        cf: { cacheTtl: 1800 }
      });
      results[ep] = { status: r.status, ok: r.ok };
      if (r.ok) {
        const text = await r.text();
        results[ep].body = text.slice(0, 200);
        try {
          const data = JSON.parse(text);
          const arr = Array.isArray(data) ? data : [data];
          const latest = arr.sort((a,b) => (b.nav_date||b.date||'').localeCompare(a.nav_date||a.date||''))[0];
          const nav = latest?.net_asset_value || latest?.nav || latest?.price;
          if (nav) {
            return new Response(JSON.stringify({
              fund, source: 'sec', nav: parseFloat(nav),
              date: latest?.nav_date || latest?.date,
              name: latest?.proj_name_th || latest?.fund_name_th || fund,
            }), { headers: cors });
          }
        } catch {}
      }
    } catch(e) { results[ep] = { error: e.message }; }
  }

  // ── Finnomena (multiple endpoints) ──
  const finnEndpoints = [
    `https://finnomena.com/fn3/api/fund/nav/latest?symbol=${fund}`,
    `https://finnomena.com/fn3/api/fund/${fund}/nav`,
    `https://www.finnomena.com/fn3/api/fund/nav?symbol=${fund}`,
  ];
  for (const ep of finnEndpoints) {
    try {
      const r = await fetch(ep, {
        headers: { 'User-Agent': ua, 'Accept': 'application/json', 'Referer': 'https://finnomena.com' },
        cf: { cacheTtl: 1800 }
      });
      results[ep] = { status: r.status };
      if (r.ok) {
        const text = await r.text();
        results[ep].body = text.slice(0, 200);
        try {
          const data = JSON.parse(text);
          const nav = data?.nav || data?.data?.nav || data?.last_nav || data?.data?.[0]?.nav;
          if (nav) {
            return new Response(JSON.stringify({
              fund, source: 'finnomena', nav: parseFloat(nav),
              date: data?.nav_date || data?.date,
            }), { headers: cors });
          }
        } catch {}
      }
    } catch(e) { results[ep] = { error: e.message }; }
  }

  // ── Morningstar Thailand ──
  try {
    const msUrl = `https://lt.morningstar.com/api/rest.svc/timeseries_price/9vehuxllxs?id=${fund}%5D2%5D1%5DTHAI&currencyId=THA&idtype=Morningstar&frequency=daily&startDate=2025-01-01&outputType=COMPACTJSON`;
    const r = await fetch(msUrl, { headers: { 'User-Agent': ua }, cf: { cacheTtl: 1800 } });
    results['morningstar'] = { status: r.status };
    if (r.ok) {
      const data = await r.json();
      const prices = data?.d?.[0]?.PriceDataList?.[0]?.Datapoints;
      if (prices?.length) {
        const last = prices[prices.length - 1];
        return new Response(JSON.stringify({
          fund, source: 'morningstar', nav: last?.[1], date: last?.[0],
        }), { headers: cors });
      }
    }
  } catch(e) { results['morningstar'] = { error: e.message }; }

  // ── AIMC (สมาคมบริษัทจัดการลงทุน) ──
  try {
    const aimcUrl = `https://www.aimc.or.th/en/fund/search?fund_code=${fund}&type=daily_nav`;
    const r = await fetch(aimcUrl, { headers: { 'User-Agent': ua }, cf: { cacheTtl: 1800 } });
    results['aimc'] = { status: r.status };
  } catch(e) {}

  return new Response(JSON.stringify({
    error: 'NAV not found', fund,
    debug: results
  }), { status: 404, headers: cors });
}
