// 界面优化：库存管理使用更大的屏幕空间，名称列可调整宽度。
(function(){
  let inventoryNameWidth=Number(localStorage.getItem('inventoryNameWidth')||260),resizeReady=false;
  function text(sel,value){const el=document.querySelector(sel);if(el)el.textContent=value;}
  function hideInventorySpec(){const table=document.querySelector('#inventory table');if(!table)return;const head=table.querySelector('thead tr');if(head&&head.children[2])head.children[2].style.display='none';table.querySelectorAll('tbody tr').forEach(tr=>{if(tr.children[2])tr.children[2].style.display='none';});applyWidth();setupResize();}
  function applyWidth(){inventoryNameWidth=Math.max(160,Math.min(650,inventoryNameWidth));document.querySelector('#inventory .tablewrap')?.style.setProperty('--inventory-name-width',inventoryNameWidth+'px');}
  function setupResize(){
    if(resizeReady)return;
    const th=document.querySelector('#inventory table thead th:first-child');
    if(!th)return;
    resizeReady=true;
    const h=document.createElement('span');
    h.className='inventory-col-resizer';
    h.title='拖动调整宽度';
    th.appendChild(h);
    h.addEventListener('pointerdown',e=>{
      if(e.button!==0&&e.pointerType!=='touch')return;
      e.preventDefault();
      e.stopPropagation();
      const pointerId=e.pointerId;
      const sx=e.clientX,sw=inventoryNameWidth;
      h.classList.add('dragging');
      document.body.classList.add('resizing-column');
      try{h.setPointerCapture(pointerId);}catch(_){}
      const move=ev=>{
        if(ev.pointerId!==pointerId)return;
        inventoryNameWidth=sw+ev.clientX-sx;
        applyWidth();
      };
      const up=ev=>{
        if(ev.pointerId!==pointerId)return;
        document.removeEventListener('pointermove',move);
        document.removeEventListener('pointerup',up);
        document.removeEventListener('pointercancel',up);
        try{h.releasePointerCapture(pointerId);}catch(_){}
        h.classList.remove('dragging');
        document.body.classList.remove('resizing-column');
        localStorage.setItem('inventoryNameWidth',String(inventoryNameWidth));
      };
      document.addEventListener('pointermove',move);
      document.addEventListener('pointerup',up);
      document.addEventListener('pointercancel',up);
    });
  }
  function polish(){document.title='饮料库存管理系统';text('header h1','饮料库存管理系统');text('header .subtitle','库存 · 调拨 · 销售提成');text('#inventory .section-head h2','库存明细');const commissionStat=document.getElementById('statCommission');if(commissionStat){const label=commissionStat.closest('.stat')?.querySelector('small');if(label)label.textContent='总提成';}hideInventorySpec();}
  function addStyle(){if(document.getElementById('uiPolishStyle'))return;const s=document.createElement('style');s.id='uiPolishStyle';s.textContent=`
    body{letter-spacing:.01em}main{max-width:none;width:100%;padding:0 8px}.admin-layout{grid-template-columns:190px minmax(0,1fr);gap:10px}.content-area{min-width:0}#inventory{width:calc(100vw - 218px);max-width:none;margin-left:0}#inventory .toolbar{margin-bottom:8px;gap:6px}#inventory>.card{padding:10px 8px;border-radius:12px}#inventory .section-head{position:sticky;top:0;z-index:40;height:44px;min-height:44px;box-sizing:border-box;margin:0;background:#fff;padding:7px 10px;border-bottom:1px solid #e5e7eb}#inventory .tablewrap{height:calc(100vh - 145px);max-height:calc(100vh - 145px);overflow:auto;position:relative;padding-top:0}
    #inventory table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;table-layout:fixed}#inventory table thead th{position:sticky;top:44px;z-index:21;background:#f8fafc!important;padding:11px 6px;min-width:68px;white-space:nowrap}#inventory table td{padding:10px 6px;min-width:68px}#inventory table thead th:nth-child(n+2),#inventory table tbody td:nth-child(n+2){text-align:center;vertical-align:middle}#inventory table thead th:first-child,#inventory table tbody td:first-child{text-align:left}#inventory table thead th:last-child{text-align:left!important}#inventory table th:nth-child(2),#inventory table td:nth-child(2){min-width:72px;width:72px}#inventory table th:nth-child(4),#inventory table td:nth-child(4){min-width:58px;width:58px}#inventory table th:nth-child(5),#inventory table td:nth-child(5),#inventory table th:nth-child(6),#inventory table td:nth-child(6),#inventory table th:nth-child(7),#inventory table td:nth-child(7){min-width:70px;width:70px}#inventory table th:nth-child(8),#inventory table td:nth-child(8){min-width:82px;width:82px}#inventory table th:nth-child(9),#inventory table td:nth-child(9){min-width:72px;width:72px}#inventory table th:first-child,#inventory table td:first-child{position:sticky;left:0;width:var(--inventory-name-width);min-width:var(--inventory-name-width);max-width:var(--inventory-name-width);background:#fff!important;box-shadow:2px 0 0 #e5e7eb;padding-left:10px}#inventory table tbody td:first-child{z-index:10;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#inventory table thead th:first-child{z-index:30;background:#f8fafc!important;overflow:visible}.inventory-col-resizer{position:absolute;right:-7px;top:0;width:14px;height:100%;cursor:col-resize;z-index:50;touch-action:none;user-select:none}.inventory-col-resizer::after{content:"";position:absolute;left:6px;top:18%;width:2px;height:64%;border-radius:2px;background:#d7dde5;opacity:.5}.inventory-col-resizer:hover::after,.inventory-col-resizer.dragging::after{width:3px;background:#173b5e;opacity:.9}.inventory-col-resizer:hover,.inventory-col-resizer.dragging{background:rgba(24,57,87,.08)}body.resizing-column{cursor:col-resize;user-select:none}body.resizing-column *{cursor:col-resize!important}
    @media(max-width:900px){.admin-layout{grid-template-columns:72px minmax(0,1fr);gap:8px}#inventory{width:calc(100vw - 96px)}}@media(max-width:620px){main{padding:0 6px}.admin-layout{grid-template-columns:1fr}#inventory{width:100%}#inventory .tablewrap{height:68vh;max-height:68vh}}
  `;document.head.appendChild(s);}
  function run(){addStyle();polish();setInterval(hideInventorySpec,600);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();