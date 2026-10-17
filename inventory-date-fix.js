// 强制库存操作把用户选择的日期直接写入 inventory_logs.operation_date。
// 同时记录盘点/编辑前后的库存，方便以后准确还原历史库存。
(function(){
  let installed=false;

  function wait(){
    if(typeof sb==='undefined'||typeof items==='undefined'||typeof saveStock!=='function'||typeof saveItem!=='function'||typeof fridge!=='function'||typeof warehouse!=='function'||typeof userEmail!=='function'||typeof loadAll!=='function'){
      setTimeout(wait,120);return;
    }
    install();
  }

  function selected(id){return document.getElementById(id)?.value||'';}

  function replaceButton(id,handler){
    const old=document.getElementById(id);
    if(!old)return;
    const fresh=old.cloneNode(true);
    old.replaceWith(fresh);
    fresh.onclick=handler;
  }

  function ensureOutTypeField(){
    const grid=document.querySelector('#stockDialog .grid2');
    if(!grid||document.getElementById('stockOutTypeWrap'))return;
    const label=document.createElement('label');
    label.id='stockOutTypeWrap';
    label.className='hidden';
    label.innerHTML=`出库类型
      <select id="stockOutType">
        <option value="NORMAL">正常销售</option>
        <option value="ENT">ENT</option>
        <option value="FOC">FOC</option>
        <option value="KITCHEN">厨房做酱</option>
        <option value="NO_PAID">NO Paid</option>
        <option value="OTHER">其他</option>
      </select>`;
    const seller=document.getElementById('sellerWrap');
    grid.insertBefore(label,seller||null);
  }

  function syncOutTypeVisibility(){
    const wrap=document.getElementById('stockOutTypeWrap');
    const select=document.getElementById('stockOutType');
    const action=document.getElementById('stockAction')?.value||'';
    if(wrap)wrap.classList.toggle('hidden',action!=='OUT');
    if(action!=='OUT'&&select)select.value='NORMAL';
  }

  function install(){
    if(installed)return;installed=true;

    ensureOutTypeField();
    const actionSelect=document.getElementById('stockAction');
    if(actionSelect)actionSelect.addEventListener('change',syncOutTypeVisibility);
    const previousOpenStock=openStock;
    openStock=function(id,action){
      previousOpenStock(id,action);
      const type=document.getElementById('stockOutType');
      if(type)type.value='NORMAL';
      syncOutTypeVisibility();
    };

    saveStock=async function(){
      const x=items.find(i=>i.id===stockItemId);if(!x)return;
      const date=selected('stockOperationDate');
      if(!date)return alert('请选择日期');

      const action=document.getElementById('stockAction').value;
      const loc=document.getElementById('stockLocation').value;
      const outType=action==='OUT'?(document.getElementById('stockOutType')?.value||'NORMAL'):null;
      const qty=Number(document.getElementById('stockQty').value);
      if(!Number.isFinite(qty)||qty<0)return alert('请输入正确数量');
      if(['IN','OUT','BORROW','RETURN'].includes(action)&&qty<=0)return alert('数量必须大于 0');

      const btn=document.getElementById('saveStockBtn');
      if(btn?.disabled)return;
      if(btn){btn.disabled=true;btn.textContent='处理中...';}

      try{
        const userNote=(document.getElementById('stockNote').value||'').trim();
        const {data,error}=await sb.rpc('apply_inventory_change',{
          p_item:x.id,
          p_action:action,
          p_location:loc,
          p_quantity:qty,
          p_operation_date:date,
          p_note:userNote,
          p_out_type:outType
        });

        if(error){
          alert('库存操作失败：'+error.message+'\n库存和记录都没有改变。');
          return;
        }

        document.getElementById('stockDialog').close();
        await loadAll();
      }finally{
        if(btn){btn.disabled=false;btn.textContent='确认';}
      }
    };

    saveItem=async function(){
      const date=selected('itemOperationDate');
      if(!date)return alert('请选择日期');

      const fq=Number(document.getElementById('itemFridgeQty').value||0);
      const wq=Number(document.getElementById('itemWarehouseQty').value||0);
      const name=document.getElementById('itemName').value.trim();
      if(!name)return alert('请输入名称');
      if(!Number.isFinite(fq)||fq<0||!Number.isFinite(wq)||wq<0)return alert('库存数量不能小于 0');

      const btn=document.getElementById('saveItemBtn');
      if(btn?.disabled)return;
      if(btn){btn.disabled=true;btn.textContent='保存中...';}

      try{
        const {data,error}=await sb.rpc('save_inventory_item_atomic',{
          p_item:editingId||null,
          p_name:name,
          p_category:document.getElementById('itemCategory').value,
          p_spec:document.getElementById('itemSpec').value.trim(),
          p_unit:document.getElementById('itemUnit').value.trim()||'瓶',
          p_fridge_quantity:fq,
          p_warehouse_quantity:wq,
          p_min_quantity:Number(document.getElementById('itemMin').value||0),
          p_cost_price:Number(document.getElementById('itemCost').value||0),
          p_commission_per_unit:Number(document.getElementById('itemCommission').value||0),
          p_operation_date:date
        });

        if(error){
          alert('保存失败：'+error.message+'\n资料和记录都没有改变。');
          return;
        }

        document.getElementById('itemDialog').close();
        editingId=null;
        await loadAll();
      }finally{
        if(btn){btn.disabled=false;btn.textContent='保存';}
      }
    };

    replaceButton('saveStockBtn',()=>saveStock());
    replaceButton('saveItemBtn',()=>saveItem());
  }

  wait();
})();