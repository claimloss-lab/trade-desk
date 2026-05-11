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
  const baseHeaders = {
    'User-Agent': ua,
    'Accept': 'application/json',
    'Referer': 'https://www.finnomena.com/',
    'Origin': 'https://www.finnomena.com',
  };

  try {
    // Step 1: Get fund list to find fund_id from short_code
    const fundsRes = await fetch(
      'https://www.finnomena.com/fn3/api/fund/v2/public/funds',
      { headers: baseHeaders, cf: { cacheTtl: 86400 } } // cache 24h
    );

    if (!fundsRes.ok) {
      return new Response(JSON.stringify({ error: 'Cannot fetch fund list', status: fundsRes.status }), { status: 502, headers: cors });
    }

    const fundsData = await fundsRes.json();
    const funds = fundsData?.data || fundsData?.funds || fundsData || [];
    const matched = funds.find(f =>
      f.short_code?.toUpperCase() === fund ||
      f.fund_code?.toUpperCase() === fund ||
      f.symbol?.toUpperCase() === fund
    );

    if (!matched) {
      return new Response(JSON.stringify({
        error: 'Fund not found in Finnomena',
        fund,
        totalFunds: funds.length,
        sample: funds.slice(0, 3).map(f => ({ short_code: f.short_code, fund_id: f.fund_id })),
      }), { status: 404, headers: cors });
    }

    const fundId = matched.fund_id || matched.id;

    // Step 2: Get latest NAV
    const navRes = await fetch(
      `https://www.finnomena.com/fn3/api/fund/v2/public/funds/${fundId}/latest`,
      { headers: baseHeaders, cf: { cacheTtl: 3600 } }
    );

    if (!navRes.ok) {
      return new Response(JSON.stringify({ error: 'NAV fetch failed', status: navRes.status, fundId }), { status: 502, headers: cors });
    }

    const navData = await navRes.json();
    const d = navData?.data || navData;

    return new Response(JSON.stringify({
      fund,
      fundId,
      source: 'finnomena',
      nav: d?.value != null ? parseFloat(d.value) : null,
      date: d?.date ? d.date.split('T')[0] : null,
      change: d?.d_change != null ? parseFloat(d.d_change) : null,
      name: matched?.name_th || matched?.fund_name || fund,
    }), { headers: cors });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message, fund }), { status: 500, headers: cors });
  }
}
