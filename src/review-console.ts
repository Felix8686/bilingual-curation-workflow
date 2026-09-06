const REVIEW_CONSOLE_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>双语策展审核台</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f5f5f4}
*{box-sizing:border-box}body{margin:0}.shell{max-width:1180px;margin:0 auto;padding:28px 18px 60px}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-end;margin-bottom:22px}.top h1{margin:0;font-size:28px}.top p{margin:6px 0 0;color:#666}.grid{display:grid;grid-template-columns:360px 1fr;gap:18px}.panel{background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.03)}h2{font-size:17px;margin:0 0 14px}label{font-size:13px;font-weight:650;display:block;margin:12px 0 6px}textarea,input,select{width:100%;border:1px solid #d4d4d4;border-radius:9px;padding:10px 11px;font:inherit;background:#fff}textarea{resize:vertical;min-height:100px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}button{border:1px solid #d4d4d4;background:#fff;border-radius:9px;padding:9px 12px;cursor:pointer;font-weight:650}button.primary{background:#171717;color:#fff;border-color:#171717}button:disabled{opacity:.45;cursor:not-allowed}.muted{color:#737373;font-size:12px}.status{font-size:12px;padding:3px 8px;border-radius:999px;background:#f1f1f1;display:inline-block}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}.toolbar select{width:auto}.cards{display:grid;gap:12px}.card{border:1px solid #e5e5e5;border-radius:12px;padding:14px}.cardhead{display:flex;justify-content:space-between;gap:10px}.theme{font-size:17px;font-weight:750}.meta{color:#737373;font-size:12px;margin-top:3px}.draft{white-space:pre-wrap;background:#fafafa;border:1px solid #ececec;border-radius:9px;padding:12px;max-height:340px;overflow:auto;line-height:1.62;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;margin:12px 0}.warnings{font-size:12px;color:#7c4a03}.review-note{min-height:58px}.batchbox{margin-top:14px;padding:10px;border-radius:9px;background:#fafafa;font-size:12px;white-space:pre-wrap}.empty{padding:42px 10px;text-align:center;color:#777}.toast{position:fixed;right:18px;bottom:18px;background:#171717;color:#fff;padding:10px 13px;border-radius:9px;display:none;max-width:420px}.danger{color:#b91c1c}.good{color:#166534}@media(max-width:840px){.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<div class="shell">
  <div class="top"><div><h1>双语策展审核台</h1><p>创建批次 → Queue 后台生成 → 人工审核 → 手动发布</p></div><button id="refresh">刷新</button></div>
  <div class="grid">
    <aside class="panel">
      <h2>创建并入队</h2>
      <label for="themes">主题（每行一个，最多 20 个）</label>
      <textarea id="themes" placeholder="love\nloneliness\nfarewell"></textarea>
      <label for="works">影视作品（可选，英文名，逗号分隔）</label>
      <input id="works" placeholder="Before Sunrise, Her" />
      <div class="row">
        <div><label for="maxSelected">每篇最多片段</label><input id="maxSelected" type="number" min="1" max="5" value="3" /></div>
        <div><label for="limitPerSource">每源候选</label><input id="limitPerSource" type="number" min="1" max="5" value="3" /></div>
      </div>
      <label for="sourceKind">素材范围</label>
      <select id="sourceKind"><option value="all">文学 + 影视</option><option value="literature">仅公版文学</option><option value="screen">仅影视对白</option></select>
      <div class="btns"><button class="primary" id="create">创建并入队</button></div>
      <div class="batchbox" id="batchStatus">尚未创建批次。</div>
      <p class="muted">页面不会自动发布到抖音。影视对白仍需人工版权/语境复核。</p>
    </aside>
    <main class="panel">
      <div class="toolbar"><h2 style="margin:0">待审核稿件</h2><select id="filter"><option value="unreviewed">未审核</option><option value="approved">可发布</option><option value="held">暂缓</option><option value="published">已发布</option><option value="all">全部</option></select></div>
      <div id="cards" class="cards"><div class="empty">正在加载…</div></div>
    </main>
  </div>
</div>
<div id="toast" class="toast"></div>
<script>
const $=id=>document.getElementById(id);
const toast=(msg)=>{const el=$('toast');el.textContent=msg;el.style.display='block';setTimeout(()=>el.style.display='none',2600)};
const api=async(url,options={})=>{const r=await fetch(url,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});const data=await r.json();if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data};
const statusName={unreviewed:'未审核',approved:'可发布',held:'暂缓',published:'已发布'};
let currentBatchId=localStorage.getItem('lastBatchId')||'';
function sourceKinds(){const v=$('sourceKind').value;return v==='literature'?['public_domain_literature']:v==='screen'?['screen_dialogue']:['public_domain_literature','screen_dialogue']}
async function createBatch(){
  const themes=$('themes').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  if(!themes.length)return toast('至少输入一个主题');
  if(themes.length>20)return toast('单批最多 20 个主题');
  const works=$('works').value.split(',').map(v=>v.trim()).filter(Boolean);
  const maxSelected=Math.max(1,Math.min(5,Number($('maxSelected').value)||3));
  const limitPerSource=Math.max(1,Math.min(5,Number($('limitPerSource').value)||3));
  const items=themes.map(theme=>({theme,query:theme,screenWorks:works.length?works:undefined,sourceKinds:sourceKinds(),limitPerSource,maxSelected,hook:'关于「'+theme+'」的几段英文'}));
  $('create').disabled=true;
  try{
    const batch=await api('/api/batches',{method:'POST',body:JSON.stringify({items})});
    currentBatchId=batch.id;localStorage.setItem('lastBatchId',batch.id);
    const enq=await api('/api/batches/'+encodeURIComponent(batch.id)+'/enqueue',{method:'POST',body:JSON.stringify({maxItems:20})});
    toast('已入队 '+enq.enqueuedItemIds.length+' 项');
    await pollBatch();
  }catch(e){toast(e.message)}finally{$('create').disabled=false}
}
async function pollBatch(){
  if(!currentBatchId){$('batchStatus').textContent='尚未创建批次。';return}
  try{
    const b=await api('/api/batches/'+encodeURIComponent(currentBatchId));
    $('batchStatus').textContent='批次 '+b.id+'\n状态: '+b.status+'\n完成: '+b.completedCount+'/'+b.totalCount+'  失败: '+b.failedCount+'  待处理: '+b.pendingCount;
    if(b.pendingCount>0)setTimeout(pollBatch,1800);else loadReviews();
  }catch(e){$('batchStatus').textContent='读取批次失败: '+e.message}
}
function button(text,handler){const b=document.createElement('button');b.textContent=text;b.onclick=handler;return b}
async function updateReview(item,status,note){
  try{await api('/api/review/items/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({reviewStatus:status,note})});toast('已更新为「'+statusName[status]+'」');loadReviews()}catch(e){toast(e.message)}
}
function renderCard(item){
  const card=document.createElement('div');card.className='card';
  const head=document.createElement('div');head.className='cardhead';
  const left=document.createElement('div');const theme=document.createElement('div');theme.className='theme';theme.textContent=item.theme;const meta=document.createElement('div');meta.className='meta';meta.textContent='Batch '+item.batchId+' · '+statusName[item.reviewStatus];left.append(theme,meta);head.append(left);card.append(head);
  const result=item.result||{};const draft=result.publicationDraft||{};
  const pre=document.createElement('div');pre.className='draft';pre.textContent=draft.publicationText||'';card.append(pre);
  if(Array.isArray(result.warnings)&&result.warnings.length){const w=document.createElement('div');w.className='warnings';w.textContent='⚠ '+result.warnings.join(' / ');card.append(w)}
  const note=document.createElement('textarea');note.className='review-note';note.placeholder='审核备注（可选）';note.value=item.reviewNote||'';card.append(note);
  const actions=document.createElement('div');actions.className='btns';
  actions.append(button('复制待发布稿',async()=>{try{await navigator.clipboard.writeText(draft.publicationText||'');toast('已复制')}catch{toast('复制失败')}}));
  actions.append(button('可发布',()=>updateReview(item,'approved',note.value)));
  actions.append(button('暂缓',()=>updateReview(item,'held',note.value)));
  actions.append(button('已发布',()=>updateReview(item,'published',note.value)));
  actions.append(button('重置未审核',()=>updateReview(item,'unreviewed',note.value)));
  card.append(actions);return card;
}
async function loadReviews(){
  const cards=$('cards');cards.innerHTML='';
  try{const data=await api('/api/review/items?status='+encodeURIComponent($('filter').value)+'&limit=100');if(!data.items.length){cards.innerHTML='<div class="empty">当前没有符合条件的稿件。</div>';return}data.items.forEach(item=>cards.append(renderCard(item)))}catch(e){cards.innerHTML='<div class="empty danger">'+e.message+'</div>'}
}
$('create').onclick=createBatch;$('refresh').onclick=()=>{pollBatch();loadReviews()};$('filter').onchange=loadReviews;loadReviews();pollBatch();
</script>
</body></html>`;

export function reviewConsoleResponse(): Response {
  return new Response(REVIEW_CONSOLE_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
