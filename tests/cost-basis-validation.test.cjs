const {test}=require('node:test');
const assert=require('node:assert/strict');
const {findSnapshotLosses}=require('../public/backup-safety.js');
test('explicit invalid cost basis fails closed',()=>{
 for(const buyPrice of [null,'',-1,'oops']) {
 const s={portfolios:[{id:'p',type:'realtime_dr',cash:0,stocks:[{id:7,ticker:'TST80',qty:10,buyPrice}]}],transactions:[]};
 assert.equal(findSnapshotLosses(s,s).invalidSnapshot,true,String(buyPrice));
 }
});
