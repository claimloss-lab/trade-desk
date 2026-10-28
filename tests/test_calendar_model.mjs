import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../public/calendar-model.mjs';
const {eventDay} = model;

test('datetime events cross midnight in Bangkok while date-only stays anchored', () => {
  assert.equal(eventDay({timePrecision:'datetime',timeUtc:'2026-03-08T20:00:00Z',eventDate:'2026-03-08'},'Asia/Bangkok'),'2026-03-09');
  assert.equal(eventDay({timePrecision:'date',timeUtc:null,eventDate:'2026-03-08'},'Asia/Bangkok'),'2026-03-08');
});

test('navigation clamps month end and handles leap days',()=>{
  assert.equal(model.moveDate('2024-01-31','month',1),'2024-02-29');
  assert.equal(model.moveDate('2026-01-31','month',1),'2026-02-28');
  assert.equal(model.moveDate('2026-12-28','week',1),'2027-01-04');
});

test('risk remains incomplete or unknown with partial and missing sources',()=>{
  assert.deepEqual(model.risk([{impact:'high'},{impact:'medium'},{impact:'unknown'}],true),{score:45,status:'incomplete'});
  assert.deepEqual(model.risk([{impact:'high'},{impact:'high'}],true),{score:55,status:'incomplete'});
  assert.deepEqual(model.risk([],true),{score:null,status:'unknown'});
  assert.deepEqual(model.risk([{impact:'high'}],false),{score:null,status:'unknown'});
});

test('New York observes spring DST in displayed time',()=>{
  assert.equal(model.eventTime({timePrecision:'datetime',timeUtc:'2026-03-08T06:30:00Z'},'America/New_York'),'01:30');
  assert.equal(model.eventTime({timePrecision:'datetime',timeUtc:'2026-03-08T07:30:00Z'},'America/New_York'),'03:30');
  assert.equal(model.eventTime({timePrecision:'date'},'America/New_York'),null);
});
