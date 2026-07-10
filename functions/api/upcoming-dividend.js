export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  try {
    // Get crumb
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const cookie = (cookieRes.headers.get('set-cookie') || '').split(';')[0];
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie }
    });
    const crumb = await crumbRes.text();

    // Fetch quote summary for dividend info
    const modules = 'calendarEvents,summaryDetail,defaultKeyStatistics';
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' } }
    );

    if (!res.ok) return new Response(JSON.stringify({ error: 'Yahoo fetch failed', status: res.status }), { status: 502, headers: cors });

    const raw = await res.json();
    const result = raw?.quoteSummary?.result?.[0];
    if (!result) return new Response(JSON.stringify({ error: 'No data' }), { status: 404, headers: cors });

    const cal = result.calendarEvents || {};
    const sd = result.summaryDetail || {};

    const fmt = v => v?.raw ?? v ?? null;
    const fmtDate = v => v?.fmt ?? null;

    return new Response(JSON.stringify({
      ticker,
      exDividendDate: fmtDate(sd.exDividendDate),
      dividendDate: fmtDate(cal.dividendDate),
      dividendRate: fmt(sd.dividendRate),
      dividendYield: fmt(sd.dividendYield) != null ? +(fmt(sd.dividendYield) * 100).toFixed(2) : null,
      // FIX: previously read ks.fiveYearAverageReturn (wrong field — that's fund return)
      fiveYearAvgDividendYield: fmt(sd.fiveYearAvgDividendYield),
      payoutRatio: fmt(sd.payoutRatio) != null ? +(fmt(sd.payoutRatio) * 100).toFixed(2) : null,
      trailingAnnualDividendRate: fmt(sd.trailingAnnualDividendRate),
      trailingAnnualDividendYield: fmt(sd.trailingAnnualDividendYield) != null ? +(fmt(sd.trailingAnnualDividendYield) * 100).toFixed(2) : null,
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
