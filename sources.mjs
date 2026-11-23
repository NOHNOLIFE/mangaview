import {isImage,natural,fileOf} from './model.mjs';

// 书目与源：book.sources=[{key,title,path,dir,fp?,missing?}]，每个源是一个直接包含图片的文件夹。
// 单文件夹书只有一个 key 为 '' 的源；合并作品（导入为单个作品）有多个源，key 为相对所选文件夹的路径，页名为“key/文件名”。
// 部分源暂时找不到时，它们的页移到 book.parked（不显示、记录保留），找回后再移回。散图没有源，文件句柄记在每页上。
export const allPages=book=>book.parked?.length?book.pages.concat(book.parked):book.pages;
export const keyOf=page=>page.src??'';
export const sourceOf=(book,page)=>book.sources?.find(s=>s.key===keyOf(page));
export const isMerged=book=>!!book.sources?.some(s=>s.key);
export const makePage=(key,name)=>key?{name:key+'/'+name,src:key}:{name};

// 文件选择器回退只在本次会话持有 File，不向浏览器存储复制原图。
const live=new WeakMap();
export async function source(book,page){
  const file=live.get(page);if(file)return file;
  const dir=sourceOf(book,page)?.dir;
  const handle=page.handle || (dir && await dir.getFileHandle(fileOf(page)));
  if(!handle)throw new DOMException('','NotFoundError');
  return handle.getFile();
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
      if(sourceOf(book,page)?.dir && e.name==='NotAllowedError')break;
      if(!['NotAllowedError','NotFoundError','NotReadableError','SecurityError'].includes(e.name))throw e;
    }
  }
}
function pageFor(file){const p={name:file.name,lastModified:file.lastModified};live.set(p,file);return p;}
const ordered=pages=>pages.sort((a,b)=>natural(a.name,b.name));
// path：从所选根目录起的相对路径，用于区分同名文件夹和恢复过期书（浏览器拿不到磁盘绝对路径）。
export async function* scan(dir,base=''){
  const path=base?base+'/'+dir.name:dir.name;
  const pages=[],children=[];
  for await(const h of dir.values()){
    if(h.kind==='directory')children.push(h);else if(isImage(h.name))pages.push({name:h.name});
  }
  if(pages.length)yield {title:dir.name,dir,path,pages:ordered(pages)};
  for(const child of children)yield* scan(child,path);
}
// 刷新用：只列目录，返回图片文件名；找不到或没有图片时为 'gone'，没有权限为 'denied'。
export async function listDir(dir,ask){
  let state=await dir.queryPermission?.({mode:'read'})??'granted';
  if(state==='prompt'&&ask)state=await dir.requestPermission({mode:'read'}).catch(()=>'prompt');
  if(state!=='granted')return 'denied';
  const names=[];
  try{for await(const h of dir.values())if(h.kind==='file'&&isImage(h.name))names.push(h.name);}
  catch(e){if(e.name==='NotFoundError')return 'gone';if(['NotAllowedError','SecurityError'].includes(e.name))return 'denied';throw e;}
  return names.length?names:'gone';
}
export function fileGroups(files){
  const groups=new Map();
  for(const f of files){
    if(!isImage(f.name) && !f.type.startsWith('image/'))continue;
    const path=f.webkitRelativePath?.split('/').slice(0,-1).join('/')||'';
    if(!groups.has(path))groups.set(path,[]);groups.get(path).push(pageFor(f));
  }
  return Array.from(groups,([path,pages])=>({title:path.split('/').pop()||null,...path&&{path},pages:ordered(pages)}));
}
export async function* handleGroups(handles){
  const loose=[];
  for(const h of handles){if(h.kind==='directory')yield* scan(h);else if(isImage(h.name))loose.push({name:h.name,handle:h});}
  if(loose.length)yield {title:null,pages:ordered(loose)};
}
// 导入为单个作品：给扫描出的各个文件夹排定顺序和 key。只选了一个文件夹时 key 为相对它的路径（它本身的图用它的名称），
// 选了多个时带上各自的名称；按路径自然排序，父文件夹自己的图排在子文件夹之前。返回 [{group,key}]。
export function mergeKeys(groups){
  const list=[...groups].sort((a,b)=>natural(a.path??'',b.path??''));
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
// 源是否暂时不可用：刷新时找不到，或者既没有目录句柄、也没有本次会话的文件（如从备份导入）。
export const down=(book,s)=>!!s.missing||!s.dir&&!allPages(book).some(p=>keyOf(p)===s.key&&(p.handle||live.has(p)));
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
// s：要重新绑定的源（散图书为 undefined，按所有页匹配）。
export function reconnect(book,group,s=book.sources?.[0]){
  // 只重绑定同名条目，不用选错的目录覆盖原来的历史或随机顺序。
  const byName=new Map(group.pages.map(p=>[p.name,p]));let count=0;
  for(const p of allPages(book)){if(s&&keyOf(p)!==s.key)continue;const fresh=byName.get(fileOf(p));if(!fresh)continue;
    if(live.has(fresh))live.set(p,live.get(fresh));else live.delete(p);
    if(fresh.handle)p.handle=fresh.handle;else delete p.handle;
    p.lastModified=fresh.lastModified;
    count++;
  }
  if(count && group.dir && s){s.dir=group.dir;delete s.missing;}
  return count;
}
