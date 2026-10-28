const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('offers a clearly external TradingView earnings reference',()=>{
 const html=fs.readFileSync('public/calendar.html','utf8');
 assert.match(html,/https:\/\/www\.tradingview\.com\/markets\/stocks-usa\/earnings\//);
 assert.match(html,/TradingView[^<]*เปิดดู/);
 assert.match(html,/ไม่ได้ดึงวันงบจาก TradingView อัตโนมัติ/);
});
test('incomplete data does not display numeric risk scores',()=>{
  const html=fs.readFileSync('public/calendar.html','utf8');
  const js=fs.readFileSync('public/calendar.js','utf8');
  assert(!html.includes('คะแนนความเสี่ยง'));
  assert(!js.includes('คะแนนจากข้อมูลบางส่วน'));
  assert(!js.includes('คะแนน ${'));
  assert(html.includes('ข้อมูลยังไม่ครบ'));
});
