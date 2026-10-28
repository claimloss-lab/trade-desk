import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/calendar.js';
const original=globalThis.fetch; test.after(()=>globalThis.fetch=original);
test('merges BEA and official Fed meeting schedule without inventing times',async()=>{
 globalThis.fetch=async url=>String(url).includes('federalreserve.gov')?new Response('<h4>2026 FOMC Meetings</h4><div class="fomc-meeting__month">October</div><div class="fomc-meeting__date">27-28</div>'):Response.json({'Gross Domestic Product':{release_dates:['2026-10-28T12:30:00Z']}});
 const d=await(await onRequestGet({request:new Request('http://localhost/api/calendar?start=2026-10-28&days=1')})).json();
 assert.equal(d.sources.fed.available,true); assert.equal(d.events.length,2); const fed=d.events.find(e=>e.source==='Federal Reserve'); assert.equal(fed.eventDate,'2026-10-28'); assert.equal(fed.timeUtc,null);
});
test('Fed failure is exposed without blocking BEA',async()=>{
 globalThis.fetch=async url=>String(url).includes('federalreserve.gov')?new Response('',{status:503}):Response.json({'Gross Domestic Product':{release_dates:['2026-10-28T12:30:00Z']}});
 const d=await(await onRequestGet({request:new Request('http://localhost/api/calendar?start=2026-10-28&days=1')})).json();
 assert.equal(d.sources.fed.available,false); assert.equal(d.sources.economic.available,true); assert.equal(d.events.length,1);
});
