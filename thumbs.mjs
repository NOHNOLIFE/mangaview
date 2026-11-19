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
export async function dropThumbs(bookId){forget(bookId+':');await thumbs('delete',IDBKeyRange.bound(bookId+':',bookId+':\u{ffff}'));}
