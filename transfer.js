// 冰箱 <-> 仓库移库功能。支持搜索、筛选和补录日期。
(function(){
  let transferItemId=null,observer=null;
  function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function waitForApp(){if(typeof loadAll!=="function"||typeof render!=="function"||typeof renderDrawer!=="function"||typeof sb==="undefined"||typeof items==="undefined"){setTimeout(waitForApp,120);return;}installTransferUI();}
  function installTransferUI(){
    if(document.getElementById("transferDialog"))return;
    const dialog=document.createElement("dialog");dialog.id="transferDialog";dialog.innerHTML=`<div class="modal"><h3 id="transferTitle">移库</h3><div class="grid2"><label class="full">日期<input id="transferDate" type="date" required><span class="hint">支持历史日期补录</span></label><label class="full">移库方向<select id="transferDirection"><option value="warehouse_to_fridge">仓库 → 冰箱</option><option value="fridge_to_warehouse">冰箱 → 仓库</option></select></label><label class="full">数量<input id="transferQty" type="number" min="0.01" step="0.01" placeholder="输入移库数量"></label><div id="transferStockHint" class="full hint"></div></div><div class="modalfooter"><button class="secondary" id="cancelTransferBtn">取消</button><button id="saveTransferBtn">确认移库</button></div></div>`;document.body.appendChild(dialog);
    document.getElementById("cancelTransferBtn").onclick=()=>dialog.close();document.getElementById("saveTransferBtn").onclick=saveTransfer;document.getElementById("transferDirection").onchange=refreshHint;
    const originalRender=render;render=function(){originalRender();queueDecorate();};
    const originalDrawer=renderDrawer;renderDrawer=function(x){originalDrawer(x);addDrawerTransferButton(x.id);};
    window.openTransfer=openTransfer;
    watchInventoryRows();queueDecorate();
  }
  function queueDecorate(){requestAnimationFrame(()=>{decorateTransferButtons();setTimeout(decorateTransferButtons,60);});}
  function watchInventoryRows(){const body=document.getElementById('inventoryBody');if(!body||observer)return;observer=new MutationObserver(()=>queueDecorate());observer.observe(body,{childList:true,subtree:true});const search=document.getElementById('search'),filter=document.getElementById('categoryFilter');if(search)search.addEventListener('input',()=>setTimeout(decorateTransferButtons,0));if(filter)filter.addEventListener('change',()=>setTimeout(decorateTransferButtons,0));}
  function findIdFromRow(row){const b=row.querySelector('.linkbtn');if(!b)return null;const attr=b.getAttribute('onclick')||'';const m=attr.match(/openItemDrawer\('([^']+)'\)/);return m?m[1]:null;}
  function decorateTransferButtons(){
    const body=document.getElementById('inventoryBody');if(body){body.querySelectorAll('tr').forEach(row=>{const id=findIdFromRow(row);if(!id)return;const cell=row.querySelector('td.actions');if(!cell)return;let btn=cell.querySelector('.transfer-btn');if(!btn){btn=document.createElement('button');btn.className='secondary transfer-btn';btn.textContent='移库';const viewBtn=[...cell.querySelectorAll('button')].find(b=>b.textContent.trim()==='查看');cell.insertBefore(btn,viewBtn||null);}btn.onclick=()=>openTransfer(id);});}
    const logBody=document.getElementById('logBody');if(logBody){logBody.querySelectorAll('tr').forEach(tr=>{const td=tr.children[2];if(td&&td.textContent.trim()==='TRANSFER')td.textContent='移库';});}
  }
  function addDrawerTransferButton(id){const actions=document.querySelector('#itemDrawer .drawer-actions');if(!actions)return;let btn=actions.querySelector('.drawer-transfer-btn');if(!btn){btn=document.createElement('button');btn.className='secondary drawer-transfer-btn';btn.textContent='移库';const edit=document.getElementById('drawerEditBtn');actions.insertBefore(btn,edit||null);}btn.onclick=()=>{if(typeof closeItemDrawer==='function')closeItemDrawer();openTransfer(id);};}
  function openTransfer(id){const x=items.find(i=>i.id===id);if(!x)return;transferItemId=id;document.getElementById('transferTitle').textContent=x.name+' · 移库';const saved=localStorage.getItem('stockOperationDate');document.getElementById('transferDate').value=saved||today();document.getElementById('transferDirection').value='warehouse_to_fridge';document.getElementById('transferQty').value='';refreshHint();document.getElementById('transferDialog').showModal();}
  function refreshHint(){const x=items.find(i=>i.id===transferItemId);if(!x)return;const direction=document.getElementById('transferDirection').value,from=direction==='warehouse_to_fridge'?'仓库':'冰箱',to=direction==='warehouse_to_fridge'?'冰箱':'仓库',sourceQty=direction==='warehouse_to_fridge'?warehouse(x):fridge(x);document.getElementById('transferStockHint').textContent=`${from}当前库存：${sourceQty} ${x.unit||''}。移到${to}后，总库存不变。`;}
  async function saveTransfer(){
    const x=items.find(i=>i.id===transferItemId);if(!x)return;
    const date=document.getElementById('transferDate').value;
    const direction=document.getElementById('transferDirection').value;
    const qty=Number(document.getElementById('transferQty').value);
    if(!date)return alert('请选择日期');
    if(!Number.isFinite(qty)||qty<=0)return alert('请输入大于 0 的移库数量');
    localStorage.setItem('stockOperationDate',date);

    const btn=document.getElementById('saveTransferBtn');
    if(btn?.disabled)return;
    if(btn){btn.disabled=true;btn.textContent='处理中...';}
    try{
      const {data,error}=await sb.rpc('apply_inventory_transfer',{
        p_item:x.id,
        p_direction:direction,
        p_quantity:qty,
        p_operation_date:date
      });
      if(error){
        alert('移库失败：'+error.message+'\n库存和移库记录都没有改变。');
        return;
      }
      document.getElementById('transferDialog').close();
      await loadAll();
    }finally{
      if(btn){btn.disabled=false;btn.textContent='确认移库';}
    }
  }
  waitForApp();
})();