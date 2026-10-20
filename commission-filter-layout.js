// 员工提成筛选栏布局：缩短筛选框，操作按钮保持同一行并避免超出页面。
(function(){
  'use strict';

  function addStyle(){
    if(document.getElementById('commissionFilterLayoutStyle'))return;
    const s=document.createElement('style');
    s.id='commissionFilterLayoutStyle';
    s.textContent=`
#manualCommissionFilterPanel{
  grid-template-columns:160px 160px 170px 170px max-content!important;
  align-items:end!important;
  justify-content:start!important;
  column-gap:10px!important;
}
#manualCommissionFilterPanel>label{min-width:0!important}
#manualCommissionFilterPanel>label select,
#manualCommissionFilterPanel>label input,
#manualCommissionFilterPanel .standard-date-wrap{
  width:100%!important;
  min-width:0!important;
}
#manualCommissionFilterPanel>div:last-child{
  display:flex!important;
  align-items:flex-end!important;
  gap:6px!important;
  min-width:0!important;
  width:auto!important;
  max-width:none!important;
  flex-wrap:nowrap!important;
}
#manualCommissionFilterPanel>div:last-child button{
  flex:0 0 auto!important;
  min-width:76px!important;
  width:auto!important;
  min-height:42px!important;
  padding:9px 14px!important;
  white-space:nowrap!important;
  line-height:1.2!important;
  word-break:keep-all!important;
}
#manualCommissionFilterPanel #exportCommissionFiltersBtn{
  min-width:108px!important;
}
@media(max-width:980px){
  #manualCommissionFilterPanel{
    grid-template-columns:repeat(2,minmax(150px,1fr))!important;
  }
  #manualCommissionFilterPanel>div:last-child{
    grid-column:1/-1!important;
    justify-content:flex-start!important;
  }
}
@media(max-width:820px){
  #manualCommissionFilterPanel{grid-template-columns:1fr 1fr!important}
  #manualCommissionFilterPanel>div:last-child{grid-column:1/-1!important}
}
@media(max-width:540px){
  #manualCommissionFilterPanel{grid-template-columns:1fr!important}
  #manualCommissionFilterPanel>div:last-child{grid-column:1!important;flex-wrap:wrap!important}
}
`;
    document.head.appendChild(s);
  }

  function wait(){
    if(!document.getElementById('manualCommissionFilterPanel')){setTimeout(wait,120);return;}
    addStyle();
  }
  wait();
})();
