import {thumbs} from '../core/store.mjs';
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

// ---- 截取视频画面：视频缩略图（缩略图栏、全屏缩略图、书架封面）、书签缩略图、自定义封面共用这一份实现。
// 浏览器无法枚举关键帧，按时间点取帧，不保证恰好是关键帧。读取元数据、定位都有上限（FRAME_MS），超时按失败处理。
// 截到的画面一律是 {blob,w,h,iw,ih,dark}（定位截取的另有 at：实际时间点），可直接 saveThumb。
export const FRAME_MS=20000;
const DARK=16; // 画面的平均亮度（0–255）低于它算「接近纯黑」
function until(el,type,ms=FRAME_MS){return new Promise((ok,no)=>{
  let timer=0;const off=()=>{clearTimeout(timer);el.removeEventListener(type,done);el.removeEventListener('error',fail);};
  const done=()=>{off();ok();},fail=()=>{off();no(new DOMException('','EncodingError'));};
  timer=setTimeout(()=>{off();no(new DOMException('','TimeoutError'));},ms);
  el.addEventListener(type,done);el.addEventListener('error',fail);
});}
// 只读元数据和定位处附近的数据（对象 URL，浏览器按需读取，不整体读进内存）；没有画面的（纯音频）按播不了处理。
async function openVideo(file){
  const el=document.createElement('video'),url=URL.createObjectURL(file);
  el.muted=true;el.preload='auto';el.playsInline=true;el.disableRemotePlayback=true;
  const close=()=>{el.removeAttribute('src');el.load();URL.revokeObjectURL(url);};
  try{const meta=until(el,'loadedmetadata');el.src=url;await meta;if(!el.videoWidth||!el.videoHeight)throw new DOMException('','EncodingError');}
  catch(e){close();throw e;}
  return {el,duration:Number.isFinite(el.duration)&&el.duration>0?el.duration:null,close};
}
// 把视频元素当前显示的画面缩小到宽 ≤ width 的 WebP：{blob,w,h,iw,ih,dark}。播放器里正停在该处的视频可直接截，不必再读文件。
export async function frameOf(el,{width=320}={}){
  const iw=el.videoWidth,ih=el.videoHeight;if(!iw||!ih||el.readyState<2)throw new DOMException('No frame','InvalidStateError');
  const scale=Math.min(1,width/iw),w=Math.max(1,Math.round(iw*scale)),h=Math.max(1,Math.round(ih*scale));
  const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(el,0,0,w,h);
  const probe=new OffscreenCanvas(16,16),g=probe.getContext('2d',{willReadFrequently:true});g.drawImage(canvas,0,0,16,16);
  const px=g.getImageData(0,0,16,16).data;let sum=0;for(let i=0;i<px.length;i+=4)sum+=px[i]*.299+px[i+1]*.587+px[i+2]*.114;
  return {blob:await canvas.convertToBlob({type:'image/webp',quality:.82}),w,h,iw,ih,dark:sum/(px.length/4)<DARK};
}
async function grab(v,seconds,width){
  const {el,duration:d}=v,s=Math.max(0,Math.min(Number.isFinite(seconds)?seconds:0,d?Math.max(0,d-.05):Infinity));
  const seek=until(el,'seeked');el.currentTime=s;await seek;
  if(el.readyState<2)await until(el,'canplay');
  return {...await frameOf(el,{width}),at:s};
}
// 取 seconds 秒处的一帧：{blob,w,h,iw,ih,at,dark}。打不开、截不到都抛出（超时为 TimeoutError）。
export async function grabFrame(file,seconds,{width=320}={}){const v=await openVideo(file);try{return await grab(v,seconds,width);}finally{v.close();}}
// 同一个文件的多个时间点一次打开截完：返回与 list 等长的数组，某个时间点截不到为 null；文件打不开、超时时抛出。
export async function grabFrames(file,list,{width=320}={}){
  const v=await openVideo(file);
  try{const out=[];for(const s of list){if(!Number.isFinite(s)){out.push(null);continue;}
    try{out.push(await grab(v,s,width));}catch(e){if(e?.name==='TimeoutError')throw e;out.push(null);}}return out;}
  finally{v.close();}
}
// 没有书签时的默认画面：片长约 10% 处，接近纯黑再试 30%、50%，至多三次；都接近纯黑时用第一张。时长未知时取开头。
export const POSTER=[.1,.3,.5];
export async function posterFrame(file,{width=320}={}){
  const v=await openVideo(file);
  try{let first=null;for(const f of v.duration?POSTER:[0]){const shot=await grab(v,(v.duration??0)*f,width);if(!shot.dark)return shot;first??=shot;}return first;}
  finally{v.close();}
}
// 用哪个画面：该视频时间最早的媒体书签（{name,t}，t 为秒），没有时为 null。来源标记（src）变了就重新生成。
export function firstMark(book,page){let m=null;for(const x of book.bookmarks||[])if(x&&x.name===page.name&&Number.isFinite(x.t)&&(!m||x.t<m.t||x.t===m.t&&x.at<m.at))m=x;return m;}
export const frameSrc=(book,page)=>{const m=firstMark(book,page);return m?'bm:'+m.id+'@'+m.t:'auto';};
export const frameKey=(book,page)=>book.id+':vt:'+page.name;

// 视频页的缩略图（缩略图栏、全屏缩略图）与封面共用一份（ctx.frames）：
// - 优先用该视频时间最早的书签的缩略图（书签模块生成，键为 ctx.marks.thumbKey）；书签还没有缩略图时按书签时间自己截一张；没有书签时用 posterFrame。
// - 生成的小图持久化在 thumbs（键 frameKey），记下生成时文件的大小 + 修改时间（stamp）和来源（src）；文件没变、来源没变就直接用。
//   本次会话第一次显示（以及窗口重新获得焦点后）只读文件信息（不读内容）校验一次。
// - 播不了、没有画面的记下当时的大小 + 修改时间（page.vfail；播放器已记为播不了的 page.bad 同样对待），文件没变就不再尝试；
//   读不到（找不到、超时）不记录，只在本次会话内不再重试。
// - 只为可见项生成；串行，在空闲、没有正在播放的媒体、正文没有在读图时进行。
export function installFrames(ctx){
  const checked=new Set(),missed=new Set(),slots=new Set(),queue=new Set();let pumping=false,chain=Promise.resolve();
  addEventListener('focus',()=>{checked.clear();});
  const markKey=(book,m)=>ctx.marks?.thumbKey?.(book,m)??book.id+':bm:'+m.id;
  const one=fn=>{const run=chain.then(fn);chain=run.catch(()=>{});return run;}; // 同一时间只解码一个视频
  const idle=()=>new Promise(r=>window.requestIdleCallback?requestIdleCallback(()=>r(),{timeout:2000}):setTimeout(r,100));
  const playing=()=>(ctx.player?.list?.()??[]).some(p=>p.state==='ready'&&!p.el.paused);
  async function calm(){for(;;){await idle();if(!playing()&&!ctx.view.busy?.())return;await new Promise(r=>setTimeout(r,800));}}
  function save(book){if(!ctx.books.has(book.id))return;if(book===ctx.current)ctx.view.hooks.measured();else ctx.safe(ctx.persist)(book);}
  const timed=p=>{let t;return Promise.race([p,new Promise((_,no)=>{t=setTimeout(()=>no(new DOMException('','TimeoutError')),FRAME_MS);})]).finally(()=>clearTimeout(t));};
  // 取得（必要时生成）画面：返回所用缩略图的键，没有画面为 null。
  async function produce(book,page){
    const src=frameSrc(book,page),m=firstMark(book,page),key=frameKey(book,page);
    if(m&&await thumbs('get',markKey(book,m)))return markKey(book,m);
    if(missed.has(key+'|'+src))return null;
    let file;try{file=await timed(Promise.resolve().then(()=>ctx.source(book,page)));}catch{missed.add(key+'|'+src);return null;}
    const stamp=fileStamp(file),rec=await thumbs('get',key);checked.add(key);
    if(rec?.blob&&rec.src===src&&rec.stamp===stamp)return key;
    if(page.vfail===stamp||page.bad===stamp){if(page.vfail!==stamp){page.vfail=stamp;save(book);}return null;}
    await calm();if(!ctx.books.has(book.id))return null;
    try{
      const shot=m?await grabFrame(file,m.t):await posterFrame(file);
      await thumbs('put',{blob:shot.blob,w:shot.w,h:shot.h,stamp,src},key);forget(key);
      if(page.vfail){delete page.vfail;save(book);}
      return key;
    }catch(e){
      if(e?.name==='TimeoutError'){missed.add(key+'|'+src);return null;}
      page.vfail=stamp;save(book);return null;
    }
  }
  // 封面用：{blob,w,h,src}，没有画面为 null。
  async function get(book,page){
    const key=await one(()=>produce(book,page));if(!key)return null;
    const rec=await thumbs('get',key);return rec?.blob?{blob:rec.blob,w:rec.w,h:rec.h,src:frameSrc(book,page)}:null;
  }
  function put(slot,th){
    const tile=slot.querySelector('.mv-tile');if(!tile)return;
    let img=tile.querySelector(':scope>img.mv-frame');
    if(!img){img=new Image();img.className='mv-frame';img.alt='';img.draggable=false;img.decoding='async';tile.prepend(img);}
    if(img.src!==th.url)img.src=th.url;tile.classList.add('framed');
  }
  async function pump(){
    if(pumping)return;pumping=true;
    try{for(;;){
      for(const s of queue)if(!s.slot.isConnected||s.slot._vf!==s)queue.delete(s);
      const s=[...queue].find(s=>s.visible);if(!s)break;queue.delete(s);
      const key=await one(async()=>{if(!s.slot.isConnected||s.slot._vf!==s)return undefined;return produce(s.book,s.page);});
      if(key===undefined||s.slot._vf!==s)continue;
      const th=key&&await getThumb(key).catch(()=>null);
      if(s.slot._vf!==s)continue;
      if(th){put(s.slot,th);s.state='shown';}else s.state='none';
    }}finally{pumping=false;}
  }
  // slot：含 .mv-tile 占位的元素；visible：与视窗相交。每次重画都可以调用，来源没变时不做任何事。
  function show(slot,book,page,visible){
    const src=frameSrc(book,page);let s=slot._vf;
    if(s&&s.book===book&&s.page===page&&s.src===src&&(s.state!=='shown'||slot.querySelector('.mv-tile.framed'))){s.visible=visible;if(visible&&s.state==='wait'){queue.add(s);pump();}return;}
    s=slot._vf={slot,book,page,src,visible,state:'load'};slots.add(slot);
    slot.querySelector('.mv-tile>img.mv-frame')?.remove();slot.querySelector('.mv-tile')?.classList.remove('framed');
    (async()=>{
      const m=firstMark(book,page),key=frameKey(book,page);
      let th=m?await getThumb(markKey(book,m)):null,fresh=!!th;
      if(!th){const rec=await thumbs('get',key);if(rec?.blob&&rec.src===src){th=await getThumb(key);fresh=checked.has(key);}}
      if(slot._vf!==s)return;
      if(th)put(slot,th);
      if(fresh||!th&&page.vfail&&checked.has(key)){s.state=th?'shown':'none';return;}
      s.state='wait';if(s.visible){queue.add(s);pump();}
    })().catch(e=>console.warn(e));
  }
  // 书签变化、别的窗口换了缩略图：重新确定受影响的格子。
  function again(test){for(const slot of [...slots]){if(!slot.isConnected){slots.delete(slot);continue;}const s=slot._vf;if(s&&test(s)){slot._vf=null;show(slot,s.book,s.page,s.visible);}}}
  ctx.on('marks',book=>again(s=>s.book===book));
  ctx.on('thumbs',keys=>again(s=>keys.some(k=>k===frameKey(s.book,s.page)||k.startsWith(s.book.id+':bm:'))));
  ctx.frames={show,get,src:frameSrc};ctx.view.hooks.frame=show;
}
