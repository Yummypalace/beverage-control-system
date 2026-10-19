// Excel 导出：支持全部、指定日期、指定月份；历史库存统一使用共享正推引擎。
(function(){
  function wait(){if(typeof sb==='undefined'||typeof items==='undefined'||!window.InventoryHistoryEngine||!document.getElementById('dashboard')){setTimeout(wait,150);return;}install();}
  function install(){if(document.getElementById('exportExcelBtn'))return;loadSheetJS();const dashboard=document.getElementById('dashboard');const bar=document.createElement('div');bar.style.cssText='display:flex;justify-content:flex-end;margin:0 0 14px';bar.innerHTML='<button id="exportExcelBtn" class="secondary">导出 Excel</button>';dashboard.insertBefore(bar,dashboard.firstChild);buildDialog();document.getElementById('exportExcelBtn').onclick=()=>document.getElementById('exportExcelDialog').showModal();}
  function buildDialog(){if(document.getElementById('exportExcelDialog'))return;const d=document.createElement('dialog');d.id='exportExcelDialog';d.innerHTML=`<div class="modal"><h3>导出 Excel</h3><div class="grid2"><label class="full">导出范围<select id="excelExportRange"><option value="all">全部数据</option><option value="day">指定日期</option><option value="month">指定月份</option></select></label><label id="excelDayWrap" class="full hidden">日期<input id="excelExportDay" type="date"></label><label id="excelMonthWrap" class="full hidden">月份<input id="excelExportMonth" type="month"></label><div id="excelSnapshotHint" class="full hint" style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc">全部数据：库存工作表显示当前最新库存。</div></div><div class="modalfooter"><button id="cancelExcelExport" class="secondary">取消</button><button id="confirmExcelExport">导出</button></div></div>`;document.body.appendChild(d);document.getElementById('excelExportRange').onchange=toggleRange;document.getElementById('cancelExcelExport').onclick=()=>d.close();document.getElementById('confirmExcelExport').onclick=exportExcel;}
  function toggleRange(){const v=document.getElementById('excelExportRange').value;document.getElementById('excelDayWrap').classList.toggle('hidden',v!=='day');document.getElementById('excelMonthWrap').classList.toggle('hidden',v!=='month');const hint=document.getElementById('excelSnapshotHint');if(hint)hint.textContent=v==='day'?'指定日期：库存工作表显示该日期营业结束后的库存。':v==='month'?'指定月份：库存工作表显示该月份最后一天营业结束后的库存。':'全部数据：库存工作表显示当前最新库存。';}
  function loadSheetJS(){if(window.XLSX||document.getElementById('sheetJsLib'))return;const s=document.createElement('script');s.id='sheetJsLib';s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';document.head.appendChild(s);}
  function todaySG(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function dateOf(r){return r.operation_date||new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});}
  function inRange(r,mode,value){const d=dateOf(r);if(mode==='day')return d===value;if(mode==='month')return d.startsWith(value+'-');return true;}
  function monthEnd(month){const p=String(month).split('-').map(Number);if(p.length!==2||!p[0]||!p[1])return '';return new Date(Date.UTC(p[0],p[1],0)).toISOString().slice(0,10);}
  function reverseLogSort(a,b){const da=dateOf(a),db=dateOf(b);if(da!==db)return db.localeCompare(da);const ca=String(a.created_at||''),cb=String(b.created_at||'');if(ca!==cb)return cb.localeCompare(ca);return Number(b.id||0)-Number(a.id||0);}
  function locationOf(note){const s=String(note||'');if(s.startsWith('冰箱｜'))return 'fridge';if(s.startsWith('仓库｜'))return 'warehouse';return '';}
  function actionLabel(action){return ({IN:'入库',OUT:'出库',BORROW:'借出',RETURN:'还回',TRANSFER:'移库',ADJUST:'盘点',CREATE:'新增',EDIT:'编辑'})[String(action||'')]||String(action||'');}
  function parseBusinessNote(r){
    const raw=String(r?.note||'').trim(),action=String(r?.action||'');
    if(!raw)return {location:'',note:''};
    const parts=raw.split('｜').map(x=>String(x).trim());
    let location='';
    if(parts.length&&(/^(冰箱|仓库)$/.test(parts[0])||parts[0].includes('→')))location=parts.shift();
    if(action==='ADJUST'){
      const userParts=parts.filter(x=>x&&x!=='盘点调整'&&!/^调整前\s/.test(x)&&!/^调整后\s/.test(x));
      return {location,note:userParts.join('｜').trim()};
    }
    if(action==='TRANSFER'){
      if(!location&&parts.length&&parts[0].includes('→'))location=parts.shift();
      return {location,note:parts.join('｜').trim()};
    }
    if(['IN','OUT','BORROW','RETURN'].includes(action))return {location,note:parts.join('｜').trim()};
    return {location,note:(location?parts.join('｜'):raw).trim()};
  }
  function meaningfulBusinessNote(r){
    const action=String(r?.action||'');
    if(r?.correction_ref||action==='CREATE'||action==='EDIT'||action==='ADJUST')return false;
    return !!parseBusinessNote(r).note;
  }
  function noteCategory(note){
    const raw=String(note||'').trim(),s=raw.toLowerCase().replace(/\s+/g,' ');
    if(/(^|[^a-z])foc([^a-z]|$)/i.test(raw)||s.includes('complimentary')||raw.includes('免费'))return 'FOC';
    if(raw.includes('厨房')||s.includes('kitchen'))return '厨房使用';
    if(s.includes('no paid')||s.includes('not paid')||s.includes('unpaid')||raw.includes('没paid')||raw.includes('没 paid')||raw.includes('未付款')||raw.includes('没付款')||raw.includes('员工'))return '未付款 / 员工使用';
    if(/(^|[^a-z])ent([\s\-_/]|$)/i.test(raw)||s.includes('entertain')||raw.includes('招待'))return '招待 / ENT';
    return '其他';
  }
  function parseEditBefore(note){const s=String(note||'');const m=s.match(/调整前\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);return m?{fridge:Number(m[1]),warehouse:Number(m[2])}:null;}
  function parseAdjustBefore(note){const s=String(note||'');const m=s.match(/调整前\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);return m?Number(m[1]):null;}
  function addWarning(state,text){if(!state.warnings.includes(text))state.warnings.push(text);}
  function currentInventoryRows(snapshotDate){return [...items].sort((a,b)=>String(a.name).localeCompare(String(b.name))).map(x=>({'库存日期':snapshotDate,'名称':x.name,'类别':x.category||'','规格':x.spec||'','单位':x.unit||'','冰箱库存':Number(x.fridge_quantity||0),'仓库库存':Number(x.warehouse_quantity||0),'总库存':Number(x.fridge_quantity||0)+Number(x.warehouse_quantity||0),'最低库存':Number(x.min_quantity||0),'成本价 SGD':Number(x.cost_price||0),'单位提成 SGD':Number(x.commission_per_unit||0),'数据状态':'当前库存'}));}
  function forwardLogSort(a,b){const da=dateOf(a),db=dateOf(b);if(da!==db)return da.localeCompare(db);const ca=String(a.created_at||''),cb=String(b.created_at||'');if(ca!==cb)return ca.localeCompare(cb);return Number(a.id||0)-Number(b.id||0);}
  function parseCreateState(note){const s=String(note||'');const m=s.match(/冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);return m?{fridge:Number(m[1]),warehouse:Number(m[2])}:null;}
  function parseEditAfter(note){const s=String(note||'');let m=s.match(/调整后\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);if(m)return{fridge:Number(m[1]),warehouse:Number(m[2])};m=s.match(/编辑资料（冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)）/);return m?{fridge:Number(m[1]),warehouse:Number(m[2])}:null;}
  function historyItems(){
    return typeof allItems!=='undefined'&&Array.isArray(allItems)?allItems:items;
  }
  function historicalInventoryRows(allLogs,cutoff){
    const list=historyItems();
    const states=window.InventoryHistoryEngine.snapshotAt(list,allLogs,cutoff,{excludeStocktakeAdjustments:false});
    const rows=[];let uncertain=0;
    [...list].sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-CN',{numeric:true,sensitivity:'base'})).forEach(x=>{
      const s=states.get(String(x.id));
      if(!s||!s.exists)return;
      if(!window.InventoryHistoryEngine.itemRelevantAt(x,s,cutoff,allLogs,list))return;
      const locationBad=s.locationUncertain||s.fridge==null||s.warehouse==null;
      const state=s.totalUncertain?'需核对：旧记录缺少完整库存基准':locationBad?'需核对：旧记录缺少冰箱/仓库位置':'历史正推';
      if(state.startsWith('需核对'))uncertain++;
      rows.push({
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
        '数据状态':state
      });
    });
    return {rows,uncertain};
  }

  async function exportExcel(){if(!window.XLSX)return alert('Excel 模块正在加载，请稍后重试。');const mode=document.getElementById('excelExportRange').value,value=mode==='day'?document.getElementById('excelExportDay').value:mode==='month'?document.getElementById('excelExportMonth').value:'';if(mode!=='all'&&!value)return alert(mode==='day'?'请选择日期':'请选择月份');const btn=document.getElementById('confirmExcelExport');btn.disabled=true;btn.textContent='导出中...';try{
    const [logRes,comRes]=await Promise.all([sb.from('inventory_logs').select('*').order('operation_date',{ascending:true}).order('created_at',{ascending:true}),sb.from('commission_logs').select('*').order('operation_date',{ascending:true}).order('created_at',{ascending:true})]);if(logRes.error)throw logRes.error;if(comRes.error)throw comRes.error;
    const allLogs=logRes.data||[],allCommissions=comRes.data||[];
    const cutoff=mode==='day'?value:mode==='month'?monthEnd(value):todaySG();
    let inventory,inventorySheet='当前库存',uncertain=0;
    if(mode==='all')inventory=currentInventoryRows(cutoff);else{const snapshot=historicalInventoryRows(allLogs,cutoff);inventory=snapshot.rows;uncertain=snapshot.uncertain;inventorySheet='库存快照';}
    const actions={IN:'入库',OUT:'出库',TRANSFER:'移库',ADJUST:'盘点',CREATE:'新增',EDIT:'编辑'};
    const logRows=allLogs.filter(r=>inRange(r,mode,value));const comRows=allCommissions.filter(r=>inRange(r,mode,value));
    const logs=logRows.map(r=>({'日期':dateOf(r),'饮料':r.item_name||'','操作':actions[r.action]||r.action,'数量':Number(r.quantity||0),'备注':r.note||'','操作账号':r.user_email||''}));
    const outNotes=logRows.filter(meaningfulBusinessNote).map(r=>{const p=parseBusinessNote(r),action=String(r.action||'');const category=['BORROW','RETURN','TRANSFER','ADJUST'].includes(action)?'':noteCategory(p.note);return {'日期':dateOf(r),'饮料':r.item_name||'','用途分类':category,'操作':actionLabel(r.action),'数量':Number(r.quantity||0),'位置':p.location||'','备注':p.note,'操作账号':r.user_email||''};});
    const commission=comRows.map(r=>({'日期':dateOf(r),'员工':r.seller_name||'','饮料':r.item_name||'','销售数量':Number(r.quantity||0),'单位提成 SGD':Number(r.commission_per_unit||0),'提成金额 SGD':Number(r.commission_amount||0),'备注':r.note||'','录入账号':r.user_email||''}));
    const wb=XLSX.utils.book_new();addSheet(wb,inventorySheet,inventory);addSheet(wb,'库存记录',logs);addSheet(wb,'出入库备注',outNotes);addSheet(wb,'销售提成',commission);const label=mode==='all'?'全部':value;XLSX.writeFile(wb,`饮料库存数据_${label}.xlsx`);document.getElementById('exportExcelDialog').close();if(uncertain>0)alert(`Excel 已导出。\n其中 ${uncertain} 个品项含有旧版编辑/盘点记录，无法百分百确认调整前库存，已在“数据状态”栏标记为“需核对”。`);
  }catch(e){alert('导出失败：'+String(e.message||e));}finally{btn.disabled=false;btn.textContent='导出';}}
  function addSheet(wb,name,rows){const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'暂无数据':''}]);const range=XLSX.utils.decode_range(ws['!ref']),widths=[];for(let c=range.s.c;c<=range.e.c;c++){let max=10;for(let r=range.s.r;r<=range.e.r;r++){const cell=ws[XLSX.utils.encode_cell({r,c})];if(cell&&cell.v!=null)max=Math.max(max,String(cell.v).length+2);}widths.push({wch:Math.min(max,42)});}ws['!cols']=widths;ws['!autofilter']={ref:ws['!ref']};XLSX.utils.book_append_sheet(wb,ws,name);}
  wait();
})();