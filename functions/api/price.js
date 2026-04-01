export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  const t = ticker.toUpperCase().trim();

  const yHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com',
  };

  // ── THAI MUTUAL FUNDS → Settrade scrape ──
  // Detect: contains letters+hyphen pattern like BGOLDRMF, RMFBINNOTECH, ESGSI, K-GA-A, MEGA
  const isMutualFund = (
    t.startsWith('K-') || t.startsWith('MEGA') ||
    t.includes('RMF') || t.includes('LTF') || t.includes('SSF') ||
    t.includes('ESG') || t.includes('THAIESG') ||
    /^B-/.test(t) || /^KFSDIV/.test(t) || /^TMBG/.test(t) ||
    /^[A-Z]{2,}-[A-Z]/.test(t)  // pattern like B-SI-THAIESG
  );

  if (isMutualFund) {
    return await fetchSettradeFundNAV(t, cors);
  }

  // ── FX pairs ──
  if (t.includes('=X')) {
    return await fetchYahoo(t, cors, yHeaders);
  }

  // ── Determine Yahoo Finance symbol ──
  let sym;
  if (t.endsWith('.BK')) {
    sym = t;
  } else if (/\d{2,}$/.test(t)) {
    sym = t + '.BK';        // SET DR: AMZN80 → AMZN80.BK
  } else if (t.includes('.')) {
    sym = t.replace(/\./g, '-');  // BRK.B → BRK-B
  } else if (/^[A-Z]{1,5}$/.test(t)) {
    sym = t;                // US stocks: VOO, SCHD
  } else {
    sym = t + '.BK';        // Default: Thai SET stock
  }

  return await fetchYahoo(sym, cors, yHeaders, t);
}

// ── Fetch NAV from Settrade ──
async function fetchSettradeFundNAV(fundCode, cors) {
  const stHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
    'Referer': 'https://www.settrade.com/',
  };

  try {
    const res = await fetch(
      `https://www.settrade.com/th/mutualfund/quote/${encodeURIComponent(fundCode)}/overview`,
      { headers: stHeaders, cf: { cacheTtl: 3600 } }
    );

    if (!res.ok) throw new Error(`Settrade returned ${res.status}`);

    const html = await res.text();

    // Parse NAV from embedded JS data — pattern: navPerUnit:12.3456
    const navMatch = html.match(/navPerUnit["\s:]+(\d+\.?\d*)/);
    const dateMatch = html.match(/navDate["\s:]*"([^"]+)"/);
    const prevMatch = html.match(/previousNavPerUnit["\s:]+(\d+\.?\d*)/);

    if (navMatch) {
      const nav = parseFloat(navMatch[1]);
      const prev = prevMatch ? parseFloat(prevMatch[1]) : null;
      const navDate = dateMatch ? dateMatch[1] : null;

      return new Response(JSON.stringify({
        ticker: fundCode,
        symbol: fundCode,
        price: nav,
        prevClose: prev,
        currency: 'THB',
        navDate,
        source: 'settrade',
        timestamp: Date.now(),
      }), { headers: cors });
    }

    // Fallback: try another pattern
    const navMatch2 = html.match(/"navPerUnit"[:\s]*(\d+\.?\d*)/);
    if (navMatch2) {
      return new Response(JSON.stringify({
        ticker: fundCode,
        symbol: fundCode,
        price: parseFloat(navMatch2[1]),
        currency: 'THB',
        source: 'settrade',
        timestamp: Date.now(),
      }), { headers: cors });
    }

    throw new Error('NAV not found in page');

  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Settrade NAV fetch failed: ' + e.message,
      ticker: fundCode,
      hint: 'ตรวจสอบชื่อกองทุนที่ settrade.com/th/mutualfund/quote/' + fundCode + '/overview'
    }), { status: 502, headers: cors });
  }
}

// ── Fetch from Yahoo Finance ──
async function fetchYahoo(sym, cors, yHeaders, originalTicker) {
  const t = originalTicker || sym;

  async function fetchV8(symbol) {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      { headers: yHeaders, cf: { cacheTtl: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return { ticker: t, symbol, price: meta.regularMarketPrice, prevClose: meta.chartPreviousClose || meta.previousClose || null, currency: meta.currency || 'THB', marketState: meta.marketState || 'UNKNOWN', timestamp: Date.now() };
  }

  async function fetchV7(symbol) {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
      { headers: yHeaders }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const q = data?.quoteResponse?.result?.[0];
    if (!q?.regularMarketPrice) return null;
    return { ticker: t, symbol, price: q.regularMarketPrice, prevClose: q.regularMarketPreviousClose || null, currency: q.currency || 'THB', marketState: q.marketState || 'UNKNOWN', timestamp: Date.now() };
  }

  try { const r = await fetchV8(sym); if (r) return new Response(JSON.stringify(r), { headers: cors }); } catch {}
  try { const r = await fetchV7(sym); if (r) return new Response(JSON.stringify(r), { headers: cors }); } catch {}

  return new Response(JSON.stringify({ error: 'Price not found', ticker: t, symbol: sym }), { status: 502, headers: cors });
}
