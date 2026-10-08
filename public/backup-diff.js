/* Local-only, read-only comparison. Never uploads, merges or mutates portfolio data. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TradeDeskBackupDiff=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const supplemental=['notes','dividends','watchlist','dcaHistory','currency','drConversions','_srAlerts'];
 const normalized=v=>Array.isArray(v)?v.map(normalized):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalized(v[k])])):v;
 const same=(a,b)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
 const printable=v=>{
   if(v===undefined)return '(ไม่มีค่า)';
   if(v===null)return 'null';
   const s=typeof v==='object'?JSON.stringify(v):String(v);
   return s.length>130?s.slice(0,130)+'…':s;
 };
 function compare(remote,local){
   if(!remote||!local||!Array.isArray(remote.portfolios)||!Array.isArray(local.portfolios)||
      !Array.isArray(remote.transactions)||!Array.isArray(local.transactions))throw Error('Invalid backup data');
   const changes=[];
   function add(group,name,field,github,browser,redact=false){
     changes.push({group,name,field,github:redact?'(ข้อมูลบน GitHub)':printable(github),
       browser:redact?'(ข้อมูลในเครื่อง)':printable(browser)});
   }
   function fields(group,name,r,l,excluded=[]){
     const keys=new Set([...Object.keys(r||{}),...Object.keys(l||{})]);
     for(const key of [...keys].sort()){
       if(excluded.includes(key))continue;
       if(!same(r?.[key],l?.[key]))add(group,name,key,r?.[key],l?.[key],group==='ข้อมูลเสริม');
     }
   }
   const lPorts=new Map(local.portfolios.map(p=>[String(p.id),p]));
   const rPorts=new Map(remote.portfolios.map(p=>[String(p.id),p]));
   for(const rp of remote.portfolios){
     const lp=lPorts.get(String(rp.id));
     if(!lp){add('พอร์ต',String(rp.name||rp.id),'สถานะ','อยู่บน GitHub','ไม่มีในเครื่อง');continue;}
     fields('พอร์ต',String(rp.name||rp.id),rp,lp,['stocks']);
     const key=s=>String(s.ticker||'').trim().toUpperCase()+'|'+String(s.id??'');
     const ls=new Map(lp.stocks.map(s=>[key(s),s]));
     const rs=new Map(rp.stocks.map(s=>[key(s),s]));
     for(const stock of rp.stocks){
       const name=String(rp.name||rp.id)+' / '+String(stock.ticker||'');
       const lstock=ls.get(key(stock));
       if(!lstock){add('หุ้น',name,'สถานะ','อยู่บน GitHub','ไม่มีหรือ ID ต่างกัน');continue;}
       // These market NAV fields can legitimately refresh independently.
       fields('หุ้น',name,stock,lstock,['currentNav','navDate']);
     }
     for(const stock of lp.stocks){
       if(!rs.has(key(stock)))add('หุ้น',String(lp.name||lp.id)+' / '+String(stock.ticker||''),'สถานะ','ไม่มีหรือ ID ต่างกัน','อยู่ในเครื่อง');
     }
   }
   for(const lp of local.portfolios)if(!rPorts.has(String(lp.id)))add('พอร์ต',String(lp.name||lp.id),'สถานะ','ไม่มีบน GitHub','อยู่ในเครื่อง');
   const id=t=>t.id==null?JSON.stringify(normalized(t)):String(t.id);
   const lTx=new Map(local.transactions.map(t=>[id(t),t]));
   const rTx=new Map(remote.transactions.map(t=>[id(t),t]));
   for(const tx of remote.transactions){
     const lt=lTx.get(id(tx));
     const name=String(tx.ticker||'')+' / '+String(tx.date||'')+' / '+String(id(tx));
     if(!lt){add('ธุรกรรม',name,'สถานะ','อยู่บน GitHub','ไม่มีในเครื่อง');continue;}
     fields('ธุรกรรม',name,tx,lt);
   }
   for(const tx of local.transactions)if(!rTx.has(id(tx)))add('ธุรกรรม',String(tx.ticker||'')+' / '+String(tx.date||''),'สถานะ','ไม่มีบน GitHub','อยู่ในเครื่อง');
   for(const field of supplemental)if(!same(remote[field],local[field]))
     add('ข้อมูลเสริม','Backup',field,remote[field],local[field],true);
   return {
     changes,counts:{
       remotePortfolios:remote.portfolios.length,localPortfolios:local.portfolios.length,
       remoteHoldings:remote.portfolios.reduce((n,p)=>n+(p.stocks?.length||0),0),
       localHoldings:local.portfolios.reduce((n,p)=>n+(p.stocks?.length||0),0),
       remoteTransactions:remote.transactions.length,localTransactions:local.transactions.length
     }
   };
 }
 return {compare};
});
