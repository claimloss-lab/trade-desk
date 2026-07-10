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

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
    'Referer': 'https://www.set.or.th/',
    'Origin': 'https://www.set.or.th',
  };

  try {
    // Try SET API first
    const apiUrl = `https://www.set.or.th/api/set/stock/${encodeURIComponent(ticker)}/rights-benefits?lang=th`;
    const res = await fetch(apiUrl, { headers, cf: { cacheTtl: 3600 } });

    if (res.ok) {
      const data = await res.json();
      // FIX: guard ด้วย Array.isArray — เดิมถ้า SET คืน object ที่ไม่มี
      // dividends/items จะเรียก .filter บน object → crash 500
      const rawList = Array.isArray(data?.dividends) ? data.dividends
                    : Array.isArray(data?.items)     ? data.items
                    : Array.isArray(data)            ? data
                    : [];
      const dividends = rawList
        .filter(d => d.type === 'CD' || d.caType === 'CD' || d.actionType === 'CD')
        .slice(0, 20)
        .map(d => ({
          xdDate: d.xdDate || d.exDate || d.date,
          payDate: d.payDate || d.paymentDate,
          dividend: d.dividend || d.amount || d.cashAmount,
          unit: 'THB',
          type: 'Cash Dividend',
        }));
      return new Response(JSON.stringify({ ticker, source: 'set-api', dividends }), { headers: cors });
    }

    // Fallback: scrape HTML page
    const htmlUrl = `https://www.set.or.th/th/market/product/stock/quote/${encodeURIComponent(ticker)}/rights-benefits`;
    const htmlRes = await fetch(htmlUrl, { headers, cf: { cacheTtl: 3600 } });
    if (!htmlRes.ok) {
      return new Response(JSON.stringify({ error: 'SET fetch failed', status: htmlRes.status }), { status: 502, headers: cors });
    }

    const html = await htmlRes.text();

    // Parse dividend table from HTML
    const dividends = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [];
      let cellMatch;
      const cellEx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((cellMatch = cellEx.exec(rowHtml)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      // Look for rows with dividend data (XD date pattern)
      if (cells.length >= 3 && /\d{2}\/\d{2}\/\d{4}/.test(cells[0]) && /\d/.test(cells[1])) {
        const [xdDate, dividend, payDate] = cells;
        dividends.push({
          xdDate: xdDate?.trim(),
          dividend: parseFloat(dividend?.replace(/[^0-9.]/g, '')) || null,
          payDate: payDate?.trim(),
          unit: 'THB',
          type: 'Cash Dividend',
        });
      }
    }

    // Also check for structured data or JSON in script tags
    const jsonMatch = html.match(/"dividends"\s*:\s*(\[[\s\S]*?\])/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return new Response(JSON.stringify({ ticker, source: 'set-html-json', dividends: parsed }), { headers: cors });
      } catch {}
    }

    return new Response(JSON.stringify({
      ticker,
      source: 'set-html',
      dividends: dividends.slice(0, 20),
      rawLength: html.length
    }), { headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ticker }), { status: 500, headers: cors });
  }
}
