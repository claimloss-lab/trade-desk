export function eventDay(event, zone) {
  if (event.timePrecision === 'date') return event.eventDate;
  const d = new Date(event.timeUtc);
  if (!event.timeUtc || !Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const get = key => parts.find(p=>p.type===key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function risk(events, available) {
  if (!available || !events.length) return {score:null,status:'unknown'};
  const major = events.filter(e => e.type !== 'earnings' && e.impact === 'high').length;
  return major ? {score:45+(major>1?10:0),status:'incomplete'} : {score:null,status:'unknown'};
}

export function moveDate(day, view, amount) {
  const d = new Date(`${day}T00:00:00Z`);
  if (view === 'month') {
    const n = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+amount);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate();
    d.setUTCDate(Math.min(n,last));
  } else d.setUTCDate(d.getUTCDate()+7*amount);
  return d.toISOString().slice(0,10);
}

export function eventTime(event, zone) {
  if (event.timePrecision !== "datetime" || !event.timeUtc || !Number.isFinite(Date.parse(event.timeUtc))) return null;
  return new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour: "2-digit",minute: "2-digit",hourCycle: "h23"}).format(new Date(event.timeUtc));
}
