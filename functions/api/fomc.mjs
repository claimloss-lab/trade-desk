export const FOMC_URL='https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const names=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const text=s=>s.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
export function parseFomc(html) {
  if(typeof html!=='string') throw Error('invalid Fed schedule');
  const sections=[...html.matchAll(/\b(20\d{2})\s+FOMC\s+Meetings\b/gi)];
  const events=[]; let malformed=0;
  for(let i=0;i<sections.length;i++) {
    const year=Number(sections[i][1]);
    const section=html.slice(sections[i].index,sections[i+1]?.index ?? html.length);
    const rows=[...section.matchAll(/<div\b[^>]*class=["'][^"']*fomc-meeting__month\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["'][^"']*fomc-meeting__date\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
    for(const row of rows) {
      const months=text(row[1]).split('/').map(x=>names.indexOf(x.trim().toLowerCase().slice(0,3)));
      const d=text(row[2]).match(/^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/);
      if(months.some(x=>x<0)||!d){malformed++;continue;}
      const first=months[0], month=months.at(-1), endYear=year+(month<first?1:0), day=Number(d[2]||d[1]);
      const iso=`${endYear}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const date=new Date(iso+'T00:00:00Z');
      if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==iso){malformed++;continue;}
      events.push({id:`fed-fomc-${iso}`,type:'economic',title:'FOMC meeting — last day',eventDate:iso,timeUtc:null,timePrecision:'date',impact:'high',source:'Federal Reserve',sourceUrl:FOMC_URL,previous:null,forecast:null,actual:null});
    }
  }
  if(!sections.length||!events.length||malformed) throw Error('unrecognized or incomplete Fed schedule');
  return [...new Map(events.map(e=>[e.id,e])).values()];
}
