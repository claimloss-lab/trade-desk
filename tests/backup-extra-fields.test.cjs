const {test}=require('node:test');const assert=require('node:assert/strict');const {findSnapshotLosses}=require('../public/backup-safety.js');
test('backup guard protects notes and other saved fields from stale overwrite',()=>{
 for(const field of ['notes','dividends','watchlist','dcaHistory','currency','drConversions','_srAlerts']){
 const base={portfolios:[],transactions:[]};const r={...base,[field]:['saved']};const l={...base,[field]:[]};
 const result=findSnapshotLosses(r,l);assert.equal(result.hasLoss,true,field);assert.ok(result.changedBackupFields.includes(field));
 }
});
