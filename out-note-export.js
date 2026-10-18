// 出入库备注 Excel 导出：导出当前页面筛选后可见的明细与用途分类汇总。
(function(){
  'use strict';
  let installed=false;

  function wait(){
    if(!document.getElementById('outNoteFilters')||!document.getElementById('outNoteBody')){
      setTimeout(wait,150);return;
    }
    install();
  }

  function install(){
    if(installed)return;installed=true;
    addButton();
    loadSheetJS();
  }

  function addButton(){
    if(document.getElementById('exportOutNoteExcel'))return;
    const actions=document.querySelector('#outNoteFilters .out-note-actions');
    if(!actions)return;
    const btn=document.createElement('button');
    btn.id='exportOutNoteExcel';
    btn.className='secondary';
    btn.textContent='导出 Excel';
    btn.onclick=exportExcel;
    actions.appendChild(btn);
  }

  function loadSheetJS(){
    if(window.XLSX||document.getElementById('outNoteSheetJs'))return;
    const s=document.createElement('script');
    s.id='outNoteSheetJs';
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    document.head.appendChild(s);
  }

  function txt(el){return (el?.textContent||'').trim();}
  function num(v){const n=Number(String(v||'').replace(/,/g,''));return Number.isFinite(n)?n:0;}
  function visibleRows(){
    return [...document.querySelectorAll('#outNoteBody tr')].filter(tr=>{
      if(!tr.querySelector('.out-note-date-cell'))return false;
      if(tr.style.display==='none')return false;
      return getComputedStyle(tr).display!=='none';
    });
  }

  function detailRows(){
    return visibleRows().map(tr=>({
      '日期':txt(tr.querySelector('.out-note-date-cell')),
      '饮料':txt(tr.querySelector('.out-note-item-cell')),
      '用途分类':txt(tr.querySelector('.out-note-category-cell')),
      '操作':txt(tr.querySelector('.out-note-action-cell')),
      '数量':num(txt(tr.querySelector('.out-note-qty-cell'))),
      '位置':txt(tr.querySelector('.out-note-location-cell')),
      '备注':txt(tr.querySelector('.out-note-note-cell')),
      '操作账号':txt(tr.querySelector('.out-note-user-cell'))
    }));
  }

  function summaryRows(details){
    const groups=new Map();
    details.forEach(r=>{
      const key=r['用途分类']||'';
      if(!key)return;
      const g=groups.get(key)||{'用途分类':key,'记录数':0,'数量合计':0};
      g['记录数']+=1;
      g['数量合计']+=Number(r['数量']||0);
      groups.set(key,g);
    });
    return [...groups.values()]
      .map(x=>({...x,'数量合计':Number(x['数量合计'].toFixed(2))}))
      .sort((a,b)=>b['数量合计']-a['数量合计']||b['记录数']-a['记录数']||a['用途分类'].localeCompare(b['用途分类']));
  }

  function fileLabel(){
    const month=document.getElementById('outNoteMonthFilter')?.value||'';
    const from=document.getElementById('outNoteDateFrom')?.value||'';
    const to=document.getElementById('outNoteDateTo')?.value||'';
    if(month)return month;
    if(from&&to)return from===to?from:`${from}_至_${to}`;
    if(from)return `${from}_起`;
    if(to)return `截至_${to}`;
    return '全部';
  }

  function addSheet(wb,name,rows){
    const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'暂无数据':''}]);
    if(ws['!ref']){
      const range=XLSX.utils.decode_range(ws['!ref']),widths=[];
      for(let c=range.s.c;c<=range.e.c;c++){
        let max=10;
        for(let r=range.s.r;r<=range.e.r;r++){
          const cell=ws[XLSX.utils.encode_cell({r,c})];
          if(cell&&cell.v!=null)max=Math.max(max,String(cell.v).length+2);
        }
        widths.push({wch:Math.min(max,42)});
      }
      ws['!cols']=widths;
      ws['!autofilter']={ref:ws['!ref']};
    }
    XLSX.utils.book_append_sheet(wb,ws,name);
  }

  function exportExcel(){
    if(typeof window.applyOutNoteCategoryFilter==='function')window.applyOutNoteCategoryFilter();
    if(!window.XLSX){
      loadSheetJS();
      alert('Excel 模块正在加载，请稍后再按一次。');
      return;
    }
    const details=detailRows();
    if(!details.length){
      alert('目前筛选条件下没有可以导出的出入库备注。');
      return;
    }
    const summary=summaryRows(details);
    const wb=XLSX.utils.book_new();
    addSheet(wb,'出入库备注',details);
    addSheet(wb,'用途分类汇总',summary);
    XLSX.writeFile(wb,`出入库备注_${fileLabel()}.xlsx`);
  }

  wait();
})();