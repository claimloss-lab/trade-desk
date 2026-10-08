/* TradeDesk Phase 1 — isolated theme preference; no portfolio storage keys touched. */
(function(){
  'use strict';
  const KEY='td_ui_theme';
  const root=document.documentElement;
  function readTheme(){
    try {return localStorage.getItem(KEY)==='dark'?'dark':'light';}
    catch(e){return 'light';}
  }
  function apply(theme){
    const mode=theme==='dark'?'dark':'light';
    root.setAttribute('data-theme',mode);
    const button=document.getElementById('td-theme-toggle');
    if(button){
      const dark=mode==='dark';
      button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
      button.setAttribute('aria-pressed',String(dark));
      const ico=button.querySelector('.theme-toggle-icon');
      const label=button.querySelector('.theme-toggle-label');
      if(ico)ico.textContent=dark?'☀':'☾';
      if(label)label.textContent=dark?'Light':'Dark';
      button.title=dark?'Switch to light mode':'Switch to dark mode';
    }
  }
  apply(readTheme());
  function mount(){
    const header=document.querySelector('header .hdr-r');
    if(!header || document.getElementById('td-theme-toggle'))return;
    const button=document.createElement('button');
    button.type='button';
    button.id='td-theme-toggle';
    button.className='theme-toggle';
    button.innerHTML='<span class="theme-toggle-icon" aria-hidden="true"></span><span class="theme-toggle-label"></span>';
    button.addEventListener('click',function(){
      const next=root.getAttribute('data-theme')==='dark'?'light':'dark';
      try {localStorage.setItem(KEY,next);}catch(e){}
      apply(next);
    });
    header.insertBefore(button,header.firstChild);
    apply(root.getAttribute('data-theme'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);
  else mount();
})();
