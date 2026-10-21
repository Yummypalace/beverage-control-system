// POS 错单调整：品项开错与数量开错分开进入。
(function(){
  let currentType='item';
  function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function wait(){if(typeof sb==='undefined'||typeof items==='undefined'||!document.getElementById('inventory')){setTimeout(wait,150);return;}install();}
  function install(){
    const qtyBtn=document.getElementById('posQuantityCorrectionBtn');
    if(qtyBtn)qtyBtn.remove();
    document.getElementById('posItemCorrectionBtn')?.remove();
    buildDialog();
    // 盘点调整页面由后续脚本创建，因此等待其工具栏出现再挂载入口。
    const placeButton=()=>{
      const toolbar=document.querySelector('#stocktakeAdjust .stocktake-toolbar-actions');
      if(!toolbar)return false;
      if(!document.getElementById('stocktakeItemCorrectionBtn')){
        const btn=document.createElement('button');
        btn.id='stocktakeItemCorrectionBtn';
        btn.type='button';
        btn.className='secondary';
        btn.textContent='品项开错';
        btn.onclick=()=>openDialog('item');
        toolbar.insertBefore(btn,toolbar.firstChild);
      }
      return true;
    };
    if(!placeButton()){
      const timer=setInterval(()=>{if(placeButton())clearInterval(timer);},200);
    }
  }
  function buildDialog(){if(document.getElementById('posCorrectionDialog'))return;const d=document.createElement('dialog');d.id='posCorrectionDialog';d.innerHTML=`<div class="modal"><h3 id="posCorrectionTitle">错单调整</h3><div class="grid2"><label class="full">日期<input id="posCorrectionDate" type="date" required></label><div id="posItemCorrectionFields" class="full grid2" style="grid-column:1/-1"><label>POS 开成<select id="posWrongItem"></select></label><label>恢复位置<select id="posWrongLocation"><option value="fridge">冰箱</option><option value="warehouse">仓库</option></select></label><label>实际饮用<select id="posActualItem"></select></label><label>扣减位置<select id="posActualLocation"><option value="fridge">冰箱</option><option value="warehouse">仓库</option></select></label><label>数量<input id="posCorrectionQty" type="number" min="0.01" step="0.01" value="1"></label></div><div id="posQuantityCorrectionFields" class="full grid2" style="display:none;grid-column:1/-1"><label class="full">饮料<select id="posQtyItem"></select></label><label class="full">盘点盈余数量<input id="posQtyDifference" type="number" min="0.01" step="0.01" value="1"></label><label class="full">库存位置<select id="posQtyLocation"><option value="fridge">冰箱</option><option value="warehouse">仓库</option></select></label></div><label class="full">备注<input id="posCorrectionNote" placeholder="原因（选填）"></label><div id="posCorrectionPreview" class="full hint" style="display:none;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc"></div></div><div class="modalfooter"><button id="cancelPosCorrection" class="secondary">取消</button><button id="savePosCorrection">确认调整</button></div></div>`;document.body.appendChild(d);document.getElementById('cancelPosCorrection').onclick=()=>d.close();document.getElementById('savePosCorrection').onclick=saveCorrection;['posWrongItem','posActualItem','posWrongLocation','posActualLocation','posCorrectionQty','posQtyItem','posQtyDifference','posQtyLocation'].forEach(id=>{const el=document.getElementById(id);if(el)el.onchange=renderPreview;});}
  function optionList(){return '<option value="">请选择饮料</option>'+[...items].sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');}
  function openDialog(type){currentType=type;const opts=optionList();['posWrongItem','posActualItem','posQtyItem'].forEach(id=>document.getElementById(id).innerHTML=opts);document.getElementById('posCorrectionTitle').textContent=type==='item'?'品项开错':'数量开错';document.getElementById('posItemCorrectionFields').style.display=type==='item'?'grid':'none';document.getElementById('posQuantityCorrectionFields').style.display=type==='quantity'?'grid':'none';document.getElementById('posWrongLocation').value='fridge';document.getElementById('posActualLocation').value='fridge';document.getElementById('posQtyLocation').value='fridge';document.getElementById('posCorrectionQty').value='1';document.getElementById('posQtyDifference').value='1';document.getElementById('posCorrectionNote').value='';document.getElementById('posCorrectionDate').value=today();renderPreview();document.getElementById('posCorrectionDialog').showModal();}
  function getItem(id){return items.find(x=>String(x.id)===String(id));}
  function renderPreview(){const box=document.getElementById('posCorrectionPreview');if(!box)return;if(currentType==='item'){const wrong=getItem(document.getElementById('posWrongItem')?.value),actual=getItem(document.getElementById('posActualItem')?.value),qty=Number(document.getElementById('posCorrectionQty')?.value||0);if(wrong&&actual){box.style.display='block';box.innerHTML=`调整结果：<b>${esc(wrong.name)} +${qty||0}</b>；<b>${esc(actual.name)} -${qty||0}</b>`;}else{box.style.display='none';box.textContent='';}return;}const item=getItem(document.getElementById('posQtyItem')?.value),diff=Number(document.getElementById('posQtyDifference')?.value||0);if(item&&Number.isFinite(diff)&&diff>0){box.style.display='block';box.innerHTML=`调整结果：<b>${esc(item.name)} +${diff}</b>`;}else{box.style.display='none';box.textContent='';}}
  function rpcMissing(error,name){const m=String(error?.message||'').toLowerCase();return m.includes('could not find the function')&&m.includes(String(name).toLowerCase());}
  async function saveQuantityCorrection(item,difference,loc,date,note){
    let result=await sb.rpc('correct_pos_quantity_difference',{p_item:item,p_difference:difference,p_difference_type:'extra',p_location:loc,p_operation_date:date,p_note:note});
    if(result.error&&rpcMissing(result.error,'correct_pos_quantity_difference')){
      const legacyNote=`盘点盈余数量 ${difference}${note?'｜'+note:''}`;
      result=await sb.rpc('correct_pos_quantity',{p_item:item,p_pos_qty:difference,p_actual_qty:0,p_location:loc,p_operation_date:date,p_note:legacyNote});
    }
    return result;
  }
  async function saveCorrection(){const date=document.getElementById('posCorrectionDate').value,note=document.getElementById('posCorrectionNote').value.trim();if(!date)return alert('请选择日期');const btn=document.getElementById('savePosCorrection');btn.disabled=true;btn.textContent='处理中...';let error=null;if(currentType==='item'){const wrong=document.getElementById('posWrongItem').value,actual=document.getElementById('posActualItem').value,qty=Number(document.getElementById('posCorrectionQty').value),wrongLoc=document.getElementById('posWrongLocation').value,actualLoc=document.getElementById('posActualLocation').value;if(!wrong||!actual){btn.disabled=false;btn.textContent='确认调整';return alert('请选择两种饮料');}if(wrong===actual){btn.disabled=false;btn.textContent='确认调整';return alert('POS 开错饮料与实际饮料不能相同');}if(!Number.isFinite(qty)||qty<=0){btn.disabled=false;btn.textContent='确认调整';return alert('请输入有效数量');}({error}=await sb.rpc('correct_pos_inventory',{p_wrong_item:wrong,p_actual_item:actual,p_qty:qty,p_wrong_location:wrongLoc,p_actual_location:actualLoc,p_operation_date:date,p_note:note}));}else{const item=document.getElementById('posQtyItem').value,difference=Number(document.getElementById('posQtyDifference').value),loc=document.getElementById('posQtyLocation').value;if(!item){btn.disabled=false;btn.textContent='确认调整';return alert('请选择饮料');}if(!Number.isFinite(difference)||difference<=0){btn.disabled=false;btn.textContent='确认调整';return alert('请输入盘点盈余数量');}({error}=await saveQuantityCorrection(item,difference,loc,date,note));}
    btn.disabled=false;btn.textContent='确认调整';if(error)return alert('调整失败：'+error.message+'\n\n如果仍然出现 function / schema cache 提示，请在 Supabase 运行最新版 pos-correction.sql。');document.getElementById('posCorrectionDialog').close();await loadAll();if(typeof window.refreshCorrectionHistory==='function')window.refreshCorrectionHistory();if(document.getElementById('stocktakeAdjust')?.style.display!=='none')document.getElementById('stocktakeRefresh')?.click();alert('库存更正已完成。POS 销量不变，月结继续按原出库品项计算。');}
  wait();
})();