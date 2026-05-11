export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(context.request.url);
  const drTicker   = url.searchParams.get('dr')?.toUpperCase();   // e.g. AMZN80
  const usTicker   = url.searchParams.get('us')?.toUpperCase();   // e.g. AMZN
  const range      = url.searchParams.get('range') || '2y';

  if (!drTicker || !usTicker) {
    return new Response(JSON.stringify({ error: 'missing dr or us param' }), { status: 400, headers: cors });
  }

  const setHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
    'Referer': 'https://www.set.or.th/',
  };

  try {
    // ── Step 1: Get DR ratio from SET profile page ──
    let drRatio = null;
    const profileUrl = `https://www.set.or.th/th/market/product/dr/quote/${drTicker}/company-profile`;
    const profileRes = await fetch(profileUrl, { headers: setHeaders, cf: { cacheTtl: 86400 } });

    if (profileRes.ok) {
      const html = await profileRes.text();
      // Look for ratio pattern like "1 DR : 0.1 Underlying" or "อัตราแปลงสภาพ"
      const ratioPatterns = [
        /อัตราแปลงสภาพ[^:]*:\s*([\d.]+)\s*(?:DR\s*)?:\s*([\d.]+)/i,
        /(\d+(?:\.\d+)?)\s*DR\s*:\s*([\d.]+)\s*(?:Underlying|หุ้นอ้างอิง)/i,
        /ratio[^:]*:\s*([\d.]+)\s*:\s*([\d.]+)/i,
        /(\d+)\s*:\s*([\d.]+)\s*(?:share|หุ้น)/i,
        /"conversionRatio":\s*([\d.]+)/i,
        /"ratio":\s*"?([\d.]+):?([\d.]+)?/i,
      ];

      for (const pattern of ratioPatterns) {
        const m = html.match(pattern);
        if (m) {
          // ratio = underlying per 1 DR
          drRatio = m[2] ? parseFloat(m[2]) / parseFloat(m[1]) : parseFloat(m[1]);
          break;
        }
      }

      // Also try to find in JSON data embedded in page
      const jsonMatch = html.match(/"drRatio":\s*([\d.]+)/) ||
                        html.match(/"conversionRatio":\s*([\d.]+)/);
      if (!drRatio && jsonMatch) {
        drRatio = parseFloat(jsonMatch[1]);
      }
    }

    // ── Step 2: Get Yahoo Finance crumb ──
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const cookie = (cookieRes.headers.get('set-cookie') || '').split(';')[0];
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie }
    });
    const crumb = await crumbRes.text();

    // ── Step 3: Get US dividend history ──
    const now = Math.floor(Date.now() / 1000);
    const periods = { '1y': 365, '2y': 730, '5y': 1825 };
    const days = periods[range] || 730;
    const from = now - days * 86400;

    const divUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${usTicker}?period1=${from}&period2=${now}&interval=1d&events=div&crumb=${encodeURIComponent(crumb)}`;
    const divRes = await fetch(divUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });

    if (!divRes.ok) {
      return new Response(JSON.stringify({ error: 'Yahoo div fetch failed', drRatio }), { status: 502, headers: cors });
    }

    const divData = await divRes.json();
    const rawDivs = divData?.chart?.result?.[0]?.events?.dividends || {};

    // ── Step 4: Get USDTHB rates for each ex-date ──
    const usdthbUrl = `https://query1.finance.yahoo.com/v8/finance/chart/USDTHB=X?period1=${from}&period2=${now}&interval=1d&crumb=${encodeURIComponent(crumb)}`;
    const fxRes = await fetch(usdthbUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' }
    });
    const fxData = await fxRes.json();
    const fxTimestamps = fxData?.chart?.result?.[0]?.timestamp || [];
    const fxClose = fxData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];

    // Build FX lookup: date string → rate
    const fxByDate = {};
    fxTimestamps.forEach((ts, i) => {
      const d = new Date(ts * 1000).toISOString().split('T')[0];
      if (fxClose[i]) fxByDate[d] = fxClose[i];
    });

    // Get closest FX rate for a date
    function getFxRate(dateStr) {
      if (fxByDate[dateStr]) return fxByDate[dateStr];
      // Find nearest previous trading day
      const target = new Date(dateStr);
      for (let i = 1; i <= 5; i++) {
        const prev = new Date(target);
        prev.setDate(prev.getDate() - i);
        const prevStr = prev.toISOString().split('T')[0];
        if (fxByDate[prevStr]) return fxByDate[prevStr];
      }
      return null;
    }

    // ── Step 5: Build dividend list ──
    const dividends = Object.values(rawDivs).map(d => {
      const dateStr = new Date(d.date * 1000).toISOString().split('T')[0];
      const usdPerShare = d.amount;
      const fxRate = getFxRate(dateStr);
      const ratio = drRatio || 0.1; // fallback common DR ratio

      return {
        exDate: dateStr,
        usTicker,
        drTicker,
        usdPerShare,
        drRatio: ratio,
        usdThbRate: fxRate ? +fxRate.toFixed(4) : null,
        thbPerDr: fxRate ? +(usdPerShare * ratio * fxRate).toFixed(6) : null,
      };
    }).sort((a, b) => b.exDate.localeCompare(a.exDate));

    return new Response(JSON.stringify({
      drTicker,
      usTicker,
      drRatio,
      drRatioSource: drRatio ? 'set-profile' : 'fallback-0.1',
      dividends,
    }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, drTicker, usTicker }), { status: 500, headers: cors });
  }
}
