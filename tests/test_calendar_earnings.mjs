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
test('rejects unsourced, invalid, duplicate, fabricated, or invalid-status records',()=>{
 const e={ticker:'MSFT',eventDate:'2026-10-29',status:'confirmed',source:'Microsoft IR',sourceUrl:'https://microsoft.com/',verifiedAt:'2026-10-29',session:'after'};
 assert.equal(validateEarnings([e,e]).length,1);
 for(const bad of [{...e,sourceUrl:'javascript:alert(1)'},{...e,eventDate:'2026-02-30'},{...e,status:'bogus'},{...e,verifiedAt:null}])assert.equal(validateEarnings([bad]).length,0);
});
