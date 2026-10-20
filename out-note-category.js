// 出入库备注增强：增加月份与备注用途分类筛选，并统计筛选后的数量。
(function(){
  'use strict';
  let installed=false;
  let observer=null;
  let canEditOldOutType=false;

  const CATEGORIES=['正常销售','ENT','FOC','厨房使用','NO Paid','取消入库','其他'];

  function currentMonth(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'}).slice(0,7);}
  async function checkEditPermission(){
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session){
        canEditOldOutType=false;
        decorateRows(true);
        return;
      }
      const {data,error}=await sb.rpc('is_app_active');
      canEditOldOutType=!error&&data===true;
      decorateRows(true);
    }catch(e){
      canEditOldOutType=false;
      decorateRows(true);
    }
  }

  function watchEditPermission(){
    if(window.__outNoteAdminPermissionWatcherInstalled)return;
    window.__outNoteAdminPermissionWatcherInstalled=true;
    sb.auth.onAuthStateChange((event,session)=>{
      setTimeout(()=>checkEditPermission(),120);
    });
  }

  function outTypeLabel(v){
    return ({NORMAL:'正常销售',ENT:'ENT',FOC:'FOC',KITCHEN:'厨房使用',NO_PAID:'NO Paid',CANCEL_IN:'取消入库',OTHER:'其他'})[v]||'';
  }

  async function editOldOutType(tr){
    if(!canEditOldOutType)return;
    const logId=Number(tr.dataset.logId||0);
    const action=(tr.querySelector('.out-note-action-cell')?.dataset.action||'').trim();
    if(!logId||action!=='OUT')return;
    const current=tr.dataset.outType||'NORMAL';
    const raw=prompt('修改用途分类：\n1 = 正常销售\n2 = ENT\n3 = FOC\n4 = 厨房使用\n5 = NO Paid\n6 = 取消入库\n7 = 其他',({NORMAL:'1',ENT:'2',FOC:'3',KITCHEN:'4',NO_PAID:'5',CANCEL_IN:'6',OTHER:'7'})[current]||'1');
    if(raw===null)return;
    const map={'1':'NORMAL','2':'ENT','3':'FOC','4':'KITCHEN','5':'NO_PAID','6':'CANCEL_IN','7':'OTHER','NORMAL':'NORMAL','ENT':'ENT','FOC':'FOC','厨房使用':'KITCHEN','KITCHEN':'KITCHEN','NO PAID':'NO_PAID','NO_PAID':'NO_PAID','取消入库':'CANCEL_IN','CANCEL_IN':'CANCEL_IN','OTHER':'OTHER'};
    const next=map[String(raw).trim().toUpperCase()];
    if(!next)return alert('请输入 1-7，或正常销售 / ENT / FOC / 厨房使用 / NO Paid / 取消入库 / 其他');
    const {error}=await sb.rpc('set_inventory_log_out_type_admin',{p_log_id:logId,p_out_type:next});
    if(error)return alert('修改失败：'+error.message);
    tr.dataset.outType=next;
    if(typeof window.refreshOutNoteHistory==='function')await window.refreshOutNoteHistory();
  }

  function monthLabel(v){const [y,m]=String(v||'').split('-');return y&&m?`${y}年${Number(m)}月`:'';}

  function setupGroupCollapse(groupCard){
    if(!groupCard||document.getElementById('toggleOutNoteGroup'))return;
    const head=groupCard.querySelector('.section-head');
    const wrap=groupCard.querySelector('.out-note-summary-wrap');
    if(!head||!wrap)return;

    const hint=head.querySelector('.hint');
    const right=document.createElement('div');
    right.className='out-note-group-head-actions';
    if(hint)right.appendChild(hint);

    const btn=document.createElement('button');
    btn.id='toggleOutNoteGroup';
    btn.type='button';
    btn.className='secondary out-note-group-toggle';
    right.appendChild(btn);
    head.appendChild(right);

    const apply=collapsed=>{
      wrap.classList.toggle('hidden',collapsed);
      groupCard.classList.toggle('out-note-group-collapsed',collapsed);
      btn.textContent=collapsed?'展开 ▾':'收起 ▴';
      btn.setAttribute('aria-expanded',collapsed?'false':'true');
    };

    const saved=localStorage.getItem('outNoteGroupCollapsed')==='1';
    apply(saved);
    btn.onclick=e=>{
      e.preventDefault();
      e.stopPropagation();
      const next=!wrap.classList.contains('hidden');
      localStorage.setItem('outNoteGroupCollapsed',next?'1':'0');
      apply(next);
    };
  }
  function classifyRow(row){
    const action=(row.querySelector('.out-note-action-cell')?.dataset.action||'').trim();
    if(['BORROW','RETURN','TRANSFER','ADJUST'].includes(action))return '';
    const outType=(row.dataset.outType||'').trim();
    if(action==='OUT'){
      if(outType==='NORMAL')return '正常销售';
      if(outType==='ENT')return 'ENT';
      if(outType==='FOC')return 'FOC';
      if(outType==='KITCHEN')return '厨房使用';
      if(outType==='NO_PAID')return 'NO Paid';
      if(outType==='CANCEL_IN')return '取消入库';
      if(outType==='OTHER')return '其他';
    }
    const raw=(row.querySelector('.out-note-note-cell')?.textContent||'').trim();
    const s=raw.toLowerCase().replace(/\s+/g,' ');
    if(/(^|[^a-z])foc([^a-z]|$)/i.test(raw)||s.includes('complimentary')||raw.includes('免费')||raw.includes('厨房')||s.includes('kitchen')||raw.includes('员工'))return 'FOC';
    if(s.includes('no paid')||s.includes('not paid')||s.includes('unpaid')||raw.includes('没paid')||raw.includes('没 paid')||raw.includes('未付款')||raw.includes('没付款'))return 'NO Paid';
    if(/(^|[^a-z])ent([\s\-_/]|$)/i.test(raw)||s.includes('entertain')||raw.includes('招待'))return 'ENT';
    return action==='OUT'?'正常销售':'其他';
  }

  function wait(){
    if(!document.getElementById('outNoteFilters')||!document.getElementById('outNoteBody')||!document.getElementById('outNoteSummary')){setTimeout(wait,150);return;}
    install();
  }

  function install(){
    if(installed)return;installed=true;
    addControls();
    addStyle();
    bindActions();
    watchEditPermission();
    checkEditPermission();
    setTimeout(()=>checkEditPermission(),600);
    observer=new MutationObserver(()=>setTimeout(()=>{decorateRows();populateMonths();applyExtraFilters();},0));
    observer.observe(document.getElementById('outNoteBody'),{childList:true});
    setTimeout(()=>{decorateRows();populateMonths(true);applyExtraFilters();},100);
  }

  function addControls(){
    const filter=document.getElementById('outNoteFilters');
    const actionLabel=document.getElementById('outNoteActionFilter')?.closest('label');
    if(!filter||!actionLabel)return;

    if(!document.getElementById('outNoteCategoryFilter')){
      const label=document.createElement('label');
      label.innerHTML=`用途分类<select id="outNoteCategoryFilter"><option value="">全部分类</option>${CATEGORIES.map(x=>`<option value="${x}">${x}</option>`).join('')}</select>`;
      actionLabel.after(label);
    }

    if(!document.getElementById('outNoteMonthFilter')){
      const label=document.createElement('label');
      label.innerHTML='<span>月份</span><select id="outNoteMonthFilter"><option value="">全部月份</option></select>';
      document.getElementById('outNoteCategoryFilter').closest('label').after(label);
    }

    const groupCard=document.getElementById('outNoteGroupBody')?.closest('.out-note-card');
    if(groupCard){
      const title=groupCard.querySelector('.section-head h3');
      const hint=groupCard.querySelector('.section-head .hint');
      if(title)title.textContent='用途分类汇总';
      if(hint)hint.textContent='按用途分类合计';
      const head=groupCard.querySelector('thead tr');
      if(head)head.innerHTML='<th>用途分类</th><th>记录数</th><th>数量合计</th>';
      setupGroupCollapse(groupCard);
    }

    const detailHead=document.querySelector('#outNotes .out-note-detail-wrap thead tr');
    if(detailHead&&!detailHead.querySelector('.out-note-category-head')){
      const th=document.createElement('th');th.className='out-note-category-head';th.textContent='用途分类';
      detailHead.insertBefore(th,detailHead.children[2]||null);
    }
  }

  function bindActions(){
    const query=document.getElementById('applyOutNoteFilter');
    const reset=document.getElementById('resetOutNoteFilter');
    const month=document.getElementById('outNoteMonthFilter');
    const from=document.getElementById('outNoteDateFrom');
    const to=document.getElementById('outNoteDateTo');

    if(query)query.addEventListener('click',()=>setTimeout(()=>{decorateRows();applyExtraFilters();},0));
    if(reset)reset.addEventListener('click',()=>setTimeout(()=>{
      const c=document.getElementById('outNoteCategoryFilter');if(c)c.value='';
      const m=document.getElementById('outNoteMonthFilter');if(m)m.value=currentMonth();
      decorateRows();applyExtraFilters();
    },0));
    if(month)month.addEventListener('change',()=>{
      if(month.value){if(from)from.value='';if(to)to.value='';}
    });
    [from,to].forEach(el=>el&&el.addEventListener('change',()=>{if(el.value&&month)month.value='';}));
  }

  function populateMonths(forceDefault=false){
    const sel=document.getElementById('outNoteMonthFilter');if(!sel)return;
    const previous=sel.value;
    const months=new Set([currentMonth()]);
    document.querySelectorAll('#outNoteBody tr').forEach(tr=>{
      const d=(tr.querySelector('.out-note-date-cell')?.textContent||'').trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(d))months.add(d.slice(0,7));
    });
    const list=[...months].sort((a,b)=>b.localeCompare(a));
    sel.innerHTML='<option value="">全部月份</option>'+list.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('');
    if(forceDefault)sel.value=currentMonth();
    else if(list.includes(previous))sel.value=previous;
    else if(!previous)sel.value='';
  }

  function decorateRows(force=false){
    document.querySelectorAll('#outNoteBody tr').forEach(tr=>{
      let td=tr.querySelector('.out-note-category-cell');
      const noteCell=tr.querySelector('.out-note-note-cell');
      const itemCell=tr.querySelector('.out-note-item-cell');
      if(!noteCell||!itemCell){
        const empty=tr.querySelector('td[colspan]');if(empty)empty.colSpan=8;
        return;
      }
      if(!td){
        td=document.createElement('td');
        td.className='out-note-category-cell';
        itemCell.after(td);
      }else if(!force)return;
      td.dataset.category=classifyRow(tr);
      const action=(tr.querySelector('.out-note-action-cell')?.dataset.action||'').trim();
      const edit=canEditOldOutType&&action==='OUT'?'<button class="out-note-category-edit secondary" style="margin-left:6px;padding:3px 7px;font-size:11px;color:#c92a2a">修改</button>':'';
      td.innerHTML=td.dataset.category?`<div class="out-note-category-layout"><span class="out-note-category-pill">${td.dataset.category}</span>${edit}</div>`:'';
      const btn=td.querySelector('.out-note-category-edit');
      if(btn)btn.onclick=()=>editOldOutType(tr);
    });
  }

  function baseVisibleRows(){
    return [...document.querySelectorAll('#outNoteBody tr')].filter(tr=>tr.querySelector('.out-note-date-cell'));
  }

  function applyExtraFilters(){
    decorateRows();
    const category=document.getElementById('outNoteCategoryFilter')?.value||'';
    const month=document.getElementById('outNoteMonthFilter')?.value||'';
    const rows=baseVisibleRows();
    let visible=[];

    rows.forEach(tr=>{
      const date=(tr.querySelector('.out-note-date-cell')?.textContent||'').trim();
      const cat=tr.querySelector('.out-note-category-cell')?.dataset.category||'';
      const show=(!category||cat===category)&&(!month||date.slice(0,7)===month);
      tr.style.display=show?'':'none';
      if(show)visible.push(tr);
    });

    const totalQty=visible.reduce((s,tr)=>s+(Number((tr.querySelector('.out-note-qty-cell')?.textContent||'0').replace(/,/g,''))||0),0);
    const summary=document.getElementById('outNoteSummary');
    const count=document.getElementById('outNoteCount');
    const item=document.getElementById('outNoteItemFilter')?.value||'';
    const actionText=document.getElementById('outNoteActionFilter')?.selectedOptions?.[0]?.textContent||'';
    const filterParts=[];
    if(month)filterParts.push(monthLabel(month));
    if(item)filterParts.push(item);
    if(actionText&&actionText!=='全部操作')filterParts.push(actionText);
    if(category)filterParts.push(category);
    if(summary)summary.innerHTML=`<span>记录 <b>${visible.length}</b></span><span>数量合计 <b>${Number(totalQty.toFixed(2))}</b></span>${filterParts.length?`<span>当前筛选 <b>${filterParts.join(' · ')}</b></span>`:''}`;
    if(count)count.textContent=`显示 ${visible.length} 条`;

    const groups=new Map();
    visible.forEach(tr=>{
      const cat=tr.querySelector('.out-note-category-cell')?.dataset.category||'';
      if(!cat)return;
      const qty=Number((tr.querySelector('.out-note-qty-cell')?.textContent||'0').replace(/,/g,''))||0;
      const g=groups.get(cat)||{category:cat,count:0,qty:0};
      g.count++;g.qty+=qty;groups.set(cat,g);
    });
    const body=document.getElementById('outNoteGroupBody');
    if(body){
      const grouped=[...groups.values()].sort((a,b)=>b.qty-a.qty||b.count-a.count||a.category.localeCompare(b.category));
      body.innerHTML=grouped.map(g=>`<tr><td><b>${g.category}</b></td><td>${g.count}</td><td>${Number(g.qty.toFixed(2))}</td></tr>`).join('')||'<tr><td colspan="3">暂无符合条件的备注记录</td></tr>';
    }
  }

  function addStyle(){
    if(document.getElementById('outNoteCategoryStyle'))return;
    const s=document.createElement('style');s.id='outNoteCategoryStyle';s.textContent=`
#outNoteFilters{grid-template-columns:minmax(145px,.95fr) minmax(120px,.65fr) minmax(145px,.8fr) minmax(135px,.7fr) minmax(145px,.8fr) minmax(145px,.8fr) minmax(190px,1.05fr) auto!important}
.out-note-category-layout{display:flex;align-items:center;justify-content:flex-start;gap:5px;white-space:nowrap}
.out-note-category-pill{display:inline-flex;align-items:center;justify-content:center;justify-self:start;border-radius:999px;background:#eef2f6;color:#344054;padding:4px 9px;font-size:12px;font-weight:700;white-space:nowrap}
.out-note-category-edit{margin-left:0!important;flex:0 0 auto;width:44px;text-align:center}
.out-note-group-head-actions{display:flex;align-items:center;gap:10px}
.out-note-group-head-actions .hint{margin-top:0}
.out-note-group-toggle{padding:6px 10px;font-size:12px;line-height:1;min-width:66px}
.out-note-group-collapsed{padding-bottom:14px}
#outNotes .out-note-detail-wrap table{min-width:1040px}
#outNotes .out-note-detail-wrap th:nth-child(4),#outNotes .out-note-detail-wrap th:nth-child(5),#outNotes .out-note-detail-wrap td.out-note-action-cell,#outNotes .out-note-detail-wrap td.out-note-qty-cell{text-align:center!important}
#outNotes .out-note-detail-wrap td.out-note-action-cell .action-pill{vertical-align:middle}
@media(max-width:1450px){#outNoteFilters{grid-template-columns:repeat(4,minmax(145px,1fr))!important}.out-note-actions{grid-column:auto!important}}
@media(max-width:1000px){#outNoteFilters{grid-template-columns:1fr 1fr!important}.out-note-actions{grid-column:1/-1!important}}
@media(max-width:620px){#outNoteFilters{grid-template-columns:1fr!important}.out-note-actions{grid-column:1!important}}
`;
    document.head.appendChild(s);
  }

  window.applyOutNoteCategoryFilter=applyExtraFilters;
  wait();
})();