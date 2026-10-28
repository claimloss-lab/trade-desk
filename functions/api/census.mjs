const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const strip=s=>s.replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
export const censusUrl=year=>`https://www.census.gov/economic-indicators/calendar-listview-${year}.html`;
export function parseCensus(html,year){
 const out=[], seen=new Set();let recognized=0;
 for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>strip(m[1]));
  if(cells.length<4)continue;
  const [title,display,,period]=cells;
  if(!/Advance Monthly Sales for Retail and Food Services|New Residential Construction|Advance Report on Durable Goods/i.test(title)) continue;
  recognized++;
  if(/suspended|cancelled|canceled|postponed|tbd/i.test(display))continue;
  const match=display.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if(!match)throw Error('unrecognized Census release date');
  const month=months.indexOf(match[1]);if(month<0||+match[3]!==year)throw Error('invalid Census release year or month');
  const date=`${match[3]}-${String(month+1).padStart(2,'0')}-${match[2].padStart(2,'0')}`;
  const d=new Date(date+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw Error('invalid Census date');
  const id=`census:${title}:${date}:${period}`;if(seen.has(id))continue;seen.add(id);
  out.push({id,type:'economic',title,eventDate:date,timeUtc:null,timePrecision:'date',impact:'unknown',source:'US Census Bureau',sourceUrl:censusUrl(year),previous:null,forecast:null,actual:null,period});
 }
 if(!recognized)throw Error('unrecognized Census calendar');
 return out;
}
