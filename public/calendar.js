import {eventDay,eventTime,moveDate} from './calendar-model.mjs';
import {normalizeHolding,validateEarnings,validateEconomic} from './calendar-earnings.mjs';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shift = (s,n) => {const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const today = () => eventDay({timePrecision:'datetime',timeUtc:new Date().toISOString()},zone);
const label = (d,options={day:'numeric',month:'short',year:'numeric'}) => new Intl.DateTimeFormat('th-TH',{timeZone:'UTC',...options}).format(new Date(d+'T12:00:00Z'));
let curatedEconomic=[];
let zone='Asia/Bangkok', view=matchMedia('(max-width: 600px)').matches?'agenda':'month', anchor=today(), selected=anchor, events=[], earnings=[], portfolioSymbols=null, available=false, fedAvailable=false, censusAvailable=false, requestId=0, loading=false, errors=[];
function visibleDays(){
  const base=view==='month'?anchor.slice(0,7)+'-01':anchor;
  const weekday=new Date(base+'T00:00:00Z').getUTCDay();
  const first=shift(base,-((weekday+6)%7));
  return Array.from({length:view==='month'?42:7},(_,i)=>shift(first,i));
}
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null}catch{return null}}
function explanation(title) {
  if (/consumer price index|cpi/i.test(title)) return 'วัดเงินเฟ้อผู้บริโภค ซึ่งอาจมีผลต่อมุมมองดอกเบี้ย';
  if (/employment situation|payroll/i.test(title)) return 'ติดตามการจ้างงานและอัตราว่างงานสหรัฐฯ';
  if (/fomc/i.test(title)) return 'วันสุดท้ายของการประชุม Fed; นโยบายดอกเบี้ยมีผลต่ออัตราผลตอบแทนและมูลค่าหุ้น โปรดตรวจเวลาและผลประชุมจาก Fed';
  if (/gross domestic product/i.test(title)) return 'GDP สะท้อนการเติบโตของเศรษฐกิจ และอาจส่งผลต่อมุมมองดอกเบี้ย';
  if (/personal income and outlays/i.test(title)) return 'รายงานรายได้และการใช้จ่ายส่วนบุคคล รวมตัววัดเงินเฟ้อ PCE ที่ Fed ติดตาม';
  return 'ตรวจรายละเอียดและความสำคัญจากหน่วยงานต้นทาง';
}
function eventMarkup(e){
  if(e.type==='earnings') {
    const session={before:'ก่อนตลาดสหรัฐฯ',after:'หลังตลาดสหรัฐฯ',during:'ระหว่างตลาดสหรัฐฯ',unknown:'ไม่ระบุช่วงเวลา'}[e.session];
    const status={confirmed:'บริษัทยืนยัน',reported:'ประกาศแล้ว',unconfirmed:'รอตรวจสอบ'}[e.status];
    const link=safeUrl(e.sourceUrl);
    return `<div class="event-title">${esc(e.ticker)} · ประกาศงบ ${esc(e.period||'')}</div><div class="meta">วันตลาดสหรัฐฯ · ${esc(session)} · ${esc(status)} · ตรวจ ${esc(e.verifiedAt)}</div><div class="meta">${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(e.source)} ↗</a>`:esc(e.source)}</div>`;
  }
  const time=eventTime(e,zone); const url=safeUrl(e.sourceUrl);
  const level={high:'สูง',medium:'ปานกลาง',low:'ต่ำ',unknown:'ไม่ระบุ'}[e.impact]||'ไม่ระบุ';
  return `<div class="event-title">${esc(e.title)}</div><div class="meta">${time?`${esc(time)} น. (${zone==='Asia/Bangkok'?'ICT':'ET'})`:'วันที่ต้นทาง · ไม่ระบุเวลา'} · ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(e.source||'ต้นทาง')} ↗</a>`:esc(e.source||'ไม่ระบุแหล่ง')}</div>${e.verifiedAt?`<div class="meta">${e.status==='tentative'?'กำหนดการเบื้องต้น · ':''}ตรวจ ${esc(e.verifiedAt)} · ข้อมูลรวบรวมด้วยมือ</div>`:''}<span class="badge ${e.impact==='high'?'high':''}">ความสำคัญ ${level}</span><div class="meta">ก่อน ${esc(e.previous??'—')} · คาด ${esc(e.forecast??'—')} · จริง ${esc(e.actual??'—')}</div><div class="meta">ทำไมจึงสำคัญ (คำอธิบายทั่วไป): ${esc(explanation(e.title))}</div>`;
}
function render(){
  const days=visibleDays(), impact=$('impact').value, search=$('search').value.trim().toLowerCase();
  $('range-label').textContent=view==='month'?label(anchor,{month:'long',year:'numeric'}):`${label(days[0],{day:'numeric',month:'short'})} – ${label(days[6])}`;
  $('calendar').setAttribute('aria-busy',String(loading));
  const providers=[available?'BEA':null,fedAvailable?'Fed':null,censusAvailable?'Census':null].filter(Boolean);
  $('source-status').textContent=loading?'กำลังโหลด…':providers.length?`${providers.join(' + ')} · บางส่วน`:'ไม่พร้อม / ไม่ครบ';
  $('warnings').textContent=errors.join(' · ');
  const dayEvents=d=>[...events.filter(e=>eventDay(e,zone)===d),...curatedEconomic.filter(e=>eventDay(e,zone)===d),...earnings.filter(e=>e.eventDate===d)];
  const filtered=d=>dayEvents(d).filter(e=>(impact==='all'||e.impact===impact)&&`${e.title||''} ${e.ticker||''}`.toLowerCase().includes(search));

  const empty='ไม่พบรายการที่ตรงตัวกรองจากข้อมูลที่มี — ยังอาจมีเหตุการณ์อื่น';
  if(view==='month'){
    $('calendar').innerHTML=`<div class="month-grid">${['จ','อ','พ','พฤ','ศ','ส','อา'].map(d=>`<div class="weekday">${d}</div>`).join('')}${days.map(d=>{const list=filtered(d);return `<button class="day-cell ${d===selected?'selected':''} ${d.slice(0,7)!==anchor.slice(0,7)?'muted':''}" data-day="${d}" aria-pressed="${d===selected}" aria-label="${esc(label(d))} · ${list.length} รายการที่ตรงตัวกรอง"><span class="date">${Number(d.slice(-2))}${d===today()?' · วันนี้':''}</span>${list.slice(0,2).map(e=>`<span class="event-preview">${esc(e.title)}</span>`).join('')}${list.length>2?`<span class="meta">+${list.length-2} รายการ</span>`:''}</button>`}).join('')}</div>`;
  } else {
    $('calendar').innerHTML=days.map(d=>{const list=filtered(d);return `<section class="list-day"><button class="day-select" data-day="${d}" aria-pressed="${d===selected}">${esc(label(d,{weekday:'long',day:'numeric',month:'short'}))}</button>${list.length?`<ul class="list-events">${list.map(e=>`<li>${eventMarkup(e)}</li>`).join('')}</ul>`:`<div class="empty">${empty}</div>`}</section>`}).join('');
  }
  const chosen=filtered(selected);
  $('detail').innerHTML=`<div class="detail-date">${esc(label(selected,{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}</div>${chosen.length?`<ul class="detail-events">${chosen.map(e=>`<li>${eventMarkup(e)}</li>`).join('')}</ul>`:`<p class="empty">${empty}</p>`}`;
}
async function load(){
  const id=++requestId; loading=true; available=false; events=[];errors=[];render();
  const days=visibleDays(), chunks=[{start:days[0],days:days.length}];
  try {
    const responses=await Promise.all(chunks.map(async c=>{try{const r=await fetch(`/api/calendar?start=${encodeURIComponent(c.start)}&days=${c.days}`,{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);const data=await r.json();if(!Array.isArray(data.events)||!data.sources?.economic)throw Error('invalid response');return {data}}catch(e){return {error:String(e.message)}}}));
    if(id!==requestId)return;
    const ok=responses.filter(x=>x.data), bad=responses.filter(x=>x.error || !x.data.sources.economic.available);
    const updated=ok[0]?.data.generatedAt;
    $('updated').textContent=updated && Number.isFinite(Date.parse(updated)) ? `ดึงข้อมูล ${new Intl.DateTimeFormat('th-TH',{timeZone:zone,dateStyle:'short',timeStyle:'short'}).format(new Date(updated))}` : 'ไม่ทราบเวลาอัปเดต';
    available=bad.length===0;
    fedAvailable=ok.length>0 && ok.every(x=>x.data.sources.fed?.available);
    censusAvailable=ok.length>0 && ok.every(x=>x.data.sources.census?.available);
    events=[...new Map(ok.flatMap(x=>x.data.events).filter(e=>e.type==='economic' && e.eventDate && (e.timePrecision==='date'||(e.timePrecision==='datetime'&&e.timeUtc&&Number.isFinite(Date.parse(e.timeUtc))))).map(e=>[e.id,e])).values()];
    if(bad.length)errors.push('โหลดข้อมูลบางช่วงไม่สำเร็จ — รายการอาจขาดหาย');
    if(ok.some(x=>x.data.sources.economic.error)) { available=false; errors.push('ข้อมูล BEA บางรายการอ่านไม่ได้ — ผลอาจไม่ครบ'); }
    if(ok.some(x=>!x.data.sources.fed?.available)) errors.push('โหลดตารางประชุม Fed ไม่สำเร็จ — วันประชุมอาจขาดหาย');
    if(ok.some(x=>!x.data.sources.census?.available)) errors.push('โหลดตาราง Census ไม่ครบ — ยอดค้าปลีก/ที่อยู่อาศัยอาจขาดหาย');
  } finally {if(id===requestId){loading=false;render()}}
}
async function loadEconomicExtra(){
 try{
  const r=await fetch('/market-economic-extra.json',{cache:'no-store'});if(!r.ok)throw Error('unavailable');
  const data=await r.json();if(!Array.isArray(data.events))throw Error('invalid');
  curatedEconomic=validateEconomic(data.events);
  $('economic-extra-status').textContent=`CPI / NFP: รวบรวมด้วยมือ ตรวจล่าสุด ${String(data.updatedAt||'ไม่ระบุ')} · กำหนดการอาจเปลี่ยน ไม่อัปเดตอัตโนมัติ`;
 }catch{curatedEconomic=[];$('economic-extra-status').textContent='โหลดตาราง CPI / NFP ที่รวบรวมไม่ได้ — ไม่ได้หมายความว่าไม่มีประกาศ';}
 render();
}
let watchRequestId=0;
async function loadWatchlist(){
 const id=++watchRequestId;
 try {
  const [p,c]=await Promise.all([fetch('/portfolio-data.json',{cache:'no-store'}),fetch('/portfolio-earnings-calendar.json',{cache:'no-store'})]);
  if(!p.ok||!c.ok) throw Error('data unavailable');
  const data=await p.json(), curated=await c.json();
  if(id!==watchRequestId)return;
  if(!Array.isArray(data.portfolios)||!Array.isArray(curated.events)) throw Error('invalid data');
  portfolioSymbols=new Set(data.portfolios.flatMap(p=>['realtime_dr','realtime_us'].includes(p.type)?(p.stocks||[]).map(normalizeHolding):[]).filter(Boolean));
  earnings=validateEarnings(curated.events).filter(e=>portfolioSymbols.has(e.ticker)).map(e=>({...e,type:'earnings',title:`${e.ticker} · งบ`}));
  const usToday=eventDay({timePrecision:'datetime',timeUtc:new Date().toISOString()},'America/New_York');
  const upcoming=earnings.filter(e=>e.eventDate>=usToday).sort((a,b)=>a.eventDate.localeCompare(b.eventDate));
  const covered=new Set(upcoming.filter(e=>e.status!=='unconfirmed').map(e=>e.ticker));
  const missing=(Array.isArray(curated.monitored)?curated.monitored:[]).filter(t=>portfolioSymbols.has(t)&&!covered.has(t));
  $('watchlist').textContent=(upcoming.length?`วันงบที่ตรวจพบ: ${upcoming.map(e=>`${e.ticker} ${e.eventDate} (${e.status==='unconfirmed'?'รอตรวจสอบ':'บริษัทยืนยัน'})`).join(' · ')}`:'ยังไม่พบวันงบที่ยืนยันในข้อมูลที่ตรวจ')+(missing.length?` | ยังไม่ยืนยัน: ${missing.join(', ')}`:'')+` · ฐานข้อมูลปรับล่าสุด ${curated.updatedAt||'ไม่ระบุ'} (ดูวันตรวจรายรายการ)`;
  $('earnings-status').textContent=`ตรวจพบ ${upcoming.length} รายการในพอร์ต · ไม่ครบทุกบริษัท`;
 }catch{if(id!==watchRequestId)return;portfolioSymbols=null;earnings=[];$('watchlist').textContent='โหลดข้อมูลพอร์ตหรือวันงบไม่ได้ — ไม่ได้หมายความว่าไม่มีงบ';$('earnings-status').textContent='โหลดข้อมูลวันงบไม่ได้';}
 render();
}
$('calendar').addEventListener('click',e=>{const b=e.target.closest('[data-day]');if(b){selected=b.dataset.day;render()}});
$('prev').addEventListener('click',()=>{anchor=moveDate(anchor,view,-1);selected=anchor;load()});
$('next').addEventListener('click',()=>{anchor=moveDate(anchor,view,1);selected=anchor;load()});
$('today').addEventListener('click',()=>{anchor=today();selected=anchor;load()});
$('refresh').addEventListener('click',()=>{loadWatchlist();loadEconomicExtra();load()});
$('zone').addEventListener('change',e=>{zone=e.target.value;load()});
$('impact').addEventListener('change',render);$('search').addEventListener('input',render);
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));load()}));
document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.view===view)));
loadWatchlist();loadEconomicExtra();load();
