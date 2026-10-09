// Supabase > Project Settings > API
// 只放 Project URL 和 anon/public key。不要把 service_role key 放在这里。
window.APP_CONFIG = {
  SUPABASE_URL: "https://rudszzkodkchdasteboq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_yHnU5ACbwLvpLt3h3OJpTw_Cd0OqiES"
};
const centerViewStyle=document.createElement("link");centerViewStyle.rel="stylesheet";centerViewStyle.href="./center-view.css?v=20261009b";document.head.appendChild(centerViewStyle);
[
  "transfer.js","operation-date.js","inventory-date-fix.js","dashboard-products.js","product-history.js","pos-correction.js","manual-commission.js","commission-month-archive.js","commission-filter-confirm.js","commission-export.js","commission-filter-layout.js","commission-summary-header-fixed.js","employee-selector.js","navigation-cleanup.js","correction-history.js","out-note-history.js","out-note-category.js","monthly-reconciliation.js","dashboard-category.js","account-directory.js","ui-polish.js","monthly-commission-stat.js","excel-export.js","refresh-fix.js","sort-controls.js","date-locale.js"
].forEach(file=>{const script=document.createElement("script");script.src="./"+file+"?v=20261009b";script.defer=true;document.head.appendChild(script);});