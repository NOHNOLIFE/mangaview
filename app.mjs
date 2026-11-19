import {detect,translate,languageList} from './lang.mjs';
import {byTime,sortedPages,folderSort,needsSort,isImage,natural} from './model.mjs';
import {library,thumbs} from './store.mjs';
import {getThumb,saveThumb,makeThumb,dropThumbs} from './thumbs.mjs';
// 功能模块：每个模块导出 install(ctx)，在本文件末尾统一安装。
import {source,scan,fileGroups,handleGroups,reconnect,readMissingTimes,isLive} from './sources.mjs';
import {install as shelfUI} from './shelf.mjs';
import {Reader,imageJob,release} from './view.mjs';
import {install as toolPanel} from './toolbar.mjs';

const $=id=>document.getElementById(id), main=$('reader'), nav=$('preview'), shelf=$('shelf');
// 设置面板可固定界面语言；未设置时跟随浏览器。
const langPref=()=>{try{return JSON.parse(localStorage.getItem('mv2:lang'));}catch{return null;}};
let lang=langPref()||detect(navigator.languages||[navigator.language]);
const t=key=>translate(key,lang), title=b=>b.title??t('loose');
function localize(){
  document.documentElement.lang=lang;
  for(const el of document.querySelectorAll('[data-t]'))el.textContent=t(el.dataset.t);
  for(const el of document.querySelectorAll('[data-label]')){el.title=t(el.dataset.label);el.setAttribute('aria-label',el.title);}
  for(const el of document.querySelectorAll('[data-aria]'))el.setAttribute('aria-label',t(el.dataset.aria)); // 只给读屏，不显示悬停文字
  for(const el of document.querySelectorAll('[data-placeholder]')){el.placeholder=t(el.dataset.placeholder);el.setAttribute('aria-label',el.placeholder);}
  $('keys').replaceChildren(...t('shortcuts').map(([alternatives,text])=>{
    const row=document.createElement('div'),keys=document.createElement('dt'),desc=document.createElement('dd');
    alternatives.forEach((combo,i)=>{
      if(i)keys.append(make('span','or','/'));
      combo.split('+').forEach((key,j)=>{if(j)keys.append('+');keys.append(make('kbd','',key));});
    });
    desc.textContent=text;row.append(keys,desc);return row;
  }));
}
function make(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!=null)el.textContent=text;return el;}
function icon(name){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');
  svg.setAttribute('class','i');svg.setAttribute('aria-hidden','true');use.setAttribute('href','#i-'+name);svg.append(use);return svg;
}
function iconButton(name,label,action,className=''){
  const el=make('button','icon-btn '+className);el.type='button';el.title=label;el.setAttribute('aria-label',label);
  el.append(icon(name));el.onclick=safe(action);return el;
}
localize();
let noticeTimer;
const fmt=(key,vars)=>t(key).replace(/\{(\w+)\}/g,(_,k)=>vars[k]);
function notice(key,text=t(key),ms=3800){clearTimeout(noticeTimer);$('notice').textContent=text;noticeTimer=setTimeout(()=>$('notice').textContent='',ms);}
function safe(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{if(e.name!=='AbortError'){console.warn(e);notice('failed');}});}
const prefix='mv2:', books=new Map();let current=null, unavailablePage=null;
function get(key,otherwise=null){try{return JSON.parse(localStorage.getItem(prefix+key))??otherwise;}catch{return otherwise;}}
function put(key,value){try{localStorage.setItem(prefix+key,JSON.stringify(value));}catch{notice('storage');}}
function dropKey(key){try{localStorage.removeItem(prefix+key);}catch{notice('storage');}}
function persist(book){return library('put',book).catch(()=>notice('storage'));}
let posTimer,dimTimer,dirty,hudFrame,hudTimer;
function savePos(){clearTimeout(posTimer);posTimer=0;if(current)put('pos:'+current.id,view.anchor());}
function saveDims(){clearTimeout(dimTimer);if(dirty){persist(dirty);dirty=null;}}
function flush(){savePos();saveDims();}
const view=new Reader(main,nav,{
  file:source,invalid:()=>t('invalid'),error(e,page){if(e.name!=='EncodingError'){unavailablePage=page;$('access').hidden=false;}},
  progress(){if(!posTimer)posTimer=setTimeout(savePos,250);if(!hudFrame)hudFrame=requestAnimationFrame(()=>{hudFrame=0;updateProgress(true);});},
  measured(){dirty=current;clearTimeout(dimTimer);dimTimer=setTimeout(saveDims,800);}
});
let defaultSort=get('defaultSort',{mode:'nameAsc',revision:0});
view.fit=get('fit',true);let pinned=get('preview',false);
// 临时弹出时浮在正文上方；常驻时停靠在右侧，正文让出宽度，不被遮挡。
function preview(open){$('panel').hidden=!open||!current;document.body.classList.toggle('docked',pinned&&!!current);
  document.querySelector('[data-act="preview"][aria-pressed]').setAttribute('aria-pressed',String(pinned));}
function toolsState(){
  $('bookTitle').textContent=$('bookTitle').title=current?title(current):'MangaView';$('empty').hidden=!!current;$('hud').hidden=!current;
  for(const key of ['prev','next','fit','preview'])document.querySelector(`#bar [data-act="${key}"]`).disabled=!current;
  document.querySelector('[data-act="fit"]').setAttribute('aria-pressed',String(view.fit));preview(pinned);updateProgress();
}
// 页码、进度环和工具栏进度条；flash 表示由滚动触发，短暂显示页码浮标。
function updateProgress(flash=false){
  const pos=current&&view.position(), ratio=pos?pos.ratio:0;
  $('bookMeta').textContent=pos?`${pos.i+1} / ${pos.n} · ${Math.round(ratio*100)}%`:current?`${current.pages.length} ${t('pages')}`:'';
  $('pageNum').textContent=pos?`${pos.i+1} / ${pos.n}`:'';
  $('barProgress').style.transform=`scaleX(${ratio})`;
  $('ring').style.strokeDashoffset=String(100-ratio*100);
  if(flash&&pos){$('hud').classList.add('show');clearTimeout(hudTimer);hudTimer=setTimeout(()=>$('hud').classList.remove('show'),1400);}
}
// 书架进度按保存的阅读位置估算，当前书使用实时位置。
function readRatio(book){
  const pos=book===current?view.anchor():get('pos:'+book.id), n=book.pages.length;
  if(!pos||!n)return 0;
  const i=book.pages.findIndex(p=>p.name===pos.name);
  return i<0?0:Math.min(1,(i+pos.f)/n);
}
function select(book){flush();current=book||null;queueMicrotask(()=>emit('select',current));hintState='';queueMicrotask(()=>zoneHint());put('last',current?.id??null);$('access').hidden=true;
  view.show(current,current?get('pos:'+current.id):null);toolsState();
  if(book && needsSort(book,defaultSort))safe(arrange)(book);
}
function reloadView(anchor=view.anchor()){if(!current)return;$('access').hidden=true;view.show(current,anchor);updateProgress();}
// 过期：文件夹找不到，或没有任何可用的文件来源（导入的备份、重启后的文件选择器散图）。记录保留，手动删除才清除。
function expired(b){return !!b.missing||!b.dir&&!b.pages.some(p=>p.handle)&&!isLive(b);}
// 上一本 / 下一本在当前书所在的列表（书架或书库）内切换，跳过过期书。
function readingList(book){const place=book?.place??'shelf';return [...books.values()].filter(b=>b.place===place&&!expired(b)).sort((a,b)=>natural(title(a),title(b)));}
function step(d){
  const list=readingList(current);if(!list.length)return;
  const i=list.indexOf(current);
  const next=i<0 ? (d<0?list.length-1:0) : (i+d+list.length)%list.length;
  select(list[next]);
}

// 不对未打开的书读取原图；目录本身的只读句柄可跨启动保存。
// 同一个文件夹（句柄相同）合并为同一本书；同名但位置不同的文件夹是不同的书。
// 找不到时再看过期书：文件夹名和封面摘要都一致时接回原记录，标签、书签和进度随之恢复。
async function addGroup(group){
  let book;
  if(group.dir)for(const b of books.values())if(b.title===group.title&&b.dir&&await group.dir.isSameEntry(b.dir).catch(()=>false)){book=b;break;}
  if(!book&&group.dir)book=await ctx.autoMatch?.(group);
  if(!group.title){const names=new Set(group.pages.map(p=>p.name));book=[...books.values()].find(b=>!b.title&&!b.pages.some(p=>names.has(p.name)));}
  if(book){book.place='shelf';await relink(book,group);}else{book=normalize({id:crypto.randomUUID(),sortOverride:null,...group});books.set(book.id,book);await persist(book);}
  return book;
}
// 把书目接到（新的）文件夹上：保留仍存在的页面及其尺寸，追加新图，去掉已不存在的图。
async function relink(book,group){
  const before=book===current?view.anchor():null;
  if(group.dir){
    const fresh=new Map(group.pages.map(p=>[p.name,p]));
    const retained=book.pages.filter(p=>fresh.delete(p.name));
    for(const p of retained)delete p.lastModified;
    book.pages=retained.concat([...fresh.values()]);book.dir=group.dir;
    if(group.path)book.path=group.path;if(group.title)book.title=group.title;delete book.missing;
  }else book.pages.push(...group.pages);
  await arrange(book,false,before);emit('books');
}
async function add(groups){
  let first=true;
  notice('scanning');
  for await(const group of groups){
    const book=await addGroup(group);
    if(first){select(book);first=false;}
  }
  if(first)notice('noImages');
  else if($('notice').textContent===t('scanning'))$('notice').textContent='';
  ctx.redrawShelf();emit('books');
}
let pendingInput=null;
function input(kind,book){pendingInput=book;const el=$(kind+'Input');el.value='';el.click();}
for(const kind of ['folder','file'])$(kind+'Input').onchange=safe(async e=>{
  const groups=fileGroups(e.target.files),book=pendingInput;pendingInput=null;
  if(book){let count=0;for(const g of groups)if(!book.title||g.title===book.title||groups.length===1)count+=reconnect(book,g);await rebound(book,count);}
  else await add(groups);
});
async function rebound(book,count){if(!count){notice('noImages');return;}await arrange(book);}
async function pick(kind,book=null){
  if(kind==='folder'&&window.showDirectoryPicker){const dir=await showDirectoryPicker({mode:'read'});
    if(book){const pages=[];for await(const h of dir.values())if(h.kind==='file')pages.push({name:h.name});await rebound(book,reconnect(book,{dir,pages}));}
    else await add(scan(dir));
  }else if(kind==='file'&&window.showOpenFilePicker){const handles=await showOpenFilePicker({multiple:true,types:[{description:t('files'),accept:{'image/*':['.jpg','.jpeg','.png','.webp','.gif','.avif','.bmp','.svg']}}]});
    if(book){for await(const g of handleGroups(handles))await rebound(book,reconnect(book,g));}else await add(handleGroups(handles));
  }else input(kind,book);
}
let dragDepth=0;const dropOverlay=$('dropOverlay');
window.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){dragDepth++;dropOverlay.hidden=false;}});
window.addEventListener('dragleave',e=>{if(e.dataTransfer.types.includes('Files')&&--dragDepth<=0){dragDepth=0;dropOverlay.hidden=true;}});
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
window.addEventListener('drop',e=>{
  dragDepth=0;dropOverlay.hidden=true;
  if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();
  const items=[...e.dataTransfer.items].filter(x=>x.kind==='file');
  if(items.length&&items[0].getAsFileSystemHandle){const handles=items.map(x=>x.getAsFileSystemHandle());safe(async()=>add(handleGroups((await Promise.all(handles)).filter(Boolean))))();}
  else safe(add)(fileGroups(e.dataTransfer.files));
});

async function copy(value){await navigator.clipboard.writeText(value);notice('copied');}
async function discard(book){
  sortRequests.delete(book);flush();await library('delete',book.id);await dropThumbs(book.id);books.delete(book.id);
  if(book===current){current=null;select(books.values().next().value);}dropKey('pos:'+book.id);
}
async function remove(book){if(!book||!confirm(t('confirmRemove')+'\n'+title(book)))return;await discard(book);ctx.redrawShelf();}

// 刷新：只列目录、不读图。浏览器无法区分“文件夹已删除”和“移动硬盘未连接”，
// 所以找不到的书只标记为过期（书架“过期书籍”分类），记录、标签和书签都保留，用户手动删除才清除。
async function check(book,ask){
  let state=await book.dir.queryPermission?.({mode:'read'})??'granted';
  if(state==='prompt'&&ask)state=await book.dir.requestPermission({mode:'read'}).catch(()=>'prompt');
  if(state!=='granted')return 'denied';
  const names=[];
  try{for await(const h of book.dir.values())if(h.kind==='file'&&isImage(h.name))names.push(h.name);}
  catch(e){if(e.name==='NotFoundError')return 'gone';if(['NotAllowedError','SecurityError'].includes(e.name))return 'denied';throw e;}
  if(!names.length||!books.has(book.id))return books.has(book.id)?'gone':'same';
  delete book.missing;
  const now=new Set(names),old=new Set(book.pages.map(p=>p.name));
  const fresh=names.filter(n=>!old.has(n)).sort(natural),removed=book.pages.length-book.pages.filter(p=>now.has(p.name)).length;
  if(!fresh.length&&!removed)return 'same';
  const before=book===current?view.anchor():null;
  book.pages=book.pages.filter(p=>now.has(p.name)).concat(fresh.map(name=>({name})));
  await arrange(book,false,before);
  return {added:fresh.length,removed};
}
let refreshing=null;
function busy(on){for(const el of document.querySelectorAll('[data-act="refresh"]')){el.classList.toggle('busy',on);el.disabled=on;}}
function refreshAll(manual){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    busy(true);if(manual)notice('refreshing');
    let updated=0,denied=0,gone=0;
    for(const b of [...books.values()]){
      if(!b.dir||!books.has(b.id))continue;
      const r=await check(b,manual&&b===current);
      if(r==='denied')denied++;else if(r==='gone'){b.missing=true;gone++;}else if(r!=='same')updated++;
    }
    ctx.redrawShelf();emit('books');
    const parts=[];
    if(updated)parts.push(fmt('updatedN',{n:updated}));
    if(gone)parts.push(fmt('expiredN',{n:gone}));
    if(denied&&manual)parts.push(fmt('deniedN',{n:denied}));
    if(parts.length)notice(null,parts.join(' · '));else if(manual)notice('refreshDone');
  })().finally(()=>{refreshing=null;busy(false);});
  return refreshing;
}
// 切回窗口时只检查当前书：在资源管理器里增删图片后回来即可看到变化。
let focusCheck=0;
window.addEventListener('focus',safe(async()=>{
  const book=current;if(!book?.dir||refreshing||Date.now()-focusCheck<1500)return;focusCheck=Date.now();
  const r=await check(book,false);
  if(r==='gone'){book.missing=true;notice(null,fmt('expiredN',{n:1}));ctx.redrawShelf();}
  else if(typeof r==='object'&&book===current)notice(null,fmt('pagesChanged',{a:r.added,r:r.removed}));
}));
async function clearAll(){if(!books.size||!confirm(t('confirmClear')))return;
  for(const book of books.values())sortRequests.delete(book);
  flush();await library('clear');await thumbs('clear');for(const id of books.keys())dropKey('pos:'+id);
  books.clear();current=null;select(null);ctx.redrawShelf();}

const sortRequests=new WeakMap();
async function arrange(book,manual=false,anchor){
  const override=folderSort(book), mode=override??defaultSort.mode;
  const reorder=mode!=='shuffle'||manual||needsSort(book,defaultSort);
  book.sortOverride=override;
  const request=Symbol();
  sortRequests.set(book,request);
  const active=()=>sortRequests.get(book)===request && books.has(book.id) && mode===(folderSort(book)??defaultSort.mode);
  if(byTime(mode) && book.pages.some(p=>!Number.isFinite(p.lastModified))){
    if(book===current){
      if(!manual)reloadView(anchor); // 导入已改变页表，不能让旧视图一直等待读盘。
      notice('readingTimes');
    }
    await persist(book); // 即使读盘未完成就关闭，也能在下次打开时按已选规则继续。
    await readMissingTimes(book,active);
    if(!active())return;
    anchor=undefined; // 等待读盘期间，读者可能已经滚到了别处。
    if(book===current && book.pages.some(p=>!Number.isFinite(p.lastModified)))notice('unknownTimes');
    else if($('notice').textContent===t('readingTimes'))$('notice').textContent='';
  }
  if(book===current && anchor===undefined)anchor=view.anchor();
  if(reorder)book.pages=sortedPages(book.pages,mode);
  if(!override && mode==='shuffle')book.shuffleRevision=defaultSort.revision;
  else delete book.shuffleRevision;
  book.sortMode=mode;delete book.random;
  if(book===current){reloadView(anchor);savePos();}
  await persist(book);
}
const sortOptions=$('sortOptions'), sortScope=$('sortScope');
function showSortChoices(){
  const global=sortScope.value==='global';
  const selected=global?defaultSort.mode:(folderSort(current)??'default');
  sortOptions.querySelector('[data-mode="default"]').hidden=global;
  $('defaultSortName').textContent=t(defaultSort.mode);
  for(const btn of sortOptions.querySelectorAll('[data-mode]'))btn.setAttribute('aria-pressed',String(btn.dataset.mode===selected));
  for(const btn of sortOptions.querySelectorAll('[data-scope]')){
    btn.setAttribute('aria-pressed',String(btn.dataset.scope===sortScope.value));
    btn.disabled=sortScope.querySelector(`[value="${btn.dataset.scope}"]`).disabled;
  }
}
sortScope.onchange=showSortChoices;
sortOptions.onclick=safe(async e=>{
  const scope=e.target.closest('[data-scope]');
  if(scope){sortScope.value=scope.dataset.scope;showSortChoices();return;}
  const choice=e.target.closest('[data-mode]');
  if(!choice)return;
  const mode=choice.dataset.mode;
  sortOptions.close();
  if(sortScope.value==='global'){
    if(mode===defaultSort.mode && mode!=='shuffle')return;
    defaultSort={mode,revision:crypto.randomUUID()};
    put('defaultSort',defaultSort);
    // 未打开的书在选中时再应用默认值，不为了修改偏好遍历硬盘。
    if(current && folderSort(current)===null)await arrange(current);
  }else if(current){
    current.sortOverride=mode==='default'?null:mode;
    await arrange(current,mode!=='default');
  }
});
const actions={folder:()=>pick('folder'),files:()=>pick('file'),shelf:()=>{shelf.showModal();ctx.drawShelf();},help:()=>$('help').showModal(),
  prev:()=>step(-1),next:()=>step(1),sort:()=>{
    sortScope.querySelector('[value="folder"]').disabled=!current;
    sortScope.value=current?'folder':'global';
    showSortChoices();sortOptions.showModal();sortOptions.querySelector('.options [aria-pressed=true]').focus();
  },
  fit:()=>{view.fit=!view.fit;put('fit',view.fit);view.layout();toolsState();},
  full:()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen(),
  preview:()=>{pinned=!pinned;put('preview',pinned);preview(pinned);},refresh:()=>refreshAll(true),clear:clearAll,
  allow:async()=>{const b=current;if(!b)return;const h=b.dir||unavailablePage?.handle;
    if(!h)return pick(b.title?'folder':'file',b);if(await h.requestPermission({mode:'read'})==='granted'&&current===b)reloadView();},
  locate:()=>current&&pick(current.title?'folder':'file',current)};
document.addEventListener('click',e=>{if(e.target.closest('[data-close]'))e.target.closest('dialog').close();else{const action=e.target.closest('[data-act]')?.dataset.act;if(action)safe(actions[action])();}});

const bar=$('bar'),toolbar=$('toolbar'),tab=$('tab');let barTimer,edgeTimer=0;
function showBar(open){clearTimeout(barTimer);bar.hidden=!open;toolbar.classList.toggle('open',open);tab.setAttribute('aria-expanded',String(open));if(open)updateProgress();}
// 鼠标移入立即展开；点击只负责打开（触屏和键盘），不再收起，避免“刚打开就被点关”。
tab.onclick=()=>showBar(true);toolbar.onpointerenter=e=>{clearTimeout(barTimer);if(e.pointerType==='mouse'&&bar.hidden)showBar(true);};
toolbar.onpointerleave=()=>{clearTimeout(barTimer);if(!toolbar.querySelector(':focus-visible'))barTimer=setTimeout(()=>showBar(false),450);};
toolbar.onfocusout=()=>queueMicrotask(()=>{if(!toolbar.contains(document.activeElement)&&!toolbar.matches(':hover'))showBar(false);});
// 鼠标贴近窗口右缘稍作停留即弹出缩略图栏，离开后自动收起。
function cancelEdge(){clearTimeout(edgeTimer);edgeTimer=0;}
document.addEventListener('pointermove',e=>{
  const near=e.pointerType==='mouse'&&!e.buttons&&current&&!pinned&&get('edgeRight',true)&&$('panel').hidden&&innerWidth-e.clientX<=24&&!document.querySelector('dialog[open]');
  if(!near)cancelEdge();else if(!edgeTimer)edgeTimer=setTimeout(()=>{edgeTimer=0;if(!pinned)preview(true);},120);
});
document.addEventListener('pointerout',e=>{if(!e.relatedTarget)cancelEdge();});
$('panel').onpointerleave=()=>{if(!pinned&&!resizing)preview(false);};
let resizing=false;function setWidth(value){const w=Math.max(80,Math.min(innerWidth*.55,value));document.documentElement.style.setProperty('--panel',w+'px');return w;}
setWidth(get('width',190));const grip=$('grip');grip.onpointerdown=e=>{if(e.button!==0)return;resizing=true;grip.setPointerCapture(e.pointerId);};
grip.onpointermove=e=>{if(resizing)setWidth(innerWidth-e.clientX);};grip.onlostpointercapture=()=>{resizing=false;put('width',$('panel').offsetWidth);};
grip.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();put('width',setWidth($('panel').offsetWidth+(e.key==='ArrowLeft'?16:-16)));}};

function screenStep(d){main.scrollTop+=d*Math.max(1,main.clientHeight-64);}
function drag(el,click){let start=null;
  el.addEventListener('pointerdown',e=>{if(e.button!==0||e.offsetX>=el.clientWidth&&e.target===el)return;start={y:e.clientY,x:e.clientX,top:el.scrollTop,moved:false};el.setPointerCapture(e.pointerId);});
  el.addEventListener('pointermove',e=>{if(!start)return;const dy=e.clientY-start.y;if(Math.abs(dy)>4||Math.abs(e.clientX-start.x)>4)start.moved=true;if(start.moved)el.scrollTop=start.top-dy;});
  el.addEventListener('pointerup',e=>{if(e.button!==0||!start)return;const moved=start.moved;start=null;if(!moved)click(e);});el.onlostpointercapture=()=>{start=null;};
}
// 点击上 / 下 15% 区域：回到书首 / 书尾，已在首尾时切换上 / 下一本；中部左右半屏各翻一屏。
const atStart=()=>main.scrollTop<1, atEnd=()=>main.scrollHeight-main.scrollTop-main.clientHeight<=1;
function toStart(){if(atStart())step(-1);else main.scrollTop=0;}
function toEnd(){if(atEnd())step(1);else main.scrollTop=main.scrollHeight;}
function zone(y){const r=main.getBoundingClientRect(),f=(y-r.top)/r.height;return f<.15?'top':f>.85?'bottom':null;}
drag(main,e=>{const z=zone(e.clientY);if(z==='top')toStart();else if(z==='bottom')toEnd();else screenStep(e.clientX<main.clientWidth/2?-1:1);zoneHint();});
// 鼠标停在点击区时提示本次点击的效果，避免误跳。
let pointerY=null,pressed=false,hintState='';
function zoneHint(){
  const z=pointerY!=null&&!pressed&&current?zone(pointerY):null, swap=z==='top'?atStart():z==='bottom'&&atEnd();
  const state=z?z+(swap?':swap':''):'';if(state===hintState)return;hintState=state;
  const hint=$('zoneHint');hint.hidden=!z;if(z)main.dataset.zone=z;else delete main.dataset.zone;if(!z)return;
  hint.dataset.zone=z;
  $('zoneIcon').setAttribute('href','#i-'+(z==='top'?(swap?'skip-back':'to-top'):(swap?'skip-forward':'to-end')));
  $('zoneText').textContent=t(z==='top'?(swap?'prev':'toTop'):(swap?'next':'toEnd'));
}
main.addEventListener('pointermove',e=>{pointerY=e.pointerType==='mouse'?e.clientY:null;pressed=!!e.buttons;zoneHint();});
main.addEventListener('pointerup',()=>{pressed=false;zoneHint();});
main.addEventListener('pointerleave',()=>{pointerY=null;zoneHint();});
main.addEventListener('scroll',zoneHint,{passive:true});drag(nav,e=>view.fromPreview(e.clientY-nav.getBoundingClientRect().top));
let hold=null,frame;function stop(){hold=null;cancelAnimationFrame(frame);}
function startHold(code,d){if(hold===code)return;stop();hold=code;let prev=performance.now(),carry=0;function tick(now){carry+=Math.min(60,now-prev)*.65*d;const delta=Math.trunc(carry);carry-=delta;main.scrollTop+=delta;prev=now;frame=requestAnimationFrame(tick);}frame=requestAnimationFrame(tick);}
window.addEventListener('keydown',e=>{
  if(e.isComposing||e.target.closest('input,textarea,[contenteditable="true"]'))return;
  if(e.ctrlKey||e.metaKey){
    if(books.size&&!$('help').open&&e.key.toLowerCase()==='c'&&!window.getSelection()?.toString()){
      e.preventDefault();safe(actions.copy)();
    }
    return;
  }
  if(document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'){showBar(false);if(!pinned)preview(false);main.focus();return;}
  if(e.altKey)return;if(e.key.toLowerCase()==='t'){e.preventDefault();if(!e.repeat){showBar(bar.hidden);(bar.hidden?main:bar.querySelector('button')).focus();}return;}
  if(!current||e.target.closest('button')&&[' ','Enter'].includes(e.key))return;
  for(const h of ctx.keys)if(h.down?.(e))return; // 功能模块的按键（如书签 G / Enter）
  const k=e.key.toLowerCase();if([' ','arrowdown','arrowup'].includes(k)){e.preventDefault();startHold(e.code,k==='arrowup'||e.shiftKey?-1:1);return;}
  if(['f','arrowright','d','arrowleft'].includes(k)){e.preventDefault();screenStep(['d','arrowleft'].includes(k)?-1:1);return;}
  if(!['home','end','pageup','pagedown','delete'].includes(k))return;e.preventDefault();if(e.repeat)return;
  if(k==='home')toStart();else if(k==='end')toEnd();
  else if(k==='delete')safe(remove)(current);else step(k==='pageup'?-1:1);
});
window.addEventListener('keyup',e=>{if(e.code===hold)stop();for(const h of ctx.keys)h.up?.(e);});window.addEventListener('blur',()=>{stop();for(const h of ctx.keys)h.blur?.();});
window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden){flush();stop();}});
function relocalize(){localize();toolsState();if(sortOptions.open)showSortChoices();ctx.redrawShelf();emit('lang',lang);}
function setLang(code){put('lang',code||null);lang=code||detect(navigator.languages||[navigator.language]);relocalize();}
window.addEventListener('languagechange',()=>{if(langPref())return;lang=detect(navigator.languages);relocalize();});

// 旧记录补齐新字段：place 区分书架 / 书库；tags、bookmarks 随书目保存，导出时一并带走。
function normalize(b){b.place??='shelf';b.tags??=[];b.bookmarks??=[];b.added??=Date.now();return b;}
// 功能模块共用的上下文。keys：{down(e)→true 表示已处理, up(e), blur()}；settings：设置面板条目，见 settings 描述。
const listeners={};function emit(type,...args){for(const fn of listeners[type]||[])try{fn(...args);}catch(e){console.warn(e);}}
const ctx={books,get current(){return current;},get lang(){return lang;},select,step,persist,view,main,shelf,t,fmt,notice,make,icon,iconButton,safe,get,put,dropKey,flush,title,readRatio,source,
  actions,keys:[],settings:[],on(type,fn){(listeners[type]??=[]).push(fn);},emit,setLang,library,thumbs,getThumb,saveThumb,makeThumb,dropThumbs,
  drawShelf(){},redrawShelf(){if(shelf.open)ctx.drawShelf();},updateProgress,toolsState,showBar:open=>showBar(open),
  expired,readingList,relink,discard,remove,copy,normalize,isLive,refreshAll};
// 设置条目：{id,group,label(文案 key),type:'toggle'|'choice'|'button',options:[{value,label|text}],get(),set(v),run()}
ctx.settings.push(
  {id:'lang',group:'general',label:'langLabel',type:'choice',options:[{value:'',label:'langAuto'},...languageList.map(v=>({value:v,text:{en:'English',zh:'中文',ja:'日本語',ko:'한국어'}[v]}))],get:()=>langPref()||'',set:v=>setLang(v)},
  {id:'autoCheck',group:'general',label:'autoCheck',type:'toggle',get:()=>get('autoCheck',true),set:v=>put('autoCheck',v)},
  {id:'edgeRight',group:'reading',label:'edgeRight',type:'toggle',get:()=>get('edgeRight',true),set:v=>put('edgeRight',v)});


try{for(const b of await library('getAll')){delete b.missing;books.set(b.id,normalize(b));}}catch{notice('storage');}
// features: 在这里安装功能模块，例如 bookmarks(ctx);
shelfUI(ctx);
toolPanel(ctx);

select(books.get(get('last'))||books.values().next().value);
if(get('autoCheck',true))safe(()=>refreshAll(false))(); // 每次打开或刷新页面时检查一次已授权的文件夹
// 从旧版 v1（dist/）迁移过来时提示安装新版。
if(new URLSearchParams(location.search).get('from')==='v1'){history.replaceState(null,'',location.pathname);notice('upgraded',undefined,10000);}
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(async reg=>{
  if(reg.active)await reg.update();
}).catch(()=>{});
navigator.serviceWorker.ready.then(()=>{$('offline').hidden=false;});}
