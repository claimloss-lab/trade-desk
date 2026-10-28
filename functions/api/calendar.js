// BEA's machine-readable release schedule. Exact times are returned as UTC;
// eventDate is the UTC date, not a timezone-local grouping key.
const BEA_URL = 'https://apps.bea.gov/API/signup/release_dates.json';
const DAY = 86400000;
const IMPACT = { 'Gross Domestic Product': 'high', 'Personal Income and Outlays': 'high' };

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function parseRelease(value) {
  if (validDate(value)) return { eventDate: value, timeUtc: null, timePrecision: 'date', millis: Date.parse(value + 'T00:00:00Z') };
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59 || (match[5] !== 'Z' && (+match[5].slice(1, 3) > 23 || +match[5].slice(4) > 59))) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  const timeUtc = new Date(millis).toISOString();
  return { eventDate: timeUtc.slice(0, 10), timeUtc, timePrecision: 'datetime', millis };
}

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const start = params.get('start') ?? new Date().toISOString().slice(0, 10);
  const rawDays = params.get('days') ?? '7';
  const days = Number(rawDays);
  if (!validDate(start) || !/^\d+$/.test(rawDays) || !Number.isInteger(days) || days < 1 || days > 42) {
    return Response.json({ error: 'invalid date or days (1–42)' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const startMs = Date.parse(start + 'T00:00:00Z');
  const body = { generatedAt: new Date().toISOString(), start, days, events: [], sources: { economic: { available: true, error: null, provider: 'BEA', coverage: 'partial' }, earnings: { available: false, error: 'No licensed earnings provider is configured.', provider: null } }, warnings: ['BEA coverage is partial. Exact-time events include UTC boundary padding; filter and group using the selected local timezone.'] };
  try {
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Do not cache the upstream separately: generatedAt must not hide its age.
        response = await fetch(BEA_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`BEA HTTP ${response.status}`);
        break;
      } catch (error) { if (attempt === 1) throw error; }
    }
    body.generatedAt = new Date().toISOString();
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('unrecognized BEA response');
    const groups = Object.entries(data).filter(([key]) => key !== 'file_last_updated');
    if (!groups.some(([title, group]) => title.trim() && group && typeof group === 'object' && Array.isArray(group.release_dates))) throw new Error('unrecognized BEA response');
    let invalid = 0;
    const seen = new Set();
    for (const [title, group] of groups) {
      if (!title.trim() || !group || typeof group !== 'object' || !Array.isArray(group.release_dates)) { invalid++; continue; }
      for (const value of group.release_dates) {
        const parsed = parseRelease(value);
        if (!parsed) { invalid++; continue; }
        const { eventDate, timeUtc, timePrecision, millis } = parsed;
        const padding = timeUtc ? DAY : 0;
        if (millis < startMs - padding || millis >= startMs + days * DAY + padding) continue;
        const id = `${title}:${timeUtc || eventDate}`;
        if (seen.has(id)) continue;
        seen.add(id);
        body.events.push({ id, type: 'economic', title, eventDate, timeUtc, timePrecision, impact: IMPACT[title] || 'unknown', source: 'BEA', sourceUrl: BEA_URL, previous: null, forecast: null, actual: null });
      }
    }
    body.events.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || (a.timeUtc || '').localeCompare(b.timeUtc || '') || a.title.localeCompare(b.title));
    if (invalid) {
      body.sources.economic.error = `${invalid} malformed BEA entries omitted`;
      body.warnings.push('Some BEA entries could not be parsed.');
    }
  } catch (error) {
    body.events = [];
    body.sources.economic.available = false;
    body.sources.economic.error = `BEA request failed: ${String(error.message || error)}`;
    body.warnings.push('Economic data unavailable.');
  }
  return Response.json(body, { headers: { 'Cache-Control': body.sources.economic.error ? 'no-store' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
