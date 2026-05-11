export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker');
  const range  = url.searchParams.get('range') || '2y';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  const t = ticker.toUpperCase().trim();
  let sym;
  if (t.endsWith('.BK')) sym = t;
  else if (/\d{2,}$/.test(t)) sym = t + '.BK';
  else if (t.includes('.')) sym = t.replace(/\./g, '-');
  else if (/^[A-Z]{1,5}$/.test(t)) sym = t;
  else sym = t + '.BK';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
  };

  try {
    // Get crumb for authenticated requests
    const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': headers['User-Agent'] } });
    const cookie = (cookieRes.headers.get('set-cookie') || '').split(';')[0];
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...headers, 'Cookie': cookie }
    });
    const crumb = await crumbRes.text();
    const authHeaders = { ...headers, 'Cookie': cookie };

    // Fetch dividend history
    const chartRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}&events=div&crumb=${encodeURIComponent(crumb)}`,
      { headers: authHeaders, cf: { cacheTtl: 3600 } }
    );
    if (!chartRes.ok) throw new Error(`Yahoo chart ${chartRes.status}`);
    const chartData = await chartRes.json();
    const result = chartData?.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const events = result.events?.dividends || {};
    const meta = result.meta || {};

    // Fetch upcoming payDate from quoteSummary
    let upcomingPayDate = null;
    let upcomingExDate = null;
    try {
      const summaryRes = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`,
        { headers: authHeaders, cf: { cacheTtl: 3600 } }
      );
      if (summaryRes.ok) {
        const sd = await summaryRes.json();
        const cal = sd?.quoteSummary?.result?.[0]?.calendarEvents;
        if (cal?.dividendDate?.raw) {
          upcomingPayDate = new Date(cal.dividendDate.raw * 1000).toISOString().split('T')[0];
        }
        if (cal?.exDividendDate?.raw) {
          upcomingExDate = new Date(cal.exDividendDate.raw * 1000).toISOString().split('T')[0];
        }
      }
    } catch {}

    // Build dividend list with payDate
    const dividends = Object.values(events).map(d => {
      const exDate = new Date(d.date * 1000).toISOString().split('T')[0];
      // Use real payDate if this is the upcoming one, else estimate +28 days
      let payDate = null;
      if (upcomingExDate && exDate === upcomingExDate && upcomingPayDate) {
        payDate = upcomingPayDate;
      } else {
        // Estimate: pay date is typically ~28 days after ex-date
        const pd = new Date(d.date * 1000);
        pd.setDate(pd.getDate() + 28);
        payDate = pd.toISOString().split('T')[0] + ' (est.)';
      }
      return { date: exDate, payDate, amount: d.amount, currency: meta.currency || 'THB' };
    }).sort((a, b) => b.date.localeCompare(a.date));

    return new Response(JSON.stringify({
      ticker: t, symbol: sym,
      currency: meta.currency || 'THB',
      dividends, count: dividends.length,
    }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ticker: t, symbol: sym }), { status: 502, headers: cors });
  }
}
