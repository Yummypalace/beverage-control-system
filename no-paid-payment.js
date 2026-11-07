// NO Paid settlement status only; inventory and POS records are never changed.
(function(){
  'use strict';
  let settlements=new Map(),dateDrafts=new Map(),busy=false,initialized=false,runId=0;
  let selectedMode='PAID';
  const $=id=>document.getElementById(id);
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  function wait(){
    if(typeof sb==='undefined'||!$('outNoteBody')){setTimeout(wait,200);return;}
    install();
  }
  function install(){
    if(initialized)return;initialized=true;
    const d=document.createElement('dialog');
    d.id='noPaidPaymentDialog';
    d.innerHTML=`<div class="modal no-paid-settlement-modal">
      <h3>NO Paid 结清登记</h3>
      <div id="noPaidPaymentInfo" class="hint" style="margin:8px 0 14px;white-space:pre-wrap"></div>
      <div class="no-paid-settlement-choices">
        <button type="button" id="noPaidChoosePaid" class="secondary">已付款 <small>POS 已开单</small></button>
        <button type="button" id="noPaidChooseBilled" class="secondary">已 Bill <small>统一结账，不进 POS</small></button>
      </div>
      <div id="noPaidSavedSummary" class="hint" hidden style="margin:12px 0 0;padding:12px;background:#f7f9fb;border-radius:8px;white-space:pre-wrap;line-height:1.8"></div>
      <div id="noPaidSettlementFields" hidden>
        <label style="display:block;margin:12px 0">
          <span id="noPaidSettlementDateLabel">付款日期</span>
          <input id="noPaidPaymentDate" type="date" style="width:100%;margin-top:6px">
        </label>
        <label style="display:block;margin:12px 0">
          <span id="noPaidSettlementNoteLabel">付款备注（选填）</span>
          <input id="noPaidPaymentNote" placeholder="例如：收款人 / POS 单号" style="width:100%;margin-top:6px">
        </label>
      </div>
      <div class="modalfooter" style="gap:8px;flex-wrap:wrap;margin-top:18px">
        <button type="button" class="secondary" id="noPaidPaymentUndo">改回未付款</button>
        <button type="button" class="secondary" id="noPaidPaymentCancel">取消</button>
        <button type="button" id="noPaidPaymentSave" class="green" hidden>确认</button>
      </div>
    </div>`;
    document.body.appendChild(d);
    const style=document.createElement('style');
    style.textContent=`
      #outNotes .out-note-payment-head,#outNotes .out-note-payment-cell{white-space:nowrap!important;min-width:112px;text-align:center}
      #outNotes .no-paid-status{border-radius:999px;padding:6px 11px;font-size:12px;font-weight:700;border:1px solid #d7dee7;background:#f0f2f5;color:#475467;white-space:nowrap}
      #outNotes .no-paid-status.is-paid{background:#e5f6eb;color:#087f5b;border-color:#bde6c9}
      #outNotes .no-paid-status.is-billed{background:#edf3ff;color:#345ca1;border-color:#cfdef8}
      #noPaidPaymentDialog{max-width:min(520px,calc(100vw - 24px));width:100%;border:0;border-radius:15px;box-shadow:0 20px 65px rgba(14,29,45,.27)}
      #noPaidPaymentDialog::backdrop{background:rgba(0,0,0,.45)}
      #noPaidPaymentDialog input{min-height:40px;box-sizing:border-box}
      #noPaidPaymentDialog .no-paid-settlement-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #noPaidPaymentDialog .no-paid-settlement-choices button{display:flex;flex-direction:column;align-items:center;gap:4px;min-height:68px;justify-content:center;border:1px solid #dce4eb;background:#f7f9fc;color:#17324d;border-radius:10px;font-size:15px;font-weight:700}
      #noPaidPaymentDialog .no-paid-settlement-choices small{font-size:11px;color:#667085;font-weight:500}
      #noPaidPaymentDialog .no-paid-settlement-choices button.is-selected{border:2px solid #087f5b;background:#ecf9f3}
      #noPaidPaymentDialog.is-locked .no-paid-settlement-choices{grid-template-columns:1fr}
      #noPaidPaymentDialog.is-locked .no-paid-settlement-choices button:not(.is-selected){display:none}
      #noPaidPaymentDialog.is-locked .no-paid-settlement-choices button.is-selected{cursor:default;pointer-events:none}
      @media(max-width:460px){#noPaidPaymentDialog .no-paid-settlement-choices{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    const paymentDate=$('noPaidPaymentDate');
    const rememberDate=()=>{const key=d.dataset.logId;if(key&&paymentDate.value)dateDrafts.set(key,paymentDate.value);};
    paymentDate.addEventListener('input',rememberDate);
    paymentDate.addEventListener('change',rememberDate);
    $('noPaidChoosePaid').onclick=()=>choose('PAID');
    $('noPaidChooseBilled').onclick=()=>choose('BILLED');
    $('noPaidPaymentCancel').onclick=()=>d.close();
    $('noPaidPaymentSave').onclick=()=>submit(false);
    $('noPaidPaymentUndo').onclick=()=>submit(true);
    new MutationObserver(()=>setTimeout(render,30)).observe($('outNoteBody'),{childList:true});
    const link=document.querySelector('.side-nav a[href="#outNotes"]');
    if(link)link.addEventListener('click',()=>setTimeout(load,350));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
    load();
  }
  async function load(){
    const key=++runId;
    const {data,error}=await sb.from('no_paid_payment_records').select('log_id,payment_date,payment_note,settlement_type');
    if(key!==runId)return;
    if(error){console.warn('NO Paid 结清资料读取失败',error);return;}
    settlements=new Map((data||[]).map(r=>[String(r.log_id),r]));
    render();
  }
  function render(){
    const body=$('outNoteBody'),head=document.querySelector('#outNotes .out-note-detail-wrap thead tr');
    if(!body||!head)return;
    if(!head.querySelector('.out-note-payment-head')){
      const th=document.createElement('th');th.className='out-note-payment-head';th.textContent='付款状态';
      const cat=head.querySelector('.out-note-category-head');
      if(cat)cat.after(th);else head.children[1]?.after(th);
    }
    body.querySelectorAll('tr[data-log-id]').forEach(tr=>{
      const cat=tr.querySelector('.out-note-category-cell');
      const action=tr.querySelector('.out-note-action-cell')?.dataset.action;
      const inferred=(tr.querySelector('.out-note-category-pill')?.textContent||'').trim()==='NO Paid';
      const legacyNote=(tr.querySelector('.out-note-note-cell')?.textContent||'');
      const noPaid=action==='OUT'&&(tr.dataset.outType==='NO_PAID'||(!tr.dataset.outType&&(inferred||/no\s*paid|not\s*paid|unpaid|没\s*paid|未付款|没付款/i.test(legacyNote))));
      let td=tr.querySelector('.out-note-payment-cell');
      if(!td){
        td=document.createElement('td');td.className='out-note-payment-cell';
        if(cat)cat.after(td);else tr.querySelector('.out-note-item-cell')?.after(td);
      }
      const record=settlements.get(String(tr.dataset.logId));
      const billed=record?.settlement_type==='BILLED';
      const label=!noPaid?'':record?(billed?'已 Bill':'已付款'):'未付款';
      td.dataset.label=label;
      td.replaceChildren();
      if(!noPaid)return;
      const btn=document.createElement('button');btn.type='button';
      btn.className='no-paid-status'+(record?(billed?' is-billed':' is-paid'):'');
      btn.textContent=label;
      if(record)btn.title=(billed?'Bill 日期：':'付款日期：')+record.payment_date;
      btn.onclick=()=>open(tr,record);
      td.appendChild(btn);
    });
  }
  function choose(mode){
    if($('noPaidPaymentDialog').classList.contains('is-locked'))return;
    selectedMode=mode;
    $('noPaidSettlementFields').hidden=false;
    $('noPaidPaymentDate').closest('label').hidden=false;
    $('noPaidPaymentSave').hidden=false;
    $('noPaidChoosePaid').classList.toggle('is-selected',mode==='PAID');
    $('noPaidChooseBilled').classList.toggle('is-selected',mode==='BILLED');
    $('noPaidSettlementDateLabel').textContent=mode==='BILLED'?'Bill 日期':'付款日期';
    $('noPaidSettlementNoteLabel').textContent=mode==='BILLED'?'Bill 备注（选填）':'付款备注（选填）';
    $('noPaidPaymentNote').placeholder=mode==='BILLED'?'例如：会计账单 / 客户名称':'例如：收款人 / POS 单号';
    $('noPaidPaymentSave').textContent=mode==='BILLED'?'确认已 Bill':'确认已付款';
  }
  function open(tr,record){
    const d=$('noPaidPaymentDialog');
    d.dataset.logId=tr.dataset.logId;
    const name=tr.querySelector('.out-note-item-cell')?.textContent.trim()||'';
    const qty=tr.querySelector('.out-note-qty-cell')?.textContent.trim()||'';
    const date=tr.querySelector('.out-note-date-cell')?.textContent.trim()||'';
    const note=tr.querySelector('.out-note-note-cell')?.textContent.trim()||'';
    $('noPaidPaymentInfo').textContent=name+'｜数量 '+qty+'｜出库日期 '+date+'\n备注：'+(note||'无');
    $('noPaidPaymentDate').value=record?.payment_date||dateDrafts.get(String(tr.dataset.logId))||today();
    $('noPaidPaymentDate').min=date||'';
    $('noPaidPaymentNote').value=record?.payment_note||'';
    $('noPaidPaymentUndo').style.display=record?'':'none';
    d.classList.remove('is-locked');
    const summary=$('noPaidSavedSummary');
    summary.hidden=!record;
    summary.textContent=record?((record.settlement_type==='BILLED'?'Bill 日期：':'付款日期：')+(record.payment_date||'-')+'\n'+(record.settlement_type==='BILLED'?'Bill 备注：':'付款备注：')+(record.payment_note||'-')):'';
    $('noPaidSettlementFields').hidden=true;
    $('noPaidPaymentSave').hidden=true;
    $('noPaidChoosePaid').classList.remove('is-selected');
    $('noPaidChooseBilled').classList.remove('is-selected');
    if(record){
      selectedMode=record.settlement_type==='BILLED'?'BILLED':'PAID';
      $('noPaidChoosePaid').classList.toggle('is-selected',selectedMode==='PAID');
      $('noPaidChooseBilled').classList.toggle('is-selected',selectedMode==='BILLED');
      d.classList.add('is-locked');
    }
    d.showModal();
  }
  async function submit(undo){
    if(busy)return;
    const d=$('noPaidPaymentDialog'),logId=Number(d.dataset.logId);
    if(!undo&&d.classList.contains('is-locked'))return;
    const date=undo?null:$('noPaidPaymentDate').value;
    if(!undo&&!date)return alert('请选择日期');
    if(undo&&!confirm('确定将这笔记录恢复为未付款？'))return;
    busy=true;
    const btn=$('noPaidPaymentSave');btn.disabled=true;
    try{
      const {error}=await sb.rpc('set_no_paid_payment',{
        p_log_id:logId,p_payment_date:date,
        p_payment_note:undo?'':$('noPaidPaymentNote').value.trim(),
        p_settlement_type:selectedMode
      });
      if(error)return alert('保存 NO Paid 状态失败：'+error.message);
      dateDrafts.delete(String(logId));
      d.close();
      await load();
    }finally{busy=false;btn.disabled=false;}
  }
  wait();
})();