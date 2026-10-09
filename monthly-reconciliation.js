// 月结核对：POS 月销量只用于核对，不会修改库存。
// 签单只在实际出库时记录一次；以后 POS 比本月正常销售多出的数量会优先抵扣历史待入 POS 签单。
(function(){
  'use strict';

  let installed=false;
  let allLogs=[];
  let posRows=[];
  let loading=false;
  let selectedMonth='';

  function h(v=''){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
  function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0;}
  function cleanNumber(v){const n=num(v);return Number(n.toFixed(2));}
  function currentMonth(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'}).slice(0,7);}
  function monthOf(r){
    const d=r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
    return String(d||'').slice(0,7);
  }
  function monthLabel(v){const [y,m]=String(v||'').split('-');return y&&m?`${y}年${Number(m)}月`:'';}
  function outTypeLabel(v){
    return ({NORMAL:'正常销售',CREDIT:'签单',FOC:'FOC',KITCHEN:'厨房使用',STAFF:'员工使用',ENT:'招待 / ENT',OTHER:'其他'})[v]||v||'';
  }
  function detectOutType(r){
    if(r.out_type)return r.out_type;
    const raw=String(r.note||'');
    const s=raw.toLowerCase();
    if(raw.includes('签单')||raw.includes('挂账'))return 'CREDIT';
    if(/(^|[^a-z])foc([^a-z]|$)/i.test(raw)||s.includes('complimentary')||raw.includes('免费'))return 'FOC';
    if(raw.includes('厨房')||s.includes('kitchen'))return 'KITCHEN';
    if(raw.includes('员工')||raw.includes('staff'))return 'STAFF';
    if(/(^|[^a-z])ent([\s\-_/]|$)/i.test(raw)||s.includes('entertain')||raw.includes('招待'))return 'ENT';
    return 'NORMAL';
  }
  function adjustmentShortage(r){
    if(String(r.action||'')!=='ADJUST'||r.correction_ref)return 0;
    const s=String(r.note||'');
    const before=s.match(/调整前\s*([0-9.]+)/);
    const after=s.match(/调整后\s*([0-9.]+)/);
    if(!before||!after)return 0;
    return Math.max(num(before[1])-num(after[1]),0);
  }

  function wait(){
    if(typeof sb==='undefined'||typeof showPage!=='function'||typeof items==='undefined'||!document.querySelector('.side-nav')||!document.querySelector('.content-area')){
      setTimeout(wait,150);return;
    }
    install();
  }

  function install(){
    if(installed)return;
    installed=true;
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
          <div class="hint">POS 月销量只用于核对，不会自动增加或扣减库存。签单会跨月保留，直到后续 POS 多出的数量自动抵扣。</div>
        </div>
        <span id="reconStatus"></span>
      </div>

      <div class="card recon-controls">
        <label>月份
          <select id="reconMonth"></select>
        </label>
        <div class="recon-control-actions">
          <button id="reconReload" class="secondary">重新计算</button>
          <button id="reconSavePos">保存 POS 销量</button>
        </div>
      </div>

      <div id="reconSummary" class="recon-summary">
        <div class="card"><small>本月正常销售</small><b id="reconNormalTotal">0</b></div>
        <div class="card"><small>本月签单</small><b id="reconCreditTotal">0</b></div>
        <div class="card"><small>月底待入 POS</small><b id="reconOutstandingTotal">0</b></div>
        <div class="card"><small>POS 待查差异</small><b id="reconPosIssueTotal">0</b></div>
        <div class="card"><small>盘点短缺</small><b id="reconShortageTotal">0</b></div>
      </div>

      <div class="card recon-guide">
        <b>怎么看这张表：</b>
        <span>签单发生时库存已经扣掉；以后某个月 POS 比本月正常销售多，系统会先拿来抵以前尚未进入 POS 的签单。盘点短缺则单独显示，不会被 POS 数量抵消。</span>
      </div>

      <div class="card recon-card">
        <div class="section-head">
          <h3>饮料核对明细</h3>
          <span class="hint">POS 数量可以直接在表格里填写，完成后点击“保存 POS 销量”</span>
        </div>
        <div class="tablewrap recon-table-wrap">
          <table class="recon-table">
            <thead>
              <tr>
                <th>饮料</th>
                <th>系统总出库</th>
                <th>正常销售</th>
                <th>本月签单</th>
                <th>非销售用途</th>
                <th>上月待入 POS</th>
                <th>POS 月销量</th>
                <th>自动抵扣签单</th>
                <th>月底待入 POS</th>
                <th>POS 待查</th>
                <th>盘点短缺</th>
              </tr>
            </thead>
            <tbody id="reconBody"><tr><td colspan="11">读取中...</td></tr></tbody>
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
    const nav=document.querySelector('.side-nav');
    if(!nav)return;
    let a=nav.querySelector('a[href="#monthlyReconciliation"]');
    if(!a){
      a=document.createElement('a');
      a.href='#monthlyReconciliation';
      a.innerHTML='<span class="side-icon">≋</span><span class="side-label">月结核对</span>';
      const settings=nav.querySelector('a[href="#settings"]');
      nav.insertBefore(a,settings||null);
    }
    a.onclick=e=>{e.preventDefault();showPage('monthlyReconciliation');};

    const oldShowPage=showPage;
    showPage=function(page){
      const own=document.getElementById('monthlyReconciliation');
      if(page==='monthlyReconciliation'){
        ['dashboard','inventory','commission','logs','settings','corrections','outNotes'].forEach(id=>{
          const el=document.getElementById(id);if(el)el.style.display='none';
        });
        if(own)own.style.display='block';
        document.querySelectorAll('.side-nav a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#monthlyReconciliation'));
        window.scrollTo({top:0,behavior:'smooth'});
        loadData();
        return;
      }
      if(own)own.style.display='none';
      oldShowPage(page);
    };

    document.querySelectorAll('.side-nav a').forEach(link=>{
      link.onclick=e=>{e.preventDefault();showPage(link.getAttribute('href').slice(1));};
    });
  }

  async function fetchAll(table, configure){
    const all=[];let from=0;const size=1000;
    while(true){
      let q=sb.from(table).select('*');
      q=configure(q);
      q=q.range(from,from+size-1);
      const {data,error}=await q;
      if(error)throw error;
      const page=data||[];
      all.push(...page);
      if(page.length<size)break;
      from+=size;
    }
    return all;
  }

  async function loadData(){
    if(loading)return;
    loading=true;
    const body=document.getElementById('reconBody');
    const status=document.getElementById('reconStatus');
    if(body)body.innerHTML='<tr><td colspan="11">读取中...</td></tr>';
    if(status)status.textContent='读取中...';
    try{
      const [logs,pos]=await Promise.all([
        fetchAll('inventory_logs',q=>q.order('operation_date',{ascending:true}).order('created_at',{ascending:true})),
        fetchAll('monthly_pos_sales',q=>q.order('month_key',{ascending:true}).order('item_name',{ascending:true}))
      ]);
      allLogs=logs;
      posRows=pos;
      populateMonths();
      render();
      if(status)status.textContent='已更新';
    }catch(e){
      if(body)body.innerHTML=`<tr><td colspan="11">读取失败：${h(e.message||e)}</td></tr>`;
      if(status)status.textContent='读取失败';
    }finally{
      loading=false;
    }
  }

  function populateMonths(){
    const select=document.getElementById('reconMonth');
    if(!select)return;
    const months=new Set([currentMonth()]);
    allLogs.forEach(r=>{const m=monthOf(r);if(/^\d{4}-\d{2}$/.test(m))months.add(m);});
    posRows.forEach(r=>{if(/^\d{4}-\d{2}$/.test(r.month_key||''))months.add(r.month_key);});
    const list=[...months].sort((a,b)=>b.localeCompare(a));
    if(!selectedMonth||!months.has(selectedMonth))selectedMonth=currentMonth();
    select.innerHTML=list.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    select.value=selectedMonth;
  }

  function statsByItemMonth(){
    const map=new Map();
    function ensure(itemId,itemName,month){
      const key=`${itemId||itemName}|${month}`;
      if(!map.has(key))map.set(key,{itemId,itemName,month,totalOut:0,normal:0,credit:0,nonSale:0,shortage:0});
      return map.get(key);
    }

    allLogs.forEach(r=>{
      const month=monthOf(r);
      if(!/^\d{4}-\d{2}$/.test(month))return;
      const s=ensure(r.item_id||'',r.item_name||'',month);
      if(String(r.action||'')==='OUT'&&!r.correction_ref){
        const q=num(r.quantity);
        s.totalOut+=q;
        const type=detectOutType(r);
        if(type==='CREDIT')s.credit+=q;
        else if(type==='NORMAL')s.normal+=q;
        else s.nonSale+=q;
      }
      s.shortage+=adjustmentShortage(r);
    });
    return map;
  }

  function posMap(){
    const map=new Map();
    posRows.forEach(r=>map.set(`${r.item_id}|${r.month_key}`,r));
    return map;
  }

  function sortedMonthsUpTo(target){
    const set=new Set();
    allLogs.forEach(r=>{const m=monthOf(r);if(m&&m<=target)set.add(m);});
    posRows.forEach(r=>{const m=r.month_key;if(m&&m<=target)set.add(m);});
    set.add(target);
    return [...set].sort();
  }

  function computeRows(draftPos){
    const stats=statsByItemMonth();
    const pmap=posMap();
    const months=sortedMonthsUpTo(selectedMonth);
    const currentItems=[...items].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    const result=[];

    currentItems.forEach(item=>{
      let balance=0;
      let selected=null;

      months.forEach(month=>{
        const key=`${item.id}|${month}`;
        const s=stats.get(key)||{itemId:item.id,itemName:item.name,month,totalOut:0,normal:0,credit:0,nonSale:0,shortage:0};
        const previous=balance;
        const outstandingAvailable=previous+s.credit;
        let posValue=null;

        if(month===selectedMonth&&draftPos&&Object.prototype.hasOwnProperty.call(draftPos,item.id)){
          const raw=draftPos[item.id];
          posValue=raw===''?null:num(raw);
        }else{
          const saved=pmap.get(key);
          posValue=saved?num(saved.pos_quantity):null;
        }

        let settled=0;
        let issue=null;
        if(posValue!==null){
          const excess=Math.max(posValue-s.normal,0);
          settled=Math.min(outstandingAvailable,excess);
          issue=posValue-s.normal-settled;
          balance=outstandingAvailable-settled;
        }else{
          balance=outstandingAvailable;
        }

        if(month===selectedMonth){
          selected={
            item,
            ...s,
            previous,
            posValue,
            settled,
            ending:balance,
            issue
          };
        }
      });

      if(!selected){
        selected={item,totalOut:0,normal:0,credit:0,nonSale:0,shortage:0,previous:0,posValue:null,settled:0,ending:0,issue:null};
      }
      result.push(selected);
    });
    return result;
  }

  function draftFromInputs(){
    const draft={};
    document.querySelectorAll('#reconBody input[data-item-id]').forEach(input=>{
      draft[input.dataset.itemId]=input.value;
    });
    return draft;
  }

  function issueText(v){
    if(v===null||v===undefined)return '<span class="recon-muted">待录入 POS</span>';
    const n=cleanNumber(v);
    if(Math.abs(n)<0.000001)return '<span class="recon-ok">0</span>';
    if(n>0)return `<span class="recon-bad">POS 多 ${n}</span>`;
    return `<span class="recon-bad">POS 少 ${Math.abs(n)}</span>`;
  }

  function render(preserveInputs=false){
    const body=document.getElementById('reconBody');
    if(!body)return;

    const draft=preserveInputs?draftFromInputs():null;
    const rows=computeRows(draft);

    body.innerHTML=rows.map(r=>{
      const inputValue=r.posValue===null?'':cleanNumber(r.posValue);
      const hasIssue=r.issue!==null&&Math.abs(r.issue)>0.000001;
      const hasShortage=r.shortage>0.000001;
      return `<tr class="${hasIssue||hasShortage?'recon-alert-row':''}">
        <td><b>${h(r.item.name)}</b><div class="recon-sub">${h(r.item.unit||'')}</div></td>
        <td>${cleanNumber(r.totalOut)}</td>
        <td>${cleanNumber(r.normal)}</td>
        <td>${r.credit?'<b class="recon-credit">'+cleanNumber(r.credit)+'</b>':'0'}</td>
        <td>${cleanNumber(r.nonSale)}</td>
        <td>${r.previous?'<b>'+cleanNumber(r.previous)+'</b>':'0'}</td>
        <td><input class="recon-pos-input" data-item-id="${h(r.item.id)}" type="number" min="0" step="0.01" value="${h(inputValue)}" placeholder="未录入"></td>
        <td>${r.settled?'<b class="recon-ok">'+cleanNumber(r.settled)+'</b>':'0'}</td>
        <td>${r.ending?'<b class="recon-credit">'+cleanNumber(r.ending)+'</b>':'0'}</td>
        <td>${issueText(r.issue)}</td>
        <td>${r.shortage?'<b class="recon-bad">'+cleanNumber(r.shortage)+'</b>':'0'}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="11">暂无饮料资料</td></tr>';

    document.querySelectorAll('#reconBody .recon-pos-input').forEach(input=>{
      input.addEventListener('input',()=>render(true));
    });

    updateSummary(rows);
  }

  function updateSummary(rows){
    const sum=k=>cleanNumber(rows.reduce((s,r)=>s+num(r[k]),0));
    const issue=cleanNumber(rows.reduce((s,r)=>s+(r.issue===null?0:Math.abs(num(r.issue))),0));
    document.getElementById('reconNormalTotal').textContent=sum('normal');
    document.getElementById('reconCreditTotal').textContent=sum('credit');
    document.getElementById('reconOutstandingTotal').textContent=sum('ending');
    document.getElementById('reconPosIssueTotal').textContent=issue;
    document.getElementById('reconShortageTotal').textContent=sum('shortage');
  }

  async function savePos(){
    const btn=document.getElementById('reconSavePos');
    if(!btn)return;
    const inputs=[...document.querySelectorAll('#reconBody input[data-item-id]')];
    const byId=new Map(items.map(x=>[String(x.id),x]));
    const existing=new Map(posRows.filter(r=>r.month_key===selectedMonth).map(r=>[String(r.item_id),r]));
    const upserts=[];
    const deletes=[];

    for(const input of inputs){
      const item=byId.get(String(input.dataset.itemId));
      if(!item)continue;
      const raw=input.value.trim();
      if(raw===''){
        if(existing.has(String(item.id)))deletes.push(item.id);
        continue;
      }
      const q=Number(raw);
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

    btn.disabled=true;
    btn.textContent='保存中...';
    try{
      if(upserts.length){
        const {error}=await sb.from('monthly_pos_sales').upsert(upserts,{onConflict:'month_key,item_id'});
        if(error)throw error;
      }
      if(deletes.length){
        const {error}=await sb.from('monthly_pos_sales').delete().eq('month_key',selectedMonth).in('item_id',deletes);
        if(error)throw error;
      }
      await loadData();
      alert(`${monthLabel(selectedMonth)} POS 销量已保存。库存数量没有改变。`);
    }catch(e){
      alert('保存失败：'+(e.message||e));
    }finally{
      btn.disabled=false;
      btn.textContent='保存 POS 销量';
    }
  }

  function addStyle(){
    if(document.getElementById('monthlyReconciliationStyle'))return;
    const s=document.createElement('style');
    s.id='monthlyReconciliationStyle';
    s.textContent=`
#monthlyReconciliation{padding:0 2px 24px}
.recon-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:4px 0 14px}.recon-head h2{margin:0 0 4px;font-size:22px;color:#102a43}.recon-head>span{font-size:13px;color:#667085;padding-top:5px}
.recon-controls{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px;background:#f8fafc}.recon-controls label{font-size:12px;color:#667085;font-weight:700;display:flex;flex-direction:column;gap:6px;min-width:190px}.recon-controls select{min-height:42px}.recon-control-actions{display:flex;gap:8px}.recon-control-actions button{min-height:42px}
.recon-summary{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:10px;margin-bottom:12px}.recon-summary .card{padding:13px 14px}.recon-summary small{display:block;color:#667085}.recon-summary b{display:block;margin-top:5px;font-size:24px;color:#173b5e}
.recon-guide{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;background:#f7f9fc;color:#475467;font-size:13px;line-height:1.6}.recon-guide b{color:#173b5e;white-space:nowrap}
.recon-card{padding:14px}.recon-card .section-head h3{margin:0;font-size:17px}.recon-table-wrap{max-height:67vh;overflow:auto}.recon-table{min-width:1380px}.recon-table thead th{position:sticky;top:0;z-index:4;background:#f8fafc!important}.recon-table td{vertical-align:middle}.recon-pos-input{width:105px;min-height:36px;padding:7px 8px}.recon-sub{font-size:11px;color:#98a2b3;margin-top:3px}.recon-credit{color:#9a6700}.recon-ok{color:#087f5b;font-weight:700}.recon-bad{color:#c92a2a;font-weight:700}.recon-muted{color:#98a2b3}.recon-alert-row{background:#fffaf8}
@media(max-width:1100px){.recon-summary{grid-template-columns:repeat(2,1fr)}.recon-controls{align-items:stretch;flex-direction:column}.recon-control-actions{justify-content:flex-end}}
@media(max-width:620px){.recon-summary{grid-template-columns:1fr 1fr}.recon-control-actions{display:grid;grid-template-columns:1fr 1fr}.recon-control-actions button{width:100%}.recon-guide{display:block}.recon-guide b{display:block;margin-bottom:4px}}
`;
    document.head.appendChild(s);
  }

  window.refreshMonthlyReconciliation=loadData;
  wait();
})();