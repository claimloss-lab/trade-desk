// Trade Desk calendar: Nasdaq earnings, S&P membership, TradingView macro.
// Returned data is third-party, indicative, subject to change, and not investment advice.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', Accept: 'application/json,text/plain,*/*', Referer: 'https://www.nasdaq.com/' };
const SP_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
const TV_URL = 'https://economic-calendar.tradingview.com/events';
const NASDAQ = 'https://api.nasdaq.com/api/calendar/earnings';
const cleanSymbol = s => String(s || '').trim().toUpperCase().replace(/\./g, '-');
function dates(start, count) {
  const date = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(date.getTime() + i * 86400000).toISOString().slice(0, 10));
}
async function get(url, headers = HEADERS) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000), cf: { cacheTtl: 900, cacheEverything: true } });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return response;
}
export async function onRequestGet({ request }) {
  const input = new URL(request.url).searchParams;
  const start = input.get('start') || new Date().toISOString().slice(0, 10);
  const count = Number(input.get('days') || 7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(count) || count < 1 || count > 14 || Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || new Date(`${start}T00:00:00Z`).toISOString().slice(0,10) !== start) {
    return Response.json({ error: 'invalid date or days (1–14)' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const days = dates(start, count);
  const from = new Date(`${start}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${days.at(-1)}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 2);
  let constituents = null;
  let constituentError = null;
  try {
    const csv = await (await get(SP_URL)).text();
    if (!csv.startsWith('Symbol,')) throw new Error('unrecognized constituent CSV');
    const symbols = csv.split(/\r?\n/).slice(1).map(line => cleanSymbol(line.split(',')[0])).filter(Boolean);
    if (symbols.length < 450 || symbols.length > 550) throw new Error('unexpected constituent count');
    constituents = new Set(symbols);
  } catch (e) { constituentError = String(e.message || e); }
  const [earningsResults, macroResult] = await Promise.all([
    Promise.all(days.map(async day => {
      try {
        const url = `${NASDAQ}?date=${encodeURIComponent(day)}`;
        const data = await (await get(url)).json();
        if (!data.data || (!Array.isArray(data.data.rows) && data.data.rows !== null) || data.status?.rCode !== 200) throw new Error('unrecognized Nasdaq response');
        return { day, rows: (data.data.rows || []).map(row => ({ date: day, ticker: String(row.symbol || ''), name: String(row.name || ''), session: String(row.time || ''), epsForecast: row.epsForecast ?? null, estimates: row.noOfEsts ?? null, fiscalQuarter: row.fiscalQuarterEnding ?? null, marketCap: row.marketCap ?? null, inSP500: constituents ? constituents.has(cleanSymbol(row.symbol)) : null })), error: null };
      } catch (e) { return { day, rows: [], error: String(e.message || e) }; }
    })),
    (async () => {
      try {
        const url = new URL(TV_URL); url.searchParams.set('from', from.toISOString()); url.searchParams.set('to', to.toISOString()); url.searchParams.set('countries', 'US');
        const data = await (await get(url.toString(), { ...HEADERS, Referer: 'https://www.tradingview.com/', Origin: 'https://www.tradingview.com' })).json();
        if (!Array.isArray(data.result)) throw new Error('unrecognized economic response');
        return { rows: data.result.filter(row => row.country === 'US').map(row => ({ id: String(row.id || ''), title: String(row.title || ''), date: row.date || null, importance: Number(row.importance), actual: row.actual ?? null, forecast: row.forecast ?? null, previous: row.previous ?? null, unit: row.unit || '', source: row.source || '', sourceUrl: row.source_url || '' })), error: null };
      } catch (e) { return { rows: [], error: String(e.message || e) }; }
    })()
  ]);
  const response = { generatedAt: new Date().toISOString(), start, days: count, constituents: { count: constituents?.size ?? null, error: constituentError, source: SP_URL }, earnings: { rows: earningsResults.flatMap(x => x.rows).filter(x => x.inSP500 === true), failedDates: earningsResults.filter(x => x.error).map(x => ({ date: x.day, error: x.error })), available: !!constituents, source: 'https://www.nasdaq.com/market-activity/earnings' }, macro: { rows: macroResult.rows, error: macroResult.error, source: 'https://www.tradingview.com/economic-calendar/' } };
  return Response.json(response, { headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
