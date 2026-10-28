import test from 'node:test';import assert from 'node:assert/strict';import {validateEconomic} from '../public/calendar-earnings.mjs';
test('curated economic events require an attributable timestamp and valid date',()=>{
 let e={id:'cpi-2026-11-10',type:'economic',title:'Consumer Price Index',eventDate:'2026-11-10',timeUtc:'2026-11-10T13:30:00Z',timePrecision:'datetime',impact:'high',source:'Federal Reserve Bank of New York',sourceUrl:'https://www.newyorkfed.org/research/calendars/i-nov26.html',verifiedAt:'2026-10-29'};
 assert.equal(validateEconomic([e,e]).length,1);assert.equal(validateEconomic([{...e,timeUtc:'invalid'}]).length,0);assert.equal(validateEconomic([{...e,sourceUrl:'javascript:evil'}]).length,0);
});
