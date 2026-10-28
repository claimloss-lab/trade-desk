import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHolding,validateEarnings} from '../public/calendar-earnings.mjs';
test('uses verified parent or underlying instead of DR symbol; excludes funds',()=>{
 assert.equal(normalizeHolding({ticker:'MRVL80',underlying:'MRVL'}),'MRVL');
 assert.equal(normalizeHolding({ticker:'META80',underlying:'Meta'}),'META');
 assert.equal(normalizeHolding({ticker:'GOOG80',parentTicker:'GOOGL'}),'GOOGL');
 assert.equal(normalizeHolding({ticker:'QQQM19',parentTicker:'QQQM',assetClass:'ETF'}),null);
 assert.equal(normalizeHolding({ticker:'ZZZ80'}),null);
});
test('accepts user-supplied image as unconfirmed without inventing a URL, not confirmed',()=>{
 const e={ticker:'MSFT',eventDate:'2026-10-28',status:'unconfirmed',source:'ภาพที่ผู้ใช้ส่ง · Wall Street Horizon',sourceKind:'user-image',verifiedAt:'2026-10-07',session:'unknown'};
 assert.equal(validateEarnings([e]).length,1);
 assert.equal(validateEarnings([{...e,status:'confirmed'}]).length,0);
 assert.equal(validateEarnings([{...e,sourceKind:'other'}]).length,0);
});
test('watchlist distinguishes unconfirmed image entries from confirmed ones',async()=>{
 const fs=await import('node:fs');const s=fs.readFileSync(new URL('../public/calendar.js',import.meta.url),'utf8');
 assert.match(s,/e\.status==='unconfirmed'\?'รอตรวจสอบ'/);
 assert.match(s,/filter\(e=>e\.status!=='unconfirmed'\)/);
});
test('rejects unsourced, invalid, duplicate, fabricated, or invalid-status records',()=>{
 const e={ticker:'MSFT',eventDate:'2026-10-29',status:'confirmed',source:'Microsoft IR',sourceUrl:'https://microsoft.com/',verifiedAt:'2026-10-29',session:'after'};
 assert.equal(validateEarnings([e,e]).length,1);
 for(const bad of [{...e,sourceUrl:'javascript:alert(1)'},{...e,eventDate:'2026-02-30'},{...e,status:'bogus'},{...e,verifiedAt:null}])assert.equal(validateEarnings([bad]).length,0);
});
