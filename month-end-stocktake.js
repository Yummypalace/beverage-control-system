// 月度盘点调整：只处理已经结束的月份。
// 每个已结束月份会建立一份“月末系统库存快照”；实际盘点完成后再录入实际数量。
// 若有差异，系统按差额修正当前库存，并把调整记录记在该月最后一天。
(function(){
  'use strict';

  let installed=false;
  let selectedMonth='';
  let allInventoryLogs=[];
  let monthRecords=[];
  let loading=false;
  let activeStocktakeId='';
  const STOCKTAKE_SORT_KEY='monthlyStocktakeSortModeV1';
  const STOCKTAKE_SORT_DIR_KEY='monthlyStocktakeSortDirectionV1';
  const STOCKTAKE_WIDTHS_KEY='monthlyStocktakeColumnWidthsV1';

  function h(v=''){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
  function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0;}
  function clean(v){return Number(num(v).toFixed(2));}
  function todaySG(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function currentMonth(){return todaySG().slice(0,7);}
  function previousMonth(month=currentMonth()){
    const [y,m]=String(month).split('-').map(Number);
    return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);
  }
  function monthEnd(month){
    const [y,m]=String(month||'').split('-').map(Number);
    if(!y||!m)return '';
    return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  }
  function monthLabel(v){const [y,m]=String(v||'').split('-');return y&&m?`${y}年${Number(m)}月`:'';}
  function dateOf(r){return r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function recordDiff(r){
    if(r.actual_fridge==null||r.actual_warehouse==null)return null;
    return clean(num(r.actual_fridge)+num(r.actual_warehouse)-num(r.system_fridge)-num(r.system_warehouse));
  }
  function sameAsSystem(r,fridge,warehouse){
    return Math.abs(num(fridge)-num(r.system_fridge))<0.000001&&Math.abs(num(warehouse)-num(r.system_warehouse))<0.000001;
  }
  function user(){return typeof userEmail==='function'?userEmail():'';}

  function wait(){
    if(typeof sb==='undefined'||typeof items==='undefined'||typeof loadAll!=='function'||typeof showPage!=='function'||!document.querySelector('.side-nav')||!document.querySelector('.content-area')){
      setTimeout(wait,150);return;
    }
    install();
  }

  function install(){
    if(installed)return;installed=true;
    selectedMonth=previousMonth();
    buildPage();
    buildDialog();
    extendNavigation();
    addStyle();
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
          <div class="hint">按月份保留月末系统库存记录。你们用手写盘点单核对后，只有发现不一致的饮料才需要做盘点调整。</div>
        </div>
        <span id="stocktakePageStatus"></span>
      </div>

      <div class="card stocktake-toolbar">
        <div class="stocktake-toolbar-left">
          <label>盘点月份
            <select id="stocktakeMonth"></select>
          </label>
          <label>搜索饮料
            <input id="stocktakeSearch" placeholder="名称 / 类别 / 规格">
          </label>
        </div>
        <div class="stocktake-toolbar-actions">
          <button id="stocktakeRefresh" class="secondary">刷新</button>
        </div>
      </div>

      <div class="card stocktake-info">
        <b>使用方式：</b>
        <span id="stocktakeInfoText">先用手写盘点单对照月末系统库存。数量一致的不需要处理；发现不一致时，点击该饮料的“盘点调整”，再填写正确库存。系统只按差额修正，不会把今天库存直接覆盖成上个月的数量。</span>
      </div>

      <div class="stocktake-summary">
        <div class="card"><small>月末品项</small><b id="stocktakeTotalItems">0</b></div>
        <div class="card"><small>系统冰箱总数</small><b id="stocktakeSystemFridgeTotal">0</b></div>
        <div class="card"><small>系统仓库总数</small><b id="stocktakeSystemWarehouseTotal">0</b></div>
        <div class="card"><small>系统库存总数</small><b id="stocktakeSystemGrandTotal">0</b></div>
        <div class="card"><small>已调整品项</small><b id="stocktakeAdjustedItems">0</b></div>
        <div class="card"><small>调整增加</small><b id="stocktakeIncrease">0</b></div>
        <div class="card"><small>调整减少</small><b id="stocktakeDecrease">0</b></div>
      </div>

      <div class="card stocktake-card">
        <div class="section-head stocktake-month-head">
          <div>
            <h3 id="stocktakeMonthTitle">月末盘点表</h3>
            <div id="stocktakeCutoffHint" class="hint"></div>
          </div>
          <span id="stocktakeCount" class="hint"></span>
        </div>
        <div class="tablewrap stocktake-table-wrap">
          <table class="stocktake-table">
            <thead>
              <tr>
                <th><button type="button" class="stocktake-sort-head" data-sort="name"><span>名称</span><span class="stocktake-sort-arrow">↕</span></button></th>
                <th><button type="button" class="stocktake-sort-head" data-sort="category"><span>类别</span><span class="stocktake-sort-arrow">↕</span></button></th>
                <th>单位</th>
                <th>系统冰箱</th>
                <th>系统仓库</th>
                <th>系统总库存</th>
                <th>盘点差异</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody id="stocktakeBody"><tr><td colspan="9">读取中...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="card stocktake-card stocktake-history-card">
        <div class="section-head">
          <div>
            <h3>本月调整明细</h3>
            <div class="hint">这里只显示实际盘点后产生库存差异的调整记录；完整盘点结果以上方月末盘点表为准。</div>
          </div>
          <span id="stocktakeHistoryCount" class="hint"></span>
        </div>
        <div class="tablewrap stocktake-history-wrap">
          <table class="stocktake-history-table">
            <thead>
              <tr><th>日期</th><th>饮料</th><th>位置</th><th>调整前</th><th>调整后</th><th>差异</th><th>备注</th><th>操作人</th></tr>
            </thead>
            <tbody id="stocktakeHistoryBody"><tr><td colspan="8">暂无调整记录</td></tr></tbody>
          </table>
        </div>
      </div>`;
    content.appendChild(section);

    document.getElementById('stocktakeMonth').onchange=async()=>{
      selectedMonth=document.getElementById('stocktakeMonth').value||previousMonth();
      await loadSelectedMonth();
    };
    document.getElementById('stocktakeSearch').oninput=renderTable;
    document.querySelectorAll('#stocktakeAdjust .stocktake-sort-head').forEach(btn=>{
      btn.onclick=()=>{
        const field=btn.dataset.sort==='category'?'category':'name';
        const current=localStorage.getItem(STOCKTAKE_SORT_KEY)==='category'?'category':'name';
        const currentDir=localStorage.getItem(STOCKTAKE_SORT_DIR_KEY)==='desc'?'desc':'asc';
        const nextDir=current===field?(currentDir==='asc'?'desc':'asc'):'asc';
        localStorage.setItem(STOCKTAKE_SORT_KEY,field);
        localStorage.setItem(STOCKTAKE_SORT_DIR_KEY,nextDir);
        renderTable();
      };
    });
    updateStocktakeSortHeaders();
    document.getElementById('stocktakeRefresh').onclick=refreshPage;
  }

  function extendNavigation(){
    const nav=document.querySelector('.side-nav');if(!nav)return;
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

  async function retry(task,attempts=3){
    let lastErr=null;
    for(let i=0;i<attempts;i++){
      try{
        const result=await task();
        if(!result?.error)return result;
        lastErr=result.error;
      }catch(e){lastErr=e;}
      if(i<attempts-1)await new Promise(r=>setTimeout(r,220*(i+1)));
    }
    throw lastErr||new Error('读取失败');
  }

  async function fetchAllInventoryLogs(attempt=0){
    try{
      const all=[];let from=0;const size=1000;
      while(true){
        const {data,error}=await sb.from('inventory_logs').select('*')
          .order('operation_date',{ascending:true})
          .order('created_at',{ascending:true})
          .range(from,from+size-1);
        if(error)throw error;
        const page=data||[];all.push(...page);
        if(page.length<size)break;
        from+=size;
      }
      return all;
    }catch(e){
      if(attempt<2){
        await new Promise(r=>setTimeout(r,220*(attempt+1)));
        return fetchAllInventoryLogs(attempt+1);
      }
      throw e;
    }
  }

  function parseLocation(note){
    const first=String(note||'').split('｜')[0].trim();
    return first==='冰箱'?'fridge':first==='仓库'?'warehouse':'';
  }

  function parseEdit(note){
    const s=String(note||'');
    const m=s.match(/调整前\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return m?{fridge:num(m[1]),warehouse:num(m[2])}:null;
  }

  function parseAdjust(note){
    const s=String(note||'');
    const loc=parseLocation(s);
    const m=s.match(/调整前\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return loc&&m?{location:loc,before:num(m[1])}:null;
  }

  function snapshotForItem(item,cutoff){
    let fridge=num(item.fridge_quantity),warehouse=num(item.warehouse_quantity),exists=true;
    const logs=allInventoryLogs
      .filter(r=>String(r.item_id||'')===String(item.id)&&dateOf(r)>cutoff)
      .sort((a,b)=>String(dateOf(b)).localeCompare(String(dateOf(a)))||String(b.created_at||'').localeCompare(String(a.created_at||''))||Number(b.id||0)-Number(a.id||0));

    for(const r of logs){
      const action=String(r.action||''),q=num(r.quantity),note=String(r.note||''),loc=parseLocation(note);
      if(action==='IN'||action==='RETURN'){
        if(loc==='fridge')fridge-=q;
        else if(loc==='warehouse')warehouse-=q;
      }else if(action==='OUT'||action==='BORROW'){
        if(loc==='fridge')fridge+=q;
        else if(loc==='warehouse')warehouse+=q;
      }else if(action==='TRANSFER'){
        if(note.includes('仓库 → 冰箱')){fridge-=q;warehouse+=q;}
        else if(note.includes('冰箱 → 仓库')){fridge+=q;warehouse-=q;}
      }else if(action==='ADJUST'){
        const p=parseAdjust(note);
        if(p?.location==='fridge')fridge=p.before;
        else if(p?.location==='warehouse')warehouse=p.before;
      }else if(action==='EDIT'){
        const p=parseEdit(note);
        if(p){fridge=p.fridge;warehouse=p.warehouse;}
      }else if(action==='CREATE'){
        fridge=0;warehouse=0;exists=false;
      }
    }

    // 有 cutoff 当天或更早的 CREATE，就表示当月底已经存在。
    const hadCreate=allInventoryLogs.some(r=>String(r.item_id||'')===String(item.id)&&String(r.action||'')==='CREATE'&&dateOf(r)<=cutoff);
    const futureCreate=allInventoryLogs.some(r=>String(r.item_id||'')===String(item.id)&&String(r.action||'')==='CREATE'&&dateOf(r)>cutoff);
    if(futureCreate&&!hadCreate)exists=false;

    return {exists,fridge:clean(fridge),warehouse:clean(warehouse)};
  }

  function availableMonths(){
    const firstCompleteMonth='2026-09';
    const months=new Set();
    const prev=previousMonth();
    if(prev>=firstCompleteMonth)months.add(prev);
    allInventoryLogs.forEach(r=>{
      const m=String(dateOf(r)||'').slice(0,7);
      if(/^\d{4}-\d{2}$/.test(m)&&m>=firstCompleteMonth&&m<currentMonth())months.add(m);
    });
    return [...months].sort((a,b)=>b.localeCompare(a));
  }

  function populateMonths(){
    const sel=document.getElementById('stocktakeMonth');if(!sel)return;
    const list=availableMonths();
    if(!selectedMonth||!list.includes(selectedMonth))selectedMonth=list[0]||previousMonth();
    sel.innerHTML=list.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    sel.value=selectedMonth;
  }

  async function ensureMonthSnapshot(){
    const cutoff=monthEnd(selectedMonth);
    const existingRes=await retry(()=>sb.from('monthly_stocktake_records').select('*').eq('month_key',selectedMonth));
    const existing=existingRes.data||[];
    const existingIds=new Set(existing.map(r=>String(r.item_id)));

    const missing=[];
    for(const item of items){
      if(existingIds.has(String(item.id)))continue;
      const snap=snapshotForItem(item,cutoff);
      if(!snap.exists)continue;
      missing.push({
        month_key:selectedMonth,
        cutoff_date:cutoff,
        item_id:item.id,
        item_name:item.name||'',
        category:item.category||'',
        spec:item.spec||'',
        unit:item.unit||'',
        system_fridge:snap.fridge,
        system_warehouse:snap.warehouse,
        applied_fridge:snap.fridge,
        applied_warehouse:snap.warehouse,
        created_by:user()
      });
    }

    if(missing.length){
      const {error}=await sb.from('monthly_stocktake_records').upsert(missing,{onConflict:'month_key,item_id',ignoreDuplicates:true});
      if(error)throw error;
    }
  }

  async function fetchMonthRecords(){
    const res=await retry(()=>sb.from('monthly_stocktake_records').select('*').eq('month_key',selectedMonth).order('item_name',{ascending:true}));
    monthRecords=res.data||[];
  }

  async function loadSelectedMonth(){
    const status=document.getElementById('stocktakePageStatus');
    if(status)status.textContent='读取中...';
    try{
      await ensureMonthSnapshot();
      await fetchMonthRecords();
      renderTable();
      renderHistory();
      if(status)status.textContent='已更新';
    }catch(e){
      console.warn('月度盘点读取失败',e);
      if(status)status.textContent='读取失败';
      if(!monthRecords.length){
        const body=document.getElementById('stocktakeBody');
        if(body)body.innerHTML=`<tr><td colspan="9">读取失败：${h(e?.message||e)}</td></tr>`;
      }
    }
  }

  async function refreshPage(){
    if(loading)return;
    loading=true;
    const btn=document.getElementById('stocktakeRefresh');
    const status=document.getElementById('stocktakePageStatus');
    if(btn){btn.disabled=true;btn.textContent='刷新中...';}
    if(status)status.textContent='读取中...';
    try{
      await loadAll();
      allInventoryLogs=await fetchAllInventoryLogs();
      populateMonths();
      await loadSelectedMonth();
    }catch(e){
      console.warn('盘点页面刷新失败',e);
      if(status)status.textContent='刷新失败';
    }finally{
      loading=false;
      if(btn){btn.disabled=false;btn.textContent='刷新';}
    }
  }

  function compareText(a,b){
    return String(a||'').localeCompare(String(b||''),'zh-CN',{numeric:true,sensitivity:'base'});
  }

  function stocktakeSortState(){
    return {
      mode:localStorage.getItem(STOCKTAKE_SORT_KEY)==='category'?'category':'name',
      dir:localStorage.getItem(STOCKTAKE_SORT_DIR_KEY)==='desc'?'desc':'asc'
    };
  }

  function updateStocktakeSortHeaders(){
    const state=stocktakeSortState();
    document.querySelectorAll('#stocktakeAdjust .stocktake-sort-head').forEach(btn=>{
      const active=btn.dataset.sort===state.mode;
      btn.classList.toggle('is-active',active);
      btn.setAttribute('aria-sort',active?(state.dir==='asc'?'ascending':'descending'):'none');
      const arrow=btn.querySelector('.stocktake-sort-arrow');
      if(arrow)arrow.textContent=active?(state.dir==='asc'?'▲':'▼'):'↕';
    });
  }

  function filteredRecords(){
    const kw=(document.getElementById('stocktakeSearch')?.value||'').trim().toLowerCase();
    const {mode,dir}=stocktakeSortState();
    const factor=dir==='desc'?-1:1;
    return monthRecords
      .filter(r=>!kw||[r.item_name,r.category,r.spec,r.unit].join(' ').toLowerCase().includes(kw))
      .sort((a,b)=>{
        let result=0;
        if(mode==='category'){
          result=compareText(a.category,b.category);
          if(result===0)result=compareText(a.item_name,b.item_name);
        }else{
          result=compareText(a.item_name,b.item_name);
        }
        return result*factor;
      });
  }

  function renderTable(){
    const body=document.getElementById('stocktakeBody');if(!body)return;
    updateStocktakeSortHeaders();
    const rows=filteredRecords();

    const total=monthRecords.length;
    const adjustedRows=monthRecords.filter(r=>r.actual_fridge!=null&&r.actual_warehouse!=null);
    const increase=clean(adjustedRows.reduce((s,r)=>{
      const d=recordDiff(r);return s+(d&&d>0?d:0);
    },0));
    const decrease=clean(adjustedRows.reduce((s,r)=>{
      const d=recordDiff(r);return s+(d&&d<0?Math.abs(d):0);
    },0));

    const systemFridgeTotal=clean(monthRecords.reduce((s,r)=>s+num(r.system_fridge),0));
    const systemWarehouseTotal=clean(monthRecords.reduce((s,r)=>s+num(r.system_warehouse),0));
    const systemGrandTotal=clean(systemFridgeTotal+systemWarehouseTotal);

    document.getElementById('stocktakeTotalItems').textContent=total;
    document.getElementById('stocktakeSystemFridgeTotal').textContent=systemFridgeTotal;
    document.getElementById('stocktakeSystemWarehouseTotal').textContent=systemWarehouseTotal;
    document.getElementById('stocktakeSystemGrandTotal').textContent=systemGrandTotal;
    document.getElementById('stocktakeAdjustedItems').textContent=adjustedRows.length;
    document.getElementById('stocktakeIncrease').textContent=increase;
    document.getElementById('stocktakeDecrease').textContent=decrease;
    document.getElementById('stocktakeCount').textContent=`显示 ${rows.length} 项`;
    document.getElementById('stocktakeMonthTitle').textContent=`${monthLabel(selectedMonth)} 月末盘点表`;
    document.getElementById('stocktakeCutoffHint').textContent=`月末记录截止 ${monthEnd(selectedMonth)} 营业结束`;

    body.innerHTML=rows.map(r=>{
      const adjusted=r.actual_fridge!=null&&r.actual_warehouse!=null;
      const sf=clean(r.system_fridge),sw=clean(r.system_warehouse),st=clean(sf+sw);
      const d=recordDiff(r);

      let diff='<span class="stocktake-muted">—</span>';
      let status='<span class="stocktake-muted">—</span>';
      if(adjusted){
        const restored=sameAsSystem(r,r.actual_fridge,r.actual_warehouse);
        if(restored){
          diff='<span class="stocktake-muted">—</span>';
          status='<span class="stocktake-muted">—</span>';
        }else if(Math.abs(d)<0.000001){
          diff='<span class="stocktake-warn">位置调整</span>';
          status='<span class="pill stocktake-status-adjusted">已调整</span>';
        }else{
          diff=`<span class="${d<0?'stocktake-bad':'stocktake-warn'}">${d>0?'+':''}${d}</span>`;
          status='<span class="pill stocktake-status-adjusted">已调整</span>';
        }
      }

      return `<tr data-stocktake-id="${h(r.id)}">
        <td class="stocktake-name-cell" title="${h(r.item_name||'')}"><b>${h(r.item_name||'')}</b><div class="stocktake-sub">${h(r.spec||'')}</div></td>
        <td>${h(r.category||'-')}</td>
        <td>${h(r.unit||'')}</td>
        <td>${sf}</td>
        <td>${sw}</td>
        <td><b>${st}</b></td>
        <td>${diff}</td>
        <td>${status}</td>
        <td><button class="secondary stocktake-adjust-row">${adjusted?'修改调整':'盘点调整'}</button></td>
      </tr>`;
    }).join('')||'<tr><td colspan="9">这个月份没有需要盘点的饮料</td></tr>';

    body.querySelectorAll('tr[data-stocktake-id]').forEach(tr=>{
      tr.querySelector('.stocktake-adjust-row').onclick=()=>openDialog(tr.dataset.stocktakeId);
    });
    requestAnimationFrame(installStocktakeColumnResize);
  }

  function loadStocktakeWidths(){
    try{
      const value=JSON.parse(localStorage.getItem(STOCKTAKE_WIDTHS_KEY)||'[]');
      return Array.isArray(value)?value:[];
    }catch(e){return [];}
  }

  function saveStocktakeWidths(widths){
    try{localStorage.setItem(STOCKTAKE_WIDTHS_KEY,JSON.stringify(widths));}catch(e){}
  }

  function measureStocktakeHeaderMin(th,index){
    if(!th)return 54;
    const cs=getComputedStyle(th);
    const probe=document.createElement('span');
    probe.textContent=String(th.textContent||'').replace(/\s+/g,' ').trim();
    probe.style.cssText=[
      'position:fixed','left:-10000px','top:-10000px','visibility:hidden',
      'display:inline-block','width:max-content','white-space:nowrap',
      'font-family:'+cs.fontFamily,'font-size:'+cs.fontSize,'font-weight:'+cs.fontWeight,
      'letter-spacing:'+cs.letterSpacing,'padding-left:'+cs.paddingLeft,'padding-right:'+cs.paddingRight
    ].join(';');
    document.body.appendChild(probe);
    const width=Math.ceil(probe.getBoundingClientRect().width+16);
    probe.remove();
    return Math.max(index===0?90:54,width);
  }

  function installStocktakeColumnResize(){
    const table=document.querySelector('#stocktakeAdjust .stocktake-table');
    const wrap=document.querySelector('#stocktakeAdjust .stocktake-table-wrap');
    if(!table||!wrap||wrap.offsetWidth===0)return;

    const heads=[...table.querySelectorAll('thead th')];
    if(!heads.length)return;

    let colgroup=table.querySelector('colgroup.stocktake-colgroup');
    if(!colgroup){
      colgroup=document.createElement('colgroup');
      colgroup.className='stocktake-colgroup';
      heads.forEach(()=>colgroup.appendChild(document.createElement('col')));
      table.insertBefore(colgroup,table.firstChild);
    }
    const cols=[...colgroup.children];
    const saved=loadStocktakeWidths();

    // 第一次使用时沿用当前画面的实际宽度；以后读取用户上一次拖好的宽度。
    const currentWidths=heads.map((th,index)=>{
      const min=measureStocktakeHeaderMin(th,index);
      th.dataset.stocktakeMinWidth=String(min);
      const savedWidth=Number(saved[index]);
      const natural=Math.round(th.getBoundingClientRect().width);
      return Math.max(min,Number.isFinite(savedWidth)&&savedWidth>0?savedWidth:(natural||min));
    });

    currentWidths.forEach((width,index)=>cols[index].style.width=width+'px');
    const fitTableWidth=widths=>{
      const total=widths.reduce((s,w)=>s+w,0);
      table.style.width=Math.max(total,Math.floor(wrap.clientWidth))+'px';
    };
    fitTableWidth(currentWidths);
    table.style.minWidth='0';
    table.style.tableLayout='fixed';

    if(!wrap.dataset.stocktakeResizeBound){
      wrap.dataset.stocktakeResizeBound='1';
      window.addEventListener('resize',()=>requestAnimationFrame(installStocktakeColumnResize));
    }

    heads.forEach((th,index)=>{
      if(th.querySelector('.stocktake-col-resizer'))return;
      th.style.position='sticky';

      const handle=document.createElement('span');
      handle.className='stocktake-col-resizer';
      handle.setAttribute('role','separator');
      handle.setAttribute('aria-label','拖动调整列宽');
      th.appendChild(handle);

      handle.addEventListener('pointerdown',e=>{
        if(e.button!==0)return;
        e.preventDefault();
        e.stopPropagation();

        const startX=e.clientX;
        const startWidth=parseFloat(cols[index].style.width)||th.getBoundingClientRect().width;
        const min=Number(th.dataset.stocktakeMinWidth)||54;
        const widths=cols.map(col=>parseFloat(col.style.width)||0);

        handle.classList.add('is-active');
        document.body.classList.add('stocktake-resizing');

        const move=ev=>{
          const next=Math.max(min,Math.round(startWidth+ev.clientX-startX));
          cols[index].style.width=next+'px';
          widths[index]=next;
          fitTableWidth(widths);
        };

        const up=()=>{
          document.removeEventListener('pointermove',move);
          document.removeEventListener('pointerup',up);
          document.removeEventListener('pointercancel',up);
          handle.classList.remove('is-active');
          document.body.classList.remove('stocktake-resizing');
          saveStocktakeWidths(cols.map(col=>Math.round(parseFloat(col.style.width)||0)));
        };

        document.addEventListener('pointermove',move);
        document.addEventListener('pointerup',up);
        document.addEventListener('pointercancel',up);
      });
    });
  }

  function buildDialog(){
    if(document.getElementById('monthlyStocktakeDialog'))return;
    const d=document.createElement('dialog');
    d.id='monthlyStocktakeDialog';
    d.innerHTML=`
      <div class="modal monthly-stocktake-modal">
        <h3>盘点调整</h3>
        <div class="hint monthly-stocktake-warning">只在手写盘点单与系统月末库存不一致时使用。请输入盘点后确认的正确库存。</div>

        <div class="monthly-stocktake-name">
          <small id="monthlyStocktakeMonthLabel"></small>
          <b id="monthlyStocktakeItemName"></b>
        </div>

        <div class="monthly-stocktake-system">
          <div><small>系统冰箱</small><b id="monthlyStocktakeSystemFridge">0</b></div>
          <div><small>系统仓库</small><b id="monthlyStocktakeSystemWarehouse">0</b></div>
          <div><small>系统总库存</small><b id="monthlyStocktakeSystemTotal">0</b></div>
        </div>

        <div class="grid2">
          <label>正确冰箱库存
            <input id="monthlyStocktakeActualFridge" type="number" min="0" step="0.01">
          </label>
          <label>正确仓库库存
            <input id="monthlyStocktakeActualWarehouse" type="number" min="0" step="0.01">
          </label>
          <div class="full monthly-stocktake-diff" id="monthlyStocktakeDiff"></div>
          <label class="full">备注
            <input id="monthlyStocktakeNote" placeholder="例如：月底实盘短少 / 多出">
          </label>
        </div>

        <div class="modalfooter">
          <button id="cancelMonthlyStocktake" class="secondary">取消</button>
          <button id="saveMonthlyStocktake">确认调整</button>
        </div>
      </div>`;
    document.body.appendChild(d);

    document.getElementById('cancelMonthlyStocktake').onclick=()=>d.close();
    document.getElementById('saveMonthlyStocktake').onclick=saveDialog;
    ['monthlyStocktakeActualFridge','monthlyStocktakeActualWarehouse'].forEach(id=>{
      document.getElementById(id).addEventListener('input',updateDialogDiff);
    });
  }

  function openDialog(recordId){
    const r=monthRecords.find(x=>String(x.id)===String(recordId));if(!r)return;
    activeStocktakeId=String(r.id);

    document.getElementById('monthlyStocktakeMonthLabel').textContent=`${monthLabel(selectedMonth)} · 月末系统库存`;
    document.getElementById('monthlyStocktakeItemName').textContent=r.item_name||'';
    document.getElementById('monthlyStocktakeSystemFridge').textContent=clean(r.system_fridge);
    document.getElementById('monthlyStocktakeSystemWarehouse').textContent=clean(r.system_warehouse);
    document.getElementById('monthlyStocktakeSystemTotal').textContent=clean(num(r.system_fridge)+num(r.system_warehouse));

    const adjusted=r.actual_fridge!=null&&r.actual_warehouse!=null;
    document.getElementById('monthlyStocktakeActualFridge').value=adjusted?clean(r.actual_fridge):clean(r.system_fridge);
    document.getElementById('monthlyStocktakeActualWarehouse').value=adjusted?clean(r.actual_warehouse):clean(r.system_warehouse);
    document.getElementById('monthlyStocktakeNote').value=r.note||'';
    updateDialogDiff();

    document.getElementById('monthlyStocktakeDialog').showModal();
    setTimeout(()=>document.getElementById('monthlyStocktakeActualFridge')?.select(),50);
  }

  function updateDialogDiff(){
    const r=monthRecords.find(x=>String(x.id)===String(activeStocktakeId));if(!r)return;
    const f=Number(document.getElementById('monthlyStocktakeActualFridge').value);
    const w=Number(document.getElementById('monthlyStocktakeActualWarehouse').value);
    const box=document.getElementById('monthlyStocktakeDiff');

    if(!Number.isFinite(f)||f<0||!Number.isFinite(w)||w<0){
      box.innerHTML='<span class="stocktake-bad">请输入正确的冰箱与仓库库存。</span>';
      return;
    }

    const sys=clean(num(r.system_fridge)+num(r.system_warehouse));
    const actual=clean(f+w);
    const d=clean(actual-sys);
    const fd=clean(f-num(r.system_fridge));
    const wd=clean(w-num(r.system_warehouse));

    let text='<span class="stocktake-ok">与系统一致，无需调整</span>';
    if(d<0)text=`<span class="stocktake-bad">总库存短缺 ${Math.abs(d)}</span>`;
    else if(d>0)text=`<span class="stocktake-warn">总库存多 ${d}</span>`;

    box.innerHTML=`<b>盘点差异：</b> ${text}<small>冰箱 ${fd>0?'+':''}${fd} · 仓库 ${wd>0?'+':''}${wd}</small>`;
  }

  async function saveDialog(){
    const r=monthRecords.find(x=>String(x.id)===String(activeStocktakeId));if(!r)return;
    const f=Number(document.getElementById('monthlyStocktakeActualFridge').value);
    const w=Number(document.getElementById('monthlyStocktakeActualWarehouse').value);
    const note=(document.getElementById('monthlyStocktakeNote').value||'').trim();

    if(!Number.isFinite(f)||f<0||!Number.isFinite(w)||w<0)return alert('请输入正确的冰箱和仓库库存');

    const sysTotal=clean(num(r.system_fridge)+num(r.system_warehouse));
    const actualTotal=clean(f+w);
    const d=clean(actualTotal-sysTotal);

    const exactRestore=sameAsSystem(r,f,w);
    if(exactRestore&&r.actual_fridge==null&&r.actual_warehouse==null){
      return alert('这项实际库存与系统月末库存一致，不需要做盘点调整。');
    }

    const desc=exactRestore?'还原为系统月末数量，原调整记录会清除':(Math.abs(d)<0.000001?'总数不变，仅调整冰箱 / 仓库位置':(d<0?`短缺 ${Math.abs(d)}`:`多 ${d}`));
    if(!confirm(`${r.item_name}\n${monthLabel(selectedMonth)} 月末系统库存：${sysTotal}\n确认的正确库存：${actualTotal}\n盘点差异：${desc}\n\n确定保存盘点调整吗？`))return;

    const btn=document.getElementById('saveMonthlyStocktake');
    btn.disabled=true;btn.textContent='调整中...';
    try{
      const {error}=await sb.rpc('save_monthly_stocktake_result',{
        p_month_key:selectedMonth,
        p_item:r.item_id,
        p_actual_fridge:f,
        p_actual_warehouse:w,
        p_note:note||`${monthLabel(selectedMonth)} 月底盘点调整`
      });
      if(error)throw error;

      document.getElementById('monthlyStocktakeDialog').close();
      await loadAll();
      allInventoryLogs=await fetchAllInventoryLogs();
      await fetchMonthRecords();
      renderTable();
      renderHistory();
      if(typeof window.refreshMonthlyReconciliation==='function')window.refreshMonthlyReconciliation(true);
    }catch(e){
      alert('盘点调整失败：'+String(e?.message||e));
    }finally{
      btn.disabled=false;btn.textContent='确认调整';
    }
  }

  function parseHistory(r){
    const parts=String(r.note||'').split('｜').map(x=>x.trim());
    let location='';
    if(parts[0]==='冰箱'||parts[0]==='仓库')location=parts.shift();
    parts.splice(parts.indexOf('盘点调整'),parts.includes('盘点调整')?1:0);
    const beforePart=parts.find(x=>/^调整前\s/.test(x))||'';
    const afterPart=parts.find(x=>/^调整后\s/.test(x))||'';
    const bm=beforePart.match(/^调整前\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    const am=afterPart.match(/^调整后\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    const before=bm?num(bm[1]):null,after=am?num(am[1]):num(r.quantity);
    const note=parts.filter(x=>x&&x!=='盘点调整'&&!/^调整前\s/.test(x)&&!/^调整后\s/.test(x)).join('｜');
    return {location,before,after,note,diff:before==null?null:clean(after-before)};
  }

  function renderHistory(){
    const body=document.getElementById('stocktakeHistoryBody');if(!body)return;
    const rows=allInventoryLogs
      .filter(r=>String(r.action||'')==='ADJUST'&&String(dateOf(r)).slice(0,7)===selectedMonth&&String(r.note||'').includes('盘点调整'))
      .sort((a,b)=>String(dateOf(b)).localeCompare(String(dateOf(a)))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
    document.getElementById('stocktakeHistoryCount').textContent=`记录 ${rows.length}`;
    body.innerHTML=rows.map(r=>{
      const p=parseHistory(r);
      const diff=p.diff==null?'—':(p.diff>0?`+${p.diff}`:String(p.diff));
      return `<tr>
        <td>${h(dateOf(r))}</td>
        <td><b>${h(r.item_name||'')}</b></td>
        <td>${h(p.location||'-')}</td>
        <td>${p.before==null?'-':clean(p.before)}</td>
        <td><b>${clean(p.after)}</b></td>
        <td class="${p.diff<0?'stocktake-bad':p.diff>0?'stocktake-warn':'stocktake-ok'}">${h(diff)}</td>
        <td>${h(p.note||'')}</td>
        <td>${h(r.user_email||'')}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="8">这个月份没有库存差异调整</td></tr>';
  }

  function addStyle(){
    if(document.getElementById('monthStocktakeStyle'))return;
    const s=document.createElement('style');
    s.id='monthStocktakeStyle';
    s.textContent=`
#stocktakeAdjust{padding:0 2px 24px}
.stocktake-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:4px 0 14px}
.stocktake-page-head h2{margin:0 0 4px;font-size:22px;color:#102a43}.stocktake-page-head>span{font-size:13px;color:#667085;padding-top:5px}
.stocktake-toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;background:#f8fafc}
.stocktake-toolbar-left{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}.stocktake-toolbar label{font-size:12px;color:#667085;font-weight:700;display:flex;flex-direction:column;gap:6px}
#stocktakeMonth{min-width:180px}.stocktake-toolbar input{min-width:300px;min-height:42px}.stocktake-toolbar select{min-height:42px}
.stocktake-toolbar-actions button{min-height:42px}
.stocktake-info{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;background:#fff8e8;color:#7b5b16;font-size:13px;line-height:1.6}.stocktake-info b{white-space:nowrap}
.stocktake-summary{display:grid;grid-template-columns:repeat(7,minmax(130px,1fr));gap:10px;margin-bottom:12px}.stocktake-summary .card{padding:13px 14px}.stocktake-summary small{display:block;color:#667085}.stocktake-summary b{display:block;margin-top:5px;font-size:24px;color:#173b5e}
.stocktake-card{padding:14px}.stocktake-month-head{align-items:flex-start}.stocktake-card .section-head h3{margin:0;font-size:17px}
.stocktake-table-wrap{position:relative;max-height:62vh;overflow:auto}.stocktake-table{min-width:960px}.stocktake-table thead th{position:sticky;top:0;z-index:3;background:#f8fafc!important;white-space:nowrap;overflow:visible}
.stocktake-table th:nth-child(2),.stocktake-table td:nth-child(2),.stocktake-table th:nth-child(3),.stocktake-table td:nth-child(3),.stocktake-table th:nth-child(n+4),.stocktake-table td:nth-child(n+4){text-align:center}
.stocktake-table th:nth-child(2) .stocktake-sort-head{justify-content:center}
.stocktake-sort-head{display:inline-flex;align-items:center;gap:5px;padding:0;background:none!important;border:0!important;color:#667085!important;font:inherit;font-weight:700;cursor:pointer;white-space:nowrap}
.stocktake-sort-head:hover,.stocktake-sort-head.is-active{color:#173b5e!important}
.stocktake-sort-arrow{font-size:10px;line-height:1;color:#98a2b3}.stocktake-sort-head.is-active .stocktake-sort-arrow{color:#173b5e}
.stocktake-table td{overflow:hidden}.stocktake-name-cell>b{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stocktake-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stocktake-col-resizer{position:absolute;right:-7px;top:0;width:14px;height:100%;z-index:20;cursor:col-resize;touch-action:none;user-select:none}
.stocktake-col-resizer::after{content:"";position:absolute;left:6px;top:18%;width:2px;height:64%;border-radius:2px;background:#d7dde5;opacity:.35}
.stocktake-col-resizer:hover::after,.stocktake-col-resizer.is-active::after{width:3px;background:#173b5e;opacity:.8}
body.stocktake-resizing,body.stocktake-resizing *{cursor:col-resize!important;user-select:none!important}
.stocktake-adjust-row{padding:6px 10px;font-size:12px;white-space:nowrap}
.monthly-stocktake-modal{width:min(620px,100%)}
.monthly-stocktake-warning{padding:10px 12px;margin:-2px 0 14px;background:#fff8e8;border:1px solid #f4dfae;border-radius:10px;line-height:1.55;color:#7b5b16}
.monthly-stocktake-name{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}.monthly-stocktake-name small{color:#667085}.monthly-stocktake-name b{font-size:18px;color:#102a43}
.monthly-stocktake-system{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}.monthly-stocktake-system>div{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#f8fafc;text-align:center}.monthly-stocktake-system small{display:block;color:#667085;margin-bottom:5px}.monthly-stocktake-system b{font-size:20px;color:#173b5e}
.monthly-stocktake-diff{padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e5e7eb;line-height:1.5}.monthly-stocktake-diff small{display:block;margin-top:4px;color:#667085}
.stocktake-ok{color:#087f5b;font-weight:700}.stocktake-bad{color:#c92a2a;font-weight:700}.stocktake-warn{color:#b7791f;font-weight:700}.stocktake-muted{color:#98a2b3}
.stocktake-status-pending{color:#667085}.stocktake-status-ok{background:#edf9f4!important;color:#087f5b!important}.stocktake-status-adjusted{background:#fff4df!important;color:#9a6a1f!important}
.stocktake-history-card{margin-top:12px}.stocktake-history-wrap{max-height:42vh;overflow:auto}.stocktake-history-table{min-width:980px}.stocktake-history-table thead th{position:sticky;top:0;z-index:3;background:#f8fafc!important}
@media(max-width:1250px){.stocktake-summary{grid-template-columns:repeat(4,minmax(150px,1fr))}}
@media(max-width:900px){.stocktake-summary{grid-template-columns:repeat(2,1fr)}.stocktake-toolbar{align-items:stretch;flex-direction:column}.stocktake-toolbar-left{width:100%}.stocktake-toolbar-left label{flex:1}.stocktake-toolbar input,#stocktakeMonth{width:100%;min-width:0}}
@media(max-width:620px){.stocktake-info{display:block}.stocktake-info b{display:block;margin-bottom:4px}.monthly-stocktake-system{grid-template-columns:1fr 1fr}.monthly-stocktake-system>div:last-child{grid-column:1/-1}}
`;
    document.head.appendChild(s);
  }

  window.refreshStocktakeAdjust=refreshPage;
  wait();
})();