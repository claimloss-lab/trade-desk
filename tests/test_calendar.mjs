import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/calendar.js';
const originalFetch = globalThis.fetch;
const csv = 'Symbol,Security\n' + Array.from({length:500}, (_,i)=>`${i===0?'MSFT':'T'+i},Company ${i}`).join('\n');
function mock({nasdaqFail='', macroFail=false, csvFail=false}={}) {
  globalThis.fetch = async url => {
    url=String(url);
    if (url.includes('constituents.csv')) return new Response(csvFail ? '' : csv,{status:csvFail?503:200});
    if (url.includes('tradingview.com')) return new Response(macroFail?'':JSON.stringify({result:[{id:1,title:'CPI',country:'US',date:'2026-10-28T12:30:00.000Z',importance:1,forecast:2.3,previous:2.2,unit:'%'}]}),{status:macroFail?503:200});
    if (url.includes('nasdaq.com')) {
      const day=new URL(url).searchParams.get('date');
      if(day===nasdaqFail)return new Response('',{status:503});
      const rows=day==='2026-10-31'?null:[{symbol:'MSFT',name:'Microsoft',time:'time-after-hours',epsForecast:'$4.71'},{symbol:'NOTSP',name:'Not in index'}];
      return Response.json({data:{rows},status:{rCode:200}});
    }
    throw Error('unexpected URL '+url);
  };
}
const call=(query)=>onRequestGet({request:new Request('http://localhost/api/calendar?'+query)});
test.after(()=>{globalThis.fetch=originalFetch});
test('rejects impossible dates and oversized windows', async()=>{for(const q of ['start=2026-02-30&days=7','start=2026-10-28&days=15','start=invalid&days=7'])assert.equal((await call(q)).status,400)});
test('filters to current members, accepts Nasdaq null rows, and returns macro', async()=>{mock();const res=await call('start=2026-10-30&days=2');const d=await res.json();assert.equal(res.status,200);assert.equal(d.constituents.count,500);assert.equal(d.earnings.failedDates.length,0);assert.deepEqual(d.earnings.rows.map(x=>x.ticker),['MSFT']);assert.equal(d.macro.rows[0].title,'CPI')});
test('reports partial Nasdaq failure without implying full coverage', async()=>{mock({nasdaqFail:'2026-10-30'});const d=await(await call('start=2026-10-30&days=2')).json();assert.equal(d.earnings.failedDates[0].date,'2026-10-30');assert.equal(d.earnings.available,true)});
test('fails closed when S&P membership is unavailable',async()=>{mock({csvFail:true});const d=await(await call('start=2026-10-30&days=1')).json();assert.equal(d.earnings.available,false);assert.equal(d.earnings.rows.length,0);assert.ok(d.constituents.error)});
test('exposes macro failure, not an empty-success signal',async()=>{mock({macroFail:true});const d=await(await call('start=2026-10-30&days=1')).json();assert.equal(d.macro.rows.length,0);assert.ok(d.macro.error)});
