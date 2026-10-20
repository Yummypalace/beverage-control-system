// 账号目录 + Admin/User 权限 + 停用/启用 + 从系统名单删除。
// 登录账号切换后自动重新读取权限，无需手动刷新页面。
(function(){
  let installed=false,currentRole='user',currentActive=true,authListenerInstalled=false;

  function wait(){
    if(typeof sb==='undefined'||typeof accountClient==='undefined'||typeof createAccount!=='function'||!document.getElementById('managementPanel')){setTimeout(wait,150);return;}
    install();
  }

  async function install(){
    if(!installed){
      installed=true;
      buildAccountUI();
      installAuthListener();
    }
    await refreshCurrentAccount();
  }

  function installAuthListener(){
    if(authListenerInstalled)return;
    authListenerInstalled=true;
    sb.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'||!session){
        currentRole='user';currentActive=true;window.currentAppRole='user';
        const badge=document.getElementById('currentRoleBadge');if(badge)badge.remove();
        return;
      }
      if(event==='SIGNED_IN'||event==='USER_UPDATED'||event==='TOKEN_REFRESHED'){
        // showApp 会先更新页面中的 userEmail；稍后重新读取该账号权限。
        setTimeout(()=>refreshCurrentAccount(),120);
      }
    });
  }

  async function refreshCurrentAccount(){
    const email=userEmail();
    if(!email)return;
    await ensureCurrentAccount();
    await loadCurrentAccount();
    if(!currentActive){
      alert('此账号已停用，请联系管理员。');
      await sb.auth.signOut();
      return;
    }
    buildAccountUI();
    applyRoleUI();
    window.dispatchEvent(new CustomEvent('app-role-changed',{detail:{role:currentRole,is_active:currentActive}}));
    if(currentRole==='admin')await loadAccounts();
    else{
      const list=document.getElementById('accountDirectoryList');
      if(list)list.innerHTML='';
    }
  }

  async function readAccountWithRetry(columns,email){
    let last={data:null,error:new Error('账号读取失败')};
    for(let i=0;i<3;i++){
      try{
        last=await sb.from('app_accounts').select(columns).eq('email',email).maybeSingle();
        if(!last.error)return last;
      }catch(e){
        last={data:null,error:e};
      }
      if(i<2)await new Promise(r=>setTimeout(r,220*(i+1)));
    }
    return last;
  }

  async function ensureCurrentAccount(){
    const email=userEmail();if(!email)return;
    const {data,error}=await readAccountWithRetry('id,email,role,is_active',email);
    if(error){console.warn('账号目录暂时读取失败，不自动建立新账号',error);return;}
    if(data)return;
    const created=await sb.from('app_accounts').insert({email,role:'admin',is_active:true,created_by:email});
    if(created.error)console.warn('账号目录自动建立失败',created.error);
  }

  async function loadCurrentAccount(){
    const email=userEmail();if(!email)return;
    const {data,error}=await readAccountWithRetry('role,is_active',email);
    if(error){
      console.warn('账号权限暂时读取失败，保留当前权限状态',error);
      return;
    }
    currentRole=data?.role||'user';
    currentActive=data?.is_active!==false;
    window.currentAppRole=currentRole;
  }

  function setMsg(t,isError=false){const el=document.getElementById('accountManageMsg');if(!el)return;el.textContent=t;el.style.color=isError?'#c92a2a':'#087f5b';setTimeout(()=>{if(el.textContent===t)el.textContent='';},3000);}

  function buildAccountUI(){
    const panel=document.getElementById('managementPanel');if(!panel)return;
    const accountCard=[...panel.querySelectorAll('div')].find(x=>x.querySelector(':scope > h3')?.textContent.includes('新增登录账号'));if(!accountCard)return;
    if(!document.getElementById('newAccountRole')){
      const pwd=document.getElementById('newAccountPassword');
      const wrap=document.createElement('label');wrap.style.cssText='display:block;font-size:12px;color:#6b7280;margin-bottom:8px';
      wrap.innerHTML='账号权限<select id="newAccountRole" style="width:100%;margin-top:5px"><option value="user">User</option><option value="admin">Admin</option></select>';
      pwd.parentElement.insertBefore(wrap,pwd.nextSibling);
    }
    if(!document.getElementById('accountDirectory')){
      const box=document.createElement('div');box.id='accountDirectory';box.style.marginTop='18px';
      box.innerHTML='<div class="section-head"><h3 style="margin:0;font-size:16px">已建立账号</h3><span class="hint">账号权限与状态管理</span></div><div id="accountManageMsg" class="hint" style="min-height:18px;margin-bottom:6px"></div><div id="accountDirectoryList" class="hint">读取中...</div>';
      accountCard.appendChild(box);
    }
    createAccount=async function(){
      if(currentRole!=='admin')return alert('仅 Admin 可新增账号');
      const email=document.getElementById('newAccountEmail').value.trim(),password=document.getElementById('newAccountPassword').value,role=document.getElementById('newAccountRole').value,msg=document.getElementById('accountCreateMsg');
      if(!email)return alert('请输入 Email');if(password.length<6)return alert('密码至少 6 位');
      msg.textContent='正在建立账号...';
      const {data,error}=await accountClient.auth.signUp({email,password});
      if(error){msg.textContent='建立失败：'+error.message;return;}
      const saved=await sb.from('app_accounts').upsert({email,role,is_active:true,created_by:userEmail()},{onConflict:'email'});
      if(saved.error){msg.textContent='账号已建立，但账号目录保存失败：'+saved.error.message;return;}
      document.getElementById('newAccountEmail').value='';document.getElementById('newAccountPassword').value='';document.getElementById('newAccountRole').value='user';
      msg.textContent=data.user?'账号建立成功。':'账号建立请求已提交。';await loadAccounts();
    };
    const btn=document.getElementById('createAccountBtn');if(btn)btn.onclick=createAccount;
  }

  function applyRoleUI(){
    const isAdmin=currentRole==='admin';
    const settingsLink=document.querySelector('.side-nav a[href="#settings"]');if(settingsLink)settingsLink.style.display=isAdmin?'flex':'none';
    const settings=document.getElementById('settings');if(settings)settings.style.display=isAdmin&&settingsLink?.classList.contains('active')?'block':'none';
    const cat=document.getElementById('dashboardCategoryPanel');if(cat)cat.style.display=isAdmin?'block':'none';
    const addBtn=document.getElementById('addBtn');if(addBtn)addBtn.style.display='';
    const drawerEdit=document.getElementById('drawerEditBtn');if(drawerEdit)drawerEdit.style.display='';
    const drawerDelete=document.getElementById('drawerDeleteBtn');if(drawerDelete)drawerDelete.style.display=isAdmin?'':'none';

    // User 登录时若上一账号停留在管理设置，则自动返回工作台。
    if(!isAdmin&&settingsLink?.classList.contains('active')&&typeof showPage==='function')showPage('dashboard');

    const emailEl=document.getElementById('userEmail');let badge=document.getElementById('currentRoleBadge');
    if(emailEl&&!badge){badge=document.createElement('span');badge.id='currentRoleBadge';badge.className='pill';badge.style.marginLeft='6px';emailEl.insertAdjacentElement('afterend',badge);}
    if(badge)badge.textContent=isAdmin?'Admin':'User';
  }

  async function loadAccounts(retry=0){
    const list=document.getElementById('accountDirectoryList');if(!list)return;
    const {data,error}=await sb.from('app_accounts').select('*').order('created_at',{ascending:false});
    if(error){
      if(retry<2){
        await new Promise(r=>setTimeout(r,220*(retry+1)));
        return loadAccounts(retry+1);
      }
      console.warn('账号资料读取失败，保留现有名单',error);
      setMsg('账号资料读取失败，已保留现有名单',true);
      if(!list.children.length)list.innerHTML='账号资料读取失败，请稍后重试。';
      return;
    }
    const rows=data||[];
    list.style.cssText='min-width:0;max-width:100%;overflow-x:auto;box-sizing:border-box';
    list.innerHTML=rows.map(x=>{const self=x.email.toLowerCase()===userEmail().toLowerCase();return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 88px 58px 64px 58px;align-items:center;gap:6px;min-width:0;width:100%;box-sizing:border-box;padding:11px 0;border-bottom:1px solid #eee"><div><b style="color:#172033;overflow-wrap:anywhere">${esc(x.email)}</b><div style="font-size:11px;color:${x.is_active===false?'#c92a2a':'#087f5b'};margin-top:3px">${x.is_active===false?'已停用':'使用中'}${self?' · 当前账号':''}</div></div><select class="account-role-select" data-id="${x.id}" data-email="${esc(x.email)}"><option value="user" ${x.role==='user'?'selected':''}>User</option><option value="admin" ${x.role==='admin'?'selected':''}>Admin</option></select><button class="secondary account-role-save" data-id="${x.id}" data-email="${esc(x.email)}" style="padding:7px 8px">保存</button><button class="${x.is_active===false?'green':'red'} account-active-btn" data-id="${x.id}" data-email="${esc(x.email)}" data-active="${x.is_active!==false}" style="padding:7px 8px" ${self?'disabled title="当前账号不可停用"':''}>${x.is_active===false?'启用':'停用'}</button><button class="secondary account-delete-btn" data-id="${x.id}" data-email="${esc(x.email)}" style="padding:7px 8px" ${self?'disabled title="当前账号不可删除"':''}>删除</button></div>`;}).join('')||'暂无账号记录。';
    list.querySelectorAll('.account-role-save').forEach(btn=>btn.onclick=()=>saveRole(btn));
    list.querySelectorAll('.account-active-btn').forEach(btn=>{if(!btn.disabled)btn.onclick=()=>toggleActive(btn);});
    list.querySelectorAll('.account-delete-btn').forEach(btn=>{if(!btn.disabled)btn.onclick=()=>deleteDirectoryAccount(btn);});
  }

  async function saveRole(btn){
    if(currentRole!=='admin')return;
    const id=btn.dataset.id,email=btn.dataset.email,row=btn.parentElement,sel=row.querySelector('.account-role-select'),role=sel.value;
    if(email.toLowerCase()===userEmail().toLowerCase()&&role==='user'){
      if(!confirm('将当前账号改为 User 后，将无法进入账号管理。确认继续？')){await loadAccounts();return;}
    }
    btn.disabled=true;btn.textContent='保存中';
    const {error}=await sb.from('app_accounts').update({role}).eq('id',id);
    btn.disabled=false;btn.textContent='保存';
    if(error){setMsg('权限修改失败：'+error.message,true);await loadAccounts();return;}
    setMsg('账号权限已更新');
    if(email.toLowerCase()===userEmail().toLowerCase()){await refreshCurrentAccount();return;}
    await loadAccounts();
  }

  async function toggleActive(btn){
    if(currentRole!=='admin')return;
    const id=btn.dataset.id,email=btn.dataset.email,isActive=btn.dataset.active==='true';
    if(!confirm(`${isActive?'停用':'启用'}账号「${email}」？`))return;
    btn.disabled=true;
    const {error}=await sb.from('app_accounts').update({is_active:!isActive}).eq('id',id);
    if(error){btn.disabled=false;setMsg('账号状态修改失败：'+error.message,true);return;}
    setMsg(isActive?'账号已停用':'账号已启用');await loadAccounts();
  }

  async function deleteDirectoryAccount(btn){
    if(currentRole!=='admin')return;
    const id=btn.dataset.id,email=btn.dataset.email;
    if(!confirm(`确认从系统账号目录删除「${email}」？\n此操作不会删除 Supabase Authentication 中的登录用户。`))return;
    btn.disabled=true;
    const {error}=await sb.from('app_accounts').delete().eq('id',id);
    if(error){btn.disabled=false;setMsg('删除失败：'+error.message,true);return;}
    setMsg('账号目录记录已删除');await loadAccounts();
  }

  window.refreshAccountPermissions=refreshCurrentAccount;
  wait();
})();