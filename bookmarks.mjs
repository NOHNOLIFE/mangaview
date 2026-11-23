import {extend} from './lang.mjs';
import {at,point} from './model.mjs';
import {forget} from './thumbs.mjs';
// 书签：book.bookmarks=[{id,name,f,at}]，按图片文件名定位，重新排序后仍有效。缩略图存在 thumbs store 的 `${book.id}:bm:${id}`。
extend({
  bmAdd:['Add bookmark','添加书签','しおりを追加','책갈피 추가'],bmHold:['Hold','长按','長押し','길게'],
  bmEmpty:['No bookmarks yet','还没有书签','しおりはまだありません','아직 책갈피가 없습니다'],
  bmNone:['No bookmarks yet — hold G or Enter to add one','还没有书签，长按 G 或 Enter 添加','しおりはまだありません。G か Enter を長押しで追加','아직 책갈피가 없습니다. G 또는 Enter를 길게 눌러 추가하세요'],
  bmAllGone:['The bookmarked images no longer exist','书签所在的图片都已不存在','しおりの画像が見つかりません','책갈피한 이미지가 더 이상 없습니다'],
  bmAdded:['Bookmark added','已添加书签','しおりを追加しました','책갈피를 추가했습니다'],
  bmExists:['There is already a bookmark here','这里已有书签','ここにはすでにしおりがあります','여기에 이미 책갈피가 있습니다'],
  bmKeep:['Keep holding to add a bookmark','继续按住添加书签','押し続けるとしおりを追加','계속 누르면 책갈피 추가'],
  bmN:['Bookmark {n} / {m}','书签 {n} / {m}','しおり {n} / {m}','책갈피 {n} / {m}'],
  bmWrap:['Back to the first bookmark','已回到第一个书签','最初のしおりに戻りました','첫 번째 책갈피로 돌아왔습니다'],
  bmPage:['Image {n}','第 {n} 张','{n} 枚目','{n}번째'],bmGone:['Image missing','图片已不存在','画像なし','이미지 없음'],
  bmDelete:['Delete bookmark','删除书签','しおりを削除','책갈피 삭제'],
  smEmpty:['No bookmarks on the shelf yet — hold G or Enter while reading to add one','书架上还没有书签，阅读时长按 G 或 Enter 添加','本棚にしおりはまだありません。読書中に G か Enter を長押しで追加','책장에 아직 책갈피가 없습니다. 읽는 중에 G 또는 Enter를 길게 눌러 추가하세요'],
  smEdgeLeft:['Show shelf bookmarks at the left edge (when not pinned)','书架书签未常驻时，鼠标移到左缘弹出','本棚のしおりを固定していないとき、左端で表示','책장 책갈피를 고정하지 않았을 때 왼쪽 가장자리에서 표시'],
  smWidth:['Bookmark list width','书签列表宽度','しおり一覧の幅','책갈피 목록 너비']
});
const SHOW=150,ADD=550,EDGE=32,DWELL=150,MIN_W=160; // EDGE / DWELL / MIN_W：与右侧缩略图栏（app.mjs）一致
export function install(ctx){
  const {main,view,t,fmt,notice,make,icon}=ctx;
  const sprite=document.querySelector('svg.sprite'),mark='M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z';
  if(sprite&&!document.getElementById('i-bookmark'))sprite.insertAdjacentHTML('beforeend',`<symbol id="i-bookmark" viewBox="0 0 24 24"><path d="${mark}"/></symbol><symbol id="i-bookmark-plus" viewBox="0 0 24 24"><path d="${mark}"/><path d="M12 7v6M9 10h6"/></symbol>`);
  const key=(book,bm)=>book.id+':bm:'+bm.id;
  function starts(){const s=view.panes[0].starts,b=ctx.current;return b?.pages.length&&s.length===b.pages.length+1?s:null;}
  // 屏幕中心所在的图与图内位置（view.anchor() 在书首返回 null，这里不能用）。
  function here(){const s=starts();if(!s)return null;const {i,f}=at(s,main.scrollTop+main.clientHeight/2);return {i,f,name:ctx.current.pages[i].name,h:s[i+1]-s[i]};}
  // 按当前页序排列；文件名已不存在的排在最后，i 为 -1。
  function list(book){const pos=new Map(book.pages.map((p,i)=>[p.name,i]));
    return (book.bookmarks||[]).map(bm=>({bm,i:pos.get(bm.name)??-1})).sort((a,b)=>(a.i<0)-(b.i<0)||a.i-b.i||a.bm.f-b.bm.f||a.bm.at-b.bm.at);}
  let last=null; // 最近一次跳到的书签：滚动位置被夹住（书首 / 书尾）时仍能接着跳下一个。
  function go(x){view.jump({i:x.i,f:x.bm.f});last={id:x.bm.id,top:main.scrollTop,book:ctx.current};markDock();}
  const repeat=book=>last&&last.book===book&&Math.abs(main.scrollTop-last.top)<2;
  function next(){
    const book=ctx.current;if(!book)return;
    if(!book.bookmarks?.length){notice(null,t('bmNone'));return;}
    const valid=list(book).filter(x=>x.i>=0),s=starts();if(!valid.length){notice('bmAllGone');return;}if(!s)return;
    let k=repeat(book)?valid.findIndex(x=>x.bm.id===last.id):-1;
    if(k>=0)k++;else{const y=main.scrollTop+main.clientHeight/2;k=valid.findIndex(x=>point(s,{i:x.i,f:x.bm.f})>y+2);}
    const wrap=k<0||k>=valid.length;if(wrap)k=0;
    go(valid[k]);notice(null,wrap?t('bmWrap'):fmt('bmN',{n:k+1,m:valid.length}));
  }
  // 缩略图：截取屏幕中心所在那张图、以中心为准、与视口等比例的区域，换算到原图像素。
  async function snap(book,bm,page,p,vw,vh){
    let crop=null;
    if(page.w&&page.h){const s=page.h/p.h,k=Math.min(1,page.w/(vw*s),page.h/(vh*s)),w=vw*s*k,h=vh*s*k;
      crop={x:Math.round((page.w-w)/2),y:Math.round(Math.min(page.h-h,Math.max(0,p.f*page.h-h/2))),w:Math.round(w),h:Math.round(h)};}
    const thumb=await ctx.makeThumb(await ctx.source(book,page),{width:240,crop});
    if(!book.bookmarks.includes(bm))return;await ctx.saveThumb(key(book,bm),thumb);if(book===ctx.current&&!panel.hidden)render();renderDock();
  }
  async function add(){
    const book=ctx.current,p=here();if(!book||!p)return false;
    if(book.bookmarks.some(b=>b.name===p.name&&Math.abs(b.f-p.f)*p.h<main.clientHeight/2)){notice('bmExists');return false;}
    const bm={id:crypto.randomUUID(),name:p.name,f:p.f,at:Date.now()},page=book.pages[p.i];
    book.bookmarks=list({pages:book.pages,bookmarks:[...book.bookmarks,bm]}).map(x=>x.bm);await ctx.persist(book);
    notice('bmAdded');if(!panel.hidden)render();renderDock();
    snap(book,bm,page,p,main.clientWidth,main.clientHeight).catch(e=>console.warn(e)); // 读图失败只缺缩略图，书签照常可用
    return true;
  }
  async function drop(book,bm){
    book.bookmarks=book.bookmarks.filter(b=>b!==bm);if(last?.id===bm.id)last=null;await ctx.persist(book);
    forget(key(book,bm));await ctx.thumbs('delete',key(book,bm));if(!panel.hidden)render();renderDock();
  }

  // 面板：右键呼出，“添加书签”按钮正好在鼠标下；点击缩略图才跳转并关闭，点面板外或 Esc 关闭（位置不变）。
  const panel=make('div','bm-panel'),addBtn=make('button','bm-add'),head=make('div','bm-head'),grid=make('div','bm-grid');
  panel.hidden=true;panel.setAttribute('role','dialog');addBtn.type='button';panel.append(addBtn,head,grid);document.body.append(panel);
  function render(){
    const book=ctx.current;if(!book)return;
    panel.setAttribute('aria-label',t('bookmarks'));
    const keys=make('span','bm-keys',t('bmHold'));keys.append(make('kbd','','G'),'/',make('kbd','','Enter'));
    addBtn.replaceChildren(icon('bookmark-plus'),make('span','label',t('bmAdd')),keys);
    const items=list(book);head.replaceChildren(make('span','',t('bookmarks')),make('span','count',items.length||''));
    if(!items.length){grid.replaceChildren(make('p','bm-empty',t('bmEmpty')));return;}
    grid.replaceChildren(...items.map(x=>tile(book,x)));
  }
  // 书签缩略图格子：右键面板与书架书签列表共用。
  // 紧凑显示：只有缩略图，不显示文件名、书名和页码文字；页码（及书名）只放进 aria-label 给读屏。
  function tile(book,x,withBook=false){
    const item=make('div','bm-item'+(x.i<0?' gone':'')),thumb=make('span','bm-thumb'),img=make('img');
    const label=x.i<0?t('bmGone'):fmt('bmPage',{n:x.i+1});
    item.dataset.id=x.bm.id;item.setAttribute('aria-label',withBook?ctx.title(book)+' · '+label:label);img.alt='';img.draggable=false;thumb.append(img);
    const none=()=>{img.remove();thumb.classList.add('empty');};ctx.getThumb(key(book,x.bm)).then(th=>{if(th)img.src=th.url;else none();},none);
    item.append(thumb,ctx.iconButton('close',t('bmDelete'),()=>drop(book,x.bm),'bm-del'));
    return item;
  }
  // 缩略图按视口形状截取；显示时把比例限制在 3:4 ~ 4:3，避免窄窗口或宽屏下变成长条（居中裁切，书签位置仍在中央）。
  const ratio=()=>String(Math.min(4/3,Math.max(3/4,main.clientWidth/Math.max(1,main.clientHeight))));
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  function open(x,y){
    if(!ctx.current)return;
    panel.style.setProperty('--bm-ar',ratio());
    render();panel.style.left=panel.style.top='0px';panel.hidden=false;
    // 用布局尺寸而非 getBoundingClientRect：弹出动画的缩放会让后者偏几像素。
    const w=panel.offsetWidth,h=panel.offsetHeight;let left,top;
    if(x==null){const m=main.getBoundingClientRect();left=m.left+(m.width-w)/2;top=m.top+Math.max(0,(m.height-h)/2.6);}
    else{left=x-panel.clientLeft-addBtn.offsetLeft-addBtn.offsetWidth/2;top=y-panel.clientTop-addBtn.offsetTop-addBtn.offsetHeight/2;}
    panel.style.left=clamp(left,8,innerWidth-w-8)+'px';panel.style.top=clamp(top,8,innerHeight-h-8)+'px';
  }
  function close(){
    if(panel.hidden)return;panel.hidden=true;
    if(document.activeElement&&panel.contains(document.activeElement))main.focus();
  }
  function jumpTo(id){const book=ctx.current,x=book&&list(book).find(x=>x.bm.id===id);if(x&&x.i>=0)go(x);}
  main.addEventListener('contextmenu',e=>{if(!ctx.current)return;e.preventDefault();open(e.clientX,e.clientY);});
  panel.addEventListener('contextmenu',e=>e.preventDefault());
  panel.addEventListener('click',e=>{
    if(e.target.closest('.bm-del'))return;
    if(e.target.closest('.bm-add')){ctx.safe(add)();main.focus();return;}
    const item=e.target.closest('.bm-item');if(!item||item.classList.contains('gone'))return;
    jumpTo(item.dataset.id);close();main.focus();
  });
  // 点面板外关闭；点在正文上时这一下只用来关闭面板，不再翻屏。
  document.addEventListener('pointerdown',e=>{if(panel.hidden||panel.contains(e.target))return;close();if(main.contains(e.target))e.stopPropagation();},true);
  window.addEventListener('keydown',e=>{if(!panel.hidden&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}},true);
  ctx.actions.bookmarks=()=>{if(!panel.hidden)close();else open(null,null);};

  // G / Enter：短按跳到下一个书签；长按 150ms 后显示进度环，满 550ms 添加书签。
  let press=null;
  const showHold=state=>state==='done'?ctx.ring.done('check',t('bmAdded')):ctx.ring.show('bookmark',t('bmKeep'));
  function cancel(){if(!press)return;clearTimeout(press.show);clearTimeout(press.add);if(!press.done)ctx.ring.hide();press=null;}
  ctx.keys.push({
    down(e){
      if(e.key!=='Enter'&&e.key.toLowerCase()!=='g')return false;
      e.preventDefault();if(e.repeat||press)return true;
      const p=press={code:e.code,done:false};
      p.show=setTimeout(()=>showHold('fill'),SHOW);
      p.add=setTimeout(()=>{p.done=true;ctx.safe(async()=>{if(await add())showHold('done');else ctx.ring.hide();})();},ADD);
      return true;
    },
    up(e){if(!press||e.code!==press.code)return;const p=press;cancel();if(!p.done)(pinned?nextShelf:next)();},
    blur(){cancel();}
  });
  ctx.on('select',()=>{cancel();close();if(last?.book!==ctx.current)last=null;renderDock();});
  ctx.on('lang',()=>{if(!panel.hidden)render();renderDock();});

  // 书架书签：开关打开后在左侧常驻一列（正文让出宽度），按书架顺序集中显示书架上所有书的书签。
  // 悬停不跳转，点击才跳转（可跨书）；此时短按 G / Enter 也按这个列表跳到下一个书签，必要时切换到下一本书。
  const dock=make('aside','sm-dock'),dockHead=make('div','sm-head'),dockList=make('div','sm-list'),dockGrip=make('div','sm-grip');
  // 顶部内侧（靠阅读区一端）：打开全屏书架书签（overview.mjs）；浮动时点开后先收起列表。没有书签时不可用。
  const dockOpen=ctx.iconButton('overview','',()=>{if(ctx.overview?.shelfmarks.open()&&!pinned)float(false);},'side-open');
  dock.id='shelfmarks';dock.hidden=true;dockGrip.setAttribute('role','separator');dockGrip.setAttribute('aria-orientation','vertical');dockGrip.tabIndex=0;
  dock.append(dockHead,dockList,dockGrip);document.getElementById('toolbar').before(dock);
  // 书架上（不含书库和过期书）有书签的书，顺序与上一本 / 下一本相同。
  const shelfBooks=()=>ctx.readingList({place:'shelf'});
  function renderDock(){
    if(dock.hidden)return;
    const groups=shelfBooks().map(book=>({book,items:list(book)})).filter(g=>g.items.length);
    dock.setAttribute('aria-label',t('shelfmarks'));dockGrip.title=t('smWidth');dockGrip.setAttribute('aria-label',t('smWidth'));
    dockOpen.title=t('smOvOpen');dockOpen.setAttribute('aria-label',dockOpen.title);dockOpen.disabled=!groups.some(g=>g.items.some(x=>x.i>=0));
    dockHead.replaceChildren(make('span','side-title',t('shelfmarks')),make('span','count',groups.reduce((n,g)=>n+g.items.length,0)||''),dockOpen);
    dock.style.setProperty('--bm-ar',ratio());
    if(!groups.length){dockList.replaceChildren(make('p','bm-empty',t('smEmpty')));return;}
    dockList.replaceChildren(...groups.map(({book,items})=>{
      // 每本书一组，不显示书名；当前书的一组高亮。
      const section=make('section','sm-book');section.dataset.book=book.id;section.setAttribute('aria-label',ctx.title(book));
      section.append(...items.map(x=>tile(book,x,true)));return section;
    }));
    markDock();
  }
  // 标出当前书和最近跳到的书签，并把后者滚入可见范围。
  function markDock(){
    if(dock.hidden)return;let active=null;
    for(const s of dockList.querySelectorAll('.sm-book'))s.classList.toggle('current',s.dataset.book===ctx.current?.id);
    for(const item of dockList.querySelectorAll('.bm-item')){const on=!!last&&item.dataset.id===last.id;item.classList.toggle('active',on);if(on)active=item;}
    active?.scrollIntoView({block:'nearest'});
  }
  // 跳到某本书的某个书签；不是当前书时先打开那本书（select 会先恢复它的阅读位置，同一帧内再跳转）。
  function goShelf(book,x){if(book!==ctx.current)ctx.select(book);if(ctx.current===book&&starts())go(x);}
  // 短按 G / Enter：当前书里位于屏幕中心之后的书签，没有则依次是后面各书的书签，最后回到列表开头。
  // 当前书不在书架上（书库中）时仍按本书内的书签循环。
  function nextShelf(){
    const book=ctx.current,order=shelfBooks(),rank=new Map(order.map((b,i)=>[b,i]));
    if(!rank.has(book))return next();
    const all=order.flatMap(b=>list(b).map(x=>({...x,book:b}))),flat=all.filter(x=>x.i>=0);
    if(!flat.length){notice(null,t(all.length?'bmAllGone':'smEmpty'));return;}
    const s=starts();if(!s)return;
    let k=-1;if(repeat(book)){const j=flat.findIndex(x=>x.bm.id===last.id);if(j>=0)k=j+1;}
    if(k<0){const r=rank.get(book),y=main.scrollTop+main.clientHeight/2;
      k=flat.findIndex(x=>rank.get(x.book)>r||x.book===book&&point(s,{i:x.i,f:x.bm.f})>y+2);}
    const wrap=k<0||k>=flat.length;if(wrap)k=0;
    const x=flat[k],moved=x.book!==book;goShelf(x.book,x);
    notice(null,wrap?t('bmWrap'):fmt('bmN',{n:k+1,m:flat.length})+(moved?' · '+ctx.title(x.book):''));
  }
  dockList.addEventListener('click',e=>{
    if(e.target.closest('.bm-del'))return;
    const section=e.target.closest('.sm-book'),book=section&&ctx.books.get(section.dataset.book);if(!book)return;
    const item=e.target.closest('.bm-item');if(!item||item.classList.contains('gone'))return;
    const x=list(book).find(x=>x.bm.id===item.dataset.id);if(x&&x.i>=0)goShelf(book,x);main.focus();
  });
  dock.addEventListener('contextmenu',e=>e.preventDefault());
  // 与右侧缩略图栏相同：默认常驻（停靠在左侧，正文让出宽度）；取消常驻后，鼠标贴近左缘稍作停留即浮动弹出，离开后淡出收起。
  let pinned=ctx.get('shelfmarks',true)!==false;
  const pressed=()=>document.querySelector('#bar [data-act="shelfmarks"]')?.setAttribute('aria-pressed',String(pinned));
  function setDock(pin){
    pinned=pin;dock.classList.toggle('floating',!pin);document.body.classList.toggle('shelfmarks',pin);pressed();
    if(pin){clearTimeout(dock.fadeTimer);dock.classList.remove('leaving');dock.hidden=false;}else dock.hidden=true;
    renderDock();
  }
  function float(open){if(pinned)return;const was=!dock.hidden;ctx.fade(dock,open);if(open&&!was)renderDock();}
  ctx.actions.shelfmarks=()=>{ctx.put('shelfmarks',!pinned);setDock(!pinned);};
  let edgeTimer=0;const cancelEdge=()=>{clearTimeout(edgeTimer);edgeTimer=0;};
  document.addEventListener('pointermove',e=>{
    const near=e.pointerType==='mouse'&&!e.buttons&&!pinned&&e.clientX<=EDGE&&!ctx.showing(dock)&&!document.querySelector('dialog[open]')&&ctx.get('edgeLeft',true);
    if(!near)cancelEdge();else if(!edgeTimer)edgeTimer=setTimeout(()=>{edgeTimer=0;if(!pinned&&!document.querySelector('dialog[open]'))float(true);},DWELL);
    // 与右侧缩略图栏相同的兜底：在静止的指针下弹出后没有 pointerleave，指针离开列表和左缘即收起。
    if(e.pointerType==='mouse'&&!pinned&&!resizing&&ctx.showing(dock)&&e.clientX>EDGE&&!dock.contains(e.target))float(false);
  });
  document.addEventListener('pointerout',e=>{if(!e.relatedTarget)cancelEdge();});
  dock.addEventListener('pointerleave',()=>{if(!pinned&&!resizing)float(false);});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pinned)float(false);});
  ctx.on('books',renderDock);ctx.shelf.addEventListener('close',renderDock); // 在书架页移动、删除书目后同步
  // 拖动右缘或用左右方向键调整宽度，与右侧缩略图栏的拖动条一致。
  const width=v=>{const w=Math.round(Math.max(MIN_W,Math.min(innerWidth*.45,v)));document.documentElement.style.setProperty('--sm-w',w+'px');return w;};
  width(ctx.get('shelfmarksWidth',260));let resizing=false;
  dockGrip.onpointerdown=e=>{if(e.button!==0)return;resizing=true;dockGrip.setPointerCapture(e.pointerId);};
  dockGrip.onpointermove=e=>{if(resizing)width(e.clientX);};
  dockGrip.onlostpointercapture=()=>{resizing=false;ctx.put('shelfmarksWidth',width(dock.offsetWidth));renderDock();};
  dockGrip.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();ctx.put('shelfmarksWidth',width(dock.offsetWidth+(e.key==='ArrowRight'?16:-16)));}};
  setDock(pinned);
  // 供全屏书架书签（overview.mjs）使用：有效书签按书分组、跳转、缩略图 key、显示比例，以及打开时默认选中的书签。
  ctx.shelfmarks={
    groups:()=>shelfBooks().map(book=>({book,items:list(book).filter(x=>x.i>=0)})).filter(g=>g.items.length),
    go:goShelf,thumbKey:key,ratio,
    start(){const book=ctx.current;if(!book)return null;if(last?.book===book)return last.id;
      const items=list(book).filter(x=>x.i>=0),s=starts();if(!items.length)return null;if(!s)return items[0].bm.id;
      const y=main.scrollTop+main.clientHeight/2;return (items.find(x=>point(s,{i:x.i,f:x.bm.f})>=y-2)||items.at(-1)).bm.id;}
  };
  ctx.settings.push({id:'edgeLeft',group:'reading',label:'smEdgeLeft',type:'toggle',get:()=>ctx.get('edgeLeft',true),set:v=>ctx.put('edgeLeft',!!v)});
}
