const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../workers/trade-desk-watchlist-alert.js'),'utf8');
const worker=new Function(source.replace('export default {','return {'))();
test('worker mutation routes fail closed without configured secret',async()=>{
for(const path of ['/trigger','/watchlist','/oil-trigger']){
const r=await worker.fetch(new Request('https://test.invalid'+path),{},{});assert.equal(r.status,503);
}});
test('worker mutation routes reject wrong credentials',async()=>{
const r=await worker.fetch(new Request('https://test.invalid/trigger'),{ALERT_SECRET:'fixture'},{});assert.equal(r.status,401);
});
