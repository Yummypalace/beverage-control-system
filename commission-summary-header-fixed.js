// 销售提成：只固定表格表头；不改动筛选栏、汇总栏、表格结构或页面布局。
(function(){
  'use strict';

  let overlay=null;
  let headerTable=null;
  let section=null;
  let table=null;

  function build(){
    if(document.getElementById('commissionHeaderOnlyOverlay'))return;
    overlay=document.createElement('div');
    overlay.id='commissionHeaderOnlyOverlay';
    overlay.innerHTML='<div class="commission-fixed-head-viewport"><table><thead></thead></table></div>';
    document.body.appendChild(overlay);
    headerTable=overlay.querySelector('table');

    const style=document.createElement('style');
    style.id='commissionHeaderOnlyOverlayStyle';
    style.textContent=`
#commissionHeaderOnlyOverlay{
  position:fixed;
  top:0;
  z-index:5000;
  display:none;
  box-sizing:border-box;
  background:#f8fafc;
  box-shadow:0 2px 7px rgba(15,23,42,.08);
  pointer-events:none;
}
#commissionHeaderOnlyOverlay .commission-fixed-head-viewport{
  width:100%;
  overflow:hidden;
  background:#f8fafc;
  border-bottom:1px solid #e5e7eb;
}
#commissionHeaderOnlyOverlay table{
  border-collapse:collapse;
  table-layout:fixed;
  margin:0;
}
#commissionHeaderOnlyOverlay th{
  background:#f8fafc!important;
  color:#6b7280;
  font-size:12px;
  text-align:left;
  border-bottom:1px solid #e5e7eb;
  padding:10px 8px;
  white-space:nowrap;
  box-sizing:border-box;
}
`;
    document.head.appendChild(style);
  }

  function bindTargets(){
    section=document.getElementById('commission');
    table=section?.querySelector('table')||null;
    return !!(section&&table&&table.tHead&&table.tHead.rows.length);
  }

  function syncHeader(){
    if(!bindTargets())return false;
    const originalRow=table.tHead.rows[0];
    const clone=originalRow.cloneNode(true);
    clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));

    const thead=headerTable.tHead;
    thead.innerHTML='';
    thead.appendChild(clone);

    const originalCells=[...originalRow.cells];
    const cloneCells=[...clone.cells];
    originalCells.forEach((cell,i)=>{
      const width=cell.getBoundingClientRect().width;
      if(cloneCells[i]){
        cloneCells[i].style.width=width+'px';
        cloneCells[i].style.minWidth=width+'px';
        cloneCells[i].style.maxWidth=width+'px';
      }
    });
    headerTable.style.width=Math.max(table.scrollWidth,table.getBoundingClientRect().width)+'px';
    return true;
  }

  function update(){
    if(!overlay||!bindTargets())return;

    const sectionStyle=getComputedStyle(section);
    if(sectionStyle.display==='none'||section.closest('.hidden')){
      overlay.style.display='none';
      return;
    }

    const originalHead=table.tHead.getBoundingClientRect();
    const tableRect=table.getBoundingClientRect();
    const sectionRect=section.getBoundingClientRect();

    // 只有原表头滚出页面顶部，而表格内容仍在视窗中时才显示固定表头。
    const shouldShow=originalHead.top<0 && tableRect.bottom>originalHead.height;
    if(!shouldShow){
      overlay.style.display='none';
      return;
    }

    if(!syncHeader()){
      overlay.style.display='none';
      return;
    }

    const left=Math.max(0,sectionRect.left);
    const right=Math.min(window.innerWidth,sectionRect.right);
    const width=Math.max(0,right-left);

    overlay.style.top='48px';
    overlay.style.left=left+'px';
    overlay.style.width=width+'px';
    overlay.style.display='block';

    // 跟随原页面的横向滚动，不改变原表格本身。
    const scrollLeft=section.scrollLeft||0;
    headerTable.style.transform='translateX('+(-scrollLeft)+'px)';
  }

  function install(){
    build();
    if(!bindTargets()){setTimeout(install,150);return;}

    window.addEventListener('scroll',update,{passive:true});
    window.addEventListener('resize',update,{passive:true});
    section.addEventListener('scroll',update,{passive:true});

    const observer=new MutationObserver(()=>requestAnimationFrame(update));
    observer.observe(section,{childList:true,subtree:true,characterData:true});

    update();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();