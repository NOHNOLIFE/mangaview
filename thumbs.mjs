import {thumbs} from './store.mjs';
// 缩略图只存压缩后的 WebP（默认宽 320px），不复制原图：书架瀑布流、过期书和书签都不必再读原图。
// 用 <img> 解码而不是 createImageBitmap，后者在 Chrome 中不支持 SVG Blob。
export async function makeThumb(blob,{width=320,crop=null}={}){
  const url=URL.createObjectURL(blob);
  try{
    const img=new Image();img.src=url;await img.decode();
    const sx=crop?.x??0, sy=crop?.y??0, sw=crop?.w??img.naturalWidth, sh=crop?.h??img.naturalHeight;
    const scale=Math.min(1,width/sw), w=Math.max(1,Math.round(sw*scale)), h=Math.max(1,Math.round(sh*scale));
    const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,w,h);
    return {blob:await canvas.convertToBlob({type:'image/webp',quality:.82}),w,h,iw:img.naturalWidth,ih:img.naturalHeight};
  }finally{URL.revokeObjectURL(url);}
}
const cache=new Map();
// 返回 {url,w,h}；没有缓存时为 null。对象 URL 在 forget 时释放。
export async function getThumb(key){
  if(cache.has(key))return cache.get(key);
  const rec=await thumbs('get',key);if(!rec)return null;
  const out={url:URL.createObjectURL(rec.blob),w:rec.w,h:rec.h};cache.set(key,out);return out;
}
export async function saveThumb(key,{blob,w,h}){await thumbs('put',{blob,w,h},key);forget(key);}
export function forget(prefix){for(const [k,v] of cache)if(k===prefix||k.startsWith(prefix)){URL.revokeObjectURL(v.url);cache.delete(k);}}
export async function dropThumbs(bookId){forget(bookId+':');forgetPages(bookId+':');await thumbs('delete',IDBKeyRange.bound(bookId+':',bookId+':\u{ffff}'));}

// 页面小图（缩略图栏与全屏缩略图共用）：会话级内存缓存，不写 IndexedDB，关闭应用即清空。
// 每项是缩小到宽 ≤256px 的 WebP Blob（漫画页约 10–40KB），按字节 LRU 封顶 PAGE_BYTES；不缓存原尺寸位图。
// 键按页对象标识生成（同一会话里页对象在排序、刷新后保留），不依赖文件名，多文件夹的书也不会串图。
// stamp 是生成时文件的 lastModified + size；窗口重新获得焦点后（可能在别处改过文件），每项下次显示时校验一次。
const PAGE_BYTES=64*1024*1024,pageIds=new WeakMap(),pages=new Map();let pageBytes=0,nextPage=0,epoch=0;
addEventListener('focus',()=>{epoch++;});
export function pageKey(book,page){let id=pageIds.get(page);if(id==null)pageIds.set(page,id=++nextPage);return book.id+':'+id;}
export const fileStamp=file=>file.lastModified+':'+file.size;
// 命中时移到最近使用的一端；对象 URL 首次显示时才创建。
export function pageThumb(key){const e=pages.get(key);if(!e)return null;pages.delete(key);pages.set(key,e);e.url??=URL.createObjectURL(e.blob);return e;}
export const hasPageThumb=key=>pages.has(key);
export const pageStale=e=>e.epoch!==epoch;
export function pageChecked(e){e.epoch=epoch;}
export function keepPageThumb(key,blob,w,h,stamp){
  dropPage(key);pages.set(key,{blob,w,h,stamp,epoch,url:null});pageBytes+=blob.size;
  for(const k of pages.keys()){if(pageBytes<=PAGE_BYTES)break;dropPage(k);}
}
// 对象 URL 延后释放：刚设给 <img> 还没加载完的不会失效。
export function dropPage(key){const e=pages.get(key);if(!e)return;pages.delete(key);pageBytes-=e.blob.size;if(e.url)setTimeout(URL.revokeObjectURL,10000,e.url);}
export function forgetPages(prefix){for(const k of [...pages.keys()])if(k.startsWith(prefix))dropPage(k);}
export const pageCacheSize=()=>({count:pages.size,bytes:pageBytes});
