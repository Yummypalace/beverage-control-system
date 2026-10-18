// 精简侧边栏：移除“操作记录”和“系统说明”，把管理设置独立为“管理设置”页面。
(function(){
  let installed=false;
  function wait(){
    if(typeof showPage!=='function'||typeof ensureManagementUI!=='function'||!document.querySelector('.side-nav')){setTimeout(wait,120);return;}
    install();
  }
  function install(){
    if(installed)return;installed=true;
    const nav=document.querySelector('.side-nav');

    // 固定侧边栏顺序，后加载的页面也不能把顺序打乱。
    if(!document.getElementById('fixedSidebarOrderStyle')){
      const s=document.createElement('style');
      s.id='fixedSidebarOrderStyle';
      s.textContent=`
.side-nav a[href="#dashboard"]{order:10}
.side-nav a[href="#inventory"]{order:20}
.side-nav a[href="#commission"]{order:30}
.side-nav a[href="#outNotes"]{order:40}
.side-nav a[href="#stocktakeAdjust"]{order:50}
.side-nav a[href="#monthlyReconciliation"]{order:60}
.side-nav a[href="#corrections"]{order:70}
.side-nav a[href="#settings"]{order:80}
.side-nav a[href="#logs"]{order:90}
`;
      document.head.appendChild(s);
    }
    const logsLink=nav.querySelector('a[href="#logs"]');
    const settingsLink=nav.querySelector('a[href="#settings"]');
    if(logsLink)logsLink.remove();
    if(settingsLink){settingsLink.querySelector('.side-label').textContent='管理设置';settingsLink.setAttribute('title','管理设置');}

    // 保留 settings 容器供原有管理功能使用，但移除“系统说明”文字。
    const settings=document.getElementById('settings');
    if(settings){
      const heading=settings.querySelector(':scope > .section-head');
      const intro=settings.querySelector(':scope > p');
      if(heading)heading.remove();
      if(intro)intro.remove();
      settings.classList.add('card');
    }

    // 操作记录仍保留在数据库及每个饮料的历史中，只是不再作为侧边栏页面显示。
    const logs=document.getElementById('logs');
    if(logs)logs.style.display='none';

    // 重新初始化导航，避免已删除链接残留行为。
    document.querySelectorAll('.side-nav a').forEach(a=>{
      a.onclick=e=>{e.preventDefault();showPage(a.getAttribute('href').slice(1));};
    });
  }
  wait();
})();