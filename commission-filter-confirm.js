// 员工提成筛选：筛选条件先选择，点击“查询”后才应用；重置立即恢复默认。
(function(){
'use strict';
let installed=false;
let renderRowsHandler=null;
let applied={seller:'',item:'',from:'',to:''};
let restoreToken=0;

function el(id){return document.getElementById(id);}
function readControls(){return {
  seller:el('commissionSellerFilter')?.value||'',
  item:el('commissionItemFilter')?.value||'',
  from:el('commissionDateFrom')?.value||'',
  to:el('commissionDateTo')?.value||''
};}
function writeControls(state){
  const map={commissionSellerFilter:state.seller||'',commissionItemFilter:state.item||'',commissionDateFrom:state.from||'',commissionDateTo:state.to||''};
  Object.entries(map).forEach(([id,value])=>{const x=el(id);if(x)x.value=value;});
}
function cloneControl(id){
  const old=el(id);if(!old)return null;
  if(!renderRowsHandler&&typeof old.onchange==='function')renderRowsHandler=old.onchange;
  const fresh=old.cloneNode(true);
  fresh.onchange=null;
  old.replaceWith(fresh);
  return fresh;
}
function applyFilters(){
  const draft=readControls();
  if(draft.from&&draft.to&&draft.from>draft.to)return alert('开始日期不能晚于结束日期');
  applied={...draft};
  if(typeof renderRowsHandler==='function')renderRowsHandler();
}
function protectRender(){
  if(typeof window.render!=='function'||window.render.__commissionFilterProtected)return;
  const old=window.render;
  const wrapped=function(){
    const draft=readControls();
    writeControls(applied);
    const token=++restoreToken;
    let result;
    try{result=old.apply(this,arguments);}finally{
      setTimeout(()=>{if(token===restoreToken)writeControls(draft);},0);
    }
    return result;
  };
  wrapped.__commissionFilterProtected=true;
  window.render=wrapped;
}
function install(){
  if(installed)return;installed=true;
  ['commissionSellerFilter','commissionItemFilter','commissionDateFrom','commissionDateTo'].forEach(cloneControl);
  const itemSearch=el('commissionItemFilter');
  if(itemSearch)itemSearch.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyFilters();}});
  applied=readControls();
  window.getAppliedCommissionFilters=()=>({...applied});

  const reset=el('clearCommissionFiltersBtn');
  if(reset){
    const actions=reset.parentElement;
    if(actions){
      actions.style.display='flex';actions.style.alignItems='flex-end';actions.style.gap='8px';
      reset.style.width='auto';reset.style.flex='1';
      const confirm=document.createElement('button');
      confirm.id='applyCommissionFiltersBtn';confirm.type='button';confirm.textContent='查询';confirm.style.minHeight='42px';confirm.style.flex='1';
      actions.insertBefore(confirm,reset);
      confirm.onclick=applyFilters;
    }
    reset.addEventListener('click',()=>{applied={seller:'',item:'',from:'',to:''};},true);
  }

  const archive=el('commissionMonthArchive');
  if(archive){
    archive.addEventListener('click',e=>{
      const target=e.target.closest('#commissionCurrentMonthBtn,[data-month]');
      if(!target)return;
      // 切换月份时放弃尚未确认的筛选修改，并清除已应用日期范围。
      applied={...applied,from:'',to:''};
      writeControls(applied);
      setTimeout(()=>{if(typeof renderRowsHandler==='function')renderRowsHandler();},0);
    },true);
  }

  protectRender();
}
function wait(){
  if(!el('manualCommissionFilterPanel')||!el('commissionSellerFilter')||!el('commissionItemFilter')||!el('commissionDateFrom')||!el('commissionDateTo')||!el('commissionMonthArchive')){setTimeout(wait,120);return;}
  install();
}
wait();
})();
