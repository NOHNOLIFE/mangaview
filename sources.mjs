import {isContent,unplayable,extOf,natural,fileOf,nameOrder,compareDirs,kindOf} from './model.mjs';

// 书目与源：book.sources=[{key,title,path,dir,fp?,missing?}]，每个源是一个直接包含内容（图片、视频或音频）的文件夹。
// 单文件夹书只有一个 key 为 '' 的源；合并作品（导入为单个作品）有多个源，key 为相对所选文件夹的路径，页名为“key/文件名”。
// 部分源暂时找不到时，它们的页移到 book.parked（不显示、记录保留），找回后再移回。
// 散图图集（全应用只有一本）没有源，文件句柄记在每页上；页另记 file（文件名）和 path（来自文件夹时的相对目录），允许同名图片共存（见 addLoose）。
export const allPages=book=>book.parked?.length?book.pages.concat(book.parked):book.pages;
export const keyOf=page=>page.src??'';
export const sourceOf=(book,page)=>book.sources?.find(s=>s.key===keyOf(page));
export const isMerged=book=>!!book.sources?.some(s=>s.key);
export const makePage=(key,name)=>key?{name:key+'/'+name,src:key}:{name};
export const isLoose=book=>!book.sources?.length;
// 页所在的目录，供「文件名」排序按路径比较（model.mjs nameOrder）：合并作品为卷的相对路径，散图为页记下的相对目录，单文件夹书为空。
export const dirOf=book=>{const m=new Map((book.sources??[]).map(s=>[s.key,s.path??s.key]));return p=>p.src!=null?m.get(p.src)??p.src:p.path??'';};

// 已保存的句柄可能整体失效：浏览器对它的操作挂起，既不返回也不报错（重新选择同一个文件夹得到的新句柄却正常）。
// 对已保存句柄的操作一律限时；超时的句柄记为卡住，一段时间内直接按“找不到”处理、不再等待（刷新时记为缺失，可用恢复或重新拖入接回原记录）。
// 第一次超时前留足机械硬盘唤醒的时间；出现过卡住之后，其余句柄多半同因，缩短等待。
export const limits={first:20000,next:3000,retry:60000,probe:3000};
const stuck=new WeakMap(),dead=new WeakSet();let stalled=false;
// 失效（dead）与读得慢要分开：queryPermission 不碰磁盘，正常时立即返回，它都不返回才算句柄失效，本次会话内不再重试；
// 读文件、列目录超时可能只是硬盘慢或没唤醒，只在一段时间内按找不到处理（stuck）。
export const isDead=h=>!!h&&dead.has(h);
export const isStuck=h=>!!h&&(dead.has(h)||performance.now()-(stuck.get(h)??-Infinity)<limits.retry);
export function timed(h,fn){
  if(isStuck(h))return Promise.reject(new DOMException('','TimeoutError'));
  let t;return Promise.race([fn(),new Promise((_,no)=>{t=setTimeout(()=>{stuck.set(h,performance.now());stalled=true;no(new DOMException('','TimeoutError'));},stalled?limits.next:limits.first);})]).finally(()=>clearTimeout(t));
}
// queryPermission 不碰磁盘：并行探测一批已保存的句柄，把卡住的一次标出，之后的刷新、读图不必逐个等待。
export async function probe(hs,files=[]){
  const ask=list=>Promise.all([...new Set(list)].filter(h=>h?.queryPermission&&!dead.has(h)).map(h=>{let t;return Promise.race([h.queryPermission({mode:'read'}),new Promise(r=>{t=setTimeout(()=>{dead.add(h);stalled=true;r();},limits.probe);})]).catch(()=>{}).finally(()=>clearTimeout(t));}));
  // 散图的文件句柄可能有上千个：先抽查几个，全部失效才逐个标记（同因，一起超时，不多花时间）。
  const step=Math.max(1,Math.floor(files.length/8)),sample=files.filter((_,i)=>i%step===0).slice(0,8);
  await ask([...hs,...sample]);
  if(sample.length&&sample.every(isDead))await ask(files);
}
// 文件选择器回退只在本次会话持有 File，不向浏览器存储复制原图。
const live=new WeakMap();
export async function source(book,page){
  const file=live.get(page);if(file)return file;
  const dir=sourceOf(book,page)?.dir;
  const handle=page.handle || (dir && await timed(dir,()=>dir.getFileHandle(fileOf(page))));
  if(!handle)throw new DOMException('','NotFoundError');
  return timed(dir??handle,()=>handle.getFile()); // 文件夹里的页按文件夹记卡住：同一文件夹的其他页不再逐张等待
}
// 只取元数据，串行访问避免机械硬盘被大量并发请求占满。
export async function readMissingTimes(book,active){
  for(const page of book.pages){
    if(!active())return;
    if(Number.isFinite(page.lastModified))continue;
    try{
      const {lastModified}=await source(book,page);
      if(!active())return;
      page.lastModified=lastModified;
    }
    catch(e){
      if(sourceOf(book,page)?.dir && e.name==='NotAllowedError' || e.name==='TimeoutError')break;
      if(!['NotAllowedError','NotFoundError','NotReadableError','SecurityError'].includes(e.name))throw e;
    }
  }
}
function pageFor(file){const p={name:file.name,lastModified:file.lastModified};live.set(p,file);return p;}
const ordered=pages=>pages.sort(nameOrder());
const loosePage=(path,file,extra)=>path?{name:path+'/'+file,path,file,...extra}:{name:file,...extra};
// 导入时浏览器播不了的媒体文件（按扩展名）不建记录，只计数，导入结果里提示：odd 为 skipped() 返回的计数器，省略则不计。
// 只看文件名：非内容文件和不支持的文件除了列目录本身不产生任何读盘。
export const skipped=()=>({n:0,exts:new Set()});
const skip=(odd,name)=>{if(odd&&unplayable(name)){odd.n++;odd.exts.add(extOf(name));}};
// path：从所选根目录起的相对路径，用于区分同名文件夹和恢复过期书（浏览器拿不到磁盘绝对路径）。
export async function* scan(dir,base='',odd=null){
  const path=base?base+'/'+dir.name:dir.name;
  const pages=[],children=[];
  for await(const h of dir.values()){
    if(h.kind==='directory')children.push(h);else if(isContent(h.name))pages.push({name:h.name});else skip(odd,h.name);
  }
  if(pages.length)yield {title:dir.name,dir,path,pages:ordered(pages)};
  for(const child of children)yield* scan(child,path,odd);
}
// 刷新用：只列目录，返回内容文件名；找不到、句柄卡住或没有内容时为 'gone'，没有权限为 'denied'。不支持的文件不提示、不读取。
export async function listDir(dir,ask){
  try{
    let state=dir.queryPermission?await timed(dir,()=>dir.queryPermission({mode:'read'})):'granted';
    if(state==='prompt'&&ask)state=await dir.requestPermission({mode:'read'}).catch(()=>'prompt');
    if(state!=='granted')return 'denied';
    const names=[],it=dir.values();
    for(;;){const r=await timed(dir,()=>it.next());if(r.done)break;if(r.value.kind==='file'&&isContent(r.value.name))names.push(r.value.name);}
    return names.length?names:'gone';
  }catch(e){if(['NotFoundError','TimeoutError'].includes(e.name))return 'gone';if(['NotAllowedError','SecurityError'].includes(e.name))return 'denied';throw e;}
}
// 扩展名认不出的图片（type 为 image/*）照旧收下；媒体只认扩展名（不支持的格式也有 video/* 之类的 type）。
const accepted=f=>isContent(f.name)||!unplayable(f.name)&&f.type.startsWith('image/');
export function fileGroups(files,odd=null){
  const groups=new Map();
  for(const f of files){
    if(!accepted(f)){skip(odd,f.name);continue;}
    const path=f.webkitRelativePath?.split('/').slice(0,-1).join('/')||'';
    if(!groups.has(path))groups.set(path,[]);groups.get(path).push(pageFor(f));
  }
  return Array.from(groups,([path,pages])=>({title:path.split('/').pop()||null,...path&&{path},pages:ordered(pages)}));
}
export async function* handleGroups(handles,odd=null){
  const loose=[];
  for(const h of handles){if(h.kind==='directory')yield* scan(h,'',odd);else if(isContent(h.name))loose.push({name:h.name,handle:h});else skip(odd,h.name);}
  if(loose.length)yield {title:null,pages:ordered(loose)};
}
// 拖到「添加到散图图集」：所有图片、视频、音频（包括文件夹里的，递归）合成一组散图（title 为 null，归入散图图集）。
// 来自文件夹的图记下相对目录（如“卷1”），页名为“卷1/001.jpg”，按名称排序时按文件夹聚在一起。
export async function looseImages(handles,odd=null){
  const pages=[];
  async function walk(dir,base){for await(const h of dir.values()){if(h.kind==='directory')await walk(h,base+'/'+h.name);else if(isContent(h.name))pages.push(loosePage(base,h.name,{handle:h}));else skip(odd,h.name);}}
  for(const h of handles){if(h.kind==='directory')await walk(h,h.name);else if(isContent(h.name))pages.push({name:h.name,handle:h});else skip(odd,h.name);}
  return pages.length?[{title:null,pages:ordered(pages)}]:[];
}
// 同上，用于不支持文件句柄的浏览器（只有本次会话的 File）。记下大小，供去重时比较。
export function looseFiles(files,odd=null){
  const pages=fileGroups(files,odd).flatMap(g=>g.pages.map(p=>{if(g.path)Object.assign(p,loosePage(g.path,p.name));p.size=live.get(p).size;return p;}));
  return pages.length?[{title:null,pages:ordered(pages)}]:[];
}
// 加入散图图集。同一个文件只保留一份：都有句柄时用 isSameEntry 判断（只比较同名、且相对目录一个是另一个末尾几段的页，
// 同一个文件经由不同的上级文件夹拖入时就是这样）；否则要求相对目录、文件名、修改时间相同（大小已知时也要相同）。
// 已有的那页接上新的句柄或本次会话的文件（这也是备份导入后重新拖入散图即可恢复的方式）；只是同名的不同图片两张都保留，页名加序号区分。
// 只比较句柄和元数据，不读图片内容。传入的页对象本身放进图集（回退模式下与本次会话的 File 绑定）。返回 Map(原页名 → 图集中的页名)。
const sameEntry=async(a,b)=>a===b||!!a.isSameEntry&&await timed(a,()=>a.isSameEntry(b)).catch(()=>false);
const related=(a='',b='')=>!a||!b||a===b||a.endsWith('/'+b)||b.endsWith('/'+a);
async function meta(p){const f=live.get(p)??(p.handle?await timed(p.handle,()=>p.handle.getFile()).catch(()=>null):null);return f?{size:f.size,lastModified:f.lastModified}:p;}
export async function addLoose(book,pages){
  const byFile=new Map(),names=new Set(),out=new Map();
  const index=p=>{const k=fileOf(p);if(!byFile.has(k))byFile.set(k,[]);byFile.get(k).push(p);names.add(p.name);};
  for(const p of allPages(book))index(p);
  for(const p of pages){
    const old=p.name,file=fileOf(p);let same=null,mine=null;
    for(const q of byFile.get(file)??[]){
      if(!related(q.path,p.path))continue;
      if(q.handle&&p.handle){if(await sameEntry(q.handle,p.handle)){same=q;break;}continue;}
      if((q.path??'')!==(p.path??''))continue;
      mine??=await meta(p);const theirs=await meta(q);
      if(Number.isFinite(mine.lastModified)&&mine.lastModified===theirs.lastModified&&(mine.size==null||theirs.size==null||mine.size===theirs.size)){same=q;break;}
    }
    if(same){if(p.handle)same.handle=p.handle;if(live.has(p))live.set(same,live.get(p));out.set(old,same.name);continue;}
    const base=(p.path?p.path+'/':'')+file;let name=base;for(let n=2;names.has(name);n++)name=base+' ('+n+')';
    if(name!==file)p.file=file;p.name=name;index(p);book.pages.push(p);out.set(old,name);
  }
  return out;
}
// 旧版散图的页名就是“相对目录/文件名”：载入时补上 file 和 path，页名（书签、阅读位置依赖它）不变。
export function looseNames(book){
  if(!isLoose(book))return;
  for(const p of allPages(book))if(p?.file==null&&typeof p?.name==='string'&&p.name.includes('/')){const i=p.name.lastIndexOf('/');p.path=p.name.slice(0,i);p.file=p.name.slice(i+1);}
}
// 导入为单个作品：给扫描出的各个文件夹排定顺序和 key。只选了一个文件夹时 key 为相对它的路径（它本身的图用它的名称），
// 选了多个时带上各自的名称；按路径逐段自然排序（与「文件名」排序相同），父文件夹自己的图排在子文件夹之前。返回 [{group,key}]。
export function mergeKeys(groups){
  const list=[...groups].sort((a,b)=>compareDirs(a.path??'',b.path??''));
  const one=new Set(list.map(g=>(g.path??'').split('/')[0])).size===1,seen=new Set();
  return list.map(g=>{
    const parts=(g.path??g.title??'').split('/');let key=(one?parts.slice(1).join('/'):parts.join('/'))||g.title||'images',k=key;
    for(let n=2;seen.has(k);n++)k=key+' ('+n+')';
    seen.add(k);return {group:g,key:k};
  });
}
// 按某个源的最新文件列表更新页表：保留仍存在的页（尺寸等），追加新图，去掉已不存在的图。
// reset：重新关联文件夹时清掉旧的修改时间，按需重新读取。
export function applyNames(book,s,names,reset=false){
  const now=new Set(names),old=new Set(),total=allPages(book).length;
  const keep=p=>{if(keyOf(p)!==s.key)return true;const f=fileOf(p);if(!now.has(f)||old.has(f))return false;old.add(f);if(reset)delete p.lastModified;return true;};
  book.pages=book.pages.filter(keep);if(book.parked)book.parked=book.parked.filter(keep);
  const fresh=[...now].filter(n=>!old.has(n)).sort(natural).map(n=>makePage(s.key,n));
  book.pages.push(...fresh);
  return {added:fresh.length,removed:total+fresh.length-allPages(book).length};
}
// 源是否暂时不可用：刷新时找不到、句柄卡住，或者既没有目录句柄、也没有本次会话的文件（如从备份导入）。
export const down=(book,s)=>!!s.missing||isStuck(s.dir)||!s.dir&&!allPages(book).some(p=>keyOf(p)===s.key&&(p.handle||live.has(p)));
// 部分源找不到时，把它们的页移到 parked；全部找不到（整本书过期）或全部可用时页面原样保留。返回可见页是否有变化。
export function settle(book){
  const gone=new Set(book.sources.filter(s=>down(book,s)).map(s=>s.key));
  const partial=gone.size>0&&gone.size<book.sources.length,all=allPages(book),n=book.pages.length;
  const out=partial?all.filter(p=>gone.has(keyOf(p))):[];
  book.pages=out.length?all.filter(p=>!gone.has(keyOf(p))):all;
  if(out.length)book.parked=out;else delete book.parked;
  return book.pages.length!==n;
}
// 本次会话里是否还持有文件选择器给的 File（无句柄的书重启后即失效）。
export const isLive=book=>book.pages.some(p=>live.has(p));
// 散图按“相对目录 + 文件名”重新定位。候选来自用户选的文件夹（looseImages，目录从所选文件夹的名称算起）：
// 目录相同最优先；其次是选了原文件夹的上级（原目录是候选目录的末尾几段），或选了原文件夹里的子文件夹（反过来）；
// 没有目录的散图只认所选文件夹里直接放着的图；在子目录里的，要修改时间也相同、或整个所选文件夹里只有这一个同名文件才认。重合越多越优先，同分时优先修改时间相同的；每个文件只配一页，配不上的不动。
// 媒体文件（视频、音频）记下了大小（page.size）的，还要求大小一致（候选的大小见 mediaSizes）。
const isMediaName=name=>{const k=kindOf(name);return k==='video'||k==='audio';};
function looseMatch(pages,cands){
  const byFile=new Map();for(const c of cands){const k=fileOf(c);if(!byFile.has(k))byFile.set(k,[]);byFile.get(k).push(c);}
  const fit=(a='',b='')=>a===b?3:!a?(b.includes('/')?0:1):b.endsWith('/'+a)?2:b&&a.endsWith('/'+b)?1:0,pairs=[];
  for(const p of pages){const same=byFile.get(fileOf(p))??[],sized=Number.isFinite(p.size)&&isMediaName(fileOf(p));for(const c of same){if(sized&&c.size!==p.size)continue;const time=Number.isFinite(p.lastModified)&&p.lastModified===c.lastModified,s=fit(p.path,c.path)||(!p.path&&(time||same.length===1)?.25:0);if(s)pairs.push({p,c,s:s*2+time});}}
  pairs.sort((x,y)=>y.s-x.s);
  const usedP=new Set(),usedC=new Set(),out=[];
  for(const {p,c} of pairs)if(!usedP.has(p)&&!usedC.has(c)){usedP.add(p);usedC.add(c);out.push([p,c]);}
  return out;
}
// 散图图集定位前：给与记录里已知大小的媒体页同名的候选补上大小（只读文件元数据，不读内容），looseMatch 据此要求大小一致。
export async function mediaSizes(book,group){
  const want=new Set(allPages(book).filter(p=>Number.isFinite(p.size)&&isMediaName(fileOf(p))).map(fileOf));
  for(const c of group?.pages??[])if(c.size==null&&want.has(fileOf(c))){const f=live.get(c)??(c.handle?await timed(c.handle,()=>c.handle.getFile()).catch(()=>null):null);if(f)c.size=f.size;}
}
// s：要重新绑定的源（散图图集为 undefined，按 looseMatch 匹配）。
export function reconnect(book,group,s=book.sources?.[0]){
  // 只重绑定同名条目，不用选错的目录覆盖原来的历史或随机顺序。
  const byName=new Map(group.pages.map(p=>[p.name,p]));
  const pairs=s?allPages(book).filter(p=>keyOf(p)===s.key).map(p=>[p,byName.get(fileOf(p))]).filter(x=>x[1]):looseMatch(allPages(book),group.pages);
  for(const [p,fresh] of pairs){
    if(live.has(fresh))live.set(p,live.get(fresh));else live.delete(p);
    if(fresh.handle)p.handle=fresh.handle;else delete p.handle;
    p.lastModified=fresh.lastModified;
  }
  if(pairs.length && group.dir && s){s.dir=group.dir;delete s.missing;}
  return pairs.length;
}
