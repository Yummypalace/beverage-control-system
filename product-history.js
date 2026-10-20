// 点开饮料显示库存历史；支持撤销普通库存记录与整组错单更正。
(function(){
  let historyRows=[];
  let currentItem=null;
  function currentMonth(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'}).slice(0,7);}
  function monthLabel(v){const [y,m]=String(v||'').split('-');return y&&m?`${y}年${Number(m)}月`:'';}
  function monthEnd(v){const [y,m]=String(v||'').split('-').map(Number);return y&&m?new Date(Date.UTC(y,m,0)).toISOString().slice(0,10):'';}
  function wait(){if(typeof renderDrawer!=='function'||typeof sb==='undefined'){setTimeout(wait,120);return;}install();}
  function install(){const oldRenderDrawer=renderDrawer;renderDrawer=function(x){oldRenderDrawer(x);currentItem=x;ensureHistoryBox();resetHistoryFilters();loadProductHistory(x);};}
  function ensureHistoryStyle(){
    if(document.getElementById('productHistoryTableStyle'))return;
    const s=document.createElement('style');
    s.id='productHistoryTableStyle';
    s.textContent=`
#productHistoryBox .product-history-table{min-width:900px!important;width:100%;table-layout:auto}
#productHistoryBox .product-history-table th:nth-child(1),
#productHistoryBox .product-history-table td:nth-child(1){min-width:100px;width:100px;white-space:nowrap}
#productHistoryBox .product-history-table th:nth-child(2),
#productHistoryBox .product-history-table td:nth-child(2){min-width:68px;width:68px;white-space:nowrap}
#productHistoryBox .product-history-table th:nth-child(3),
#productHistoryBox .product-history-table td:nth-child(3){min-width:54px;width:54px;white-space:nowrap}
#productHistoryBox .product-history-table th:nth-child(4),
#productHistoryBox .product-history-table td:nth-child(4){min-width:320px}
#productHistoryBox .product-history-table th:nth-child(5),
#productHistoryBox .product-history-table td:nth-child(5){min-width:210px;white-space:nowrap}
#productHistoryBox .product-history-table th:nth-child(6),
#productHistoryBox .product-history-table td:nth-child(6){min-width:110px;white-space:nowrap}
#productHistoryBox .product-history-closing td{background:#f7f9fc!important;border-top:2px solid #dce3ea;font-weight:700;color:#173b5e}
`;
    document.head.appendChild(s);
  }
  function ensureHistoryBox(){ensureHistoryStyle();const drawer=document.getElementById('itemDrawer');if(!drawer||document.getElementById('productHistoryBox'))return;const danger=drawer.querySelector('.danger-zone'),box=document.createElement('div');box.id='productHistoryBox';box.style.marginTop='22px';box.innerHTML=`<div class="section-head"><h3 style="margin:0;font-size:17px">入库 / 出库历史</h3><span id="productHistorySummary" class="hint"></span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:12px 0 14px;padding:12px;border:1px solid #e5e7eb;border-radius:12px;background:#fafbfc"><label style="font-size:12px;color:#6b7280;display:flex;flex-direction:column;gap:5px">月份<select id="historyMonthFilter"></select></label><label style="font-size:12px;color:#6b7280;display:flex;flex-direction:column;gap:5px">操作类型<select id="historyActionFilter"><option value="">全部操作</option><option value="IN">只看入库</option><option value="OUT">只看出库</option><option value="BORROW">只看借出</option><option value="RETURN">只看还回</option><option value="TRANSFER">只看移库</option><option value="ADJUST">只看盘点</option><option value="CREATE">只看新增</option><option value="EDIT">只看编辑</option></select></label><label style="font-size:12px;color:#6b7280;display:flex;flex-direction:column;gap:5px">查找<input id="historyKeywordFilter" placeholder="备注或操作账号"></label><div style="display:flex;align-items:flex-end"><button id="historyResetBtn" class="secondary" style="width:100%">回到本月</button></div></div><div id="historyFilterMessage" class="hint" style="margin-bottom:8px"></div><div class="tablewrap" style="margin-top:8px"><table class="product-history-table"><thead><tr><th>日期</th><th>操作</th><th>数量</th><th>位置 / 备注</th><th>操作人</th><th>操作</th></tr></thead><tbody id="productHistoryBody"><tr><td colspan="6">读取中...</td></tr></tbody></table></div>`;drawer.insertBefore(box,danger||null);document.getElementById('historyMonthFilter').onchange=applyHistoryFilters;document.getElementById('historyActionFilter').onchange=applyHistoryFilters;document.getElementById('historyKeywordFilter').oninput=applyHistoryFilters;document.getElementById('historyResetBtn').onclick=()=>{resetHistoryFilters();applyHistoryFilters();};}
  function availableMonths(){
    const months=new Set(historyRows.map(r=>dateOf(r).slice(0,7)).filter(m=>/^\d{4}-\d{2}$/.test(m)));
    months.add(currentMonth());
    return [...months].sort((a,b)=>b.localeCompare(a));
  }
  function populateMonthFilter(){
    const el=document.getElementById('historyMonthFilter');if(!el)return;
    const months=availableMonths();
    const keep=el.value&&(el.value==='all'||months.includes(el.value))?el.value:currentMonth();
    el.innerHTML='<option value="all">全部月份</option>'+months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    el.value=keep==='all'||months.includes(keep)?keep:(months[0]||'');
  }
  function resetHistoryFilters(){
    const month=document.getElementById('historyMonthFilter');if(month)month.value=currentMonth();
    const action=document.getElementById('historyActionFilter');if(action)action.value='';
    const keyword=document.getElementById('historyKeywordFilter');if(keyword)keyword.value='';
  }
  function dateOf(x){return x.operation_date||new Date(x.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function actionName(a,r){if(r?.correction_ref)return '错单更正';return ({IN:'入库',OUT:'出库',BORROW:'借出',RETURN:'还回',TRANSFER:'移库',ADJUST:'盘点',CREATE:'新增',EDIT:'编辑'})[a]||a;}
  function canUndo(r){return !!r.correction_ref||['IN','OUT','BORROW','RETURN','TRANSFER'].includes(r.action);}
  async function fetchHistory(itemId){let result=await sb.from('inventory_logs').select('*').eq('item_id',itemId).order('operation_date',{ascending:false}).order('created_at',{ascending:false}).limit(1000);if(result.error&&String(result.error.message||'').toLowerCase().includes('operation_date'))result=await sb.from('inventory_logs').select('*').eq('item_id',itemId).order('created_at',{ascending:false}).limit(1000);return result;}
  async function loadProductHistory(x){const body=document.getElementById('productHistoryBody'),summary=document.getElementById('productHistorySummary'),message=document.getElementById('historyFilterMessage');if(!body)return;historyRows=[];body.innerHTML='<tr><td colspan="6">读取中...</td></tr>';if(summary)summary.textContent='';if(message)message.textContent='';const {data,error}=await fetchHistory(x.id);if(error){body.innerHTML=`<tr><td colspan="6">读取失败：${esc(error.message)}</td></tr>`;return;}historyRows=data||[];populateMonthFilter();resetHistoryFilters();applyHistoryFilters();}
  function parseAdjustDelta(note){
    const s=String(note||'');
    const before=s.match(/调整前\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    const after=s.match(/调整后\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return before&&after?Number(after[1])-Number(before[1]):0;
  }
  function parseCreateTotal(r){
    const m=String(r.note||'').match(/冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return m?Number(m[1])+Number(m[2]):Number(r.quantity||0);
  }
  function closingAt(month){
    const cutoff=monthEnd(month);
    let total=0,exists=false;
    const rows=[...historyRows].sort((a,b)=>{
      const da=dateOf(a),db=dateOf(b);
      if(da!==db)return da.localeCompare(db);
      const ca=String(a.created_at||''),cb=String(b.created_at||'');
      if(ca!==cb)return ca.localeCompare(cb);
      return Number(a.id||0)-Number(b.id||0);
    });
    for(const r of rows){
      if(dateOf(r)>cutoff)break;
      const q=Number(r.quantity||0);
      if(r.action==='CREATE'){total=parseCreateTotal(r);exists=true;continue;}
      if(!exists)exists=true;
      if(r.action==='IN'||r.action==='RETURN')total+=q;
      else if(r.action==='OUT'||r.action==='BORROW')total-=q;
      else if(r.action==='ADJUST')total+=parseAdjustDelta(r.note);
    }
    return exists?Number(total.toFixed(2)):0;
  }
  function applyHistoryFilters(){
    const body=document.getElementById('productHistoryBody'),summary=document.getElementById('productHistorySummary'),message=document.getElementById('historyFilterMessage');if(!body)return;
    const month=document.getElementById('historyMonthFilter')?.value||currentMonth();
    const action=document.getElementById('historyActionFilter')?.value||'';
    const keyword=(document.getElementById('historyKeywordFilter')?.value||'').trim().toLowerCase();
    const filtered=historyRows.filter(r=>{
      const date=dateOf(r);
      if(month!=='all'&&date.slice(0,7)!==month)return false;
      if(action&&r.action!==action)return false;
      if(keyword&&!([actionName(r.action,r),r.note,r.user_email,date].join(' ').toLowerCase().includes(keyword)))return false;
      return true;
    });
    const inQty=filtered.filter(r=>r.action==='IN').reduce((s,r)=>s+Number(r.quantity||0),0);
    const outQty=filtered.filter(r=>r.action==='OUT').reduce((s,r)=>s+Number(r.quantity||0),0);
    const closing=month===currentMonth()&&currentItem?Number((Number(currentItem.fridge_quantity||0)+Number(currentItem.warehouse_quantity||0)).toFixed(2)):closingAt(month);
    if(summary)summary.textContent=`${month==='all'?'全部月份':monthLabel(month)} · 入库 ${inQty} / 出库 ${outQty}`;
    if(message)message.textContent=month==='all'?`显示全部月份 ${filtered.length} 条记录。`:`显示 ${filtered.length} 条 ${monthLabel(month)}记录；其他月份已收起。`;
    const rowsHtml=filtered.map(r=>`<tr><td>${esc(dateOf(r))}</td><td><b>${esc(actionName(r.action,r))}</b></td><td>${Number(r.quantity||0)}</td><td>${esc(r.note||'')}</td><td>${esc(r.user_email||'')}</td><td>${canUndo(r)?`<button class="secondary history-undo-btn" data-id="${r.id}" style="padding:5px 8px;font-size:12px">${r.correction_ref?'撤销更正':'撤销'}</button>`:'<span class="hint">不可自动撤销</span>'}</td></tr>`).join('');
    const closingLabel=month===currentMonth()?'当前库存':'月末结存';
    const closingNote=month===currentMonth()?'':'该月份结束后的库存总数';
    const closingRow=month==='all'?'':`<tr class="product-history-closing"><td colspan="2"><b>${esc(monthLabel(month))} ${closingLabel}</b></td><td><b>${closing}</b></td><td colspan="3">${closingNote}</td></tr>`;
    body.innerHTML=closingRow+(rowsHtml||'<tr><td colspan="6">没有符合筛选条件的记录</td></tr>');
    body.querySelectorAll('.history-undo-btn').forEach(btn=>btn.onclick=()=>undoHistoryRecord(btn.dataset.id));
  }
  async function undoHistoryRecord(id){const row=historyRows.find(r=>String(r.id)===String(id));if(!row)return;if(row.correction_ref){if(!confirm(`确定撤销整组错单更正吗？\n${dateOf(row)}\n\n两种饮料的库存都会一起恢复，更正记录也会一起删除。`))return;const {error}=await sb.rpc('undo_pos_correction',{p_correction_ref:row.correction_ref});if(error)return alert('撤销失败：'+error.message+'\n\n请确认已经在 Supabase 运行 pos-correction.sql。');await loadAll();const latest=currentItem?items.find(i=>i.id===currentItem.id):null;if(latest){currentItem=latest;renderDrawer(latest);}return;}let effect='';if(row.action==='OUT')effect='库存会把这次出库数量加回原来的位置。';if(row.action==='IN')effect='库存会把这次入库数量从原来的位置扣回。';if(row.action==='BORROW')effect='库存会把这次借出的数量加回原来的位置。';if(row.action==='RETURN')effect='库存会把这次还回的数量从原来的位置扣回。';if(row.action==='TRANSFER')effect='库存会按相反方向移回去。';if(!confirm(`确定撤销这条记录吗？\n${dateOf(row)} · ${actionName(row.action,row)} · 数量 ${Number(row.quantity||0)}\n\n${effect}\n记录也会同时删除。`))return;const {error}=await sb.rpc('undo_inventory_log',{p_log_id:Number(id)});if(error)return alert('撤销失败：'+error.message+'\n\n请确认已经在 Supabase 运行最新版 account-directory-upgrade.sql。');if(currentItem)await loadAll();const latest=currentItem?items.find(i=>i.id===currentItem.id):null;if(latest){currentItem=latest;renderDrawer(latest);}else if(currentItem){await loadProductHistory(currentItem);}}
  wait();
})();