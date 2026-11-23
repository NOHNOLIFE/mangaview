// 书架界面：书架（在读列表）/ 书库（大量藏书）/ 所有书籍 / 过期书籍；瀑布流纯封面、标签筛选、批量移动与恢复。
import {natural,fileOf} from './model.mjs';
import {scan,readMissingTimes,allPages,keyOf} from './sources.mjs';
import {norm,coverName,grade,assign,hue} from './match.mjs';

const $=id=>document.getElementById(id);
// 封面摘要：首张图前 64KB 的 SHA-256 加文件大小，只读一小段，不读整张大图。
async function digest(file){
  const buf=await crypto.subtle.digest('SHA-256',await file.slice(0,65536).arrayBuffer());
  return [...new Uint8Array(buf).slice(0,12)].map(x=>x.toString(16).padStart(2,'0')).join('')+':'+file.size;
}
export function install(ctx){
  const {books,t,fmt,notice,make,icon,iconButton,safe,get,put,shelf}=ctx, holder=$('books');
  let view=get('shelfView','shelf');if(!['shelf','library','all'].includes(view))view='shelf';
  const activeTags=new Map(); // norm → 显示名
  const tagsOf=b=>b.tags||[];
  // ---- 书籍排序：书架、书库、所有书籍共用一个设置，上一本 / 下一本和书架书签列表也按此顺序（ctx.orderBooks）。
  // 文件夹时间：浏览器读不到文件夹本身的修改时间，用其中最新一张图片的修改时间代替；未知的排在最后。
  const SORTS=['addedNew','addedOld','folderNew','folderOld','nameAsc','nameDesc'];
  let sortBy=get('shelfSort','addedNew');if(!SORTS.includes(sortBy))sortBy='addedNew';
  const byName=(a,b)=>natural(ctx.title(a),ctx.title(b));
  const byNumber=(key,dir)=>(a,b)=>{const ka=Number.isFinite(a[key]),kb=Number.isFinite(b[key]);
    return ka!==kb?(ka?-1:1):ka&&a[key]!==b[key]?dir*(a[key]-b[key]):byName(a,b);};
  const compare={addedNew:byNumber('added',-1),addedOld:byNumber('added',1),folderNew:byNumber('folderTime',-1),folderOld:byNumber('folderTime',1),nameAsc:byName,nameDesc:(a,b)=>byName(b,a)};
  const byTitle=list=>list.sort(compare[sortBy]);ctx.orderBooks=byTitle;
  const sortSelect=$('shelfSort');sortSelect.value=sortBy;
  sortSelect.onchange=()=>{sortBy=sortSelect.value;put('shelfSort',sortBy);draw();ctx.emit('books');sweepTimes();};
  // 按文件夹时间排序时才计算（只读文件元数据，串行，不与阅读抢硬盘）；算出新值后刷新列表。
  let timing=false;
  async function sweepTimes(){
    if(timing||!sortBy.startsWith('folder'))return;timing=true;let changed=false,drawn=Date.now();
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
    }}finally{timing=false;if(changed)refresh();}
  }
  setTimeout(sweepTimes,1500);ctx.on('books',()=>setTimeout(sweepTimes,800));
  // 封面：按文件名排序的第一张；合并作品取第一个可见卷的第一张。
  const firstPage=pages=>{const n=coverName(pages.map(fileOf));return pages.find(p=>fileOf(p)===n);};
  const coverPage=b=>{if(!(b.sources?.length>1))return firstPage(b.pages);
    for(const s of b.sources){const mine=b.pages.filter(p=>keyOf(p)===s.key);if(mine.length)return firstPage(mine);}};
  // 过期书只出现在“过期书籍”里，其他列表不显示，避免被当成可读的书。
  const inView=(b,v=view)=>ctx.expired(b)?v==='expired':v==='all'||b.place===v;

  function parse(){const tags=[],words=[];for(const w of $('query').value.trim().split(/\s+/))if(w.length>1&&w.startsWith('#'))tags.push(norm(w.slice(1)));else if(w)words.push(norm(w));return {tags,words};}
  function filtered(){
    const {tags,words}=parse(),min=Number($('min').value)||0,max=$('max').value?Number($('max').value):Infinity;
    return byTitle([...books.values()]).filter(b=>{
      if(!inView(b))return false;const n=b.pages.length;if(n<min||n>max)return false;
      const mine=tagsOf(b).map(norm);
      for(const k of activeTags.keys())if(!mine.includes(k))return false;
      for(const k of tags)if(!mine.some(x=>x.startsWith(k)))return false;
      if(words.length){const hay=norm([ctx.title(b),b.title??'',b.path??'',...tagsOf(b)].join(' '));if(!words.every(w=>hay.includes(w)))return false;}
      return true;
    });
  }
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

  // ---- 封面缓存：只存压缩 WebP，过期书也能显示；串行读取，不与阅读抢硬盘。
  let chain=Promise.resolve();const queue=fn=>(chain=chain.then(fn).catch(()=>{}));
  // 合并作品的每一卷另记一份封面摘要（只读各卷首张图的前 64KB，每卷一次），恢复时按卷匹配。
  const bySource=b=>{const m=new Map();for(const p of b.pages){const k=keyOf(p);if(!m.has(k))m.set(k,[]);m.get(k).push(p);}return m;};
  const staleFp=b=>{if(!(b.sources?.length>1))return [];const m=bySource(b);
    return b.sources.map(s=>[s,m.get(s.key)&&firstPage(m.get(s.key))]).filter(([s,p])=>p&&s.fp?.name!==fileOf(p)&&!ctx.isDown(b,s));};
  const needsFp=b=>staleFp(b).length>0;
  const coverFresh=b=>{const p=coverPage(b);return !p||b.fp?.thumb&&b.fp.cover?.name===p.name;};
  const fresh=b=>coverFresh(b)&&!needsFp(b);
  async function ensureCover(b){
    if(!books.has(b.id)||fresh(b)||ctx.expired(b))return;
    const page=coverPage(b);
    if(page&&!coverFresh(b)){
      const file=await ctx.source(b,page),th=await ctx.makeThumb(file,{width:320});
      await ctx.saveThumb(b.id+':cover',th);
      b.fp={cover:{name:page.name,size:file.size,hash:await digest(file)},thumb:true};b.coverRatio=th.h/th.w;
    }
    for(const [s,p] of staleFp(b)){
      if(b.fp?.cover?.name===p.name){s.fp={...b.fp.cover,name:fileOf(p)};continue;}
      try{const file=await ctx.source(b,p);s.fp={name:fileOf(p),size:file.size,hash:await digest(file)};}catch{} // 读不到的卷下次再试
    }
    if(books.has(b.id))await ctx.persist(b);
  }
  let sweeping=false;
  async function sweep(){
    if(sweeping)return;sweeping=true;
    try{for(const b of [...books.values()]){
      while(document.hidden)await new Promise(r=>document.addEventListener('visibilitychange',r,{once:true}));
      if(!fresh(b)&&!ctx.expired(b))await queue(()=>ensureCover(b));
    }}finally{sweeping=false;}
  }
  ctx.on('books',()=>setTimeout(sweep,600));ctx.on('select',b=>{if(b)queue(()=>ensureCover(b));});setTimeout(sweep,2500);
  const covers=new Map();
  const io=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){io.unobserve(e.target);safe(showCover)(e.target,covers.get(e.target));}},{root:holder,rootMargin:'600px 0px'});
  async function showCover(slot,b){
    if(!fresh(b)&&!ctx.expired(b))await queue(()=>ensureCover(b));
    const th=await ctx.getThumb(b.id+':cover');if(!th||!slot.isConnected)return;
    const img=new Image();img.alt='';img.decoding='async';img.src=th.url;slot.append(img);slot.classList.add('ready');
    if(Math.abs((b.coverRatio||1.42)-th.h/th.w)>.01){b.coverRatio=th.h/th.w;slot.style.aspectRatio=th.w+'/'+th.h;}
  }

  // ---- 瀑布流：按列高度依次放到最短的一列，阅读顺序大体从左到右。
  const MIN=168,GAP=16;let shown=[],cols=0;
  const columnCount=()=>{const s=getComputedStyle(holder),w=holder.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);return Math.max(2,Math.floor((w+GAP)/(MIN+GAP)));};
  function cleanup(){io.disconnect();covers.clear();holder.replaceChildren();}
  function layout(list){
    const top=holder.scrollTop;cleanup();cols=columnCount();
    const columns=Array.from({length:cols},()=>make('div','col')),heights=Array(cols).fill(0);
    list.forEach((b,i)=>{let k=0;for(let j=1;j<cols;j++)if(heights[j]<heights[k])k=j;columns[k].append(card(b,i));heights[k]+=(b.coverRatio||1.42)+.1;});
    holder.replaceChildren(...columns);holder.scrollTop=top;
  }
  new ResizeObserver(()=>{if(shelf.open&&shown.length&&columnCount()!==cols)layout(shown);}).observe(holder);
  function card(b,i){
    const ex=ctx.expired(b),el=make('article','book'+(b===ctx.current?' current':'')+(ex?' expired':''));el.style.animationDelay=Math.min(i,24)*14+'ms';
    const pick=make('button','pick');pick.type='button';pick.setAttribute('aria-label',ctx.title(b));
    pick.onclick=safe(()=>{if(ex)return restoreOne(b);ctx.select(b);shelf.close();ctx.main.focus();});
    const cover=make('span','cover');cover.style.aspectRatio=String(1/(b.coverRatio||1.42));covers.set(cover,b);io.observe(cover);
    const veil=make('span','veil'),ratio=ex?0:ctx.readRatio(b),pct=Math.round(ratio*100),meta=make('span','meta');
    meta.append(make('span','',b.pages.length+' '+t('pages')),make('span',ex?'lost':pct?'':'fresh',ex?t('viewExpired'):pct?pct+'%':t('unread')));
    veil.append(make('strong','name',ctx.title(b)),meta);
    if(tagsOf(b).length){const tags=make('span','tags');for(const x of tagsOf(b))tags.append(chip(x));veil.append(tags);}
    pick.append(cover,veil);
    if(ratio>0){const bar=make('span','progress');bar.style.setProperty('--p',ratio);pick.append(bar);}
    if(b===ctx.current)pick.append(make('span','badge',t('nowReading')));
    const lost=ex?0:ctx.lostSources(b);if(lost){const w=make('span','part');w.title=fmt('partN',{n:lost});w.setAttribute('aria-label',w.title);w.append(icon('alert'));pick.append(w);}
    const tools=make('div','actions');
    if(ex)tools.append(iconButton('link',t('restore'),()=>restoreOne(b)),iconButton('pencil',t('rename'),()=>editName(b)),iconButton('trash',t('remove'),()=>ctx.remove(b),'danger'));
    else tools.append(...lost?[iconButton('link',t('restore'),()=>restoreOne(b))]:[],iconButton('pencil',t('rename'),()=>editName(b)),iconButton('tag',t('editTags'),()=>editTags(b)),
      b.place==='library'?iconButton('library',t('toShelf'),()=>move([b],'shelf')):iconButton('archive',t('toLibrary'),()=>move([b],'library')),
      iconButton('copy',t('titleCopy'),()=>ctx.copy(ctx.title(b))),iconButton('trash',t('remove'),()=>ctx.remove(b),'danger'));
    el.append(pick,tools);return el;
  }

  function draw(){
    const counts={shelf:0,library:0,all:0,expired:0};
    for(const b of books.values()){if(ctx.expired(b))counts.expired++;else{counts.all++;counts[b.place==='library'?'library':'shelf']++;}}
    if(view==='expired'&&!counts.expired)view='shelf';
    for(const tab of $('views').querySelectorAll('[data-view]')){const v=tab.dataset.view;
      tab.setAttribute('aria-selected',String(v===view));tab.tabIndex=v===view?0:-1;tab.querySelector('.count').textContent=counts[v]||'';
      if(v==='expired')tab.hidden=!counts.expired;}
    const tags=allTags(b=>inView(b));for(const k of activeTags.keys())if(!tags.some(([x])=>x===k))activeTags.delete(k);
    const bar=$('tagBar');bar.hidden=!tags.length;
    bar.replaceChildren(icon('tag'),...tags.map(([k,{tag,n}])=>chip(tag,{count:n,pressed:activeTags.has(k),onclick:()=>{if(activeTags.has(k))activeTags.delete(k);else activeTags.set(k,tag);draw();}})));
    if(activeTags.size){const c=make('button','link-btn',t('clearTags'));c.type='button';c.onclick=()=>{activeTags.clear();draw();};bar.append(c);}
    const list=filtered();shown=list;
    $('shelfCount').textContent=list.length===counts[view]?'':list.length+' / '+counts[view];
    $('expiredHint').hidden=view!=='expired';
    const acts=$('bulkActions');acts.replaceChildren();
    const btn=(name,label,fn,cls='')=>{const el=make('button',cls);el.type='button';el.append(icon(name),make('span','',label));el.onclick=safe(fn);return el;};
    if(view==='expired'){acts.append(btn('link',t('restoreAll'),restoreBatch));if(list.length)acts.append(btn('trash',fmt('removeAll',{n:list.length}),()=>removeAll(list),'danger'));}
    else{
      const toShelf=list.filter(b=>b.place!=='shelf'),toLib=list.filter(b=>b.place!=='library');
      if(toShelf.length)acts.append(btn('library',fmt('allToShelf',{n:toShelf.length}),()=>move(toShelf,'shelf')));
      if(toLib.length)acts.append(btn('archive',fmt('allToLibrary',{n:toLib.length}),()=>move(toLib,'library')));
      // 清空：书架 / 书库整个列表（不受搜索和标签筛选影响），确认后删除记录。
      const place=view,whole=place==='all'?[]:[...books.values()].filter(b=>inView(b,place));
      if(whole.length)acts.append(btn('trash',fmt(place==='shelf'?'clearShelf':'clearLibrary',{n:whole.length}),()=>clearPlace(place),'danger'));
    }
    if(!list.length){cleanup();const box=make('div','shelf-empty');box.append(icon('book-open'),make('p','',t(counts[view]?'noBooks':{library:'emptyLibrary',expired:'emptyExpired'}[view]??'emptyShelf')));holder.append(box);return;}
    layout(list);
  }
  async function move(list,place){
    for(const b of list){b.place=place;await ctx.persist(b);}
    notice(null,fmt(place==='shelf'?'movedShelfN':'movedLibraryN',{n:list.length}));draw();
  }
  async function clearPlace(place){
    const list=[...books.values()].filter(b=>inView(b,place));
    if(!list.length||!confirm(fmt(place==='shelf'?'confirmClearShelf':'confirmClearLibrary',{n:list.length})))return;
    for(const b of list)if(books.has(b.id))await ctx.discard(b);
    notice(null,fmt('clearedN',{n:list.length}));draw();ctx.emit('books');
  }
  async function removeAll(list){
    if(!confirm(fmt('confirmRemoveAll',{n:list.length})))return;
    for(const b of list)if(books.has(b.id))await ctx.discard(b);draw();
  }
  $('views').onclick=e=>{const tab=e.target.closest('[data-view]');if(!tab)return;view=tab.dataset.view;if(view!=='expired')put('shelfView',view);draw();};
  $('views').onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const tabs=[...$('views').querySelectorAll('[data-view]:not([hidden])')],i=tabs.findIndex(x=>x.dataset.view===view);
    const next=tabs[(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];next.click();next.focus();};
  $('filters').oninput=draw;$('filters').onreset=()=>{activeTags.clear();queueMicrotask(draw);};$('filters').onsubmit=e=>e.preventDefault();
  // close 事件异步派发：关闭后立刻重新打开时，迟到的事件不能清空新画好的列表。
  shelf.addEventListener('close',()=>{if(!shelf.open){cleanup();shown=[];}});
  ctx.drawShelf=draw;ctx.shelfView=()=>view;
  ctx.actions.copy=()=>ctx.copy(filtered().map(ctx.title).join('\n'));

  // ---- 书名编辑：只改显示名（b.name），文件夹名 b.title 仍用于识别同一文件夹和恢复过期书；留空恢复原名。
  let renaming=null;
  function editName(b){renaming=b;$('renameInput').value=ctx.title(b);$('renameHint').textContent=fmt('renameHint',{name:b.title??t('loose')});$('renameBook').showModal();$('renameInput').select();}
  $('renameForm').onsubmit=e=>{e.preventDefault();safe(async()=>{
    const b=renaming,v=$('renameInput').value.trim();if(!b)return;
    if(v&&v!==(b.title??t('loose')))b.name=v;else delete b.name;
    await ctx.persist(b);$('renameBook').close();if(shelf.open)draw();ctx.toolsState();ctx.emit('books');
  })();};
  $('renameBook').addEventListener('close',()=>{renaming=null;});

  // ---- 标签编辑
  let tagging=null;
  function editTags(b){tagging=b;$('tagBook').textContent=ctx.title(b);$('tagInput').value='';drawTagEditor();$('tagEditor').showModal();$('tagInput').focus();}
  function drawTagEditor(){
    const b=tagging;if(!b)return;const have=new Set(tagsOf(b).map(norm)),q=norm($('tagInput').value);
    $('tagList').replaceChildren(...tagsOf(b).map(x=>chip(x,{remove:safe(async()=>{b.tags=tagsOf(b).filter(y=>y!==x);await saveTags(b);})})));
    $('tagSuggest').replaceChildren(...allTags().filter(([k])=>!have.has(k)&&(!q||k.includes(q))).slice(0,40).map(([,{tag}])=>chip(tag,{onclick:safe(()=>addTags(tag))})));
  }
  async function addTags(raw){
    const b=tagging;if(!b)return;
    for(const x of raw.split(/[,，、#]/).map(s=>s.trim()).filter(Boolean))if(!tagsOf(b).some(y=>norm(y)===norm(x)))b.tags=[...tagsOf(b),x];
    $('tagInput').value='';await saveTags(b);$('tagInput').focus();
  }
  async function saveTags(b){await ctx.persist(b);drawTagEditor();if(shelf.open)draw();}
  $('tagForm').onsubmit=e=>{e.preventDefault();safe(addTags)($('tagInput').value);};$('tagInput').oninput=drawTagEditor;
  $('tagEditor').addEventListener('close',()=>{tagging=null;});

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
    if(!b.sources?.length)return [];const ex=all||ctx.expired(b);
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
  // 普通“打开文件夹”时：同名且封面摘要一致的过期书或缺失的卷直接接回原记录，避免产生重复条目。返回可自动接回的配对。
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
    // 合并作品：逐卷匹配；完全匹配的直接接回，可能匹配的勾选确认。一卷都对不上时，可以按所选文件夹重建（相对路径相同的卷保留书签和进度）。
    const matched=assign(await pairs(mine,cands)),sure=matched.filter(p=>p.level===2),maybe=matched.filter(p=>p.level===1);
    if(!matched.length){
      const row={book:b,cand:{title:dir.name,dir,names:cands.flatMap(c=>c.names),path:dir.name,cover:cands[0]},same:norm(dir.name)===norm(b.title),cover:null};
      return openRestore({title:t('restoreTitle'),hint:t('forceMergedHint'),go:t('forceRestore'),rows:[row],async onGo(){
        await ctx.rebuild(b,ctx.mergeKeys(cands));await extra();draw();summary(1,0,0);}});
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
