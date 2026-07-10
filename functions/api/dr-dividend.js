export async function onRequest(context) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(context.request.url);
  const drTicker = url.searchParams.get('dr')?.toUpperCase();
  const usTicker = url.searchParams.get('us')?.toUpperCase();
  const range    = url.searchParams.get('range') || '2y';
  // Optional override: ratio = จำนวน DR ต่อ 1 หุ้นอ้างอิง (รูปแบบเดียวกับ drConversions
  // เช่น CRWD06 → 1250) ถ้าส่งมาจะไม่ต้อง scrape หน้า SET เลย — แม่นยำกว่า
  const ratioParam = parseFloat(url.searchParams.get('ratio') || '');

  if (!drTicker || !usTicker) {
    return new Response(JSON.stringify({ error: 'missing dr or us param' }), { status: 400, headers: cors });
  }

  try {
    // ── Step 1: DR ratio (shares of underlying per 1 DR) ──
    let drRatio = null;
    let ratioSource = null;

    if (isFinite(ratioParam) && ratioParam > 0) {
      drRatio = 1 / ratioParam;
      ratioSource = 'param';
    }

    if (!drRatio) {
      const setHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
        'Referer': 'https://www.set.or.th/',
      };

      try {
        const profileUrl = `https://www.set.or.th/th/market/product/dr/quote/${drTicker}/company-profile`;
        const profileRes = await fetch(profileUrl, { headers: setHeaders, cf: { cacheTtl: 86400 } });
        if (profileRes.ok) {
          const html = await profileRes.text();
          // FIX: patterns now accept comma-grouped numbers ("5,000 DR : 1") —
          // previously "\d+" matched only "000" → drRatio = 1/0 = Infinity
          const num = (s) => parseFloat(String(s).replace(/,/g, ''));
          const patterns = [
            /([\d,]+(?:\.\d+)?)\s*DR\s*:\s*([\d,]+(?:\.\d+)?)\s*(?:Underlying|หุ้นอ้างอิง)/i,
            /อัตราแปลงสภาพ[^:]*:\s*([\d,]+(?:\.\d+)?)\s*:\s*([\d,]+(?:\.\d+)?)/i,
            /"conversionRatio":\s*"?([\d,]+(?:\.\d+)?)/i,
            /"ratio":\s*"?([\d,]+(?:\.\d+)?)/i,
          ];
          for (const p of patterns) {
            const m = html.match(p);
            if (!m) continue;
            const a = num(m[1]);
            const b = m[2] != null ? num(m[2]) : null;
            const candidate = (b != null) ? (a > 0 ? b / a : null) : (a > 0 ? 1 / a : null);
            if (candidate != null && isFinite(candidate) && candidate > 0) {
              drRatio = candidate;
              ratioSource = 'set-profile';
              break;
            }
          }
        }
      } catch (e) {}
    }

    // Default ratio if SET unreachable (common DR ratio 10 DR : 1)
    if (!drRatio) { drRatio = 0.1; ratioSource = 'default'; }

    // ── Step 2: Yahoo Finance crumb ──
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const cookie = (cookieRes.headers.get('set-cookie') || '').split(';')[0];
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie }
    });
    const crumb = await crumbRes.text();

    const yHeaders = { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie, 'Accept': 'application/json' };
    const now = Math.floor(Date.now() / 1000);
    const periods = { '1y': 365, '2y': 730, '5y': 1825 };
    const from = now - (periods[range] || 730) * 86400;

    // ── Step 3: Get US dividends with ex-date AND pay-date ──
    const modules = 'calendarEvents,summaryDetail';
    const [summaryRes, chartRes] = await Promise.all([
      fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(usTicker)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`,
        { headers: yHeaders }
      ),
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(usTicker)}?period1=${from}&period2=${now}&interval=1d&events=div&crumb=${encodeURIComponent(crumb)}`,
        { headers: yHeaders }
      ),
    ]);

    if (!chartRes.ok) {
      return new Response(JSON.stringify({ error: 'Yahoo chart failed', status: chartRes.status }), { status: 502, headers: cors });
    }

    const chartData = await chartRes.json();
    const rawDivs = chartData?.chart?.result?.[0]?.events?.dividends || {};

    // Get pay dates from quoteSummary if available
    let payDateMap = {};
    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      const cal = summaryData?.quoteSummary?.result?.[0]?.calendarEvents;
      if (cal?.dividendDate?.raw) {
        const payDateStr = new Date(cal.dividendDate.raw * 1000).toISOString().split('T')[0];
        const exDateStr = cal.exDividendDate?.fmt || null;
        if (exDateStr) payDateMap[exDateStr] = payDateStr;
      }
    }

    // ── Step 4: USDTHB history ──
    const fxByDate = {};
    try {
      const fxRes = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/USDTHB=X?period1=${from}&period2=${now}&interval=1d&crumb=${encodeURIComponent(crumb)}`,
        { headers: yHeaders }
      );
      if (fxRes.ok) {
        const fxData = await fxRes.json();
        const fxTs = fxData?.chart?.result?.[0]?.timestamp || [];
        const fxClose = fxData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        fxTs.forEach((ts, i) => {
          if (fxClose[i]) fxByDate[new Date(ts * 1000).toISOString().split('T')[0]] = fxClose[i];
        });
      }
    } catch (e) {}

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

    // ── Step 5: Build dividend list ──
    const dividends = Object.values(rawDivs).map(d => {
      const exDate = new Date(d.date * 1000).toISOString().split('T')[0];
      const usdPerShare = d.amount;
      const fxRate = getFx(exDate);
      const thbPerDr = fxRate ? +(usdPerShare * drRatio * fxRate).toFixed(6) : null;

      // Estimate pay date: typically ~1 month after ex-date
      const payDateFromMap = payDateMap[exDate];
      let payDate = payDateFromMap || null;
      if (!payDate) {
        const pd = new Date(d.date * 1000);
        pd.setDate(pd.getDate() + 28);
        payDate = pd.toISOString().split('T')[0] + ' (est.)';
      }

      return {
        exDate,
        payDate,
        usTicker,
        drTicker,
        usdPerShare,
        drRatio,
        usdThbRate: fxRate ? +fxRate.toFixed(4) : null,
        thbPerDr,
      };
    }).sort((a, b) => b.exDate.localeCompare(a.exDate));

    return new Response(JSON.stringify({ drTicker, usTicker, drRatio, ratioSource, dividends }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
