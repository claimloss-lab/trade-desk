/* Phase 1: theme toggle in the persistent, visible navigation bar. */
(function(){
 'use strict';
 const KEY='td_ui_theme', root=document.documentElement;
 let theme='light';
 try { theme=localStorage.getItem(KEY)==='dark'?'dark':'light'; } catch(e){}
 function apply(){
   root.dataset.theme=theme;
   const b=document.getElementById('td-theme-toggle');
   if(b){
     b.setAttribute('aria-label',theme==='dark'?'Switch to light mode':'Switch to dark mode');
     b.setAttribute('aria-pressed',String(theme==='dark'));
     b.title=theme==='dark'?'Switch to light mode':'Switch to dark mode';
     b.textContent=theme==='dark'?'☀ Light':'☾ Dark';
   }
 }
 function mount(){
   const nav=document.getElementById('nav-bar');
   if(!nav || document.getElementById('td-theme-toggle'))return;
   const b=document.createElement('button');
   b.type='button';b.id='td-theme-toggle';b.className='theme-toggle';
   b.addEventListener('click',()=>{
     theme=theme==='dark'?'light':'dark';
     try{localStorage.setItem(KEY,theme)}catch(e){}
     apply();
   });
   nav.appendChild(b);
   apply();
 }
 function init(){
   apply();mount();
   const nav=document.getElementById('nav-bar');
   if(nav && typeof MutationObserver!=='undefined'){
     const observer=new MutationObserver(()=>{if(!document.getElementById('td-theme-toggle'))mount()});
     observer.observe(nav,{childList:true});
   }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
