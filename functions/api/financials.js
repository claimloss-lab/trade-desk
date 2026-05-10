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
    // Step 1: Get crumb from Yahoo Finance
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    const cookieHeader = cookieRes.headers.get('set-cookie') || '';
    const cookie = cookieHeader.split(';')[0];

    // Step 2: Get crumb
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookie,
      }
    });
    const crumb = await crumbRes.text();

    // Step 3: Fetch financial data with crumb
    const modules = 'incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,defaultKeyStatistics,financialData,summaryDetail';
    const yahooUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Cookie': cookie,
      },
      cf: { cacheTtl: 3600 }
    });

    if (!res.ok) return new Response(JSON.stringify({ error: 'Yahoo fetch failed', status: res.status }), { status: 502, headers: cors });

    const raw = await res.json();
    const result = raw?.quoteSummary?.result?.[0];
    if (!result) return new Response(JSON.stringify({ error: 'No data', ticker }), { status: 404, headers: cors });

    // Helper
    const fmt = (v) => v?.raw ?? v ?? null;
    const fmtB = (v) => { const n = fmt(v); return n == null ? null : +(n/1e9).toFixed(2); };
    const fmtPct = (v) => { const n = fmt(v); return n == null ? null : +(n*100).toFixed(2); };

    const incomeQ = (result.incomeStatementHistory?.incomeStatementHistory || []).slice(0,4).map(q => ({
      date: q.endDate?.fmt,
      revenue: fmtB(q.totalRevenue),
      grossProfit: fmtB(q.grossProfit),
      operatingIncome: fmtB(q.operatingIncome),
      netIncome: fmtB(q.netIncome),
      eps: fmt(q.dilutedEPS),
    }));

    const balanceQ = (result.balanceSheetHistory?.balanceSheetStatements || []).slice(0,2).map(q => ({
      date: q.endDate?.fmt,
      totalAssets: fmtB(q.totalAssets),
      totalLiab: fmtB(q.totalLiab),
      totalEquity: fmtB(q.totalStockholderEquity),
      cash: fmtB(q.cash),
      totalDebt: fmtB(q.shortLongTermDebt ?? q.longTermDebt),
    }));

    const cashQ = (result.cashflowStatementHistory?.cashflowStatements || []).slice(0,4).map(q => ({
      date: q.endDate?.fmt,
      operatingCF: fmtB(q.totalCashFromOperatingActivities),
      capex: fmtB(q.capitalExpenditures),
      freeCF: q.totalCashFromOperatingActivities?.raw && q.capitalExpenditures?.raw
        ? +((q.totalCashFromOperatingActivities.raw + q.capitalExpenditures.raw)/1e9).toFixed(2) : null,
    }));

    const ks = result.defaultKeyStatistics || {};
    const fd = result.financialData || {};
    const sd = result.summaryDetail || {};
    const ratios = {
      pe: fmt(sd.trailingPE) ?? fmt(sd.forwardPE),
      forwardPE: fmt(sd.forwardPE),
      pb: fmt(ks.priceToBook),
      roe: fmtPct(ks.returnOnEquity) ?? fmtPct(fd.returnOnEquity),
      roa: fmtPct(fd.returnOnAssets),
      grossMargin: fmtPct(fd.grossMargins),
      operatingMargin: fmtPct(fd.operatingMargins),
      netMargin: fmtPct(fd.profitMargins),
      debtToEquity: fmt(fd.debtToEquity),
      currentRatio: fmt(fd.currentRatio),
      eps: fmt(ks.trailingEps),
      epsForward: fmt(ks.forwardEps),
      revenueGrowth: fmtPct(fd.revenueGrowth),
      earningsGrowth: fmtPct(fd.earningsGrowth),
      marketCap: fmtB(sd.marketCap) ?? fmtB(ks.marketCap),
      beta: fmt(ks.beta),
      dividendYield: fmtPct(sd.dividendYield),
    };

    return new Response(JSON.stringify({ ticker, incomeQ, balanceQ, cashQ, ratios }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ticker }), { status: 500, headers: cors });
  }
}
