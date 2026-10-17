// 记住最后停留的页面；只在真正重新载入系统时恢复。
// 切换到 Excel / 其他标签再回来时不做任何重绘，避免画面闪烁。
(function(){
  'use strict';
  const KEY='beverageLastPageV3';
  let restored=false;
  let attempts=0;

  function pageFromLink(link){
    const href=link&&link.getAttribute?link.getAttribute('href')||'':'';
    return href.startsWith('#')?href.slice(1):'';
  }

  function savePage(page){
    if(!page)return;
    try{localStorage.setItem(KEY,page);}catch(e){}
    try{history.replaceState(null,'','#'+page);}catch(e){}
  }

  function activePage(){
    return pageFromLink(document.querySelector('.side-nav a.active'));
  }

  function rememberedPage(){
    let page='';
    try{page=(location.hash||'').replace(/^#/,'');}catch(e){}
    if(page)return page;
    try{return localStorage.getItem(KEY)||'';}catch(e){return '';}
  }

  // 用户点击侧边栏时立即记住。
  document.addEventListener('click',e=>{
    const link=e.target&&e.target.closest?e.target.closest('.side-nav a'):null;
    if(!link)return;
    const page=pageFromLink(link);
    if(page)savePage(page);
  },true);

  // 页面真正离开/关闭时保存当前页，但切回来时不主动恢复、不重绘。
  window.addEventListener('pagehide',()=>{
    const page=activePage();
    if(page)savePage(page);
  });

  function restoreOnce(){
    if(restored)return;
    const app=document.getElementById('appView');
    if(!app||app.classList.contains('hidden')||typeof showPage!=='function'){
      if(attempts++<40)setTimeout(restoreOnce,150);
      return;
    }

    let page=rememberedPage();
    if(!page){restored=true;return;}

    if(page==='settings'&&window.currentAppRole&&window.currentAppRole!=='admin'){
      page='dashboard';
      savePage(page);
    }

    const link=document.querySelector('.side-nav a[href="#'+page+'"]');
    if(!link){
      if(attempts++<40)setTimeout(restoreOnce,150);
      return;
    }

    restored=true;
    if(activePage()!==page){
      try{showPage(page);}catch(e){}
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>setTimeout(restoreOnce,120));
  }else{
    setTimeout(restoreOnce,120);
  }
})();