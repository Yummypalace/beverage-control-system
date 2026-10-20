// 销售提成记录按月份归档：默认只显示当月；使用日期筛选时允许跨月份查询。
(function(){
'use strict';
let activeMonth=currentMonth();
let bodyObserver=null;
let applying=false;

function currentMonth(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'}).slice(0,7);}
function monthLabel(month){const [y,m]=String(month).split('-');return `${y}年${Number(m)}月`;}
function dateRange(){return {from:document.getElementById('commissionDateFrom')?.value||'',to:document.getElementById('commissionDateTo')?.value||''};}
function hasDateRange(){const r=dateRange();return !!(r.from||r.to);}
function rangeLabel(){const {from,to}=dateRange();if(from&&to)return `日期范围：${from} 至 ${to}`;if(from)return `日期范围：${from} 起`;if(to)return `日期范围：截至 ${to}`;return '';}
function wait(){
  if(typeof commissions==='undefined'||!document.getElementById('commissionBody')||!document.getElementById('manualCommissionSummary')||!document.getElementById('manualCommissionFilterPanel')){setTimeout(wait,150);return;}
  install();
}
function install(){
  if(document.getElementById('commissionMonthArchive'))return;
  addStyle();
  const filter=document.getElementById('manualCommissionFilterPanel');
  const box=document.createElement('div');
  box.id='commissionMonthArchive';
  box.innerHTML=`<button id="commissionCurrentMonthBtn" type="button" class="secondary"></button><details id="commissionOtherMonths"><summary>其他月份</summary><div id="commissionOtherMonthList"></div></details><span id="commissionActiveMonthLabel"></span>`;
  filter.parentElement.insertBefore(box,filter);
  document.getElementById('commissionCurrentMonthBtn').onclick=()=>selectMonth(currentMonth());
  ['commissionDateFrom','commissionDateTo'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.addEventListener('change',()=>setTimeout(()=>{renderMonthOptions();applyMonthFilter();},0));
  });
  const reset=document.getElementById('clearCommissionFiltersBtn');
  if(reset)reset.addEventListener('click',()=>{activeMonth=currentMonth();setTimeout(()=>{renderMonthOptions();applyMonthFilter();},0);},true);
  bodyObserver=new MutationObserver(()=>{if(!applying){renderMonthOptions();applyMonthFilter();}});
  observeBody();
  renderMonthOptions();
  applyMonthFilter();
}
function observeBody(){const body=document.getElementById('commissionBody');if(body&&bodyObserver)bodyObserver.observe(body,{childList:true,subtree:false});}
function selectMonth(month){
  activeMonth=month;
  ['commissionDateFrom','commissionDateTo'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const details=document.getElementById('commissionOtherMonths');if(details)details.open=false;
  renderMonthOptions();
  // 选择月份时清除日期范围，再触发现有筛选重新渲染。
  const seller=document.getElementById('commissionSellerFilter');if(seller)seller.dispatchEvent(new Event('change'));
  else applyMonthFilter();
}
function renderMonthOptions(){
  const now=currentMonth();
  const currentBtn=document.getElementById('commissionCurrentMonthBtn'),list=document.getElementById('commissionOtherMonthList'),label=document.getElementById('commissionActiveMonthLabel');
  if(!currentBtn||!list||!label)return;
  const rangeMode=hasDateRange();
  currentBtn.textContent=`当月 · ${monthLabel(now)}`;
  currentBtn.classList.toggle('month-active',!rangeMode&&activeMonth===now);
  label.textContent=rangeMode?rangeLabel():(activeMonth===now?'':`当前显示：${monthLabel(activeMonth)}`);
  const counts=new Map();
  (commissions||[]).forEach(r=>{const d=r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});const month=String(d).slice(0,7);counts.set(month,(counts.get(month)||0)+1);});
  const months=[...counts.keys()].filter(m=>m&&m!==now).sort((a,b)=>b.localeCompare(a));
  list.innerHTML=months.length?months.map(m=>`<button type="button" class="commission-month-option${!rangeMode&&activeMonth===m?' month-active':''}" data-month="${m}">${monthLabel(m)} <span>${counts.get(m)} 条</span></button>`).join(''):'<div class="commission-month-empty-note">暂无其他月份记录</div>';
  list.querySelectorAll('[data-month]').forEach(btn=>btn.onclick=()=>selectMonth(btn.dataset.month));
}
function applyMonthFilter(){
  const body=document.getElementById('commissionBody'),summary=document.getElementById('manualCommissionSummary');if(!body||!summary)return;
  applying=true;if(bodyObserver)bodyObserver.disconnect();
  body.querySelectorAll('.commission-month-empty-row').forEach(r=>r.remove());
  const rangeMode=hasDateRange();
  let count=0,qty=0,amount=0,hasSystemEmptyRow=false;
  [...body.querySelectorAll('tr')].forEach(row=>{
    const cells=row.children;
    if(cells.length<6){
      hasSystemEmptyRow=true;
      row.style.display='';
      return;
    }
    [4,5].forEach(i=>{
      const cell=cells[i];if(!cell)return;
      const raw=(cell.textContent||'').trim();
      if(/^[0-9]+(?:[.][0-9]+)?$/.test(raw))cell.textContent=String.fromCharCode(36)+Number(raw).toFixed(2);
    });
    const date=(cells[0].textContent||'').trim();
    const show=rangeMode?true:date.slice(0,7)===activeMonth;
    row.style.display=show?'':'none';
    if(show){count++;qty+=Number((cells[3].textContent||'0').replace(/,/g,''))||0;amount+=Number((cells[5].textContent||'0').replace(/[^0-9.-]/g,''))||0;}
  });
  if(count===0&&!hasSystemEmptyRow&&!rangeMode){
    const tr=document.createElement('tr');tr.className='commission-month-empty-row';tr.innerHTML=`<td colspan="9">${monthLabel(activeMonth)}暂无销售提成记录</td>`;body.appendChild(tr);
  }
  summary.textContent=`记录 ${count}｜销售数量 ${qty}｜提成 $${amount.toFixed(2)}`;
  const label=document.getElementById('commissionActiveMonthLabel');
  if(label)label.textContent=rangeMode?rangeLabel():(activeMonth===currentMonth()?'':`当前显示：${monthLabel(activeMonth)}`);
  applying=false;observeBody();
}
function addStyle(){
  if(document.getElementById('commissionMonthArchiveStyle'))return;
  const s=document.createElement('style');s.id='commissionMonthArchiveStyle';s.textContent=`
#commissionMonthArchive{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 12px}
#commissionMonthArchive button{min-height:38px;padding:8px 13px}
#commissionMonthArchive .month-active{background:#173b5e!important;color:#fff!important;border-color:#173b5e!important}
#commissionOtherMonths{position:relative}
#commissionOtherMonths>summary{list-style:none;cursor:pointer;user-select:none;border:1px solid #d9e0e8;border-radius:10px;background:#fff;padding:9px 13px;font-size:13px;font-weight:700;color:#475467}
#commissionOtherMonths>summary::-webkit-details-marker{display:none}
#commissionOtherMonths>summary:after{content:' ▾';font-size:11px}
#commissionOtherMonths[open]>summary:after{content:' ▴'}
#commissionOtherMonthList{position:absolute;z-index:30;top:45px;left:0;min-width:220px;max-height:300px;overflow:auto;padding:8px;background:#fff;border:1px solid #dfe5ec;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.12)}
.commission-month-option{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;margin:3px 0;border:0!important;background:#fff!important;color:#344054!important;text-align:left}
.commission-month-option:hover{background:#f5f7fa!important}.commission-month-option.month-active{background:#173b5e!important;color:#fff!important}
.commission-month-option span{font-size:12px;opacity:.72}.commission-month-empty-note{padding:10px;color:#98a2b3;font-size:13px;white-space:nowrap}
#commissionActiveMonthLabel{font-size:13px;font-weight:700;color:#667085}.commission-month-empty-row td{text-align:center;color:#98a2b3;padding:24px 12px!important}
`;
  document.head.appendChild(s);
}
wait();
})();+Number(raw).toFixed(2);
    });
    const date=(cells[0].textContent||'').trim();
    const show=rangeMode?true:date.slice(0,7)===activeMonth;
    row.style.display=show?'':'none';
    if(show){count++;qty+=Number((cells[3].textContent||'0').replace(/,/g,''))||0;amount+=Number((cells[5].textContent||'0').replace(/[^0-9.-]/g,''))||0;}
  });
  if(count===0&&!hasSystemEmptyRow&&!rangeMode){
    const tr=document.createElement('tr');tr.className='commission-month-empty-row';tr.innerHTML=`<td colspan="9">${monthLabel(activeMonth)}暂无销售提成记录</td>`;body.appendChild(tr);
  }
  summary.textContent=`记录 ${count}｜销售数量 ${qty}｜提成 $${amount.toFixed(2)}`;
  const label=document.getElementById('commissionActiveMonthLabel');
  if(label)label.textContent=rangeMode?rangeLabel():(activeMonth===currentMonth()?'':`当前显示：${monthLabel(activeMonth)}`);
  applying=false;observeBody();
}
function addStyle(){
  if(document.getElementById('commissionMonthArchiveStyle'))return;
  const s=document.createElement('style');s.id='commissionMonthArchiveStyle';s.textContent=`
#commissionMonthArchive{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 12px}
#commissionMonthArchive button{min-height:38px;padding:8px 13px}
#commissionMonthArchive .month-active{background:#173b5e!important;color:#fff!important;border-color:#173b5e!important}
#commissionOtherMonths{position:relative}
#commissionOtherMonths>summary{list-style:none;cursor:pointer;user-select:none;border:1px solid #d9e0e8;border-radius:10px;background:#fff;padding:9px 13px;font-size:13px;font-weight:700;color:#475467}
#commissionOtherMonths>summary::-webkit-details-marker{display:none}
#commissionOtherMonths>summary:after{content:' ▾';font-size:11px}
#commissionOtherMonths[open]>summary:after{content:' ▴'}
#commissionOtherMonthList{position:absolute;z-index:30;top:45px;left:0;min-width:220px;max-height:300px;overflow:auto;padding:8px;background:#fff;border:1px solid #dfe5ec;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.12)}
.commission-month-option{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;margin:3px 0;border:0!important;background:#fff!important;color:#344054!important;text-align:left}
.commission-month-option:hover{background:#f5f7fa!important}.commission-month-option.month-active{background:#173b5e!important;color:#fff!important}
.commission-month-option span{font-size:12px;opacity:.72}.commission-month-empty-note{padding:10px;color:#98a2b3;font-size:13px;white-space:nowrap}
#commissionActiveMonthLabel{font-size:13px;font-weight:700;color:#667085}.commission-month-empty-row td{text-align:center;color:#98a2b3;padding:24px 12px!important}
`;
  document.head.appendChild(s);
}
wait();
})();