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
  const debug = {};

  // ── Try Finnomena endpoints (known working formats) ──
  const finnEndpoints = [
    `https://finnomena.com/fn3/api/fund/nav/latest?fund=${fund}`,
    `https://finnomena.com/fn3/api/fund/nav?fund=${fund}`,
    `https://www.finnomena.com/fn3/api/fund/nav/latest?fund=${fund}`,
    `https://finnomena.com/fn3/api/fund/info?fund=${fund}`,
    `https://finnomena.com/fn3/api/fund/search?query=${fund}&limit=1`,
  ];

  for (const ep of finnEndpoints) {
    try {
      const r = await fetch(ep, {
        headers: {
          'User-Agent': ua,
          'Accept': 'application/json',
          'Referer': 'https://finnomena.com/fund/',
          'Origin': 'https://finnomena.com',
        },
        cf: { cacheTtl: 1800 }
      });
      const text = await r.text();
      debug[ep.replace('https://finnomena.com','finn').replace('https://www.finnomena.com','finn')] = {
        status: r.status, body: text.slice(0, 300)
      };
      if (r.ok && text.length > 2) {
        try {
          const data = JSON.parse(text);
          // Try various nav field names
          const nav = data?.nav || data?.NAV || data?.data?.nav ||
                      data?.data?.NAV || data?.funds?.[0]?.nav ||
                      data?.result?.nav || data?.last_nav;
          const date = data?.nav_date || data?.date || data?.data?.nav_date ||
                       data?.funds?.[0]?.nav_date;
          const name = data?.name_th || data?.fund_name || data?.data?.name_th ||
                       data?.funds?.[0]?.name_th || fund;
          if (nav) {
            return new Response(JSON.stringify({
              fund, source: 'finnomena', nav: parseFloat(nav), date, name
            }), { headers: cors });
          }
        } catch {}
      }
    } catch(e) { debug[ep] = { error: e.message }; }
  }

  // ── Try SEC with subscription key ──
  const secEndpoints = [
    `https://api.sec.or.th/FundFactsheet/fund/dailynav/${fund}`,
    `https://api.sec.or.th/FundInfo/fund/${fund}/dailynav`,
    `https://api.sec.or.th/FundInfo/fund/dailynav?fund_id=${fund}`,
  ];

  for (const ep of secEndpoints) {
    try {
      const r = await fetch(ep, {
        headers: {
          'User-Agent': ua,
          'Accept': 'application/json',
          'Ocp-Apim-Subscription-Key': context.env.SEC_API_KEY || '',
        },
        cf: { cacheTtl: 1800 }
      });
      const text = await r.text();
      debug['sec_' + ep.split('/').pop()] = { status: r.status, body: text.slice(0, 200) };
      if (r.ok && text.length > 2 && text !== '[]') {
        try {
          const data = JSON.parse(text);
          const arr = Array.isArray(data) ? data : [data];
          if (arr.length) {
            const latest = arr[0];
            const nav = latest?.net_asset_value || latest?.nav || latest?.NAV;
            if (nav) {
              return new Response(JSON.stringify({
                fund, source: 'sec', nav: parseFloat(nav),
                date: latest?.nav_date || latest?.date,
                name: latest?.proj_name_th || fund,
              }), { headers: cors });
            }
          }
        } catch {}
      }
    } catch(e) { debug['sec_' + ep] = { error: e.message }; }
  }

  // ── Try AIMC ──
  try {
    const r = await fetch(
      `https://www.aimc.or.th/th/mutual-fund/fund-price/?fund_code=${fund}`,
      { headers: { 'User-Agent': ua, 'Accept': 'text/html' }, cf: { cacheTtl: 1800 } }
    );
    debug['aimc'] = { status: r.status };
    if (r.ok) {
      const html = await r.text();
      const navMatch = html.match(/NAV[^0-9]*([0-9]+\.[0-9]+)/i) ||
                       html.match(/(\d+\.\d{4})/);
      if (navMatch) {
        return new Response(JSON.stringify({
          fund, source: 'aimc', nav: parseFloat(navMatch[1])
        }), { headers: cors });
      }
      debug['aimc'].bodyLen = html.length;
    }
  } catch(e) { debug['aimc'] = { error: e.message }; }

  return new Response(JSON.stringify({ error: 'NAV not found', fund, debug }), {
    status: 404, headers: cors
  });
}
