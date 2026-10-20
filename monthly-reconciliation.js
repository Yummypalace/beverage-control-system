// 月结核对：按实际库存减少与 POS + 特殊用途逐项对照。
// POS 销量为独立数据源，只用于月结对账，不会修改库存。
(function(){
  'use strict';

  let installed=false;
  let allLogs=[];
  let posRows=[];
  let entActualRows=[];
  let reviewRows=[];
  let lockRows=[];
  let loading=false;
  let selectedMonth='';
  let reconSortKey='name';
  let reconSortDir=1;
  const posSaveTimers=new Map();
  const pendingPosSaves=new Map();
  const entSaveTimers=new Map();
  const reviewNoteTimers=new Map();
  const staleReviewClearing=new Set();

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
  const RECON_DEFAULT_WIDTHS=[250,90,76,76,76,92,112,66,104,86,66,86,82,86,66,66,66,96,78,210,92];

  function loadReconColumnWidths(){
    try{return JSON.parse(localStorage.getItem(RECON_WIDTHS_KEY)||'{}')||{};}catch(e){return {};}
  }

  function saveReconColumnWidths(widths){
    try{localStorage.setItem(RECON_WIDTHS_KEY,JSON.stringify(widths));}catch(e){}
  }

  function measureReconHeaderMin(th,index){
    if(!th)return 42;
    const cs=getComputedStyle(th);
    const probe=document.createElement('span');
    probe.textContent=String(th.textContent||'').replace(/\s+/g,' ').trim();
    probe.style.cssText=[
      'position:fixed',
      'left:-10000px',
      'top:-10000px',
      'visibility:hidden',
      'display:inline-block',
      'width:max-content',
      'min-width:0',
      'max-width:none',
      'white-space:nowrap',
      'box-sizing:border-box',
      'font-family:'+cs.fontFamily,
      'font-size:'+cs.fontSize,
      'font-weight:'+cs.fontWeight,
      'letter-spacing:'+cs.letterSpacing,
      'padding-left:'+cs.paddingLeft,
      'padding-right:'+cs.paddingRight
    ].join(';');
    document.body.appendChild(probe);
    // 排序栏需要额外预留图标与间距；其他栏预留拖动边界空间。
    const extra=(index===0||index===1)?18:12;
    const width=Math.ceil(probe.getBoundingClientRect().width+extra);
    probe.remove();
    return Math.max(42,width);
  }

  function reconWidthLimits(index){
    const th=document.querySelector(`#monthlyReconciliation .recon-table thead th:nth-child(${index+1})`);
    const measured=Number(th?.dataset.headerMinWidth);
    const min=Number.isFinite(measured)&&measured>0?measured:42;
    let max=240;
    if(index===0)max=520;
    else if(index===1)max=260;
    else if(index===6||index===8)max=220;
    else if(index===18)max=180;
    else if(index===19)max=420;
    else if(index===20)max=160;
    return {min,max:Math.max(max,min)};
  }

  function clampReconWidth(index,value){
    const {min,max}=reconWidthLimits(index);
    return Math.max(min,Math.min(max,Math.round(Number(value)||min)));
  }

  function setReconColumnWidth(th,index,width,persist=false){
    const next=clampReconWidth(index,width);
    th.style.width=next+'px';
    th.style.minWidth=next+'px';
    th.style.maxWidth=next+'px';
    if(persist){
      const widths=loadReconColumnWidths();
      widths[index]=next;
      saveReconColumnWidths(widths);
    }
    return next;
  }

  function installReconColumnResize(){
    const table=document.querySelector('#monthlyReconciliation .recon-table');
    const wrap=document.querySelector('#monthlyReconciliation .recon-table-wrap');
    if(!table||!wrap)return;
    const heads=[...table.querySelectorAll('thead th')];
    const saved=loadReconColumnWidths();

    heads.forEach((th,index)=>{
      th.style.position='sticky';
      th.dataset.colIndex=String(index);
      th.dataset.headerMinWidth=String(measureReconHeaderMin(th,index));
      const savedWidth=Number(saved[index]);
      const defaultWidth=Number(RECON_DEFAULT_WIDTHS[index]||80);
      setReconColumnWidth(th,index,Number.isFinite(savedWidth)?savedWidth:defaultWidth,false);

      if(th.querySelector('.recon-col-resizer'))return;
      const handle=document.createElement('span');
      handle.className='recon-col-resizer';
      handle.setAttribute('role','separator');
      handle.setAttribute('aria-orientation','vertical');
      handle.setAttribute('aria-label','拖动调整列宽');
      th.appendChild(handle);

      handle.addEventListener('pointerdown',e=>{
        if(e.button!==0)return;
        e.preventDefault();
        e.stopPropagation();

        const pointerId=e.pointerId;
        const startX=e.clientX;
        const startWidth=th.getBoundingClientRect().width;
        let currentWidth=Math.round(startWidth);

        const guide=document.createElement('div');
        guide.className='recon-resize-guide';
        const bubble=document.createElement('div');
        bubble.className='recon-resize-bubble';
        bubble.textContent=currentWidth+' px';
        wrap.appendChild(guide);
        wrap.appendChild(bubble);

        const placeGuide=clientX=>{
          const rect=wrap.getBoundingClientRect();
          const left=clientX-rect.left+wrap.scrollLeft;
          guide.style.left=left+'px';
          guide.style.top=wrap.scrollTop+'px';
          guide.style.height=wrap.clientHeight+'px';
          bubble.style.left=Math.max(wrap.scrollLeft+4,left-26)+'px';
          bubble.style.top=(wrap.scrollTop+6)+'px';
        };

        placeGuide(e.clientX);
        th.classList.add('recon-resizing-col');
        handle.classList.add('is-active');
        document.body.classList.add('recon-resizing');

        const move=ev=>{
          if(ev.pointerId!==pointerId)return;
          currentWidth=setReconColumnWidth(th,index,startWidth+ev.clientX-startX,false);
          bubble.textContent=currentWidth+' px';
          placeGuide(ev.clientX);
        };

        const up=ev=>{
          if(ev.pointerId!==pointerId)return;
          document.removeEventListener('pointermove',move);
          document.removeEventListener('pointerup',up);
          document.removeEventListener('pointercancel',up);
          document.body.classList.remove('recon-resizing');
          th.classList.remove('recon-resizing-col');
          handle.classList.remove('is-active');
          guide.remove();
          bubble.remove();
          setReconColumnWidth(th,index,currentWidth,true);
        };

        document.addEventListener('pointermove',move);
        document.addEventListener('pointerup',up);
        document.addEventListener('pointercancel',up);
      });

    });
  }

  function wait(){
    if(typeof sb==='undefined'||typeof showPage!=='function'||typeof items==='undefined'||!window.InventoryHistoryEngine||!document.querySelector('.side-nav')||!document.querySelector('.content-area')){
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
    window.addEventListener('app-role-changed',()=>updateLockUI());
    selectedMonth=currentMonth();
    loadData();
    setTimeout(()=>updateLockUI(),600);
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
          <span id="reconLockStatus" class="recon-lock-status">未锁定</span>
          <button id="reconLockToggle" class="secondary" type="button">确认月结并锁定</button>
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
          <div class="recon-table-meta">
            <span id="reconInventoryDateHint" class="hint"></span>
          </div>
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
              <th>备注</th>
              <th>人工确认</th>
            </tr></thead>
            <tbody id="reconInventoryBody"><tr><td colspan="21">读取中...</td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="card recon-review-detail-card">
        <div class="section-head">
          <div>
            <h3>月结备注明细</h3>
            <div class="hint">只显示本月已经填写备注的饮料，方便集中查看已核对原因。</div>
          </div>
          <span id="reconReviewDetailCount" class="hint">0 条</span>
        </div>
        <div class="tablewrap recon-review-detail-wrap">
          <table class="recon-review-detail-table">
            <thead>
              <tr>
                <th>饮料</th>
                <th>对账差异</th>
                <th>系统状态</th>
                <th>备注</th>
                <th>人工确认</th>
                <th>更新人</th>
              </tr>
            </thead>
            <tbody id="reconReviewDetailBody">
              <tr><td colspan="6">暂无备注</td></tr>
            </tbody>
          </table>
        </div>
      </div>
`;
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
    document.getElementById('reconLockToggle').onclick=toggleMonthLock;
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
        ['dashboard','inventory','commission','logs','settings','corrections','outNotes','stocktakeAdjust'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
        if(own)own.style.display='block';
        document.querySelectorAll('.side-nav a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#monthlyReconciliation'));
        window.scrollTo({top:0,behavior:'smooth'});loadData();return;
      }
      if(own)own.style.display='none';
      oldShowPage(page);
    };
    document.querySelectorAll('.side-nav a').forEach(link=>{link.onclick=e=>{e.preventDefault();showPage(link.getAttribute('href').slice(1));};});
  }

  async function retryResult(task,attempts=3){
    let last={data:null,error:new Error('请求失败')};
    for(let i=0;i<attempts;i++){
      try{
        last=await task();
        if(!last?.error)return last;
      }catch(e){
        last={data:null,error:e};
      }
      if(i<attempts-1)await new Promise(r=>setTimeout(r,220*(i+1)));
    }
    return last;
  }

  async function fetchAll(table,configure,attempt=0){
    try{
      const all=[];let from=0;const size=1000;
      while(true){
        let q=sb.from(table).select('*');q=configure(q);q=q.range(from,from+size-1);
        const {data,error}=await q;if(error)throw error;
        const page=data||[];all.push(...page);if(page.length<size)break;from+=size;
      }
      return all;
    }catch(e){
      if(attempt<2){
        await new Promise(r=>setTimeout(r,220*(attempt+1)));
        return fetchAll(table,configure,attempt+1);
      }
      throw e;
    }
  }

  async function recalculateFresh(){
    if(loading)return;
    loading=true;
    const status=document.getElementById('reconStatus');
    const body=document.getElementById('reconInventoryBody');
    const hadData=allLogs.length>0||posRows.length>0||entActualRows.length>0;
    if(body&&!hadData)body.innerHTML='<tr><td colspan="21">重新计算中...</td></tr>';
    if(status)status.textContent='重新计算中...';
    try{
      const [logs,pos,entActual,reviews,locks]=await Promise.all([
        fetchAll('inventory_logs',q=>q.order('operation_date',{ascending:true}).order('created_at',{ascending:true})),
        fetchAll('monthly_pos_sales',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_ent_actual',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_reconciliation_review',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_period_locks',q=>q.order('month_key',{ascending:true}))
      ]);
      allLogs=logs;
      posRows=pos;
      entActualRows=entActual;
      reviewRows=reviews;
      lockRows=locks;
      populateMonths();
      const blankDraft={};
      computeRows().forEach(r=>blankDraft[r.item.id]='');
      render(false,blankDraft);
      if(status)status.textContent='已重新计算';
    }catch(e){
      console.warn('月结重新计算失败，保留现有资料',e);
      if(hadData){
        render(false,blankDraft);
        if(status)status.textContent='重新计算失败，已保留现有资料';
      }else{
        if(body)body.innerHTML=`<tr><td colspan="21">重新计算失败：${h(e.message||e)}</td></tr>`;
        if(status)status.textContent='重新计算失败';
      }
    }finally{loading=false;}
  }

  async function loadData(preservePos=false){
    if(loading)return;
    const draft=preservePos?draftFromInputs():null;
    loading=true;
    const status=document.getElementById('reconStatus');
    const body=document.getElementById('reconInventoryBody');
    const hadData=allLogs.length>0||posRows.length>0||entActualRows.length>0;
    if(body&&!hadData)body.innerHTML='<tr><td colspan="21">读取中...</td></tr>';
    if(status)status.textContent='读取中...';
    try{
      const [logs,pos,entActual,reviews,locks]=await Promise.all([
        fetchAll('inventory_logs',q=>q.order('operation_date',{ascending:true}).order('created_at',{ascending:true})),
        fetchAll('monthly_pos_sales',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_ent_actual',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_reconciliation_review',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true})),
        fetchAll('monthly_period_locks',q=>q.order('month_key',{ascending:true}))
      ]);
      allLogs=logs;posRows=pos;entActualRows=entActual;reviewRows=reviews;lockRows=locks;populateMonths();render(false,draft);
      if(status)status.textContent='已更新';
    }catch(e){
      console.warn('月结资料读取失败，保留现有资料',e);
      if(hadData){
        render(false,draft);
        if(status)status.textContent='读取失败，已保留现有资料';
      }else{
        if(body)body.innerHTML=`<tr><td colspan="21">读取失败：${h(e.message||e)}</td></tr>`;
        if(status)status.textContent='读取失败';
      }
    }finally{loading=false;}
  }

  function populateMonths(){
    const select=document.getElementById('reconMonth');if(!select)return;
    const months=new Set([currentMonth()]);
    allLogs.forEach(r=>{const m=monthOf(r);if(/^\d{4}-\d{2}$/.test(m)&&m>='2026-09')months.add(m);});
    posRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||'')&&r.month_key>='2026-09')months.add(r.month_key);});
    entActualRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||'')&&r.month_key>='2026-09')months.add(r.month_key);});
    reviewRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||'')&&r.month_key>='2026-09')months.add(r.month_key);});
    lockRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||'')&&r.month_key>='2026-09')months.add(r.month_key);});
    const list=[...months].sort((a,b)=>b.localeCompare(a));
    if(!selectedMonth||!months.has(selectedMonth))selectedMonth=currentMonth();
    select.innerHTML=list.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    select.value=selectedMonth;
  }

  function selectedLock(){
    return lockRows.find(r=>String(r.month_key||'')===String(selectedMonth))||null;
  }

  function isSelectedMonthLocked(){
    return !!selectedLock()?.is_locked;
  }

  function updateLockUI(){
    const badge=document.getElementById('reconLockStatus');
    const btn=document.getElementById('reconLockToggle');
    const save=document.getElementById('reconSavePos');
    const clear=document.getElementById('reconClearPos');
    const auto=document.getElementById('reconAutoSaveStatus');
    const isCurrent=selectedMonth===currentMonth();
    const locked=isSelectedMonthLocked();
    const admin=window.currentAppRole==='admin';
    const row=selectedLock();

    if(badge){
      if(isCurrent){badge.textContent='本月未结束';badge.dataset.state='current';}
      else if(locked){badge.textContent='已锁定';badge.dataset.state='locked';badge.title=row?.locked_by?('锁定人：'+row.locked_by):'';}
      else{badge.textContent='未锁定';badge.dataset.state='open';badge.title='';}
    }

    if(btn){
      btn.style.display=admin&&!isCurrent?'':'none';
      btn.textContent=locked?'重新开启月份':'确认月结并锁定';
      btn.classList.toggle('green',!locked);
      btn.classList.toggle('secondary',locked);
    }

    if(save)save.disabled=locked||isCurrent;
    if(clear)clear.disabled=locked||isCurrent;
    if(auto){
      if(locked){auto.textContent='月份已锁定';auto.dataset.state='saved';}
      else if(auto.textContent==='月份已锁定'){auto.textContent='POS 自动保存';auto.dataset.state='';}
    }
  }

  async function flushPendingBeforeLock(){
    let ok=true;
    posSaveTimers.forEach(timer=>clearTimeout(timer));
    posSaveTimers.clear();
    const pendingPos=[...pendingPosSaves.values()];
    for(const p of pendingPos){if(await saveSinglePosValue(p)===false)ok=false;}

    const pendingEntIds=[...entSaveTimers.keys()];
    entSaveTimers.forEach(timer=>clearTimeout(timer));
    entSaveTimers.clear();
    for(const id of pendingEntIds){
      const input=document.querySelector('.recon-ent-actual-input[data-item-id="'+String(id)+'"]');
      if(input&&await saveEntActual(input)===false)ok=false;
    }

    const pendingReviewIds=[...reviewNoteTimers.keys()];
    reviewNoteTimers.forEach(timer=>clearTimeout(timer));
    reviewNoteTimers.clear();
    for(const id of pendingReviewIds){
      const input=document.querySelector('.recon-review-note[data-item-id="'+String(id)+'"]');
      if(input&&await saveReview(id,{note:String(input.value||'')})===false)ok=false;
    }
    return ok;
  }

  async function toggleMonthLock(){
    if(selectedMonth===currentMonth())return alert('本月尚未结束，不能锁定。');
    if(window.currentAppRole!=='admin')return alert('仅 Admin 可以锁定或重新开启月份。');

    const locked=isSelectedMonthLocked();
    const btn=document.getElementById('reconLockToggle');
    if(btn?.disabled)return;

    if(locked){
      if(!confirm(monthLabel(selectedMonth)+' 已锁定。\n\n重新开启后，这个月份的库存补录、POS、ENT、盘点、提成和月结备注都可以再次修改。确定重新开启吗？'))return;
      if(btn){btn.disabled=true;btn.textContent='开启中...';}
      try{
        const {error}=await sb.rpc('set_month_lock',{p_month:selectedMonth,p_locked:false});
        if(error)throw error;
        await loadData();
      }catch(e){alert('重新开启失败：'+String(e?.message||e));}
      finally{if(btn)btn.disabled=false;updateLockUI();}
      return;
    }

    const flushed=await flushPendingBeforeLock();
    if(!flushed)return alert('有资料尚未成功保存，请先处理保存失败的项目，再锁定月份。');

    const rows=computeRows(draftFromInputs());
    const unresolved=rows.filter(r=>r.uncertain||r.diff===null||(Math.abs(num(r.diff))>0.000001&&!r.manualOk));
    if(unresolved.length){
      const names=unresolved.slice(0,5).map(r=>r.item.name).join('、');
      return alert('这个月份还有 '+unresolved.length+' 项尚未完成核对，暂时不能锁定。\n\n请先处理 CHECK / 待填 POS；有合理原因的差异请填写备注并人工确认 OK。'+(names?'\n\n例如：'+names:''));
    }

    if(!confirm('确定完成 '+monthLabel(selectedMonth)+' 月结并锁定吗？\n\n锁定后，该月份的库存补录、撤销、盘点、POS、ENT、提成和月结备注都不能再修改。需要修改时，必须由 Admin 重新开启。'))return;
    if(btn){btn.disabled=true;btn.textContent='锁定中...';}
    try{
      const {error}=await sb.rpc('set_month_lock',{p_month:selectedMonth,p_locked:true});
      if(error)throw error;
      await loadData();
      alert(monthLabel(selectedMonth)+' 已完成月结并锁定。');
    }catch(e){alert('锁定失败：'+String(e?.message||e));}
    finally{if(btn)btn.disabled=false;updateLockUI();}
  }
  function historyItems(){
    return typeof allItems!=='undefined'&&Array.isArray(allItems)?allItems:items;
  }

  function snapshotAt(cutoff){
    return window.InventoryHistoryEngine.snapshotAt(
      historyItems(),
      allLogs,
      cutoff,
      {excludeStocktakeAdjustments:false}
    );
  }

  function monthStats(){
    const map=new Map();
    const resolver=window.InventoryHistoryEngine.createResolver(historyItems());
    function ensure(id){
      const key=String(id||'');
      if(!map.has(key))map.set(key,{inbound:0,initialStock:0,ent:0,foc:0,kitchen:0,noPaid:0,cancelIn:0,borrow:0,returned:0,other:0});
      return map.get(key);
    }
    allLogs.forEach(r=>{
      if(monthOf(r)!==selectedMonth)return;
      const resolvedId=resolver.resolve(r);
      if(!resolvedId)return;
      const s=ensure(resolvedId);
      const action=String(r.action||''),q=num(r.quantity);

      if(r.correction_ref)return;

      // 新增饮料若带有期初库存，这批库存属于该饮料建立当月的库存增加。
      // 只采用带 item_id 的 CREATE，避免旧的同名孤立记录被错误套到后来新建的饮料。
      // 同一 item 若历史上意外出现多笔 CREATE，则保留本月最后一笔作为建立库存锚点。
      if(action==='CREATE'&&r.item_id){
        s.initialStock=parseCreateTotal(r.note,q);
        return;
      }
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

  function reviewMap(){
    const map=new Map();
    reviewRows.forEach(r=>map.set(String(r.item_id)+'|'+String(r.month_key),r));
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

  function normalizedReviewNumber(v){
    return v===null||v===undefined?'':String(clean(v));
  }

  function reconciliationSignature(values){
    return [
      normalizedReviewNumber(values.opening),
      normalizedReviewNumber(values.closing),
      normalizedReviewNumber(values.inbound),
      normalizedReviewNumber(values.sold),
      normalizedReviewNumber(values.posValue),
      normalizedReviewNumber(values.foc),
      normalizedReviewNumber(values.kitchen),
      normalizedReviewNumber(values.noPaid),
      normalizedReviewNumber(values.cancelIn),
      normalizedReviewNumber(values.borrow),
      normalizedReviewNumber(values.returned),
      normalizedReviewNumber(values.other),
      normalizedReviewNumber(values.diff),
      String(values.note||'').trim()
    ].join('|');
  }

  function computeRows(draftPos){
    const open=snapshotAt(previousMonthEnd(selectedMonth));
    const close=snapshotAt(monthEnd(selectedMonth));
    const stats=monthStats();
    const pmap=posMap();
    const rmap=reviewMap();
    const sourceItems=historyItems();
    const closeCutoff=monthEnd(selectedMonth);

    const rows=sourceItems.map(item=>{
      const key=String(item.id);
      const s=stats.get(key)||{inbound:0,initialStock:0,ent:0,foc:0,kitchen:0,noPaid:0,cancelIn:0,borrow:0,returned:0,other:0};
      const openState=open.get(key);
      const closeState=close.get(key);
      const opening=openState&&openState.exists?num(openState.total):0;
      // 上月还不存在的新品，本月 CREATE 的期初库存要计入“本月入库”。
      // 已经有上月结存的旧品，即使历史资料里还有重复 CREATE，也不能重复增加。
      const inbound=clean(s.inbound+((!openState||!openState.exists)?num(s.initialStock):0));
      const closing=selectedMonth===currentMonth()
        ? num(item.fridge_quantity)+num(item.warehouse_quantity)
        : (closeState&&closeState.exists?num(closeState.total):0);
      const sold=clean(opening+inbound-closing);

      let posValue=null;
      if(draftPos&&Object.prototype.hasOwnProperty.call(draftPos,item.id)){
        const raw=draftPos[item.id];posValue=raw===''?null:num(raw);
      }else{
        const saved=pmap.get(`${item.id}|${selectedMonth}`)
          || posRows.find(r=>r.month_key===selectedMonth&&String(r.item_name||'')===String(item.name||''));
        const monthHasSavedPos=posRows.some(r=>r.month_key===selectedMonth);
        posValue=saved?num(saved.pos_quantity):(monthHasSavedPos?0:null);
      }

      const entSaved=entActualRows.find(r=>r.month_key===selectedMonth&&String(r.item_id)===key)
        || entActualRows.find(r=>r.month_key===selectedMonth&&String(r.item_name||'')===String(item.name||''));
      const entActualValue=entSaved?num(entSaved.ent_actual):0;
      const entDiff=clean(entActualValue-s.ent);

      const explained=posValue===null?null:posValue+s.foc+s.kitchen+s.noPaid+s.cancelIn+s.other+s.borrow-s.returned;
      const diff=explained===null?null:clean(explained-sold);
      const uncertain=!!(openState?.totalUncertain||closeState?.totalUncertain);
      const review=rmap.get(key+'|'+String(selectedMonth))
        || reviewRows.find(x=>x.month_key===selectedMonth&&String(x.item_name||'')===String(item.name||''))
        || null;
      const reviewNote=review?.note||'';
      const reviewable=!uncertain&&diff!==null&&Math.abs(num(diff))>0.000001;
      const reviewSignature=reconciliationSignature({opening,closing,inbound,sold,posValue,foc:s.foc,kitchen:s.kitchen,noPaid:s.noPaid,cancelIn:s.cancelIn,borrow:s.borrow,returned:s.returned,other:s.other,diff,note:reviewNote});
      const storedManualOk=!!review?.manual_ok;
      const confirmedDiff=review?.confirmed_diff;
      const signatureMatches=String(review?.confirmed_signature||'')===reviewSignature;
      const diffMatches=confirmedDiff!==null&&confirmedDiff!==undefined&&Math.abs(num(confirmedDiff)-num(diff))<0.000001;
      const manualOk=storedManualOk&&reviewable&&String(reviewNote).trim()!==''&&signatureMatches&&diffMatches;
      const manualOkStale=storedManualOk&&!manualOk;

      const hasMonthData=stats.has(key)
        ||posRows.some(r=>r.month_key===selectedMonth&&String(r.item_id)===key)
        ||entActualRows.some(r=>r.month_key===selectedMonth&&String(r.item_id)===key)
        ||reviewRows.some(r=>r.month_key===selectedMonth&&String(r.item_id)===key);
      const relevant=item.is_active!==false
        ||window.InventoryHistoryEngine.itemRelevantAt(item,closeState,closeCutoff,allLogs,sourceItems)
        ||Math.abs(opening)>0.000001
        ||Math.abs(closing)>0.000001
        ||hasMonthData;
      if(!relevant)return null;

      return {item,...s,inbound,opening,closing,sold,posValue,entActualValue,entDiff,explained,diff,uncertain,reviewNote,reviewable,reviewSignature,storedManualOk,manualOk,manualOkStale};
    }).filter(Boolean);

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
    const locked=isSelectedMonthLocked();

    if(isCurrent){
      body.innerHTML=rows.map(r=>`<tr>
        <td class="recon-name-cell" title="${h(r.item.name)}"><b>${h(r.item.name)}</b><div class="recon-sub">${h(r.item.unit||'')}</div></td>
        <td><span class="pill category-pill">${h(r.item.category||'-')}</span></td>
        <td>${clean(r.opening)}</td>
        <td>-</td><td>-</td><td>-</td><td>-</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        <td>-</td><td>-</td>
      </tr>`).join('')||'<tr><td colspan="21">暂无饮料资料</td></tr>';

      const hint=document.getElementById('reconInventoryDateHint');
      if(hint)hint.textContent='本月尚未结束，仅显示上月结存';
      const monthTitle=document.getElementById('reconMonthTitle');
      if(monthTitle)monthTitle.textContent=monthLabel(selectedMonth);

      const openingTotal=clean(allRows.reduce((s,r)=>s+r.opening,0));
      const openingEl=document.getElementById('reconOpeningTotal');if(openingEl)openingEl.textContent=openingTotal;
      ['reconClosingTotal','reconSoldTotal','reconPosTotal','reconSpecialTotal','reconIssueTotal'].forEach(id=>{
        const el=document.getElementById(id);if(el)el.textContent='-';
      });
      renderReviewDetails(allRows);
      updateLockUI();
      return;
    }

    body.innerHTML=rows.map(r=>{
      const input=r.posValue===null?'':clean(r.posValue);
      const alert=!r.uncertain&&r.diff!==null&&Math.abs(r.diff)>0.000001&&!r.manualOk;
      return `<tr class="${alert?'recon-alert-row':''}">
        <td class="recon-name-cell" title="${h(r.item.name)}"><b>${h(r.item.name)}</b><div class="recon-sub">${h(r.item.unit||'')}</div></td>
        <td><span class="pill category-pill">${h(r.item.category||'-')}</span></td>
        <td>${clean(r.opening)}</td>
        <td>${clean(r.closing)}</td>
        <td>${clean(r.inbound)}</td>
        <td><b>${clean(r.sold)}</b></td>
        <td><input class="recon-pos-input" data-item-id="${h(r.item.id)}" type="number" min="0" step="0.01" value="${h(input)}" placeholder="未录入" ${locked?'disabled':''}></td>
        <td class="recon-ent-col">${clean(r.ent)}</td>
        <td class="recon-ent-col"><input class="recon-ent-actual-input" data-item-id="${h(r.item.id)}" data-system-ent="${h(clean(r.ent))}" type="number" min="0" step="0.01" value="${h(clean(r.entActualValue))}" ${locked?'disabled':''}></td>
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
        <td><input class="recon-review-note" data-item-id="${h(r.item.id)}" value="${h(r.reviewNote)}" placeholder="填写核对原因" ${locked?'disabled':''}></td>
        <td>${r.reviewable?`<button type="button" class="recon-manual-ok ${r.manualOk?'is-ok':''}" data-item-id="${h(r.item.id)}" ${locked?'disabled':''}>${r.manualOk?'OK ✓':'选择 OK'}</button>`:'<span class="recon-muted">—</span>'}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="21">暂无饮料资料</td></tr>';

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

    document.querySelectorAll('#reconInventoryBody .recon-review-note').forEach(input=>{
      input.addEventListener('input',()=>{
        const itemId=String(input.dataset.itemId||'');
        const existing=reviewRows.find(r=>r.month_key===selectedMonth&&String(r.item_id)===itemId);
        const changes={note:input.value};
        if(existing?.manual_ok&&String(existing.note||'')!==String(input.value||'')){
          changes.manual_ok=false;
          changes.confirmed_diff=null;
          changes.confirmed_signature=null;
          changes.confirmed_at=null;
          changes.confirmed_by='';
          const btn=document.querySelector('.recon-manual-ok[data-item-id="'+itemId+'"]');
          if(btn){btn.classList.remove('is-ok');btn.textContent='选择 OK';}
        }
        updateReviewLocal(itemId,changes);
        renderReviewDetails();
        scheduleReviewNoteSave(input);
      });
      input.addEventListener('change',()=>scheduleReviewNoteSave(input,true));
      input.addEventListener('blur',()=>scheduleReviewNoteSave(input,true));
    });

    document.querySelectorAll('#reconInventoryBody .recon-manual-ok').forEach(btn=>{
      btn.addEventListener('click',()=>toggleManualOk(btn.dataset.itemId));
    });

    const hint=document.getElementById('reconInventoryDateHint');
    if(hint)hint.textContent=isCurrent?'本月结存使用当前库存（本月尚未结束）':`本月结存还原至 ${monthEnd(selectedMonth)} 营业结束`;
    const monthTitle=document.getElementById('reconMonthTitle');
    if(monthTitle)monthTitle.textContent=monthLabel(selectedMonth);

    // 顶部汇总始终显示所选月份的全部产品总数，不受搜索或排序影响。
    updateSummary(allRows);
    renderReviewDetails(allRows);
    updateLockUI();
    if(!locked)clearStaleManualOks(allRows);
  }

  function reviewSystemStatus(r){
    if(r.uncertain)return '需核对旧记录';
    if(r.diff===null)return '待填 POS';
    return Math.abs(num(r.diff))<0.000001?'OK':'CHECK';
  }

  function renderReviewDetails(rows=null){
    const body=document.getElementById('reconReviewDetailBody');
    const count=document.getElementById('reconReviewDetailCount');
    if(!body||!count)return;

    const source=rows||computeRows(draftFromInputs());
    const list=source.filter(r=>String(r.reviewNote||'').trim()!=='');
    count.textContent=String(list.length)+' 条';

    body.innerHTML=list.map(r=>{
      const diff=r.uncertain?'需核对旧记录':(r.diff===null?'—':clean(r.diff));
      const diffClass=!r.uncertain&&r.diff!==null&&Math.abs(num(r.diff))>0.000001?(num(r.diff)>0?'recon-bad':'recon-warn'):'recon-ok';
      const review=reviewRows.find(x=>x.month_key===selectedMonth&&String(x.item_id)===String(r.item.id));
      return '<tr>' +
        '<td><b>'+h(r.item.name||'')+'</b></td>' +
        '<td class="'+diffClass+'">'+h(diff)+'</td>' +
        '<td>'+h(reviewSystemStatus(r))+'</td>' +
        '<td class="recon-review-detail-note">'+h(r.reviewNote||'')+'</td>' +
        '<td>'+(r.manualOk?'<span class="recon-review-ok-badge">OK ✓</span>':'<span class="recon-muted">未确认</span>')+'</td>' +
        '<td>'+h(review?.updated_by||'')+'</td>' +
      '</tr>';
    }).join('')||'<tr><td colspan="6">这个月份还没有填写备注</td></tr>';
  }
  function updateSummary(rows){
    const opening=clean(rows.reduce((s,r)=>s+r.opening,0));
    const closing=clean(rows.reduce((s,r)=>s+r.closing,0));
    const sold=clean(rows.reduce((s,r)=>s+r.sold,0));
    const pos=clean(rows.reduce((s,r)=>s+(r.posValue===null?0:r.posValue),0));
    const special=clean(rows.reduce((s,r)=>s+r.foc+r.kitchen+r.noPaid+r.cancelIn+r.other+r.borrow-r.returned,0));
    const issue=clean(rows.reduce((s,r)=>s+(r.uncertain||r.diff===null||r.manualOk?0:Math.abs(num(r.diff))),0));
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
    if(isSelectedMonthLocked())return;
    if(!input||!input.dataset.itemId)return;
    const itemId=String(input.dataset.itemId);
    const old=entSaveTimers.get(itemId);if(old)clearTimeout(old);
    const raw=String(input.value||'').trim();
    if(raw==='')return;
    entSaveTimers.set(itemId,setTimeout(()=>saveEntActual(input),immediate?0:600));
  }

  async function saveEntActual(input){
    if(isSelectedMonthLocked())return false;
    if(!input||!input.dataset.itemId)return false;
    const itemId=String(input.dataset.itemId);
    const item=historyItemById(itemId);if(!item)return;
    const raw=String(input.value||'').trim();if(raw==='')return true;
    const q=Number(raw);if(!Number.isFinite(q)||q<0)return false;
    const monthAtSave=selectedMonth;
    const payload={month_key:monthAtSave,item_id:item.id,item_name:item.name,ent_actual:q,updated_by:typeof userEmail==='function'?userEmail():'',updated_at:new Date().toISOString()};
    const {data,error}=await retryResult(()=>sb.from('monthly_ent_actual').upsert(payload,{onConflict:'month_key,item_id'}).select().single());
    if(error){console.error('ENT actual auto-save failed',error);return false;}
    const idx=entActualRows.findIndex(r=>r.month_key===monthAtSave&&String(r.item_id)===itemId);
    if(idx>=0)entActualRows[idx]=data||payload;else entActualRows.push(data||payload);
    entSaveTimers.delete(itemId);
    return true;
  }

  function reviewIndex(itemId,month=selectedMonth){
    return reviewRows.findIndex(r=>r.month_key===month&&String(r.item_id)===String(itemId));
  }

  function historyItemById(itemId){
    return historyItems().find(x=>String(x.id)===String(itemId));
  }

  function updateReviewLocal(itemId,changes,month=selectedMonth){
    const item=historyItemById(itemId);if(!item)return;
    const idx=reviewIndex(itemId,month);
    const base=idx>=0?reviewRows[idx]:{
      month_key:month,item_id:item.id,item_name:item.name,note:'',manual_ok:false,
      confirmed_diff:null,confirmed_signature:null,confirmed_at:null,confirmed_by:'',
      updated_by:'',updated_at:null
    };
    const next={...base,...changes};
    if(idx>=0)reviewRows[idx]=next;else reviewRows.push(next);
  }

  function scheduleReviewNoteSave(input,immediate=false){
    if(isSelectedMonthLocked())return;
    if(!input||!input.dataset.itemId)return;
    const itemId=String(input.dataset.itemId);
    const old=reviewNoteTimers.get(itemId);if(old)clearTimeout(old);
    reviewNoteTimers.set(itemId,setTimeout(()=>{
      reviewNoteTimers.delete(itemId);
      saveReview(itemId,{note:String(input.value||'')});
    },immediate?0:650));
  }

  async function saveReview(itemId,changes){
    if(isSelectedMonthLocked())return false;
    const item=historyItemById(itemId);if(!item)return false;
    const monthAtSave=selectedMonth;
    const existing=reviewRows.find(r=>r.month_key===monthAtSave&&String(r.item_id)===String(itemId));
    const nextNote=Object.prototype.hasOwnProperty.call(changes,'note')?String(changes.note||''):String(existing?.note||'');
    const noteChanged=Object.prototype.hasOwnProperty.call(changes,'note')&&nextNote!==String(existing?.note||'');

    let manualOk=Object.prototype.hasOwnProperty.call(changes,'manual_ok')?!!changes.manual_ok:!!existing?.manual_ok;
    let confirmedDiff=Object.prototype.hasOwnProperty.call(changes,'confirmed_diff')?changes.confirmed_diff:(existing?.confirmed_diff??null);
    let confirmedSignature=Object.prototype.hasOwnProperty.call(changes,'confirmed_signature')?changes.confirmed_signature:(existing?.confirmed_signature||null);
    let confirmedAt=Object.prototype.hasOwnProperty.call(changes,'confirmed_at')?changes.confirmed_at:(existing?.confirmed_at||null);
    let confirmedBy=Object.prototype.hasOwnProperty.call(changes,'confirmed_by')?String(changes.confirmed_by||''):String(existing?.confirmed_by||'');

    if(noteChanged&&existing?.manual_ok&&!Object.prototype.hasOwnProperty.call(changes,'manual_ok')){
      manualOk=false;confirmedDiff=null;confirmedSignature=null;confirmedAt=null;confirmedBy='';
    }
    if(!manualOk){
      confirmedDiff=null;confirmedSignature=null;confirmedAt=null;confirmedBy='';
    }

    const payload={
      month_key:monthAtSave,
      item_id:item.id,
      item_name:item.name,
      note:nextNote,
      manual_ok:manualOk,
      confirmed_diff:confirmedDiff,
      confirmed_signature:confirmedSignature,
      confirmed_at:confirmedAt,
      confirmed_by:confirmedBy,
      updated_by:typeof userEmail==='function'?userEmail():'',
      updated_at:new Date().toISOString()
    };
    const {data,error}=await retryResult(()=>sb.from('monthly_reconciliation_review')
      .upsert(payload,{onConflict:'month_key,item_id'})
      .select()
      .single());
    if(error){
      console.error('月结备注 / 人工确认保存失败',error);
      return false;
    }
    updateReviewLocal(itemId,data||payload,monthAtSave);
    renderReviewDetails();
    return true;
  }

  async function clearStaleManualOks(rows){
    if(isSelectedMonthLocked())return;
    const stale=(rows||[]).filter(r=>r.manualOkStale);
    stale.forEach(async r=>{
      const key=selectedMonth+'|'+String(r.item.id);
      if(staleReviewClearing.has(key))return;
      staleReviewClearing.add(key);
      try{
        const {error}=await sb.from('monthly_reconciliation_review')
          .update({
            manual_ok:false,
            confirmed_diff:null,
            confirmed_signature:null,
            confirmed_at:null,
            confirmed_by:'',
            updated_at:new Date().toISOString()
          })
          .eq('month_key',selectedMonth)
          .eq('item_id',r.item.id);
        if(!error)updateReviewLocal(r.item.id,{
          manual_ok:false,
          confirmed_diff:null,
          confirmed_signature:null,
          confirmed_at:null,
          confirmed_by:''
        });
      }catch(e){
        console.warn('过期人工确认自动取消失败',e);
      }finally{
        staleReviewClearing.delete(key);
      }
    });
  }

  async function toggleManualOk(itemId){
    if(isSelectedMonthLocked())return alert('这个月份已经锁定，需由 Admin 重新开启后才能修改。');
    const row=computeRows(draftFromInputs()).find(r=>String(r.item.id)===String(itemId));
    if(!row)return;

    if(!row.reviewable){
      alert('只有系统状态为 CHECK、并且存在实际对账差异时，才需要人工确认 OK。');
      return;
    }

    const next=!row.manualOk;
    if(next&&!String(row.reviewNote||'').trim()){
      const input=document.querySelector('.recon-review-note[data-item-id="'+String(itemId)+'"]');
      if(input)input.focus();
      alert('请先填写备注说明为什么这笔差异可以确认 OK。');
      return;
    }

    const now=new Date().toISOString();
    const who=typeof userEmail==='function'?userEmail():'';
    const changes=next?{
      manual_ok:true,
      confirmed_diff:clean(row.diff),
      confirmed_signature:row.reviewSignature,
      confirmed_at:now,
      confirmed_by:who
    }:{
      manual_ok:false,
      confirmed_diff:null,
      confirmed_signature:null,
      confirmed_at:null,
      confirmed_by:''
    };

    updateReviewLocal(itemId,changes);
    const ok=await saveReview(itemId,changes);
    if(!ok){
      await loadData();
      alert('人工确认保存失败，请重试。');
      return;
    }
    render(true);
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
        '状态':'本月尚未结束',
        '备注':'',
        '人工确认':''
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
        '状态':excelStatus(r),
        '备注':r.reviewNote||'',
        '人工确认':r.manualOk?'OK':''
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

      XLSX.writeFile(wb,`月结核对_${selectedMonth}.xlsx`);
    }catch(e){
      alert('导出失败：'+String(e?.message||e));
    }finally{
      btn.disabled=false;btn.textContent=old||'导出 Excel';
    }
  }

  async function clearPos(){
    if(isSelectedMonthLocked())return alert('这个月份已经锁定，需由 Admin 重新开启后才能修改。');
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
    if(isSelectedMonthLocked())return;
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
    if(isSelectedMonthLocked())return false;
    if(!pending)return false;
    const {itemId,raw,monthAtSave}=pending;
    const item=historyItemById(itemId);if(!item)return;

    const q=Number(raw);
    if(!Number.isFinite(q)||q<0){
      setAutoSaveStatus('POS 数量不正确','error');
      return false;
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

    const {data,error}=await retryResult(()=>sb.from('monthly_pos_sales')
      .upsert(payload,{onConflict:'month_key,item_id'})
      .select()
      .single());

    if(error){
      setAutoSaveStatus('自动保存失败','error');
      console.error('POS auto-save failed',error);
      return false;
    }

    const idx=posRows.findIndex(r=>String(r.item_id)===String(itemId)&&r.month_key===monthAtSave);
    if(idx>=0)posRows[idx]=data||payload;else posRows.push(data||payload);

    const latest=pendingPosSaves.get(String(itemId));
    if(latest&&latest.raw===raw&&latest.monthAtSave===monthAtSave){
      pendingPosSaves.delete(String(itemId));
    }
    setAutoSaveStatus('已自动保存 ✓','saved');
    return true;
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
    if(isSelectedMonthLocked())return alert('这个月份已经锁定，需由 Admin 重新开启后才能修改。');
    const btn=document.getElementById('reconSavePos');if(!btn)return;
    const draft=draftFromInputs();
    const upserts=[];

    // 保存按钮用于“整月一次性确认”：
    // 已填写的沿用输入值；未录入的所有产品统一保存为 0。
    const monthItems=computeRows(draft).map(r=>r.item);
    for(const item of monthItems){
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
        const {error}=await retryResult(()=>sb.from('monthly_pos_sales').upsert(upserts,{onConflict:'month_key,item_id'}));
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
.recon-controls{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;background:#f8fafc}.recon-control-left{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.recon-controls label{font-size:12px;color:#667085;font-weight:700;display:flex;flex-direction:column;gap:6px;min-width:190px}.recon-controls select,.recon-controls input{min-height:42px}.recon-search-label{min-width:260px!important}.recon-control-actions{display:flex;gap:8px;align-items:center}.recon-control-actions button{min-height:42px}.recon-autosave-status{display:inline-flex;align-items:center;min-height:42px;padding:0 12px;border-radius:10px;background:#eef2f6;color:#667085;font-size:13px;font-weight:700;white-space:nowrap}.recon-autosave-status[data-state="saving"],.recon-autosave-status[data-state="pending"]{color:#b7791f}.recon-autosave-status[data-state="saved"]{color:#087f5b;background:#edf9f4}.recon-autosave-status[data-state="error"]{color:#c92a2a;background:#fff1f1}.recon-lock-status{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 12px;border-radius:10px;background:#eef2f6;color:#667085;font-size:13px;font-weight:700;white-space:nowrap}.recon-lock-status[data-state="locked"]{background:#edf9f4;color:#087f5b}.recon-lock-status[data-state="open"]{background:#fff7e6;color:#b7791f}.recon-lock-status[data-state="current"]{background:#eef2f6;color:#667085}.recon-pos-error{border-color:#c92a2a!important;box-shadow:0 0 0 2px rgba(201,42,42,.08)!important}
.recon-summary{display:grid;grid-template-columns:repeat(6,minmax(150px,1fr));gap:10px;margin-bottom:12px}.recon-summary .card{padding:13px 14px}.recon-summary small{display:block;color:#667085}.recon-summary b{display:block;margin-top:5px;font-size:24px;color:#173b5e}
.recon-guide{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;background:#f7f9fc;color:#475467;font-size:13px;line-height:1.6}.recon-guide b{color:#173b5e;white-space:nowrap}
.recon-card{padding:14px;margin-top:12px}.recon-card .section-head h3{margin:0;font-size:17px}.recon-sort-btn{background:none!important;color:#667085!important;padding:0!important;border:0!important;border-radius:0!important;font-size:12px!important;font-weight:700!important;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.recon-sort-btn:hover{color:#173b5e!important}.recon-sort-arrow{font-size:10px;min-width:10px;text-align:center}.recon-ent-head{background:#eef1f4!important;color:#59636e!important}.recon-table tbody td.recon-ent-col{background:#f3f4f6}.recon-ent-actual-input{width:100%;min-width:0;max-width:100%;min-height:34px;padding:6px 8px;background:#fff!important;box-sizing:border-box}.recon-ent-diff{font-weight:700}.recon-table{table-layout:fixed;width:100%;min-width:100%}.recon-table thead th{position:sticky}
.recon-col-resizer{position:absolute;right:-7px;top:0;width:14px;height:100%;cursor:col-resize;z-index:30;user-select:none;touch-action:none;background:transparent}
.recon-col-resizer::after{content:"";position:absolute;left:6px;top:18%;width:2px;height:64%;border-radius:2px;background:#d7dde5;opacity:.35;transition:opacity .15s,background .15s,width .15s,box-shadow .15s}
.recon-col-resizer:hover::after,.recon-col-resizer.is-active::after{width:3px;background:#173b5e;opacity:.75;box-shadow:0 0 0 2px rgba(23,59,94,.08)}
.recon-table thead th.recon-resizing-col{background:#edf3f8!important;box-shadow:inset -2px 0 0 rgba(23,59,94,.18)}
body.recon-resizing{cursor:col-resize!important;user-select:none!important}body.recon-resizing *{cursor:col-resize!important}
.recon-resize-guide{position:absolute;width:2px;background:#173b5e;opacity:.65;z-index:25;pointer-events:none;box-shadow:0 0 0 1px rgba(255,255,255,.7)}
.recon-resize-bubble{position:absolute;z-index:26;pointer-events:none;background:#17324d;color:#fff;border-radius:7px;padding:4px 7px;font-size:11px;font-weight:700;line-height:1;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.18)}
.recon-table-head{position:relative;min-height:32px}.recon-month-title{position:absolute;left:50%;transform:translateX(-50%);font-size:18px;font-weight:800;color:#173b5e;white-space:nowrap}
.recon-review-detail-card{padding:14px;margin-top:12px}
.recon-review-detail-card .section-head{align-items:flex-start}
.recon-review-detail-card .section-head h3{margin:0;font-size:17px}
.recon-review-detail-wrap{max-height:34vh;overflow:auto}
.recon-review-detail-table{min-width:900px}
.recon-review-detail-table thead th{position:sticky;top:0;z-index:3;background:#f8fafc!important;white-space:nowrap}
.recon-review-detail-table th:nth-child(2),.recon-review-detail-table td:nth-child(2),.recon-review-detail-table th:nth-child(3),.recon-review-detail-table td:nth-child(3),.recon-review-detail-table th:nth-child(5),.recon-review-detail-table td:nth-child(5){text-align:center}
.recon-review-detail-note{white-space:normal!important;min-width:280px;line-height:1.5}
.recon-review-ok-badge{display:inline-flex;align-items:center;justify-content:center;padding:4px 10px;border-radius:999px;background:#edf9f4;color:#087f5b;font-weight:700}
.recon-table-meta{display:flex;align-items:center;justify-content:flex-end;gap:9px;min-width:0}.recon-table-meta .hint{margin-top:0;white-space:nowrap}
.recon-table-wrap{position:relative;max-height:64vh;overflow:auto}.recon-table{min-width:100%}.recon-table thead th{position:sticky;top:0;z-index:4;background:#f8fafc!important;white-space:nowrap;overflow:visible;text-overflow:clip}
.recon-table thead th:first-child{left:0;z-index:8;box-shadow:2px 0 0 #e5e7eb}
.recon-table tbody td:first-child{position:sticky;left:0;z-index:2;background:#fff;box-shadow:2px 0 0 #e5e7eb}
.recon-table tbody tr.recon-alert-row td:first-child{background:#fff7f5}
.recon-table td{vertical-align:middle;white-space:nowrap}.recon-name-cell{overflow:hidden}.recon-name-cell>b{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recon-table thead th:nth-child(n+3),.recon-table tbody td:nth-child(n+3){text-align:center}.recon-table thead th:nth-child(1),.recon-table thead th:nth-child(2),.recon-table tbody td:nth-child(1),.recon-table tbody td:nth-child(2){text-align:left}.recon-pos-input,.recon-ent-actual-input{text-align:center}.recon-pos-input{width:100%;min-width:0;max-width:100%;min-height:36px;padding:7px 8px;box-sizing:border-box}.recon-review-note{width:100%;min-width:0;min-height:34px;padding:6px 8px;box-sizing:border-box}.recon-manual-ok{min-width:72px;padding:6px 9px;background:#e9edf2;color:#475467;font-size:12px}.recon-manual-ok.is-ok{background:#087f5b;color:#fff}.recon-sub{font-size:11px;color:#98a2b3;margin-top:3px}.recon-ok{color:#087f5b;font-weight:700}.recon-bad{color:#c92a2a;font-weight:700}.recon-warn{color:#b7791f;font-weight:700}.recon-muted{color:#98a2b3}.recon-alert-row{background:#fff7f5}
@media(max-width:1100px){.recon-summary{grid-template-columns:repeat(2,1fr)}.recon-controls{align-items:stretch;flex-direction:column}.recon-control-left{width:100%}.recon-search-label{flex:1}.recon-control-actions{justify-content:flex-end}}
@media(max-width:620px){.recon-summary{grid-template-columns:1fr 1fr}.recon-control-actions{display:grid;grid-template-columns:1fr 1fr}.recon-control-actions button{width:100%}.recon-guide{display:block}.recon-guide b{display:block;margin-bottom:4px}}
`;document.head.appendChild(s);
  }

  window.refreshMonthlyReconciliation=loadData;
  wait();
})();