import {at,point,offsets,shownName,splitTail,pageKind,videoWidth} from './model.mjs';
import {pageKey,fileStamp,pageThumb,hasPageThumb,pageStale,pageChecked,keepPageThumb,dropPage} from './thumbs.mjs';

// 正文、预读、预览与封面共用两个读取/解码名额。已脱离视口的排队任务不碰硬盘。
// 小图（缩略图栏、全屏缩略图）走 thumbs.mjs 的会话内存缓存：命中即显示、不读原图；正文解码后也顺手生成小图，
// 缩略图栏和全屏缩略图就不必为同一页再读一次硬盘。
// 浏览器的文件读取偶尔会挂起不返回：丢弃的任务立即让出名额，超时的任务按失败处理，单个文件卡住不会拖住整个队列。
const jobs=new Map(),SMALL_W=256,SMALL_H=4096;
export const limits={read:30000}; // 单张图读取 + 解码的上限（毫秒），留足机械硬盘唤醒的时间
let running=0;
function free(j){if(j.held){j.held=false;running--;queueMicrotask(pump);}}
const within=p=>{let t;return Promise.race([p,new Promise((_,no)=>{t=setTimeout(()=>no(new DOMException('','TimeoutError')),limits.read);})]).finally(()=>clearTimeout(t));};
export function release(slot){
  if(slot._dispose){const fn=slot._dispose;slot._dispose=null;fn();} // 媒体页：卸载源、释放解码器（media.mjs）
  const job=jobs.get(slot);
  if(job){job.dead=true;free(job);if(job.url)URL.revokeObjectURL(job.url);jobs.delete(slot);}
  slot.replaceChildren();
}
// key：页面缓存键（thumbs.mjs 的 pageKey），省略则不用缓存。
export function imageJob(slot,file,priority,small,ready,fail,key=null){
  const job=jobs.get(slot);
  if(job){job.priority=priority;return;}
  const j={slot,file,priority,small,ready,fail,key};jobs.set(slot,j);
  const hit=small&&key&&pageThumb(key);
  if(hit){j.started=true;show(j,hit);return;}
  queueMicrotask(pump);
}
function show(j,e){
  const img=new Image();img.alt='';img.draggable=false;img.decoding='async';img.src=e.url;j.slot.replaceChildren(img);
  queueMicrotask(()=>{if(!j.dead)j.ready?.(e.w,e.h);});
  if(pageStale(e))verify(j,e);
}
// 校验只读文件信息（不读图），单独两个名额，不占读图队列；文件变了就丢掉缓存、重新排队读图。
const checks=[];let checking=0;
function verify(j,e){if(e.checking)return;e.checking=true;checks.push([j,e]);drain();}
function drain(){
  while(checking<2&&checks.length){
    const [j,e]=checks.shift();if(j.dead){e.checking=false;continue;}checking++;
    within(Promise.resolve().then(j.file)).then(f=>{
      if(fileStamp(f)===e.stamp)pageChecked(e);
      else{dropPage(j.key);if(!j.dead){j.started=false;pump();}}
    }).catch(()=>{}).finally(()=>{e.checking=false;checking--;drain();});
  }
}
function pump(){
  while(running<2){
    let best;
    for(const j of jobs.values())if(!j.started && (!best||j.priority<best.priority))best=j;
    if(!best)break;
    best.started=best.held=true;running++;
    load(best).finally(()=>free(best));
  }
}
function shrink(img,w,h){
  const scale=Math.min(1,SMALL_W/w,SMALL_H/h), canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas;
}
function keep(key,canvas,w,h,file){const stamp=fileStamp(file);canvas.toBlob(b=>{if(b)keepPageThumb(key,b,w,h,stamp);},'image/webp',.8);}
const idle=window.requestIdleCallback?fn=>requestIdleCallback(fn,{timeout:1500}):fn=>setTimeout(fn,60);
async function load(j){
  try{await within(read(j));}
  catch(e){if(!j.dead){j.dead=true;if(j.url){URL.revokeObjectURL(j.url);j.url=null;}j.fail?.(e);}}
}
async function read(j){
  if(j.small&&j.key){const hit=pageThumb(j.key);if(hit){show(j,hit);return;}} // 排队期间正文已生成
  const file=await j.file();if(j.dead)return;
  const img=new Image();img.alt=file.name;img.draggable=false;
  j.url=URL.createObjectURL(file);img.src=j.url;await img.decode();if(j.dead)return;
  const w=img.naturalWidth,h=img.naturalHeight;
  if(j.small){
    const canvas=shrink(img,w,h);j.slot.replaceChildren(canvas);
    URL.revokeObjectURL(j.url);j.url=null;if(j.key)keep(j.key,canvas,w,h,file);
  }else{
    j.slot.replaceChildren(img);
    // 正文的图已在内存里解码：空闲时缩成小图存进缓存（只占 CPU，不读硬盘）。
    if(j.key&&!hasPageThumb(j.key)){const key=j.key;idle(()=>{if(!hasPageThumb(key))try{keep(key,shrink(img,w,h),w,h,file);}catch{}});}
  }
  j.ready?.(w,h);
}

// 文件名单行显示、中间省略：开头按宽度省略，结尾（集数、序号、扩展名）始终完整（splitTail，样式见 style.css .mid-name）。
export function midName(name){
  const el=document.createElement('span'),head=document.createElement('span'),[a,b]=splitTail(name);
  el.className='mid-name';head.textContent=a;el.append(head,b);return el;
}

export class Reader {
  constructor(main,preview,hooks){
    this.main=main;this.preview=preview;this.hooks=hooks;this.fit=true;
    this.panes=[main,preview].map(el=>({el,strip:el.firstElementChild,slots:new Map(),starts:[0]}));
    this.marker=document.createElement('div');
    this.marker.className='viewport-marker';this.marker.setAttribute('aria-hidden','true');
    main.addEventListener('scroll',()=>{
      if(main.scrollTop!==this.correctedTop){
        this.up=main.scrollTop<(this.previousTop||0);this.browsing=false;
      }
      // 用户滚动结束缩放锚定；靠近书尾时浏览器把校正后的位置夹到最大值，不算用户滚动。
      if(this.held&&Math.abs(main.scrollTop-this.correctedTop)>=1&&!(this.correctedTop>main.scrollTop&&main.scrollTop>=main.scrollHeight-main.clientHeight-1))this.held=null;
      this.previousTop=main.scrollTop;
      this.follow();this.schedule();hooks.progress();
    },{passive:true});
    for(const type of ['wheel','pointerdown'])preview.addEventListener(type,()=>{this.browsing=true;},{passive:true});
    preview.addEventListener('scroll',()=>this.schedule(),{passive:true});
    const resize=new ResizeObserver(()=>this.resized());resize.observe(main);resize.observe(preview);
    this.cap=Infinity;main.style.setProperty('--vh',main.clientHeight+'px');
  }
  // 视频的高度封顶值（阅读视窗高度）：窗口尺寸停止变化约 200ms 后才重新计算，拖动过程中占位高度不变；
  // 期间视窗变矮时，画面在原占位里按 --vh 临时等比缩小（media.css）。重算时沿用缩放锚点（held）。
  recap(){
    const h=this.main.clientHeight;if(!h||h===this.cap)return;
    const had=this.cap!==Infinity;this.cap=h;
    if(had&&this.book?.pages.some(p=>pageKind(p)==='video')){this.layout();this.paint();}
  }
  // 媒体读到帧尺寸后：与图片解码后相同，按锚点重排并保存。
  sized(page,w,h){
    if(page.w===w&&page.h===h)return;
    const anchor=this.held?this.held.anchor:this.anchor();page.w=w;page.h=h;this.layout(anchor);this.hooks.measured();
  }
  // 阅读区尺寸变化（窗口缩放、侧栏停靠或调宽、进出全屏）：视窗中心处的内容不动。
  // 一次连续缩放的锚点在开始时按变化前的视窗高度取一次，沿用到停下（约 500ms 无变化）或用户滚动，不从已经漂移的滚动位置重新推导；
  // 重排后在同一帧内重画页面位置，不留一帧"滚动位置已更新、页面还在旧位置"的画面（缩放时来回跳动的原因）。
  resized(){
    const main=this.main,top=main.scrollTop,h=this.viewH??main.clientHeight;
    if(!this.held)this.held={anchor:this.anchor(h),end:top>=1&&main.scrollHeight-top-Math.max(h,main.clientHeight)<=1};
    clearTimeout(this.heldTimer);this.heldTimer=setTimeout(()=>{this.held=null;},500);
    main.style.setProperty('--vh',main.clientHeight+'px');clearTimeout(this.capTimer);this.capTimer=setTimeout(()=>this.recap(),200);
    this.layout();this.paint();
  }
  clear(p){for(const el of p.slots.values())release(el);p.slots.clear();p.strip.replaceChildren();}
  // 正文是否还有图在排队或读取：后台生成视频画面让位于阅读（thumbs.mjs installFrames）。
  busy(){for(const j of jobs.values())if(!j.small&&!j.dead&&(!j.started||j.held))return true;return false;}
  show(book,anchor){
    for(const p of this.panes)this.clear(p);
    this.book=book;this.browsing=false;this.held=null;this.main.scrollTop=0;this.preview.scrollTop=0;this.cap=this.main.clientHeight||Infinity;this.layout(anchor||null);
  }
  anchor(h=this.main.clientHeight){
    if(!this.book?.pages.length || this.panes[0].starts.length!==this.book.pages.length+1 || this.main.scrollTop<1)return null;
    const {i,f}=at(this.panes[0].starts,this.main.scrollTop+h/2);
    return {name:this.book.pages[i].name,f};
  }
  layout(anchor=this.held?this.held.anchor:this.anchor()){
    const nav=this.panes[1], H=this.preview.clientHeight, main=this.main;
    // 已滚到书尾时，补齐图片尺寸后仍停在书尾，“再按一次切书”才可靠。
    const end=this.held?this.held.end:main.scrollTop>=1 && main.scrollHeight-main.scrollTop-main.clientHeight<=1;
    if(!H)this.browsing=false;
    // 读者正在独立浏览缩略图时，补齐图片尺寸不能把导航拉回正文。
    const navPos=this.browsing && nav.starts.length>1 ? at(nav.starts,this.preview.scrollTop+H/2) : null;
    for(const [k,p] of this.panes.entries()){
      p.starts=offsets(this.book?.pages||[],Math.max(1,p.el.clientWidth),k===1||this.fit,k?Infinity:this.cap,k===1);
      p.strip.style.height=p.starts.at(-1)+'px';
    }
    const i=anchor?this.book?.pages.findIndex(p=>p.name===anchor.name):-1;
    if(i>=0)this.jump({i,f:anchor.f});else this.main.scrollTop=0;
    if(end && i>=0)main.scrollTop=main.scrollHeight;
    this.correctedTop=this.main.scrollTop;this.viewH=main.clientHeight;
    if(navPos)this.preview.scrollTop=point(nav.starts,navPos)-H/2;
    this.follow();this.schedule();this.hooks.laid?.();
  }
  // 页码与整体进度，供页码浮标、工具栏和书架显示。
  position(){
    const n=this.book?.pages.length||0, starts=this.panes[0].starts;
    if(!n||starts.length!==n+1)return null;
    const {i}=at(starts,this.main.scrollTop+this.main.clientHeight/2), max=this.main.scrollHeight-this.main.clientHeight;
    return {i,n,ratio:max>0?Math.min(1,Math.max(0,this.main.scrollTop/max)):1};
  }
  jump(pos){this.main.scrollTop=point(this.panes[0].starts,pos)-this.main.clientHeight/2;}
  fromPreview(y){if(!this.book)return;this.browsing=false;this.jump(at(this.panes[1].starts,this.preview.scrollTop+y));this.follow();}
  follow(){
    if(!this.book?.pages.length||!this.preview.clientWidth)return;
    const [body,nav]=this.panes, top=this.main.scrollTop, H=this.main.clientHeight;
    const map=y=>point(nav.starts,at(body.starts,y));
    if(!this.browsing)this.preview.scrollTop=map(top+H/2)-this.preview.clientHeight/2;
    if(!this.marker.isConnected)nav.strip.append(this.marker);
    const start=map(top);
    this.marker.style.top=start+'px';
    this.marker.style.height=Math.max(2,map(top+H)-start)+'px';
  }
  schedule(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.paint();});}
  paint(){
    for(const [k,p] of this.panes.entries()){
      const {el,starts,slots}=p,H=el.clientHeight,top=el.scrollTop;
      if(!this.book?.pages.length||!H){if(slots.size)this.clear(p);continue;}
      const first=at(starts,top).i,last=at(starts,top+H).i;
      const lo=Math.max(0,first-1),hi=Math.min(this.book.pages.length-1,last+1);
      for(const [i,node] of slots)if(i<lo||i>hi){release(node);node.remove();slots.delete(i);}
      for(let i=lo;i<=hi;i++){
        const page=this.book.pages[i];let node=slots.get(i);
        if(!node){node=document.createElement('div');node.className='page';node.dataset.name=page.name;node.dataset.n=i+1;/* 只有缩略图悬停时显示文件名 */if(k)node.title=shownName(page);p.strip.append(node);slots.set(i,node);}
        node.style.top=starts[i]+'px';node.style.height=starts[i+1]-starts[i]+'px';
        const kind=pageKind(page);
        // 视频、音频页交给 media.mjs（hooks.media）：正文里是播放器，缩略图栏里是固定样式的占位；视频的占位上再叠真实画面（hooks.frame，持久化，只为可见项生成）。
        // visible：与视窗相交；只有它们持有媒体源，相邻页不预加载。
        if(kind!=='image'){
          node.style.maxWidth=!k&&kind==='video'?videoWidth(page,el.clientWidth,this.fit,this.cap)+'px':'';
          this.hooks.media?.(node,this.book,page,kind,k,i>=first&&i<=last);
          if(k&&kind==='video')this.hooks.frame?.(node,this.book,page,i>=first&&i<=last); // 缩略图栏里的视频叠上真实画面（thumbs.mjs installFrames）
          continue;
        }
        if(!k && !this.fit && page.w)node.style.maxWidth=page.w+'px';else node.style.maxWidth='';
        const ahead=this.up ? i<first : i>last;
        const priority=(k?8:0)+(ahead?2:i<first||i>last?4:0);
        const book=this.book;
        imageJob(node,()=>this.hooks.file(book,page),priority,k,(w,h)=>{
          if(page.w!==w||page.h!==h){const anchor=this.held?this.held.anchor:this.anchor();page.w=w;page.h=h;this.layout(anchor);this.hooks.measured();}
        },e=>{node.classList.add('failed');node.title=shownName(page);node.replaceChildren(this.hooks.invalid(),midName(shownName(page)));this.hooks.error(e,page);},pageKey(book,page));
      }
    }
  }
}
