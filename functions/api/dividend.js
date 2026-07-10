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

  // Build Yahoo Finance symbol — unified logic, kept in sync with price.js
  // (FIX: previously BRK-B → "BRK-B.BK" and 9618.HK → "9618-HK", both wrong)
  const NON_US_EXCHANGE_SUFFIXES = new Set([
    'HK','PA','L','DE','T','TO','AX','SI','KS','KQ','SS','SZ','MI','AS','SW',
    'BR','MX','SA','NZ','ST','OL','CO','HE','VI','WA','PR','IS','JK','NS','BO','TW','TWO'
  ]);
  let sym;
  if (t.endsWith('.BK')) {
    sym = t;
  } else if (/\d{2,}$/.test(t)) {
    sym = t + '.BK';
  } else if (t.includes('.')) {
    const suf = t.split('.').pop();
    sym = NON_US_EXCHANGE_SUFFIXES.has(suf) ? t : t.replace(/\./g, '-');
  } else if (/^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(t)) {
    sym = t;
  } else {
    sym = t + '.BK';
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
  };

  try {
    // Get crumb
    const cookieRes = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': headers['User-Agent'] } });
    const cookie = (cookieRes.headers.get('set-cookie') || '').split(';')[0];
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...headers, 'Cookie': cookie }
    });
    const crumb = await crumbRes.text();
    const authHeaders = { ...headers, 'Cookie': cookie };

    const now = Math.floor(Date.now() / 1000);
    const periods = { '1y': 365, '2y': 730, '5y': 1825 };
    const from = now - (periods[range] || 730) * 86400;

    // Fetch dividend history
    const chartRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${encodeURIComponent(range)}&events=div&crumb=${encodeURIComponent(crumb)}`,
      { headers: authHeaders, cf: { cacheTtl: 3600 } }
    );
    if (!chartRes.ok) throw new Error(`Yahoo chart ${chartRes.status}`);
    const chartData = await chartRes.json();
    const result = chartData?.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const events = result.events?.dividends || {};
    const meta   = result.meta || {};
    const isUSD  = (meta.currency || '').toUpperCase() === 'USD';

    // If USD stock — fetch USDTHB history for conversion
    let fxByDate = {};
    let upcomingPayDate = null;
    let upcomingExDate  = null;

    if (isUSD) {
      const [fxRes, summaryRes] = await Promise.all([
        fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/USDTHB=X?period1=${from}&period2=${now}&interval=1d&crumb=${encodeURIComponent(crumb)}`,
          { headers: authHeaders, cf: { cacheTtl: 3600 } }
        ),
        fetch(
          `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=calendarEvents&crumb=${encodeURIComponent(crumb)}`,
          { headers: authHeaders, cf: { cacheTtl: 3600 } }
        )
      ]);

      // Build FX lookup
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        const fxTs    = fxData?.chart?.result?.[0]?.timestamp || [];
        const fxClose = fxData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        fxTs.forEach((ts, i) => {
          if (fxClose[i]) fxByDate[new Date(ts * 1000).toISOString().split('T')[0]] = fxClose[i];
        });
      }

      // Upcoming pay date
      if (summaryRes.ok) {
        const sd  = await summaryRes.json();
        const cal = sd?.quoteSummary?.result?.[0]?.calendarEvents;
        if (cal?.dividendDate?.raw)   upcomingPayDate = new Date(cal.dividendDate.raw   * 1000).toISOString().split('T')[0];
        if (cal?.exDividendDate?.raw) upcomingExDate  = new Date(cal.exDividendDate.raw * 1000).toISOString().split('T')[0];
      }
    }

    // Helper: get FX rate on or before a date
    function getFx(dateStr) {
      if (fxByDate[dateStr]) return fxByDate[dateStr];
      for (let i = 1; i <= 5; i++) {
        const d = new Date(dateStr);
        d.setDate(d.getDate() - i);
        const s = d.toISOString().split('T')[0];
        if (fxByDate[s]) return fxByDate[s];
      }
      return null;
    }

    // Build dividend list
    const dividends = Object.values(events).map(d => {
      const exDate     = new Date(d.date * 1000).toISOString().split('T')[0];
      const usdAmount  = d.amount;
      const fxRate     = isUSD ? getFx(exDate) : null;
      const thbAmount  = fxRate ? +(usdAmount * fxRate).toFixed(6) : null;

      // Pay date
      let payDate = null;
      if (upcomingExDate && exDate === upcomingExDate && upcomingPayDate) {
        payDate = upcomingPayDate;
      } else {
        const pd = new Date(d.date * 1000);
        pd.setDate(pd.getDate() + 28);
        payDate = pd.toISOString().split('T')[0] + ' (est.)';
      }

      return {
        date:       exDate,
        payDate,
        amount:     isUSD && thbAmount ? thbAmount : usdAmount, // THB if converted
        amountUSD:  isUSD ? usdAmount : null,
        fxRate:     fxRate ? +fxRate.toFixed(4) : null,
        currency:   isUSD && thbAmount ? 'THB' : (meta.currency || 'THB'),
      };
    }).sort((a, b) => b.date.localeCompare(a.date));

    return new Response(JSON.stringify({
      ticker: t, symbol: sym,
      currency: isUSD && Object.keys(fxByDate).length ? 'THB' : (meta.currency || 'THB'),
      dividends,
      count: dividends.length,
    }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ticker: t, symbol: sym }), { status: 502, headers: cors });
  }
}
