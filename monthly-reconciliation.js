// 月结核对：库存账与 POS 账分开核对。
// 库存：上月结存 + 本月入库 - 正常销售 - 签单 - 非销售用途 + 其他更正 = 理论结存。
// POS：只用于核对销售入账，不会改变库存；POS 多出的数量优先抵扣历史待入 POS 签单。
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
  function previousMonth(month){const [y,m]=String(month||'').split('-').map(Number);if(!y||!m)return '';const d=new Date(Date.UTC(y,m-2,1));return d.toISOString().slice(0,7);}
  function previousMonthEnd(month){return monthEnd(previousMonth(month));}
  function reverseLogSort(a,b){const da=dateOf(a),db=dateOf(b);if(da!==db)return db.localeCompare(da);const ca=String(a.created_at||''),cb=String(b.created_at||'');if(ca!==cb)return cb.localeCompare(ca);return Number(b.id||0)-Number(a.id||0);}

  function detectOutType(r){
    if(r.out_type)return r.out_type;
    const raw=String(r.note||'');
    const s=raw.toLowerCase();
    if(raw.includes('签单')||raw.includes('挂账'))return 'CREDIT';
    if(/(^|[^a-z])foc([^a-z]|$)/i.test(raw)||s.includes('complimentary')||raw.includes('免费'))return 'FOC';
    if(raw.includes('厨房')||s.includes('kitchen'))return 'KITCHEN';
    if(raw.includes('员工')||s.includes('staff'))return 'STAFF';
    if(/(^|[^a-z])ent([\s\-_/]|$)/i.test(raw)||s.includes('entertain')||raw.includes('招待'))return 'ENT';
    return 'NORMAL';
  }

  function parseEdit(note){
    const s=String(note||'');
    const before=s.match(/调整前\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    const after=s.match(/调整后\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return {
      before:before?num(before[1])+num(before[2]):null,
      after:after?num(after[1])+num(after[2]):null
    };
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
          <div class="hint">先核对库存是否正确，再核对 POS。POS 销量只用于对账，不会修改库存。</div>
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
        <div class="card"><small>库存待查差异</small><b id="reconStockIssueTotal">0</b></div>
        <div class="card"><small>本月签单</small><b id="reconCreditTotal">0</b></div>
        <div class="card"><small>月底待入 POS</small><b id="reconOutstandingTotal">0</b></div>
        <div class="card"><small>POS 待查差异</small><b id="reconPosIssueTotal">0</b></div>
      </div>

      <div class="card recon-guide">
        <b>库存公式：</b>
        <span>上月结存 + 本月入库 − 正常销售 − 签单 − 非销售用途 + 其他更正 = 理论结存；再用理论结存和月底实际库存比较，差额才是需要查的库存问题。</span>
      </div>

      <div class="card recon-card">
        <div class="section-head">
          <h3>① 库存核对</h3>
          <span id="reconInventoryDateHint" class="hint"></span>
        </div>
        <div class="tablewrap recon-table-wrap">
          <table class="recon-table recon-inventory-table">
            <thead><tr>
              <th>饮料</th>
              <th>上月结存</th>
              <th>本月入库</th>
              <th>正常销售</th>
              <th>签单</th>
              <th>非销售用途</th>
              <th>其他更正</th>
              <th>理论结存</th>
              <th>实际结存</th>
              <th>库存差异</th>
            </tr></thead>
            <tbody id="reconInventoryBody"><tr><td colspan="10">读取中...</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="card recon-card">
        <div class="section-head">
          <h3>② POS 核对</h3>
          <span class="hint">填写当月 POS 总销量；不会增加或扣减库存。</span>
        </div>
        <div class="tablewrap recon-table-wrap">
          <table class="recon-table recon-pos-table">
            <thead><tr>
              <th>饮料</th>
              <th>本月正常销售</th>
              <th>本月签单</th>
              <th>上月待入 POS</th>
              <th>POS 月销量</th>
              <th>自动抵扣签单</th>
              <th>月底待入 POS</th>
              <th>POS 待查</th>
            </tr></thead>
            <tbody id="reconPosBody"><tr><td colspan="8">读取中...</td></tr></tbody>
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
    const inv=document.getElementById('reconInventoryBody');
    const posBody=document.getElementById('reconPosBody');
    if(inv)inv.innerHTML='<tr><td colspan="10">读取中...</td></tr>';
    if(posBody)posBody.innerHTML='<tr><td colspan="8">读取中...</td></tr>';
    if(status)status.textContent='读取中...';
    try{
      const [logs,pos]=await Promise.all([
        fetchAll('inventory_logs',q=>q.order('operation_date',{ascending:true}).order('created_at',{ascending:true})),
        fetchAll('monthly_pos_sales',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true}))
      ]);
      allLogs=logs;posRows=pos;populateMonths();render();
      if(status)status.textContent='已更新';
    }catch(e){
      const msg=h(e.message||e);
      if(inv)inv.innerHTML=`<tr><td colspan="10">读取失败：${msg}</td></tr>`;
      if(posBody)posBody.innerHTML=`<tr><td colspan="8">读取失败：${msg}</td></tr>`;
      if(status)status.textContent='读取失败';
    }finally{loading=false;}
  }

  function populateMonths(){
    const select=document.getElementById('reconMonth');if(!select)return;
    const months=new Set([currentMonth()]);
    allLogs.forEach(r=>{const m=monthOf(r);if(/^\d{4}-\d{2}$/.test(m))months.add(m);});
    posRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||''))months.add(r.month_key);});
    const list=[...months].sort((a,b)=>b.localeCompare(a));
    if(!selectedMonth||!months.has(selectedMonth))selectedMonth=currentMonth();
    select.innerHTML=list.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    select.value=selectedMonth;
  }

  function snapshotAt(cutoff){
    const states=new Map();
    items.forEach(x=>states.set(String(x.id),{total:num(x.fridge_quantity)+num(x.warehouse_quantity),exists:true,uncertain:false}));
    allLogs.filter(r=>dateOf(r)>cutoff).sort(reverseLogSort).forEach(r=>{
      const key=String(r.item_id||'');const s=states.get(key);if(!s||!s.exists)return;
      const q=num(r.quantity),action=String(r.action||''),note=String(r.note||'');
      if(action==='IN')s.total-=q;
      else if(action==='OUT')s.total+=q;
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
    function ensure(itemId,itemName){
      const key=String(itemId||itemName||'');
      if(!map.has(key))map.set(key,{inbound:0,normal:0,credit:0,nonSale:0,otherNet:0,adjustNet:0});
      return map.get(key);
    }
    allLogs.forEach(r=>{
      if(monthOf(r)!==selectedMonth)return;
      const s=ensure(r.item_id,r.item_name);
      const action=String(r.action||''),q=num(r.quantity),note=String(r.note||'');

      if(r.correction_ref){
        if(action==='IN')s.otherNet+=q;
        else if(action==='OUT')s.otherNet-=q;
        return;
      }

      if(action==='IN'){s.inbound+=q;return;}
      if(action==='OUT'){
        const type=detectOutType(r);
        if(type==='CREDIT')s.credit+=q;
        else if(type==='NORMAL')s.normal+=q;
        else s.nonSale+=q;
        return;
      }
      if(action==='CREATE'){s.otherNet+=q;return;}
      if(action==='EDIT'){
        const p=parseEdit(note);
        if(p.before!==null&&p.after!==null)s.otherNet+=p.after-p.before;
        return;
      }
      if(action==='ADJUST'){
        const p=parseAdjust(note);
        if(p.before!==null&&p.after!==null)s.adjustNet+=p.after-p.before;
      }
    });
    return map;
  }

  function posMap(){const map=new Map();posRows.forEach(r=>map.set(`${r.item_id}|${r.month_key}`,r));return map;}
  function sortedMonthsUpTo(target){
    const set=new Set([target]);
    allLogs.forEach(r=>{const m=monthOf(r);if(m&&m<=target)set.add(m);});
    posRows.forEach(r=>{const m=r.month_key;if(m&&m<=target)set.add(m);});
    return [...set].sort();
  }

  function posHistoryForItem(item,draftPos){
    const months=sortedMonthsUpTo(selectedMonth);
    const pmap=posMap();
    let balance=0,selected=null;

    months.forEach(month=>{
      let normal=0,credit=0;
      allLogs.forEach(r=>{
        if(String(r.item_id)!==String(item.id)||monthOf(r)!==month||String(r.action)!=='OUT'||r.correction_ref)return;
        const t=detectOutType(r),q=num(r.quantity);
        if(t==='NORMAL')normal+=q;else if(t==='CREDIT')credit+=q;
      });

      const previous=balance;
      const available=previous+credit;
      let posValue=null;
      if(month===selectedMonth&&draftPos&&Object.prototype.hasOwnProperty.call(draftPos,item.id)){
        const raw=draftPos[item.id];posValue=raw===''?null:num(raw);
      }else{
        const saved=pmap.get(`${item.id}|${month}`);posValue=saved?num(saved.pos_quantity):null;
      }

      let settled=0,issue=null;
      if(posValue!==null){
        const excess=Math.max(posValue-normal,0);
        settled=Math.min(available,excess);
        issue=posValue-normal-settled;
        balance=available-settled;
      }else balance=available;

      if(month===selectedMonth)selected={previous,normal,credit,posValue,settled,ending:balance,issue};
    });
    return selected||{previous:0,normal:0,credit:0,posValue:null,settled:0,ending:0,issue:null};
  }

  function draftFromInputs(){
    const draft={};
    document.querySelectorAll('#reconPosBody input[data-item-id]').forEach(i=>draft[i.dataset.itemId]=i.value);
    return draft;
  }

  function computeRows(draftPos){
    const open=snapshotAt(previousMonthEnd(selectedMonth));
    const close=snapshotAt(monthEnd(selectedMonth));
    const stats=monthStats();
    return [...items].sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(item=>{
      const s=stats.get(String(item.id))||{inbound:0,normal:0,credit:0,nonSale:0,otherNet:0,adjustNet:0};
      const openState=open.get(String(item.id));
      const closeState=close.get(String(item.id));
      const opening=openState&&openState.exists?num(openState.total):0;
      const actual=closeState&&closeState.exists?num(closeState.total):0;
      const theoretical=opening+s.inbound-s.normal-s.credit-s.nonSale+s.otherNet;
      const stockDiff=actual-theoretical;
      const pos=posHistoryForItem(item,draftPos);
      return {item,...s,opening,actual,theoretical,stockDiff,uncertain:!!(openState?.uncertain||closeState?.uncertain),pos};
    });
  }

  function diffText(v,uncertain){
    if(uncertain)return '<span class="recon-muted">需核对旧记录</span>';
    const n=clean(v);
    if(Math.abs(n)<0.000001)return '<span class="recon-ok">0</span>';
    if(n<0)return `<span class="recon-bad">短缺 ${Math.abs(n)}</span>`;
    return `<span class="recon-warn">多 ${n}</span>`;
  }
  function posIssueText(v){
    if(v===null||v===undefined)return '<span class="recon-muted">待录入 POS</span>';
    const n=clean(v);
    if(Math.abs(n)<0.000001)return '<span class="recon-ok">0</span>';
    if(n>0)return `<span class="recon-bad">POS 多 ${n}</span>`;
    return `<span class="recon-bad">POS 少 ${Math.abs(n)}</span>`;
  }

  function render(preserveInputs=false){
    const invBody=document.getElementById('reconInventoryBody');
    const posBody=document.getElementById('reconPosBody');
    if(!invBody||!posBody)return;
    const draft=preserveInputs?draftFromInputs():null;
    const rows=computeRows(draft);

    invBody.innerHTML=rows.map(r=>{
      const alert=!r.uncertain&&Math.abs(r.stockDiff)>0.000001;
      return `<tr class="${alert?'recon-alert-row':''}">
        <td><b>${h(r.item.name)}</b><div class="recon-sub">${h(r.item.unit||'')}</div></td>
        <td>${clean(r.opening)}</td>
        <td>${clean(r.inbound)}</td>
        <td>${clean(r.normal)}</td>
        <td>${r.credit?'<b class="recon-credit">'+clean(r.credit)+'</b>':'0'}</td>
        <td>${clean(r.nonSale)}</td>
        <td>${r.otherNet?clean(r.otherNet):'0'}</td>
        <td><b>${clean(r.theoretical)}</b></td>
        <td><b>${clean(r.actual)}</b></td>
        <td>${diffText(r.stockDiff,r.uncertain)}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="10">暂无饮料资料</td></tr>';

    posBody.innerHTML=rows.map(r=>{
      const p=r.pos,input=p.posValue===null?'':clean(p.posValue);
      return `<tr class="${p.issue!==null&&Math.abs(p.issue)>0.000001?'recon-alert-row':''}">
        <td><b>${h(r.item.name)}</b></td>
        <td>${clean(p.normal)}</td>
        <td>${p.credit?'<b class="recon-credit">'+clean(p.credit)+'</b>':'0'}</td>
        <td>${p.previous?'<b>'+clean(p.previous)+'</b>':'0'}</td>
        <td><input class="recon-pos-input" data-item-id="${h(r.item.id)}" type="number" min="0" step="0.01" value="${h(input)}" placeholder="未录入"></td>
        <td>${p.settled?'<b class="recon-ok">'+clean(p.settled)+'</b>':'0'}</td>
        <td>${p.ending?'<b class="recon-credit">'+clean(p.ending)+'</b>':'0'}</td>
        <td>${posIssueText(p.issue)}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="8">暂无饮料资料</td></tr>';

    document.querySelectorAll('#reconPosBody .recon-pos-input').forEach(input=>input.addEventListener('change',()=>render(true)));

    const isCurrent=selectedMonth===currentMonth();
    const hint=document.getElementById('reconInventoryDateHint');
    if(hint)hint.textContent=isCurrent?'实际结存使用当前库存（本月尚未结束）':`实际结存还原至 ${monthEnd(selectedMonth)} 营业结束`;

    updateSummary(rows);
  }

  function updateSummary(rows){
    const credit=clean(rows.reduce((s,r)=>s+r.credit,0));
    const outstanding=clean(rows.reduce((s,r)=>s+r.pos.ending,0));
    const posIssue=clean(rows.reduce((s,r)=>s+(r.pos.issue===null?0:Math.abs(num(r.pos.issue))),0));
    const stockIssue=clean(rows.reduce((s,r)=>s+(r.uncertain?0:Math.abs(num(r.stockDiff))),0));
    document.getElementById('reconCreditTotal').textContent=credit;
    document.getElementById('reconOutstandingTotal').textContent=outstanding;
    document.getElementById('reconPosIssueTotal').textContent=posIssue;
    document.getElementById('reconStockIssueTotal').textContent=stockIssue;
  }

  async function savePos(){
    const btn=document.getElementById('reconSavePos');if(!btn)return;
    const inputs=[...document.querySelectorAll('#reconPosBody input[data-item-id]')];
    const byId=new Map(items.map(x=>[String(x.id),x]));
    const existing=new Map(posRows.filter(r=>r.month_key===selectedMonth).map(r=>[String(r.item_id),r]));
    const upserts=[],deletes=[];

    for(const input of inputs){
      const item=byId.get(String(input.dataset.itemId));if(!item)continue;
      const raw=input.value.trim();
      if(raw===''){if(existing.has(String(item.id)))deletes.push(item.id);continue;}
      const q=Number(raw);if(!Number.isFinite(q)||q<0)return alert(`${item.name} 的 POS 数量不正确`);
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
.recon-card{padding:14px;margin-top:12px}.recon-card .section-head h3{margin:0;font-size:17px}.recon-table-wrap{max-height:60vh;overflow:auto}.recon-table{min-width:1220px}.recon-pos-table{min-width:980px}.recon-table thead th{position:sticky;top:0;z-index:4;background:#f8fafc!important}.recon-table td{vertical-align:middle}.recon-pos-input{width:105px;min-height:36px;padding:7px 8px}.recon-sub{font-size:11px;color:#98a2b3;margin-top:3px}.recon-credit{color:#9a6700}.recon-ok{color:#087f5b;font-weight:700}.recon-bad{color:#c92a2a;font-weight:700}.recon-warn{color:#b7791f;font-weight:700}.recon-muted{color:#98a2b3}.recon-alert-row{background:#fffaf8}
@media(max-width:1100px){.recon-summary{grid-template-columns:repeat(2,1fr)}.recon-controls{align-items:stretch;flex-direction:column}.recon-control-actions{justify-content:flex-end}}
@media(max-width:620px){.recon-summary{grid-template-columns:1fr 1fr}.recon-control-actions{display:grid;grid-template-columns:1fr 1fr}.recon-control-actions button{width:100%}.recon-guide{display:block}.recon-guide b{display:block;margin-bottom:4px}}
`;document.head.appendChild(s);
  }

  window.refreshMonthlyReconciliation=loadData;
  wait();
})();