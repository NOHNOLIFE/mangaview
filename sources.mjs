import {isImage,natural} from './model.mjs';

// 文件选择器回退只在本次会话持有 File，不向浏览器存储复制原图。
const live=new WeakMap();
export async function source(book,page){
  const file=live.get(page);if(file)return file;
  const handle=page.handle || (book.dir && await book.dir.getFileHandle(page.name));
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
      if(book.dir && e.name==='NotAllowedError')break;
      if(!['NotAllowedError','NotFoundError','NotReadableError','SecurityError'].includes(e.name))throw e;
    }
  }
}
function pageFor(file){const p={name:file.name,lastModified:file.lastModified};live.set(p,file);return p;}
const ordered=pages=>pages.sort((a,b)=>natural(a.name,b.name));
export async function* scan(dir){
  const pages=[],children=[];
  for await(const h of dir.values()){
    if(h.kind==='directory')children.push(h);else if(isImage(h.name))pages.push({name:h.name});
  }
  if(pages.length)yield {title:dir.name,dir,pages:ordered(pages)};
  for(const child of children)yield* scan(child);
}
export function fileGroups(files){
  const groups=new Map();
  for(const f of files){
    if(!isImage(f.name) && !f.type.startsWith('image/'))continue;
    const path=f.webkitRelativePath?.split('/').slice(0,-1).join('/')||'';
    if(!groups.has(path))groups.set(path,[]);groups.get(path).push(pageFor(f));
  }
  return Array.from(groups,([path,pages])=>({title:path.split('/').pop()||null,pages:ordered(pages)}));
}
export async function* handleGroups(handles){
  const loose=[];
  for(const h of handles){if(h.kind==='directory')yield* scan(h);else if(isImage(h.name))loose.push({name:h.name,handle:h});}
  if(loose.length)yield {title:null,pages:ordered(loose)};
}
export function reconnect(book,group){
  // 只重绑定同名条目，不用选错的目录覆盖原来的历史或随机顺序。
  const byName=new Map(group.pages.map(p=>[p.name,p]));let count=0;
  for(const p of book.pages){const fresh=byName.get(p.name);if(!fresh)continue;
    if(live.has(fresh))live.set(p,live.get(fresh));else live.delete(p);
    if(fresh.handle)p.handle=fresh.handle;else delete p.handle;
    p.lastModified=fresh.lastModified;
    count++;
  }
  if(count && group.dir)book.dir=group.dir;
  return count;
}
