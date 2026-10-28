(() => {
  'use strict';
  const TZ = 'Asia/Bangkok';
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dayISO = value => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(value);
    return `${parts.find(x=>x.type==='year').value}-${parts.find(x=>x.type==='month').value}-${parts.find(x=>x.type==='day').value}`;
  };
  const shift = (day, offset) => new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0,10);
  const labelDate = (day, opts = {day:'numeric',month:'short'}) => new Intl.DateTimeFormat('th-TH', { timeZone:'UTC', ...opts }).format(new Date(`${day}T12:00:00Z`));
  const displayTime = value => new Intl.DateTimeFormat('th-TH',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  const symbol = value => String(value || '').toUpperCase().replace(/\./g,'-');
  const normalized = value => symbol(value).replace(/^GOOGL$/, 'GOOG');
  let start = dayISO(new Date()), filter = 'all', search = '', state = null, holdings = null, requestNumber = 0;
  const days = () => Array.from({length:7}, (_,i)=>shift(start,i));
  async function loadHoldings() {
    try {
      const response = await fetch('/portfolio-data.json', {cache:'no-store'});
      if (!response.ok) throw Error('portfolio unavailable');
      const data = await response.json();
      if (!Array.isArray(data.portfolios)) throw Error('invalid portfolio');
      holdings = new Set();
      for (const portfolio of data.portfolios) {
        for (const stock of portfolio.stocks || []) {
          if (portfolio.type === 'realtime_dr' && stock.parentTicker) holdings.add(normalized(stock.parentTicker));
          if (portfolio.type === 'realtime_us' && stock.ticker) holdings.add(normalized(stock.ticker));
        }
      }
    } catch { holdings = null; }
  }
  const isHeld = item => holdings?.has(normalized(item.ticker)) || false;
  function money(value) {
    if (value === null || value === undefined || value === '' || value === 'N/A' || value === '--') return '—';
    return String(value);
  }
  const isDateOnly = event => /election|holiday/i.test(event.title || '');
  function macroDay(event) { try { return isDateOnly(event) ? String(event.date).slice(0,10) : dayISO(new Date(event.date)); } catch { return ''; } }
  function macroNote(title) {
    if (/interest rate|fomc|fed.*decision/i.test(title)) return 'จับตาทิศทางดอกเบี้ยและถ้อยแถลง Fed';
    if (/cpi|pce|inflation|consumer price/i.test(title)) return 'จับตาเงินเฟ้อ เทียบคาดการณ์และครั้งก่อน';
    if (/payroll|employment|unemployment|jolts|jobless/i.test(title)) return 'จับตาความแข็งแรงตลาดแรงงาน';
    if (/gdp|gross domestic/i.test(title)) return 'จับตาการเติบโตของเศรษฐกิจ';
    if (/pmi|ism/i.test(title)) return 'จับตาภาพรวมกิจกรรมเศรษฐกิจ';
    return 'ตัวเลข/เหตุการณ์เศรษฐกิจสหรัฐฯ';
  }
  function sessionLabel(code) {
    if (code === 'time-after-hours') return ['หลังตลาด','US · ไทยวันถัดไป'];
    if (code === 'time-pre-market') return ['ก่อนตลาด','วันตลาดสหรัฐฯ'];
    if (code === 'time-during-market') return ['ระหว่างตลาด','วันตลาดสหรัฐฯ'];
    return ['ไม่ระบุเวลา','วันตลาดสหรัฐฯ'];
  }
  const matches = (...values) => !search || values.some(x=>String(x||'').toLowerCase().includes(search));
  function render() {
    const listDays = days(), today = dayISO(new Date());
    $('range-label').textContent = `${labelDate(listDays[0])} – ${labelDate(listDays.at(-1),{day:'numeric',month:'short',year:'numeric'})}`;
    if (!state) return;
    const earnings = state.earnings.rows || [], macro = (state.macro.rows || []).filter(x=>x.importance >= 0 && Number.isFinite(Date.parse(x.date)) && listDays.includes(macroDay(x)));
    const high = macro.filter(x=>x.importance >= 1);
    $('count-high').textContent = state.macro.error ? '—' : high.length;
    $('count-earnings').textContent = state.earnings.available && !state.earnings.failedDates.length ? earnings.length : '—';
    $('count-portfolio').textContent = holdings && state.earnings.available && !state.earnings.failedDates.length ? earnings.filter(isHeld).length : '—';
    const next = high.filter(x => Date.parse(x.date) >= Date.now()).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];
    $('spotlight').textContent = next ? next.title : (state.macro.error ? 'ยังโหลดข้อมูลเศรษฐกิจไม่ได้' : 'ไม่มีเหตุการณ์เศรษฐกิจระดับสูงที่ยังไม่ถึงในช่วงนี้');
    $('spotlight-detail').textContent = next ? `${labelDate(macroDay(next),{weekday:'short',day:'numeric',month:'short'})} · ${isDateOnly(next) ? 'ทั้งวัน / เวลาไม่ยืนยัน' : `${displayTime(next.date)} น. เวลาไทย`} · ${macroNote(next.title)}` : 'ตรวจปฏิทินทางการเพิ่มเติมก่อนตัดสินใจ';
    $('updated').textContent = `ดึงข้อมูล ${new Intl.DateTimeFormat('th-TH',{timeZone:TZ,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(state.generatedAt))} น. ไทย`;
    const warn = [];
    if (state.constituents.error) warn.push('รายชื่อ S&P 500 โหลดไม่ได้ จึงไม่แสดงรายการงบแทนการเดาว่าเป็นหุ้นในดัชนี');
    if (state.earnings.failedDates.length) warn.push(`วันงบโหลดไม่ครบ: ${state.earnings.failedDates.map(x=>x.date).join(', ')} — จำนวนในสรุปจึงไม่แสดง`);
    if (state.macro.error) warn.push('ปฏิทินเศรษฐกิจโหลดไม่ได้ — ไม่ได้หมายความว่าไม่มีเหตุการณ์');
    if (!holdings) warn.push('โหลดรายการพอร์ตไม่ได้ — ไม่สามารถระบุหุ้นที่ถือได้');
    $('warnings').textContent = warn.join(' · ');
    const html = listDays.map(day => {
      const macroRows = filter === 'all' || filter === 'macro' ? macro.filter(x=>macroDay(x)===day && matches(x.title,x.source)).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)) : [];
      const earningRows = filter !== 'macro' ? earnings.filter(x=>x.date===day && (filter !== 'held'||isHeld(x)) && matches(x.ticker,x.name)).sort((a,b)=>Number(isHeld(b))-Number(isHeld(a)) || (Number(String(b.marketCap||'').replace(/[^0-9.]/g,''))||0)-(Number(String(a.marketCap||'').replace(/[^0-9.]/g,''))||0)) : [];
      const macroCards = macroRows.map(x=>{
        const level = x.importance>=1 ? ['สำคัญสูง','high'] : x.importance===0 ? ['ปานกลาง','medium'] : ['ทั่วไป',''];
        const fmt = v => `${escapeHTML(money(v))}${v === null || v === undefined || v === '' ? '' : escapeHTML(x.unit)}`;
        const number = x.forecast!==null || x.previous!==null || x.actual!==null ? `<span class="stat">คาด ${fmt(x.forecast)} · ก่อน ${fmt(x.previous)}${x.actual!==null ? ` · จริง ${fmt(x.actual)}`:''}</span>` : '';
        return { priority:x.importance >= 1 ? 0 : 2, html:`<article class="event"><div class="time">${isDateOnly(x) ? 'ทั้งวัน' : escapeHTML(displayTime(x.date))}<small>${isDateOnly(x) ? 'เวลาไม่ยืนยัน' : 'เวลาไทย · ICT'}</small></div><div><div class="event-title">${escapeHTML(x.title)}</div><div class="event-sub">${escapeHTML(macroNote(x.title))} · TradingView${x.source ? ` / ${escapeHTML(x.source)}` : ''}</div></div><div class="event-right"><span class="pill ${level[1]}">${level[0]}</span>${number}</div></article>` };
      });
      const earningCards = earningRows.map(x=>{
        const time = sessionLabel(x.session), held = isHeld(x);
        return { priority:held ? 1 : 3, html:`<article class="event"><div class="time">${time[0]}<small>${time[1]}</small></div><div><div class="event-title">${escapeHTML(x.ticker)} <span class="event-sub">${escapeHTML(x.name)}</span></div><div class="event-sub">ประกาศงบ ${escapeHTML(x.fiscalQuarter || '')} · วันที่อาจเป็นประมาณการ</div></div><div class="event-right">${held?'<span class="pill held">หุ้นที่ถือ</span>':''}<span class="pill stock">EARNINGS</span><span class="stat">EPS คาด ${escapeHTML(money(x.epsForecast))}</span></div></article>` };
      });
      const cards = [...macroCards, ...earningCards].sort((a,b)=>a.priority-b.priority).map(x=>x.html);
      const visible = cards.slice(0,5).join('');
      const events = cards.length > 5 ? `${visible}<details class="more-events"><summary>ดูอีก ${cards.length-5} รายการ ↓</summary>${cards.slice(5).join('')}</details>` : visible;
      const failed = state.earnings.failedDates.some(x=>x.date===day);
      let empty = failed ? 'ข้อมูลวันงบวันนี้โหลดไม่สำเร็จ' : 'ไม่มีรายการตรงตัวกรองจากแหล่งที่โหลดได้';
      if (filter==='held' && !holdings) empty = 'ไม่สามารถโหลดข้อมูลพอร์ตเพื่อกรองหุ้นที่ถือ';
      return `<section class="day"><div class="day-date"><strong>${escapeHTML(labelDate(day,{weekday:'long'}))}</strong><small>${escapeHTML(labelDate(day,{day:'numeric',month:'short',year:'numeric'}))}</small>${day===today?'<span class="tag-today">TODAY</span>':''}</div><div class="day-body">${events||`<div class="day-empty">${escapeHTML(empty)}</div>`}</div></section>`;
    }).join('');
    $('calendar').innerHTML = html;
  }
  async function load() {
    const n = ++requestNumber; $('refresh').disabled = true; $('updated').textContent='กำลังโหลดข้อมูล…';
    try {
      const [response] = await Promise.all([fetch(`/api/calendar?start=${encodeURIComponent(start)}&days=7`),loadHoldings()]);
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (n !== requestNumber) return;
      if (!result.earnings || !result.macro || !result.constituents) throw Error('invalid response');
      state = result; render();
    } catch (error) {
      if (n!==requestNumber) return;
      state=null; $('calendar').innerHTML='<div class="empty">โหลดปฏิทินไม่ได้ กรุณาลองใหม่อีกครั้ง<br>ไม่ได้หมายความว่าไม่มีเหตุการณ์</div>'; $('warnings').textContent='ไม่สามารถติดต่อบริการปฏิทินได้'; $('updated').textContent='โหลดไม่สำเร็จ'; $('spotlight').textContent='ยังไม่มีข้อมูลที่ยืนยันได้'; $('spotlight-detail').textContent='กรุณาลองอัปเดตอีกครั้ง'; ['count-high','count-earnings','count-portfolio'].forEach(id=>$(id).textContent='—');
    } finally { if(n===requestNumber) $('refresh').disabled=false; }
  }
  $('prev').addEventListener('click',()=>{start=shift(start,-7);load()});
  $('next').addEventListener('click',()=>{start=shift(start,7);load()});
  $('today').addEventListener('click',()=>{start=dayISO(new Date());load()});
  $('refresh').addEventListener('click',load);
  $('search').addEventListener('input',e=>{search=e.target.value.trim().toLowerCase();render()});
  document.querySelectorAll('.chip').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('.chip').forEach(x=>{const active=x===button;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active))});render()}));
  load();
})();
