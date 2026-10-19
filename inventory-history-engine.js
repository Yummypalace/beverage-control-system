// 统一历史库存计算引擎。
// 盘点调整、月结核对、历史 Excel 都使用这里的同一套正推逻辑，避免不同页面算出不同月末库存。
(function(){
  'use strict';

  const EPS=0.000001;

  function num(v){
    const n=Number(v==null?0:v);
    return Number.isFinite(n)?n:0;
  }
  function clean(v){return Number(num(v).toFixed(2));}
  function dateOf(r){
    if(r&&r.operation_date)return String(r.operation_date);
    if(!r||!r.created_at)return '';
    return new Date(r.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  }
  function monthOf(r){return dateOf(r).slice(0,7);}
  function createdSort(a,b){
    const ca=String(a?.created_at||''),cb=String(b?.created_at||'');
    if(ca!==cb)return ca.localeCompare(cb);
    return Number(a?.id||0)-Number(b?.id||0);
  }
  function locationOf(note){
    const first=String(note||'').split('｜')[0].trim();
    return first==='冰箱'?'fridge':first==='仓库'?'warehouse':'';
  }
  function parsePair(note,preferAfter=false){
    const s=String(note||'');
    let m=null;
    if(preferAfter){
      m=s.match(/调整后\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    }
    if(!m)m=s.match(/(?:新增饮料|编辑资料)[（(]\s*冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*[）)]/);
    if(!m)m=s.match(/冰箱\s*([+-]?[0-9]+(?:\.[0-9]+)?)\s*\/\s*仓库\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return m?{fridge:num(m[1]),warehouse:num(m[2])}:null;
  }
  function parseAdjust(note,quantity){
    const s=String(note||'');
    const loc=locationOf(s);
    const before=s.match(/调整前\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    const after=s.match(/调整后\s*([+-]?[0-9]+(?:\.[0-9]+)?)/);
    return {
      location:loc,
      before:before?num(before[1]):null,
      after:after?num(after[1]):(loc?num(quantity):null)
    };
  }
  function stocktakeMarker(month){
    const p=String(month||'').split('-');
    return p.length===2&&p[0]&&p[1]?(Number(p[0])+'年'+Number(p[1])+'月月底盘点'):'';
  }
  function isStocktakeAdjustmentForMonth(r,month){
    if(String(r?.action||'')!=='ADJUST')return false;
    const marker=stocktakeMarker(month);
    return !!marker&&String(r?.note||'').includes(marker);
  }

  function createResolver(items){
    const list=Array.isArray(items)?items:[];
    const byId=new Map();
    const names=new Map();
    list.forEach(item=>{
      const id=String(item?.id||'');
      if(id)byId.set(id,item);
      const name=String(item?.name||'').trim();
      if(!name)return;
      if(!names.has(name))names.set(name,[]);
      names.get(name).push(item);
    });
    return {
      byId,
      resolve(log){
        const id=String(log?.item_id||'');
        if(id&&byId.has(id))return id;
        const name=String(log?.item_name||'').trim();
        const matches=names.get(name)||[];
        return matches.length===1?String(matches[0].id):'';
      }
    };
  }

  function buildIndex(items,logs){
    const resolver=createResolver(items);
    const byItem=new Map();
    (Array.isArray(logs)?logs:[]).forEach(r=>{
      const id=resolver.resolve(r);
      if(!id)return;
      if(!byItem.has(id))byItem.set(id,[]);
      byItem.get(id).push(r);
    });
    byItem.forEach(rows=>rows.sort(createdSort));
    return {resolver,byItem};
  }

  function archiveDate(item){
    if(!item?.archived_at)return '';
    return new Date(item.archived_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'});
  }

  function snapshotItemFromRows(item,rows,cutoff,options={}){
    const month=String(cutoff||'').slice(0,7);
    const excludeStocktake=options.excludeStocktakeAdjustments===true;
    const eligible=(rows||[]).filter(r=>{
      const d=dateOf(r);
      if(!d||d>cutoff)return false;
      if(excludeStocktake&&isStocktakeAdjustmentForMonth(r,month))return false;
      return true;
    }).sort(createdSort);

    let started=false;
    let exists=false;
    let fridge=null;
    let warehouse=null;
    let total=0;
    let totalUncertain=false;
    let locationUncertain=false;
    let anchorCreatedAt='';

    function setFull(f,w){
      fridge=clean(f);warehouse=clean(w);total=clean(fridge+warehouse);
      totalUncertain=false;locationUncertain=false;exists=true;started=true;
    }
    function setTotalOnly(v){
      total=clean(v);fridge=null;warehouse=null;
      locationUncertain=true;exists=true;started=true;
    }
    function addTotal(delta){total=clean(total+delta);}

    for(const r of eligible){
      const action=String(r?.action||'');
      const q=num(r?.quantity);
      const note=String(r?.note||'');
      const loc=locationOf(note);

      if(action==='CREATE'){
        const p=parsePair(note,false);
        if(p)setFull(p.fridge,p.warehouse);
        else setTotalOnly(q);
        anchorCreatedAt=String(r?.created_at||anchorCreatedAt||'');
        continue;
      }

      if(!started){
        if(action==='EDIT'){
          const p=parsePair(note,true);
          if(p){setFull(p.fridge,p.warehouse);anchorCreatedAt=String(r?.created_at||'');}
        }
        continue;
      }

      if(action==='IN'||action==='RETURN'){
        addTotal(q);
        if(fridge!==null&&warehouse!==null&&loc){
          if(loc==='fridge')fridge=clean(fridge+q);else warehouse=clean(warehouse+q);
        }else if(!loc){
          locationUncertain=true;
        }
      }else if(action==='OUT'||action==='BORROW'){
        addTotal(-q);
        if(fridge!==null&&warehouse!==null&&loc){
          if(loc==='fridge')fridge=clean(fridge-q);else warehouse=clean(warehouse-q);
        }else if(!loc){
          locationUncertain=true;
        }
      }else if(action==='TRANSFER'){
        if(fridge!==null&&warehouse!==null){
          if(note.includes('仓库 → 冰箱')){warehouse=clean(warehouse-q);fridge=clean(fridge+q);}
          else if(note.includes('冰箱 → 仓库')){fridge=clean(fridge-q);warehouse=clean(warehouse+q);}
          else locationUncertain=true;
        }else{
          locationUncertain=true;
        }
      }else if(action==='EDIT'){
        const p=parsePair(note,true);
        if(p)setFull(p.fridge,p.warehouse);
        else{
          total=clean(q);
          fridge=null;warehouse=null;
          locationUncertain=true;
          totalUncertain=true;
        }
      }else if(action==='ADJUST'){
        const p=parseAdjust(note,q);
        if(p.location&&p.after!==null&&fridge!==null&&warehouse!==null){
          if(p.location==='fridge')fridge=clean(p.after);else warehouse=clean(p.after);
          total=clean(fridge+warehouse);
        }else if(p.before!==null&&p.after!==null){
          addTotal(p.after-p.before);
          locationUncertain=true;
        }else{
          totalUncertain=true;
          locationUncertain=true;
        }
      }
    }

    if(!started){
      const future=(rows||[]).filter(r=>{
        const d=dateOf(r);
        if(!d||d<=cutoff)return false;
        const a=String(r?.action||'');
        return a==='CREATE'||(a==='EDIT'&&!!parsePair(r.note,true));
      }).sort((a,b)=>dateOf(a).localeCompare(dateOf(b))||createdSort(a,b));

      if(future.length){
        return {exists:false,fridge:0,warehouse:0,total:0,uncertain:false,totalUncertain:false,locationUncertain:false,source:'future'};
      }

      const createdDate=item?.created_at?new Date(item.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Singapore'}):'';
      if(createdDate&&createdDate>cutoff){
        return {exists:false,fridge:0,warehouse:0,total:0,uncertain:false,totalUncertain:false,locationUncertain:false,source:'future'};
      }

      return {
        exists:false,
        fridge:0,
        warehouse:0,
        total:0,
        uncertain:true,
        totalUncertain:true,
        locationUncertain:true,
        source:'no-anchor'
      };
    }

    if(fridge!==null&&warehouse!==null){
      total=clean(fridge+warehouse);
    }

    const locationBad=fridge===null||warehouse===null||locationUncertain;
    return {
      exists,
      fridge:fridge===null?null:clean(fridge),
      warehouse:warehouse===null?null:clean(warehouse),
      total:clean(total),
      uncertain:!!totalUncertain,
      totalUncertain:!!totalUncertain,
      locationUncertain:!!locationBad,
      source:'forward',
      anchorCreatedAt
    };
  }

  function snapshotAt(items,logs,cutoff,options={}){
    const list=Array.isArray(items)?items:[];
    const {resolver,byItem}=buildIndex(list,logs);
    const states=new Map();
    list.forEach(item=>{
      const key=String(item?.id||'');
      states.set(key,snapshotItemFromRows(item,byItem.get(key)||[],cutoff,options));
    });
    states.resolver=resolver;
    return states;
  }

  function snapshotItem(item,items,logs,cutoff,options={}){
    const {byItem}=buildIndex(items,logs);
    return snapshotItemFromRows(item,byItem.get(String(item?.id||''))||[],cutoff,options);
  }

  function itemRelevantAt(item,state,cutoff,logs,items){
    if(!state?.exists)return false;
    if(item?.is_active!==false)return true;
    const archived=archiveDate(item);
    if(!archived||archived>cutoff)return true;
    if(Math.abs(num(state.total))>EPS)return true;
    const month=String(cutoff||'').slice(0,7);
    const resolver=createResolver(items||[]);
    return (logs||[]).some(r=>resolver.resolve(r)===String(item?.id||'')&&monthOf(r)===month);
  }

  window.InventoryHistoryEngine={
    version:'2026-10-19-v1',
    num,clean,dateOf,monthOf,locationOf,parsePair,parseAdjust,createdSort,
    createResolver,buildIndex,snapshotAt,snapshotItem,itemRelevantAt,
    isStocktakeAdjustmentForMonth
  };
})();