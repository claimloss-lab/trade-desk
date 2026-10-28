import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFomc} from '../functions/api/fomc.mjs';
const sample=`<h4><a>2026 FOMC Meetings</a></h4><div class="row fomc-meeting"><div class="fomc-meeting__month">October</div><div class="fomc-meeting__date">27-28*</div></div><div class="row fomc-meeting"><div class="fomc-meeting__month">Dec/Jan</div><div class="fomc-meeting__date">31-1</div></div><h4><a>2027 FOMC Meetings</a></h4><div class="row fomc-meeting"><div class="fomc-meeting__month">January</div><div class="fomc-meeting__date">26-27</div></div>`;
test('normalizes Fed meeting end dates as date-only without inventing time',()=>{
 const items=parseFomc(sample);
 assert.deepEqual(items.map(x=>x.eventDate),['2026-10-28','2027-01-01','2027-01-27']);
 assert(items.every(x=>x.timePrecision==='date' && x.timeUtc===null && x.source==='Federal Reserve'));
});
test('unrecognized feed fails closed',()=>{assert.throws(()=>parseFomc('<html>unavailable</html>'));});
