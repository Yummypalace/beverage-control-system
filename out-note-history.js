// 出入库备注页面：库存操作只要填写了人工备注，就集中显示在这里。
// 盘点调整有独立记录区域，不在这里重复显示；系统自动生成的资料记录与错单技术记录也不重复显示。
(function(){
  'use strict';
  let installed=false;
  let rows=[];
  let loadRunId=0;

  function h(v=''){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
  function dateOf(r){return r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function actionLabel(action){
    return ({IN:'入库',OUT:'出库',BORROW:'借出',RETURN:'还回',ADJUST:'盘点',TRANSFER:'移库',CREATE:'新增',EDIT:'编辑'})[String(action||'')]||String(action||'');
  }

  function parseNote(r){
    const raw=String(r?.note||'').trim();
    const action=String(r?.action||'');
    if(!raw)return {location:'',note:''};

    const parts=raw.split('｜').map(x=>String(x).trim());
    let location='';

    if(parts.length&&(/^(冰箱|仓库)$/.test(parts[0])||parts[0].includes('→'))){
      location=parts.shift();
    }

    if(action==='ADJUST'){
      const userParts=parts.filter(x=>{
        if(!x)return false;
        if(x==='盘点调整')return false;
        if(/^调整前\s/.test(x))return false;
        if(/^调整后\s/.test(x))return false;
        return true;
      });
      return {location,note:userParts.join('｜').trim()};
    }

    if(action==='TRANSFER'){
      if(!location&&parts.length&&parts[0].includes('→'))location=parts.shift();
      return {location,note:parts.join('｜').trim()};
    }

    if(['IN','OUT','BORROW','RETURN'].includes(action)){
      return {location,note:parts.join('｜').trim()};
    }

    return {location,note:(location?parts.join('｜'):raw).trim()};
  }

  function meaningful(r){
    const action=String(r.action||'');
    if(r.correction_ref)return false;
    if(action==='CREATE'||action==='EDIT'||action==='ADJUST')return false;
    const p=parseNote(r);
    return !!p.note;
  }

  function wait(){
    if(typeof sb==='undefined'||typeof showPage!=='function'||!document.querySelector('.side-nav')||!document.querySelector('.content-area')){setTimeout(wait,150);return;}
    install();
  }

  function install(){
    if(installed)return;installed=true;
    buildPage();
    extendNavigation();
    addStyle();
    loadRows();
  }

  function buildPage(){
    const content=document.querySelector('.content-area');
    if(!content||document.getElementById('outNotes'))return;
    const section=document.createElement('div');
    section.id='outNotes';
    section.className='panel-anchor';
    section.style.display='none';
    section.innerHTML=`
      <div class="out-note-head"><div><h2>出入库备注</h2><div class="hint">入库、出库、借出或还回时，只要填写备注都会自动汇总到这里。盘点调整记录请到「盘点调整」页面查看。</div></div><span id="outNoteCount"></span></div>
      <div id="outNoteFilters" class="card">
        <label>饮料<input id="outNoteItemFilter" list="outNoteItemList" placeholder="全部饮料 / 输入名称搜索" autocomplete="off"><datalist id="outNoteItemList"></datalist></label>
        <label>操作<select id="outNoteActionFilter"><option value="">全部操作</option><option value="IN">入库</option><option value="OUT">出库</option><option value="BORROW">借出</option><option value="RETURN">还回</option><option value="TRANSFER">移库</option></select></label>
        <label>开始日期<input id="outNoteDateFrom" type="date"></label>
        <label>结束日期<input id="outNoteDateTo" type="date"></label>
        <label>备注关键词<input id="outNoteKeyword" placeholder="例如：FOC / 厨房 / 供应商"></label>
        <div class="out-note-actions"><button id="applyOutNoteFilter">查询</button><button id="resetOutNoteFilter" class="secondary">重置</button></div>
      </div>
      <div id="outNoteSummary" class="out-note-summary"></div>
      <div class="card out-note-card">
        <div class="section-head"><h3>备注汇总</h3><span class="hint">按相同备注合计</span></div>
        <div class="tablewrap out-note-summary-wrap"><table><thead><tr><th>备注</th><th>记录数</th><th>数量合计</th></tr></thead><tbody id="outNoteGroupBody"></tbody></table></div>
      </div>
      <div class="card out-note-card">
        <div class="section-head"><h3>出入库明细</h3></div>
        <div class="tablewrap out-note-detail-wrap"><table><thead><tr><th>日期</th><th>饮料</th><th>操作</th><th>数量</th><th>位置</th><th>备注</th><th>操作人</th></tr></thead><tbody id="outNoteBody"><tr><td colspan="7">读取中...</td></tr></tbody></table></div>
      </div>`;
    content.appendChild(section);

    document.getElementById('applyOutNoteFilter').onclick=renderRows;
    document.getElementById('resetOutNoteFilter').onclick=()=>{
      ['outNoteItemFilter','outNoteActionFilter','outNoteDateFrom','outNoteDateTo','outNoteKeyword'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      renderRows();
    };
    document.getElementById('outNoteKeyword').addEventListener('keydown',e=>{if(e.key==='Enter')renderRows();});
    document.getElementById('outNoteItemFilter').addEventListener('keydown',e=>{if(e.key==='Enter')renderRows();});
  }

  function extendNavigation(){
    const nav=document.querySelector('.side-nav');if(!nav)return;
    let a=nav.querySelector('a[href="#outNotes"]');
    if(!a){
      a=document.createElement('a');
      a.href='#outNotes';
      const corrections=nav.querySelector('a[href="#corrections"]');
      const settings=nav.querySelector('a[href="#settings"]');
      nav.insertBefore(a,corrections||settings||null);
    }
    a.innerHTML='<span class="side-icon">▧</span><span class="side-label">出入库备注</span>';
    a.onclick=e=>{e.preventDefault();showPage('outNotes');};

    const oldShowPage=showPage;
    showPage=function(page){
      const own=document.getElementById('outNotes');
      if(page==='outNotes'){
        ['dashboard','inventory','commission','logs','settings','corrections','monthlyReconciliation','stocktakeAdjust'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
        if(own)own.style.display='block';
        document.querySelectorAll('.side-nav a').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#outNotes'));
        window.scrollTo({top:0,behavior:'smooth'});
        loadRows();
        return;
      }
      if(own)own.style.display='none';
      oldShowPage(page);
    };
  }

  async function fetchAllInventoryLogs(attempt=0){
    try{
      const all=[];let from=0;const size=1000;
      while(true){
        const {data,error}=await sb.from('inventory_logs').select('*').order('operation_date',{ascending:false}).order('created_at',{ascending:false}).range(from,from+size-1);
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

  async function loadRows(){
    const body=document.getElementById('outNoteBody');if(!body)return;
    const runId=++loadRunId;
    const hadRows=rows.length>0;
    if(!hadRows)body.innerHTML='<tr><td colspan="7">读取中...</td></tr>';
    try{
      const data=await fetchAllInventoryLogs();
      if(runId!==loadRunId)return;
      const nextRows=data.filter(meaningful).map(r=>{
        const p=parseNote(r);
        return {...r,_date:dateOf(r),_location:p.location,_businessNote:p.note,_actionLabel:actionLabel(r.action)};
      });
      nextRows.sort((a,b)=>String(b._date).localeCompare(String(a._date))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
      rows=nextRows;
      populateItems();
      renderRows();
    }catch(e){
      if(runId!==loadRunId)return;
      console.warn('出入库备注读取失败，保留现有资料',e);
      if(hadRows){
        renderRows();
        const count=document.getElementById('outNoteCount');
        if(count)count.textContent='读取失败，已保留现有资料';
      }else{
        body.innerHTML=`<tr><td colspan="7">读取失败：${h(e.message||e)}</td></tr>`;
      }
    }
  }

  function populateItems(){
    const input=document.getElementById('outNoteItemFilter');
    const list=document.getElementById('outNoteItemList');
    if(!input||!list)return;
    const current=input.value;
    const names=[...new Set(rows.map(r=>r.item_name).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'zh-CN',{numeric:true,sensitivity:'base'}));
    list.innerHTML=names.map(n=>`<option value="${h(n)}"></option>`).join('');
    input.value=current;
  }

  function filteredRows(){
    const item=(document.getElementById('outNoteItemFilter')?.value||'').trim().toLowerCase();
    const action=document.getElementById('outNoteActionFilter')?.value||'';
    const from=document.getElementById('outNoteDateFrom')?.value||'';
    const to=document.getElementById('outNoteDateTo')?.value||'';
    const kw=(document.getElementById('outNoteKeyword')?.value||'').trim().toLowerCase();
    return rows.filter(r=>{
      if(item&&!String(r.item_name||'').toLowerCase().includes(item))return false;
      if(action&&String(r.action)!==action)return false;
      if(from&&r._date<from)return false;
      if(to&&r._date>to)return false;
      if(kw&&!`${r.item_name||''} ${r._actionLabel||''} ${r._businessNote||''} ${r.user_email||''}`.toLowerCase().includes(kw))return false;
      return true;
    });
  }

  function renderRows(){
    const body=document.getElementById('outNoteBody'),groupBody=document.getElementById('outNoteGroupBody'),summary=document.getElementById('outNoteSummary'),count=document.getElementById('outNoteCount');
    if(!body||!groupBody||!summary)return;
    const filtered=filteredRows();
    const totalQty=filtered.reduce((s,r)=>s+Number(r.quantity||0),0);
    summary.innerHTML=`<span>记录 <b>${filtered.length}</b></span><span>数量合计 <b>${Number(totalQty.toFixed(2))}</b></span>`;
    if(count)count.textContent=`显示 ${filtered.length} 条`;

    const groups=new Map();
    filtered.forEach(r=>{
      const key=r._businessNote||'未填写';
      const g=groups.get(key)||{note:key,count:0,qty:0};
      g.count++;g.qty+=Number(r.quantity||0);groups.set(key,g);
    });
    const grouped=[...groups.values()].sort((a,b)=>b.qty-a.qty||b.count-a.count||a.note.localeCompare(b.note));
    groupBody.innerHTML=grouped.map(g=>`<tr><td><b>${h(g.note)}</b></td><td>${g.count}</td><td>${Number(g.qty.toFixed(2))}</td></tr>`).join('')||'<tr><td colspan="3">暂无有备注的库存操作记录</td></tr>';

    body.innerHTML=filtered.map(r=>`<tr data-log-id="${h(r.id||'')}" data-out-type="${h(r.out_type||'')}">
      <td class="out-note-date-cell">${h(r._date)}</td>
      <td class="out-note-item-cell"><b>${h(r.item_name||'')}</b></td>
      <td class="out-note-action-cell" data-action="${h(r.action||'')}"><span class="pill action-pill action-${h(String(r.action||'').toLowerCase())}">${h(r._actionLabel)}</span></td>
      <td class="out-note-qty-cell">${Number(r.quantity||0)}</td>
      <td class="out-note-location-cell">${h(r._location||'')}</td>
      <td class="out-note-note-cell">${h(r._businessNote||'')}</td>
      <td class="out-note-user-cell">${h(r.user_email||'')}</td>
    </tr>`).join('')||'<tr><td colspan="7">暂无有备注的库存操作记录</td></tr>';
  }

  function addStyle(){
    if(document.getElementById('outNoteStyle'))return;
    const s=document.createElement('style');s.id='outNoteStyle';s.textContent=`
#outNotes{padding:0 2px 20px}.out-note-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:4px 0 14px}.out-note-head h2{margin:0 0 4px;font-size:22px;color:#102a43}.out-note-head>span{font-size:13px;color:#667085;padding-top:5px}
#outNoteFilters{display:grid;grid-template-columns:minmax(170px,1.05fr) minmax(130px,.7fr) minmax(145px,.8fr) minmax(145px,.8fr) minmax(210px,1.2fr) auto;gap:10px;align-items:end;padding:14px;margin-bottom:12px;background:#f8fafc}
#outNoteFilters label{font-size:12px;color:#667085;font-weight:600;display:flex;flex-direction:column;gap:6px;min-width:0}#outNoteFilters input,#outNoteFilters select{width:100%;min-height:42px}.out-note-actions{display:flex;gap:8px;align-items:end}.out-note-actions button{min-height:42px;white-space:nowrap}
.out-note-summary{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px}.out-note-summary span{display:inline-flex;gap:6px;align-items:center;background:#edf3f8;color:#475467;border-radius:10px;padding:8px 12px;font-size:13px}.out-note-summary b{color:#173b5e;font-size:15px}
.out-note-card{margin-top:12px;padding:14px}.out-note-card .section-head h3{margin:0;font-size:17px}.out-note-summary-wrap{max-height:260px;overflow:auto}.out-note-detail-wrap{max-height:62vh;overflow:auto}#outNotes table{min-width:900px}#outNotes thead th{position:sticky;top:0;z-index:3;background:#f8fafc!important}
.action-pill{font-weight:700;border:1px solid transparent}
.action-in{background:#e8f7ef!important;color:#287553!important;border-color:#d4efe0!important}
.action-out{background:#eaf1f8!important;color:#315b7d!important;border-color:#dbe7f1!important}
.action-transfer{background:#f0eefb!important;color:#5f5592!important;border-color:#e3dff5!important}
.action-borrow{background:#fff4df!important;color:#9a6a1f!important;border-color:#f8e7bf!important}
.action-return{background:#eaf8f6!important;color:#2b746b!important;border-color:#d5efeb!important}
.action-adjust{background:#f3eff8!important;color:#72568e!important;border-color:#e7dff0!important}
.action-create{background:#eef7ea!important;color:#557a45!important;border-color:#dfedd9!important}
.action-edit{background:#f6f1e8!important;color:#7b6643!important;border-color:#ece2d3!important}
@media(max-width:1150px){#outNoteFilters{grid-template-columns:1fr 1fr}.out-note-actions{grid-column:1/-1}}
@media(max-width:620px){#outNoteFilters{grid-template-columns:1fr}.out-note-actions{grid-column:1}.out-note-actions button{flex:1}}
`;document.head.appendChild(s);
  }

  window.refreshOutNoteHistory=loadRows;
  wait();
})();