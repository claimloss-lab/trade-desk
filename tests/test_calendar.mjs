import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/calendar.js';
const originalFetch = globalThis.fetch;
const call = q => onRequestGet({request: new Request('http://localhost/api/calendar?' + q)});
test.after(() => { globalThis.fetch = originalFetch; });

test('normalizes official BEA releases and explicitly marks earnings unavailable', async () => {
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://apps.bea.gov/API/signup/release_dates.json');
    return Response.json({'Gross Domestic Product': {release_dates:['2026-10-29T12:30:00+00:00']}});
  };
  const res = await call('start=2026-10-29&days=1');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.sources.economic.provider, 'BEA');
  assert.equal(data.sources.economic.coverage, 'partial');
  assert.equal(data.sources.earnings.available, false);
  assert.equal(data.sources.earnings.provider, null);
  assert.ok(data.sources.earnings.error);
  assert.equal(data.events.length, 1);
  assert.deepEqual({...data.events[0], id:'id'}, {id:'id', type:'economic', title:'Gross Domestic Product', eventDate:'2026-10-29', timeUtc:'2026-10-29T12:30:00.000Z', timePrecision:'datetime', impact:'high', source:'BEA', sourceUrl:'https://apps.bea.gov/API/signup/release_dates.json', previous:null, forecast:null, actual:null});
});

test('validates dates and 1–42 day range before fetching', async () => {
  globalThis.fetch = async () => { throw Error('unexpected fetch'); };
  for (const q of ['start=2026-02-30','start=invalid','days=0','days=43','days=1.5','days=','start=']) assert.equal((await call(q)).status,400,q);
});

test('handles metadata, offsets, date-only releases, duplicates and unknown titles', async () => {
 globalThis.fetch = async () => Response.json({file_last_updated:'2026-01-01', 'Other Release': {release_dates:['2026-10-28T23:30:00-02:00','2026-10-29T01:30:00Z','2026-10-30','2026-11-01T00:00:00Z']}});
 const d=await (await call('start=2026-10-29&days=2')).json();
 assert.equal(d.events.length,2);
 assert.deepEqual(d.events.map(x=>[x.eventDate,x.timeUtc,x.timePrecision,x.impact]),[['2026-10-29','2026-10-29T01:30:00.000Z','datetime','unknown'],['2026-10-30',null,'date','unknown']]);
});

test('retries transient failures and exposes failure without inventing events', async () => {
 let calls=0; globalThis.fetch=async url=>{if(String(url).includes('bea.gov')) calls++; return new Response('',{status:503})};
 const res=await call('start=2026-01-01&days=42'); const d=await res.json();
 assert.equal(calls,2); assert.equal(res.status,200); assert.equal(d.sources.economic.available,false); assert.ok(d.sources.economic.error); assert.deepEqual(d.events,[]); assert.ok(d.warnings.length); assert.match(res.headers.get('cache-control'),/no-store/);
});

test('pads exact-time UTC boundaries for Bangkok and New York local grouping', async()=>{
 globalThis.fetch=async()=>Response.json({'Release':{release_dates:['2026-10-28T18:00:00Z','2026-10-29T04:00:00Z','2026-10-30T03:00:00Z','2026-10-30T23:00:00Z','2026-10-28']}});
 const d=await(await call('start=2026-10-29&days=1')).json();
 assert.deepEqual(d.events.map(e=>e.timeUtc),['2026-10-28T18:00:00.000Z','2026-10-29T04:00:00.000Z','2026-10-30T03:00:00.000Z','2026-10-30T23:00:00.000Z']);
});

test('rejects unrecognized response and reports malformed rows as partial', async()=>{
 globalThis.fetch=async()=>Response.json({unexpected:'wrong'});
 let d=await(await call('start=2026-10-29')).json(); assert.equal(d.sources.economic.available,false); assert.ok(d.sources.economic.error);
 globalThis.fetch=async()=>Response.json({'Good':{release_dates:['2026-10-29T12:00:00Z','2026-02-30','2026-10-29T08:00:00','not-a-date']}, 'Bad':{release_dates:'oops'}});
 d=await(await call('start=2026-10-29')).json(); assert.equal(d.sources.economic.available,true); assert.ok(d.sources.economic.error); assert.equal(d.events.length,1); assert.ok(d.warnings.length);
});
