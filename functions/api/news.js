export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ticker = url.searchParams.get('ticker');
  const company = url.searchParams.get('company') || '';

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (!ticker) return new Response(JSON.stringify({ error: 'missing ticker' }), { status: 400, headers: cors });

  const sym = ticker.toUpperCase();
  const searchQuery = company ? `${sym} ${company}` : sym;

  // Define news sources - aggregate Yahoo + Reuters + Bloomberg + Investing.com via Google News
  const sources = [
    {
      name: 'Yahoo Finance',
      url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`,
    },
    {
      name: 'Reuters',
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}+when:7d+site:reuters.com&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: 'Bloomberg',
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}+when:7d+site:bloomberg.com&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: 'Investing.com',
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}+when:7d+site:investing.com&hl=en-US&gl=US&ceid=US:en`,
    },
  ];

  function parseRssItems(xml, sourceName, maxItems = 3) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
      const item = match[1];
      const title       = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(item) || /<title>(.*?)<\/title>/.exec(item))?.[1] || '';
      const description = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(item) || /<description>(.*?)<\/description>/.exec(item))?.[1] || '';
      const pubDate     = (/<pubDate>(.*?)<\/pubDate>/.exec(item))?.[1] || '';
      const link        = (/<link>(.*?)<\/link>/.exec(item))?.[1] || '';
      if (title) {
        items.push({
          title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
          description: description.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').slice(0, 200),
          pubDate,
          link,
          source: sourceName,
        });
      }
    }
    return items;
  }

  // Fetch all sources in parallel
  const fetchPromises = sources.map(async (src) => {
    try {
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml' },
        cf: { cacheTtl: 1800 }
      });
      if (!res.ok) return [];
      const xml = await res.text();
      return parseRssItems(xml, src.name, 3);
    } catch (e) {
      return [];
    }
  });

  try {
    const results = await Promise.all(fetchPromises);
    const allItems = results.flat();

    // Sort all items by date (newest first)
    allItems.sort((a, b) => {
      try { return new Date(b.pubDate) - new Date(a.pubDate); } catch { return 0; }
    });

    // Deduplicate by title prefix (50 chars)
    const seenTitles = new Set();
    const unique = [];
    for (const item of allItems) {
      const key = item.title.toLowerCase().slice(0, 50);
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        unique.push(item);
      }
    }

    // Limit to top 8 items
    const items = unique.slice(0, 8);

    return new Response(JSON.stringify({
      ticker: sym,
      items,
      count: items.length,
      sources: sources.map(s => s.name),
    }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ticker: sym }), { status: 500, headers: cors });
  }
}
