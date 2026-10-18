// 月底盘点调整：从“月结核对”直接把实际盘点数量写回库存。
// 只允许对当前月份/当前库存执行，避免把历史月份的实际数直接覆盖今天的库存。
(function(){
  'use strict';
  let installed=false;
  let activeItemId='';

  function h(v=''){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
  function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0;}
  function clean(v){return Number(num(v).toFixed(2));}
  function todaySG(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function currentMonth(){return todaySG().slice(0,7);}
  function selectedMonth(){return document.getElementById('reconMonth')?.value||currentMonth();}

  function wait(){
    if(typeof sb==='undefined'||typeof items==='undefined'||typeof loadAll!=='function'||!document.getElementById('monthlyReconciliation')){
      setTimeout(wait,150);return;
    }
    install();
  }

  function install(){
    if(installed)return;installed=true;
    addButton();
    buildDialog();
    addStyle();
  }

  function addButton(){
    if(document.getElementById('reconStocktakeBtn'))return;
    const actions=document.querySelector('#monthlyReconciliation .recon-control-actions');
    if(!actions)return;
    const btn=document.createElement('button');
    btn.id='reconStocktakeBtn';
    btn.type='button';
    btn.className='secondary recon-stocktake-btn';
    btn.textContent='盘点调整';
    btn.onclick=openDialog;
    const reload=document.getElementById('reconReload');
    if(reload&&reload.nextSibling)actions.insertBefore(btn,reload.nextSibling);
    else actions.prepend(btn);
  }

  function buildDialog(){
    if(document.getElementById('reconStocktakeDialog'))return;
    const d=document.createElement('dialog');
    d.id='reconStocktakeDialog';
    d.innerHTML=`
      <div class="modal recon-stocktake-modal">
        <h3>月底盘点调整</h3>
        <div class="hint recon-stocktake-warning">月底完成实际盘点后使用。确认后会修改当前库存并留下“盘点调整”记录，POS 数据不会改变。</div>
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

  function openDialog(){
    const month=selectedMonth();
    if(month!==currentMonth()){
      alert('盘点调整只能修改当前月份的当前库存。历史月份请保留原记录，不直接覆盖今天的库存。');
      return;
    }

    const sel=document.getElementById('reconStocktakeItem');
    const list=[...items].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-CN',{numeric:true,sensitivity:'base'}));
    sel.innerHTML=list.map(x=>`<option value="${h(x.id)}">${h(x.name||'')}</option>`).join('');
    if(!list.length){alert('目前没有饮料资料。');return;}

    activeItemId=list.some(x=>String(x.id)===String(activeItemId))?activeItemId:String(list[0].id);
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
      box.innerHTML='<span class="recon-bad">请输入正确的实际库存。</span>';
      return;
    }
    const system=clean(num(item.fridge_quantity)+num(item.warehouse_quantity));
    const actual=clean(af+aw);
    const d=clean(actual-system);
    const fridgeDiff=clean(af-num(item.fridge_quantity));
    const warehouseDiff=clean(aw-num(item.warehouse_quantity));

    let totalText='<span class="recon-ok">总库存一致，无需调整</span>';
    if(d<0)totalText=`<span class="recon-bad">总库存短缺 ${Math.abs(d)}</span>`;
    else if(d>0)totalText=`<span class="recon-warn">总库存多 ${d}</span>`;

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
      const {data,error}=await sb.rpc('apply_month_end_stocktake',{
        p_item:item.id,
        p_operation_date:date,
        p_fridge_actual:f,
        p_warehouse_actual:w,
        p_note:note
      });
      if(error)throw error;

      document.getElementById('reconStocktakeDialog').close();
      await loadAll();
      if(typeof window.refreshMonthlyReconciliation==='function')await window.refreshMonthlyReconciliation(true);
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
.recon-stocktake-btn{border:1px solid #d7dce2!important}
.recon-stocktake-modal{width:min(620px,100%)}
.recon-stocktake-warning{padding:10px 12px;margin:-2px 0 14px;background:#fff8e8;border:1px solid #f4dfae;border-radius:10px;line-height:1.55;color:#7b5b16}
.recon-stocktake-current{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0}
.recon-stocktake-current>div{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#f8fafc}
.recon-stocktake-current small{display:block;color:#667085;margin-bottom:5px}
.recon-stocktake-current b{font-size:20px;color:#173b5e}
.recon-stocktake-diff{padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e5e7eb;line-height:1.5}
.recon-stocktake-diff small{display:block;margin-top:4px;color:#667085}
@media(max-width:620px){.recon-stocktake-current{grid-template-columns:1fr 1fr}.recon-stocktake-current>div:last-child{grid-column:1/-1}}
`;
    document.head.appendChild(s);
  }

  wait();
})();