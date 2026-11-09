// 饮料转换：只修正先按 POS 误出库的实物库存；月结继续以原 POS 开单品项计算。
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let saving=false;
  let allConversions=[];
  let fetching=false;
  let pageInstalled=false;
  let historyItemNames=new Map();
  function init(){
    if(typeof sb==='undefined'||typeof items==='undefined'||!document.querySelector('#inventory .toolbar')){setTimeout(init,180);return;}
    if($('beverageConversionBtn'))return;
    installHistoryPage();
    const b=document.createElement('button');
    b.id='beverageConversionBtn';b.type='button';b.className='secondary';b.textContent='饮料转换';
    b.onclick=open;
    document.querySelector('#inventory .toolbar').appendChild(b);
    const d=document.createElement('dialog');d.id='beverageConversionDialog';
    d.innerHTML=`<div class="modal">
      <h3>饮料转换 · POS 品项更正</h3>
      <p class="hint" style="line-height:1.7">已按 POS 误开品项录入出库后，发现顾客实际喝的是另一款饮料，可在这里转换。<b>POS 开成的饮料加回库存，实际喝的饮料扣库存；原出库记录保留。</b></p>
      <div class="grid2">
        <label class="full">发生日期<input type="date" id="beverageConversionDate"></label>
        <label>POS 开成（库存加回）<select id="beverageConversionFrom"></select></label>
        <label>加回位置<select id="beverageConversionWrongLocation"><option value="fridge">冰箱</option><option value="warehouse">仓库</option></select></label>
        <label>实际喝了（库存扣减）<select id="beverageConversionTo"></select></label>
        <label>扣减位置<select id="beverageConversionActualLocation"><option value="fridge">冰箱</option><option value="warehouse">仓库</option></select></label>
        <label class="full">数量<input id="beverageConversionQty" type="number" min="0.01" step="0.01" value="1"></label>
        <label class="full">备注（选填）<input id="beverageConversionNote" placeholder="例如：顾客喝无糖可乐，POS 误开可乐"></label>
      </div>
      <div id="beverageConversionPreview" class="hint" style="margin-top:12px;line-height:1.7"></div>
      <div class="modalfooter"><button type="button" class="secondary" id="beverageConversionClose">取消</button><button type="button" class="green" id="beverageConversionSave">确认转换</button></div>
    </div>`;
    document.body.appendChild(d);
    $('beverageConversionClose').onclick=()=>d.close();
    $('beverageConversionSave').onclick=save;
    for(const id of ['beverageConversionFrom','beverageConversionTo','beverageConversionQty'])$(id).addEventListener('input',preview);
  }
  function selected(id){return (typeof items!=='undefined'?items:[]).find(x=>String(x.id)===$(id)?.value);}
  function open(){
    const list=Array.isArray(items)?items:[];
    const opts='<option value="">请选择饮料</option>'+list.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN')).map(x=>`<option value="${safe(x.id)}">${safe(x.name)}</option>`).join('');
    $('beverageConversionFrom').innerHTML=opts;
    $('beverageConversionTo').innerHTML=opts;
    $('beverageConversionDate').value=today();
    $('beverageConversionDate').max=today();
    $('beverageConversionQty').value=1;
    $('beverageConversionWrongLocation').value='fridge';
    $('beverageConversionActualLocation').value='fridge';
    $('beverageConversionNote').value='';
    preview();
    $('beverageConversionDialog').showModal();
  }
  function preview(){
    const from=selected('beverageConversionFrom'),to=selected('beverageConversionTo'),qty=Number($('beverageConversionQty').value);
    $('beverageConversionPreview').textContent=from&&to&&qty>0
      ?'实际库存：'+from.name+' +'+qty+'，'+to.name+' −'+qty+'。月结仍按原 POS 开单品项计算，出库记录保留。'
      :'请选择 POS 品项、实际饮用品项和数量。';
  }

  function installHistoryPage(){
    if(pageInstalled||$('beverageConversionRecords'))return;
    pageInstalled=true;
    const host=document.querySelector('.content-area');
    const nav=document.querySelector('.side-nav');
    if(!host||!nav){pageInstalled=false;return;}
    const panel=document.createElement('section');
    panel.id='beverageConversionRecords';
    panel.className='panel-anchor';
    panel.style.display='none';
    panel.innerHTML=`
      <div class="section-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div><h2 style="margin-bottom:5px">饮料转换记录</h2>
          <div class="hint">显示全部转换历史。实际库存按转换调整，月结核对仍按原 POS 品项计算。</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" id="beverageHistoryNew">新增饮料转换</button>
          <button type="button" id="beverageHistoryRefresh" class="secondary">刷新记录</button>
        </div>
      </div>
      <div class="card" style="margin:14px 0">
        <div class="grid2" style="align-items:end">
          <label>开始日期<input type="date" id="beverageHistoryFrom"></label>
          <label>结束日期<input type="date" id="beverageHistoryTo"></label>
          <label class="full">搜索饮料、备注或操作人<input id="beverageHistoryKeyword" placeholder="例如：Coke / 无糖 / 员工 Email"></label>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
          <button type="button" class="secondary" id="beverageHistoryClear">清除筛选</button>
          <button type="button" id="beverageHistorySearch">查询</button>
        </div>
      </div>
      <div class="card">
        <div class="section-head" style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <h3 style="margin:0">全部转换明细</h3><span id="beverageHistoryCount" class="hint">读取中...</span>
        </div>
        <div class="tablewrap" style="max-height:70vh;overflow:auto;margin-top:12px">
          <table style="min-width:1050px;width:100%">
            <thead><tr>
              <th>转换日期</th><th>POS 开成（加回库存）</th>
              <th>实际喝了（扣库存）</th><th>数量</th>
              <th>库存调整</th><th>加回位置 / 扣减位置</th><th>备注</th><th>操作人</th><th>记录时间</th><th>状态 / 操作</th>
            </tr></thead>
            <tbody id="beverageHistoryBody"><tr><td colspan="10">读取中...</td></tr></tbody>
          </table>
        </div>
      </div>`;
    host.appendChild(panel);
    const a=document.createElement('a');
    a.href='#beverageConversionRecords';
    a.innerHTML='<span class="side-icon">⇄</span><span class="side-label">饮料转换记录</span>';
    a.title='查看全部饮料转换记录';
    const next=nav.querySelector('a[href="#outNotes"]')||nav.querySelector('a[href="#settings"]');
    nav.insertBefore(a,next||null);
    // Integrate with existing wrapped navigation without changing other pages.
    const oldShowPage=showPage;
    showPage=function(page){
      if(page==='beverageConversionRecords'){
        document.querySelectorAll('.side-nav a[href^="#"]').forEach(link=>{
          const el=$(link.getAttribute('href').slice(1));
          if(el)el.style.display='none';
        });
        panel.style.display='block';
        document.querySelectorAll('.side-nav a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#beverageConversionRecords'));
        window.scrollTo({top:0,behavior:'smooth'});
        fetchHistory();
        return;
      }
      panel.style.display='none';
      oldShowPage(page);
    };
    a.onclick=e=>{e.preventDefault();showPage('beverageConversionRecords');};
    $('beverageHistoryNew').onclick=open;
    $('beverageHistoryRefresh').onclick=()=>fetchHistory();
    $('beverageHistorySearch').onclick=renderHistory;
    $('beverageHistoryClear').onclick=()=>{
      $('beverageHistoryFrom').value='';
      $('beverageHistoryTo').value='';
      $('beverageHistoryKeyword').value='';
      renderHistory();
    };
    $('beverageHistoryKeyword').addEventListener('keydown',e=>{if(e.key==='Enter')renderHistory();});
    $('beverageHistoryBody').addEventListener('click',e=>{
      const btn=e.target.closest('button[data-reverse-conversion]');
      if(btn)reverseConversion(Number(btn.dataset.reverseConversion));
    });
  }
  function historyNames(){
    const list=typeof allItems!=='undefined'&&Array.isArray(allItems)?allItems:items;
    const names=new Map(list.map(x=>[String(x.id),String(x.name)]));
    historyItemNames.forEach((name,id)=>names.set(id,name));
    return names;
  }
  async function fetchHistory(){
    if(fetching||!$('beverageHistoryBody'))return;
    fetching=true;
    $('beverageHistoryCount').textContent='正在读取全部记录...';
    try{
      const rows=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await sb.from('beverage_pos_conversions')
          .select('id,operation_date,pos_item_id,actual_item_id,quantity,wrong_location,actual_location,note,created_by,created_at,is_reversed,reversed_at,reversed_by')
          .order('id',{ascending:false}).range(offset,offset+999);
        if(error)throw error;
        rows.push(...(data||[]));
        if(!data||data.length<1000)break;
      }
      allConversions=rows.filter(r=>!r.is_reversed);
      const {data:inventoryNames,error:nameError}=await sb.from('inventory_items').select('id,name');
      if(!nameError&&inventoryNames)historyItemNames=new Map(inventoryNames.map(x=>[String(x.id),String(x.name)]));
      renderHistory();
    }catch(e){
      $('beverageHistoryCount').textContent='读取失败';
      $('beverageHistoryBody').innerHTML='<tr><td colspan="10">加载失败：'+safe(e.message||e)+'</td></tr>';
    }finally{fetching=false;}
  }
  function renderHistory(){
    const body=$('beverageHistoryBody');
    if(!body)return;
    const names=historyNames();
    const from=$('beverageHistoryFrom').value,to=$('beverageHistoryTo').value;
    const keyword=$('beverageHistoryKeyword').value.trim().toLowerCase();
    const filtered=allConversions.filter(r=>{
      if(from&&r.operation_date<from)return false;
      if(to&&r.operation_date>to)return false;
      const words=[names.get(String(r.pos_item_id))||'',names.get(String(r.actual_item_id))||'',r.note||'',r.created_by||''].join(' ').toLowerCase();
      return !keyword||words.includes(keyword);
    });
    $('beverageHistoryCount').textContent='共 '+filtered.length+' 条'+(filtered.length!==allConversions.length?'（全部 '+allConversions.length+' 条）':'');
    body.innerHTML=filtered.map(r=>{
      const original=names.get(String(r.pos_item_id))||'未知饮料';
      const actual=names.get(String(r.actual_item_id))||'未知饮料';
      const qty=Number(r.quantity);
      const timestamp=r.created_at?new Date(r.created_at).toLocaleString('zh-SG',{timeZone:'Asia/Singapore',hour12:false}):'—';
      return '<tr>'+
        '<td>'+safe(r.operation_date)+'</td>'+
        '<td>'+safe(original)+'</td>'+
        '<td>'+safe(actual)+'</td>'+
        '<td>'+safe(qty)+'</td>'+
        '<td style="white-space:nowrap">'+safe(original)+' +'+safe(qty)+'，'+safe(actual)+' −'+safe(qty)+'</td>'+ 
        '<td>'+safe(r.wrong_location==='fridge'?'冰箱':r.wrong_location==='warehouse'?'仓库':'—')+' / '+safe(r.actual_location==='fridge'?'冰箱':r.actual_location==='warehouse'?'仓库':'—')+'</td>'+ 
        '<td style="white-space:normal;min-width:180px">'+safe(r.note||'—')+'</td>'+
        '<td>'+safe(r.created_by||'—')+'</td>'+
        '<td>'+safe(timestamp)+'</td>'+
        '<td><button type="button" class="secondary" data-reverse-conversion="'+Number(r.id)+'" style="white-space:nowrap">撤销</button></td></tr>';
    }).join('')||'<tr><td colspan="10" style="text-align:center;padding:20px">暂无符合条件的饮料转换记录</td></tr>';
  }
  async function reverseConversion(id){
    if(saving||!Number.isSafeInteger(id)||id<=0)return;
    const record=allConversions.find(x=>Number(x.id)===id);
    if(!record||record.is_reversed)return;
    if(!confirm('确定撤销这笔饮料转换？\\n将原 POS 饮料库存扣回、实际饮用饮料库存加回。\\n月结转换备注会取消，这笔转换会从页面列表中消失。'))return;
    saving=true;
    try{
      const {error}=await sb.rpc('reverse_beverage_pos_conversion',{p_id:id});
      if(error)throw error;
      await fetchHistory();
      if(typeof loadAll==='function')await loadAll();
      if(typeof window.refreshMonthlyReconciliation==='function')window.refreshMonthlyReconciliation();
      alert('饮料转换已撤销；库存已恢复，这笔记录已从列表消失，月结转换备注同步取消。');
    }catch(e){alert('撤销失败：'+String(e.message||e));}
    finally{saving=false;}
  }
  async function save(){
    if(saving)return;
    const from=$('beverageConversionFrom').value,to=$('beverageConversionTo').value;
    const qty=Number($('beverageConversionQty').value),date=$('beverageConversionDate').value;
    const note=$('beverageConversionNote').value.trim();
    if(!from||!to||from===to)return alert('请选择不同的两种饮料');
    if(!Number.isFinite(qty)||qty<=0)return alert('请输入正确数量');
    if(!date)return alert('请选择发生日期');
    if(!confirm('确认转换？\nPOS 开成的饮料库存 +'+qty+'，实际喝的饮料库存 −'+qty+'。\n原出库记录保留，月结仍按照 POS 开单品项计算。'))return;
    saving=true;$('beverageConversionSave').disabled=true;
    try{
      const {error}=await sb.rpc('add_beverage_pos_conversion',{
        p_pos_item:from,p_actual_item:to,p_qty:qty,p_operation_date:date,p_note:note,
        p_wrong_location:$('beverageConversionWrongLocation').value,
        p_actual_location:$('beverageConversionActualLocation').value
      });
      if(error)throw error;
      alert('转换已保存。已加回 POS 误扣饮料，扣减实际饮用饮料；月结仍按照原 POS 开单品项计算。');
      if(typeof loadAll==='function')await loadAll();
      $('beverageConversionDialog').close();
      if($('beverageConversionRecords')?.style.display!=='none')await fetchHistory();
      if(typeof window.refreshMonthlyReconciliation==='function')window.refreshMonthlyReconciliation();
      if(typeof window.loadMonthlyReconciliation==='function')window.loadMonthlyReconciliation();
    }catch(e){
      const message=String(e.message||e);
      if(/could not find the function|schema cache/i.test(message)){
        alert('网页使用的饮料转换版本与数据库不一致。请按 Ctrl + F5 强制刷新，重新打开「饮料转换」，确认有「加回位置」和「扣减位置」两个选项后再保存。\n\n原库存不会因这次失败而改变。');
      }else alert('饮料转换保存失败：'+message);
    }
    finally{saving=false;$('beverageConversionSave').disabled=false;}
  }
  init();
})();