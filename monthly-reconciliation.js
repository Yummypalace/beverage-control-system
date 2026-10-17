// 月结核对：按实际库存减少与 POS + 特殊用途逐项对照。
// POS 销量为独立数据源，只用于月结对账，不会修改库存。
(function(){
  'use strict';

  let installed=false;
  let allLogs=[];
  let posRows=[];
  let entActualRows=[];
  let loading=false;
  let selectedMonth='';
  let reconSortKey='name';
  let reconSortDir=1;
  const posSaveTimers=new Map();
  const pendingPosSaves=new Map();
  const entSaveTimers=new Map();

  function h(v=''){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
  function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0;}
  function clean(v){return Number(num(v).toFixed(2));}
  function currentMonth(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'}).slice(0,7);}
  function monthOf(r){const d=r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});return String(d||'').slice(0,7);}
  function dateOf(r){return r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function monthLabel(v){const [y,m]=String(v||'').split('-');return y&&m?`${y}年${Number(m)}月`:'';}
  function monthEnd(month){const [y,m]=String(month||'').split('-').map(Number);if(!y||!m)return '';return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);}
  function previousMonth(month){const [y,m]=String(month||'').split('-').map(Number);if(!y||!m)return '';return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);}
  function previousMonthEnd(month){return monthEnd(previousMonth(month));}
  function reverseLogSort(a,b){const da=dateOf(a),db=dateOf(b);if(da!==db)return db.localeCompare(da);const ca=String(a.created_at||''),cb=String(b.created_at||'');if(ca!==cb)return cb.localeCompare(ca);return Number(b.id||0)-Number(a.id||0);}

  function detectOutType(r){
    if(r.out_type)return String(r.out_type);
    const raw=String(r.note||'');
    const s=raw.toLowerCase().replace(/\s+/g,' ');
    if(raw.includes('取消入库'))return 'CANCEL_IN';
    if(/(^|[^a-z])foc([^a-z]|$)/i.test(raw)||s.includes('complimentary')||raw.includes('免费'))return 'FOC';
    if(raw.includes('厨房')||s.includes('kitchen'))return 'KITCHEN';
    if(s.includes('no paid')||s.includes('not paid')||s.includes('unpaid')||raw.includes('没paid')||raw.includes('没 paid')||raw.includes('未付款')||raw.includes('没付款'))return 'NO_PAID';
    if(/(^|[^a-z])ent([\s\-_/]|$)/i.test(raw)||s.includes('entertain')||raw.includes('招待'))return 'ENT';
    if(raw.includes('员工')||s.includes('staff'))return 'FOC';
    if(raw.includes('签单')||raw.includes('挂账'))return 'NO_PAID';
    return 'NORMAL';
  }

  function parseEdit(note){
    const s=String(note||'');
    const before=s.match(/调整前\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    let after=s.match(/调整后\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    if(!after)after=s.match(/编辑资料（冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)）/);
    return {before:before?num(before[1])+num(before[2]):null,after:after?num(after[1])+num(after[2]):null};
  }
  function parseAdjust(note){
    const s=String(note||'');
    const before=s.match(/调整前\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    const after=s.match(/调整后\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return {before:before?num(before[1]):null,after:after?num(after[1]):null};
  }
  function parseCreateTotal(note,fallback){
    const s=String(note||'');
    const m=s.match(/冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return m?num(m[1])+num(m[2]):num(fallback);
  }

  function forwardCreatedSort(a,b){
    const ca=String(a.created_at||''),cb=String(b.created_at||'');
    if(ca!==cb)return ca.localeCompare(cb);
    return Number(a.id||0)-Number(b.id||0);
  }

  const RECON_WIDTHS_KEY='monthlyReconColumnWidthsV4';
  const RECON_DEFAULT_WIDTHS=[250,90,76,76,76,92,112,66,104,86,66,86,82,86,66,66,66,96,78];

  function loadReconColumnWidths(){
    try{return JSON.parse(localStorage.getItem(RECON_WIDTHS_KEY)||'{}')||{};}catch(e){return {};}
  }

  function saveReconColumnWidths(widths){
    try{localStorage.setItem(RECON_WIDTHS_KEY,JSON.stringify(widths));}catch(e){}
  }

  function installReconColumnResize(){
    const table=document.querySelector('#monthlyReconciliation .recon-table');
    if(!table)return;
    const heads=[...table.querySelectorAll('thead th')];
    const saved=loadReconColumnWidths();

    heads.forEach((th,index)=>{
      th.style.position='sticky';
      th.dataset.colIndex=String(index);
      const savedWidth=Number(saved[index]);
      const defaultWidth=Number(RECON_DEFAULT_WIDTHS[index]||80);
      const width=(Number.isFinite(savedWidth)&&savedWidth>=60)?savedWidth:defaultWidth;
      th.style.width=width+'px';
      th.style.minWidth=width+'px';
      th.style.maxWidth=width+'px';

      if(th.querySelector('.recon-col-resizer'))return;
      const handle=document.createElement('span');
      handle.className='recon-col-resizer';
      handle.title='拖动调整列宽';
      th.appendChild(handle);

      handle.addEventListener('mousedown',e=>{
        e.preventDefault();
        e.stopPropagation();
        const startX=e.clientX;
        const startWidth=th.getBoundingClientRect().width;
        document.body.classList.add('recon-resizing');

        const move=ev=>{
          const width=Math.max(60,Math.round(startWidth+ev.clientX-startX));
          th.style.width=width+'px';
          th.style.minWidth=width+'px';
          th.style.maxWidth=width+'px';
        };

        const up=()=>{
          document.removeEventListener('mousemove',move);
          document.removeEventListener('mouseup',up);
          document.body.classList.remove('recon-resizing');
          const widths=loadReconColumnWidths();
          widths[index]=Math.round(th.getBoundingClientRect().width);
          saveReconColumnWidths(widths);
        };

        document.addEventListener('mousemove',move);
        document.addEventListener('mouseup',up);
      });
    });
  }

  function wait(){
    if(typeof sb==='undefined'||typeof showPage!=='function'||typeof items==='undefined'||!document.querySelector('.side-nav')||!document.querySelector('.content-area')){
      setTimeout(wait,150);return;
    }
    install();
  }

  function install(){
    if(installed)return;installed=true;
    buildPage();
    extendNavigation();
    addStyle();
    installReconColumnResize();
    selectedMonth=currentMonth();
    loadData();
  }

  function buildPage(){
    const content=document.querySelector('.content-area');
    if(!content||document.getElementById('monthlyReconciliation'))return;
    const section=document.createElement('div');
    section.id='monthlyReconciliation';
    section.className='panel-anchor';
    section.style.display='none';
    section.innerHTML=`
      <div class="recon-head">
        <div>
          <h2>月结核对</h2>
          <div class="hint">用库存实际减少量，对照 POS 销量及 ENT、FOC、厨房使用、NO Paid 等特殊出库。</div>
        </div>
        <span id="reconStatus"></span>
      </div>

      <div class="card recon-controls">
        <div class="recon-control-left">
          <label>月份<select id="reconMonth"></select></label>
          <label class="recon-search-label">搜索产品<input id="reconSearch" placeholder="输入名称或类别"></label>
        </div>
        <div class="recon-control-actions">
          <button id="reconReload" class="secondary">重新计算</button>
          <button id="reconExportExcel" class="secondary">导出 Excel</button>
          <button id="reconClearPos" class="secondary">清除</button>
          <button id="reconSavePos">保存 POS 销量</button>
          <span id="reconAutoSaveStatus" class="recon-autosave-status">POS 自动保存</span>
        </div>
      </div>

      <div class="recon-summary">
        <div class="card"><small>上月结存总数</small><b id="reconOpeningTotal">0</b></div>
        <div class="card"><small>本月结存总数</small><b id="reconClosingTotal">0</b></div>
        <div class="card"><small>本月实际减少</small><b id="reconSoldTotal">0</b></div>
        <div class="card"><small>POS 销量</small><b id="reconPosTotal">0</b></div>
        <div class="card"><small>特殊用途 / 借出净额</small><b id="reconSpecialTotal">0</b></div>
        <div class="card"><small>待查差异</small><b id="reconIssueTotal">0</b></div>
      </div>

      <div class="card recon-guide">
        <b>核对公式：</b>
        <span>上月结存 + 本月入库 − 本月结存 = 本月实际减少；本月实际减少 = POS 销量 + FOC + 厨房使用 + NO Paid + 取消入库 + 其他 + 借出 − 还回。ENT 已包含在 POS 销量内，仅作分类参考。</span>
      </div>

      <div class="card recon-card">
        <div class="section-head recon-table-head">
          <h3>库存 / POS 月结对照</h3>
          <div id="reconMonthTitle" class="recon-month-title"></div>
          <span id="reconInventoryDateHint" class="hint"></span>
        </div>
        <div class="tablewrap recon-table-wrap">
          <table class="recon-table">
            <thead><tr>
              <th><button type="button" class="recon-sort-btn" data-sort="name">名称 <span class="recon-sort-arrow">▲</span></button></th>
              <th><button type="button" class="recon-sort-btn" data-sort="category">类别 <span class="recon-sort-arrow">↕</span></button></th>
              <th>上月结存</th>
              <th>本月结存</th>
              <th>本月入库</th>
              <th>本月实际减少</th>
              <th>POS 销量</th>
              <th class="recon-ent-head" title="员工出库时标注的 ENT 记录；已包含在 POS 销量内，不参与库存对账">ENT</th>
              <th class="recon-ent-head" title="月底确认后的真实 ENT 数量；只用于核对员工分类，不影响库存">ENT (实际)</th>
              <th class="recon-ent-head" title="ENT 实际 − ENT 系统；只用于检查漏标或错标，不影响库存">ENT 差异</th>
              <th>FOC</th>
              <th>厨房使用</th>
              <th>NO Paid</th>
              <th>取消入库</th>
              <th>借出</th>
              <th>还回</th>
              <th>其他</th>
              <th>对账差异</th>
              <th>状态</th>
            </tr></thead>
            <tbody id="reconInventoryBody"><tr><td colspan="19">读取中...</td></tr></tbody>
          </table>
        </div>
      </div>`;
    content.appendChild(section);

    document.getElementById('reconMonth').onchange=()=>{
      selectedMonth=document.getElementById('reconMonth').value||currentMonth();
      render();
    };
    document.getElementById('reconSearch').oninput=()=>render(true);
    document.getElementById('reconReload').onclick=()=>loadData(true);
    document.getElementById('reconExportExcel').onclick=exportMonthlyReconExcel;
    document.getElementById('reconClearPos').onclick=clearPos;
    document.getElementById('reconSavePos').onclick=savePos;
    document.querySelectorAll('#monthlyReconciliation .recon-sort-btn').forEach(btn=>{
      btn.onclick=()=>{
        const key=btn.dataset.sort;
        if(reconSortKey===key)reconSortDir*=-1;
        else{reconSortKey=key;reconSortDir=1;}
        updateSortArrows();
        render(true);
      };
    });
    updateSortArrows();
  }

  function extendNavigation(){
    const nav=document.querySelector('.side-nav');if(!nav)return;
    let a=nav.querySelector('a[href="#monthlyReconciliation"]');
    if(!a){
      a=document.createElement('a');a.href='#monthlyReconciliation';
      a.innerHTML='<span class="side-icon">≋</span><span class="side-label">月结核对</span>';
      const settings=nav.querySelector('a[href="#settings"]');nav.insertBefore(a,settings||null);
    }
    a.onclick=e=>{e.preventDefault();showPage('monthlyReconciliation');};

    const oldShowPage=showPage;
    showPage=function(page){
      const own=document.getElementById('monthlyReconciliation');
      if(page==='monthlyReconciliation'){
        ['dashboard','inventory','commission','logs','settings','corrections','outNotes'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
        if(own)own.style.display='block';
        document.querySelectorAll('.side-nav a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#monthlyReconciliation'));
        window.scrollTo({top:0,behavior:'smooth'});loadData();return;
      }
      if(own)own.style.display='none';
      oldShowPage(page);
    };
    document.querySelectorAll('.side-nav a').forEach(link=>{link.onclick=e=>{e.preventDefault();showPage(link.getAttribute('href').slice(1));};});
  }

  async function fetchAll(table,configure){
    const all=[];let from=0;const size=1000;
    while(true){
      let q=sb.from(table).select('*');q=configure(q);q=q.range(from,from+size-1);
      const {data,error}=await q;if(error)throw error;
      const page=data||[];all.push(...page);if(page.length<size)break;from+=size;
    }
    return all;
  }

  async function recalculateFresh(){
    if(loading)return;
    loading=true;
    const status=document.getElementById('reconStatus');
    const body=document.getElementById('reconInventoryBody');
    if(body)body.innerHTML='<tr><td colspan="19">重新计算中...</td></tr>';
    if(status)status.textContent='重新计算中...';
    try{
      const [logs,pos,entActual]=await Promise.all([
        fetchAll('inventory_logs',q=>q.order('operation_date',{ascending:true}).order('created_at',{ascending:true})),
        fetchAll('monthly_pos_sales',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_ent_actual',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true}))
      ]);
      allLogs=logs;
      posRows=pos;
      entActualRows=entActual;
      populateMonths();
      const blankDraft={};
      items.forEach(item=>blankDraft[item.id]='');
      render(false,blankDraft);
      if(status)status.textContent='已重新计算';
    }catch(e){
      if(body)body.innerHTML=`<tr><td colspan="19">重新计算失败：${h(e.message||e)}</td></tr>`;
      if(status)status.textContent='重新计算失败';
    }finally{loading=false;}
  }

  async function loadData(preservePos=false){
    if(loading)return;
    const draft=preservePos?draftFromInputs():null;
    loading=true;
    const status=document.getElementById('reconStatus');
    const body=document.getElementById('reconInventoryBody');
    if(body)body.innerHTML='<tr><td colspan="19">读取中...</td></tr>';
    if(status)status.textContent='读取中...';
    try{
      const [logs,pos,entActual]=await Promise.all([
        fetchAll('inventory_logs',q=>q.order('operation_date',{ascending:true}).order('created_at',{ascending:true})),
        fetchAll('monthly_pos_sales',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_ent_actual',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true}))
      ]);
      allLogs=logs;posRows=pos;entActualRows=entActual;populateMonths();render(false,draft);
      if(status)status.textContent='已更新';
    }catch(e){
      if(body)body.innerHTML=`<tr><td colspan="19">读取失败：${h(e.message||e)}</td></tr>`;
      if(status)status.textContent='读取失败';
    }finally{loading=false;}
  }

  function populateMonths(){
    const select=document.getElementById('reconMonth');if(!select)return;
    const months=new Set([currentMonth()]);
    allLogs.forEach(r=>{const m=monthOf(r);if(/^\d{4}-\d{2}$/.test(m)&&m>='2026-09')months.add(m);});
    posRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||'')&&r.month_key>='2026-09')months.add(r.month_key);});
    entActualRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||'')&&r.month_key>='2026-09')months.add(r.month_key);});
    const list=[...months].sort((a,b)=>b.localeCompare(a));
    if(!selectedMonth||!months.has(selectedMonth))selectedMonth=currentMonth();
    select.innerHTML=list.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    select.value=selectedMonth;
  }

  function snapshotAt(cutoff){
    const states=new Map();
    const logsByItem=new Map();

    allLogs.forEach(r=>{
      const key=String(r.item_id||'');
      if(!logsByItem.has(key))logsByItem.set(key,[]);
      logsByItem.get(key).push(r);
    });

    items.forEach(item=>{
      const key=String(item.id);
      const logs=logsByItem.get(key)||[];
      const eligible=logs.filter(r=>dateOf(r)<=cutoff);

      const anchors=eligible
        .filter(r=>{
          const action=String(r.action||'');
          if(action==='CREATE')return true;
          if(action==='EDIT')return parseEdit(r.note).after!==null;
          return false;
        })
        .sort(forwardCreatedSort);

      if(anchors.length){
        const base=anchors[0];
        const baseAction=String(base.action||'');
        const baseEdit=baseAction==='EDIT'?parseEdit(base.note):null;
        const anchor=String(base.created_at||'');
        const state={
          total:baseAction==='CREATE'?parseCreateTotal(base.note,base.quantity):num(baseEdit.after),
          exists:true,
          uncertain:false
        };

        eligible
          .filter(r=>r!==base&&String(r.created_at||'')>=anchor)
          .sort(forwardCreatedSort)
          .forEach(r=>{
            const q=num(r.quantity);
            const action=String(r.action||'');
            const note=String(r.note||'');

            if(action==='CREATE')return;
            if(action==='IN'||action==='RETURN')state.total+=q;
            else if(action==='OUT'||action==='BORROW')state.total-=q;
            else if(action==='TRANSFER')return;
            else if(action==='EDIT'){
              const p=parseEdit(note);
              if(p.after!==null)state.total=p.after;
              else state.uncertain=true;
            }else if(action==='ADJUST'){
              const p=parseAdjust(note);
              if(p.before!==null&&p.after!==null)state.total+=p.after-p.before;
              else state.uncertain=true;
            }
          });

        states.set(key,state);
        return;
      }

      // 如果产品是在截点之后才建立，则截点当时本来就不存在，不属于“需核对旧记录”。
      const futureCreate=logs
        .filter(r=>String(r.action||'')==='CREATE'&&dateOf(r)>cutoff)
        .sort((a,b)=>dateOf(a).localeCompare(dateOf(b))||forwardCreatedSort(a,b))[0];
      if(futureCreate){
        states.set(key,{total:0,exists:false,uncertain:false});
        return;
      }

      // 没有可用 CREATE / EDIT 基准的真正旧品项，才使用当前库存倒推作为兼容兜底。
      const state={total:num(item.fridge_quantity)+num(item.warehouse_quantity),exists:true,uncertain:true};
      logs.filter(r=>dateOf(r)>cutoff).sort(reverseLogSort).forEach(r=>{
        const q=num(r.quantity),action=String(r.action||''),note=String(r.note||'');
        if(action==='IN'||action==='RETURN')state.total-=q;
        else if(action==='OUT'||action==='BORROW')state.total+=q;
        else if(action==='CREATE'){state.total=0;state.exists=false;}
        else if(action==='EDIT'){
          const p=parseEdit(note);if(p.before!==null)state.total=p.before;
        }else if(action==='ADJUST'){
          const p=parseAdjust(note);
          if(p.before!==null&&p.after!==null)state.total-=p.after-p.before;
        }
      });
      states.set(key,state);
    });

    return states;
  }

  function monthStats(){
    const map=new Map();
    function ensure(id){
      const key=String(id||'');
      if(!map.has(key))map.set(key,{inbound:0,ent:0,foc:0,kitchen:0,noPaid:0,cancelIn:0,borrow:0,returned:0,other:0});
      return map.get(key);
    }
    allLogs.forEach(r=>{
      if(monthOf(r)!==selectedMonth||!r.item_id)return;
      const s=ensure(r.item_id);
      const action=String(r.action||''),q=num(r.quantity);

      if(r.correction_ref)return;

      if(action==='IN'){s.inbound+=q;return;}
      if(action==='BORROW'){s.borrow+=q;return;}
      if(action==='RETURN'){s.returned+=q;return;}
      if(action!=='OUT')return;

      const type=detectOutType(r);
      if(type==='ENT')s.ent+=q;
      else if(type==='FOC')s.foc+=q;
      else if(type==='KITCHEN')s.kitchen+=q;
      else if(type==='NO_PAID'||type==='CREDIT')s.noPaid+=q;
      else if(type==='CANCEL_IN')s.cancelIn+=q;
      else if(type==='OTHER'||type==='STAFF')s.other+=q;
    });
    return map;
  }

  function posMap(){
    const map=new Map();
    posRows.forEach(r=>map.set(`${r.item_id}|${r.month_key}`,r));
    return map;
  }

  function draftFromInputs(){
    const draft={};
    document.querySelectorAll('#reconInventoryBody .recon-pos-input[data-item-id]').forEach(i=>draft[i.dataset.itemId]=i.value);
    return draft;
  }

  function updateSortArrows(){
    document.querySelectorAll('#monthlyReconciliation .recon-sort-btn').forEach(btn=>{
      const arrow=btn.querySelector('.recon-sort-arrow');
      if(!arrow)return;
      arrow.textContent=btn.dataset.sort===reconSortKey?(reconSortDir===1?'▲':'▼'):'↕';
    });
  }

  function computeRows(draftPos){
    const open=snapshotAt(previousMonthEnd(selectedMonth));
    const close=snapshotAt(monthEnd(selectedMonth));
    const stats=monthStats();
    const pmap=posMap();

    const rows=[...items].map(item=>{
      const s=stats.get(String(item.id))||{inbound:0,ent:0,foc:0,kitchen:0,noPaid:0,cancelIn:0,borrow:0,returned:0,other:0};
      const openState=open.get(String(item.id));
      const closeState=close.get(String(item.id));
      const opening=openState&&openState.exists?num(openState.total):0;
      const closing=selectedMonth===currentMonth()
        ? num(item.fridge_quantity)+num(item.warehouse_quantity)
        : (closeState&&closeState.exists?num(closeState.total):0);
      const sold=opening+s.inbound-closing;

      let posValue=null;
      if(draftPos&&Object.prototype.hasOwnProperty.call(draftPos,item.id)){
        const raw=draftPos[item.id];posValue=raw===''?null:num(raw);
      }else{
        const saved=pmap.get(`${item.id}|${selectedMonth}`)
          || posRows.find(r=>r.month_key===selectedMonth&&String(r.item_name||'')===String(item.name||''));
        const monthHasSavedPos=posRows.some(r=>r.month_key===selectedMonth);
        posValue=saved?num(saved.pos_quantity):(monthHasSavedPos?0:null);
      }

      const entSaved=entActualRows.find(r=>r.month_key===selectedMonth&&String(r.item_id)===String(item.id))
        || entActualRows.find(r=>r.month_key===selectedMonth&&String(r.item_name||'')===String(item.name||''));
      const entActualValue=entSaved?num(entSaved.ent_actual):0;
      const entDiff=clean(entActualValue-s.ent);

      const explained=posValue===null?null:posValue+s.foc+s.kitchen+s.noPaid+s.cancelIn+s.other+s.borrow-s.returned;
      const diff=explained===null?null:explained-sold;
      const uncertain=!!(openState?.uncertain||closeState?.uncertain);
      return {item,...s,opening,closing,sold,posValue,entActualValue,entDiff,explained,diff,uncertain};
    });

    rows.sort((a,b)=>{
      const av=reconSortKey==='category'?String(a.item.category||''):String(a.item.name||'');
      const bv=reconSortKey==='category'?String(b.item.category||''):String(b.item.name||'');
      const primary=av.localeCompare(bv,'zh-CN',{numeric:true,sensitivity:'base'});
      if(primary!==0)return primary*reconSortDir;
      return String(a.item.name||'').localeCompare(String(b.item.name||''),'zh-CN',{numeric:true,sensitivity:'base'});
    });
    return rows;
  }

  function diffText(v,uncertain){
    if(uncertain)return '<span class="recon-muted">需核对旧记录</span>';
    if(v===null||v===undefined)return '<span class="recon-muted">待录入 POS</span>';
    const n=clean(v);
    if(Math.abs(n)<0.000001)return '<span class="recon-ok">0</span>';
    const signed=n>0?'+'+n:String(n);
    return `<span class="${n>0?'recon-bad':'recon-warn'}">${signed}</span>`;
  }

  function statusText(r){
    if(r.uncertain)return '<span class="recon-muted">CHECK</span>';
    if(r.diff===null)return '<span class="recon-muted">待填 POS</span>';
    return Math.abs(num(r.diff))<0.000001?'<span class="recon-ok">OK</span>':'<span class="recon-bad">CHECK</span>';
  }

  function render(preserveInputs=false,forcedDraft=null){
    const body=document.getElementById('reconInventoryBody');if(!body)return;
    const draft=forcedDraft||(preserveInputs?draftFromInputs():null);
    const allRows=computeRows(draft);
    let rows=allRows;
    const keyword=(document.getElementById('reconSearch')?.value||'').trim().toLowerCase();
    if(keyword){
      rows=rows.filter(r=>[r.item.name,r.item.category,r.item.spec,r.item.unit].join(' ').toLowerCase().includes(keyword));
    }
    const isCurrent=selectedMonth===currentMonth();

    if(isCurrent){
      body.innerHTML=rows.map(r=>`<tr>
        <td><b>${h(r.item.name)}</b><div class="recon-sub">${h(r.item.unit||'')}</div></td>
        <td>${h(r.item.category||'-')}</td>
        <td>${clean(r.opening)}</td>
        <td>-</td><td>-</td><td>-</td><td>-</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
      </tr>`).join('')||'<tr><td colspan="19">暂无饮料资料</td></tr>';

      const hint=document.getElementById('reconInventoryDateHint');
      if(hint)hint.textContent='本月尚未结束，仅显示上月结存';
      const monthTitle=document.getElementById('reconMonthTitle');
      if(monthTitle)monthTitle.textContent=monthLabel(selectedMonth);

      const openingTotal=clean(allRows.reduce((s,r)=>s+r.opening,0));
      const openingEl=document.getElementById('reconOpeningTotal');if(openingEl)openingEl.textContent=openingTotal;
      ['reconClosingTotal','reconSoldTotal','reconPosTotal','reconSpecialTotal','reconIssueTotal'].forEach(id=>{
        const el=document.getElementById(id);if(el)el.textContent='-';
      });
      return;
    }

    body.innerHTML=rows.map(r=>{
      const input=r.posValue===null?'':clean(r.posValue);
      const alert=!r.uncertain&&r.diff!==null&&Math.abs(r.diff)>0.000001;
      return `<tr class="${alert?'recon-alert-row':''}">
        <td><b>${h(r.item.name)}</b><div class="recon-sub">${h(r.item.unit||'')}</div></td>
        <td>${h(r.item.category||'-')}</td>
        <td>${clean(r.opening)}</td>
        <td>${clean(r.closing)}</td>
        <td>${clean(r.inbound)}</td>
        <td><b>${clean(r.sold)}</b></td>
        <td><input class="recon-pos-input" data-item-id="${h(r.item.id)}" type="number" min="0" step="0.01" value="${h(input)}" placeholder="未录入"></td>
        <td class="recon-ent-col">${clean(r.ent)}</td>
        <td class="recon-ent-col"><input class="recon-ent-actual-input" data-item-id="${h(r.item.id)}" data-system-ent="${h(clean(r.ent))}" type="number" min="0" step="0.01" value="${h(clean(r.entActualValue))}"></td>
        <td class="recon-ent-col recon-ent-diff" data-ent-diff-for="${h(r.item.id)}">${Math.abs(r.entDiff)<0.000001?'<span class="recon-ok">0</span>':`<span class="${r.entDiff>0?'recon-bad':'recon-warn'}">${r.entDiff>0?'+':''}${r.entDiff}</span>`}</td>
        <td>${clean(r.foc)}</td>
        <td>${clean(r.kitchen)}</td>
        <td>${clean(r.noPaid)}</td>
        <td>${clean(r.cancelIn)}</td>
        <td>${clean(r.borrow)}</td>
        <td>${clean(r.returned)}</td>
        <td>${clean(r.other)}</td>
        <td>${diffText(r.diff,r.uncertain)}</td>
        <td>${statusText(r)}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="19">暂无饮料资料</td></tr>';

    document.querySelectorAll('#reconInventoryBody .recon-pos-input').forEach(input=>{
      input.addEventListener('input',()=>{
        schedulePosAutoSave(input);
        render(true);
      });
      input.addEventListener('change',()=>schedulePosAutoSave(input,true));
      input.addEventListener('blur',()=>schedulePosAutoSave(input,true));
    });

    document.querySelectorAll('#reconInventoryBody .recon-ent-actual-input').forEach(input=>{
      input.addEventListener('input',()=>{
        updateEntDiffCell(input);
        scheduleEntAutoSave(input);
      });
      input.addEventListener('change',()=>scheduleEntAutoSave(input,true));
      input.addEventListener('blur',()=>scheduleEntAutoSave(input,true));
    });

    const hint=document.getElementById('reconInventoryDateHint');
    if(hint)hint.textContent=isCurrent?'本月结存使用当前库存（本月尚未结束）':`本月结存还原至 ${monthEnd(selectedMonth)} 营业结束`;
    const monthTitle=document.getElementById('reconMonthTitle');
    if(monthTitle)monthTitle.textContent=monthLabel(selectedMonth);

    // 顶部汇总始终显示所选月份的全部产品总数，不受搜索或排序影响。
    updateSummary(allRows);
  }

  function updateSummary(rows){
    const opening=clean(rows.reduce((s,r)=>s+r.opening,0));
    const closing=clean(rows.reduce((s,r)=>s+r.closing,0));
    const sold=clean(rows.reduce((s,r)=>s+r.sold,0));
    const pos=clean(rows.reduce((s,r)=>s+(r.posValue===null?0:r.posValue),0));
    const special=clean(rows.reduce((s,r)=>s+r.foc+r.kitchen+r.noPaid+r.cancelIn+r.other+r.borrow-r.returned,0));
    const issue=clean(rows.reduce((s,r)=>s+(r.uncertain||r.diff===null?0:Math.abs(num(r.diff))),0));
    document.getElementById('reconOpeningTotal').textContent=opening;
    document.getElementById('reconClosingTotal').textContent=closing;
    document.getElementById('reconSoldTotal').textContent=sold;
    document.getElementById('reconPosTotal').textContent=pos;
    document.getElementById('reconSpecialTotal').textContent=special;
    document.getElementById('reconIssueTotal').textContent=issue;
  }

  function updateEntDiffCell(input){
    const id=String(input.dataset.itemId||'');
    const cell=document.querySelector('[data-ent-diff-for="'+id+'"]');if(!cell)return;
    const raw=String(input.value||'').trim();
    if(raw===''){cell.innerHTML='<span class="recon-muted">—</span>';return;}
    const actual=Number(raw),system=Number(input.dataset.systemEnt||0);
    if(!Number.isFinite(actual)||actual<0){cell.innerHTML='<span class="recon-bad">错误</span>';return;}
    const d=clean(actual-system);
    if(Math.abs(d)<0.000001)cell.innerHTML='<span class="recon-ok">0</span>';
    else cell.innerHTML='<span class="'+(d>0?'recon-bad':'recon-warn')+'">'+(d>0?'+':'')+d+'</span>';
  }

  function scheduleEntAutoSave(input,immediate=false){
    if(!input||!input.dataset.itemId)return;
    const itemId=String(input.dataset.itemId);
    const old=entSaveTimers.get(itemId);if(old)clearTimeout(old);
    const raw=String(input.value||'').trim();
    if(raw==='')return;
    entSaveTimers.set(itemId,setTimeout(()=>saveEntActual(input),immediate?0:600));
  }

  async function saveEntActual(input){
    if(!input||!input.dataset.itemId)return;
    const itemId=String(input.dataset.itemId);
    const item=items.find(x=>String(x.id)===itemId);if(!item)return;
    const raw=String(input.value||'').trim();if(raw==='')return;
    const q=Number(raw);if(!Number.isFinite(q)||q<0)return;
    const monthAtSave=selectedMonth;
    const payload={month_key:monthAtSave,item_id:item.id,item_name:item.name,ent_actual:q,updated_by:typeof userEmail==='function'?userEmail():'',updated_at:new Date().toISOString()};
    const {data,error}=await sb.from('monthly_ent_actual').upsert(payload,{onConflict:'month_key,item_id'}).select().single();
    if(error){console.error('ENT actual auto-save failed',error);return;}
    const idx=entActualRows.findIndex(r=>r.month_key===monthAtSave&&String(r.item_id)===itemId);
    if(idx>=0)entActualRows[idx]=data||payload;else entActualRows.push(data||payload);
    entSaveTimers.delete(itemId);
  }

  function ensureSheetJS(){
    if(window.XLSX)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let s=document.getElementById('sheetJsLib');
      if(!s){
        s=document.createElement('script');
        s.id='sheetJsLib';
        s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        document.head.appendChild(s);
      }
      if(window.XLSX){resolve();return;}
      s.addEventListener('load',()=>resolve(),{once:true});
      s.addEventListener('error',()=>reject(new Error('Excel 模块加载失败')),{once:true});
    });
  }

  function excelStatus(r){
    if(r.uncertain)return '需核对旧记录';
    if(r.diff===null)return '待填 POS';
    return Math.abs(num(r.diff))<0.000001?'OK':'CHECK';
  }

  async function exportMonthlyReconExcel(){
    const btn=document.getElementById('reconExportExcel');
    if(!btn)return;
    const old=btn.textContent;
    btn.disabled=true;btn.textContent='导出中...';
    try{
      await ensureSheetJS();
      const draft=draftFromInputs();
      const rows=computeRows(draft);
      const isCurrent=selectedMonth===currentMonth();

      const data=rows.map(r=>isCurrent?{
        '名称':r.item.name||'',
        '类别':r.item.category||'',
        '上月结存':clean(r.opening),
        '本月结存':'',
        '本月入库':'',
        '本月实际减少':'',
        'POS 销量':'',
        'ENT':'',
        'ENT (实际)':'',
        'ENT 差异':'',
        'FOC':'',
        '厨房使用':'',
        'NO Paid':'',
        '取消入库':'',
        '借出':'',
        '还回':'',
        '其他':'',
        '对账差异':'',
        '状态':'本月尚未结束'
      }:{
        '名称':r.item.name||'',
        '类别':r.item.category||'',
        '上月结存':clean(r.opening),
        '本月结存':clean(r.closing),
        '本月入库':clean(r.inbound),
        '本月实际减少':clean(r.sold),
        'POS 销量':r.posValue===null?'':clean(r.posValue),
        'ENT':clean(r.ent),
        'ENT (实际)':clean(r.entActualValue),
        'ENT 差异':clean(r.entDiff),
        'FOC':clean(r.foc),
        '厨房使用':clean(r.kitchen),
        'NO Paid':clean(r.noPaid),
        '取消入库':clean(r.cancelIn),
        '借出':clean(r.borrow),
        '还回':clean(r.returned),
        '其他':clean(r.other),
        '对账差异':r.uncertain?'需核对旧记录':(r.diff===null?'':clean(r.diff)),
        '状态':excelStatus(r)
      });

      const wb=XLSX.utils.book_new();
      const ws=XLSX.utils.json_to_sheet(data.length?data:[{'暂无数据':''}]);
      if(ws['!ref']){
        ws['!autofilter']={ref:ws['!ref']};
        const range=XLSX.utils.decode_range(ws['!ref']);
        const widths=[];
        for(let col=range.s.c;col<=range.e.c;col++){
          let max=10;
          for(let row=range.s.r;row<=range.e.r;row++){
            const cell=ws[XLSX.utils.encode_cell({r:row,c:col})];
            if(cell&&cell.v!=null)max=Math.max(max,String(cell.v).length+2);
          }
          widths.push({wch:Math.min(max,22)});
        }
        ws['!cols']=widths;
      }
      XLSX.utils.book_append_sheet(wb,ws,'月结核对');

      const summaryRows=isCurrent
        ?[{'月份':monthLabel(selectedMonth),'说明':'本月尚未结束，仅显示上月结存'}]
        :[{
          '月份':monthLabel(selectedMonth),
          '上月结存总数':clean(rows.reduce((s,r)=>s+r.opening,0)),
          '本月结存总数':clean(rows.reduce((s,r)=>s+r.closing,0)),
          '本月实际减少':clean(rows.reduce((s,r)=>s+r.sold,0)),
          'POS 销量':clean(rows.reduce((s,r)=>s+(r.posValue===null?0:r.posValue),0)),
          '特殊用途 / 借出净额':clean(rows.reduce((s,r)=>s+r.foc+r.kitchen+r.noPaid+r.cancelIn+r.other+r.borrow-r.returned,0)),
          '待查差异':clean(rows.reduce((s,r)=>s+(r.uncertain||r.diff===null?0:Math.abs(num(r.diff))),0))
        }];
      const sws=XLSX.utils.json_to_sheet(summaryRows);
      sws['!cols']=[{wch:14},{wch:16},{wch:14},{wch:24},{wch:14}];
      XLSX.utils.book_append_sheet(wb,sws,'汇总');

      XLSX.writeFile(wb,`月结核对_${selectedMonth}.xlsx`);
    }catch(e){
      alert('导出失败：'+String(e?.message||e));
    }finally{
      btn.disabled=false;btn.textContent=old||'导出 Excel';
    }
  }

  async function clearPos(){
    const btn=document.getElementById('reconClearPos');if(!btn)return;
    if(!confirm(monthLabel(selectedMonth)+' 的 POS 销量和 ENT (实际) 会一起清除。确定继续吗？'))return;
    btn.disabled=true;btn.textContent='清除中...';
    try{
      const [posRes,entRes]=await Promise.all([
        sb.from('monthly_pos_sales').delete().eq('month_key',selectedMonth),
        sb.from('monthly_ent_actual').delete().eq('month_key',selectedMonth)
      ]);
      if(posRes.error)throw posRes.error;
      if(entRes.error)throw entRes.error;

      posRows=posRows.filter(r=>r.month_key!==selectedMonth);
      entActualRows=entActualRows.filter(r=>r.month_key!==selectedMonth);

      const blankDraft={};
      items.forEach(item=>blankDraft[item.id]='');
      render(false,blankDraft);

      alert(monthLabel(selectedMonth)+' 已清除 POS 销量和 ENT (实际)。ENT (实际) 已恢复默认 0，库存没有改变。');
    }catch(e){
      alert('清除失败：'+(e.message||e));
    }finally{
      btn.disabled=false;btn.textContent='清除';
    }
  }

  function setAutoSaveStatus(text,state=''){
    const el=document.getElementById('reconAutoSaveStatus');if(!el)return;
    el.textContent=text;
    el.dataset.state=state;
  }

  function schedulePosAutoSave(input,immediate=false){
    if(!input||!input.dataset.itemId)return;
    const itemId=String(input.dataset.itemId);
    const raw=String(input.value||'').trim();
    const monthAtSave=selectedMonth;

    const old=posSaveTimers.get(itemId);
    if(old)clearTimeout(old);

    if(raw===''){
      pendingPosSaves.delete(itemId);
      posSaveTimers.delete(itemId);
      setAutoSaveStatus('POS 自动保存','');
      return;
    }

    pendingPosSaves.set(itemId,{itemId,raw,monthAtSave});
    setAutoSaveStatus('等待自动保存…','pending');

    const timer=setTimeout(()=>{
      posSaveTimers.delete(itemId);
      const pending=pendingPosSaves.get(itemId);
      if(pending)saveSinglePosValue(pending);
    },immediate?0:600);

    posSaveTimers.set(itemId,timer);
  }

  async function saveSinglePosValue(pending){
    if(!pending)return;
    const {itemId,raw,monthAtSave}=pending;
    const item=items.find(x=>String(x.id)===String(itemId));if(!item)return;

    const q=Number(raw);
    if(!Number.isFinite(q)||q<0){
      setAutoSaveStatus('POS 数量不正确','error');
      return;
    }

    setAutoSaveStatus('保存中…','saving');
    const payload={
      month_key:monthAtSave,
      item_id:item.id,
      item_name:item.name,
      pos_quantity:q,
      updated_by:typeof userEmail==='function'?userEmail():'',
      updated_at:new Date().toISOString()
    };

    const {data,error}=await sb.from('monthly_pos_sales')
      .upsert(payload,{onConflict:'month_key,item_id'})
      .select()
      .single();

    if(error){
      setAutoSaveStatus('自动保存失败','error');
      console.error('POS auto-save failed',error);
      return;
    }

    const idx=posRows.findIndex(r=>String(r.item_id)===String(itemId)&&r.month_key===monthAtSave);
    if(idx>=0)posRows[idx]=data||payload;else posRows.push(data||payload);

    const latest=pendingPosSaves.get(String(itemId));
    if(latest&&latest.raw===raw&&latest.monthAtSave===monthAtSave){
      pendingPosSaves.delete(String(itemId));
    }
    setAutoSaveStatus('已自动保存 ✓','saved');
  }

  function flushPendingPosSaves(){
    posSaveTimers.forEach(timer=>clearTimeout(timer));
    posSaveTimers.clear();
    const pending=[...pendingPosSaves.values()];
    pending.forEach(p=>saveSinglePosValue(p));
  }

  // 离开月结页面、切到其他标签或窗口时，把尚未到 600ms 的输入也立即保存。
  document.addEventListener('click',e=>{
    const link=e.target&&e.target.closest?e.target.closest('.side-nav a'):null;
    if(link&&pendingPosSaves.size)flushPendingPosSaves();
  },true);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&pendingPosSaves.size)flushPendingPosSaves();
  });
  window.addEventListener('pagehide',()=>{
    if(pendingPosSaves.size)flushPendingPosSaves();
  });

  async function savePos(){
    const btn=document.getElementById('reconSavePos');if(!btn)return;
    const draft=draftFromInputs();
    const upserts=[];

    // 保存按钮用于“整月一次性确认”：
    // 已填写的沿用输入值；未录入的所有产品统一保存为 0。
    for(const item of items){
      const raw=Object.prototype.hasOwnProperty.call(draft,item.id)?String(draft[item.id]).trim():'';
      const q=raw===''?0:Number(raw);
      if(!Number.isFinite(q)||q<0)return alert(`${item.name} 的 POS 数量不正确`);
      upserts.push({
        month_key:selectedMonth,
        item_id:item.id,
        item_name:item.name,
        pos_quantity:q,
        updated_by:typeof userEmail==='function'?userEmail():'',
        updated_at:new Date().toISOString()
      });
    }

    posSaveTimers.forEach(timer=>clearTimeout(timer));
    posSaveTimers.clear();
    btn.disabled=true;btn.textContent='保存中...';
    setAutoSaveStatus('整月保存中…','saving');
    try{
      if(upserts.length){
        const {error}=await sb.from('monthly_pos_sales').upsert(upserts,{onConflict:'month_key,item_id'});
        if(error)throw error;
      }
      await loadData();
      setAutoSaveStatus('已全部保存 ✓','saved');
      alert(`${monthLabel(selectedMonth)} POS 销量已保存；未录入的产品已自动填 0。库存数量没有改变。`);
    }catch(e){
      setAutoSaveStatus('保存失败','error');
      alert('保存失败：'+(e.message||e));
    }finally{
      btn.disabled=false;btn.textContent='保存 POS 销量';
    }
  }

  function addStyle(){
    if(document.getElementById('monthlyReconciliationStyle'))return;
    const s=document.createElement('style');s.id='monthlyReconciliationStyle';s.textContent=`
#monthlyReconciliation{padding:0 2px 24px}
.recon-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:4px 0 14px}.recon-head h2{margin:0 0 4px;font-size:22px;color:#102a43}.recon-head>span{font-size:13px;color:#667085;padding-top:5px}
.recon-controls{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;background:#f8fafc}.recon-control-left{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.recon-controls label{font-size:12px;color:#667085;font-weight:700;display:flex;flex-direction:column;gap:6px;min-width:190px}.recon-controls select,.recon-controls input{min-height:42px}.recon-search-label{min-width:260px!important}.recon-control-actions{display:flex;gap:8px;align-items:center}.recon-control-actions button{min-height:42px}.recon-autosave-status{display:inline-flex;align-items:center;min-height:42px;padding:0 12px;border-radius:10px;background:#eef2f6;color:#667085;font-size:13px;font-weight:700;white-space:nowrap}.recon-autosave-status[data-state="saving"],.recon-autosave-status[data-state="pending"]{color:#b7791f}.recon-autosave-status[data-state="saved"]{color:#087f5b;background:#edf9f4}.recon-autosave-status[data-state="error"]{color:#c92a2a;background:#fff1f1}.recon-pos-error{border-color:#c92a2a!important;box-shadow:0 0 0 2px rgba(201,42,42,.08)!important}
.recon-summary{display:grid;grid-template-columns:repeat(6,minmax(150px,1fr));gap:10px;margin-bottom:12px}.recon-summary .card{padding:13px 14px}.recon-summary small{display:block;color:#667085}.recon-summary b{display:block;margin-top:5px;font-size:24px;color:#173b5e}
.recon-guide{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;background:#f7f9fc;color:#475467;font-size:13px;line-height:1.6}.recon-guide b{color:#173b5e;white-space:nowrap}
.recon-card{padding:14px;margin-top:12px}.recon-card .section-head h3{margin:0;font-size:17px}.recon-sort-btn{background:none!important;color:#667085!important;padding:0!important;border:0!important;border-radius:0!important;font-size:12px!important;font-weight:700!important;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.recon-sort-btn:hover{color:#173b5e!important}.recon-sort-arrow{font-size:10px;min-width:10px;text-align:center}.recon-ent-head{background:#eef1f4!important;color:#59636e!important}.recon-table tbody td.recon-ent-col{background:#f3f4f6}.recon-ent-actual-input{width:82px;min-height:34px;padding:6px 8px;background:#fff!important}.recon-ent-diff{font-weight:700}.recon-table{table-layout:fixed;width:max-content}.recon-table thead th{position:sticky}.recon-col-resizer{position:absolute;right:0;top:0;width:12px;height:100%;cursor:col-resize;z-index:30;user-select:none;border-right:2px solid transparent}.recon-col-resizer:hover{border-right-color:rgba(23,59,94,.35);background:rgba(23,59,94,.06)}body.recon-resizing{cursor:col-resize!important;user-select:none!important}body.recon-resizing *{cursor:col-resize!important}.recon-table-head{position:relative;min-height:28px}.recon-month-title{position:absolute;left:50%;transform:translateX(-50%);font-size:18px;font-weight:800;color:#173b5e;white-space:nowrap}.recon-table-wrap{max-height:64vh;overflow:auto}.recon-table{min-width:0}.recon-table thead th{position:sticky;top:0;z-index:4;background:#f8fafc!important;white-space:nowrap}.recon-table td{vertical-align:middle;white-space:nowrap}.recon-table thead th:nth-child(n+3),.recon-table tbody td:nth-child(n+3){text-align:center}.recon-table thead th:nth-child(1),.recon-table thead th:nth-child(2),.recon-table tbody td:nth-child(1),.recon-table tbody td:nth-child(2){text-align:left}.recon-pos-input,.recon-ent-actual-input{text-align:center}.recon-pos-input{width:92px;min-height:36px;padding:7px 8px}.recon-sub{font-size:11px;color:#98a2b3;margin-top:3px}.recon-ok{color:#087f5b;font-weight:700}.recon-bad{color:#c92a2a;font-weight:700}.recon-warn{color:#b7791f;font-weight:700}.recon-muted{color:#98a2b3}.recon-alert-row{background:#fff7f5}
@media(max-width:1100px){.recon-summary{grid-template-columns:repeat(2,1fr)}.recon-controls{align-items:stretch;flex-direction:column}.recon-control-left{width:100%}.recon-search-label{flex:1}.recon-control-actions{justify-content:flex-end}}
@media(max-width:620px){.recon-summary{grid-template-columns:1fr 1fr}.recon-control-actions{display:grid;grid-template-columns:1fr 1fr}.recon-control-actions button{width:100%}.recon-guide{display:block}.recon-guide b{display:block;margin-bottom:4px}}
`;document.head.appendChild(s);
  }

  window.refreshMonthlyReconciliation=loadData;
  wait();
})();