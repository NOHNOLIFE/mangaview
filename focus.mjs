// 专注模式（默认开启）：常驻的书架书签列表和停靠的缩略图栏，在没有悬停、没有键盘焦点时隐藏内容（仍占位，不收起），
// 底色换成阅读区当前画面左 / 右边缘颜色的延伸，看起来像图片向两侧铺开，减少干扰。
// 性能：渐变画在两层底图上交替淡入淡出，只动 opacity；不在根元素上写会继承的变量（那样每帧整页重算样式，连续滚动会卡）。
// 颜色按“书 + 文件名”缓存：滚动时虚拟列表回收重建图片元素也能直接取到；还没加载的图沿用上一次的颜色，不回落成黑色。
import {extend} from './lang.mjs';
import {at} from './model.mjs';
extend({focusMode:['Focus mode: side panels show their content only on hover','专注模式：侧栏只在悬停时显示内容','集中モード：サイドパネルはホバー時だけ内容を表示','집중 모드: 사이드 패널은 마우스를 올렸을 때만 내용 표시']});
const ROWS=48,STOPS=9,DIM=.85,KEEP=600,SETTLE=200; // SETTLE：滚动 / 图片插入停下 200ms 后才取色，连续滚动期间不更新；换色用 .22s 交叉淡入淡出（见 focus.css）
export function install(ctx){
  const {main,view}=ctx,body=document.body,on=()=>ctx.get('focusMode',true)!==false;
  // 色标写在用到它的侧栏上（左：书架书签列表，右：停靠的缩略图栏），侧栏没显示时不写。
  const layer=(el,cls)=>{if(!el)return null;const box=document.createElement('div'),a=document.createElement('i'),b=document.createElement('i');
    box.className='ambient';box.setAttribute('aria-hidden','true');box.append(a,b);el.prepend(box);return {cls,layers:[a,b],front:0,value:''};};
  const targets={l:layer(document.getElementById('shelfmarks'),'shelfmarks'),r:layer(document.getElementById('panel'),'docked')};
  // 新渐变画到后面那层并淡入，当前层淡出。
  function paint(side,value){const t=targets[side];if(t.value===value)return;t.value=value;
    const next=t.layers[1-t.front];next.style.backgroundImage=value;next.classList.add('on');t.layers[t.front].classList.remove('on');t.front=1-t.front;}
  const edges=new Map(); // "书 id:文件名" → {left,right}，各 ROWS 行 RGB；超过 KEEP 条时丢弃最早的
  // 左右各取宽 3% 的边缘条，缩成 1×ROWS 像素，得到沿高度变化的边缘颜色。
  function sample(book,page,img){
    const key=book.id+':'+page.name;if(edges.has(key))return edges.get(key);
    const w=img?.naturalWidth,h=img?.naturalHeight;if(!img?.complete||!w||!h)return null; // 尚未解码，不缓存
    let e=null;
    try{
      const c=new OffscreenCanvas(2,ROWS),g=c.getContext('2d',{willReadFrequently:true}),sw=Math.max(1,Math.round(w*.03));
      g.drawImage(img,0,0,sw,h,0,0,1,ROWS);g.drawImage(img,w-sw,0,sw,h,1,0,1,ROWS);
      const d=g.getImageData(0,0,2,ROWS).data;e={left:[],right:[]};
      for(let r=0;r<ROWS;r++){e.left.push(d.slice(r*8,r*8+3));e.right.push(d.slice(r*8+4,r*8+7));}
    }catch{e=null;}
    edges.set(key,e);if(edges.size>KEEP)edges.delete(edges.keys().next().value);
    return e;
  }
  const last={l:[],r:[]}; // 每个色标最近一次取到的颜色（取不到的图沿用它）
  function update(){
    frame=0;const pane=view.panes[0],s=pane.starts,book=ctx.current;
    if(!on()||!book||s.length!==book.pages.length+1)return;
    const sides=['l','r'].filter(side=>targets[side]&&body.classList.contains(targets[side].cls));if(!sides.length)return;
    for(let k=0;k<STOPS;k++){
      const {i,f}=at(s,Math.min(main.scrollTop+main.clientHeight*k/(STOPS-1),s.at(-1)-.5));
      const e=sample(book,book.pages[i],pane.slots.get(i)?.querySelector('img'));if(!e)continue; // 取不到就保留上一次的颜色
      const row=Math.min(ROWS-1,Math.floor(f*ROWS));
      for(const side of sides){
        const [r,g,b]=(side==='l'?e.left:e.right)[row],v=`rgb(${Math.round(r*DIM)} ${Math.round(g*DIM)} ${Math.round(b*DIM)})`;
        last[side][k]=v;
      }
    }
    for(const side of sides)if(last[side].some(Boolean))paint(side,`linear-gradient(${Array.from({length:STOPS},(_,k)=>`${last[side][k]||'#0a0a0c'} ${(k*100/(STOPS-1)).toFixed(1)}%`).join(',')})`);
  }
  // 防抖：每次滚动、图片插入都重新计时，停下 SETTLE 毫秒后才取色。
  let frame=0,timer=0;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{timer=0;if(!frame)frame=requestAnimationFrame(update);},SETTLE);};
  // 图片在内存里解码后才插入正文，加载事件到不了 main，所以观察 DOM 变化；换书、跳转、滚动都会重算。
  main.addEventListener('scroll',schedule,{passive:true});new MutationObserver(schedule).observe(main,{childList:true,subtree:true});
  window.addEventListener('resize',schedule);ctx.on('select',schedule);
  new MutationObserver(schedule).observe(body,{attributes:true,attributeFilter:['class']}); // 侧栏固定 / 取消固定、开关专注模式后补一次
  function apply(){document.body.classList.toggle('focus-mode',on());schedule();}
  apply();
  ctx.settings.push({id:'focusMode',group:'reading',label:'focusMode',type:'toggle',get:on,set:v=>{ctx.put('focusMode',!!v);apply();}});
}
