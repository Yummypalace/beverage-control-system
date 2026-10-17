// 月结核对：按实际库存减少与 POS + 特殊用途逐项对照。
// POS 销量为独立数据源，只用于月结对账，不会修改库存。
(function(){
  'use strict';

  let installed=false;
  let allLogs=[];
  let posRows=[];
  let loading=false;
  let selectedMonth='';

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
    const after=s.match(/调整后\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return {before:before?num(before[1])+num(before[2]):null,after:after?num(after[1])+num(after[2]):null};
  }
  function parseAdjust(note){
    const s=String(note||'');
    const before=s.match(/调整前\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    const after=s.match(/调整后\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return {before:before?num(before[1]):null,after:after?num(after[1]):null};
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
        <label>月份<select id="reconMonth"></select></label>
        <div class="recon-control-actions">
          <button id="reconReload" class="secondary">重新计算</button>
          <button id="reconSavePos">保存 POS 销量</button>
        </div>
      </div>

      <div class="recon-summary">
        <div class="card"><small>本月实际减少</small><b id="reconSoldTotal">0</b></div>
        <div class="card"><small>POS 销量</small><b id="reconPosTotal">0</b></div>
        <div class="card"><small>特殊用途 / 借出净额</small><b id="reconSpecialTotal">0</b></div>
        <div class="card"><small>待查差异</small><b id="reconIssueTotal">0</b></div>
      </div>

      <div class="card recon-guide">
        <b>核对公式：</b>
        <span>上月结存 + 本月入库 − 本月结存 = 本月实际减少；本月实际减少应等于 POS 销量 + ENT + FOC + 厨房使用 + NO Paid + 取消入库 + 其他 + 借出 − 还回。</span>
      </div>

      <div class="card recon-card">
        <div class="section-head">
          <h3>库存 / POS 月结对照</h3>
          <span id="reconInventoryDateHint" class="hint"></span>
        </div>
        <div class="tablewrap recon-table-wrap">
          <table class="recon-table">
            <thead><tr>
              <th>饮料</th>
              <th>上月结存</th>
              <th>本月结存</th>
              <th>本月入库</th>
              <th>本月实际减少</th>
              <th>POS 销量</th>
              <th>ENT</th>
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
            <tbody id="reconInventoryBody"><tr><td colspan="16">读取中...</td></tr></tbody>
          </table>
        </div>
      </div>`;
    content.appendChild(section);

    document.getElementById('reconMonth').onchange=()=>{
      selectedMonth=document.getElementById('reconMonth').value||currentMonth();
      render();
    };
    document.getElementById('reconReload').onclick=loadData;
    document.getElementById('reconSavePos').onclick=savePos;
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

  async function loadData(){
    if(loading)return;loading=true;
    const status=document.getElementById('reconStatus');
    const body=document.getElementById('reconInventoryBody');
    if(body)body.innerHTML='<tr><td colspan="16">读取中...</td></tr>';
    if(status)status.textContent='读取中...';
    try{
      const [logs,pos]=await Promise.all([
        fetchAll('inventory_logs',q=>q.order('operation_date',{ascending:true}).order('created_at',{ascending:true})),
        fetchAll('monthly_pos_sales',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true}))
      ]);
      allLogs=logs;posRows=pos;populateMonths();render();
      if(status)status.textContent='已更新';
    }catch(e){
      if(body)body.innerHTML=`<tr><td colspan="16">读取失败：${h(e.message||e)}</td></tr>`;
      if(status)status.textContent='读取失败';
    }finally{loading=false;}
  }

  function populateMonths(){
    const select=document.getElementById('reconMonth');if(!select)return;
    const months=new Set([currentMonth()]);
    allLogs.forEach(r=>{const m=monthOf(r);if(/^\d{4}-\d{2}$/.test(m)&&m>='2026-09')months.add(m);});
    posRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||'')&&r.month_key>='2026-09')months.add(r.month_key);});
    const list=[...months].sort((a,b)=>b.localeCompare(a));
    if(!selectedMonth||!months.has(selectedMonth))selectedMonth=currentMonth();
    select.innerHTML=list.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    select.value=selectedMonth;
  }

  function snapshotAt(cutoff){
    const states=new Map();
    items.forEach(x=>states.set(String(x.id),{total:num(x.fridge_quantity)+num(x.warehouse_quantity),exists:true,uncertain:false}));
    allLogs.filter(r=>dateOf(r)>cutoff).sort(reverseLogSort).forEach(r=>{
      const s=states.get(String(r.item_id||''));if(!s||!s.exists)return;
      const q=num(r.quantity),action=String(r.action||''),note=String(r.note||'');
      if(action==='IN'||action==='RETURN')s.total-=q;
      else if(action==='OUT'||action==='BORROW')s.total+=q;
      else if(action==='CREATE'){s.total=0;s.exists=false;}
      else if(action==='EDIT'){
        const p=parseEdit(note);if(p.before!==null)s.total=p.before;else s.uncertain=true;
      }else if(action==='ADJUST'){
        const p=parseAdjust(note);
        if(p.before!==null&&p.after!==null)s.total-=p.after-p.before;
        else s.uncertain=true;
      }
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
    document.querySelectorAll('#reconInventoryBody input[data-item-id]').forEach(i=>draft[i.dataset.itemId]=i.value);
    return draft;
  }

  function computeRows(draftPos){
    const open=snapshotAt(previousMonthEnd(selectedMonth));
    const close=snapshotAt(monthEnd(selectedMonth));
    const stats=monthStats();
    const pmap=posMap();

    return [...items].sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(item=>{
      const s=stats.get(String(item.id))||{inbound:0,ent:0,foc:0,kitchen:0,noPaid:0,cancelIn:0,borrow:0,returned:0,other:0};
      const openState=open.get(String(item.id));
      const closeState=close.get(String(item.id));
      const opening=openState&&openState.exists?num(openState.total):0;
      const closing=closeState&&closeState.exists?num(closeState.total):0;
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

      const explained=posValue===null?null:posValue+s.ent+s.foc+s.kitchen+s.noPaid+s.cancelIn+s.other+s.borrow-s.returned;
      const diff=explained===null?null:sold-explained;
      const uncertain=!!(openState?.uncertain||closeState?.uncertain);
      return {item,...s,opening,closing,sold,posValue,explained,diff,uncertain};
    });
  }

  function diffText(v,uncertain){
    if(uncertain)return '<span class="recon-muted">需核对旧记录</span>';
    if(v===null||v===undefined)return '<span class="recon-muted">待录入 POS</span>';
    const n=clean(v);
    if(Math.abs(n)<0.000001)return '<span class="recon-ok">0</span>';
    return n>0?`<span class="recon-bad">少解释 ${n}</span>`:`<span class="recon-warn">多解释 ${Math.abs(n)}</span>`;
  }

  function statusText(r){
    if(r.uncertain)return '<span class="recon-muted">CHECK</span>';
    if(r.diff===null)return '<span class="recon-muted">待填 POS</span>';
    return Math.abs(num(r.diff))<0.000001?'<span class="recon-ok">OK</span>':'<span class="recon-bad">CHECK</span>';
  }

  function render(preserveInputs=false){
    const body=document.getElementById('reconInventoryBody');if(!body)return;
    const draft=preserveInputs?draftFromInputs():null;
    const rows=computeRows(draft);

    body.innerHTML=rows.map(r=>{
      const input=r.posValue===null?'':clean(r.posValue);
      const alert=!r.uncertain&&r.diff!==null&&Math.abs(r.diff)>0.000001;
      return `<tr class="${alert?'recon-alert-row':''}">
        <td><b>${h(r.item.name)}</b><div class="recon-sub">${h(r.item.unit||'')}</div></td>
        <td>${clean(r.opening)}</td>
        <td>${clean(r.closing)}</td>
        <td>${clean(r.inbound)}</td>
        <td><b>${clean(r.sold)}</b></td>
        <td><input class="recon-pos-input" data-item-id="${h(r.item.id)}" type="number" min="0" step="0.01" value="${h(input)}" placeholder="未录入"></td>
        <td>${clean(r.ent)}</td>
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
    }).join('')||'<tr><td colspan="16">暂无饮料资料</td></tr>';

    document.querySelectorAll('#reconInventoryBody .recon-pos-input').forEach(input=>input.addEventListener('change',()=>render(true)));

    const isCurrent=selectedMonth===currentMonth();
    const hint=document.getElementById('reconInventoryDateHint');
    if(hint)hint.textContent=isCurrent?'本月结存使用当前库存（本月尚未结束）':`本月结存还原至 ${monthEnd(selectedMonth)} 营业结束`;

    updateSummary(rows);
  }

  function updateSummary(rows){
    const sold=clean(rows.reduce((s,r)=>s+r.sold,0));
    const pos=clean(rows.reduce((s,r)=>s+(r.posValue===null?0:r.posValue),0));
    const special=clean(rows.reduce((s,r)=>s+r.ent+r.foc+r.kitchen+r.noPaid+r.cancelIn+r.other+r.borrow-r.returned,0));
    const issue=clean(rows.reduce((s,r)=>s+(r.uncertain||r.diff===null?0:Math.abs(num(r.diff))),0));
    document.getElementById('reconSoldTotal').textContent=sold;
    document.getElementById('reconPosTotal').textContent=pos;
    document.getElementById('reconSpecialTotal').textContent=special;
    document.getElementById('reconIssueTotal').textContent=issue;
  }

  async function savePos(){
    const btn=document.getElementById('reconSavePos');if(!btn)return;
    const inputs=[...document.querySelectorAll('#reconInventoryBody input[data-item-id]')];
    const byId=new Map(items.map(x=>[String(x.id),x]));
    const existing=new Map(posRows.filter(r=>r.month_key===selectedMonth).map(r=>[String(r.item_id),r]));
    const upserts=[],deletes=[];

    for(const input of inputs){
      const item=byId.get(String(input.dataset.itemId));if(!item)continue;
      const raw=input.value.trim();
      const q=raw===''?0:Number(raw);
      if(!Number.isFinite(q)||q<0)return alert(`${item.name} 的 POS 数量不正确`);
      upserts.push({month_key:selectedMonth,item_id:item.id,item_name:item.name,pos_quantity:q,updated_by:typeof userEmail==='function'?userEmail():'',updated_at:new Date().toISOString()});
    }

    btn.disabled=true;btn.textContent='保存中...';
    try{
      if(upserts.length){const {error}=await sb.from('monthly_pos_sales').upsert(upserts,{onConflict:'month_key,item_id'});if(error)throw error;}
      if(deletes.length){const {error}=await sb.from('monthly_pos_sales').delete().eq('month_key',selectedMonth).in('item_id',deletes);if(error)throw error;}
      await loadData();alert(`${monthLabel(selectedMonth)} POS 销量已保存。库存数量没有改变。`);
    }catch(e){alert('保存失败：'+(e.message||e));}
    finally{btn.disabled=false;btn.textContent='保存 POS 销量';}
  }

  function addStyle(){
    if(document.getElementById('monthlyReconciliationStyle'))return;
    const s=document.createElement('style');s.id='monthlyReconciliationStyle';s.textContent=`
#monthlyReconciliation{padding:0 2px 24px}
.recon-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:4px 0 14px}.recon-head h2{margin:0 0 4px;font-size:22px;color:#102a43}.recon-head>span{font-size:13px;color:#667085;padding-top:5px}
.recon-controls{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;background:#f8fafc}.recon-controls label{font-size:12px;color:#667085;font-weight:700;display:flex;flex-direction:column;gap:6px;min-width:190px}.recon-controls select{min-height:42px}.recon-control-actions{display:flex;gap:8px}.recon-control-actions button{min-height:42px}
.recon-summary{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;margin-bottom:12px}.recon-summary .card{padding:13px 14px}.recon-summary small{display:block;color:#667085}.recon-summary b{display:block;margin-top:5px;font-size:24px;color:#173b5e}
.recon-guide{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;background:#f7f9fc;color:#475467;font-size:13px;line-height:1.6}.recon-guide b{color:#173b5e;white-space:nowrap}
.recon-card{padding:14px;margin-top:12px}.recon-card .section-head h3{margin:0;font-size:17px}.recon-table-wrap{max-height:64vh;overflow:auto}.recon-table{min-width:1780px}.recon-table thead th{position:sticky;top:0;z-index:4;background:#f8fafc!important;white-space:nowrap}.recon-table td{vertical-align:middle;white-space:nowrap}.recon-pos-input{width:92px;min-height:36px;padding:7px 8px}.recon-sub{font-size:11px;color:#98a2b3;margin-top:3px}.recon-ok{color:#087f5b;font-weight:700}.recon-bad{color:#c92a2a;font-weight:700}.recon-warn{color:#b7791f;font-weight:700}.recon-muted{color:#98a2b3}.recon-alert-row{background:#fff7f5}
@media(max-width:1100px){.recon-summary{grid-template-columns:repeat(2,1fr)}.recon-controls{align-items:stretch;flex-direction:column}.recon-control-actions{justify-content:flex-end}}
@media(max-width:620px){.recon-summary{grid-template-columns:1fr 1fr}.recon-control-actions{display:grid;grid-template-columns:1fr 1fr}.recon-control-actions button{width:100%}.recon-guide{display:block}.recon-guide b{display:block;margin-bottom:4px}}
`;document.head.appendChild(s);
  }

  window.refreshMonthlyReconciliation=loadData;
  wait();
})();