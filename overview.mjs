import {extend} from './lang.mjs';
import {imageJob,release} from './view.mjs';
// 全屏总览（默认开启，可分别关闭）：
// · 全屏缩略图：右缘，或专注模式下固定的缩略图栏；快捷键 V / ]。整本书的页面按瀑布流紧密排列，只为可见范围创建元素。
// · 全屏书架书签：左缘，或专注模式下固定的书架书签列表；快捷键 C / [。书架上各书的书签按书分组。
// 鼠标触发只在左右上角（窗口上方 30% 高度的边缘或固定栏），且必须从阅读区（中间）横向移入；
// 从顶 / 底边带、窗外进入，或在边缘 / 栏里上下移动进入上角都不触发。边缘和固定栏的下方保持原来的弹出 / 显示。
// 面板里 WASD / 方向键移动选中，空格 / Enter 或点击跳过去并关闭。
extend({
  ovSetting:['Full-screen thumbnails','全屏缩略图','全画面サムネイル','전체 화면 미리보기'],
  ovSettingHint:['Moving from the page into the top-right corner (right edge, or the pinned strip in focus mode) opens a full-screen overview','鼠标从阅读区移入右上角（右缘，或专注模式下固定的缩略图栏的上部）时，打开全屏总览','読書エリアから右上（右端、または集中モードで固定したサムネイル欄の上部）にマウスを移すと全画面の一覧を開きます','읽기 영역에서 오른쪽 위(오른쪽 가장자리 또는 집중 모드의 고정 미리보기 위쪽)로 마우스를 옮기면 전체 화면 목록을 엽니다'],
  smOvSetting:['Full-screen shelf bookmarks','全屏书架书签','全画面の本棚しおり','전체 화면 책장 책갈피'],
  smOvSettingHint:['Moving from the page into the top-left corner (left edge, or the pinned bookmark list in focus mode) opens all shelf bookmarks full screen','鼠标从阅读区移入左上角（左缘，或专注模式下固定的书架书签列表的上部）时，打开全屏书签总览','読書エリアから左上（左端、または集中モードで固定したしおり一覧の上部）にマウスを移すと全画面で表示します','읽기 영역에서 왼쪽 위(왼쪽 가장자리 또는 집중 모드의 고정 책갈피 목록 위쪽)로 마우스를 옮기면 전체 화면으로 표시합니다'],
  ovPos:['Page {n} / {m}','第 {n} / {m} 页','{n} / {m} ページ','{n} / {m} 페이지'],
  ovHint:['WASD / arrows: choose · Space / Enter: open · {key} / Esc: close','WASD / 方向键选择 · 空格 / Enter 打开 · {key} / Esc 关闭','WASD / 矢印で選択 · Space / Enter で開く · {key} / Esc で閉じる','WASD / 화살표로 선택 · Space / Enter로 열기 · {key} / Esc로 닫기']
});
const GAP=4,MIN_COL=140,MAX_RATIO=3,EDGE=24,CORNER=.3; // CORNER：触发区只在左右上角，即窗口上方 30% 高度
const ACTS={arrowleft:'left',a:'left',arrowright:'right',d:'right',arrowup:'up',w:'up',arrowdown:'down',s:'down',pageup:'pageUp',pagedown:'pageDown',home:'home',end:'end',' ':'choose',enter:'choose'};
const plain=e=>!e.ctrlKey&&!e.metaKey&&!e.altKey;
export function install(ctx){
  const {t,fmt,make,main,view}=ctx;
  const sheets=[];
  // 全屏面板外壳：标题行、滚动区、开合动画和按键分发；内容与导航由 hooks 提供。
  function sheet(id,keys,bodyClass,hooks){
    const dialog=make('dialog','overview');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'Title');
    const head=make('header','ov-head'),name=make('strong','ov-title'),pos=make('span','ov-pos'),hint=make('span','ov-hint');name.id=id+'Title';
    const shut=ctx.iconButton('close',t('close'),()=>s.close());
    const scroller=make('div','ov-scroll'),body=make('div',bodyClass);scroller.tabIndex=-1;scroller.setAttribute('role','listbox');
    scroller.append(body);head.append(name,pos,hint,shut);dialog.append(head,scroller);document.body.append(dialog);
    let closing=0;
    const s={dialog,name,pos,scroller,body,
      is:e=>plain(e)&&keys.includes(e.key.toLowerCase()),
      open(quiet=false){
        if(dialog.open||document.querySelector('dialog[open]')||!hooks.setup(quiet))return false;
        hint.textContent=fmt('ovHint',{key:keys[0].toUpperCase()});shut.title=t('close');shut.setAttribute('aria-label',t('close'));
        clearTimeout(closing);closing=0;dialog.classList.remove('closing');
        dialog.showModal();scroller.focus({preventScroll:true});hooks.show();return true;
      },
      // now：立即关闭（切换到另一个全屏面板时），否则淡出后关闭。
      close(now=false){
        if(!dialog.open)return;if(now){dialog.close();return;}if(closing)return;
        dialog.classList.add('closing');closing=setTimeout(()=>dialog.close(),140);
      }};
    dialog.addEventListener('keydown',e=>{
      if(!plain(e))return;
      if(s.is(e)){e.preventDefault();e.stopPropagation();if(!e.repeat)s.close();return;}
      const other=sheets.find(o=>o!==s&&o.is(e));
      if(other){e.preventDefault();e.stopPropagation();if(!e.repeat){s.close(true);other.open();}return;}
      const k=e.key.toLowerCase(),act=ACTS[k];
      if(!act||e.target.closest('button')&&act==='choose')return;
      e.preventDefault();e.stopPropagation();if(act==='choose'){if(!e.repeat)hooks.choose();}else hooks.move(act);
    });
    dialog.addEventListener('cancel',e=>{e.preventDefault();s.close();});
    dialog.addEventListener('close',()=>{if(dialog.open)return; /* close 事件异步派发：期间已重新打开就不清理 */clearTimeout(closing);closing=0;dialog.classList.remove('closing');hooks.cleanup();main.focus({preventScroll:true});});
    sheets.push(s);ctx.keys.push({down(e){if(!s.is(e))return false;e.preventDefault();if(!e.repeat)s.open();return true;}});
    return s;
  }

  // ---- 全屏缩略图 ----
  // 瀑布流：每张放进当前最短的一列；列宽按窗口宽度自适应。超长条图按最多 3 倍列宽截取顶部。
  let book=null,items=[],cols=[],sel=0,here=-1,frame=0,dirty=false;const nodes=new Map();
  const thumbs=sheet('overview',['v',']'],'ov-grid',{
    setup(){const b=ctx.current;if(!b?.pages.length)return false;book=b;thumbs.name.textContent=ctx.title(b);here=view.position()?.i??0;sel=here;return true;},
    show(){follow=false;layout();const it=items[sel],sc=thumbs.scroller;sc.scrollTop=it?it.y+it.h/2-sc.clientHeight/2:0;select(sel,false);paint();},
    move(act){
      const it=items[sel];
      const to={left:sel-1,right:sel+1,home:0,end:items.length-1,up:vertical(-1),down:vertical(1),pageUp:vertical(-1,true),pageDown:vertical(1,true)}[act];
      if(it)select(to);
    },
    choose(){choose(sel);},
    cleanup(){for(const i of [...nodes.keys()])drop(i);items=[];cols=[];book=null;}
  });
  const sc=thumbs.scroller,grid=thumbs.body;
  function layout(){
    const pages=book?.pages||[],W=sc.clientWidth,n=Math.max(2,Math.floor((W-GAP)/(MIN_COL+GAP))),w=(W-GAP*(n+1))/n;
    const heights=Array(n).fill(GAP);cols=Array.from({length:n},()=>[]);
    items=pages.map((p,i)=>{let c=0;for(let k=1;k<n;k++)if(heights[k]<heights[c]-.5)c=k;
      const h=Math.round(w*Math.min(MAX_RATIO,(p.h||1120)/(p.w||800))),it={x:GAP+c*(w+GAP),y:heights[c],w,h,c,r:cols[c].length};
      heights[c]+=h+GAP;cols[c].push(i);return it;});
    grid.style.height=Math.max(...heights)+'px';
    for(const [i,node] of nodes)place(node,i);
  }
  function place(node,i){const it=items[i];if(!it)return;Object.assign(node.style,{left:it.x+'px',top:it.y+'px',width:it.w+'px',height:it.h+'px'});
    // 选中放大时的原点：首 / 末列朝内，首行和比屏幕还高的朝下，末行朝上。
    const total=parseFloat(grid.style.height)||0;
    node.style.setProperty('--ox',it.c===0?'0%':it.c===cols.length-1?'100%':'50%');
    node.style.setProperty('--oy',it.y<=GAP+1||it.h>sc.clientHeight*.8?'0%':it.y+it.h>=total-GAP-1?'100%':'50%');}
  function drop(i){const node=nodes.get(i);release(node.firstChild);node.remove();nodes.delete(i);}
  function paint(){
    const top=sc.scrollTop,H=sc.clientHeight,lo=top-H*.5,hi=top+H*1.5;
    for(const i of [...nodes.keys()]){const it=items[i];if(!it||it.y+it.h<lo||it.y>hi)drop(i);}
    items.forEach((it,i)=>{
      if(it.y+it.h<lo||it.y>hi)return;
      const visible=it.y+it.h>=top&&it.y<=top+H,b=book,page=b.pages[i];let node=nodes.get(i);
      if(!node){
        node=make('div','ov-item');node.dataset.i=i;node.setAttribute('role','option');node.title=page.name;
        node.append(make('div','ov-img'),make('span','ov-n',String(i+1)));node.classList.toggle('sel',i===sel);node.classList.toggle('here',i===here);
        node.setAttribute('aria-selected',String(i===sel));place(node,i);grid.append(node);nodes.set(i,node);
      }
      // 已在队列里的只更新优先级（imageJob 对同一个槽位不会重复读取）。
      imageJob(node.firstChild,()=>view.hooks.file(b,page),visible?1:3,true,(w,h)=>{if(page.w!==w||page.h!==h){page.w=w;page.h=h;dirty=true;schedule();}},
        ()=>node.classList.add('failed'));
    });
  }
  const keep=fn=>{const it=items[sel],off=it?it.y-sc.scrollTop:0;fn();if(it&&items[sel])sc.scrollTop=items[sel].y-off;};
  // 解码后补齐的真实尺寸：总览按选中项保持位置重排，正文也一起重排（与 view.mjs 自己测量时一致）。
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(!thumbs.dialog.open)return;
    if(dirty){dirty=false;keep(layout);if(follow)reveal(sel);view.layout();view.hooks.measured();}paint();});}
  // 用键盘选中后，补齐尺寸的重排仍保证选中项完整可见；读者自己滚动后不再干预。
  let follow=false;for(const type of ['wheel','pointerdown'])sc.addEventListener(type,()=>{follow=false;},{passive:true});
  sc.addEventListener('scroll',schedule,{passive:true});
  new ResizeObserver(()=>{if(thumbs.dialog.open){keep(layout);schedule();}}).observe(sc);
  function select(i,scroll=true){
    if(!items.length)return;i=Math.max(0,Math.min(items.length-1,i));
    const old=nodes.get(sel);old?.classList.remove('sel');old?.setAttribute('aria-selected','false');sel=i;
    nodes.get(sel)?.classList.add('sel');nodes.get(sel)?.setAttribute('aria-selected','true');
    thumbs.pos.textContent=fmt('ovPos',{n:i+1,m:items.length});
    if(scroll){follow=true;reveal(i);schedule();}
  }
  // 留出放大（8%）和描边的余量。
  function reveal(i){const it=items[i];if(!it)return;const top=sc.scrollTop,H=sc.clientHeight,pad=GAP+4+it.h*.08;
    if(it.y<top+pad||it.h>H-2*pad)sc.scrollTop=it.y-pad;else if(it.y+it.h>top+H-pad)sc.scrollTop=it.y+it.h-H+pad;}
  // 上下在同一列里移动，左右按页序；Page Up / Down 在同一列跳过约一屏。
  function vertical(d,far){const it=items[sel];if(!it)return sel;const col=cols[it.c];if(!far)return col[it.r+d]??sel;
    const target=it.y+d*sc.clientHeight*.9;let k=it.r;while(col[k+d]!=null&&(d>0?items[col[k]].y<target:items[col[k]].y>target))k+=d;return col[k];}
  function choose(i){
    const b=book,s=view.panes[0].starts;thumbs.close();
    if(b&&ctx.current===b&&s.length===b.pages.length+1){view.browsing=false;main.scrollTop=s[i];}
  }
  grid.addEventListener('click',e=>{const node=e.target.closest('.ov-item');if(node)choose(+node.dataset.i);});
  ctx.on('select',()=>{if(thumbs.dialog.open&&ctx.current!==book)thumbs.close(true);});

  // ---- 全屏书架书签 ----
  // 书签缩略图都按同一比例显示，等宽网格即紧密排列；按书分组并显示书名，当前书高亮。上下按画面位置找最近的一格。
  let marks=[],msel=0;
  const sm=()=>ctx.shelfmarks;
  const shelfSheet=sheet('shelfOverview',['c','['],'ov-marks',{
    setup(quiet){const groups=sm()?.groups()||[];if(!groups.length){if(!quiet)ctx.notice(null,t('smEmpty'));return false;}
      shelfSheet.name.textContent=t('shelfmarks');shelfSheet.body.style.setProperty('--bm-ar',sm().ratio());
      marks=[];const start=sm().start();
      shelfSheet.body.replaceChildren(...groups.map(({book,items})=>{
        const sec=make('section','ov-sec'+(book===ctx.current?' current':'')),head=make('div','ov-sec-head'),list=make('div','ov-sec-grid');
        head.append(make('strong','',ctx.title(book)),make('span','',String(items.length)));sec.append(head,list);
        for(const x of items){
          const node=make('div','ov-item ov-mark'),img=make('img');img.alt='';img.draggable=false;node.dataset.k=marks.length;node.setAttribute('role','option');
          node.setAttribute('aria-label',ctx.title(book)+' · '+fmt('bmPage',{n:x.i+1}));
          ctx.getThumb(sm().thumbKey(book,x.bm)).then(th=>{if(th)img.src=th.url;else img.remove();},()=>img.remove());
          node.append(img,make('span','ov-n',String(x.i+1)));list.append(node);marks.push({book,x,node});
        }
        return sec;}));
      msel=Math.max(0,marks.findIndex(m=>m.x.bm.id===start));return true;},
    show(){mark(msel);marks[msel]?.node.scrollIntoView({block:'center'});},
    move(act){
      const to={left:msel-1,right:msel+1,home:0,end:marks.length-1,up:near(-1,0),down:near(1,0),pageUp:near(-1,1),pageDown:near(1,1)}[act];
      mark(to);marks[msel]?.node.scrollIntoView({block:'nearest'});
    },
    choose(){pick(msel);},
    cleanup(){shelfSheet.body.replaceChildren();marks=[];}
  });
  function mark(i){
    if(!marks.length)return;i=Math.max(0,Math.min(marks.length-1,i));
    marks[msel]?.node.classList.remove('sel');msel=i;const m=marks[i];
    const r=m.node.getBoundingClientRect(),g=m.node.parentElement.getBoundingClientRect();
    m.node.style.setProperty('--ox',r.left-g.left<2?'0%':g.right-r.right<2?'100%':'50%');m.node.classList.add('sel');
    shelfSheet.pos.textContent=fmt('bmN',{n:i+1,m:marks.length})+' · '+ctx.title(m.book);
  }
  // 上 / 下：方向上最近的一行里横向最近的一格；Page Up / Down 先找距约一屏处最近的一行。
  function near(d,far){
    const cur=marks[msel]?.node.getBoundingClientRect();if(!cur)return msel;
    const rects=marks.map(m=>m.node.getBoundingClientRect()),cx=r=>r.left+r.width/2;
    const ahead=rects.map((r,i)=>[r,i]).filter(([r])=>d>0?r.top>cur.top+1:r.top<cur.top-1);if(!ahead.length)return msel;
    const target=cur.top+d*(far?shelfSheet.scroller.clientHeight*.9:0);
    const row=ahead.reduce((best,[r])=>Math.abs(r.top-target)<Math.abs(best-target)?r.top:best,ahead[0][0].top);
    return ahead.filter(([r])=>Math.abs(r.top-row)<1).reduce((a,b)=>Math.abs(cx(b[0])-cx(cur))<Math.abs(cx(a[0])-cx(cur))?b:a)[1];
  }
  function pick(i){const m=marks[i];if(!m)return;shelfSheet.close();sm().go(m.book,m.x);}
  shelfSheet.body.addEventListener('click',e=>{const node=e.target.closest('.ov-mark');if(node)pick(+node.dataset.k);});

  // ---- 鼠标触发 ----
  const thumbsOn=()=>ctx.get('overview',true)!==false,marksOn=()=>ctx.get('smOverview',true)!==false;
  const panel=document.getElementById('panel'),grip=document.getElementById('grip');
  const inside=(el,x,y)=>{if(!el||el.hidden)return false;const r=el.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;};
  const corner=y=>y<=innerHeight*CORNER;let lastY=0;
  // 'right' / 'left'：左右上角的触发区（窗口边缘或专注模式下固定的栏）；'middle'：阅读区（去掉顶 / 底边带，含两侧拖宽度的把手）；其余 'other'。
  function classify(x,y){
    if(!ctx.current)return 'other';
    const cl=document.body.classList,focus=cl.contains('focus-mode'),dock=document.getElementById('shelfmarks');
    if(inside(grip,x,y)||inside(dock?.querySelector('.sm-grip'),x,y))return 'middle';
    const edgeR=innerWidth-x<=EDGE,edgeL=x<=EDGE;
    if(corner(y)){
      if(thumbsOn()&&(cl.contains('docked')?focus&&inside(panel,x,y):ctx.get('edgeRight',true)&&edgeR))return 'right';
      if(marksOn()&&(cl.contains('shelfmarks')?focus&&inside(dock,x,y):ctx.get('edgeLeft',true)&&edgeL))return 'left';
    }
    // 边缘和缩略图 / 书签栏（停靠或浮出）的其余部分不算阅读区：从这里往上移进上角不触发。
    if(edgeR||edgeL||inside(panel,x,y)||inside(dock,x,y))return 'other';
    const r=main.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top+EDGE&&y<=r.bottom-EDGE?'middle':'other';
  }
  // 没有书签时 setup 静默返回 false，不打开。
  // 固定的栏（专注模式）一进入就打开；窗口边缘停留 120ms，避免把鼠标甩出窗口时误开。
  let prev='other',dwell=0;
  document.addEventListener('pointermove',e=>{
    if(e.pointerType!=='mouse')return;
    lastY=e.clientY;const now=classify(e.clientX,e.clientY);if(now!==prev){clearTimeout(dwell);dwell=0;}
    if(now!==prev&&(now==='right'||now==='left')&&prev==='middle'&&!e.buttons&&!document.querySelector('dialog[open]')){
      const s=now==='right'?thumbs:shelfSheet,pinned=document.body.classList.contains(now==='right'?'docked':'shelfmarks');
      if(pinned)s.open(true);else dwell=setTimeout(()=>{dwell=0;if(prev===now)s.open(true);},120);
    }
    prev=now;
  },{passive:true});
  document.addEventListener('pointerout',e=>{if(!e.relatedTarget){clearTimeout(dwell);dwell=0;prev='other';}});
  // 右缘 / 左缘原本弹出的窄条：上角由这里接管（返回 true 就不再弹出），下方照旧弹出。没有书签时左缘仍弹出列表（显示空状态）。
  ctx.autoOverview=()=>thumbsOn()&&corner(lastY);
  ctx.autoShelfmarks=()=>marksOn()&&corner(lastY)&&!!sm()?.groups().length;
  ctx.overview={thumbs,shelfmarks:shelfSheet};
  ctx.settings.push({id:'overview',group:'reading',label:'ovSetting',hint:'ovSettingHint',type:'toggle',get:thumbsOn,set:v=>ctx.put('overview',!!v)},
    {id:'smOverview',group:'reading',label:'smOvSetting',hint:'smOvSettingHint',type:'toggle',get:marksOn,set:v=>ctx.put('smOverview',!!v)});
}
