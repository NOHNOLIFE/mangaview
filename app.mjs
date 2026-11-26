import {detect,translate,languageList} from './lang.mjs';
import {byTime,sortedPages,folderSort,needsSort,sortMode,natural} from './model.mjs';
import {library,thumbs,update,isFrozen} from './store.mjs';
import {getThumb,saveThumb,makeThumb,dropThumbs,forgetPages,forget} from './thumbs.mjs';
import {snap,merge,changes,adopt,refresh} from './merge.mjs';
// 功能模块：每个模块导出 install(ctx)，在本文件末尾统一安装。
import {timed,isStuck,isDead,probe,source,scan,fileGroups,handleGroups,looseImages,looseFiles,reconnect,readMissingTimes,isLive,listDir,mergeKeys,applyNames,settle,down,sourceOf,isMerged,keyOf,makePage,isLoose,dirOf,addLoose,looseNames,allPages} from './sources.mjs';
import {install as shelfUI} from './shelf.mjs';
import {Reader,imageJob,release} from './view.mjs';
import {install as toolPanel} from './toolbar.mjs';
import {install as overview} from './overview.mjs';
import {install as settingsPanel} from './settings.mjs';
import {install as backup} from './backup.mjs';
import {install as bookmarks} from './bookmarks.mjs';
import {install as focusMode} from './focus.mjs';
import {install as helpPanel} from './help.mjs';
import {install as windows} from './windows.mjs';

const $=id=>document.getElementById(id), main=$('reader'), nav=$('preview'), shelf=$('shelf');
// 设置面板可固定界面语言；未设置时跟随浏览器。
const langPref=()=>{try{return JSON.parse(localStorage.getItem('mv2:lang'));}catch{return null;}};
let lang=langPref()||detect(navigator.languages||[navigator.language]);
const t=key=>translate(key,lang), title=b=>b.name||(b.title??t('loose')); // name：用户编辑的书名；title 是文件夹名，用于识别和恢复，不改
function localize(){
  document.documentElement.lang=lang;
  for(const el of document.querySelectorAll('[data-t]'))el.textContent=t(el.dataset.t);queueMicrotask(()=>accessState());
  for(const el of document.querySelectorAll('[data-label]')){el.title=t(el.dataset.label);el.setAttribute('aria-label',el.title);}
  for(const el of document.querySelectorAll('[data-aria]'))el.setAttribute('aria-label',t(el.dataset.aria)); // 只给读屏，不显示悬停文字
  for(const el of document.querySelectorAll('[data-placeholder]')){el.placeholder=t(el.dataset.placeholder);el.setAttribute('aria-label',el.placeholder);}
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
// 长按进度环（长按 F / Enter 添加书签、长按翻页键切书共用）：show 开始填充，done 显示完成后自动消失。
const ring=(()=>{
  const el=make('div','hold'),dial=make('span','hold-dial'),text=make('span','hold-text'),glyph=icon('bookmark');let timer=0;
  dial.innerHTML='<svg class="hold-ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="17"/><circle class="fill" cx="20" cy="20" r="17" pathLength="100"/></svg>';
  dial.append(glyph);el.append(dial,text);el.hidden=true;el.setAttribute('aria-hidden','true');document.body.append(el);
  function set(name,label,done){clearTimeout(timer);el.hidden=true;void el.offsetWidth; // 先隐藏再显示，重新开始填充动画
    el.classList.toggle('done',done);glyph.firstChild.setAttribute('href','#i-'+name);text.textContent=label;el.hidden=false;
    if(done)timer=setTimeout(()=>{el.hidden=true;},900);}
  return {show:(name,label)=>set(name,label,false),done:(name,label)=>set(name,label,true),hide(){clearTimeout(timer);el.hidden=true;}};
})();
let noticeTimer;
const fmt=(key,vars)=>t(key).replace(/\{(\w+)\}/g,(_,k)=>vars[k]);
function notice(key,text=t(key),ms=3800){clearTimeout(noticeTimer);$('notice').textContent=text;noticeTimer=setTimeout(()=>$('notice').textContent='',ms);}
function safe(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(e=>{if(e.name!=='AbortError'){console.warn(e);notice('failed');}});}
// 边缘触发区（像素）：四边同一个值，见下方 atEdge。inset：顶缘从窗口控件覆盖区（--top）以下算起。
const EDGE=32;
const atEdge=(side,e,inset=0)=>side==='left'?e.clientX<EDGE:side==='right'?innerWidth-e.clientX<=EDGE:side==='top'?e.clientY-inset<EDGE:innerHeight-e.clientY<=EDGE;
let probed=false;const prefix='mv2:', books=new Map();let current=null, unavailablePage=null;
// 偏好（界面设置与布局）：「还原默认设置」只清除这些键，再重新载入页面，各模块按默认值重新安装。
// 书目、书签、标签、阅读位置（pos:*）、最近打开的书（last）、搜索预设等数据不在其中。键名不含 mv2: 前缀；以 * 结尾表示该前缀下的所有键。
// 多个窗口时偏好分两类登记：
// - 设置类：ctx.prefs.sync('键名', apply)。跨窗口即时同步：别的窗口改动后，本窗口调用 apply(新值) 并派发 'pref' 事件（键名, 新值）。
//   设置面板里的开关、语言、默认排序都属于这一类，以后新增的音量、静音、自动播放等也这样登记。
// - 布局类：ctx.prefs.add('键名')。侧栏、宽度、列表样式等，各窗口互不影响：本窗口读过或写过之后只用自己的值，最后写入的作为下次启动的值。
// 其余的键（数据）总是读最新值。
const prefs=new Set(['lang','autoCheck','fit','preview','width','defaultSort','edgeRight','edgeLeft','shelfmarks','shelfmarksWidth','focusMode','shelfSort','shelfView']),synced=new Map();
prefs.sync=(key,apply=null)=>{prefs.add(key);synced.set(key,apply);own.delete(key);return prefs;};
const isPref=k=>prefs.has(k)||[...prefs].some(p=>p.endsWith('*')&&k.startsWith(p.slice(0,-1)));
const layout=k=>!synced.has(k)&&isPref(k), own=new Map(); // own：本窗口的布局类偏好
function get(key,otherwise=null){
  if(own.has(key))return own.get(key)??otherwise;
  let value=null;try{value=JSON.parse(localStorage.getItem(prefix+key));}catch{}
  if(layout(key))own.set(key,value);return value??otherwise;
}
// 冻结时（别的窗口正在做全局操作，本窗口即将重新载入）不写，见 windows.mjs。
function put(key,value){if(isFrozen())return;if(layout(key))own.set(key,value);try{localStorage.setItem(prefix+key,JSON.stringify(value));}catch{notice('storage');}}
function dropKey(key){if(isFrozen())return;own.delete(key);try{localStorage.removeItem(prefix+key);}catch{notice('storage');}}
// 别的窗口写入 localStorage：设置类即时应用；布局类不理会；其余派发 'storage' 事件（键名, 新值），如书架页据此更新搜索预设。
window.addEventListener('storage',e=>{
  if(e.storageArea!==localStorage||!e.key?.startsWith(prefix)||isFrozen())return;
  const key=e.key.slice(prefix.length);if(layout(key))return;
  let value=null;try{value=JSON.parse(e.newValue);}catch{}
  if(synced.has(key)){try{synced.get(key)?.(value);}catch(err){console.warn(err);}emit('pref',key,value);}
  emit('storage',key,value);
});
// 其他窗口先停止写入，本窗口清除偏好后连同它们一起重新载入（windows.mjs）。
async function resetPrefs(){
  flush();await ctx.hold?.();
  try{for(const key of Object.keys(localStorage))if(key.startsWith(prefix)&&isPref(key.slice(prefix.length)))localStorage.removeItem(key);sessionStorage.setItem(prefix+'reset','1');}catch{notice('storage');ctx.reloadOthers?.('reset');return;}
  ctx.reloadOthers?.('reset');location.reload();
}
prefs.sync('lang',code=>{lang=code||detect(navigator.languages||[navigator.language]);relocalize();});
prefs.sync('autoCheck').sync('edgeRight').sync('edgeLeft');
prefs.sync('defaultSort',value=>{if(!value?.mode)return;defaultSort=value;if(sortOptions.open)showSortChoices();if(current&&folderSort(current)===null&&needsSort(current,defaultSort))safe(arrange)(current);});
// 已从 books 中移除（删除、清空、备份替换）的书不再写入：后台任务（封面、文件夹时间、排序）晚到的保存不会把刚删的记录写回。
// 多个窗口：以存储中的最新记录为基础，只写本窗口改过的字段（merge.mjs），存储中已变、本窗口没改的字段随之换进内存；
// 已被别的窗口删除的记录不写回，本窗口随之移除这本书。bases：书 → 本窗口所知的存储版本的逐字段指纹，没有表示尚未写入过。
const bases=new WeakMap();
function persist(book){
  if(books.get(book.id)!==book)return Promise.resolve();
  let gone=false,took=[];
  return update(book.id,stored=>{
    if(books.get(book.id)!==book)return;
    const base=bases.get(book);
    if(!stored&&base){gone=true;return;}
    let out=book;
    if(stored&&base){const r=merge(base,book,stored);out=r.out;took=r.take;for(const k of r.take)adopt(book,k,stored[k]);for(const k of r.joined)book[k]=out[k];}
    bases.set(book,snap(book));return out;
  }).then(()=>{if(gone){vanish(book);ctx.redrawShelf();emit('books');}else if(took.length)followed(book,took);},()=>notice('storage'));
}
// 别的窗口写入了这些书（windows.mjs 转来）：按书重读，只换进本窗口没有未保存改动的字段；记录已删除的移除，新增的加入。
async function pull(ids){
  const recs=await Promise.all(ids.map(id=>library('get',id).catch(()=>null)));let any=false;
  ids.forEach((id,i)=>{
    const rec=recs[i],book=books.get(id);if(rec===null)return;
    if(!rec){if(book&&bases.has(book)){vanish(book);any=true;}return;}
    if(!book){const base=snap(rec);books.set(id,normalize(rec));bases.set(rec,base);any=true;return;}
    const base=bases.get(book);if(!base)return; // 本窗口新建、尚未写入
    const keys=changes(base,book,rec);if(!keys.length)return;
    for(const k of keys)adopt(book,k,rec[k]);refresh(base,book,keys);followed(book,keys);any=true;
  });
  if(any){ctx.redrawShelf();emit('books');}
}
// 别的窗口改过的字段已换进内存：页面列表变了才重排正文；各模块按 'synced' 事件（书, 字段名）更新受影响的界面。
function followed(book,keys){
  if(book===current){if(keys.some(k=>['pages','sources','parked'].includes(k)))reloadView();toolsState();}
  emit('synced',book,keys);
}
// 别的窗口删除了这本书：从内存移除（之后不会写回）；正在读它时提示并切到下一本。
function vanish(book){
  if(books.get(book.id)!==book)return;
  const list=book===current?readingList(book):[];
  sortRequests.delete(book);books.delete(book.id);forget(book.id+':');forgetPages(book.id+':');
  if(book===current){const i=list.indexOf(book),rest=list.filter(b=>b!==book);current=null;
    select(rest.length?rest[Math.max(0,i)%rest.length]:books.values().next().value);setTimeout(()=>notice('removedElsewhere'));} // 延后：保存这本书的操作自己的提示（如“已添加书签”）不会盖掉它
}
let posTimer,dimTimer,dirty,hudFrame,hudTimer;
// 阅读位置所在的卷暂时找不到时，正文退回书首（anchor 为 null）：已保存的位置保留不动，卷找回后回到原处（here）。
// 读者在缺失期间滚到别处阅读（anchor 不为 null）才覆盖为新位置。
const held=()=>{const pos=current&&get('pos:'+current.id);return pos&&current.parked?.some(p=>p.name===pos.name)?pos:null;};
const here=()=>view.anchor()??held();
function savePos(){clearTimeout(posTimer);posTimer=0;if(!current)return;const pos=view.anchor();if(pos||!held())put('pos:'+current.id,pos);}
function saveDims(){clearTimeout(dimTimer);if(dirty){persist(dirty);dirty=null;}}
function flush(){savePos();saveDims();}
const view=new Reader(main,nav,{
  file:source,invalid:()=>t('invalid'),error(e,page){if(e.name!=='EncodingError'){unavailablePage=page;accessState();$('access').hidden=false;}},
  progress(){if(!posTimer)posTimer=setTimeout(savePos,250);if(!hudFrame)hudFrame=requestAnimationFrame(()=>{hudFrame=0;updateProgress(true);});},
  measured(){dirty=current;clearTimeout(dimTimer);dimTimer=setTimeout(saveDims,800);}
});
let defaultSort=get('defaultSort',{mode:'nameAsc',revision:0});
view.fit=get('fit',true);let pinned=get('preview',false);
// 临时弹出时浮在正文上方；常驻时停靠在右侧，正文让出宽度，不被遮挡。
// 浮动面板淡出后再隐藏，鼠标快速划过时不会一闪；淡出途中再次打开会直接取消淡出。
function fade(el,show){
  if(show){clearTimeout(el.fadeTimer);el.classList.remove('leaving');el.hidden=false;return;}
  if(el.hidden||el.classList.contains('leaving'))return;
  el.classList.add('leaving');el.fadeTimer=setTimeout(()=>{el.hidden=true;el.classList.remove('leaving');},170);
}
const showing=el=>!el.hidden&&!el.classList.contains('leaving');
function preview(open){const panel=$('panel'),floating=!document.body.classList.contains('docked');
  if(open&&current)fade(panel,true);else if(floating&&current)fade(panel,false);else{clearTimeout(panel.fadeTimer);panel.classList.remove('leaving');panel.hidden=true;}
  document.body.classList.toggle('docked',pinned&&!!current);
  document.querySelector('[data-act="preview"][aria-pressed]').setAttribute('aria-pressed',String(pinned));}
function toolsState(){
  $('bookTitle').textContent=$('bookTitle').title=current?title(current):'MangaView';$('empty').hidden=!!current;$('hud').hidden=!current;
  for(const key of ['fit','preview'])document.querySelector(`#bar [data-act="${key}"]`).disabled=!current;
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
function select(book){flush();current=book||null;queueMicrotask(()=>emit('select',current));put('last',current?.id??null);$('access').hidden=true;
  view.show(current,current?get('pos:'+current.id):null);toolsState();
  if(book && needsSort(book,defaultSort))safe(arrange)(book);
}
function reloadView(anchor=here()){if(!current)return;$('access').hidden=true;view.show(current,anchor);updateProgress();}
// 过期：全部源（文件夹）都找不到，或没有任何可用的文件来源（导入的备份、重启后的文件选择器散图）。记录保留，手动删除才清除。
function expired(b){return b.sources?.length?b.sources.every(s=>down(b,s)):!b.pages.some(p=>p.handle&&!isDead(p.handle))&&!isLive(b);}
// 散图图集里有页没有可用的句柄（失效或尚未接回）：恢复时顺带找回。
const looseLost=b=>isLoose(b)&&!isLive(b)&&allPages(b).some(p=>!p.handle||isDead(p.handle));
// 浏览器作废的句柄数（文件夹逐个计，散图图集算一个）。大量失效通常是浏览器更新所致：提示条说明原因并直接给出恢复入口。
const browserVer=()=>/(?:Chrome|Firefox|Version)\/(\d+)/.exec(navigator.userAgent)?.[1]??'';
const staleCount=()=>new Set(handlesOf([...books.values()]).filter(isDead)).size+[...books.values()].filter(b=>isLoose(b)&&b.pages.some(p=>isDead(p.handle))).length;
function accessState(show){
  const n=staleCount(),was=get('ua'),now=browserVer(),bar=$('access');
  if(probed&&!n&&now)put('ua',now); // 记下句柄完好时的浏览器版本，失效时用来说明是哪次更新之后出的问题
  bar.classList.toggle('stale',!!n);
  bar.querySelector('span').textContent=n?(was&&now&&was!==now?fmt('staleUp',{a:was,b:now,n}):fmt('stale',{n})):t('missing');
  bar.querySelector('[data-act="allow"] span').textContent=t(n?'restoreAll':'allow');
  if(show&&n)bar.hidden=false;else if(show===false&&!n&&bar.classList.contains('wasStale'))bar.hidden=true;
  bar.classList.toggle('wasStale',!!n);
}
// 合并作品中暂时找不到的卷数（整本过期时为 0）：只在书籍卡片上给一个小提示。
const lostSources=b=>b.sources?.length>1&&!expired(b)?b.sources.filter(s=>down(b,s)).length:0;
// 当前导航范围：上一本 / 下一本在当前书所在的列表（书架或书库）内、且符合书架页当前筛选条件的书中切换，跳过过期书；
// 书架书签列表（bookmarks.mjs、overview.mjs）用 ctx.readingList({place:'shelf'}) 取同一范围。
// 顺序与书架页相同（ctx.orderBooks、ctx.matchFilter 由 shelf.mjs 按“书籍排序”和筛选条件提供）。
function readingList(book){const place=book?.place??'shelf';return ctx.orderBooks([...books.values()].filter(b=>b.place===place&&!expired(b)&&ctx.matchFilter(b)));}
function step(d){
  const list=readingList(current);if(!list.length)return;
  let i=list.indexOf(current),next;
  // 当前书不在筛选结果里（仍可正常阅读）：按排序从它所在的位置走到最近的一本结果。
  if(i<0&&current){const all=ctx.orderBooks([...list,current]);i=all.indexOf(current);next=all[(i+d+all.length)%all.length];}
  else next=list[i<0 ? (d<0?list.length-1:0) : (i+d+list.length)%list.length];
  select(next);
}

// 不对未打开的书读取原图；目录本身的只读句柄可跨启动保存。
// 同一个文件夹（句柄相同）对应同一本单文件夹书；同名但位置不同的文件夹是不同的书。
// 同一个文件夹还可以是任意多本合并作品中的一卷：导入它时，这些书里的这一卷也按最新内容更新。
// 找不到时再看过期书或缺失的卷：文件夹名和封面摘要都一致时接回原记录，标签、书签和进度随之恢复。
// 句柄卡住（见 sources.mjs timed）时按不同处理：卡住的旧源随之算作缺失，可被新文件夹接回。
const handlesOf=list=>list.flatMap(b=>[...b.sources.map(s=>s.dir),...(b.roots||[])]).filter(Boolean);
const probeAll=list=>probe(handlesOf(list),list.filter(isLoose).flatMap(b=>allPages(b).map(p=>p.handle).filter(Boolean)));
const sameDir=async(a,b)=>!!a?.isSameEntry&&!!b&&(a===b||await timed(a,()=>a.isSameEntry(b)).catch(()=>false));
async function refsTo(dir,title){const out=[];for(const b of books.values())for(const s of b.sources)if(s.title===title&&await sameDir(s.dir,dir))out.push({book:b,source:s});return out;}
// later：合并作品中的卷先记下，整批导入完后每本书只排序保存一次（一次导入很多卷时不反复写整本书的记录）。
async function addGroup(group,place='shelf',later=null){
  let book;
  const vol=(b,s)=>{if(!later)return relink(b,group,s);if(!later.has(b))later.set(b,[]);later.get(b).push({cand:group,source:s});};
  if(group.dir){
    for(const r of await refsTo(group.dir,group.title))if(r.source.key)await vol(r.book,r.source);else book=r.book;
    // 过期书或合并作品中缺失的卷：同名同封面的接回（一个文件夹只接回一本单文件夹书，但可同时接回多本合并作品中的卷）。
    for(const p of await ctx.autoMatch?.(group)??[])if(p.merged)await vol(p.book,p.source);else book??=p.book;
  }
  // 散图（title 为 null）一律加入唯一的散图图集，没有时新建。
  if(!group.title&&!(book=[...books.values()].find(isLoose))){book=normalize({id:crypto.randomUUID(),sortOverride:null,title:null,pages:[],place});books.set(book.id,book);}
  if(book){book.place=place;await relink(book,group);}else{book=normalize({id:crypto.randomUUID(),sortOverride:null,...group,place});books.set(book.id,book);await persist(book);}
  return book;
}
// 把书的一个源接到（新的）文件夹上：保留仍存在的页面及其尺寸，追加新图，去掉已不存在的图。
// links：[{cand,source}]，同一本书的多个源一次处理完再排序保存。
function link(book,cand,s){
  applyNames(book,s,cand.pages.map(p=>p.name),true);
  if(!cand.dir)reconnect(book,cand,s); // 回退模式（无目录句柄）：页面绑定到本次会话选中的文件
  s.dir=cand.dir;s.title=cand.title;if(cand.path)s.path=cand.path;delete s.missing;
  if(!s.key){book.title=cand.title;if(cand.path)book.path=cand.path;}
}
async function relink(book,cand,s=book.sources[0]){return relinkAll(book,[{cand,source:s}]);}
// 接到别的文件夹后同名文件可能是不同的图：丢弃这本书在内存里的页面小图（thumbs.mjs），下次显示时重新生成。
async function relinkAll(book,links){
  const before=book===current?here():null;forgetPages(book.id+':');
  for(const {cand,source:s} of links){if(cand.dir&&s)link(book,cand,s);else await addLoose(book,cand.pages);} // 无源：加入散图图集
  delete book.folderTime;settle(book);
  await arrange(book,false,before);emit('books');
}
// 书架页正显示「书库」时导入到书库，其他情况导入到书架。书架页开着时不切换正在读的书，只提示导入结果。
const importPlace=()=>shelf.open&&ctx.shelfView?.()==='library'?'library':'shelf';
function imported(list,place){
  if(!list.length){notice('noImages');return;}
  if($('notice').textContent===t('scanning'))$('notice').textContent='';
  if(shelf.open&&current)notice(null,fmt(place==='library'?'addedLibraryN':'addedShelfN',{n:list.length}));
  ctx.redrawShelf();emit('books');
}
async function add(groups,place=importPlace()){
  const list=[],quiet=shelf.open&&!!current,later=new Map();
  notice('scanning');
  for await(const group of groups){
    const book=await addGroup(group,place,later);
    if(!list.includes(book))list.push(book);
    if(list.length===1&&!quiet&&current!==book)select(book);
  }
  for(const [b,links] of later)if(books.has(b.id))await relinkAll(b,links);
  imported(list,place);
}
// 导入为单个作品：所选的一个或多个文件夹（含其下所有带图片的子文件夹）合成一本书，每个文件夹是一个源。
// 同一组所选文件夹（或同一组源）再次导入时更新已有的那本；只有一个带图片的文件夹时按普通导入处理。散图仍单独导入。
async function addMerged(roots,groups,place=importPlace()){
  const folders=[],loose=[];
  notice('scanning');
  for await(const g of groups){(g.path?folders:loose).push(g);if(folders.length%50===0&&folders.length)notice(null,fmt('scanningN',{n:folders.length}),120000);}
  if(folders.length<2)return add(folders.concat(loose),place);
  const order=mergeKeys(folders);
  // 先按普通导入的规则更新引用这些文件夹的书、接回缺失的卷（单文件夹书与合并作品可以共用一个源）；每本书只排序保存一次。
  const links=new Map(),push=(b,cand,source)=>{if(!links.has(b))links.set(b,[]);links.get(b).push({cand,source});};
  for(const {group} of order){
    if(!group.dir)continue;
    for(const r of await refsTo(group.dir,group.title))push(r.book,group,r.source);
    for(const p of await ctx.autoMatch?.(group)??[])push(p.book,group,p.source);
  }
  for(const [b,list] of links)await relinkAll(b,list);
  let book=await findMerged(roots,folders);
  if(book){book.place=place;if(roots?.length)book.roots=roots;await rebuild(book,order);}
  else{
    const names=roots?.length?roots.map(r=>r.name):[...new Set(folders.map(g=>g.path.split('/')[0]))];
    const first=names.sort(natural)[0];
    const pages=order.flatMap(({group,key})=>group.pages.map(p=>{p.src=key;p.name=key+'/'+p.name;return p;})); // 保持页对象本身（回退模式下与本次会话的 File 绑定）
    book=normalize({id:crypto.randomUUID(),sortOverride:null,title:first,...names.length===1&&{path:names[0]},...roots?.length&&{roots},place,
      sources:order.map(({group,key})=>({key,title:group.title,...group.path&&{path:group.path},...group.dir&&{dir:group.dir}})),pages});
    books.set(book.id,book);await persist(book);
  }
  const list=[book];
  for(const g of loose)list.push(await addGroup(g,place));
  if(!(shelf.open&&current)&&current!==book)select(book);
  imported(list,place);
  notice(null,fmt('mergedDone',{name:title(book),n:book.sources.length}));
}
// 只比较目录句柄；记录里的源没有句柄（备份导入后尚未接回，或回退模式导入）时按相对路径比较。
async function findMerged(roots,folders){
  const same=async(a,b,name,match)=>a.length===b.length&&(await Promise.all(b.map(async x=>{for(const y of a)if(name(y)===name(x)&&await match(y,x))return true;return false;}))).every(Boolean);
  const volume=async(y,x)=>y.dir?sameDir(y.dir,x.dir):!!y.path&&y.path===x.path;
  for(const b of books.values()){
    if(!isMerged(b))continue;
    if(roots?.length&&b.roots?.length&&await same(b.roots,roots,x=>x.name,sameDir))return b;
    if(await same(b.sources,folders,x=>x.title,volume))return b;
  }
  return null;
}
// 用新的扫描结果重建合并作品：同一文件夹（或相对路径相同）的卷保留原 key，页名不变，书签和进度随之保留；
// 新文件夹追加为新卷；不在其中的卷连同其页面一起移除。order 为 mergeKeys 的结果，决定各卷的顺序。
// 先在全部卷中按目录句柄（同一个文件夹）配对，剩下的再按 key 配对：key 因同名去重后缀而错位时，不会把一卷接到别的文件夹的内容上。
async function rebuild(book,order){
  const before=book===current?here():null,old=[...book.sources],next=[],hit=new Map();forgetPages(book.id+':');
  for(const {group:g} of order)for(const s of old)if(![...hit.values()].includes(s)&&s.title===g.title&&await sameDir(s.dir,g.dir)){hit.set(g,s);break;}
  for(const s of hit.values())old.splice(old.indexOf(s),1);
  for(const {group:g,key} of order){
    let s=hit.get(g),i=s?-1:old.findIndex(x=>x.key===key);
    if(i>=0)s=old.splice(i,1)[0];
    if(s)link(book,g,s);
    else{let k=key;for(let n=2;book.sources.some(x=>x.key===k)||next.some(x=>x.key===k);n++)k=key+' ('+n+')';
      s={key:k,title:g.title,...g.path&&{path:g.path},...g.dir&&{dir:g.dir}};book.pages.push(...g.pages.map(p=>makePage(k,p.name)));}
    next.push(s);
  }
  const gone=new Set(old.map(s=>s.key));
  if(gone.size){const keep=p=>!gone.has(keyOf(p));book.pages=book.pages.filter(keep);if(book.parked)book.parked=book.parked.filter(keep);}
  book.sources=next;delete book.folderTime;settle(book);
  await arrange(book,false,before);emit('books');
}
let pendingInput=null,pendingMerge=false;
function input(kind,book,merge=false){pendingInput=book;pendingMerge=merge;const el=$(kind+'Input');el.value='';el.click();}
for(const kind of ['folder','file'])$(kind+'Input').onchange=safe(async e=>{
  const groups=fileGroups(e.target.files),book=pendingInput,merge=pendingMerge;pendingInput=null;pendingMerge=false;
  if(book&&isLoose(book)){const [g]=looseFiles(e.target.files);await rebound(book,g?reconnect(book,g):0);}
  else if(book){let count=0;
    for(const g of groups){const s=isMerged(book)?book.sources.find(s=>s.title===g.title):book.sources[0];
      if(isMerged(book)?s:!book.title||g.title===book.title||groups.length===1)count+=reconnect(book,g,s);}
    await rebound(book,count);}
  else if(merge)await addMerged(null,groups);
  else await add(groups);
});
async function rebound(book,count){if(!count){notice('noImages');return;}settle(book);await arrange(book);}
// 散图图集定位原文件 / 恢复：在所选文件夹里（递归）按“相对目录 + 文件名”找回各页，见 sources.mjs reconnect。返回找回的页数。
async function relocate(book,dir,quiet){const [g]=await looseImages([dir]);const n=g?reconnect(book,g):0;if(n||!quiet)await rebound(book,n);return n;}
async function pick(kind,book=null){
  if(kind==='folder'&&window.showDirectoryPicker){const dir=await showDirectoryPicker({mode:'read'});
    if(book&&isLoose(book))await relocate(book,dir);
    else if(book){const pages=[];for await(const h of dir.values())if(h.kind==='file')pages.push({name:h.name});await rebound(book,reconnect(book,{dir,pages}));}
    else await add(scan(dir));
  }else if(kind==='file'&&window.showOpenFilePicker){const handles=await showOpenFilePicker({multiple:true,types:[{description:t('imageTypes'),accept:{'image/*':['.jpg','.jpeg','.png','.webp','.gif','.avif','.bmp','.svg']}}]});
    await add(handleGroups(handles));
  }else input(kind,book);
}
// 不依赖拖拽的「导入为单个作品」：选一个文件夹，其下所有带图片的文件夹合成一本。
async function pickMerged(){
  if(!window.showDirectoryPicker)return input('folder',null,true);
  const dir=await showDirectoryPicker({mode:'read'});await addMerged([dir],scan(dir));
}
// 拖入覆盖层：放在顶层（popover），书架等对话框打开时也看得见。上方是默认区域（按文件夹建书），下方左右并排「导入为单个作品」和「添加到散图图集」两块区域。
// 散图区域：拖入内容里的所有图片（包括文件夹里的，递归）都作为散图加入散图图集，不按文件夹建书。
// 只拖入图片文件（没有文件夹）时，整个覆盖层就是「添加到散图图集」。拖动途中读不到文件内容，只能看 items 的 kind / type：
// 图片文件的 type 是 image/*，文件夹的 type 为空；判断不出时按含文件夹处理。
let dragDepth=0,onlyImages=false;const dropOverlay=$('dropOverlay'),zones=[...dropOverlay.querySelectorAll('.zone')];
const imagesOnly=dt=>{const items=[...dt?.items||[]];return items.length>0&&items.every(x=>x.kind==='file'&&x.type.startsWith('image/'));};
const zoneAt=e=>{if(dropOverlay.hidden)return null;if(onlyImages)return 'loose';for(const z of zones){const r=z.getBoundingClientRect();if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)return z.dataset.zone;}return null;};
function overlay(show,dt){
  if(show){onlyImages=imagesOnly(dt);dropOverlay.classList.toggle('images',onlyImages);dropOverlay.querySelector('.box use').setAttribute('href',onlyImages?'#i-image-plus':'#i-upload');
    $('dropText').textContent=t(onlyImages?'dropImages':importPlace()==='library'?'dropLibrary':'dropHere');dropOverlay.hidden=false;
    if(dropOverlay.showPopover&&!dropOverlay.matches(':popover-open'))try{dropOverlay.showPopover();}catch{}}
  else{dropOverlay.hidden=true;for(const z of zones)z.classList.remove('over');if(dropOverlay.hidePopover&&dropOverlay.matches(':popover-open'))try{dropOverlay.hidePopover();}catch{}}
}
window.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){dragDepth++;if(dropOverlay.hidden)overlay(true,e.dataTransfer);}});
window.addEventListener('dragleave',e=>{if(e.dataTransfer.types.includes('Files')&&--dragDepth<=0){dragDepth=0;overlay(false);}});
window.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';const at=onlyImages?null:zoneAt(e);for(const z of zones)z.classList.toggle('over',z.dataset.zone===at);}});
window.addEventListener('drop',e=>{
  const zone=zoneAt(e),place=importPlace();
  dragDepth=0;overlay(false);
  if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();
  const items=[...e.dataTransfer.items].filter(x=>x.kind==='file');
  if(items.length&&items[0].getAsFileSystemHandle){const handles=items.map(x=>x.getAsFileSystemHandle());safe(async()=>{
    const list=(await Promise.all(handles)).filter(Boolean);
    if(zone==='merge')await addMerged(list.filter(h=>h.kind==='directory'),handleGroups(list),place);
    else if(zone==='loose'){notice('scanning');await add(await looseImages(list),place);}
    else await add(handleGroups(list),place);})();}
  else{const files=e.dataTransfer.files;safe(()=>zone==='merge'?addMerged(null,fileGroups(files),place):add(zone==='loose'?looseFiles(files):fileGroups(files),place))();}
});

async function copy(value){await navigator.clipboard.writeText(value);notice('copied');}
// 先从内存移除再删库，删除期间后台任务对这本书的保存会被 persist 忽略。
async function discard(book){
  sortRequests.delete(book);flush();books.delete(book.id);
  if(book===current){current=null;select(books.values().next().value);}
  await library('delete',book.id);await dropThumbs(book.id);dropKey('pos:'+book.id);
}
async function remove(book){if(!book||!confirm(t('confirmRemove')+'\n'+title(book)))return;await discard(book);ctx.redrawShelf();}

// 刷新：以源（文件夹）为单位，只列目录、不读图；同一个文件夹被多本书引用时只列一次，结果同步到所有引用它的书。
// 浏览器无法区分“文件夹已删除”和“移动硬盘未连接”，所以找不到的源只做标记：全部源都找不到的书归入「过期书籍」，
// 部分找不到的书照常可读，缺失那几卷的页暂时不显示。记录、标签和书签都保留，用户手动删除才清除。
async function sync(list,ask){
  await probeAll(list);
  const byTitle=new Map(),units=[];
  for(const b of list)for(const s of b.sources){
    if(!s.dir)continue;
    const group=byTitle.get(s.title)??[];byTitle.set(s.title,group);
    let u=group.find(u=>u.dir===s.dir);
    if(!u)for(const x of group)if(await sameDir(x.dir,s.dir)){u=x;break;}
    if(!u){u={dir:s.dir,refs:[]};group.push(u);units.push(u);}
    u.refs.push({book:b,source:s});
  }
  // 合并作品先向当初选的文件夹请求一次授权，其下各卷随之可读，不必逐卷弹窗。
  if(ask&&current?.roots&&list.includes(current))for(const r of current.roots)if(r.queryPermission&&await timed(r,()=>r.queryPermission({mode:'read'})).catch(()=>null)==='prompt')await r.requestPermission({mode:'read'}).catch(()=>{});
  for(const u of units)u.result=await listDir(u.dir,ask&&u.refs.some(r=>r.book===current));
  const per=new Map();
  for(const u of units)for(const r of u.refs){if(!per.has(r.book))per.set(r.book,[]);per.get(r.book).push([r.source,u.result]);}
  const out={updated:0,gone:0,partial:0,denied:0,added:0,removed:0};
  for(const [book,results] of per){
    if(!books.has(book.id))continue;
    const before=book===current?here():null;let changed=false,added=0,removed=0,denied=false;
    for(const [s,r] of results){
      if(!book.sources.includes(s))continue; // 列目录期间这一卷已被移除或重建
      if(r==='denied')denied=true;
      else if(r==='gone'){if(!s.missing){s.missing=true;changed=true;}}
      else{if(s.missing){delete s.missing;changed=true;}const d=applyNames(book,s,r);added+=d.added;removed+=d.removed;}
    }
    if(added||removed)delete book.folderTime; // 文件夹时间待重新计算
    if(settle(book)||added||removed){await arrange(book,false,before);changed=true;}
    if(denied)out.denied++;
    if(expired(book))out.gone++;else if(book.sources.length>1&&book.sources.some(s=>down(book,s)))out.partial++;
    if(changed&&!expired(book))out.updated++;
    out.added+=added;out.removed+=removed;
  }
  return out;
}
let refreshing=null;
function busy(on){for(const el of document.querySelectorAll('[data-act="refresh"]')){el.classList.toggle('busy',on);el.disabled=on;}}
function refreshAll(manual){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    busy(true);if(manual)notice('refreshing');
    // 当前书先查（只列它的几个文件夹），结果立即生效；其余的书等浏览器空闲后再串行列目录，不与首屏读图抢硬盘。
    const r={updated:0,gone:0,partial:0,denied:0,added:0,removed:0},sum=x=>{for(const k in r)r[k]+=x[k];};
    const first=current&&books.has(current.id)?current:null;
    if(first)sum(await sync([first],manual));
    // 其余的书：多个窗口同时开着时，只由持有后台磁盘任务的窗口检查一次（windows.mjs）；手动刷新照常检查全部。
    if(manual||await (ctx.disk?.check()??true)){
      if(!manual)await new Promise(ok=>window.requestIdleCallback?requestIdleCallback(ok,{timeout:2000}):setTimeout(ok,300));
      sum(await sync([...books.values()].filter(b=>b!==first),manual));ctx.disk?.done();
    }
    ctx.redrawShelf();emit('books');
    const parts=[];
    if(r.updated)parts.push(fmt('updatedN',{n:r.updated}));
    if(r.gone)parts.push(fmt('expiredN',{n:r.gone}));
    if(r.partial)parts.push(fmt('partialN',{n:r.partial}));
    if(r.denied&&manual)parts.push(fmt('deniedN',{n:r.denied}));
    if(parts.length)notice(null,parts.join(' · '));else if(manual)notice('refreshDone');
  })().finally(()=>{refreshing=null;busy(false);});
  return refreshing;
}
// 切回窗口时只检查当前书：在资源管理器里增删图片后回来即可看到变化。
let focusCheck=0;
window.addEventListener('focus',safe(async()=>{
  const book=current;if(!book?.sources.some(s=>s.dir)||refreshing||Date.now()-focusCheck<1500)return;focusCheck=Date.now();
  const r=await sync([book],false);
  if(r.gone){notice(null,fmt('expiredN',{n:1}));ctx.redrawShelf();}
  else if((r.added||r.removed)&&book===current)notice(null,fmt('pagesChanged',{a:r.added,r:r.removed}));
  else if(r.updated){ctx.redrawShelf();emit('books');}
}));
// 其他窗口先停止写入，清空后自动重新载入（windows.mjs）。
async function clearAll(){if(!books.size||!confirm(t('confirmClear')))return;
  await ctx.hold?.();
  try{for(const book of books.values())sortRequests.delete(book);
    flush();const ids=[...books.keys()];books.clear();current=null;select(null);
    await library('clear');await thumbs('clear');for(const id of ids)dropKey('pos:'+id);ctx.redrawShelf();}
  finally{ctx.reloadOthers?.('clear');}}

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
  if(book===current && anchor===undefined)anchor=here();
  if(reorder)book.pages=sortedPages(book.pages,mode,dirOf(book));
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
  // 合并作品先向用户当初选的文件夹请求授权，一次即可覆盖其下各卷。
  allow:async()=>{if(staleCount()&&ctx.restoreBatch)return ctx.restoreBatch();const b=current;if(!b)return;const h=(unavailablePage&&sourceOf(b,unavailablePage)?.dir)||b.sources.find(s=>s.dir)?.dir||unavailablePage?.handle;
    if(!h||isStuck(h))return actions.locate();let ok=false; // 卡住的句柄授权也没用，直接重新指定文件夹 // 合并作品没有任何句柄时按卷匹配，不默认绑到第一卷
    for(const x of [...(b.roots||[]).filter(r=>!isStuck(r)),h])if(await x.requestPermission({mode:'read'}).catch(()=>'denied')==='granted')ok=true;
    if(ok&&current===b)reloadView();},
  // 散图图集也选文件夹：按相对目录 + 文件名找回各页。
  locate:()=>current&&(window.showDirectoryPicker&&ctx.restoreOne?ctx.restoreOne(current):pick('folder',current)),
  merge:pickMerged};
document.addEventListener('click',e=>{if(e.target.closest('[data-close]'))e.target.closest('dialog').close();else{const action=e.target.closest('[data-act]')?.dataset.act;if(action)safe(actions[action])();}});

const bar=$('bar'),toolbar=$('toolbar'),tab=$('tab');let barTimer,edgeTimer=0;
function showBar(open){clearTimeout(barTimer);fade(bar,open);toolbar.classList.toggle('open',open);tab.setAttribute('aria-expanded',String(open));if(open)updateProgress();}
// 菜单按钮平时不可见，只供键盘（Tab 聚焦后回车）打开，打开后焦点移到第一个按钮。
tab.onclick=()=>{const keyboard=document.activeElement===tab;showBar(true);if(keyboard)bar.querySelector('.tb:not([hidden])')?.focus();};toolbar.onpointerenter=e=>{clearTimeout(barTimer);if(e.pointerType==='mouse'&&!showing(bar))showBar(true);};
toolbar.onpointerleave=()=>{clearTimeout(barTimer);if(!toolbar.querySelector(':focus-visible'))barTimer=setTimeout(()=>showBar(false),450);};
toolbar.onfocusout=()=>queueMicrotask(()=>{if(!toolbar.contains(document.activeElement)&&!toolbar.matches(':hover'))showBar(false);});
// 四边的边缘触发区统一为 EDGE 像素（ctx.atEdge）：顶缘工具栏、底缘操作栏（toolbar.mjs）、左缘书架书签（bookmarks.mjs）、右缘缩略图栏（这里）。
// 改距离只改这一处；各自的停留延迟（DWELL）用来防误触，可以不同。
// 鼠标贴近右缘停留 SIDE_DWELL 毫秒即弹出缩略图栏，离开后自动收起；左侧书架书签相同。两侧栏拖宽度的下限也统一为 SIDE_MIN。
const SIDE_DWELL=150,SIDE_MIN=160;
function cancelEdge(){clearTimeout(edgeTimer);edgeTimer=0;}
document.addEventListener('pointermove',e=>{
  const near=e.pointerType==='mouse'&&!e.buttons&&current&&!pinned&&get('edgeRight',true)&&!showing($('panel'))&&atEdge('right',e)&&!document.querySelector('dialog[open]');
  if(!near)cancelEdge();else if(!edgeTimer)edgeTimer=setTimeout(()=>{edgeTimer=0;if(!pinned&&!document.querySelector('dialog[open]'))preview(true);},SIDE_DWELL);
  // 窄条在静止的指针下弹出时浏览器未必补发 pointerenter，之后也就没有 pointerleave：指针已离开窄条和右缘就直接收起。
  if(e.pointerType==='mouse'&&!pinned&&!resizing&&showing($('panel'))&&!atEdge('right',e)&&!$('panel').contains(e.target))preview(false);
});
document.addEventListener('pointerout',e=>{if(!e.relatedTarget)cancelEdge();});
$('panel').onpointerleave=()=>{if(!pinned&&!resizing)preview(false);};
let resizing=false;function setWidth(value){const w=Math.max(SIDE_MIN,Math.min(innerWidth*.55,value));document.documentElement.style.setProperty('--panel',w+'px');return w;}
setWidth(get('width',190));const grip=$('grip');grip.onpointerdown=e=>{if(e.button!==0)return;resizing=true;grip.setPointerCapture(e.pointerId);};
grip.onpointermove=e=>{if(resizing)setWidth(innerWidth-e.clientX);};grip.onlostpointercapture=()=>{resizing=false;put('width',$('panel').offsetWidth);};
grip.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();put('width',setWidth($('panel').offsetWidth+(e.key==='ArrowLeft'?16:-16)));}};

function screenStep(d){main.scrollTop+=d*Math.max(1,main.clientHeight-64);}
function drag(el,click){let start=null;
  el.addEventListener('pointerdown',e=>{if(e.button!==0||e.offsetX>=el.clientWidth&&e.target===el)return;start={y:e.clientY,x:e.clientX,top:el.scrollTop,moved:false};el.setPointerCapture(e.pointerId);});
  el.addEventListener('pointermove',e=>{if(!start)return;const dy=e.clientY-start.y;if(Math.abs(dy)>4||Math.abs(e.clientX-start.x)>4)start.moved=true;if(start.moved)el.scrollTop=start.top-dy;});
  el.addEventListener('pointerup',e=>{if(e.button!==0||!start)return;const moved=start.moved;start=null;if(!moved)click(e);});el.onlostpointercapture=()=>{start=null;};
}
// 点击正文：左半屏前一屏、右半屏后一屏；触屏点正文顶部的窄条开关工具栏（触屏没有鼠标悬停）。上 / 下一本、回到书首 / 滚到书尾在底缘弹出的操作栏里（toolbar.mjs）。
const atStart=()=>main.scrollTop<1, atEnd=()=>main.scrollHeight-main.scrollTop-main.clientHeight<=1;
function toStart(){if(atStart())step(-1);else main.scrollTop=0;}
function toEnd(){if(atEnd())step(1);else main.scrollTop=main.scrollHeight;}
drag(main,e=>{const r=main.getBoundingClientRect();if(e.pointerType!=='mouse'&&e.clientY-r.top<=40){showBar(!showing(bar));return;}screenStep(e.clientX-r.left<main.clientWidth/2?-1:1);});
drag(nav,e=>view.fromPreview(e.clientY-nav.getBoundingClientRect().top));
let hold=null,frame;function stop(){hold=null;cancelAnimationFrame(frame);}
const HOLD_SHOW=150,HOLD_FIRE=550;let pageHold=null; // 长按翻页键切书
function cancelPage(){const p=pageHold;if(!p)return;clearTimeout(p.show);clearTimeout(p.fire);if(!p.done)ring.hide();pageHold=null;}
function startHold(code,d){if(hold===code)return;stop();hold=code;let prev=performance.now(),carry=0;function tick(now){carry+=Math.min(60,now-prev)*.65*d;const delta=Math.trunc(carry);carry-=delta;main.scrollTop+=delta;prev=now;frame=requestAnimationFrame(tick);}frame=requestAnimationFrame(tick);}
window.addEventListener('keydown',e=>{
  if(e.isComposing||e.target.closest('input,textarea,[contenteditable="true"]'))return;
  if(e.ctrlKey||e.metaKey){
    if(books.size&&!$('help').open&&e.key.toLowerCase()==='c'&&!window.getSelection()?.toString()){
      e.preventDefault();safe(actions.copy)();
    }
    return;
  }
  // B：打开 / 关闭书架（书架页的搜索框等输入框内不拦截，上面已经返回）。
  if(shelf.open&&!e.altKey&&e.key.toLowerCase()==='b'&&[...document.querySelectorAll('dialog[open]')].every(d=>d===shelf||d.classList.contains('overview'))){e.preventDefault();if(!e.repeat)shelf.close();return;}
  if(document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'){showBar(false);if(!pinned)preview(false);main.focus();return;}
  if(e.altKey)return;if(e.key.toLowerCase()==='b'){e.preventDefault();if(!e.repeat)actions.shelf();return;}
  if(e.key.toLowerCase()==='t'){e.preventDefault();if(!e.repeat){showBar(!showing(bar));(showing(bar)?bar.querySelector('button'):main).focus();}return;}
  if(!current||e.target.closest('button')&&[' ','Enter'].includes(e.key))return;
  for(const h of ctx.keys)if(h.down?.(e))return; // 功能模块的按键（书签 F / Enter、全屏总览 C / V 等）
  // 空格 / S / ↓ 向下、Shift+空格 / W / ↑ 向上：按住持续滚动。
  const k=e.key.toLowerCase();if([' ','s','arrowdown','w','arrowup'].includes(k)){e.preventDefault();startHold(e.code,k===' '?(e.shiftKey?-1:1):['w','arrowup'].includes(k)?-1:1);return;}
  // D / → 、A / ←：短按（松开时）翻一屏；长按 150ms 显示进度环，满 550ms 切到下一本 / 上一本。
  if(['d','arrowright','a','arrowleft'].includes(k)){e.preventDefault();if(e.repeat||pageHold)return;
    const p=pageHold={code:e.code,d:['a','arrowleft'].includes(k)?-1:1,done:false};
    p.show=setTimeout(()=>ring.show(p.d>0?'skip-forward':'skip-back',t(p.d>0?'holdNext':'holdPrev')),HOLD_SHOW);
    p.fire=setTimeout(()=>{p.done=true;const before=current;step(p.d);if(current&&current!==before)ring.done(p.d>0?'skip-forward':'skip-back',title(current));else ring.hide();},HOLD_FIRE);
    return;}
  if(!['home','end','pageup','pagedown','delete'].includes(k))return;e.preventDefault();if(e.repeat)return;
  if(k==='home')toStart();else if(k==='end')toEnd();
  else if(k==='delete')safe(remove)(current);else step(k==='pageup'?-1:1);
});
window.addEventListener('keyup',e=>{if(e.code===hold)stop();if(pageHold?.code===e.code){const p=pageHold;cancelPage();if(!p.done)screenStep(p.d);}for(const h of ctx.keys)h.up?.(e);});
window.addEventListener('blur',()=>{stop();cancelPage();for(const h of ctx.keys)h.blur?.();});
window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden){flush();stop();}});
function relocalize(){localize();toolsState();if(sortOptions.open)showSortChoices();ctx.redrawShelf();emit('lang',lang);}
function setLang(code){put('lang',code||null);lang=code||detect(navigator.languages||[navigator.language]);relocalize();}
window.addEventListener('languagechange',()=>{if(langPref())return;lang=detect(navigator.languages);relocalize();});

// 旧记录补齐新字段：place 区分书架 / 书库；tags、bookmarks 随书目保存，导出时一并带走。
// v2.1 及以前的书只有一个文件夹（b.dir / b.title / b.path），转为一个 key 为 '' 的源。找不到的标记只在本次会话有效，
// 载入时清掉并把暂存的页放回原位，由启动时的检查重新判断。
function normalize(b){
  b.place??='shelf';b.added??=Date.now();
  for(const k of ['tags','bookmarks','pages'])if(!Array.isArray(b[k]))b[k]=[];if(b.parked!=null&&!Array.isArray(b.parked))delete b.parked;
  if(!Array.isArray(b.sources))b.sources=b.dir||b.title!=null?[{key:'',title:b.title??null,...b.path&&{path:b.path},...b.dir&&{dir:b.dir}}]:[];
  b.sources=b.sources.filter(s=>s&&typeof s==='object'&&typeof s.key==='string');
  if(b.roots!=null&&!Array.isArray(b.roots))delete b.roots;
  for(const s of b.sources)delete s.missing;delete b.dir;delete b.missing;
  looseNames(b);
  if(b.parked?.length){b.pages=b.pages.concat(b.parked);delete b.parked;if(sortMode(b)!=='shuffle')b.pages=sortedPages(b.pages,sortMode(b),dirOf(b));}
  return b;
}
// 只保留一个散图图集：旧版本遇到同名图片会另建一本，载入时并入一本（最近打开的那本，否则最新添加的那本，它的书名、位置、排序和阅读位置保留）。
// 各本的页按 addLoose 规则并入（同一个文件只留一份，同名的不同图片页名加序号），书签随之改写页名，标签取并集；
// 先保存并入后的图集，再删除其余记录，中途关闭也不丢数据（下次载入再并一次，重复的页按同一规则去掉）。
async function joinLoose(list){
  const last=get('last'),keep=list.find(b=>b.id===last)??list.reduce((a,b)=>(b.added??0)>(a.added??0)?b:a),moved=[];
  for(const b of list){
    if(b===keep)continue;
    const names=await addLoose(keep,allPages(b)),have=new Set(keep.bookmarks.map(m=>m?.id));
    for(const m of b.bookmarks){if(!m||have.has(m.id))continue;if(typeof m.name==='string')m.name=names.get(m.name)??m.name;keep.bookmarks.push(m);if(m.id!=null)moved.push([b,m]);}
    keep.tags=[...new Set([...keep.tags,...b.tags])];if(keep.name==null&&b.name)keep.name=b.name;
  }
  if(sortMode(keep)!=='shuffle')keep.pages=sortedPages(keep.pages,sortMode(keep),dirOf(keep));
  delete keep.folderTime;await persist(keep);
  for(const [b,m] of moved){const th=await thumbs('get',b.id+':bm:'+m.id).catch(()=>null);if(th)await thumbs('put',th,keep.id+':bm:'+m.id);} // 书签缩略图键带书的 id（bookmarks.mjs）
  for(const b of list)if(b!==keep){books.delete(b.id);await library('delete',b.id);await dropThumbs(b.id);dropKey('pos:'+b.id);}
}
// 功能模块共用的上下文。keys：{down(e)→true 表示已处理, up(e), blur()}；settings：设置面板条目，见 settings 描述。
const listeners={};function emit(type,...args){for(const fn of listeners[type]||[])try{fn(...args);}catch(e){console.warn(e);}}
const ctx={books,get current(){return current;},get lang(){return lang;},select,step,persist,view,main,shelf,t,fmt,notice,make,icon,iconButton,safe,get,put,dropKey,flush,title,readRatio,source,
  actions,keys:[],settings:[],on(type,fn){(listeners[type]??=[]).push(fn);},emit,setLang,library,thumbs,getThumb,saveThumb,makeThumb,dropThumbs,
  orderBooks:list=>list.sort((a,b)=>natural(title(a),title(b))),matchFilter:()=>true,atEdge,ring,fade,showing,toStart,toEnd,atStart,atEnd,drawShelf(){},redrawShelf(){if(shelf.open)ctx.drawShelf();},updateProgress,toolsState,showBar:open=>showBar(open),
  expired,readingList,relink,relinkAll,rebuild,mergeKeys,relocate,looseLost,lostSources,isDown:down,discard,remove,copy,normalize,isLive,refreshAll,prefs,resetPrefs,pull};
// 设置条目：{id,group,label(文案 key),type:'toggle'|'choice'|'button',options:[{value,label|text}],get(),set(v),run()}
ctx.settings.push(
  {id:'lang',group:'general',label:'langLabel',type:'choice',options:[{value:'',label:'langAuto'},...languageList.map(v=>({value:v,text:{en:'English',zh:'中文',ja:'日本語',ko:'한국어'}[v]}))],get:()=>langPref()||'',set:v=>setLang(v)},
  {id:'autoCheck',group:'general',label:'autoCheck',type:'toggle',get:()=>get('autoCheck',true),set:v=>put('autoCheck',v)},
  {id:'edgeRight',group:'reading',label:'edgeRight',type:'toggle',get:()=>get('edgeRight',true),set:v=>put('edgeRight',v)});


try{for(const b of await library('getAll')){try{const base=snap(b),old=b.added==null;books.set(b.id,normalize(b));bases.set(b,base);if(old)persist(b);}catch(e){console.warn(e);}}}catch{notice('storage');} // 旧记录补上的添加时间写回，排序才稳定
{const albums=[...books.values()].filter(isLoose);if(albums.length>1)try{await joinLoose(albums);}catch(e){console.warn(e);}}
// features: 在这里安装功能模块，例如 bookmarks(ctx);
windows(ctx);shelfUI(ctx);settingsPanel(ctx);backup(ctx);bookmarks(ctx);focusMode(ctx);overview(ctx);helpPanel(ctx);
toolPanel(ctx);

await probeAll([...books.values()]);probed=true;
select(books.get(get('last'))||books.values().next().value);
accessState(true);(listeners.books??=[]).push(()=>accessState(false));ctx.started=true;
if(get('autoCheck',true))safe(()=>refreshAll(false))(); // 每次打开或刷新页面时检查一次已授权的文件夹
// 从旧版 v1（dist/）迁移过来时提示安装新版。
try{if(sessionStorage.getItem(prefix+'reset')){sessionStorage.removeItem(prefix+'reset');notice('resetDone');}}catch{} // 还原默认设置后的重新载入
if(new URLSearchParams(location.search).get('from')==='v1'){history.replaceState(null,'',location.pathname);notice('upgraded',undefined,10000);}
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(async reg=>{
  if(reg.active)await reg.update();
}).catch(()=>{});
navigator.serviceWorker.ready.then(()=>{$('offline').hidden=false;});}
