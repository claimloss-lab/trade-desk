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

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
  };

  // ── Try 1: SEC API ──
  try {
    const secRes = await fetch(
      `https://api.sec.or.th/FundFactsheet/fund/dailynav/${fund}`,
      { headers: { ...headers, 'accept': 'application/json' }, cf: { cacheTtl: 3600 } }
    );
    if (secRes.ok) {
      const data = await secRes.json();
      // SEC returns array of daily NAV
      const latest = Array.isArray(data) ? data[0] : data;
      if (latest?.nav || latest?.net_asset_value) {
        return new Response(JSON.stringify({
          fund, source: 'sec',
          nav: latest.nav || latest.net_asset_value,
          date: latest.nav_date || latest.date,
          name: latest.fund_name_th || latest.fund_name || fund,
        }), { headers: cors });
      }
    }
  } catch(e) {}

  // ── Try 2: Finnomena ──
  try {
    const finnRes = await fetch(
      `https://finnomena.com/fn3/api/fund/nav/${fund}`,
      { headers, cf: { cacheTtl: 3600 } }
    );
    if (finnRes.ok) {
      const data = await finnRes.json();
      const nav = data?.nav || data?.data?.nav || data?.last_nav;
      if (nav) {
        return new Response(JSON.stringify({
          fund, source: 'finnomena',
          nav: parseFloat(nav),
          date: data?.nav_date || data?.date,
          name: data?.name_th || data?.fund_name || fund,
        }), { headers: cors });
      }
    }
  } catch(e) {}

  // ── Try 3: Kasset (KAsset API) ──
  try {
    const kasRes = await fetch(
      `https://www.kasikornasset.com/api/fundprice?fund=${fund}`,
      { headers, cf: { cacheTtl: 3600 } }
    );
    if (kasRes.ok) {
      const data = await kasRes.json();
      const nav = data?.nav || data?.price;
      if (nav) {
        return new Response(JSON.stringify({
          fund, source: 'kasset',
          nav: parseFloat(nav),
          date: data?.date,
          name: data?.fund_name || fund,
        }), { headers: cors });
      }
    }
  } catch(e) {}

  // ── Try 4: Settrade fund search ──
  try {
    const stRes = await fetch(
      `https://www.settrade.com/api/fund/nav?symbol=${fund}`,
      { headers, cf: { cacheTtl: 3600 } }
    );
    if (stRes.ok) {
      const data = await stRes.json();
      const nav = data?.nav || data?.data?.[0]?.nav;
      if (nav) {
        return new Response(JSON.stringify({
          fund, source: 'settrade',
          nav: parseFloat(nav),
          date: data?.date || data?.data?.[0]?.date,
          name: fund,
        }), { headers: cors });
      }
    }
  } catch(e) {}

  return new Response(JSON.stringify({
    error: 'NAV not found from any source',
    fund,
    tried: ['sec', 'finnomena', 'kasset', 'settrade']
  }), { status: 404, headers: cors });
}
