// 书架界面：书架（在读列表）/ 书库（大量藏书）/ 全部 / 过期书籍；瀑布流纯封面、筛选与搜索预设、标签、批量移动与恢复。
import {natural,fileOf,nameOrder} from './model.mjs';
import {scan,readMissingTimes,allPages,keyOf,dirOf,isLoose} from './sources.mjs';
import {norm,coverName,grade,assign,hue} from './match.mjs';
import {extend} from './lang.mjs';

extend({
  moreTags:['Show all ({n} more)','展开全部（还有 {n} 个）','すべて表示（あと {n} 個）','모두 보기 ({n}개 더)'],lessTags:['Show less','收起','閉じる','접기'],
  pagesFrom:['≥ {n} images','≥ {n} 张','{n} 枚以上','{n}장 이상'],pagesTo:['≤ {n} images','≤ {n} 张','{n} 枚以下','{n}장 이하'],pagesRange:['{a}–{b} images','{a}–{b} 张','{a}〜{b} 枚','{a}–{b}장'],
  bmCount:['{n} bookmarks','{n} 个书签','しおり {n} 件','책갈피 {n}개'],
  presets:['Presets','预设','プリセット','프리셋'],presetSave:['Save current filters as a preset','将当前筛选保存为预设','現在の絞り込みをプリセットに保存','현재 필터를 프리셋으로 저장'],
  presetName:['Preset name','预设名称','プリセット名','프리셋 이름'],presetFind:['Find preset','查找预设','プリセットを検索','프리셋 찾기'],
  presetEmpty:['No presets yet. Set some filters, then save them here.','还没有预设。设置好筛选条件后，可以在这里保存。','プリセットはまだありません。絞り込みを設定してからここで保存できます。','아직 프리셋이 없습니다. 필터를 설정한 뒤 여기에서 저장하세요.'],
  presetNoMatch:['No matching presets','没有匹配的预设','一致するプリセットはありません','일치하는 프리셋 없음'],
  presetNothing:['Set a filter first','请先设置筛选条件','先に絞り込みを設定してください','먼저 필터를 설정하세요'],
  presetUpdate:['Update with current filters','用当前条件更新','現在の条件で更新','현재 조건으로 업데이트'],presetModified:['modified','已修改','変更あり','수정됨'],
  presetRename:['Rename','重命名','名前を変更','이름 바꾸기'],presetDelete:['Delete preset','删除预设','プリセットを削除','프리셋 삭제'],
  presetSaved:['Preset saved','已保存预设','プリセットを保存しました','프리셋을 저장했습니다'],presetAll:['All books (no filter)','全部书籍（无筛选）','すべての本（絞り込みなし）','모든 책 (필터 없음)'],
  tagRecent:['Recent','最近','最近','최근'],tagHint:['↑ ↓ to choose · Enter to add','↑ ↓ 选择 · 回车添加','↑ ↓ で選択 · Enter で追加','↑ ↓ 선택 · Enter 추가'],
  storageHigh:['Browser storage is {p}% full. Delete records of books you no longer need (covers and bookmark thumbnails take most of the space).','浏览器存储空间已用 {p}%，建议删除不再需要的旧书记录（主要占用来自封面和书签缩略图）。','ブラウザーの保存領域が {p}% 使用されています。不要になった本の記録を削除してください（主に表紙としおりのサムネイルが容量を使います）。','브라우저 저장 공간이 {p}% 찼습니다. 더 이상 필요 없는 책 기록을 삭제하세요(표지와 책갈피 썸네일이 대부분을 차지합니다).'],
  layoutGrid:['Grid','普通网格','グリッド','격자'],layoutMasonry:['Masonry','瀑布流','マソンリー','메이슨리'],
  filtersHide:['Hide filters','收起筛选','絞り込みを閉じる','필터 접기'],sortNow:['Sort: {s}','排序：{s}','並べ替え：{s}','정렬: {s}'],presetNow:['Preset: {s}','预设：{s}','プリセット：{s}','프리셋: {s}'],
  layoutSwitch:['Layout: {now} — click for {next}','布局：{now}（点击切换为{next}）','レイアウト：{now}（クリックで{next}に切替）','레이아웃: {now} (클릭하면 {next}(으)로 전환)']
});
const $=id=>document.getElementById(id);
// 图标直接补进页面的 sprite，避免多个模块同时改 index.html。
function addIcons(table){const sprite=document.querySelector('svg.sprite');for(const [name,body] of Object.entries(table))if(!document.getElementById('i-'+name))
  sprite?.insertAdjacentHTML('beforeend','<symbol id="i-'+name+'" viewBox="0 0 24 24">'+body+'</symbol>');}
// 封面摘要：首张图前 64KB 的 SHA-256 加文件大小，只读一小段，不读整张大图。
async function digest(file){
  const buf=await crypto.subtle.digest('SHA-256',await file.slice(0,65536).arrayBuffer());
  return [...new Uint8Array(buf).slice(0,12)].map(x=>x.toString(16).padStart(2,'0')).join('')+':'+file.size;
}
// 筛选条件：{q 关键词, min/max 页数（字符串，空为不限）, tags 选中的标签, marked 只看有书签的书}。旧数据或损坏的数据归一化为空条件。
const EMPTY={q:'',min:'',max:'',tags:[],marked:false};
function clean(f){
  if(!f||typeof f!=='object')f={};
  const num=v=>v!==''&&v!=null&&Number.isFinite(+v)&&+v>=0?String(Math.floor(+v)):'',seen=new Set(),tags=[];
  for(const x of Array.isArray(f.tags)?f.tags:[])if(typeof x==='string'&&x.trim()&&!seen.has(norm(x))){seen.add(norm(x));tags.push(x.trim());}
  return {q:typeof f.q==='string'?f.q:'',min:num(f.min),max:num(f.max),tags,marked:!!f.marked};
}
const same=(a,b)=>{const k=f=>JSON.stringify([f.q.trim(),f.min,f.max,f.tags.map(norm).sort(),f.marked]);return k(a)===k(b);};
export function install(ctx){
  const {books,t,fmt,notice,make,icon,iconButton,safe,get,put,shelf}=ctx, holder=$('books');
  addIcons({'layout-grid':'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    'layout-masonry':'<rect x="4" y="4" width="7" height="10" rx="1.5"/><rect x="13" y="4" width="7" height="6" rx="1.5"/><rect x="4" y="16" width="7" height="4" rx="1.5"/><rect x="13" y="12" width="7" height="8" rx="1.5"/>',star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>','chevron-down':'<path d="m6 9 6 6 6-6"/>',plus:'<path d="M12 5v14M5 12h14"/>'});
  // 布局、筛选面板展开状态和当前筛选条件随「还原默认设置」重置；预设（shelfPresets）和最近用过的标签（recentTags）是用户数据，保留。
  ctx.prefs.add('shelfLayout');ctx.prefs.add('shelfPanel');ctx.prefs.add('shelfFilter');
  let view=get('shelfView','shelf');if(!['shelf','library','all'].includes(view))view='shelf';
  const tagsOf=b=>Array.isArray(b.tags)?b.tags:[], marksOf=b=>Array.isArray(b.bookmarks)?b.bookmarks.length:0, pagesOf=b=>b.pages?.length??0;
  // ---- 书籍排序：书架、书库、所有书籍共用一个设置，上一本 / 下一本和书架书签列表也按此顺序（ctx.orderBooks）。
  // 文件夹时间：浏览器读不到文件夹本身的修改时间，用其中最新一张图片的修改时间代替；未知的排在最后。
  const SORTS=['addedNew','addedOld','folderNew','folderOld','nameAsc','nameDesc'];
  let sortBy=get('shelfSort','addedNew');if(!SORTS.includes(sortBy))sortBy='addedNew';
  const byName=(a,b)=>natural(ctx.title(a),ctx.title(b));
  const byNumber=(key,dir)=>(a,b)=>{const ka=Number.isFinite(a[key]),kb=Number.isFinite(b[key]);
    return ka!==kb?(ka?-1:1):ka&&a[key]!==b[key]?dir*(a[key]-b[key]):byName(a,b);};
  const compare={addedNew:byNumber('added',-1),addedOld:byNumber('added',1),folderNew:byNumber('folderTime',-1),folderOld:byNumber('folderTime',1),nameAsc:byName,nameDesc:(a,b)=>byName(b,a)};
  const byTitle=list=>list.sort(compare[sortBy]);ctx.orderBooks=byTitle;
  // 排序菜单：与预设菜单同样的弹出层；按钮只显示图标，当前排序写在提示文字里。
  const sortLabel={addedNew:'bsAddedNew',addedOld:'bsAddedOld',folderNew:'bsFolderNew',folderOld:'bsFolderOld',nameAsc:'bsNameAsc',nameDesc:'bsNameDesc'},sortBtn=$('sortBtn'),sortPop=$('sortPop');
  function setSort(v){if(!SORTS.includes(v)||v===sortBy)return;sortBy=v;put('shelfSort',sortBy);draw('sort');ctx.emit('books');sweepTimes();}
  function drawSortBtn(){sortBtn.title=fmt('sortNow',{s:t(sortLabel[sortBy])});sortBtn.setAttribute('aria-label',sortBtn.title);sortBtn.dataset.sort=sortBy;}
  function drawSortPop(){sortPop.replaceChildren(...SORTS.map(v=>{const b=make('button','sp-item');b.type='button';b.dataset.sort=v;b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(v===sortBy));
    b.append(icon('check'),make('span','',t(sortLabel[v])));b.onclick=()=>{sortPop.hidePopover();sortBtn.focus();setSort(v);};return b;}));}
  sortPop.addEventListener('beforetoggle',e=>{if(e.newState==='open')drawSortPop();});
  sortPop.addEventListener('toggle',e=>{if(e.newState==='open')sortPop.querySelector('[aria-checked=true]')?.focus({preventScroll:true});});
  sortPop.addEventListener('keydown',e=>{const items=[...sortPop.querySelectorAll('button')],i=items.indexOf(document.activeElement),n=items.length;
    const j={ArrowDown:(i+1)%n,ArrowUp:(i-1+n)%n,Home:0,End:n-1}[e.key];if(j==null)return;e.preventDefault();items[j].focus();});
  // 按文件夹时间排序时才计算（只读文件元数据，串行，不与阅读抢硬盘）；算出新值后刷新列表。
  let timing=false,retime=false;
  async function sweepTimes(){
    if(!sortBy.startsWith('folder'))return;if(timing){retime=true;return;}timing=true;retime=false;let changed=false,drawn=Date.now();
    const refresh=()=>{changed=false;drawn=Date.now();if(shelf.open)draw();ctx.emit('books');};
    try{for(const b of [...books.values()]){
      if(Number.isFinite(b.folderTime)||ctx.expired(b)||!books.has(b.id))continue;
      while(document.hidden)await new Promise(r=>document.addEventListener('visibilitychange',r,{once:true}));
      await queue(async()=>{
        await readMissingTimes(b,()=>books.has(b.id));if(!books.has(b.id))return;
        let t=-Infinity;for(const p of b.pages)if(Number.isFinite(p.lastModified)&&p.lastModified>t)t=p.lastModified;
        if(t>-Infinity){b.folderTime=t;await ctx.persist(b);changed=true;}
      });
      if(changed&&Date.now()-drawn>1000)refresh();
    }}finally{timing=false;if(changed)refresh();if(retime)setTimeout(sweepTimes,800);}
  }
  setTimeout(sweepTimes,1500);ctx.on('books',()=>setTimeout(sweepTimes,800));
  // 封面页取「文件名」正序（按路径，与当前排序无关）的第一张：单文件夹书即文件名自然顺序的第一张（与 match.mjs coverName 一致），
  // 合并作品即第一个可见卷的第一张。结果按页表缓存，后台检查数千本书时不必每次重新比较全部文件名。
  const firstPage=(b,pages)=>{const order=nameOrder(dirOf(b));return pages.reduce((a,p)=>!a||order(p,a)<0?p:a,null);};
  const coverNames=new WeakMap();
  const coverPage=b=>{const pages=b.pages||[];let c=coverNames.get(b);
    if(!c||c.pages!==pages||c.n!==pages.length||c.src!==b.sources){c={pages,n:pages.length,src:b.sources,name:firstPage(b,pages)?.name};coverNames.set(b,c);}
    return pages.find(p=>p.name===c.name);};
  // 过期书只出现在“过期书籍”里，其他列表不显示，避免被当成可读的书。
  const inView=(b,v=view)=>ctx.expired(b)?v==='expired':v==='all'||b.place===v;

  // ---- 筛选：关键词、页数、标签、只看有书签。条件持久保存（去抖写入），在书架 / 书库 / 所有书籍之间切换时保持；
  // 上一本 / 下一本和书架书签列表也只在符合条件的书里进行（ctx.matchFilter，见 app.mjs 的 readingList）。
  const saved=get('shelfFilter',null);let F=clean(saved);
  let presets=(Array.isArray(get('shelfPresets',[]))?get('shelfPresets',[]):[]).filter(p=>p&&typeof p.name==='string'&&p.name.trim())
    .map(p=>({id:String(p.id||crypto.randomUUID()),name:p.name.trim().slice(0,60),f:clean(p.f)}));
  let presetId=presets.some(p=>p.id===saved?.preset)?saved.preset:null;
  let saveTimer=0;
  const storeFilter=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(flushFilter,600);};
  function flushFilter(){if(!saveTimer)return;clearTimeout(saveTimer);saveTimer=0;put('shelfFilter',{...F,preset:presetId});}
  const savePresets=()=>put('shelfPresets',presets);
  let parsed;
  function compile(){
    const qtags=[],words=[];for(const w of F.q.trim().split(/\s+/))if(w.length>1&&w.startsWith('#'))qtags.push(norm(w.slice(1)));else if(w)words.push(norm(w));
    parsed={words,qtags,min:+F.min||0,max:F.max!==''?+F.max:Infinity,tags:F.tags.map(norm),marked:F.marked};
  }
  compile();
  // 搜索文本按书缓存，书名、路径、标签或合并作品各卷（源文件夹）的名称、路径变化时才重新归一化。
  const hays=new WeakMap();
  function hay(b){const key=[ctx.title(b),b.title??'',b.path??'',...tagsOf(b),...(Array.isArray(b.sources)&&b.sources.length>1?b.sources.flatMap(s=>[s.title??'',s.path??'']):[])].join('\n');let h=hays.get(b);if(h?.key!==key){h={key,text:norm(key.replace(/\n/g,' '))};hays.set(b,h);}return h.text;}
  function matches(b){
    const p=parsed,n=pagesOf(b);if(n<p.min||n>p.max||p.marked&&!marksOf(b))return false;
    if(p.tags.length||p.qtags.length){const mine=tagsOf(b).map(norm);
      for(const k of p.tags)if(!mine.includes(k))return false;
      for(const k of p.qtags)if(!mine.some(x=>x.startsWith(k)))return false;}
    if(p.words.length){const h=hay(b);if(!p.words.every(w=>h.includes(w)))return false;}
    return true;
  }
  ctx.matchFilter=matches;
  const filtering=()=>!!(F.q.trim()||F.min||F.max||F.tags.length||F.marked);ctx.filtering=filtering; // 底部操作栏据此标出“只在筛选结果内切书”
  const extraFilters=()=>F.tags.length+(F.min||F.max?1:0)+(F.marked?1:0);
  function setFilter(next,{preset=presetId,inputs=true}={}){
    F=clean(next);presetId=preset;compile();storeFilter();if(inputs)syncInputs();draw('filter');
  }
  function syncInputs(){$('query').value=F.q;$('min').value=F.min;$('max').value=F.max;}
  syncInputs();
  function filtered(){return byTitle([...books.values()].filter(b=>inView(b)&&matches(b)));}
  function allTags(filter=()=>true){
    const counts=new Map();
    for(const b of books.values())if(filter(b))for(const x of tagsOf(b)){const k=norm(x),c=counts.get(k);counts.set(k,{tag:c?.tag??x,n:(c?.n??0)+1});}
    return [...counts].sort((a,b)=>b[1].n-a[1].n||natural(a[1].tag,b[1].tag));
  }
  function chip(tag,{onclick,pressed,count,remove}={}){
    const el=make(onclick?'button':'span','tag',tag);el.style.setProperty('--h',hue(tag));
    if(onclick){el.type='button';el.onclick=onclick;if(pressed!=null)el.setAttribute('aria-pressed',String(pressed));}
    if(count!=null)el.append(make('small','',count));
    if(remove){const x=make('button','tag-x');x.type='button';x.setAttribute('aria-label',t('remove')+' · '+tag);x.append(icon('close'));x.onclick=remove;el.append(x);}
    return el;
  }
  const rangeText=f=>f.min&&f.max?fmt('pagesRange',{a:f.min,b:f.max}):f.min?fmt('pagesFrom',{n:f.min}):f.max?fmt('pagesTo',{n:f.max}):'';
  const describe=f=>[f.q.trim()&&'“'+f.q.trim()+'”',...f.tags.map(x=>'#'+x),rangeText(f),f.marked&&t('hasBookmarks')].filter(Boolean).join(' · ');

  // ---- 封面缓存：只存压缩 WebP，过期书也能显示；串行读取，不与阅读抢硬盘。
  let chain=Promise.resolve();const queue=fn=>(chain=chain.then(fn).catch(()=>{}));
  // 合并作品的每一卷另记一份封面摘要（只读各卷首张图的前 64KB，每卷一次），恢复时按卷匹配。
  const bySource=b=>{const m=new Map();for(const p of b.pages){const k=keyOf(p);if(!m.has(k))m.set(k,[]);m.get(k).push(p);}return m;};
  const staleFp=b=>{if(!(b.sources?.length>1))return [];const m=bySource(b);
    return b.sources.map(s=>[s,m.get(s.key)&&firstPage(b,m.get(s.key))]).filter(([s,p])=>p&&s.fp?.name!==fileOf(p)&&!ctx.isDown(b,s));};
  const needsFp=b=>staleFp(b).length>0;
  const coverFresh=b=>{const p=coverPage(b);return !p||b.fp?.thumb&&b.fp.cover?.name===p.name;};
  const fresh=b=>coverFresh(b)&&!needsFp(b);
  async function ensureCover(b){
    if(!books.has(b.id)||fresh(b)||ctx.expired(b))return;
    const page=coverPage(b);
    if(page&&!coverFresh(b)){
      const file=await ctx.source(b,page),th=await ctx.makeThumb(file,{width:320});
      if(!books.has(b.id))return; // 生成期间这本书已被删除
      await ctx.saveThumb(b.id+':cover',th);
      b.fp={cover:{name:page.name,size:file.size,hash:await digest(file)},thumb:true};b.coverRatio=th.h/th.w;
    }
    for(const [s,p] of staleFp(b)){
      if(b.fp?.cover?.name===p.name){s.fp={...b.fp.cover,name:fileOf(p)};continue;}
      try{const file=await ctx.source(b,p);s.fp={name:fileOf(p),size:file.size,hash:await digest(file)};}catch{} // 读不到的卷下次再试
    }
    if(books.has(b.id))await ctx.persist(b);
  }
  // 运行中又有新书加入时，跑完这一轮再从头检查一遍（否则这一轮开始后才加入的书要等下一次变化才生成封面）。
  let sweeping=false,again=false;
  async function sweep(){
    if(sweeping){again=true;return;}sweeping=true;
    try{do{again=false;for(const b of [...books.values()]){
      while(document.hidden)await new Promise(r=>document.addEventListener('visibilitychange',r,{once:true}));
      if(!fresh(b)&&!ctx.expired(b))await queue(()=>ensureCover(b));
    }}while(again);}finally{sweeping=false;}
  }
  ctx.on('books',()=>setTimeout(sweep,600));ctx.on('select',b=>{if(b)queue(()=>ensureCover(b));});setTimeout(sweep,2500);
  const coverOf=new WeakMap(); // 封面槽 → 书 id
  const io=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){io.unobserve(e.target);const b=books.get(coverOf.get(e.target));if(b)safe(showCover)(e.target,b);}},{root:holder,rootMargin:'400px 0px'});
  async function showCover(slot,b){
    if(!fresh(b)&&!ctx.expired(b))await queue(()=>ensureCover(b));
    const th=await ctx.getThumb(b.id+':cover');if(!th||slot.querySelector('img'))return;
    const img=new Image();img.alt='';img.decoding='async';img.src=th.url;slot.append(img);slot.classList.add('ready');
    if(Math.abs((b.coverRatio||1.42)-th.h/th.w)>.01){b.coverRatio=th.h/th.w;if(layoutMode==='masonry')relayoutSoon();}
  }

  // ---- 列表：两种布局，都用绝对定位，只挂载可见范围附近的卡片，数千本书也只有几十个节点。
  // 普通网格（默认）：等宽等高的单元格按行对齐，封面裁切填满；瀑布流：按封面比例，依次放进最短的一列，阅读顺序大体从左到右。
  // 卡片按书 id 复用：删除、移动、改名后只更新受影响的卡片，其余卡片和已加载的封面保持不动，位置变化以过渡移动。
  const MIN=168,grid=make('div','grid'),empty=make('div','shelf-empty');grid.setAttribute('role','list');empty.hidden=true;holder.replaceChildren(grid,empty);
  let shown=[],slots=new Map(),columns=[],laidWidth=0,activeId=null,opened=false,moveTimer=0,introTimer=0,frame=0;
  const nodes=new Map(); // 书 id → 卡片节点（含已加载的封面）；不在可见范围的节点暂时摘下，超过上限时丢弃最早的
  const innerWidth=()=>{const s=getComputedStyle(holder);return holder.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);};
  let layoutMode=get('shelfLayout','grid')==='masonry'?'masonry':'grid';
  function place(animate=false){
    const w=innerWidth(),gap=w<520?10:16,cols=Math.max(2,Math.floor((w+gap)/(MIN+gap))),cw=(w-gap*(cols-1))/cols,hs=Array(cols).fill(0),ch=Math.round(cw*1.42);
    slots=new Map();columns=Array.from({length:cols},()=>[]);laidWidth=w;
    shown.forEach((b,i)=>{let k=0;
      if(layoutMode==='grid')k=i%cols;else for(let j=1;j<cols;j++)if(hs[j]<hs[k]-1)k=j;
      const h=layoutMode==='grid'?ch:Math.round(cw*(b.coverRatio||1.42));slots.set(b.id,{x:k*(cw+gap),y:hs[k],w:cw,h,i,col:k,row:columns[k].length});columns[k].push(b);hs[k]+=h+gap;});
    grid.style.height=Math.max(0,...hs.map(h=>h-gap))+'px';
    clearTimeout(moveTimer);grid.classList.toggle('moving',animate);if(animate)moveTimer=setTimeout(()=>grid.classList.remove('moving'),420);
    mount(true);
  }
  function position(el,s){el.style.translate=s.x+'px '+s.y+'px';el.style.width=s.w+'px';el.style.height=s.h+'px';el.dataset.i=s.i;el.style.setProperty('--d',Math.min(s.i,24)*14+'ms');}
  function mount(check=false){
    if(!shelf.open)return;
    const top=holder.scrollTop-grid.offsetTop,h=holder.clientHeight,lo=top-h*.75,hi=top+h*1.75,want=new Set();
    for(const b of shown){const s=slots.get(b.id);if(s.y+s.h>=lo&&s.y<=hi)want.add(b.id);}
    if(slots.has(activeId))want.add(activeId); // 焦点所在的卡片始终挂载
    for(const [id,el] of nodes)if(!want.has(id)&&el.isConnected)el.remove();
    for(const id of want){
      const b=books.get(id);let el=nodes.get(id);
      if(!el){el=card(b);nodes.set(id,el);}else if(check||!el.isConnected){if(el._sig!==sig(b))fill(el,b);}
      position(el,slots.get(id));if(!el.isConnected)grid.append(el);
    }
    if(nodes.size>360)for(const [id,el] of nodes){if(nodes.size<=240)break;if(!el.isConnected)nodes.delete(id);}
  }
  holder.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;mount();});},{passive:true});
  let relayout=0;const relayoutSoon=()=>{if(!relayout)relayout=requestAnimationFrame(()=>{relayout=0;if(shelf.open&&shown.length)place();});};
  new ResizeObserver(()=>{if(shelf.open&&shown.length&&Math.abs(innerWidth()-laidWidth)>.5)place();}).observe(holder);
  // 卡片显示的内容摘要：变了才重建卡片内容（封面节点保留，不重新加载）。
  const sig=b=>[ctx.title(b),pagesOf(b),ctx.expired(b)?'x':Math.round(ctx.readRatio(b)*100)+'/'+ctx.lostSources(b),tagsOf(b).join('\x01'),b.place,b===ctx.current,marksOf(b),b.fp?.cover?.hash??'',ctx.lang].join('|');
  function card(b){
    const el=make('article','book'),pick=make('button','pick'),cover=make('span','cover');
    el.dataset.id=b.id;el.setAttribute('role','listitem');pick.type='button';pick.tabIndex=-1;pick.append(cover);el.append(pick);
    pick.onclick=safe(()=>{const x=books.get(el.dataset.id);if(!x)return;if(ctx.expired(x))return restoreOne(x);ctx.select(x);shelf.close();ctx.main.focus();});
    el._pick=pick;fill(el,b);return el;
  }
  function fill(el,b){
    const ex=ctx.expired(b),pick=el._pick,hash=b.fp?.cover?.hash??'';el._sig=sig(b);
    el.className='book'+(b===ctx.current?' current':'')+(ex?' expired':'');
    // 封面换了（例如文件夹内容变化）才重新加载，否则保留已显示的图。
    if(!el._cover||el._hash!==hash){const cover=make('span','cover');if(el._cover)el._cover.replaceWith(cover);else pick.firstChild.replaceWith(cover);el._cover=cover;el._hash=hash;coverOf.set(cover,b.id);io.observe(cover);}
    while(pick.lastChild!==el._cover)pick.lastChild.remove();
    pick.setAttribute('aria-label',ctx.title(b));
    const veil=make('span','veil'),ratio=ex?0:ctx.readRatio(b),pct=Math.round(ratio*100),meta=make('span','meta'),marks=marksOf(b);
    const info=make('span','info');info.append(make('span','',pagesOf(b)+' '+t('pages')));
    if(marks){const m=make('span','marks');m.title=fmt('bmCount',{n:marks});m.append(icon('bookmark'),String(marks));info.append(m);}
    meta.append(info,make('span',ex?'lost':pct?'':'fresh',ex?t('viewExpired'):pct?pct+'%':t('unread')));
    veil.append(make('strong','name',ctx.title(b)),meta);
    if(tagsOf(b).length){const tags=make('span','tags');for(const x of tagsOf(b))tags.append(chip(x));veil.append(tags);}
    pick.append(veil);
    if(ratio>0){const bar=make('span','progress');bar.style.setProperty('--p',ratio);pick.append(bar);}
    if(b===ctx.current)pick.append(make('span','badge',t('nowReading')));
    const lost=ex?0:ctx.lostSources(b);if(lost){const w=make('span','part');w.title=fmt('partN',{n:lost});w.setAttribute('aria-label',w.title);w.append(icon('alert'));pick.append(w);}
    // 书签数：有书签时在封面左下角常显（没有书签不显示）。
    if(marks){const m=make('span','bm-flag');m.title=fmt('bmCount',{n:marks});m.setAttribute('aria-label',m.title);m.append(icon('bookmark'),make('span','',String(marks)));pick.append(m);}
    const tools=make('div','actions');
    if(ex)tools.append(iconButton('link',t('restore'),()=>restoreOne(b)),iconButton('pencil',t('rename'),()=>editName(b)),iconButton('trash',t('remove'),()=>ctx.remove(b),'danger'));
    else tools.append(...lost?[iconButton('link',t('restore'),()=>restoreOne(b))]:[],iconButton('pencil',t('rename'),()=>editName(b)),iconButton('tag',t('editTags'),()=>editTags(b)),
      b.place==='library'?iconButton('library',t('toShelf'),()=>move([b],'shelf')):iconButton('archive',t('toLibrary'),()=>move([b],'library')),
      iconButton('copy',t('titleCopy'),()=>ctx.copy(ctx.title(b))),iconButton('trash',t('remove'),()=>ctx.remove(b),'danger'));
    el.querySelector(':scope>.actions')?.remove();el.append(tools);
    mark(el,el.dataset.id===activeId);
  }
  // ---- 焦点：同一时间只有一张“选中”的卡片。鼠标移到卡片上和键盘方向键移动是同一个状态，显示相同的书名、进度、标签和操作按钮。
  function mark(el,on){el.classList.toggle('active',on);for(const x of el.querySelectorAll('button'))x.tabIndex=on?0:-1;}
  function setActive(id,{focus=false,scroll=null}={}){
    const prev=activeId!==id&&nodes.get(activeId);activeId=id??null;if(prev)mark(prev,false);
    if(!id||!slots.has(id))return;
    if(scroll)reveal(id,scroll);else if(!nodes.get(id)?.isConnected)mount();
    const el=nodes.get(id);if(!el)return;mark(el,true);
    if(focus)el._pick.focus({preventScroll:true});
  }
  function reveal(id,how){
    const s=slots.get(id);if(!s)return;const top=s.y+grid.offsetTop,h=holder.clientHeight,pad=12;
    if(how==='center')holder.scrollTop=top+s.h/2-h/2;
    else if(top<holder.scrollTop+pad)holder.scrollTop=top-pad;else if(top+s.h>holder.scrollTop+h-pad)holder.scrollTop=top+s.h-h+pad;
    mount();
  }
  // 只响应真实的鼠标移动：键盘滚动列表时卡片从静止的鼠标下经过，不能抢走键盘焦点。
  let lastXY='';
  grid.addEventListener('pointermove',e=>{
    if(e.pointerType!=='mouse')return;const xy=e.screenX+','+e.screenY;if(xy===lastXY)return;lastXY=xy;
    const el=e.target.closest('.book');if(!el||el.dataset.id===activeId&&grid.contains(document.activeElement))return;
    const ae=document.activeElement,typing=ae?.matches('input,select,textarea')||!!ae?.closest('[popover]');
    setActive(el.dataset.id,{focus:!typing});
  });
  function beside(s,d){
    const col=columns[s.col+d];if(!col)return null;const c=s.y+s.h/2;let best=null,dist=Infinity;
    for(const b of col){const o=slots.get(b.id),x=Math.abs(o.y+o.h/2-c);if(x<dist){dist=x;best=b;}}return best;
  }
  function near(col,y){let best=null,dist=Infinity;for(const b of col){const o=slots.get(b.id),x=Math.abs(o.y-y);if(x<dist){dist=x;best=b;}}return best;}
  grid.addEventListener('keydown',e=>{
    if(e.altKey||e.ctrlKey||e.metaKey||!e.target.closest('.book'))return;
    const s=slots.get(activeId);if(!s)return;let to;
    switch(e.key){
      case 'ArrowUp':to=columns[s.col][s.row-1];break;
      case 'ArrowDown':to=columns[s.col][s.row+1];break;
      case 'ArrowLeft':case 'ArrowRight':{const d=e.key==='ArrowLeft'?-1:1;to=beside(s,d)??shown[s.i+d];break;}
      case 'PageUp':case 'PageDown':to=near(columns[s.col],s.y+(e.key==='PageUp'?-1:1)*holder.clientHeight*.85);break;
      case 'Home':to=shown[0];break;case 'End':to=shown.at(-1);break;
      case 'Delete':{e.preventDefault();const b=books.get(activeId);if(b&&!e.repeat)safe(ctx.remove)(b);return;}
      default:return;
    }
    e.preventDefault();if(to)setActive(to.id,{focus:true,scroll:'nearest'});
  });

  // ---- 绘制。reason：open 打开书架（焦点落在当前书并居中）；view 切换列表；filter 改筛选（回到第一本）；sort 改排序；
  // update（默认，外部调用）数据变化后增量更新：保留滚动位置和焦点，被删的书由相邻的书接替焦点。
  function draw(reason='update'){
    if(!opened){if(!shelf.open)return;opened=true;reason='open';safe(checkStorage)();}
    const counts={shelf:0,library:0,all:0,expired:0};
    for(const b of books.values()){if(ctx.expired(b))counts.expired++;else{counts.all++;counts[b.place==='library'?'library':'shelf']++;}}
    if(view==='expired'&&!counts.expired)view='shelf';
    for(const tab of $('views').querySelectorAll('[data-view]')){const v=tab.dataset.view;
      tab.setAttribute('aria-selected',String(v===view));tab.tabIndex=v===view?0:-1;tab.querySelector('.count').textContent=counts[v]||'';
      if(v==='expired')tab.hidden=!counts.expired;}
    const before=shown,oldIndex=before.findIndex(b=>b.id===activeId),hadFocus=holder.contains(document.activeElement)||document.activeElement===document.body;
    shown=filtered();
    // 筛选结果数显示在搜索框内右侧（叠加显示，不占工具条宽度）。
    $('shelfCount').textContent=filtering()?shown.length+' / '+counts[view]:'';
    $('expiredHint').hidden=view!=='expired';
    drawFilterUI();drawBulk(counts);
    for(const [id,el] of nodes)if(!books.has(id)){el.remove();nodes.delete(id);}
    empty.hidden=!!shown.length;
    if(!shown.length){
      const filteredOut=counts[view]>0;
      empty.replaceChildren(icon('book-open'),make('p','',t(filteredOut?'noBooks':{library:'emptyLibrary',expired:'emptyExpired'}[view]??'emptyShelf')));
      if(filteredOut&&filtering()){const c=make('button','',t('clearFilters'));c.type='button';c.onclick=()=>clearFilters();empty.append(c);}
    }
    const ids=new Set(shown.map(b=>b.id)),cur=ctx.current&&ids.has(ctx.current.id)?ctx.current.id:null;
    let target=activeId,scroll=null,focus=false;
    if(reason==='open'){target=cur??shown[0]?.id;scroll=cur?'center':null;focus=true;holder.scrollTop=0;}
    else if(reason==='view'){target=cur??shown[0]?.id;scroll=cur?'center':null;holder.scrollTop=0;}
    else if(reason==='filter'){target=shown[0]?.id;holder.scrollTop=0;}
    else if(reason==='sort'||reason==='layout'){if(!ids.has(target))target=shown[0]?.id;scroll='center';}
    else if(!ids.has(target)){target=shown[Math.min(Math.max(oldIndex,0),shown.length-1)]?.id;scroll='nearest';focus=hadFocus;}
    if(reason==='open'){grid.classList.add('intro');clearTimeout(introTimer);introTimer=setTimeout(()=>grid.classList.remove('intro'),900);}
    const was=nodes.get(activeId);activeId=target??null;if(was&&was.dataset.id!==activeId)mark(was,false);
    drawLayoutBtn();drawSortBtn();place((reason==='update'||reason==='layout')&&before.length>0);
    setActive(activeId,{focus,scroll});
  }
  async function move(list,place){
    // 分批并发写入：数千本时不逐本串行等待。
    for(let i=0;i<list.length;i+=200)await Promise.all(list.slice(i,i+200).map(b=>{b.place=place;return ctx.persist(b);}));
    notice(null,fmt(place==='shelf'?'movedShelfN':'movedLibraryN',{n:list.length}));draw();ctx.emit('books');
  }
  async function clearPlace(place){
    const list=[...books.values()].filter(b=>inView(b,place));
    if(!list.length||!confirm(fmt(place==='shelf'?'confirmClearShelf':'confirmClearLibrary',{n:list.length})))return;
    for(const b of list)if(books.has(b.id))await ctx.discard(b);
    notice(null,fmt('clearedN',{n:list.length}));draw();ctx.emit('books');
  }
  async function removeAll(list){
    if(!confirm(fmt('confirmRemoveAll',{n:list.length})))return;
    for(const b of list)if(books.has(b.id))await ctx.discard(b);draw();ctx.emit('books');
  }
  function drawBulk(counts){
    const acts=$('bulkActions'),list=shown;acts.replaceChildren();
    const btn=(name,label,fn,cls='')=>{const el=make('button',cls);el.type='button';el.append(icon(name),make('span','',label));el.onclick=safe(async()=>{if($('bulkPop').matches(':popover-open'))$('bulkPop').hidePopover();await fn();});return el;};
    if(list.length)acts.append(btn('copy',t('copy'),()=>ctx.actions.copy()));
    if(view==='expired'){acts.append(btn('link',t('restoreAll'),restoreBatch));if(list.length)acts.append(btn('trash',fmt('removeAll',{n:list.length}),()=>removeAll(list),'danger'));}
    else{
      const toShelf=list.filter(b=>b.place!=='shelf'),toLib=list.filter(b=>b.place!=='library');
      if(toShelf.length)acts.append(btn('library',fmt('allToShelf',{n:toShelf.length}),()=>move(toShelf,'shelf')));
      if(toLib.length)acts.append(btn('archive',fmt('allToLibrary',{n:toLib.length}),()=>move(toLib,'library')));
      // 清空：书架 / 书库整个列表（不受搜索和筛选影响），确认后删除记录。
      const place=view,whole=place==='all'?0:counts[place];
      if(whole)acts.append(btn('trash',fmt(place==='shelf'?'clearShelf':'clearLibrary',{n:whole}),()=>clearPlace(place),'danger'));
    }
    $('bulkBtn').disabled=!acts.childElementCount;
  }
  // 布局切换按钮：图标表示当前布局，提示文字说明点击后切换到哪种。
  function drawLayoutBtn(){const btn=$('layoutBtn'),now=t(layoutMode==='grid'?'layoutGrid':'layoutMasonry'),next=t(layoutMode==='grid'?'layoutMasonry':'layoutGrid');
    btn.replaceChildren(icon(layoutMode==='grid'?'layout-grid':'layout-masonry'));btn.title=fmt('layoutSwitch',{now,next});btn.setAttribute('aria-label',btn.title);btn.dataset.mode=layoutMode;}
  $('layoutBtn').onclick=()=>{layoutMode=layoutMode==='grid'?'masonry':'grid';put('shelfLayout',layoutMode);draw('layout');};
  $('restoreAllBtn').onclick=safe(()=>restoreBatch());
  // 再点一次已激活的列表页签：关闭书架，回到阅读界面。
  $('views').onclick=e=>{const tab=e.target.closest('[data-view]');if(!tab)return;if(tab.dataset.view===view){shelf.close();return;}view=tab.dataset.view;if(view!=='expired')put('shelfView',view);draw('view');};
  $('views').onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const tabs=[...$('views').querySelectorAll('[data-view]:not([hidden])')],i=tabs.findIndex(x=>x.dataset.view===view);
    const next=tabs[(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];if(next.dataset.view!==view)next.click();next.focus();};

  // ---- 筛选界面：一行主工具条；页数、书签、标签在可折叠的筛选面板里；面板收起且有筛选时，下方一行显示生效的条件（各条可单独移除）。
  const panel=$('filterPanel'),toggle=$('filterToggle');let tagsOpen=false;
  function showPanel(open){panel.hidden=!open;put('shelfPanel',open);drawFilterUI();}
  toggle.onclick=()=>showPanel(panel.hidden);panel.hidden=!get('shelfPanel',false);
  function toggleTag(tag){const k=norm(tag),has=F.tags.some(x=>norm(x)===k);setFilter({...F,tags:has?F.tags.filter(x=>norm(x)!==k):[...F.tags,tag]},{inputs:false});}
  function drawFilterUI(){
    const n=extraFilters();
    // 工具条按钮都只显示图标（文字在提示里），宽度固定：角标叠在按钮角上，“清除筛选”无条件时禁用而不移除。
    $('filterBadge').textContent=n||'';toggle.classList.toggle('on',n>0);toggle.setAttribute('aria-expanded',String(!panel.hidden));
    toggle.title=t(panel.hidden?'filters':'filtersHide');toggle.setAttribute('aria-label',t('filters'));
    $('clearBtn').disabled=!filtering()&&!presetId;
    $('markedToggle').setAttribute('aria-pressed',String(F.marked));
    // 标签：当前列表中的标签按使用次数排列，已选的排在最前（即使当前列表里没有）。默认只显示一行，可展开或搜索。
    const tags=allTags(b=>inView(b)),counts=new Map(tags),on=new Set(F.tags.map(norm)),q=norm($('tagQuery').value);
    const items=[...F.tags.map(x=>[norm(x),{tag:x,n:counts.get(norm(x))?.n??0}]),...tags.filter(([k])=>!on.has(k))].filter(([k])=>!q||k.includes(q));
    $('tagSection').hidden=!tags.length&&!F.tags.length;
    const bar=$('tagBar');bar.classList.toggle('collapsed',!tagsOpen&&!q);
    bar.replaceChildren(...items.slice(0,300).map(([k,{tag,n}])=>chip(tag,{count:n,pressed:on.has(k),onclick:()=>toggleTag(tag)})));
    const more=$('tagMore');more.hidden=true;
    if(!panel.hidden&&!q){const kids=[...bar.children],top=kids[0]?.offsetTop??0,hidden=tagsOpen?0:kids.filter(c=>c.offsetTop>top+4).length+Math.max(0,items.length-300);
      if(tagsOpen||hidden){more.hidden=false;more.textContent=tagsOpen?t('lessTags'):fmt('moreTags',{n:hidden});}}
    // 生效条件摘要（关键词就在搜索框里，不重复显示）
    const sum=$('filterSummary');sum.hidden=!panel.hidden||!n;
    if(!sum.hidden){
      const x=(label,fn)=>{const c=make('span','fchip',label),b=make('button','tag-x');b.type='button';b.setAttribute('aria-label',t('remove')+' · '+label);b.append(icon('close'));b.onclick=fn;c.append(b);return c;};
      sum.replaceChildren(make('span','flabel',t('filterOn')),...F.tags.map(tag=>chip(tag,{remove:()=>toggleTag(tag)})),
        ...(F.min||F.max?[x(rangeText(F),()=>setFilter({...F,min:'',max:''}))]:[]),...(F.marked?[x(t('hasBookmarks'),()=>setFilter({...F,marked:false}))]:[]));
    }
    // 预设按钮：正在使用预设时高亮，预设名写在提示里；条件被改动后加“已修改”圆点。
    const p=presets.find(x=>x.id===presetId),mod=!!p&&!same(F,p.f),pb=$('presetBtn');
    pb.classList.toggle('on',!!p);pb.classList.toggle('modified',mod);
    pb.title=p?fmt('presetNow',{s:p.name+(mod?' ('+t('presetModified')+')':'')}):t('presets');pb.setAttribute('aria-label',pb.title);
    if($('presetPop').matches(':popover-open'))drawPresets();
  }
  $('tagMore').onclick=()=>{tagsOpen=!tagsOpen;drawFilterUI();};
  $('markedToggle').onclick=()=>setFilter({...F,marked:!F.marked});
  function clearFilters(){$('tagQuery').value='';setFilter(EMPTY,{preset:null});}
  const form=$('filters');
  form.oninput=e=>{
    if(e.target.id==='tagQuery'){drawFilterUI();return;}
    if(!['query','min','max'].includes(e.target.id))return;
    setFilter({...F,q:$('query').value,min:$('min').value,max:$('max').value},{inputs:false});
  };
  form.onreset=()=>queueMicrotask(clearFilters);form.onsubmit=e=>e.preventDefault();
  // 弹出层打开时 Esc 只关闭弹出层，不关闭整个书架。
  window.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||!shelf.open||e.target.closest?.('.pp-name'))return;const open=shelf.querySelector(':popover-open');if(!open)return;
    e.preventDefault();e.stopPropagation();const btn=$({presetPop:'presetBtn',sortPop:'sortBtn'}[open.id]??'bulkBtn');open.hidePopover();btn.focus();
  },true);
  // 搜索框快捷键：/ 或 Ctrl+F 聚焦；在搜索框里按 ↓ 回到列表，Esc 先清空关键词、再回到列表。
  shelf.addEventListener('keydown',e=>{
    const typing=e.target.closest('input,select,textarea');
    if(!typing&&(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f')){e.preventDefault();$('query').focus();$('query').select();return;}
    if(e.target.id==='query'&&(e.key==='ArrowDown'||e.key==='Escape')){
      e.preventDefault();if(e.key==='Escape'&&$('query').value){$('query').value='';setFilter({...F,q:''},{inputs:false});return;}
      if(activeId)setActive(activeId,{focus:true,scroll:'nearest'});
    }
  });

  // ---- 搜索预设：把当前筛选条件存为预设，可命名、重命名、删除、点选应用；应用后仍可继续调整，按钮上标出“已修改”。
  const pop=$('presetPop');let presetQuery='',editing=null; // editing：正在命名的预设 id，'new' 表示新建
  function drawPresets(){
    const q=norm(presetQuery),list=presets.filter(p=>!q||norm(p.name).includes(q)||norm(describe(p.f)).includes(q)),rows=[];
    if(editing==='new')rows.push(nameRow(describe(F).slice(0,40),name=>{const p={id:crypto.randomUUID(),name,f:clean(F)};presets.push(p);presetId=p.id;savePresets();storeFilter();notice(null,t('presetSaved'));}));
    else{const add=make('button','pp-add');add.type='button';add.append(icon('plus'),make('span','',filtering()?t('presetSave'):t('presetNothing')));add.disabled=!filtering();add.onclick=()=>{editing='new';drawPresets();};rows.push(add);}
    if(presets.length>6){const s=make('label','pp-search'),input=make('input');input.type='search';input.value=presetQuery;input.placeholder=t('presetFind');input.setAttribute('aria-label',input.placeholder);
      input.oninput=()=>{presetQuery=input.value;drawPresets();const again=pop.querySelector('.pp-search input');again?.focus();again?.setSelectionRange(9999,9999);};s.append(icon('search'),input);rows.push(s);}
    const box=make('div','pp-list');
    if(!presets.length)box.append(make('p','pp-empty',t('presetEmpty')));else if(!list.length)box.append(make('p','pp-empty',t('presetNoMatch')));
    for(const p of list){
      if(editing===p.id){box.append(nameRow(p.name,name=>{p.name=name;savePresets();}));continue;}
      const on=p.id===presetId,mod=on&&!same(F,p.f),row=make('div','pp-row'+(on?' on':''));
      const apply=make('button','pp-apply');apply.type='button';apply.setAttribute('aria-pressed',String(on));
      const txt=make('span','pp-txt');txt.append(make('strong','',p.name),make('small','',(mod?t('presetModified')+' · ':'')+(describe(p.f)||t('presetAll'))));apply.append(icon(on?'check':'star'),txt);
      apply.onclick=()=>{pop.hidePopover();$('tagQuery').value='';setFilter(p.f,{preset:p.id});};
      row.append(apply);
      if(mod)row.append(iconButton('refresh',t('presetUpdate'),()=>{p.f=clean(F);savePresets();drawFilterUI();}));
      row.append(iconButton('pencil',t('presetRename'),()=>{editing=p.id;drawPresets();}),
        iconButton('trash',t('presetDelete'),()=>{presets=presets.filter(x=>x!==p);if(presetId===p.id){presetId=null;storeFilter();}savePresets();drawFilterUI();drawPresets();},'danger'));
      box.append(row);
    }
    rows.push(box);pop.replaceChildren(...rows);
  }
  function nameRow(value,done){
    const f=make('form','pp-name'),input=make('input'),ok=make('button','primary',t('renameSave'));
    input.value=value;input.maxLength=60;input.placeholder=t('presetName');input.setAttribute('aria-label',input.placeholder);ok.type='submit';
    f.onsubmit=e=>{e.preventDefault();const v=input.value.trim();if(!v)return input.focus();done(v);editing=null;drawFilterUI();drawPresets();(pop.querySelector('.pp-row.on .pp-apply')||pop.querySelector('button:not(:disabled)'))?.focus();};
    input.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();editing=null;drawPresets();}};
    f.append(input,ok);queueMicrotask(()=>{input.focus();input.select();});return f;
  }
  // 弹出层放在按钮下方（不超出窗口）。
  function anchor(popEl,btn,right=false){
    popEl.addEventListener('toggle',e=>{if(e.newState!=='open')return;const r=btn.getBoundingClientRect(),w=popEl.offsetWidth;
      popEl.style.top=Math.max(8,Math.min(r.bottom+6,innerHeight-popEl.offsetHeight-8))+'px';popEl.style.left=Math.max(8,Math.min(right?r.right-w:r.left,document.documentElement.clientWidth-w-8))+'px';});
  }
  pop.addEventListener('beforetoggle',e=>{if(e.newState==='open'){editing=null;presetQuery='';drawPresets();}});
  anchor(pop,$('presetBtn'));anchor($('bulkPop'),$('bulkBtn'),true);anchor(sortPop,sortBtn,true);
  // close 事件异步派发：关闭后立刻重新打开时，迟到的事件不能清空新画好的列表。
  shelf.addEventListener('close',()=>{flushFilter();if(!shelf.open){opened=false;grid.classList.remove('intro');}});
  // close 事件是异步的：关闭后立刻再按 B 打开时它还没到，这里用属性变化（微任务）及时记下“已关闭”，下次绘制按“打开”处理。
  new MutationObserver(()=>{if(!shelf.open)opened=false;}).observe(shelf,{attributes:true,attributeFilter:['open']});
  ctx.drawShelf=draw;ctx.shelfView=()=>view;ctx.clearFilters=clearFilters;
  ctx.actions.copy=()=>ctx.copy(filtered().map(ctx.title).join('\n'));

  // ---- 存储空间：低频检查（启动后一次、打开书架时最多每 10 分钟一次）。占用达到配额的 85% 时提示删除旧书记录。
  let storageAt=0,storageInfo=null,storageWarned=false;
  async function checkStorage(force=false){
    if(!navigator.storage?.estimate)return null;if(!force&&storageInfo&&Date.now()-storageAt<6e5)return storageInfo;storageAt=Date.now();
    const {usage=0,quota=0}=await navigator.storage.estimate();storageInfo={usage,quota,p:quota?usage/quota:0};
    const high=storageInfo.p>=.85,pct=Math.round(storageInfo.p*100),warn=$('storageWarn');warn.hidden=!high;
    if(high){warn.textContent=fmt('storageHigh',{p:pct});if(!storageWarned&&!shelf.open){storageWarned=true;notice(null,fmt('storageHigh',{p:pct}),12000);}}
    return storageInfo;
  }
  // 启动后：检查占用；并申请持久存储，避免磁盘紧张时浏览器自动清除书目（不弹窗，由浏览器自行决定）。
  setTimeout(safe(async()=>{await checkStorage(true);if(navigator.storage?.persisted&&!await navigator.storage.persisted())await navigator.storage.persist().catch(()=>{});}),8000);

  // ---- 书名编辑：只改显示名（b.name），文件夹名 b.title 仍用于识别同一文件夹和恢复过期书；留空恢复原名。
  let renaming=null;
  function editName(b){renaming=b;$('renameInput').value=ctx.title(b);$('renameHint').textContent=fmt('renameHint',{name:b.title??t('loose')});$('renameBook').showModal();$('renameInput').select();}
  $('renameForm').onsubmit=e=>{e.preventDefault();safe(async()=>{
    const b=renaming,v=$('renameInput').value.trim();if(!b)return;
    if(v&&v!==(b.title??t('loose')))b.name=v;else delete b.name;
    await ctx.persist(b);$('renameBook').close();if(shelf.open)draw();ctx.toolsState();ctx.emit('books');
  })();};
  // close 事件异步派发：关闭后立刻为另一本书重新打开时，迟到的事件不能清掉新的编辑对象。
  $('renameBook').addEventListener('close',()=>{if(!$('renameBook').open)renaming=null;});

  // ---- 标签编辑：输入即联想已有标签（前缀匹配优先，再按包含），↑ ↓ 选择、回车添加；输入为空时列出最近用过和常用的标签。
  let tagging=null,hl=-1,sugs=[],sugOff=false; // sugOff：联想浮层被 Esc 收起，再输入或按 ↑ ↓ 时重新显示
  const recentTags=()=>{const r=get('recentTags',[]);return Array.isArray(r)?r.filter(x=>typeof x==='string'):[];};
  function editTags(b){tagging=b;hl=-1;sugOff=false;$('tagBook').textContent=ctx.title(b);$('tagInput').value='';drawTagEditor();$('tagEditor').showModal();$('tagInput').focus();}
  const lastPart=v=>v.split(/[,，、#]/).pop();
  function suggestions(){
    const have=new Set(tagsOf(tagging).map(norm)),q=norm(lastPart($('tagInput').value)),all=allTags().filter(([k])=>!have.has(k));
    if(!q){const byKey=new Map(all),out=[],seen=new Set();
      for(const x of recentTags()){const k=norm(x),c=byKey.get(k);if(c&&!seen.has(k)){seen.add(k);out.push({tag:c.tag,n:c.n,recent:true});}if(out.length>=8)break;}
      for(const [k,{tag,n}] of all){if(out.length>=30)break;if(!seen.has(k))out.push({tag,n});}
      return out;}
    const pre=[],mid=[];for(const [k,{tag,n}] of all)if(k.startsWith(q))pre.push({tag,n});else if(k.includes(q))mid.push({tag,n});
    return pre.concat(mid).slice(0,30);
  }
  function drawTagEditor(){
    const b=tagging;if(!b)return;const input=$('tagInput');
    $('tagList').replaceChildren(...tagsOf(b).map(x=>chip(x,{remove:safe(async()=>{b.tags=tagsOf(b).filter(y=>y!==x);await saveTags(b);})})));
    sugs=suggestions();if(hl>=sugs.length)hl=sugs.length-1;
    // 联想是输入框下方的浮层（绝对定位，不参与对话框布局）：结果增减时对话框大小和输入框位置都不动；标签紧凑地一行排多个。
    const box=$('tagSuggest');box.hidden=sugOff||!sugs.length;input.setAttribute('aria-expanded',String(!box.hidden));
    box.replaceChildren(...sugs.map((s,i)=>{const row=make('button','sug');row.type='button';row.id='tag-sug-'+i;row.tabIndex=-1;
      row.setAttribute('role','option');row.setAttribute('aria-selected',String(i===hl));row.append(chip(s.tag),make('small','',s.recent?t('tagRecent'):String(s.n)));
      row.onmousedown=e=>e.preventDefault();row.onclick=safe(()=>pick(i));return row;}));
    if(sugs.length)box.append(make('p','sug-hint',t('tagHint')));
    if(hl>=0&&!box.hidden){input.setAttribute('aria-activedescendant','tag-sug-'+hl);box.children[hl]?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
  }
  function pick(i){const s=sugs[i];if(!s)return;const parts=$('tagInput').value.split(/[,，、#]/);parts[parts.length-1]=s.tag;hl=-1;return addTags(parts.join(','));}
  async function addTags(raw){
    const b=tagging;if(!b)return;const known=new Map(allTags().map(([k,{tag}])=>[k,tag])),added=[];
    for(let x of raw.split(/[,，、#]/).map(s=>s.trim()).filter(Boolean)){x=known.get(norm(x))??x; // 与已有标签只差大小写或全半角时沿用已有写法
      if(!tagsOf(b).some(y=>norm(y)===norm(x))){b.tags=[...tagsOf(b),x];added.push(x);}}
    if(added.length){const r=recentTags().filter(x=>!added.some(y=>norm(y)===norm(x)));put('recentTags',[...added.reverse(),...r].slice(0,12));}
    $('tagInput').value='';hl=-1;await saveTags(b);$('tagInput').focus();
  }
  async function saveTags(b){await ctx.persist(b);drawTagEditor();if(shelf.open)draw();}
  $('tagForm').onsubmit=e=>{e.preventDefault();if(hl>=0)safe(pick)(hl);else safe(addTags)($('tagInput').value);};
  $('tagInput').oninput=()=>{hl=-1;sugOff=false;drawTagEditor();};
  $('tagInput').onkeydown=e=>{
    if(e.isComposing)return;
    // ↑ ↓ 随时选择；← → 只在已选中某项时切换（否则留给光标移动）。Esc 先收起浮层，再按才关闭对话框。
    const step={ArrowDown:1,ArrowUp:-1,...hl>=0&&!sugOff?{ArrowRight:1,ArrowLeft:-1}:{}}[e.key];
    if(step){e.preventDefault();if(!sugs.length)return;if(sugOff){sugOff=false;hl=-1;}hl=step>0?(hl+1)%sugs.length:hl<=0?sugs.length-1:hl-1;drawTagEditor();}
    else if(e.key==='Escape'&&!$('tagSuggest').hidden){e.preventDefault();hl=-1;sugOff=true;drawTagEditor();}
  };
  $('tagEditor').addEventListener('close',()=>{if(!$('tagEditor').open)tagging=null;}); // 同上：迟到的 close 不能让刚重新打开的编辑器失效

  // ---- 恢复：以源（文件夹）为单位。待恢复的“槽”是过期书的每个源，以及其他书中暂时找不到的卷；
  // 单文件夹书按整本书的名称和封面摘要匹配，合并作品按每一卷的名称和封面摘要匹配。用户选的文件夹作为源，可同时恢复所有引用它的书。
  // 先按文件夹名找，再比对封面摘要；改过名的文件夹用“页数相近 + 封面文件大小相同”筛出后再算摘要。
  async function candidates(dir,progress){const out=[];for await(const g of scan(dir)){out.push({...g,names:g.pages.map(p=>p.name)});progress?.(out.length);}return out;}
  const coverFile=async c=>(await c.dir.getFileHandle(coverName(c.names))).getFile();
  async function candHash(c){if(c.hash===undefined)try{const f=await coverFile(c);c.size=f.size;c.hash=await digest(f);}catch{c.hash=null;}return c.hash;}
  async function candSize(c){if(c.size===undefined)try{c.size=(await coverFile(c)).size;}catch{c.size=null;}return c.size;}
  // 槽：{book,source,merged,t}，t 是供 grade 比较的 {title,pages,fp}。
  // want(title)：只要名称相符的槽（普通导入时用，避免为大量无关的书构造比较对象）；all：不论是否缺失（定位原文件）。
  function slotsOf(b,want,all=false){
    const ex=all||ctx.expired(b);
    // 散图图集没有源，不按文件夹匹配：它的恢复是按相对目录 + 文件名逐页找回（restoreOne → ctx.relocate）。
    if(isLoose(b))return [];
    return b.sources.filter(s=>(ex||ctx.isDown(b,s))&&(!want||want(s.key?s.title:b.title))).map(s=>s.key
      ?{book:b,source:s,merged:true,t:{title:s.title,pages:allPages(b).filter(p=>keyOf(p)===s.key).map(p=>({name:fileOf(p)})),fp:s.fp&&{cover:s.fp}}}
      :{book:b,source:s,merged:false,t:b});
  }
  const allSlots=()=>[...books.values()].flatMap(b=>slotsOf(b));
  async function pairs(slots,cands){
    const byName=new Map();for(const c of cands){const k=norm(c.title);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(c);}
    const out=[];
    for(const x of slots){
      const t=x.t,named=byName.get(norm(t.title))||[],fp=t.fp?.cover,pair=(c,g)=>({book:x.book,source:x.source,merged:x.merged,cand:c,...g});
      for(const c of named){if(fp?.hash)await candHash(c);out.push(pair(c,grade(t,c)));}
      if(!fp?.hash||named.some(c=>c.hash===fp.hash))continue;
      for(const c of cands){
        if(named.includes(c)||Math.abs(c.names.length-t.pages.length)>Math.max(2,t.pages.length*.1))continue;
        if(await candSize(c)!==fp.size)continue;await candHash(c);const g=grade(t,c);if(g.level)out.push(pair(c,g));
      }
    }
    return out;
  }
  // 把配对按书分组接回，每本书只排序保存一次。返回恢复的书数。
  async function apply(list){
    const per=new Map();for(const p of list){if(!per.has(p.book))per.set(p.book,[]);per.get(p.book).push({cand:p.cand,source:p.source});}
    for(const [b,links] of per)if(books.has(b.id))await ctx.relinkAll(b,links);
    return per.size;
  }
  // 普通“添加文件夹”时：同名且封面摘要一致的过期书或缺失的卷直接接回原记录，避免产生重复条目。返回可自动接回的配对。
  ctx.autoMatch=async group=>{
    const k=norm(group.title),slots=[...books.values()].flatMap(b=>slotsOf(b,x=>norm(x)===k));if(!slots.length)return [];
    const c={...group,names:group.pages.map(p=>p.name)},ps=[];
    for(const x of slots){if(x.t.fp?.cover?.hash)await candHash(c);ps.push({book:x.book,source:x.source,merged:x.merged,cand:c,...grade(x.t,c)});}
    return assign(ps).filter(p=>p.level===2);
  };
  async function pickRoot(){if(!window.showDirectoryPicker){notice('needFsa');return null;}return showDirectoryPicker({mode:'read'});}
  function summary(done,pending,left){const parts=[];if(done)parts.push(fmt('restoredN',{n:done}));if(pending)parts.push(fmt('pendingN',{n:pending}));if(left)parts.push(fmt('unmatchedN',{n:left}));notice(null,parts.join(' · ')||t('noMatch'));}
  const stillExpired=slots=>[...new Set(slots.map(x=>x.book))].filter(b=>books.has(b.id)&&ctx.expired(b)).length;
  async function restoreBatch(){
    const dir=await pickRoot();if(!dir)return;
    const slots=allSlots();notice(null,fmt('scanningN',{n:0}),120000);
    const cands=await candidates(dir,n=>{if(n%25===0)notice(null,fmt('scanningN',{n}),120000);});
    const matched=assign(await pairs(slots,cands)),sure=matched.filter(p=>p.level===2),maybe=matched.filter(p=>p.level===1);
    const done=await apply(sure);draw();
    if(!maybe.length)return summary(done,0,stillExpired(slots));
    openRestore({title:t('reviewTitle'),hint:t('reviewHint'),go:t('restoreSelected'),rows:maybe,checks:true,async onGo(chosen){
      const more=await apply(chosen);draw();summary(done+more,0,stillExpired(slots));}});
    summary(done,new Set(maybe.map(p=>p.book)).size,0);
  }
  async function restoreOne(b){
    const dir=await pickRoot();if(!dir)return;
    if(isLoose(b)){if(await ctx.relocate(b,dir)){draw();summary(1,0,0);}else notice('noMatch');return;}
    const cands=await candidates(dir);if(!cands.length)return notice('noImages');
    let mine=slotsOf(b);if(!mine.length&&b.sources?.length>1)mine=slotsOf(b,null,true);
    const others=allSlots().filter(x=>x.book!==b);
    if(!mine.length)return notice('noMatch');
    // 同一个文件夹也可能是其他过期书或缺失的卷：完全匹配的一并接回。
    const extra=async()=>apply(assign(await pairs(others,cands)).filter(p=>p.level===2));
    if(!mine[0].merged){
      const x=mine[0],ps=[];for(const c of cands){if(b.fp?.cover?.hash)await candHash(c);ps.push({book:b,source:x.source,merged:false,cand:c,...grade(b,c)});}
      ps.sort((p,q)=>q.score-p.score);
      // 都不匹配时，以所选文件夹本身（或唯一的子文件夹）作为强制恢复的对象。
      const best=ps[0].level?ps[0]:ps.find(p=>p.cand.dir===dir)??(ps.length===1?ps[0]:null);
      if(!best)return notice('noMatch');
      const done=async()=>{await ctx.relink(b,best.cand,x.source);await extra();draw();summary(1,0,0);};
      if(best.level===2)return done();
      return openRestore({title:t('restoreTitle'),hint:t('forceHint'),go:t(best.level?'restore':'forceRestore'),rows:[best],onGo:done});
    }
    // 合并作品：逐卷匹配；完全匹配的直接接回，可能匹配的勾选确认。一卷都对不上时：整本过期才可以按所选文件夹重建（相对路径相同的卷保留书签和进度）；
    // 只缺一卷时可以把所选文件夹强制接到这一卷，其他卷不动；缺多卷时不猜，提示没有匹配。
    const matched=assign(await pairs(mine,cands)),sure=matched.filter(p=>p.level===2),maybe=matched.filter(p=>p.level===1);
    if(!matched.length){
      if(ctx.expired(b)){
        const row={book:b,cand:{title:dir.name,dir,names:cands.flatMap(c=>c.names),path:dir.name,cover:cands[0]},same:norm(dir.name)===norm(b.title),cover:null};
        return openRestore({title:t('restoreTitle'),hint:t('forceMergedHint'),go:t('forceRestore'),rows:[row],async onGo(){
          await ctx.rebuild(b,ctx.mergeKeys(cands));await extra();draw();summary(1,0,0);}});
      }
      const lost=b.sources.filter(s=>ctx.isDown(b,s)),cand=cands.find(c=>c.dir===dir)??(cands.length===1?cands[0]:null);
      if(lost.length!==1||!cand)return notice('noMatch');
      const x=mine.find(x=>x.source===lost[0]),row={book:b,source:x.source,merged:true,cand,...grade(x.t,cand)};
      return openRestore({title:t('restoreTitle'),hint:t('forceVolumeHint'),go:t('forceVolume'),rows:[row],async onGo(){
        await ctx.relinkAll(b,[{cand,source:x.source}]);await extra();draw();summary(1,0,0);}});
    }
    await apply(sure);await extra();draw();
    if(!maybe.length)return summary(1,0,0);
    openRestore({title:t('reviewTitle'),hint:t('reviewHint'),go:t('restoreSelected'),rows:maybe,checks:true,async onGo(chosen){
      await apply(chosen);draw();summary(1,0,0);}});
  }
  let urls=[];
  function side(label,name,meta,load){
    const s=make('span','side'),mini=make('span','mini'),txt=make('span','txt');
    load().then(u=>{if(u){const img=new Image();img.alt='';img.src=u;mini.append(img);}}).catch(()=>{});
    txt.append(make('small','',label),make('strong','',name),make('span','',meta));s.append(mini,txt);return s;
  }
  function openRestore({title,hint,go,rows,checks=false,onGo}){
    const dlg=$('restore');for(const u of urls)URL.revokeObjectURL(u);urls=[];
    $('restoreTitle').textContent=title;$('restoreHint').textContent=hint;$('restoreGo').textContent=go;
    $('restoreList').replaceChildren(...rows.map(p=>{
      const row=make(checks?'label':'div','match');
      if(checks){const box=make('input');box.type='checkbox';box.checked=!!p.cover;p.box=box;row.append(box);}
      const pages=n=>n+' '+t('pages');
      // 合并作品的某一卷：显示“书名 · 卷名”和这一卷的页数、路径。
      const vol=p.merged&&p.source,n=vol?allPages(p.book).filter(x=>keyOf(x)===vol.key).length:p.book.pages.length;
      row.append(side(t('oldRecord'),ctx.title(p.book)+(vol?' · '+vol.title:''),[pages(n),vol?vol.path:p.book.path].filter(Boolean).join(' · '),async()=>(await ctx.getThumb(p.book.id+':cover'))?.url),
        make('span','arrow','→'),
        side(t('newFolder'),p.cand.title,[pages(p.cand.names.length),p.cand.path].filter(Boolean).join(' · '),async()=>{const th=await ctx.makeThumb(await coverFile(p.cand.cover??p.cand),{width:120});const u=URL.createObjectURL(th.blob);urls.push(u);return u;}));
      const why=make('span','why');
      why.append(make('span',p.same?'':'bad',t(p.same?'sameName':'diffName')));
      if(p.cover!=null)why.append(make('span',p.cover?'':'bad',t(p.cover?'sameCover':'diffCover')));
      row.append(why);return row;
    }));
    $('restoreGo').onclick=safe(async()=>{const chosen=checks?rows.filter(p=>p.box.checked):rows;dlg.close();if(chosen.length)await onGo(chosen);});
    dlg.showModal();
  }
  ctx.restoreOne=restoreOne;ctx.restoreBatch=restoreBatch;
}
