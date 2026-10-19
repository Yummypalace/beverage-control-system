// Fix historical snapshot export for backdated inventory entries.
(function(){
  const $=id=>document.getElementById(id);
  function dateOf(r){return r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function loc(note){const s=String(note||'');if(s.startsWith('冰箱｜'))return 'fridge';if(s.startsWith('仓库｜'))return 'warehouse';return '';}
  function parsePair(note,label){
    const s=String(note||'');
    const re=label==='after'
      ? /调整后\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/
      : /冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/;
    const m=s.match(re);return m?{fridge:Number(m[1]),warehouse:Number(m[2])}:null;
  }
  function historyItems(){
    return typeof allItems!=='undefined'&&Array.isArray(allItems)?allItems:items;
  }
  function build(allLogs,cutoff){
    if(!window.InventoryHistoryEngine)throw new Error('历史库存引擎尚未加载，请刷新页面后重试。');
    const list=historyItems();
    const states=window.InventoryHistoryEngine.snapshotAt(list,allLogs,cutoff,{excludeStocktakeAdjustments:false});
    return [...list].sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN',{numeric:true,sensitivity:'base'})).flatMap(x=>{
      const s=states.get(String(x.id));
      if(!s||!s.exists)return [];
      if(!window.InventoryHistoryEngine.itemRelevantAt(x,s,cutoff,allLogs,list))return [];
      const locationBad=s.locationUncertain||s.fridge==null||s.warehouse==null;
      return [{
        '库存日期':cutoff,
        '名称':x.name,
        '类别':x.category||'',
        '规格':x.spec||'',
        '单位':x.unit||'',
        '冰箱库存':locationBad?'':Number(s.fridge),
        '仓库库存':locationBad?'':Number(s.warehouse),
        '总库存':Number(s.total),
        '最低库存':Number(x.min_quantity||0),
        '成本价 SGD':Number(x.cost_price||0),
        '单位提成 SGD':Number(x.commission_per_unit||0),
        '数据状态':s.totalUncertain?'需核对：旧记录缺少完整库存基准':locationBad?'需核对：旧记录缺少冰箱/仓库位置':'历史正推'
      }];
    });
  }

  function addSheet(wb,name,rows){
    const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'暂无数据':''}]);
    ws['!autofilter']={ref:ws['!ref']};
    XLSX.utils.book_append_sheet(wb,ws,name);
  }
  async function fixedExport(){
    const mode=$('excelExportRange')?.value;
    if(mode!=='day'&&mode!=='month')return;
    const value=mode==='day'?$('excelExportDay')?.value:$('excelExportMonth')?.value;
    if(!value)return;
    const cutoff=mode==='day'?value:new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0)).toISOString().slice(0,10);
    const btn=$('confirmExcelExport');btn.disabled=true;btn.textContent='导出中...';
    try{
      const [lr,cr]=await Promise.all([
        sb.from('inventory_logs').select('*').order('operation_date',{ascending:true}).order('created_at',{ascending:true}),
        sb.from('commission_logs').select('*').order('operation_date',{ascending:true}).order('created_at',{ascending:true})
      ]);
      if(lr.error)throw lr.error;if(cr.error)throw cr.error;
      const inv=build(lr.data||[],cutoff);
      const logs=(lr.data||[]).filter(r=>mode==='day'?dateOf(r)===value:dateOf(r).startsWith(value+'-')).map(r=>({'日期':dateOf(r),'饮料':r.item_name||'','操作':({IN:'入库',OUT:'出库',BORROW:'借出',RETURN:'还回',TRANSFER:'移库',ADJUST:'盘点',CREATE:'新增',EDIT:'编辑'})[r.action]||r.action,'数量':Number(r.quantity||0),'备注':r.note||'','操作账号':r.user_email||''}));
      const com=(cr.data||[]).filter(r=>mode==='day'?dateOf(r)===value:dateOf(r).startsWith(value+'-')).map(r=>({'日期':dateOf(r),'员工':r.seller_name||'','饮料':r.item_name||'','销售数量':Number(r.quantity||0),'单位提成 SGD':Number(r.commission_per_unit||0),'提成金额 SGD':Number(r.commission_amount||0),'备注':r.note||'','录入账号':r.user_email||''}));
      const wb=XLSX.utils.book_new();addSheet(wb,'库存快照',inv);addSheet(wb,'库存记录',logs);addSheet(wb,'销售提成',com);
      XLSX.writeFile(wb,'饮料库存数据_'+value+'.xlsx');
      $('exportExcelDialog')?.close();
    }catch(e){alert('导出失败：'+String(e.message||e));}
    finally{btn.disabled=false;btn.textContent='导出';}
  }
  function install(){
    const btn=$('confirmExcelExport');
    if(!btn||!window.InventoryHistoryEngine){setTimeout(install,300);return;}
    if(btn.dataset.backdateFix)return;
    const original=btn.onclick;
    btn.onclick=function(e){
      const mode=$('excelExportRange')?.value;
      if(mode==='day'||mode==='month'){e?.preventDefault?.();fixedExport();}
      else if(original)original.call(this,e);
    };
    btn.dataset.backdateFix='1';
  }
  install();
})();