// 饮料转换：只修正月结 POS 品项归类，实物库存保持原样。
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let saving=false;
  function init(){
    if(typeof sb==='undefined'||typeof items==='undefined'||!document.querySelector('#inventory .toolbar')){setTimeout(init,180);return;}
    if($('beverageConversionBtn'))return;
    const b=document.createElement('button');
    b.id='beverageConversionBtn';b.type='button';b.className='secondary';b.textContent='饮料转换';
    b.onclick=open;
    document.querySelector('#inventory .toolbar').appendChild(b);
    const d=document.createElement('dialog');d.id='beverageConversionDialog';
    d.innerHTML=`<div class="modal">
      <h3>饮料转换 · POS 品项更正</h3>
      <p class="hint" style="line-height:1.7">例如实际喝了无糖可乐，但 POS 开成可乐。转换只调整月结中 POS 的品项对应，<b>不再扣减或增加实际库存</b>。</p>
      <div class="grid2">
        <label class="full">发生日期<input type="date" id="beverageConversionDate"></label>
        <label>POS 开成<select id="beverageConversionFrom"></select></label>
        <label>实际喝了<select id="beverageConversionTo"></select></label>
        <label class="full">数量<input id="beverageConversionQty" type="number" min="0.01" step="0.01" value="1"></label>
        <label class="full">备注（选填）<input id="beverageConversionNote" placeholder="例如：顾客喝无糖可乐，POS 误开可乐"></label>
      </div>
      <div id="beverageConversionPreview" class="hint" style="margin-top:12px;line-height:1.7"></div>
      <div class="modalfooter"><button type="button" class="secondary" id="beverageConversionClose">取消</button><button type="button" class="green" id="beverageConversionSave">确认转换</button></div>
      <h4 style="margin:18px 0 8px">最近转换记录</h4>
      <div id="beverageConversionHistory" style="max-height:190px;overflow:auto;font-size:12px"></div>
    </div>`;
    document.body.appendChild(d);
    $('beverageConversionClose').onclick=()=>d.close();
    $('beverageConversionSave').onclick=save;
    for(const id of ['beverageConversionFrom','beverageConversionTo','beverageConversionQty'])$(id).addEventListener('input',preview);
  }
  function selected(id){return (typeof items!=='undefined'?items:[]).find(x=>String(x.id)===$(id)?.value);}
  function open(){
    const list=Array.isArray(items)?items:[];
    const opts='<option value="">请选择饮料</option>'+list.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN')).map(x=>`<option value="${safe(x.id)}">${safe(x.name)}</option>`).join('');
    $('beverageConversionFrom').innerHTML=opts;
    $('beverageConversionTo').innerHTML=opts;
    $('beverageConversionDate').value=today();
    $('beverageConversionDate').max=today();
    $('beverageConversionQty').value=1;
    $('beverageConversionNote').value='';
    preview();loadHistory();
    $('beverageConversionDialog').showModal();
  }
  function preview(){
    const from=selected('beverageConversionFrom'),to=selected('beverageConversionTo'),qty=Number($('beverageConversionQty').value);
    $('beverageConversionPreview').textContent=from&&to&&qty>0
      ?'月结 POS 品项转换：'+from.name+' −'+qty+'，'+to.name+' +'+qty+'。原 POS 输入值保留，实物库存不变。'
      :'请选择 POS 品项、实际饮用品项和数量。';
  }
  async function loadHistory(){
    $('beverageConversionHistory').textContent='读取中...';
    const {data,error}=await sb.from('beverage_pos_conversions')
      .select('id,operation_date,pos_item_id,actual_item_id,quantity,note,created_by')
      .order('id',{ascending:false}).limit(30);
    if(error){$('beverageConversionHistory').textContent='读取失败：'+error.message;return;}
    const names=new Map((typeof allItems!=='undefined'&&Array.isArray(allItems)?allItems:items).map(x=>[String(x.id),x.name]));
    $('beverageConversionHistory').innerHTML=(data||[]).map(r=>
      `<div style="padding:7px 0;border-bottom:1px solid #eee">${safe(r.operation_date)}｜${safe(names.get(String(r.pos_item_id))||'原品项')} → ${safe(names.get(String(r.actual_item_id))||'实际品项')}｜${safe(r.quantity)}${r.note?'｜'+safe(r.note):''}</div>`
    ).join('')||'<span class="hint">暂无转换记录</span>';
  }
  async function save(){
    if(saving)return;
    const from=$('beverageConversionFrom').value,to=$('beverageConversionTo').value;
    const qty=Number($('beverageConversionQty').value),date=$('beverageConversionDate').value;
    const note=$('beverageConversionNote').value.trim();
    if(!from||!to||from===to)return alert('请选择不同的两种饮料');
    if(!Number.isFinite(qty)||qty<=0)return alert('请输入正确数量');
    if(!date)return alert('请选择发生日期');
    if(!confirm('确认将 POS 开成的品项转换为实际饮用的品项？\n只调整月结 POS 归类，不改变实体库存。'))return;
    saving=true;$('beverageConversionSave').disabled=true;
    try{
      const {error}=await sb.rpc('add_beverage_pos_conversion',{
        p_pos_item:from,p_actual_item:to,p_qty:qty,p_operation_date:date,p_note:note
      });
      if(error)throw error;
      alert('转换记录已保存。月结核对重新读取后会显示调整后的 POS 归类。');
      $('beverageConversionDialog').close();
      if(typeof window.refreshMonthlyReconciliation==='function')window.refreshMonthlyReconciliation();
      if(typeof window.loadMonthlyReconciliation==='function')window.loadMonthlyReconciliation();
    }catch(e){alert('饮料转换保存失败：'+(e.message||e));}
    finally{saving=false;$('beverageConversionSave').disabled=false;}
  }
  init();
})();