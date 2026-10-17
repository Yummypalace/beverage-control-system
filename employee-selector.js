// 销售提成员工名单：存储于 Supabase，所有账号共用。
(function(){
  let employees=[];
  let loadTimer=null;
  let loading=false;
  function wait(){const seller=document.getElementById('manualCommissionSeller'),panel=document.getElementById('manualCommissionPanel');if(!seller||!panel||typeof sb==='undefined'){setTimeout(wait,150);return;}install();}
  async function loadEmployees(retry=0){
    if(loading&&retry===0)return;
    loading=true;
    const select=document.getElementById('manualCommissionEmployeeSelect');
    const list=document.getElementById('employeeList');
    if(!employees.length){
      if(select)select.innerHTML='<option value="">读取员工中...</option>';
      if(list)list.innerHTML='<span class="hint">员工名单读取中...</span>';
    }
    const {data,error}=await sb.from('commission_employees').select('*').order('name',{ascending:true});
    loading=false;
    if(error){
      console.error('commission_employees load failed',error);
      // 读取失败时不要把旧名单清空；自动重试，避免出现“名单空了但数据库里其实还在”的假象。
      if(retry<3){
        clearTimeout(loadTimer);
        loadTimer=setTimeout(()=>loadEmployees(retry+1),500*(retry+1));
      }else{
        if(select&&!employees.length)select.innerHTML='<option value="">员工名单读取失败，请稍后重试</option>';
        if(list&&!employees.length)list.innerHTML='<span class="hint" style="color:#c92a2a">员工名单读取失败，请稍后再打开提成页面。</span>';
      }
      return;
    }
    employees=data||[];
    render();
  }
  async function addEmployee(){
    const input=document.getElementById('newEmployeeName'),name=input.value.trim();
    if(!name)return alert('请输入员工姓名');

    if(employees.some(x=>String(x.name).toLowerCase()===name.toLowerCase())){
      await loadEmployees();
      const select=document.getElementById('manualCommissionEmployeeSelect'),seller=document.getElementById('manualCommissionSeller');
      if(select)select.value=employees.find(x=>String(x.name).toLowerCase()===name.toLowerCase())?.name||name;
      if(seller)seller.value=select?.value||name;
      return alert('这个员工已经在名单里，已帮你重新加载员工名单。');
    }

    const {error}=await sb.from('commission_employees').insert({name});
    if(error){
      const msg=String(error.message||'').toLowerCase();
      if(msg.includes('duplicate')||msg.includes('unique')){
        await loadEmployees();
        const select=document.getElementById('manualCommissionEmployeeSelect'),seller=document.getElementById('manualCommissionSeller');
        const found=employees.find(x=>String(x.name).toLowerCase()===name.toLowerCase());
        if(select&&found)select.value=found.name;
        if(seller)seller.value=found?.name||name;
        return alert('这个员工本来就已经存在，刚才只是员工名单没有成功显示。现在已经重新加载。');
      }
      return alert('新增失败：'+error.message);
    }

    input.value='';
    await loadEmployees();
    const select=document.getElementById('manualCommissionEmployeeSelect'),seller=document.getElementById('manualCommissionSeller');
    if(select)select.value=name;
    if(seller)seller.value=name;
  }
  async function removeEmployee(id){const row=employees.find(x=>String(x.id)===String(id));if(!row)return;if(!confirm(`确认删除员工「${row.name}」？`))return;const {error}=await sb.from('commission_employees').delete().eq('id',id);if(error)return alert('删除失败：'+error.message);const select=document.getElementById('manualCommissionEmployeeSelect'),seller=document.getElementById('manualCommissionSeller');if(select?.value===row.name){select.value='';if(seller)seller.value='';}await loadEmployees();}
  function install(){if(document.getElementById('employeeManager')){loadEmployees();return;}const seller=document.getElementById('manualCommissionSeller');const label=seller.closest('label');if(!label)return;const select=document.createElement('select');select.id='manualCommissionEmployeeSelect';select.innerHTML='<option value="">请选择员工</option>';seller.style.display='none';label.insertBefore(select,seller);const manager=document.createElement('div');manager.id='employeeManager';manager.style.cssText='grid-column:1/-1;border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;margin-top:2px';manager.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px"><b style="font-size:14px">员工名单</b><span id="employeeCount" style="font-size:12px;color:#6b7280"></span></div><div style="display:flex;gap:8px"><input id="newEmployeeName" placeholder="员工姓名" style="flex:1"><button id="addEmployeeBtn" type="button" class="secondary">新增员工</button></div><div id="employeeList" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px"></div>';const topGrid=label.parentElement;topGrid.parentElement.insertBefore(manager,topGrid.nextSibling);select.onchange=()=>{seller.value=select.value;};document.getElementById('addEmployeeBtn').onclick=addEmployee;document.getElementById('newEmployeeName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addEmployee();}});loadEmployees();}
  function render(){const select=document.getElementById('manualCommissionEmployeeSelect'),list=document.getElementById('employeeList');if(!select||!list)return;const current=select.value;select.innerHTML='<option value="">请选择员工</option>'+employees.map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('');if(employees.some(x=>x.name===current))select.value=current;document.getElementById('employeeCount').textContent=employees.length+' 人';list.innerHTML=employees.map(x=>`<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid #e5e7eb;border-radius:999px;background:#f8fafc;font-size:13px">${esc(x.name)}<button type="button" onclick="window.removeCommissionEmployee('${x.id}')" style="background:none;color:#c92a2a;padding:0;font-size:14px">×</button></span>`).join('')||'<span class="hint">暂无员工</span>';}
  document.addEventListener('click',e=>{
    const link=e.target&&e.target.closest?e.target.closest('.side-nav a[href="#commission"]'):null;
    if(link)setTimeout(()=>loadEmployees(),80);
  },true);
  window.addEventListener('focus',()=>{
    const commission=document.getElementById('commission');
    if(commission&&getComputedStyle(commission).display!=='none')loadEmployees();
  });

  window.removeCommissionEmployee=removeEmployee;
  window.refreshCommissionEmployees=loadEmployees;
  wait();
})();