// 稳定记住最后停留的页面：切走、返回、刷新或重新打开时恢复。
(function(){
  'use strict';
  const KEY='beverageLastPageV2';
  let restoring=false;

  function pageFromLink(link){
    const href=link&&link.getAttribute?link.getAttribute('href')||'':'';
    return href.startsWith('#')?href.slice(1):'';
  }

  function savePage(page){
    if(!page)return;
    try{localStorage.setItem(KEY,page);}catch(e){}
    try{history.replaceState(null,'','#'+page);}catch(e){}
  }

  function savedPage(){
    let page='';
    try{page=(location.hash||'').replace(/^#/,'');}catch(e){}
    if(page)return page;
    try{return localStorage.getItem(KEY)||'';}catch(e){return '';}
  }

  function activePage(){
    return pageFromLink(document.querySelector('.side-nav a.active'));
  }

  function canOpen(page){
    const link=document.querySelector('.side-nav a[href="#'+page+'"]');
    if(!link)return false;
    if(page==='settings'&&window.currentAppRole&&window.currentAppRole!=='admin')return false;
    return true;
  }

  function restorePage(){
    if(restoring)return;
    const app=document.getElementById('appView');
    if(!app||app.classList.contains('hidden')||typeof showPage!=='function')return;

    let page=savedPage();
    if(!page)return;
    if(page==='settings'&&window.currentAppRole&&window.currentAppRole!=='admin'){
      page='dashboard';
      savePage(page);
    }
    if(!canOpen(page))return;

    const current=activePage();
    if(current===page)return;

    restoring=true;
    try{showPage(page);}catch(e){}
    setTimeout(()=>{restoring=false;},180);
  }

  // 用户点侧边栏时立即保存，不依赖各页面自己的 showPage 实现。
  document.addEventListener('click',e=>{
    const link=e.target&&e.target.closest?e.target.closest('.side-nav a'):null;
    if(!link)return;
    const page=pageFromLink(link);
    if(page)savePage(page);
  },true);

  // 如果页面内部代码主动切页，也在最终稳定后记录当前页。
  const observer=new MutationObserver(()=>{
    const page=activePage();
    if(page&&!restoring){
      const remembered=savedPage();
      // 启动时工作台的自动激活，不覆盖已经记住的其他页面。
      if(!remembered||remembered===page)savePage(page);
    }
  });

  function startObserver(){
    const nav=document.querySelector('.side-nav');
    if(nav)observer.observe(nav,{subtree:true,attributes:true,attributeFilter:['class']});
  }

  window.addEventListener('pagehide',()=>{
    const page=activePage();
    if(page)savePage(page);
  });

  let returnTimer=null;
  function scheduleRestore(){
    clearTimeout(returnTimer);
    returnTimer=setTimeout(()=>restorePage(),180);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){
      const page=activePage();
      if(page)savePage(page);
      return;
    }
    // 切回系统时只检查一次；如果本来就在正确页面，不重绘。
    scheduleRestore();
  });

  window.addEventListener('focus',scheduleRestore);

  function boot(){
    startObserver();
    // 动态页面（备注、月结、错单）脚本需要一点时间加载，所以连续尝试恢复。
    [180,500,1000,1800].forEach(ms=>setTimeout(()=>restorePage(),ms));
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
  else boot();
})();