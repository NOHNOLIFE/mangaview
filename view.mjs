import {at,point,offsets} from './model.mjs';

// 正文、预读、预览与封面共用两个读取/解码名额。已脱离视口的排队任务不碰硬盘。
const jobs=new Map();
let running=0;
export function release(slot){
  const job=jobs.get(slot);
  if(job){job.dead=true;if(job.url)URL.revokeObjectURL(job.url);jobs.delete(slot);}
  slot.replaceChildren();
}
export function imageJob(slot,file,priority,small,ready,fail){
  const job=jobs.get(slot);
  if(job){job.priority=priority;return;}
  jobs.set(slot,{slot,file,priority,small,ready,fail});queueMicrotask(pump);
}
function pump(){
  while(running<2){
    let best;
    for(const j of jobs.values())if(!j.started && (!best||j.priority<best.priority))best=j;
    if(!best)break;
    best.started=true;running++;
    load(best).finally(()=>{running--;pump();});
  }
}
async function load(j){
  try{
    const file=await j.file();if(j.dead)return;
    const img=new Image();img.alt=file.name;img.draggable=false;
    j.url=URL.createObjectURL(file);img.src=j.url;await img.decode();if(j.dead)return;
    const w=img.naturalWidth,h=img.naturalHeight;
    if(j.small){
      const scale=Math.min(1,256/w,4096/h), canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);j.slot.replaceChildren(canvas);
      URL.revokeObjectURL(j.url);j.url=null;
    }else j.slot.replaceChildren(img);
    j.ready?.(w,h);
  }catch(e){if(!j.dead){if(j.url){URL.revokeObjectURL(j.url);j.url=null;}j.fail?.(e);}}
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
      this.previousTop=main.scrollTop;
      this.follow();this.schedule();hooks.progress();
    },{passive:true});
    for(const type of ['wheel','pointerdown'])preview.addEventListener(type,()=>{this.browsing=true;},{passive:true});
    preview.addEventListener('scroll',()=>this.schedule(),{passive:true});
    const resize=new ResizeObserver(()=>this.layout());resize.observe(main);resize.observe(preview);
  }
  clear(p){for(const el of p.slots.values())release(el);p.slots.clear();p.strip.replaceChildren();}
  show(book,anchor){
    for(const p of this.panes)this.clear(p);
    this.book=book;this.browsing=false;this.main.scrollTop=0;this.preview.scrollTop=0;this.layout(anchor||null);
  }
  anchor(){
    if(!this.book?.pages.length || this.panes[0].starts.length!==this.book.pages.length+1 || this.main.scrollTop<1)return null;
    const {i,f}=at(this.panes[0].starts,this.main.scrollTop+this.main.clientHeight/2);
    return {name:this.book.pages[i].name,f};
  }
  layout(anchor=this.anchor()){
    const nav=this.panes[1], H=this.preview.clientHeight, main=this.main;
    // 已滚到书尾时，补齐图片尺寸后仍停在书尾，“再按一次切书”才可靠。
    const end=main.scrollTop>=1 && main.scrollHeight-main.scrollTop-main.clientHeight<=1;
    if(!H)this.browsing=false;
    // 读者正在独立浏览缩略图时，补齐图片尺寸不能把导航拉回正文。
    const navPos=this.browsing && nav.starts.length>1 ? at(nav.starts,this.preview.scrollTop+H/2) : null;
    for(const [k,p] of this.panes.entries()){
      p.starts=offsets(this.book?.pages||[],Math.max(1,p.el.clientWidth),k===1||this.fit);
      p.strip.style.height=p.starts.at(-1)+'px';
    }
    const i=anchor?this.book?.pages.findIndex(p=>p.name===anchor.name):-1;
    if(i>=0)this.jump({i,f:anchor.f});else this.main.scrollTop=0;
    if(end && i>=0)main.scrollTop=main.scrollHeight;
    this.correctedTop=this.main.scrollTop;
    if(navPos)this.preview.scrollTop=point(nav.starts,navPos)-H/2;
    this.follow();this.schedule();
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
        if(!node){node=document.createElement('div');node.className='page';node.dataset.name=page.name;node.dataset.n=i+1;/* 只有缩略图悬停时显示文件名 */if(k)node.title=page.name;p.strip.append(node);slots.set(i,node);}
        node.style.top=starts[i]+'px';node.style.height=starts[i+1]-starts[i]+'px';
        if(!k && !this.fit && page.w)node.style.maxWidth=page.w+'px';else node.style.maxWidth='';
        const ahead=this.up ? i<first : i>last;
        const priority=(k?8:0)+(ahead?2:i<first||i>last?4:0);
        imageJob(node,()=>this.hooks.file(this.book,page),priority,k,(w,h)=>{
          if(page.w!==w||page.h!==h){const anchor=this.anchor();page.w=w;page.h=h;this.layout(anchor);this.hooks.measured();}
        },e=>{node.classList.add('failed');node.textContent=this.hooks.invalid()+' · '+page.name;this.hooks.error(e,page);});
      }
    }
  }
}
