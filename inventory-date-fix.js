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
        <option value="CREDIT">签单</option>
        <option value="FOC">FOC</option>
        <option value="KITCHEN">厨房使用</option>
        <option value="STAFF">员工使用</option>
        <option value="ENT">招待 / ENT</option>
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

      const current=loc==='fridge'?fridge(x):warehouse(x);
      let next=current;
      if(action==='IN')next+=qty;
      if(action==='OUT'){
        if(qty>current)return alert((loc==='fridge'?'冰箱':'仓库')+'库存不足');
        next-=qty;
      }
      if(action==='ADJUST')next=qty;

      const update=loc==='fridge'
        ?{fridge_quantity:next,updated_at:new Date().toISOString()}
        :{warehouse_quantity:next,updated_at:new Date().toISOString()};

      const u=await sb.from('inventory_items').update(update).eq('id',x.id);
      if(u.error)return alert('库存更新失败：'+u.error.message);

      const locationName=loc==='fridge'?'冰箱':'仓库';
      const userNote=(document.getElementById('stockNote').value||'').trim();
      const logNote=action==='ADJUST'
        ?`${locationName}｜盘点调整｜调整前 ${current}｜调整后 ${next}${userNote?'｜'+userNote:''}`
        :`${locationName}｜${userNote}`;

      const l=await sb.from('inventory_logs').insert({
        item_id:x.id,
        item_name:x.name,
        action,
        quantity:qty,
        out_type:outType,
        note:logNote,
        user_email:userEmail(),
        operation_date:date
      });

      if(l.error){
        alert('库存已更新，但日期记录失败：'+l.error.message+'。请确认已运行 operation-date-upgrade.sql。');
        return;
      }

      document.getElementById('stockDialog').close();
      await loadAll();
    };

    saveItem=async function(){
      const date=selected('itemOperationDate');
      if(!date)return alert('请选择日期');

      const fq=Number(document.getElementById('itemFridgeQty').value||0);
      const wq=Number(document.getElementById('itemWarehouseQty').value||0);
      const p={
        name:document.getElementById('itemName').value.trim(),
        category:document.getElementById('itemCategory').value,
        spec:document.getElementById('itemSpec').value.trim(),
        unit:document.getElementById('itemUnit').value.trim()||'瓶',
        fridge_quantity:fq,
        warehouse_quantity:wq,
        quantity:fq+wq,
        min_quantity:Number(document.getElementById('itemMin').value||0),
        cost_price:Number(document.getElementById('itemCost').value||0),
        commission_per_unit:Number(document.getElementById('itemCommission').value||0),
        updated_at:new Date().toISOString()
      };

      if(!p.name)return alert('请输入名称');
      const isEdit=!!editingId;
      const beforeItem=isEdit?items.find(i=>i.id===editingId):null;
      const beforeF=beforeItem?fridge(beforeItem):0;
      const beforeW=beforeItem?warehouse(beforeItem):0;
      const r=isEdit
        ?await sb.from('inventory_items').update(p).eq('id',editingId).select().single()
        :await sb.from('inventory_items').insert(p).select().single();

      if(r.error)return alert('保存失败：'+r.error.message);

      const l=await sb.from('inventory_logs').insert({
        item_id:r.data.id,
        item_name:r.data.name,
        action:isEdit?'EDIT':'CREATE',
        quantity:fq+wq,
        note:isEdit
          ?`编辑资料（调整前 冰箱 ${beforeF} / 仓库 ${beforeW}；调整后 冰箱 ${fq} / 仓库 ${wq}）`
          :`新增饮料（冰箱 ${fq} / 仓库 ${wq}）`,
        user_email:userEmail(),
        operation_date:date
      });

      if(l.error){
        alert('资料已保存，但日期记录失败：'+l.error.message);
        return;
      }

      document.getElementById('itemDialog').close();
      await loadAll();
    };

    replaceButton('saveStockBtn',()=>saveStock());
    replaceButton('saveItemBtn',()=>saveItem());
  }

  wait();
})();