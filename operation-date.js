// 库存操作日期保持上一次选择，只有用户手动修改时才改变。
(function(){
  const MIN_OPERATION_DATE='2026-09-01';
  const MIN_OPERATION_MONTH='2026-09';
  function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function validDate(d){return /^\d{4}-\d{2}-\d{2}$/.test(String(d||''))&&String(d)>=MIN_OPERATION_DATE;}
  let stockDate=localStorage.getItem('stockOperationDate')||today();
  if(!validDate(stockDate)){stockDate=today();localStorage.setItem('stockOperationDate',stockDate);}
  function applyDateMinimum(root=document){
    root.querySelectorAll?.('input[type="date"]').forEach(e=>{e.min=MIN_OPERATION_DATE;});
    root.querySelectorAll?.('input[type="month"]').forEach(e=>{e.min=MIN_OPERATION_MONTH;});
  }
  function wait(){if(typeof saveItem!=='function'||typeof saveStock!=='function'||typeof render!=='function'||typeof sb==='undefined'){setTimeout(wait,120);return;}install();}
  function addDate(dialogId,inputId){const dialog=document.getElementById(dialogId);if(!dialog||document.getElementById(inputId))return;const grid=dialog.querySelector('.grid2');if(!grid)return;const label=document.createElement('label');label.className='full';label.innerHTML=`日期<input id="${inputId}" type="date" required><span class="hint">支持历史日期补录</span>`;grid.insertBefore(label,grid.firstChild);}
  function setToday(id){const e=document.getElementById(id);if(e)e.value=today();}
  function setStockDate(){const e=document.getElementById('stockOperationDate');if(e)e.value=stockDate;}
  function dateOf(x){return x.operation_date||new Date(x.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function install(){
    addDate('itemDialog','itemOperationDate');addDate('stockDialog','stockOperationDate');
    applyDateMinimum();
    const observer=new MutationObserver(mutations=>{
      mutations.forEach(m=>m.addedNodes.forEach(node=>{
        if(node.nodeType!==1)return;
        if(node.matches?.('input[type="date"]'))node.min=MIN_OPERATION_DATE;
        if(node.matches?.('input[type="month"]'))node.min=MIN_OPERATION_MONTH;
        applyDateMinimum(node);
      }));
    });
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('change',e=>{
      const el=e.target;
      if(el?.matches?.('input[type="date"]')&&el.value&&el.value<MIN_OPERATION_DATE){
        el.value='';
        alert('系统只允许填写 2026年9月1日及以后的日期。');
      }
      if(el?.matches?.('input[type="month"]')&&el.value&&el.value<MIN_OPERATION_MONTH){
        el.value='';
        alert('系统只允许填写 2026年9月及以后的月份。');
      }
    },true);
    const stockInput=document.getElementById('stockOperationDate');if(stockInput){stockInput.value=stockDate;stockInput.addEventListener('change',()=>{if(stockInput.value){stockDate=stockInput.value;localStorage.setItem('stockOperationDate',stockDate);}});}
    const oldNew=newItem;newItem=function(){oldNew();setToday('itemOperationDate');};
    const oldEdit=editItem;editItem=function(id){oldEdit(id);setToday('itemOperationDate');};
    const oldOpenStock=openStock;openStock=function(id,action){oldOpenStock(id,action);setStockDate();};
    const oldSaveItem=saveItem;saveItem=async function(){const d=document.getElementById('itemOperationDate')?.value;if(!d)return alert('请选择日期');window.__operationDate=d;return oldSaveItem();};
    const oldSaveStock=saveStock;saveStock=async function(){const d=document.getElementById('stockOperationDate')?.value;if(!d)return alert('请选择日期');stockDate=d;localStorage.setItem('stockOperationDate',d);window.__operationDate=d;return oldSaveStock();};
    const originalFrom=sb.from.bind(sb);sb.from=function(table){const q=originalFrom(table);if(table!=='inventory_logs'&&table!=='commission_logs')return q;const originalInsert=q.insert.bind(q);q.insert=function(values,...args){const d=window.__operationDate;if(d){if(Array.isArray(values))values=values.map(v=>({...v,operation_date:v.operation_date||d}));else if(values&&typeof values==='object')values={...values,operation_date:values.operation_date||d};}return originalInsert(values,...args);};return q;};
    const oldRender=render;render=function(){oldRender();const body=document.getElementById('logBody');if(body){[...body.rows].forEach((tr,i)=>{const x=logs[i];if(x&&tr.cells[0])tr.cells[0].textContent=dateOf(x);});}const cb=document.getElementById('commissionBody');if(cb){[...cb.rows].forEach((tr,i)=>{const x=commissions[i];if(x&&tr.cells[0])tr.cells[0].textContent=dateOf(x);});}const stat=document.getElementById('statToday');if(stat)stat.textContent=logs.filter(x=>dateOf(x)===today()).length;};
  }
  wait();
})();