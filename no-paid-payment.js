// NO Paid payment status is bookkeeping only; never alters inventory or POS.
(function(){
  'use strict';
  let payments=new Map(), busy=false, initialized=false, runId=0;
  const $=id=>document.getElementById(id);
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  function wait(){
    if(!window.sb&&!document.getElementById('outNoteBody')){setTimeout(wait,200);return;}
    if(typeof sb==='undefined'||!$('outNoteBody')){setTimeout(wait,200);return;}
    install();
  }
  function install(){
    if(initialized)return;initialized=true;
    const d=document.createElement('dialog');
    d.id='noPaidPaymentDialog';
    d.innerHTML='<form method="dialog" class="modal"><h3>NO Paid 付款登记</h3><div id="noPaidPaymentInfo" class="hint" style="margin:8px 0 14px;white-space:pre-wrap"></div><label style="display:block;margin:8px 0">付款日期<input id="noPaidPaymentDate" type="date" style="width:100%;margin-top:6px"></label><label style="display:block;margin:8px 0">付款备注（选填）<input id="noPaidPaymentNote" placeholder="例如：收款人 / POS 单号" style="width:100%;margin-top:6px"></label><div class="modalfooter" style="gap:8px;flex-wrap:wrap"><button type="button" class="secondary" id="noPaidPaymentUndo">改回未付款</button><button type="button" class="secondary" id="noPaidPaymentCancel">取消</button><button type="button" id="noPaidPaymentSave" class="green">确认付款</button></div></form>';
    document.body.appendChild(d);
    const style=document.createElement('style');
    style.textContent='#outNotes .out-note-payment-head,#outNotes .out-note-payment-cell{white-space:nowrap!important;min-width:112px;text-align:center}#outNotes .no-paid-status{border-radius:999px;padding:6px 11px;font-size:12px;font-weight:700;border:1px solid #d7dee7;background:#f0f2f5;color:#475467;white-space:nowrap}#outNotes .no-paid-status.is-paid{background:#e5f6eb;color:#087f5b;border-color:#bde6c9}#noPaidPaymentDialog input{min-height:40px}';
    document.head.appendChild(style);
    $('noPaidPaymentCancel').onclick=()=>d.close();
    $('noPaidPaymentSave').onclick=()=>submit(false);
    $('noPaidPaymentUndo').onclick=()=>submit(true);
    const body=$('outNoteBody');
    new MutationObserver(()=>{setTimeout(render,30);}).observe(body,{childList:true});
    const link=document.querySelector('.side-nav a[href="#outNotes"]');
    if(link)link.addEventListener('click',()=>setTimeout(load,350));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
    load();
  }
  async function load(){
    const key=++runId;
    const {data,error}=await sb.from('no_paid_payment_records').select('log_id,payment_date,payment_note');
    if(key!==runId)return;
    if(error){console.warn('NO Paid 付款资料读取失败',error);return;}
    payments=new Map((data||[]).map(r=>[String(r.log_id),r]));
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
      const noPaid=action==='OUT'&&(tr.dataset.outType==='NO_PAID');
      let td=tr.querySelector('.out-note-payment-cell');
      if(!td){
        td=document.createElement('td');td.className='out-note-payment-cell';
        if(cat)cat.after(td);else tr.querySelector('.out-note-item-cell')?.after(td);
      }
      const record=payments.get(String(tr.dataset.logId));
      const label=!noPaid?'':record?'已付款':'未付款';
      if(td.dataset.label===label)return;
      td.dataset.label=label;
      td.replaceChildren();
      if(!noPaid)return;
      const btn=document.createElement('button');btn.type='button';
      btn.className='no-paid-status'+(record?' is-paid':'');
      btn.textContent=label;
      if(record)btn.title='付款日期：'+record.payment_date;
      btn.onclick=()=>open(tr,record);
      td.appendChild(btn);
    });
  }
  function open(tr,record){
    const d=$('noPaidPaymentDialog');
    d.dataset.logId=tr.dataset.logId;
    const cells=tr.querySelectorAll('td');
    const name=tr.querySelector('.out-note-item-cell')?.textContent.trim()||'';
    const qty=tr.querySelector('.out-note-qty-cell')?.textContent.trim()||'';
    const date=tr.querySelector('.out-note-date-cell')?.textContent.trim()||'';
    const note=tr.querySelector('.out-note-note-cell')?.textContent.trim()||'';
    $('noPaidPaymentInfo').textContent=name+'｜数量 '+qty+'｜出库日期 '+date+'\n备注：'+(note||'无');
    $('noPaidPaymentDate').value=record?.payment_date||today();
    $('noPaidPaymentDate').min=date||'';
    $('noPaidPaymentNote').value=record?.payment_note||'';
    $('noPaidPaymentUndo').style.display=record?'':'none';
    $('noPaidPaymentSave').textContent=record?'更新付款日期':'确认付款';
    d.showModal();
  }
  async function submit(undo){
    if(busy)return;
    const d=$('noPaidPaymentDialog'),logId=Number(d.dataset.logId);
    const date=undo?null:$('noPaidPaymentDate').value;
    if(!undo&&!date)return alert('请选择付款日期');
    if(undo&&!confirm('确定将这笔记录恢复为未付款？'))return;
    busy=true;
    const btn=$('noPaidPaymentSave');btn.disabled=true;
    try{
      const {error}=await sb.rpc('set_no_paid_payment',{p_log_id:logId,p_payment_date:date,p_payment_note:undo?'':$('noPaidPaymentNote').value.trim()});
      if(error)return alert('保存付款状态失败：'+error.message);
      d.close();
      await load();
    }finally{busy=false;btn.disabled=false;}
  }
  wait();
})();