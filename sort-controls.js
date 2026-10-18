// 饮料排序：可按名称或类别排序，工作台与库存管理同步。
// 使用 MutationObserver 保证库存表每次重绘后仍会重新套用当前排序，不会被核心 render() 恢复成名称顺序。
(function(){
  'use strict';

  let installed=false;
  let sortQueued=false;
  let observer=null;

  function wait(){
    if(typeof render!=='function'||!document.getElementById('inventory')||!document.getElementById('dashboardProducts')){
      setTimeout(wait,150);return;
    }
    install();
  }

  function install(){
    if(installed)return;
    installed=true;

    buildControls();

    const oldRender=render;
    render=function(){
      const result=oldRender.apply(this,arguments);
      queueSort();
      return result;
    };

    installObservers();
    bindInventoryRefreshPoints();
    queueSort();
  }

  function buildControls(){
    const saved=localStorage.getItem('beverageSortMode')||'name';

    const toolbar=document.querySelector('#inventory .toolbar');
    if(toolbar&&!document.getElementById('inventorySortMode')){
      const sel=document.createElement('select');
      sel.id='inventorySortMode';
      sel.innerHTML='<option value="name">按名称排序</option><option value="category">按类别排序</option>';
      sel.value=saved;
      sel.onchange=syncSort;
      toolbar.insertBefore(sel,document.getElementById('addBtn'));
    }

    const head=document.querySelector('#dashboardProducts>.section-head');
    if(head&&!document.getElementById('dashboardSortMode')){
      const right=document.createElement('div');
      right.style.cssText='display:flex;align-items:center;gap:10px';

      const count=document.getElementById('dashboardProductCount');
      if(count)right.appendChild(count);

      const sel=document.createElement('select');
      sel.id='dashboardSortMode';
      sel.style.cssText='padding:7px 10px;border-radius:8px';
      sel.innerHTML='<option value="name">按名称排序</option><option value="category">按类别排序</option>';
      sel.value=saved;
      sel.onchange=syncSort;
      right.appendChild(sel);
      head.appendChild(right);
    }
  }

  function bindInventoryRefreshPoints(){
    ['search','categoryFilter'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el)return;
      el.addEventListener(id==='search'?'input':'change',queueSort);
    });

    const refresh=document.getElementById('refreshBtn');
    if(refresh)refresh.addEventListener('click',()=>setTimeout(queueSort,0));
  }

  function installObservers(){
    if(observer)observer.disconnect();

    observer=new MutationObserver(()=>queueSort());
    ['inventoryBody','dashboardProductsBody'].forEach(id=>{
      const body=document.getElementById(id);
      if(body)observer.observe(body,{childList:true});
    });
  }

  function syncSort(e){
    const mode=e.target.value==='category'?'category':'name';
    localStorage.setItem('beverageSortMode',mode);

    const a=document.getElementById('inventorySortMode');
    const b=document.getElementById('dashboardSortMode');
    if(a)a.value=mode;
    if(b)b.value=mode;

    applySort();
  }

  function queueSort(){
    if(sortQueued)return;
    sortQueued=true;

    requestAnimationFrame(()=>{
      sortQueued=false;
      applySort();
    });
  }

  function applySort(){
    const mode=localStorage.getItem('beverageSortMode')==='category'?'category':'name';

    const a=document.getElementById('inventorySortMode');
    const b=document.getElementById('dashboardSortMode');
    if(a&&a.value!==mode)a.value=mode;
    if(b&&b.value!==mode)b.value=mode;

    sortTable(document.getElementById('inventoryBody'),mode,0,1);
    sortTable(document.getElementById('dashboardProductsBody'),mode,0,1);
  }

  function compareText(a,b){
    return String(a||'').localeCompare(String(b||''),'zh-CN',{
      numeric:true,
      sensitivity:'base'
    });
  }

  function sortTable(body,mode,nameIndex,catIndex){
    if(!body)return;

    const rows=[...body.querySelectorAll(':scope > tr')];
    const dataRows=rows.filter(row=>row.children.length>Math.max(nameIndex,catIndex));
    if(dataRows.length<2)return;

    const sorted=[...dataRows].sort((a,b)=>{
      const an=(a.children[nameIndex]?.textContent||'').trim();
      const bn=(b.children[nameIndex]?.textContent||'').trim();
      const ac=(a.children[catIndex]?.textContent||'').trim();
      const bc=(b.children[catIndex]?.textContent||'').trim();

      if(mode==='category'){
        const categoryCompare=compareText(ac,bc);
        if(categoryCompare!==0)return categoryCompare;
      }

      return compareText(an,bn);
    });

    // 如果顺序已经正确，就不要碰 DOM，避免无意义重绘。
    const alreadySorted=sorted.every((row,index)=>row===dataRows[index]);
    if(alreadySorted)return;

    const fragment=document.createDocumentFragment();
    sorted.forEach(row=>fragment.appendChild(row));
    body.appendChild(fragment);
  }

  wait();
})();