export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker');
  
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  try {
    // Yahoo Finance RSS feed
    const sym = ticker.toUpperCase();
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`;
    
    const res = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml' },
      cf: { cacheTtl: 1800 }
    });

    if (!res.ok) return new Response(JSON.stringify({ error: 'RSS fetch failed', ticker: sym }), { status: 502, headers: cors });

    const xml = await res.text();
    
    // Parse RSS items
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
      const item = match[1];
      const title       = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(item) || /<title>(.*?)<\/title>/.exec(item))?.[1] || '';
      const description = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(item) || /<description>(.*?)<\/description>/.exec(item))?.[1] || '';
      const pubDate     = (/<pubDate>(.*?)<\/pubDate>/.exec(item))?.[1] || '';
      const link        = (/<link>(.*?)<\/link>/.exec(item))?.[1] || '';
      if (title) items.push({ title, description: description.replace(/<[^>]+>/g, '').slice(0, 200), pubDate, link });
    }

    return new Response(JSON.stringify({ ticker: sym, items, count: items.length }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ticker }), { status: 500, headers: cors });
  }
}
