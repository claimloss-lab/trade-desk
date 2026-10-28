import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCensus} from '../functions/api/census.mjs';
const sample=`<table><tr><td><a href='/retail'>Advance Monthly Sales for Retail and Food Services</a></td><td sorttable_customkey='202611170830'>November 17, 2026</td><td>8:30 AM</td><td>October 2026</td></tr><tr><td>New Residential Construction (Building Permits, Housing Starts, and Housing Completions)</td><td sorttable_customkey='20261118'>Suspended</td><td>8:30 AM</td><td>October 2026</td></tr><tr><td>Other</td><td>November 19, 2026</td><td>8:30 AM</td><td>October 2026</td></tr></table>`;
test('uses displayed Census dates, never hidden suspended date or invented timezone',()=>{
 const rows=parseCensus(sample,2026);assert.equal(rows.length,1);assert.equal(rows[0].eventDate,'2026-11-17');assert.equal(rows[0].timeUtc,null);assert.equal(rows[0].timePrecision,'date');assert.equal(rows[0].source,'US Census Bureau');
});
test('preserves different reference periods released on the same date',()=>{
 const html=`<tr><td>Advance Monthly Sales for Retail and Food Services</td><td>November 17, 2026</td><td>8:30 AM</td><td>October 2026</td></tr><tr><td>Advance Monthly Sales for Retail and Food Services</td><td>November 17, 2026</td><td>8:30 AM</td><td>September 2026</td></tr>`;
 assert.equal(parseCensus(html,2026).length,2);
});
test('rejects missing unexpected calendar layout instead of a false empty calendar',()=>{assert.throws(()=>parseCensus('<html>denied</html>',2026));});
