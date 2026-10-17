// 记住用户最后停留的侧边栏页面；重新打开/返回系统时恢复该页面。
(function(){
  'use strict';
  const KEY='beverageLastPageV1';
  let restored=false;

  function pageFromLink(link){
    const href=link?.getAttribute?.('href')||'';
    return href.startsWith('#')?href.slice(1):'';
  }

  function savePage(page){
    if(!page)return;
    try{localStorage.setItem(KEY,page);}catch(e){}
  }

  function activePage(){
    const active=document.querySelector('.side-nav a.active');
    return pageFromLink(active);
  }

  // 只记录用户真正点击的侧边栏页面，避免系统启动时自动打开工作台覆盖上次位置。
  document.addEventListener('click',e=>{
    const link=e.target.closest?.('.side-nav a');
    if(!link)return;
    const page=pageFromLink(link);
    if(page)savePage(page);
  },true);

  window.addEventListener('pagehide',()=>{
    const page=activePage();
    if(page)savePage(page);
  });

  function tryRestore(){
    if(restored)return;
    const app=document.getElementById('appView');
    if(!app||app.classList.contains('hidden')||typeof showPage!=='function'){
      setTimeout(tryRestore,180);
      return;
    }

    let page='';
    try{page=localStorage.getItem(KEY)||'';}catch(e){}
    if(!page){restored=true;return;}

    const link=document.querySelector('.side-nav a[href="#'+CSS.escape(page)+'"]');
    if(!link){
      setTimeout(tryRestore,180);
      return;
    }

    // 管理设置只有 Admin 能进入；等权限读取完成后再决定是否恢复。
    if(page==='settings'&&typeof window.currentAppRole==='undefined'){
      setTimeout(tryRestore,180);
      return;
    }
    if(page==='settings'&&window.currentAppRole!=='admin'){
      savePage('dashboard');
      page='dashboard';
    }

    restored=true;
    setTimeout(()=>showPage(page),60);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tryRestore);
  else tryRestore();
})();