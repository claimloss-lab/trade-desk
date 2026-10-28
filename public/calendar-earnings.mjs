const dateValid = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function normalizeHolding(stock) {
 if (!stock || /etf|fund/i.test(String(stock.assetClass||stock.type||''))) return null;
 const value=String(stock.parentTicker||stock.underlying||'').trim().toUpperCase();
 if(value && /^[A-Z][A-Z.-]{0,9}$/.test(value)) return value;
 if(/^\d/.test(String(stock.ticker||'')) || /\d/.test(String(stock.ticker||''))) return null;
 const ticker=String(stock.ticker||'').trim().toUpperCase();
 return /^[A-Z][A-Z.-]{0,9}$/.test(ticker)?ticker:null;
}
export function validateEconomic(rows) {
 if(!Array.isArray(rows)) return [];
 const unique=new Map();
 for(const e of rows){
  if(!e || !e.id || e.type!=='economic' || !String(e.title||'').trim() || !dateValid(e.eventDate) || !dateValid(e.verifiedAt) || e.timePrecision!=='datetime' || !Number.isFinite(Date.parse(e.timeUtc)) || !['high','medium','low','unknown'].includes(e.impact)) continue;
  try{if(new URL(e.sourceUrl).protocol!=='https:')continue;}catch{continue;}
  if(!String(e.source||'').trim())continue;
  unique.set(e.id,e);
 }
 return [...unique.values()];
}
export function validateEarnings(rows) {
 if(!Array.isArray(rows)) return [];
 const unique=new Map();
 for(const e of rows){
  if(!e || !/^[A-Z][A-Z.-]{0,9}$/.test(e.ticker||'') || !dateValid(e.eventDate) || !dateValid(e.verifiedAt) || !['confirmed','unconfirmed','reported'].includes(e.status) || !String(e.source||'').trim() || !['before','after','during','unknown'].includes(e.session)) continue;
  try{if(new URL(e.sourceUrl).protocol!=='https:')continue;}catch{continue;}
  unique.set(`${e.ticker}:${e.eventDate}`,e);
 }
 return [...unique.values()];
}
