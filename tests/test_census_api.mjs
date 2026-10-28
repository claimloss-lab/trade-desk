import test from 'node:test';import assert from 'node:assert/strict';import {onRequestGet} from '../functions/api/calendar.js';
const original=globalThis.fetch;test.after(()=>globalThis.fetch=original);
test('Census releases are integrated with date-only semantics',async()=>{
 globalThis.fetch=async u=>String(u).includes('census.gov')?new Response(`<table><tr><td>Advance Monthly Sales for Retail and Food Services</td><td>November 17, 2026</td><td>8:30 AM</td><td>October 2026</td></tr></table>`):String(u).includes('bea.gov')?Response.json({'GDP':{release_dates:[]}}):new Response('<h4>2026 FOMC Meetings</h4><div class="fomc-meeting__month">October</div><div class="fomc-meeting__date">27-28</div>');
 const d=await(await onRequestGet({request:new Request('http://localhost/api/calendar?start=2026-11-17&days=1')})).json();
 assert.equal(d.sources.census.available,true);const row=d.events.find(e=>e.source==='US Census Bureau');assert.equal(row.eventDate,'2026-11-17');assert.equal(row.timeUtc,null);
});
