// 销售提成表格：表头固定，记录区域独立滚动。
(function(){
  'use strict';
  let installed=false;

  function addStyle(){
    if(document.getElementById('commissionStickyHeaderStyle'))return;
    const s=document.createElement('style');
    s.id='commissionStickyHeaderStyle';
    s.textContent=`
#commission .commission-table-scroll{
  max-height:62vh;
  overflow:auto;
  position:relative;
  border-radius:0 0 12px 12px;
}
#commission .commission-table-scroll table{
  margin:0;
}
#commission .commission-table-scroll thead th{
  position:sticky;
  top:0;
  z-index:20;
  background:#f8fafc!important;
  box-shadow:0 1px 0 #e5e7eb;
}
@media(max-width:900px){
  #commission .commission-table-scroll{max-height:58vh}
}
`;
    document.head.appendChild(s);
  }

  function wrapTable(){
    const section=document.getElementById('commission');
    if(!section)return false;
    const table=section.querySelector('table');
    if(!table)return false;
    if(table.closest('.commission-table-scroll'))return true;

    const wrap=document.createElement('div');
    wrap.className='commission-table-scroll';
    table.parentNode.insertBefore(wrap,table);
    wrap.appendChild(table);
    return true;
  }

  function install(){
    if(installed)return;
    if(!wrapTable()){setTimeout(install,120);return;}
    installed=true;
    addStyle();
    const scroll=document.querySelector('#commission .commission-table-scroll');
    if(scroll)scroll.scrollLeft=0;

    const section=document.getElementById('commission');
    if(section){
      const observer=new MutationObserver(()=>wrapTable());
      observer.observe(section,{childList:true,subtree:false});
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();