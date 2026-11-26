import {extend} from './lang.mjs';
import {at,point,clipEnd} from './model.mjs';
import {forget} from './thumbs.mjs';
import {pair} from './sections.mjs';
// 书签：book.bookmarks=[{id,name,f,at,end?}]，按图片文件名定位，重新排序后仍有效。缩略图存在 thumbs store 的 `${book.id}:bm:${id}`。
// end：区段书签（终点，见 sections.mjs），记录的内容与书签相同 {name,f,at}，缩略图键为 `${book.id}:bm:${id}:end`；它不是独立的书签，
// 不计数、不是 F / Enter 的停靠点、不在列表里单独占一项。图片书签的位置是「页 + 页内位置」，媒体以后按「文件 + 时间点」扩展（coord）。
extend({
  bmAdd:['Add bookmark','添加书签','しおりを追加','책갈피 추가'],bmHold:['Hold','长按','長押し','길게'],
  bmEmpty:['No bookmarks yet','还没有书签','しおりはまだありません','아직 책갈피가 없습니다'],
  bmNone:['No bookmarks yet — hold F or Enter to add one','还没有书签，长按 F 或 Enter 添加','しおりはまだありません。F か Enter を長押しで追加','아직 책갈피가 없습니다. F 또는 Enter를 길게 눌러 추가하세요'],
  bmAllGone:['The bookmarked images no longer exist','书签所在的图片都已不存在','しおりの画像が見つかりません','책갈피한 이미지가 더 이상 없습니다'],
  bmAdded:['Bookmark added','已添加书签','しおりを追加しました','책갈피를 추가했습니다'],
  bmExists:['There is already a bookmark here','这里已有书签','ここにはすでにしおりがあります','여기에 이미 책갈피가 있습니다'],
  bmKeep:['Keep holding to add a bookmark','继续按住添加书签','押し続けるとしおりを追加','계속 누르면 책갈피 추가'],
  bmN:['Bookmark {n} / {m}','书签 {n} / {m}','しおり {n} / {m}','책갈피 {n} / {m}'],
  bmWrap:['Back to the first bookmark','已回到第一个书签','最初のしおりに戻りました','첫 번째 책갈피로 돌아왔습니다'],
  bmWrapBack:['Back to the last bookmark','已回到最后一个书签','最後のしおりに戻りました','마지막 책갈피로 돌아왔습니다'],
  bmPage:['Image {n}','第 {n} 张','{n} 枚目','{n}번째'],bmGone:['Image missing','图片已不存在','画像なし','이미지 없음'],
  bmDelete:['Delete bookmark','删除书签','しおりを削除','책갈피 삭제'],
  secAdd:['Add section bookmark','添加区段书签','区間しおりを追加','구간 책갈피 추가'],
  secKeep:['Keep holding to add a section bookmark','继续按住添加区段书签','押し続けると区間しおりを追加','계속 누르면 구간 책갈피 추가'],
  secAdded:['Section bookmark added','已添加区段书签','区間しおりを追加しました','구간 책갈피를 추가했습니다'],
  secUpdated:['Section end updated','已更新区段书签','区間しおりを更新しました','구간 책갈피를 업데이트했습니다'],
  secNone:['No bookmark before this point to pair with — add a bookmark first','前面没有可配对的书签，请先添加书签','この位置より前に組になるしおりがありません。先にしおりを追加してください','앞쪽에 짝지을 책갈피가 없습니다. 먼저 책갈피를 추가하세요'],
  secDelete:['Delete section bookmark','删除区段书签','区間しおりを削除','구간 책갈피 삭제'],
  secStart:['Section start','区段起点','区間の始点','구간 시작'],secEnd:['Section bookmark','区段书签','区間しおり','구간 책갈피'],
  smEmpty:['No bookmarks on the shelf yet — hold F or Enter while reading to add one','书架上还没有书签，阅读时长按 F 或 Enter 添加','本棚にしおりはまだありません。読書中に F か Enter を長押しで追加','책장에 아직 책갈피가 없습니다. 읽는 중에 F 또는 Enter를 길게 눌러 추가하세요'],
  smFiltered:['No bookmarks in the current shelf filter results — clear or change the filters','当前书架筛选结果中没有书签，可清除或更换筛选条件','本棚の絞り込み結果にしおりはありません。絞り込みを解除するか変更してください','현재 책장 필터 결과에 책갈피가 없습니다. 필터를 지우거나 바꿔 보세요'],
  smOpenLabel:['Full screen','全屏书签','全画面で表示','전체 화면'],
  smEdgeLeft:['Show shelf bookmarks at the left edge (when not pinned)','书架书签未常驻时，鼠标移到左缘弹出','本棚のしおりを固定していないとき、左端で表示','책장 책갈피를 고정하지 않았을 때 왼쪽 가장자리에서 표시'],
  smWidth:['Bookmark list width','书签列表宽度','しおり一覧の幅','책갈피 목록 너비']
});
const SHOW=150,ADD=550,DWELL=150,MIN_W=160,BROWSE=1500; // DWELL / MIN_W：与右侧缩略图栏（app.mjs）一致；边缘触发区距离四边统一（ctx.atEdge）。BROWSE：手动滚动书架书签列表后这段时间内不自动定位
export function install(ctx){
  const {main,view,t,fmt,notice,make,icon}=ctx;
  const sprite=document.querySelector('svg.sprite'),mark='M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z';
  if(sprite&&!document.getElementById('i-bookmark'))sprite.insertAdjacentHTML('beforeend',`<symbol id="i-bookmark" viewBox="0 0 24 24"><path d="${mark}"/></symbol><symbol id="i-bookmark-plus" viewBox="0 0 24 24"><path d="${mark}"/><path d="M12 7v6M9 10h6"/></symbol>`);
  // 成对标记：起点是书签标记里一个向后的箭头，区段书签是向前的箭头，一头一尾互相呼应（缩略图栏的页内细标记是一对方括号，见 bookmarks.css）。
  if(sprite&&!document.getElementById('i-bm-start'))sprite.insertAdjacentHTML('beforeend',`<symbol id="i-bm-start" viewBox="0 0 24 24"><path d="${mark}"/><path d="M10 7.5l4.5 3-4.5 3z" fill="currentColor"/></symbol><symbol id="i-bm-end" viewBox="0 0 24 24"><path d="${mark}"/><path d="M14 7.5l-4.5 3 4.5 3z" fill="currentColor"/></symbol>`);
  const key=(book,bm)=>book.id+':bm:'+bm.id,endKey=(book,bm)=>key(book,bm)+':end';
  function starts(){const s=view.panes[0].starts,b=ctx.current;return b?.pages.length&&s.length===b.pages.length+1?s:null;}
  // 屏幕中心所在的图与图内位置（view.anchor() 在书首返回 null，这里不能用）。
  function here(){const s=starts();if(!s)return null;const {i,f}=at(s,main.scrollTop+main.clientHeight/2);return {i,f,name:ctx.current.pages[i].name,h:s[i+1]-s[i]};}
  // 按当前页序排列；文件名已不存在的排在最后，i 为 -1。e：区段书签所在的页（没有或已不存在为 -1）；
  // live：区段生效（两头都在、区段书签在起点之后）；页序改变使区段书签排到前面时暂不生效，数据保留。
  function list(book){const pos=new Map(book.pages.map((p,i)=>[p.name,i]));
    return (book.bookmarks||[]).map(bm=>{const i=pos.get(bm.name)??-1,e=bm.end?pos.get(bm.end.name)??-1:-1;
      return {bm,i,e,live:i>=0&&e>=0&&coord(e,bm.end)>coord(i,bm)};}).sort((a,b)=>(a.i<0)-(b.i<0)||a.i-b.i||a.bm.f-b.bm.f||a.bm.at-b.bm.at);}
  // 配对用的一维坐标（sections.mjs）：图片为页序 + 页内位置，全书一个坐标系。媒体书签以后按所在文件分组、以时间为坐标。
  const coord=(i,m)=>i+m.f;
  const coords=items=>items.filter(x=>x.i>=0).map(x=>({id:x.bm.id,at:coord(x.i,x.bm),end:x.bm.end?(x.live?coord(x.e,x.bm.end):null):undefined}));
  let last=null; // 最近一次跳到的书签：滚动位置被夹住（书首 / 书尾）时仍能接着跳下一个。
  function go(x){view.jump({i:x.i,f:x.bm.f});last={id:x.bm.id,top:main.scrollTop,book:ctx.current};markDock();reveal();}
  const repeat=book=>last&&last.book===book&&Math.abs(main.scrollTop-last.top)<2;
  // d=1：下一个书签，到末尾回到第一个；d=-1（Shift）：上一个，到开头回到最后一个。
  function next(d=1){
    const book=ctx.current;if(!book)return;
    if(!book.bookmarks?.length){notice(null,t('bmNone'));return;}
    const valid=list(book).filter(x=>x.i>=0),s=starts();if(!valid.length){notice('bmAllGone');return;}if(!s)return;
    let k=repeat(book)?valid.findIndex(x=>x.bm.id===last.id):-1;
    if(k>=0)k+=d;else{const y=main.scrollTop+main.clientHeight/2,p=x=>point(s,{i:x.i,f:x.bm.f});k=d>0?valid.findIndex(x=>p(x)>y+2):valid.findLastIndex(x=>p(x)<y-2);}
    const wrap=k<0||k>=valid.length;if(wrap)k=d>0?0:valid.length-1;
    go(valid[k]);notice(null,wrap?t(d>0?'bmWrap':'bmWrapBack'):fmt('bmN',{n:k+1,m:valid.length}));
  }
  // 缩略图：截取屏幕中心所在那张图、以中心为准、与视口等比例的区域，换算到原图像素。
  // end：截的是区段书签（终点）的缩略图，保存到它自己的键；期间终点又被更新或删除就丢弃。
  async function snap(book,bm,page,p,vw,vh,end=null){
    let crop=null;
    if(page.w&&page.h){const s=page.h/p.h,k=Math.min(1,page.w/(vw*s),page.h/(vh*s)),w=vw*s*k,h=vh*s*k;
      crop={x:Math.round((page.w-w)/2),y:Math.round(Math.min(page.h-h,Math.max(0,p.f*page.h-h/2))),w:Math.round(w),h:Math.round(h)};}
    const thumb=await ctx.makeThumb(await ctx.source(book,page),{width:240,crop});
    if(!book.bookmarks.includes(bm)||end&&bm.end!==end)return;await ctx.saveThumb(end?endKey(book,bm):key(book,bm),thumb);if(book===ctx.current&&!panel.hidden)render();renderDock();
  }
  async function add(){
    const book=ctx.current,p=here();if(!book||!p)return false;
    if(book.bookmarks.some(b=>b.name===p.name&&Math.abs(b.f-p.f)*p.h<main.clientHeight/2)){notice('bmExists');return false;}
    const bm={id:crypto.randomUUID(),name:p.name,f:p.f,at:Date.now()},page=book.pages[p.i];
    book.bookmarks=list({pages:book.pages,bookmarks:[...book.bookmarks,bm]}).map(x=>x.bm);await ctx.persist(book);
    notice('bmAdded');changed(book);
    snap(book,bm,page,p,main.clientWidth,main.clientHeight).catch(e=>console.warn(e)); // 读图失败只缺缩略图，书签照常可用
    return true;
  }
  // 添加区段书签：取屏幕中央的位置，按 sections.mjs 的规则配给前面的一个区段（更新终点）或普通书签（新建区段）。
  // 返回 'added' | 'updated'，没有添加时为 false。终点离起点不到半屏（同一张图内）按“这里已有书签”处理。
  async function addSection(){
    const book=ctx.current,p=here();if(!book||!p)return false;
    const r=pair(coords(list(book)),coord(p.i,p));
    if(!r){notice(null,t('secNone'));return false;}
    const bm=book.bookmarks.find(b=>b.id===r.id);
    if(bm.name===p.name&&Math.abs(bm.f-p.f)*p.h<main.clientHeight/2){notice('bmExists');return false;}
    const had=!!bm.end,end=bm.end={name:p.name,f:p.f,at:Date.now()};await ctx.persist(book);
    notice(had?'secUpdated':'secAdded');changed(book);
    snap(book,bm,book.pages[p.i],p,main.clientWidth,main.clientHeight,end).catch(e=>console.warn(e)); // 旧终点的缩略图换成新的
    return had?'updated':'added';
  }
  // 删除起点书签：它的区段书签一并删除。删除区段书签：起点变回普通书签。
  async function drop(book,bm){
    book.bookmarks=book.bookmarks.filter(b=>b!==bm);if(last?.id===bm.id)last=null;await ctx.persist(book);
    forget(key(book,bm));await ctx.thumbs('delete',key(book,bm));if(bm.end)await ctx.thumbs('delete',endKey(book,bm));changed(book);
  }
  async function dropEnd(book,bm){
    if(!bm.end)return;delete bm.end;await ctx.persist(book);
    forget(endKey(book,bm));await ctx.thumbs('delete',endKey(book,bm));changed(book);
  }
  // 书签增删改后：面板、书架书签列表、缩略图栏和全屏界面（ctx.on('marks')）只更新受影响的部分。
  function changed(book){if(book===ctx.current&&!panel.hidden)render();renderDock();ctx.emit('marks',book);}

  // 面板：右键呼出，“添加书签”按钮正好在鼠标下；点击缩略图才跳转并关闭，点面板外或 Esc 关闭（位置不变）。
  const panel=make('div','bm-panel'),addBtn=make('button','bm-add'),secBtn=make('button','bm-add bm-sec'),head=make('div','bm-head'),grid=make('div','bm-grid');
  panel.hidden=true;panel.setAttribute('role','dialog');addBtn.type=secBtn.type='button';panel.append(addBtn,secBtn,head,grid);document.body.append(panel);
  function render(){
    const book=ctx.current;if(!book)return;
    panel.setAttribute('aria-label',t('bookmarks'));
    const keys=make('span','bm-keys',t('bmHold'));keys.append(make('kbd','','F'),'/',make('kbd','','Enter'));
    addBtn.replaceChildren(icon('bookmark-plus'),make('span','label',t('bmAdd')),keys);
    const secKeys=make('span','bm-keys',t('bmHold'));secKeys.append(make('kbd','','Shift'),'+',make('kbd','','F'),'/',make('kbd','','Enter'));
    secBtn.replaceChildren(icon('bm-start'),make('span','label',t('secAdd')),secKeys);
    const items=list(book);head.replaceChildren(make('span','',t('bookmarks')),make('span','count',items.length||''));
    if(!items.length){grid.replaceChildren(make('p','bm-empty',t('bmEmpty')));return;}
    grid.replaceChildren(...items.map(x=>tile(book,x)));markPanel();
  }
  // 面板里离阅读视窗最近的书签（与书架书签列表的 .active 相同）；面板开着时随阅读滚动更新。
  function markPanel(){
    const id=ctx.current&&nearest(ctx.current);
    for(const el of grid.querySelectorAll('.bm-item'))el.classList.toggle('active',el.dataset.id===id);
  }
  // 书签缩略图格子：右键面板与书架书签列表共用。
  // 紧凑显示：只有缩略图，不显示文件名、书名和页码文字；页码（及书名）只放进 aria-label 给读屏。
  // 带区段书签的书签显示为一组：起点缩略图（带起点标记）加左下角一张较小的区段书签缩略图（带区段书签标记、自己的删除按钮），点哪张跳到哪里。
  // 悬停任意一张，两张一起高亮。区段暂不生效时小图变灰，仍可删除。
  function tile(book,x,withBook=false){
    const item=make('div','bm-item'+(x.i<0?' gone':'')),thumb=make('span','bm-thumb'),img=make('img');
    const label=x.i<0?t('bmGone'):fmt('bmPage',{n:x.i+1});
    item.dataset.id=x.bm.id;item.setAttribute('aria-label',(withBook?ctx.title(book)+' · '+label:label)+(x.bm.end?' · '+t('secStart'):''));img.alt='';img.draggable=false;thumb.append(img);
    const none=()=>{img.remove();thumb.classList.add('empty');};ctx.getThumb(key(book,x.bm)).then(th=>{if(th)img.src=th.url;else none();},none);
    item.append(thumb,ctx.iconButton('close',t('bmDelete'),()=>drop(book,x.bm),'bm-del'));
    if(x.bm.end){
      item.classList.add('paired');thumb.append(markIcon('start'));
      const sub=make('span','bm-sub'+(x.live?'':' off')),simg=make('img');simg.alt='';simg.draggable=false;
      sub.setAttribute('aria-label',t('secEnd')+' · '+(x.e<0?t('bmGone'):fmt('bmPage',{n:x.e+1})));sub.setAttribute('role','button');
      const gone=()=>{simg.remove();sub.classList.add('empty');};ctx.getThumb(endKey(book,x.bm)).then(th=>{if(th)simg.src=th.url;else gone();},gone);
      sub.append(simg,markIcon('end'),ctx.iconButton('close',t('secDelete'),()=>dropEnd(book,x.bm),'bm-sub-del'));item.append(sub);
    }
    return item;
  }
  const markIcon=kind=>{const el=make('span','bm-mk '+kind);el.append(icon(kind==='start'?'bm-start':'bm-end'));return el;};
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
  function jumpTo(id,end=false){const book=ctx.current,x=book&&list(book).find(x=>x.bm.id===id);if(!x)return;if(end){if(x.e>=0)goEnd(x);}else if(x.i>=0)go(x);}
  // 跳到区段书签：它不是 F / Enter 的停靠点，不记为“刚跳到的书签”。
  function goEnd(x){view.jump({i:x.e,f:x.bm.end.f});last=null;markDock();reveal();}
  main.addEventListener('contextmenu',e=>{if(!ctx.current)return;e.preventDefault();open(e.clientX,e.clientY);});
  panel.addEventListener('contextmenu',e=>e.preventDefault());
  panel.addEventListener('click',e=>{
    if(e.target.closest('.bm-del,.bm-sub-del'))return;
    if(e.target.closest('.bm-sec')){ctx.safe(addSection)();main.focus();return;}
    if(e.target.closest('.bm-add')){ctx.safe(add)();main.focus();return;}
    const item=e.target.closest('.bm-item'),end=!!e.target.closest('.bm-sub');if(!item||item.classList.contains('gone')&&!end)return;
    jumpTo(item.dataset.id,end);close();main.focus();
  });
  // 点面板外关闭；点在正文上时这一下只用来关闭面板，不再翻屏。
  document.addEventListener('pointerdown',e=>{if(panel.hidden||panel.contains(e.target))return;close();if(main.contains(e.target))e.stopPropagation();},true);
  window.addEventListener('keydown',e=>{if(!panel.hidden&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}},true);
  ctx.actions.bookmarks=()=>{if(!panel.hidden)close();else open(null,null);};

  // F / Enter：短按跳到下一个书签（按住 Shift 为上一个）；长按 150ms 后显示进度环，满 550ms 添加书签，按住 Shift 时添加区段书签。
  let press=null;
  const showHold=(state,sec,r)=>state==='done'?ctx.ring.done('check',t(sec?(r==='updated'?'secUpdated':'secAdded'):'bmAdded')):ctx.ring.show(sec?'bm-start':'bookmark',t(sec?'secKeep':'bmKeep'));
  function cancel(){if(!press)return;clearTimeout(press.show);clearTimeout(press.add);if(!press.done)ctx.ring.hide();press=null;}
  ctx.keys.push({
    down(e){
      if(e.key!=='Enter'&&e.key.toLowerCase()!=='f')return false;
      e.preventDefault();if(e.repeat||press)return true;
      const p=press={code:e.code,d:e.shiftKey?-1:1,sec:e.shiftKey,done:false};
      p.show=setTimeout(()=>showHold('fill',p.sec),SHOW);
      p.add=setTimeout(()=>{p.done=true;ctx.safe(async()=>{const r=await (p.sec?addSection:add)();if(r)showHold('done',p.sec,r);else ctx.ring.hide();})();},ADD);
      return true;
    },
    up(e){if(!press||e.code!==press.code)return;const p=press;cancel();if(!p.done)(pinned?nextShelf:next)(p.d);},
    blur(){cancel();}
  });
  ctx.on('select',()=>{cancel();close();if(last?.book!==ctx.current)last=null;renderDock();reveal();});
  ctx.on('lang',()=>{if(!panel.hidden)render();renderDock();});
  // 别的窗口改了书签或存好了书签缩略图（windows.mjs）：书架书签列表随 'books' 更新，这里补上打开着的书签面板。
  ctx.on('synced',book=>{if(book===ctx.current&&!panel.hidden)render();});
  ctx.on('thumbs',keys=>{if(!keys.some(k=>k.includes(':bm:')))return;if(!panel.hidden)render();renderDock();});

  // 书架书签：开关打开后在左侧常驻一列（正文让出宽度），按书架顺序集中显示书架上所有书的书签。
  // 悬停不跳转，点击才跳转（可跨书）；此时短按 F / Enter（Shift 反向）也按这个列表跳到下一个书签，必要时切换书。
  const dock=make('aside','sm-dock'),dockHead=make('div','sm-head'),dockList=make('div','sm-list'),dockGrip=make('div','sm-grip');
  // 头部是一个占满整行的块状按钮：打开全屏书架书签（overview.mjs），按钮里有图标、文字和书签数；浮动时点开后先收起列表。没有书签时不可用。
  const dockOpen=ctx.iconButton('overview','',()=>{if(ctx.overview?.shelfmarks.open()&&!pinned)float(false);},'side-open'),dockLabel=make('span','side-title'),dockCount=make('span','count');
  dockOpen.append(dockLabel,dockCount);
  dock.id='shelfmarks';dock.hidden=true;dockGrip.setAttribute('role','separator');dockGrip.setAttribute('aria-orientation','vertical');dockGrip.tabIndex=0;
  dock.append(dockHead,dockList,dockGrip);document.getElementById('toolbar').before(dock);
  // 书架上（不含书库和过期书）有书签的书，顺序与上一本 / 下一本相同。
  const shelfBooks=()=>ctx.readingList({place:'shelf'});
  // 书架上没有可显示的书签时的提示：书架页的筛选生效时，说明可能是筛选导致的（有清除筛选的接口时附一个按钮）；没有筛选才说书架上还没有书签。
  const emptyKey=()=>ctx.filtering?.()?'smFiltered':'smEmpty';
  function emptyNote(){
    const p=make('p','bm-empty',t(emptyKey()));
    if(emptyKey()==='smFiltered'&&ctx.clearFilters){const b=make('button','link-btn',t('clearFilters'));b.type='button';b.onclick=()=>{ctx.clearFilters();renderDock();};p.append(make('br'),b);}
    return p;
  }
  function renderDock(){
    if(dock.hidden)return;
    const groups=shelfBooks().map(book=>({book,items:list(book)})).filter(g=>g.items.length);
    dock.setAttribute('aria-label',t('shelfmarks'));dockGrip.title=t('smWidth');dockGrip.setAttribute('aria-label',t('smWidth'));
    dockOpen.title=t('smOvOpen');dockOpen.setAttribute('aria-label',dockOpen.title);dockOpen.disabled=!groups.some(g=>g.items.some(x=>x.i>=0));
    dockLabel.textContent=t('smOpenLabel');dockCount.textContent=groups.reduce((n,g)=>n+g.items.length,0)||'';if(!dockOpen.isConnected)dockHead.append(dockOpen);
    dock.style.setProperty('--bm-ar',ratio());
    if(!groups.length){dockList.replaceChildren(emptyNote());return;}
    marked=null;dockList.replaceChildren(...groups.map(({book,items})=>{
      // 每本书一组，不显示书名；当前书的一组高亮。
      const section=make('section','sm-book');section.dataset.book=book.id;section.setAttribute('aria-label',ctx.title(book));
      section.append(...items.map(x=>tile(book,x,true)));return section;
    }));
    markDock();
  }
  // 标出当前书的一组，以及其中离阅读视窗中心最近的书签（当前标记，.active）。只改样式，不滚动列表。
  function markDock(){
    if(dock.hidden)return;
    for(const s of dockList.querySelectorAll('.sm-book'))s.classList.toggle('current',s.dataset.book===ctx.current?.id);
    markNear();
  }
  // 离屏幕中心最近的有效书签；刚跳到的书签被夹在书首 / 书尾时仍是它。还没有版面时返回 null。
  function nearest(book){
    if(repeat(book))return last.id;const s=starts();if(!s)return null;
    const y=main.scrollTop+main.clientHeight/2;let best=null,gap=Infinity;
    for(const x of list(book))if(x.i>=0){const d=Math.abs(point(s,{i:x.i,f:x.bm.f})-y);if(d<gap){gap=d;best=x.bm.id;}}
    return best;
  }
  let marked=null;
  function markNear(){
    const book=ctx.current,group=book&&dockList.querySelector('.sm-book.current'),id=group&&nearest(book);
    const item=id?group.querySelector(`.bm-item[data-id="${CSS.escape(id)}"]`):null;
    if(item!==marked){marked?.classList.remove('active');item?.classList.add('active');marked=item;}
  }
  // 阅读滚动时当前标记跟随更新：节流到每 200ms 至多一次，只改前后两个格子，不滚动列表。
  let nearTimer=0;
  main.addEventListener('scroll',()=>{if(!nearTimer&&(!dock.hidden||!panel.hidden))nearTimer=setTimeout(()=>{nearTimer=0;if(!dock.hidden)markNear();if(!panel.hidden)markPanel();},200);},{passive:true});
  // 列表定位：切书、跳转书签、列表弹出 / 显示时，把当前标记（还没有版面时为当前书那一组）滚入可见范围；当前书没有书签则不动。
  // 用户正在浏览列表（指针在列表上，或刚手动滚动过）时不抢滚动位置；列表刚显示时（force）除外。只滚动列表本身，不影响正文。
  let browsedAt=-Infinity;
  for(const type of ['wheel','pointerdown','keydown','touchstart'])dockList.addEventListener(type,()=>{browsedAt=performance.now();},{passive:true});
  function reveal(force=false){
    if(dock.hidden||!force&&(dock.matches(':hover')||performance.now()-browsedAt<BROWSE))return;
    const target=marked||dockList.querySelector('.sm-book.current');if(!target)return;
    const l=dockList.getBoundingClientRect(),r=target.getBoundingClientRect();if(r.top>=l.top&&r.bottom<=l.bottom)return;
    dockList.scrollTop+=r.top-l.top-Math.max(0,(l.height-r.height)/2);
  }
  // 跳到某本书的某个书签；不是当前书时先打开那本书（select 会先恢复它的阅读位置，同一帧内再跳转）。
  function goShelf(book,x,end=false){if(book!==ctx.current)ctx.select(book);if(ctx.current===book&&starts())(end?goEnd:go)(x);}
  // 短按 F / Enter：当前书里位于屏幕中心之后的书签，没有则依次是后面各书的书签，最后回到列表开头。
  // d=-1（Shift）反向：屏幕中心之前的书签，没有则是前面各书的书签，最后回到列表末尾。
  // 当前书不在书架上（书库中）时仍按本书内的书签循环。
  function nextShelf(d=1){
    const book=ctx.current,order=shelfBooks(),rank=new Map(order.map((b,i)=>[b,i]));
    if(!rank.has(book))return next(d);
    const all=order.flatMap(b=>list(b).map(x=>({...x,book:b}))),flat=all.filter(x=>x.i>=0);
    if(!flat.length){notice(null,t(all.length?'bmAllGone':emptyKey()));return;}
    const s=starts();if(!s)return;
    let k=-1,found=false;if(repeat(book)){const j=flat.findIndex(x=>x.bm.id===last.id);if(j>=0){k=j+d;found=true;}}
    if(!found){const r=rank.get(book),y=main.scrollTop+main.clientHeight/2,p=x=>point(s,{i:x.i,f:x.bm.f});
      k=d>0?flat.findIndex(x=>rank.get(x.book)>r||x.book===book&&p(x)>y+2):flat.findLastIndex(x=>rank.get(x.book)<r||x.book===book&&p(x)<y-2);}
    const wrap=k<0||k>=flat.length;if(wrap)k=d>0?0:flat.length-1;
    const x=flat[k],moved=x.book!==book;goShelf(x.book,x);
    notice(null,wrap?t(d>0?'bmWrap':'bmWrapBack'):fmt('bmN',{n:k+1,m:flat.length})+(moved?' · '+clipEnd(ctx.title(x.book)):''));
  }
  dockList.addEventListener('click',e=>{
    if(e.target.closest('.bm-del,.bm-sub-del'))return;
    const section=e.target.closest('.sm-book'),book=section&&ctx.books.get(section.dataset.book);if(!book)return;
    const item=e.target.closest('.bm-item'),end=!!e.target.closest('.bm-sub');if(!item||item.classList.contains('gone')&&!end)return;
    const x=list(book).find(x=>x.bm.id===item.dataset.id);if(x&&(end?x.e>=0:x.i>=0))goShelf(book,x,end);main.focus();
  });
  dock.addEventListener('contextmenu',e=>e.preventDefault());
  // 与右侧缩略图栏相同：默认不常驻，鼠标贴近左缘稍作停留即浮动弹出，离开后淡出收起；常驻时停靠在左侧，正文让出宽度。
  let pinned=ctx.get('shelfmarks',false)===true;
  const pressed=()=>document.querySelector('#bar [data-act="shelfmarks"]')?.setAttribute('aria-pressed',String(pinned));
  function setDock(pin){
    pinned=pin;dock.classList.toggle('floating',!pin);document.body.classList.toggle('shelfmarks',pin);pressed();
    if(pin){clearTimeout(dock.fadeTimer);dock.classList.remove('leaving');dock.hidden=false;}else dock.hidden=true;
    renderDock();reveal(true);
  }
  function float(open){if(pinned)return;const was=!dock.hidden;ctx.fade(dock,open);if(open&&!was){renderDock();reveal(true);}}
  ctx.actions.shelfmarks=()=>{ctx.put('shelfmarks',!pinned);setDock(!pinned);};
  let edgeTimer=0;const cancelEdge=()=>{clearTimeout(edgeTimer);edgeTimer=0;};
  document.addEventListener('pointermove',e=>{
    const near=e.pointerType==='mouse'&&!e.buttons&&!pinned&&ctx.atEdge('left',e)&&!ctx.showing(dock)&&!document.querySelector('dialog[open]')&&ctx.get('edgeLeft',true);
    if(!near)cancelEdge();else if(!edgeTimer)edgeTimer=setTimeout(()=>{edgeTimer=0;if(!pinned&&!document.querySelector('dialog[open]'))float(true);},DWELL);
    // 与右侧缩略图栏相同的兜底：在静止的指针下弹出后没有 pointerleave，指针离开列表和左缘即收起。
    if(e.pointerType==='mouse'&&!pinned&&!resizing&&ctx.showing(dock)&&!ctx.atEdge('left',e)&&!dock.contains(e.target))float(false);
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
    go:goShelf,goEnd:(book,x)=>goShelf(book,x,true),thumbKey:key,endKey,ratio,emptyKey,
    start(){const book=ctx.current;if(!book)return null;if(last?.book===book)return last.id;
      const items=list(book).filter(x=>x.i>=0),s=starts();if(!items.length)return null;if(!s)return items[0].bm.id;
      const y=main.scrollTop+main.clientHeight/2;return (items.find(x=>point(s,{i:x.i,f:x.bm.f})>=y-2)||items.at(-1)).bm.id;}
  };
  // ---- 缩略图上的书签标记（缩略图栏、全屏缩略图共用）----
  // 每页一份：n 为书签数（起点和普通书签，区段书签不计数）；mark / start / end 表示这一页出现的标记种类；
  // ticks 为页内位置的细标记 [{f,kind,id}]（只在缩略图栏画）。暂不生效的区段，起点按普通书签显示，区段书签不画。
  function pageMarks(book){
    const out=new Map(),at=i=>{let m=out.get(i);if(!m)out.set(i,m={n:0,mark:false,start:false,end:false,ticks:[]});return m;};
    for(const x of list(book)){
      if(x.i<0)continue;const m=at(x.i);m.n++;
      if(x.live){m.start=true;m.ticks.push({f:x.bm.f,kind:'start',id:x.bm.id});const e=at(x.e);e.end=true;e.ticks.push({f:x.bm.end.f,kind:'end',id:x.bm.id});}
      else{m.mark=true;m.ticks.push({f:x.bm.f,kind:'mark',id:x.bm.id});}
    }
    return out;
  }
  const sig=m=>[m.n,m.mark,m.start,m.end,...m.ticks.map(t=>t.kind+t.f+t.id)].join('|');
  // 角标：标记种类的图标（普通 / 起点 / 区段书签），书签多于一个时带数量。绝对定位叠在缩略图一角，不改变排布。
  function badge(m){
    const el=make('span','mk');el.setAttribute('aria-hidden','true');
    for(const k of ['mark','start','end'])if(m[k])el.append(icon(k==='mark'?'bookmark':'bm-'+k));
    if(m.n>1)el.append(make('b','',String(m.n)));
    return el;
  }
  // 生效的区段覆盖的页：[{id,a,b}]（a 起点页，b 区段书签所在页），全屏缩略图悬停 / 聚焦时标出范围。
  const spans=book=>list(book).filter(x=>x.live).map(x=>({id:x.bm.id,a:x.i,b:x.e}));
  ctx.marks={list,pages:pageMarks,sig,badge,spans,thumbKey:key,endKey};

  // 缩略图栏：在正文的等比缩小长条上，为有书签的页叠一层标记（角标 + 按页内位置画的细标记：普通书签一道横线，起点与区段书签是一对方括号）。
  // 标记层在长条之外（切书时长条被清空也不受影响），只随排版（ctx.on('layout')）重新定位；书签变化时只重建内容变了的那几页。
  const nav=document.getElementById('preview'),layer=make('div','pv-marks'),bar=new Map();
  layer.setAttribute('aria-hidden','true');nav.append(layer);
  function drawBar(reset=false){
    if(reset){bar.clear();layer.replaceChildren();}
    const book=ctx.current,s=view.panes[1].starts,ok=book&&s.length===book.pages.length+1,marks=ok?pageMarks(book):new Map(),seen=new Set();
    for(const [i,m] of marks){
      const name=book.pages[i].name,k=sig(m);let r=bar.get(name);seen.add(name);
      if(!r){r={el:make('div','pv-mk'),sig:null};r.el.dataset.name=name;bar.set(name,r);layer.append(r.el);}
      if(r.sig!==k){r.sig=k;r.el.replaceChildren(badge(m),...m.ticks.map(t=>{const d=make('i','tick '+t.kind);d.style.top=t.f*100+'%';if(t.kind!=='mark')d.dataset.sec=t.id;return d;}));}
      r.el.style.top=s[i]+'px';r.el.style.height=s[i+1]-s[i]+'px';
    }
    for(const [name,r] of bar)if(!seen.has(name)){r.el.remove();bar.delete(name);}
  }
  // 指针所在的页有起点或区段书签时，同一对的两个细标记一起高亮（只提示）。
  let hot='';
  function heat(ids){const k=[...ids].join();if(k===hot)return;hot=k;for(const el of layer.querySelectorAll('.tick[data-sec]'))el.classList.toggle('hot',ids.has(el.dataset.sec));}
  nav.addEventListener('pointermove',e=>{
    const book=ctx.current,s=view.panes[1].starts;if(!book||s.length!==book.pages.length+1)return;
    const {i}=at(s,e.clientY-nav.getBoundingClientRect().top+nav.scrollTop),r=bar.get(book.pages[i]?.name);
    heat(new Set(r?[...r.el.querySelectorAll('.tick[data-sec]')].map(el=>el.dataset.sec):[]));
  });
  nav.addEventListener('pointerleave',()=>heat(new Set()));
  ctx.on('layout',()=>drawBar());ctx.on('marks',book=>{if(book===ctx.current)drawBar();});ctx.on('select',()=>drawBar(true));

  ctx.settings.push({id:'edgeLeft',group:'reading',label:'smEdgeLeft',type:'toggle',get:()=>ctx.get('edgeLeft',true),set:v=>ctx.put('edgeLeft',!!v)});
}
