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

  // Manual fund_id mapping — Finnomena uses spaces/different format
  const FUND_ID_MAP = {
    'KKP-US500-UH-E':   'F00001KZM9',
    'KKP-NDQ100-UH-E':  'F00001J49T',
    'KKP-US500-H-E':    null,  // add if needed
    'TLNDQINCOME-UH-X': null,  // try search fallback
  };

  // Also try replacing - with space for KKP funds
  const normalizedFund = fund.replace(/-/g, ' ');

  try {
    let fundId = FUND_ID_MAP[fund] ?? null;

    // If no manual mapping, search by short_code
    if (!fundId) {
      const fundsRes = await fetch(
        'https://www.finnomena.com/fn3/api/fund/v2/public/funds',
        { headers: baseHeaders, cf: { cacheTtl: 86400 } }
      );
      if (fundsRes.ok) {
        const fundsData = await fundsRes.json();
        const funds = fundsData?.data || fundsData?.funds || fundsData || [];
        const matched = funds.find(f =>
          f.short_code?.toUpperCase() === fund ||
          f.short_code?.toUpperCase() === normalizedFund ||
          f.fund_code?.toUpperCase() === fund ||
          f.symbol?.toUpperCase() === fund
        );
        if (matched) fundId = matched.fund_id || matched.id;
      }
    }

    if (!fundId) {
      return new Response(JSON.stringify({
        error: 'Fund not found — add to FUND_ID_MAP',
        fund,
        hint: `Open Finnomena, search ${fund}, check Network tab for fund_id`
      }), { status: 404, headers: cors });
    }

    // Fetch latest NAV
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
      fund, fundId, source: 'finnomena',
      nav: d?.value != null ? parseFloat(d.value) : null,
      date: d?.date ? d.date.split('T')[0] : null,
      change: d?.d_change != null ? parseFloat(d.d_change) : null,
    }), { headers: cors });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message, fund }), { status: 500, headers: cors });
  }
}
