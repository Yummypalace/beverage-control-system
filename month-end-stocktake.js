// 盘点调整：独立页面。
// 月底实际盘点与系统库存不一致时，在这里把当前冰箱/仓库库存调整为实际数量，并保留完整盘点记录。
(function(){
  'use strict';

  let installed=false;
  let activeItemId='';

  function h(v=''){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
  function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0;}
  function clean(v){return Number(num(v).toFixed(2));}
  function todaySG(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function currentMonth(){return todaySG().slice(0,7);}

  function wait(){
    if(typeof sb==='undefined'||typeof items==='undefined'||typeof loadAll!=='function'||typeof showPage!=='function'||!document.querySelector('.side-nav')||!document.querySelector('.content-area')){
      setTimeout(wait,150);return;
    }
    install();
  }

  function install(){
    if(installed)return;installed=true;
    buildPage();
    buildDialog();
    extendNavigation();
    addStyle();
    renderTable();
  }

  function buildPage(){
    const content=document.querySelector('.content-area');
    if(!content||document.getElementById('stocktakeAdjust'))return;

    const section=document.createElement('div');
    section.id='stocktakeAdjust';
    section.className='panel-anchor';
    section.style.display='none';
    section.innerHTML=`
      <div class="stocktake-page-head">
        <div>
          <h2>盘点调整</h2>
          <div class="hint">月底完成实际库存盘点后，如果系统数量与实际数量不一致，可在这里调整。调整后会直接更新库存并留下盘点记录。</div>
        </div>
        <span id="stocktakePageStatus"></span>
      </div>

      <div class="card stocktake-toolbar">
        <div>
          <label>搜索饮料
            <input id="stocktakeSearch" placeholder="名称 / 类别 / 规格">
          </label>
        </div>
        <div class="stocktake-toolbar-actions">
          <button id="stocktakeRefresh" class="secondary">刷新库存</button>
        </div>
      </div>

      <div class="card stocktake-info">
        <b>使用方式：</b>
        <span>先完成实际盘点，再点击对应饮料的“盘点调整”，输入实际冰箱库存与实际仓库库存。系统只会调整有差异的位置；POS 销量不会改变。</span>
      </div>

      <div class="card stocktake-card">
        <div class="section-head">
          <h3>当前库存</h3>
          <span id="stocktakeCount" class="hint"></span>
        </div>
        <div class="tablewrap stocktake-table-wrap">
          <table class="stocktake-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>类别</th>
                <th>规格</th>
                <th>单位</th>
                <th>冰箱库存</th>
                <th>仓库库存</th>
                <th>总库存</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="stocktakeBody"><tr><td colspan="8">读取中...</td></tr></tbody>
          </table>
        </div>
      </div>`;
    content.appendChild(section);

    document.getElementById('stocktakeSearch').addEventListener('input',renderTable);
    document.getElementById('stocktakeRefresh').onclick=refreshPage;
  }

  function extendNavigation(){
    const nav=document.querySelector('.side-nav');
    if(!nav)return;

    let a=nav.querySelector('a[href="#stocktakeAdjust"]');
    if(!a){
      a=document.createElement('a');
      a.href='#stocktakeAdjust';
      a.innerHTML='<span class="side-icon">✓</span><span class="side-label">盘点调整</span>';
      const recon=nav.querySelector('a[href="#monthlyReconciliation"]');
      const settings=nav.querySelector('a[href="#settings"]');
      nav.insertBefore(a,recon||settings||null);
    }
    a.onclick=e=>{e.preventDefault();showPage('stocktakeAdjust');};

    const oldShowPage=showPage;
    showPage=function(page){
      const own=document.getElementById('stocktakeAdjust');
      if(page==='stocktakeAdjust'){
        ['dashboard','inventory','commission','logs','settings','corrections','outNotes','monthlyReconciliation'].forEach(id=>{
          const el=document.getElementById(id);if(el)el.style.display='none';
        });
        if(own)own.style.display='block';
        document.querySelectorAll('.side-nav a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#stocktakeAdjust'));
        window.scrollTo({top:0,behavior:'smooth'});
        refreshPage();
        return;
      }
      if(own)own.style.display='none';
      oldShowPage(page);
    };
  }

  async function refreshPage(){
    const btn=document.getElementById('stocktakeRefresh');
    const status=document.getElementById('stocktakePageStatus');
    if(btn){btn.disabled=true;btn.textContent='刷新中...';}
    if(status)status.textContent='读取中...';
    try{
      await loadAll();
      renderTable();
      if(status)status.textContent='已更新';
    }catch(e){
      if(status)status.textContent='刷新失败';
      alert('库存刷新失败：'+String(e?.message||e));
    }finally{
      if(btn){btn.disabled=false;btn.textContent='刷新库存';}
    }
  }

  function filteredItems(){
    const kw=(document.getElementById('stocktakeSearch')?.value||'').trim().toLowerCase();
    return [...items]
      .filter(x=>!kw||[x.name,x.category,x.spec,x.unit].join(' ').toLowerCase().includes(kw))
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-CN',{numeric:true,sensitivity:'base'}));
  }

  function renderTable(){
    const body=document.getElementById('stocktakeBody');
    const count=document.getElementById('stocktakeCount');
    if(!body)return;

    const rows=filteredItems();
    if(count)count.textContent=`显示 ${rows.length} 项`;

    body.innerHTML=rows.map(x=>{
      const f=clean(x.fridge_quantity),w=clean(x.warehouse_quantity),total=clean(f+w);
      return `<tr>
        <td><b>${h(x.name||'')}</b></td>
        <td>${h(x.category||'-')}</td>
        <td>${h(x.spec||'-')}</td>
        <td>${h(x.unit||'')}</td>
        <td>${f}</td>
        <td>${w}</td>
        <td><b>${total}</b></td>
        <td><button class="stocktake-row-btn secondary" data-item-id="${h(x.id)}">盘点调整</button></td>
      </tr>`;
    }).join('')||'<tr><td colspan="8">暂无符合条件的饮料</td></tr>';

    body.querySelectorAll('.stocktake-row-btn').forEach(btn=>{
      btn.onclick=()=>openDialog(btn.dataset.itemId);
    });
  }

  function buildDialog(){
    if(document.getElementById('reconStocktakeDialog'))return;

    const d=document.createElement('dialog');
    d.id='reconStocktakeDialog';
    d.innerHTML=`
      <div class="modal recon-stocktake-modal">
        <h3>盘点调整</h3>
        <div class="hint recon-stocktake-warning">请输入实际盘点数量。确认后会修改当前库存并留下“盘点调整”记录。</div>
        <div class="grid2 recon-stocktake-grid">
          <label class="full">饮料
            <select id="reconStocktakeItem"></select>
          </label>
          <label>盘点日期
            <input id="reconStocktakeDate" type="date" required>
          </label>
          <label>单位
            <input id="reconStocktakeUnit" disabled>
          </label>

          <div class="full recon-stocktake-current">
            <div><small>系统冰箱</small><b id="reconStocktakeSystemFridge">0</b></div>
            <div><small>系统仓库</small><b id="reconStocktakeSystemWarehouse">0</b></div>
            <div><small>系统总库存</small><b id="reconStocktakeSystemTotal">0</b></div>
          </div>

          <label>实际冰箱库存
            <input id="reconStocktakeActualFridge" type="number" min="0" step="0.01">
          </label>
          <label>实际仓库库存
            <input id="reconStocktakeActualWarehouse" type="number" min="0" step="0.01">
          </label>

          <div class="full recon-stocktake-diff" id="reconStocktakeDiff"></div>

          <label class="full">备注
            <input id="reconStocktakeNote" value="月底盘点调整" placeholder="例如：月底盘点调整">
          </label>
        </div>
        <div class="modalfooter">
          <button id="cancelReconStocktake" class="secondary">取消</button>
          <button id="saveReconStocktake">确认调整</button>
        </div>
      </div>`;
    document.body.appendChild(d);

    document.getElementById('cancelReconStocktake').onclick=()=>d.close();
    document.getElementById('saveReconStocktake').onclick=saveStocktake;
    document.getElementById('reconStocktakeItem').onchange=()=>loadItem(document.getElementById('reconStocktakeItem').value);
    ['reconStocktakeActualFridge','reconStocktakeActualWarehouse'].forEach(id=>{
      document.getElementById(id).addEventListener('input',updateDiff);
    });
  }

  function openDialog(itemId){
    const list=[...items].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-CN',{numeric:true,sensitivity:'base'}));
    if(!list.length){alert('目前没有饮料资料。');return;}

    const sel=document.getElementById('reconStocktakeItem');
    sel.innerHTML=list.map(x=>`<option value="${h(x.id)}">${h(x.name||'')}</option>`).join('');

    activeItemId=list.some(x=>String(x.id)===String(itemId))?String(itemId):String(list[0].id);
    sel.value=activeItemId;
    document.getElementById('reconStocktakeDate').value=todaySG();
    document.getElementById('reconStocktakeNote').value='月底盘点调整';
    loadItem(activeItemId);
    document.getElementById('reconStocktakeDialog').showModal();
  }

  function loadItem(id){
    const item=items.find(x=>String(x.id)===String(id));if(!item)return;
    activeItemId=String(item.id);
    const f=clean(item.fridge_quantity),w=clean(item.warehouse_quantity);
    document.getElementById('reconStocktakeUnit').value=item.unit||'';
    document.getElementById('reconStocktakeSystemFridge').textContent=f;
    document.getElementById('reconStocktakeSystemWarehouse').textContent=w;
    document.getElementById('reconStocktakeSystemTotal').textContent=clean(f+w);
    document.getElementById('reconStocktakeActualFridge').value=f;
    document.getElementById('reconStocktakeActualWarehouse').value=w;
    updateDiff();
  }

  function updateDiff(){
    const item=items.find(x=>String(x.id)===String(activeItemId));if(!item)return;
    const af=Number(document.getElementById('reconStocktakeActualFridge').value);
    const aw=Number(document.getElementById('reconStocktakeActualWarehouse').value);
    const box=document.getElementById('reconStocktakeDiff');

    if(!Number.isFinite(af)||af<0||!Number.isFinite(aw)||aw<0){
      box.innerHTML='<span class="stocktake-bad">请输入正确的实际库存。</span>';
      return;
    }

    const system=clean(num(item.fridge_quantity)+num(item.warehouse_quantity));
    const actual=clean(af+aw);
    const d=clean(actual-system);
    const fridgeDiff=clean(af-num(item.fridge_quantity));
    const warehouseDiff=clean(aw-num(item.warehouse_quantity));

    let totalText='<span class="stocktake-ok">总库存一致，无需调整</span>';
    if(d<0)totalText=`<span class="stocktake-bad">总库存短缺 ${Math.abs(d)}</span>`;
    else if(d>0)totalText=`<span class="stocktake-warn">总库存多 ${d}</span>`;

    box.innerHTML=`
      <b>盘点差异：</b> ${totalText}
      <small>冰箱 ${fridgeDiff>0?'+':''}${fridgeDiff} · 仓库 ${warehouseDiff>0?'+':''}${warehouseDiff}</small>`;
  }

  async function saveStocktake(){
    const item=items.find(x=>String(x.id)===String(activeItemId));if(!item)return;
    const date=document.getElementById('reconStocktakeDate').value;
    const f=Number(document.getElementById('reconStocktakeActualFridge').value);
    const w=Number(document.getElementById('reconStocktakeActualWarehouse').value);
    const note=(document.getElementById('reconStocktakeNote').value||'').trim()||'月底盘点调整';

    if(!date)return alert('请选择盘点日期');
    if(date.slice(0,7)!==currentMonth())return alert('盘点调整日期必须是当前月份。');
    if(!Number.isFinite(f)||f<0||!Number.isFinite(w)||w<0)return alert('实际库存不能小于 0');

    const oldF=clean(item.fridge_quantity),oldW=clean(item.warehouse_quantity);
    if(Math.abs(f-oldF)<0.000001&&Math.abs(w-oldW)<0.000001){
      alert('实际库存与系统库存一致，不需要盘点调整。');
      return;
    }

    const totalBefore=clean(oldF+oldW);
    const totalAfter=clean(f+w);
    const diff=clean(totalAfter-totalBefore);
    const description=diff<0?`短缺 ${Math.abs(diff)}`:`多 ${diff}`;

    if(!confirm(`${item.name}\n系统总库存：${totalBefore}\n实际总库存：${totalAfter}\n差异：${description}\n\n确定进行盘点调整吗？`))return;

    const btn=document.getElementById('saveReconStocktake');
    btn.disabled=true;btn.textContent='调整中...';

    try{
      const {error}=await sb.rpc('apply_month_end_stocktake',{
        p_item:item.id,
        p_operation_date:date,
        p_fridge_actual:f,
        p_warehouse_actual:w,
        p_note:note
      });
      if(error)throw error;

      document.getElementById('reconStocktakeDialog').close();
      await loadAll();
      renderTable();

      if(typeof window.refreshMonthlyReconciliation==='function')window.refreshMonthlyReconciliation(true);
      if(typeof window.refreshOutNoteHistory==='function')window.refreshOutNoteHistory();

      alert(`${item.name} 盘点调整完成。\n冰箱：${oldF} → ${clean(f)}\n仓库：${oldW} → ${clean(w)}\n总库存：${totalBefore} → ${totalAfter}`);
    }catch(e){
      alert('盘点调整失败：'+String(e?.message||e));
    }finally{
      btn.disabled=false;btn.textContent='确认调整';
    }
  }

  function addStyle(){
    if(document.getElementById('reconStocktakeStyle'))return;

    const s=document.createElement('style');
    s.id='reconStocktakeStyle';
    s.textContent=`
#stocktakeAdjust{padding:0 2px 24px}
.stocktake-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:4px 0 14px}
.stocktake-page-head h2{margin:0 0 4px;font-size:22px;color:#102a43}
.stocktake-page-head>span{font-size:13px;color:#667085;padding-top:5px}
.stocktake-toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;background:#f8fafc}
.stocktake-toolbar label{font-size:12px;color:#667085;font-weight:700;display:flex;flex-direction:column;gap:6px}
.stocktake-toolbar input{min-width:300px;min-height:42px}
.stocktake-toolbar-actions{display:flex;gap:8px}
.stocktake-toolbar-actions button{min-height:42px}
.stocktake-info{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;background:#fff8e8;color:#7b5b16;font-size:13px;line-height:1.6}
.stocktake-info b{white-space:nowrap}
.stocktake-card{padding:14px}
.stocktake-card .section-head h3{margin:0;font-size:17px}
.stocktake-table-wrap{max-height:68vh;overflow:auto}
.stocktake-table{min-width:920px}
.stocktake-table thead th{position:sticky;top:0;z-index:3;background:#f8fafc!important}
.stocktake-table th:nth-child(n+5),.stocktake-table td:nth-child(n+5){text-align:center}
.stocktake-row-btn{padding:6px 10px;font-size:12px;white-space:nowrap}

.recon-stocktake-modal{width:min(620px,100%)}
.recon-stocktake-warning{padding:10px 12px;margin:-2px 0 14px;background:#fff8e8;border:1px solid #f4dfae;border-radius:10px;line-height:1.55;color:#7b5b16}
.recon-stocktake-current{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0}
.recon-stocktake-current>div{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#f8fafc}
.recon-stocktake-current small{display:block;color:#667085;margin-bottom:5px}
.recon-stocktake-current b{font-size:20px;color:#173b5e}
.recon-stocktake-diff{padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e5e7eb;line-height:1.5}
.recon-stocktake-diff small{display:block;margin-top:4px;color:#667085}
.stocktake-ok{color:#087f5b;font-weight:700}
.stocktake-bad{color:#c92a2a;font-weight:700}
.stocktake-warn{color:#b7791f;font-weight:700}
@media(max-width:620px){
  .stocktake-toolbar{align-items:stretch;flex-direction:column}
  .stocktake-toolbar input{min-width:100%;width:100%}
  .stocktake-toolbar-actions button{width:100%}
  .stocktake-info{display:block}
  .stocktake-info b{display:block;margin-bottom:4px}
  .recon-stocktake-current{grid-template-columns:1fr 1fr}
  .recon-stocktake-current>div:last-child{grid-column:1/-1}
}
`;
    document.head.appendChild(s);
  }

  window.refreshStocktakeAdjust=refreshPage;
  wait();
})();