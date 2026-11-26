import {extend} from './lang.mjs';
import {imageJob,release} from './view.mjs';
import {pageKey} from './thumbs.mjs';
import {shownName,pageKind} from './model.mjs';
import {sourceOf} from './sources.mjs';
import {norm} from './match.mjs';
// 全屏总览：
// · 全屏缩略图：缩略图栏顶部的按钮，或快捷键 V / ]。整本书的页面排成规整网格（默认）或瀑布流，只为可见范围创建元素；
//   缩略图与缩略图栏共用会话内存缓存（thumbs.mjs），再次打开、切书后回来都不必重读原图。
// · 全屏书架书签：书架书签列表顶部的按钮，或快捷键 C / [。书架上各书的书签按书分组。
// 标题行的按钮在“网格 / 瀑布流”间切换，两个全屏界面共用一个偏好（mv2:ovLayout）。
// 面板里 WASD / 方向键按网格行列（瀑布流按列）移动选中；鼠标移到哪格就选中哪格，悬停与键盘共用同一个选中样式（缩小 + 描边，不遮挡相邻格）。
// 空格 / Enter 或点击跳过去并关闭。
// 标题行的搜索框：输入即过滤，键盘选择只在结果内移动；打开时焦点仍在列表上，/ 或 Ctrl+F 聚焦搜索框，搜索框内 Esc 先清空并回到列表。
// 搜索框旁的「图片 / 视频 / 音频」开关按页（书签所在页）的类型过滤，可多选，全不选等于不限；没有结果时的一键清除连同类型一起清除。
// 搜索词和类型只在本次打开期间有效，关闭即清空，不影响上一本 / 下一本和书签跳转。
// 标题行的书架按钮（或 B）在上层打开书架，全屏界面留在下面：书架里切书时全屏缩略图跟着换成新书，关闭书架后回到全屏界面（全屏书签按书架的最新状态重排）。
extend({
  ovOpen:['Full-screen thumbnails (V)','全屏缩略图（V）','全画面サムネイル（V）','전체 화면 미리보기 (V)'],
  smOvOpen:['Full-screen shelf bookmarks (C)','全屏书架书签（C）','全画面の本棚しおり（C）','전체 화면 책장 책갈피 (C)'],
  ovGrid:['Layout: grid (click for masonry)','布局：网格（点击切换为瀑布流）','レイアウト：グリッド（クリックでメイソンリー）','레이아웃: 격자 (클릭하면 메이슨리)'],
  ovMasonry:['Layout: masonry (click for grid)','布局：瀑布流（点击切换为网格）','レイアウト：メイソンリー（クリックでグリッド）','레이아웃: 메이슨리 (클릭하면 격자)'],
  pvOpenLabel:['Full screen','全屏缩略图','全画面で表示','전체 화면'],
  ovPos:['Page {n} / {m}','第 {n} / {m} 页','{n} / {m} ページ','{n} / {m} 페이지'],
  ovShelf:['Bookshelf (B)','书架（B）','本棚（B）','책장 (B)'],
  ovFindPages:['Search file names','搜索文件名','ファイル名を検索','파일 이름 검색'],
  ovFindMarks:['Search titles, file names','搜索作品名、文件名','作品名・ファイル名を検索','작품명, 파일 이름 검색'],
  ovNoMatch:['No matching items','没有匹配的项','一致する項目はありません','일치하는 항목 없음'],ovClear:['Clear search','清除搜索','検索をクリア','검색 지우기'],
  ovHint:['WASD / arrows: choose · Space / Enter: open · {key} / Esc: close','WASD / 方向键选择 · 空格 / Enter 打开 · {key} / Esc 关闭','WASD / 矢印で選択 · Space / Enter で開く · {key} / Esc で閉じる','WASD / 화살표로 선택 · Space / Enter로 열기 · {key} / Esc로 닫기']
});
// 侧栏顶部“打开全屏”按钮的图标（2×2 网格）；模块加载时就放进 sprite，书签列表安装时即可引用。
document.querySelector('svg.sprite')?.insertAdjacentHTML('beforeend','<symbol id="i-overview" viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></symbol><symbol id="i-masonry" viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="10" rx="1.5"/><rect x="3" y="16" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.5"/></symbol>');
// 网格：列宽不小于 MIN_COL；格子比例取本书已知页面比例的中位数（限制在 0.7 ~ 1.6），打开期间不变，图片加载不会挪动格子。
// 比格子高出 TALL 倍以上的长条页只显示顶部（裁切），其余按比例完整显示。
// 瀑布流：每张放进当前最短的一列，高度按页面比例，超长条最多 MAX_RATIO 倍列宽（只显示顶部）。
const GAP=6,MIN_COL=150,TALL=1.6,MAX_RATIO=3;
const ACTS={arrowleft:'left',a:'left',arrowright:'right',d:'right',arrowup:'up',w:'up',arrowdown:'down',s:'down',pageup:'pageUp',pagedown:'pageDown',home:'home',end:'end',' ':'choose',enter:'choose'};
const plain=e=>!e.ctrlKey&&!e.metaKey&&!e.altKey;
// 类型开关：图标（photo 由 shelf.mjs 登记，film / music 由 media.mjs 登记）与文案 key。
const KINDS=[['image','photo'],['video','film'],['audio','music']],KIND_LABEL={image:'kindImage',video:'kindVideo',audio:'kindAudio'};
export function install(ctx){
  const {t,fmt,make,main,view}=ctx;
  ctx.dropKey('overview');ctx.dropKey('smOverview'); // 旧版“鼠标移入上角打开”的两个开关已移除
  ctx.prefs.add('ovLayout');
  const sheets=[],masonry=()=>ctx.get('ovLayout','grid')==='masonry';
  function syncLayout(){for(const s of sheets){const m=masonry(),label=t(m?'ovMasonry':'ovGrid');
    s.lay.querySelector('use').setAttribute('href','#i-'+(m?'masonry':'overview'));s.lay.title=label;s.lay.setAttribute('aria-label',label);}}
  // 全屏面板外壳：标题行、滚动区、开合动画和按键分发；内容与导航由 hooks 提供。
  function sheet(id,keys,bodyClass,hooks){
    const dialog=make('dialog','overview');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'Title');
    const head=make('header','ov-head'),name=make('strong','ov-title'),pos=make('span','ov-pos'),hint=make('span','ov-hint');name.id=id+'Title';
    const shut=ctx.iconButton('close',t('close'),()=>s.close()),shelfBtn=ctx.iconButton('library',t('ovShelf'),()=>ctx.actions.shelf(),'ov-shelf');
    // 切换布局后焦点回到列表，空格 / Enter 仍是“打开选中项”而不是再按一次按钮。
    const lay=ctx.iconButton('overview','',()=>{ctx.put('ovLayout',masonry()?'grid':'masonry');syncLayout();for(const o of sheets)if(o.dialog.open)o.relayout();scroller.focus({preventScroll:true});},'ov-layout');
    const scroller=make('div','ov-scroll'),body=make('div',bodyClass);scroller.tabIndex=-1;scroller.setAttribute('role','listbox');
    // 搜索框；没有结果时在列表区显示「没有匹配的项」和一键清除（与“本来就没有”区分）。
    const find=make('label','ov-find'),q=make('input'),none=make('div','ov-none'),noneText=make('span'),clear=make('button','link-btn');
    // 搜索框旁的类型开关（图片 / 视频 / 音频）：可多选，全不选等于不限；与搜索词一样只在本次打开期间有效。切换后焦点回到列表。
    const kinds=new Set(),kindBox=make('div','ov-kinds');kindBox.setAttribute('role','group');
    const kindBtns=KINDS.map(([k,name])=>{const b=ctx.iconButton(name,'',()=>{if(kinds.has(k))kinds.delete(k);else kinds.add(k);syncKinds();hooks.filter();scroller.focus({preventScroll:true});},'ov-kind');b.dataset.kind=k;return b;});
    kindBox.append(...kindBtns);
    function syncKinds(){for(const b of kindBtns){const k=b.dataset.kind,label=t(KIND_LABEL[k]);b.setAttribute('aria-pressed',String(kinds.has(k)));b.title=label;b.setAttribute('aria-label',label);}}
    syncKinds();
    q.type='search';q.autocomplete='off';q.spellcheck=false;find.append(ctx.icon('search'),q);
    clear.type='button';none.hidden=true;none.append(noneText,clear);
    clear.onclick=()=>{q.value='';kinds.clear();syncKinds();hooks.filter();scroller.focus({preventScroll:true});};
    q.addEventListener('input',()=>hooks.filter());
    scroller.append(body,none);head.append(name,pos,hint,find,kindBox,shelfBtn,lay,shut);dialog.append(head,scroller);document.body.append(dialog);
    let closing=0;
    const s={dialog,name,pos,scroller,body,lay,relayout:()=>hooks.relayout(),
      query:()=>q.value,kinds:()=>kinds,filtered:()=>!!q.value.trim()||kinds.size>0,none(on){none.hidden=!on;clear.textContent=t(kinds.size?'clearFilters':'ovClear');},
      is:e=>plain(e)&&keys.includes(e.key.toLowerCase()),
      open(quiet=false){
        if(dialog.open||document.querySelector('dialog[open]'))return false;
        q.value='';kinds.clear();syncKinds(); // 搜索词和类型只在一次打开期间有效（关闭后立即重新打开时 close 事件可能还没到）
        if(!hooks.setup(quiet))return false;
        hint.textContent=fmt('ovHint',{key:keys[0].toUpperCase()});syncLayout();q.placeholder=t(hooks.find);q.setAttribute('aria-label',q.placeholder);noneText.textContent=t('ovNoMatch');clear.textContent=t('ovClear');syncKinds();for(const [b,k] of [[shut,'close'],[shelfBtn,'ovShelf']]){b.title=t(k);b.setAttribute('aria-label',t(k));}
        clearTimeout(closing);closing=0;dialog.classList.remove('closing');
        dialog.showModal();scroller.focus({preventScroll:true});hooks.show();return true;
      },
      live:()=>dialog.open&&!dialog.classList.contains('closing'),
      // 按当前状态重建内容（切书、书架关闭后）；没有可显示的内容时关闭。
      reload(){hooks.cleanup();if(!hooks.setup(true)){dialog.close();return;}hooks.show();},
      // now：立即关闭（切换到另一个全屏面板时），否则淡出后关闭。
      close(now=false){
        if(!dialog.open)return;if(now){dialog.close();return;}if(closing)return;
        dialog.classList.add('closing');closing=setTimeout(()=>dialog.close(),140);
      }};
    dialog.addEventListener('keydown',e=>{
      // 搜索框内：Esc 清空并回到列表（再按一次才关闭界面），Enter / ↓ 回到列表，其余按键照常输入。
      if(e.target===q){
        if(e.key==='Escape'||e.key==='Enter'||e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();
          if(e.key==='Escape'&&q.value){q.value='';hooks.filter();}scroller.focus({preventScroll:true});}
        return;
      }
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='f'||plain(e)&&e.key==='/'){e.preventDefault();e.stopPropagation();q.focus();q.select();return;}
      if(!plain(e))return;
      if(s.is(e)){e.preventDefault();e.stopPropagation();if(!e.repeat)s.close();return;}
      const other=sheets.find(o=>o!==s&&o.is(e));
      if(other){e.preventDefault();e.stopPropagation();if(!e.repeat){s.close(true);other.open();}return;}
      if(e.key.toLowerCase()==='b'){e.preventDefault();e.stopPropagation();if(!e.repeat)ctx.actions.shelf();return;}
      const k=e.key.toLowerCase(),act=ACTS[k];
      if(!act||e.target.closest('button')&&act==='choose')return;
      e.preventDefault();e.stopPropagation();if(act==='choose'){if(!e.repeat)hooks.choose();}else hooks.move(act);
    });
    // 鼠标真正移动过才让选中跟随悬停：键盘滚动把别的格子移到静止的指针下时不改选中。
    let px=null,py=null;
    body.addEventListener('pointermove',e=>{
      if(e.clientX===px&&e.clientY===py)return;px=e.clientX;py=e.clientY;
      const node=e.target.closest('.ov-item');if(node)hooks.hover(node);
    });
    dialog.addEventListener('cancel',e=>{e.preventDefault();s.close();});
    dialog.addEventListener('close',()=>{if(dialog.open)return; /* close 事件异步派发：期间已重新打开就不清理 */clearTimeout(closing);closing=0;dialog.classList.remove('closing');px=py=null;q.value='';kinds.clear();syncKinds();none.hidden=true;hooks.cleanup();main.focus({preventScroll:true});});
    sheets.push(s);ctx.keys.push({down(e){if(!s.is(e))return false;e.preventDefault();if(!e.repeat)s.open();return true;}});
    return s;
  }

  // ---- 全屏缩略图 ----
  // items：每页的位置 {x,y,w,h,c(列),r(列内序号),k(结果内序号),tall}，不符合搜索的页为 null；cols：每列的页序号；shown：符合搜索的页序号。
  // 网格与瀑布流共用这套数据，导航也就一致，且只在结果内移动。
  // pm：每页的书签标记（ctx.marks.pages），格子一角显示角标；spans：生效的区段，选中带起点或区段书签的页时标出区段覆盖的页（span）。
  let book=null,items=[],cols=[],shown=[],n=2,ratio=1.4,sel=0,here=-1,frame=0,dirty=false,follow=false,hays=[],pm=new Map(),spans=[],span=null;const nodes=new Map();
  const thumbs=sheet('overview',['v',']'],'ov-grid',{
    find:'ovFindPages',
    setup(){const b=ctx.current;if(!b?.pages.length)return false;book=b;thumbs.name.textContent=thumbs.name.title=ctx.title(b);here=view.position()?.i??0;sel=here;ratio=cellRatio(b);
      hays=[];pm=ctx.marks?.pages(b)??new Map();spans=ctx.marks?.spans(b)??[];return true;},
    show(){follow=false;layout();if(!items[sel])sel=shown[0]??sel;const it=items[sel];sc.scrollTop=it?it.y+it.h/2-sc.clientHeight/2:0;thumbs.none(!shown.length);select(sel,false);paint();},
    move(act){
      const it=items[sel];if(!it)return;
      select({left:shown[it.k-1]??sel,right:shown[it.k+1]??sel,home:shown[0],end:shown.at(-1),up:vertical(-1),down:vertical(1),pageUp:vertical(-1,true),pageDown:vertical(1,true)}[act]);
    },
    hover(node){const i=+node.dataset.i;if(i!==sel){follow=false;select(i,false);}},
    relayout(){keep(layout);reveal(sel);schedule();},
    choose(){if(items[sel])choose(sel);},
    // 搜索词变化：保留仍在结果里的选中项，否则选中第一个结果；清空后回到当前页。
    filter(){
      if(!book)return;const all=!thumbs.filtered();layout();thumbs.none(!shown.length);
      const to=all?here:items[sel]?sel:shown[0];
      if(items[to]){if(all){const it=items[to];sc.scrollTop=it.y+it.h/2-sc.clientHeight/2;select(to,false);}else{if(to!==sel)sc.scrollTop=0;select(to);}}
      paint();
    },
    cleanup(){for(const i of [...nodes.keys()])drop(i);items=[];cols=[];shown=[];hays=[];book=null;span=null;}
  });
  // 搜索：文件名（合并作品含卷的文件夹名和路径），多个词须都出现。
  const terms=s=>norm(s).split(' ').filter(Boolean);
  function hayOf(i){const p=book.pages[i],s=sourceOf(book,p);return hays[i]??=norm([shownName(p),s?.key?s.title??'':'',s?.key?s.path??'':''].join(' '));}
  const sc=thumbs.scroller,grid=thumbs.body;
  function cellRatio(b){const r=b.pages.filter(p=>p.w&&p.h).map(p=>p.h/p.w).sort((x,y)=>x-y);return Math.min(1.6,Math.max(.7,r.length?r[r.length>>1]:1.4));}
  function layout(){
    const pages=book?.pages||[],W=sc.clientWidth,m=masonry(),words=terms(thumbs.query()),ks=thumbs.kinds();n=Math.max(2,Math.floor((W-GAP)/(MIN_COL+GAP)));
    const w=(W-GAP*(n+1))/n,gh=Math.round(w*ratio),heights=Array(n).fill(GAP);cols=Array.from({length:n},()=>[]);shown=[];
    items=pages.map((p,i)=>{
      if(ks.size&&!ks.has(pageKind(p))||words.length&&!words.every(x=>hayOf(i).includes(x)))return null;
      const k=shown.length;shown.push(i);
      let c=k%n;if(m){c=0;for(let j=1;j<n;j++)if(heights[j]<heights[c]-.5)c=j;}
      const pr=(p.h||1120)/(p.w||800),h=m?Math.round(w*Math.min(MAX_RATIO,pr)):gh;
      const it={x:GAP+c*(w+GAP),y:m?heights[c]:GAP+Math.floor(k/n)*(gh+GAP),w,h,c,r:cols[c].length,k,tall:!!p.w&&pr>(m?MAX_RATIO:ratio*TALL)};
      heights[c]=it.y+h+GAP;cols[c].push(i);return it;});
    grid.style.height=Math.max(...heights)+'px';
    for(const [i,node] of nodes)place(node,i);
  }
  function place(node,i){const it=items[i];if(!it)return;Object.assign(node.style,{left:it.x+'px',top:it.y+'px',width:it.w+'px',height:it.h+'px'});node.classList.toggle('tall',it.tall);}
  function drop(i){const node=nodes.get(i);release(node.firstChild);node.remove();nodes.delete(i);}
  function paint(){
    if(!book)return;
    const top=sc.scrollTop,H=sc.clientHeight,lo=top-H*.5,hi=top+H*1.5,b=book;
    for(const i of [...nodes.keys()]){const it=items[i];if(!it||it.y+it.h<lo||it.y>hi)drop(i);}
    items.forEach((it,i)=>{
      if(!it||it.y+it.h<lo||it.y>hi)return;
      const visible=it.y+it.h>=top&&it.y<=top+H,page=b.pages[i];let node=nodes.get(i);
      if(!node){
        node=make('div','ov-item');node.dataset.i=i;node.setAttribute('role','option');node.title=shownName(page);
        node.append(make('div','ov-img'),make('span','ov-n',String(i+1)));node.classList.toggle('sel',i===sel);node.classList.toggle('here',i===here);
        node.setAttribute('aria-selected',String(i===sel));badge(node,i);inSpan(node,i);place(node,i);grid.append(node);nodes.set(i,node);
      }
      // 已在队列里的只更新优先级（imageJob 对同一个槽位不会重复读取）；缓存命中时立即显示。
      // 视频、音频：固定样式的占位（media.mjs）；视频叠上真实画面（ctx.frames，持久化，只为可见项生成），音频不读文件。
      const kind=pageKind(page);
      if(kind!=='image'){if(!node.firstChild.firstChild)node.firstChild.append(ctx.mediaTile(page));if(kind==='video')ctx.frames?.show(node.firstChild,b,page,visible);return;}
      imageJob(node.firstChild,()=>view.hooks.file(b,page),visible?1:3,true,(w,h)=>{if(page.w!==w||page.h!==h){page.w=w;page.h=h;dirty=true;schedule();}},
        ()=>node.classList.add('failed'),pageKey(b,page));
    });
  }
  const keep=fn=>{const it=items[sel],off=it?it.y-sc.scrollTop:0;fn();if(it&&items[sel])sc.scrollTop=items[sel].y-off;};
  // 解码后补齐的真实尺寸：总览按选中项保持位置重排（网格的格子不变，只更新长条标记），正文也一起重排（与 view.mjs 自己测量时一致）。
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(!thumbs.dialog.open)return;
    if(dirty){dirty=false;keep(layout);if(follow)reveal(sel);view.layout();view.hooks.measured();}paint();});}
  // 用键盘选中后，补齐尺寸的重排仍保证选中项完整可见；读者自己滚动后不再干预。
  for(const type of ['wheel','pointerdown'])sc.addEventListener(type,()=>{follow=false;},{passive:true});
  sc.addEventListener('scroll',schedule,{passive:true});
  new ResizeObserver(()=>{if(thumbs.dialog.open&&book){keep(layout);if(follow)reveal(sel);schedule();}}).observe(sc);
  // 书签角标：只在内容变化时替换（ctx.on('marks')）。
  function badge(node,i){const m=pm.get(i),k=m?ctx.marks.sig(m):'';if(node._mk===k)return;node._mk=k;node.querySelector(':scope>.mk')?.remove();if(m)node.append(ctx.marks.badge(m));}
  // 区段范围：选中（悬停或键盘聚焦）带起点或区段书签的页时，标出这些区段覆盖的所有页；移到别的页即消失。叠加层，不改变排布。
  function inSpan(node,i){const on=!!span&&i>=span[0]&&i<=span[1];node.classList.toggle('in-sec',on);node.classList.toggle('sec-a',on&&i===span[0]);node.classList.toggle('sec-b',on&&i===span[1]);}
  function showSpan(i){
    let lo=Infinity,hi=-1;for(const s of spans)if(s.a===i||s.b===i){lo=Math.min(lo,s.a);hi=Math.max(hi,s.b);}
    const next=hi>=0?[lo,hi]:null;if(String(next)===String(span))return;span=next;for(const [j,node] of nodes)inSpan(node,j);
  }
  ctx.on('marks',b=>{if(!thumbs.dialog.open||b!==book)return;pm=ctx.marks.pages(b);spans=ctx.marks.spans(b);for(const [i,node] of nodes)badge(node,i);span=null;showSpan(sel);});
  function select(i,scroll=true){
    if(!items[i])return;
    const old=nodes.get(sel);old?.classList.remove('sel');old?.setAttribute('aria-selected','false');sel=i;
    nodes.get(sel)?.classList.add('sel');nodes.get(sel)?.setAttribute('aria-selected','true');
    thumbs.pos.textContent=fmt('ovPos',{n:i+1,m:items.length});showSpan(i);
    if(scroll){follow=true;reveal(i);schedule();}
  }
  function reveal(i){const it=items[i];if(!it)return;const top=sc.scrollTop,H=sc.clientHeight;
    if(it.y<top+GAP||it.h>H-2*GAP)sc.scrollTop=it.y-GAP;else if(it.y+it.h>top+H-GAP)sc.scrollTop=it.y+it.h-H+GAP;}
  // 上下在同一列里移动（网格即上 / 下一行）；网格末行较短、本列下面没有格子时停在最后一张。Page Up / Down 在同一列跳过约一屏。
  function vertical(d,far){
    const it=items[sel],col=cols[it.c];
    if(!far){const to=col[it.r+d];if(to!=null)return to;return d>0&&!masonry()&&Math.floor(it.k/n)<Math.floor((shown.length-1)/n)?shown.at(-1):sel;}
    const target=it.y+d*sc.clientHeight*.9;let k=it.r;while(col[k+d]!=null&&(d>0?items[col[k]].y<target:items[col[k]].y>target))k+=d;return col[k];
  }
  function choose(i){
    const b=book,s=view.panes[0].starts;thumbs.close();
    if(b&&ctx.current===b&&s.length===b.pages.length+1){view.browsing=false;main.scrollTop=s[i];}
  }
  grid.addEventListener('click',e=>{const node=e.target.closest('.ov-item');if(node)choose(+node.dataset.i);});
  ctx.on('select',()=>{if(thumbs.live()&&ctx.current!==book)thumbs.reload();});

  // ---- 全屏书架书签 ----
  // 网格：书签缩略图都按同一比例显示（CSS grid）；瀑布流：按缩略图自身比例在每组里逐列排布（markLayout）。
  // 按书分组并显示书名，当前书高亮。上下按画面位置找最近的一格。
  let marks=[],msel=0,mframe=0,mfollow=false,prefer=null; // prefer：重建时保留的选中书签 id
  const sm=()=>ctx.shelfmarks;
  // groups：打开时的全部书签（按书分组）；搜索只在其中过滤后重建列表，不重新读取书架。
  let groups=[];
  const shelfSheet=sheet('shelfOverview',['c','['],'ov-marks',{
    find:'ovFindMarks',
    setup(quiet){groups=sm()?.groups()||[];if(!groups.length){if(!quiet)ctx.notice(null,t(sm()?.emptyKey()??'smEmpty'));return false;}
      shelfSheet.name.textContent=t('shelfmarks');shelfSheet.body.style.setProperty('--bm-ar',sm().ratio());
      const start=prefer??sm().start();prefer=null;build(start);return true;},
    show(){markLayout();mark(msel);mfollow=true;marks[msel]?.node.scrollIntoView({block:'center'});},
    // 搜索词变化：保留仍在结果里的选中项，否则选中第一个结果；清空后回到当前位置附近的书签。
    filter(){
      const all=!shelfSheet.filtered();build(all?sm().start():marks[msel]?.x.bm.id);markLayout();mark(msel);mfollow=true;
      marks[msel]?.node.scrollIntoView({block:all?'center':'nearest'});
    },
    move(act){
      const to={left:msel-1,right:msel+1,home:0,end:marks.length-1,up:near(-1,0),down:near(1,0),pageUp:near(-1,1),pageDown:near(1,1)}[act];
      mark(to);mfollow=true;marks[msel]?.node.scrollIntoView({block:'nearest'});
    },
    relayout(){markLayout();marks[msel]?.node.scrollIntoView({block:'nearest'});},
    hover(node){const k=+node.dataset.k;if(k!==msel){mfollow=false;mark(k);}},
    choose(){pick(msel);},
    cleanup(){shelfSheet.body.replaceChildren();marks=[];}
  });
  // 匹配作品名（含原文件夹名）、书签所在文件和区段书签所在文件的文件名、书签名称（label，来自 .pbf 导入）；作品名命中即显示该作品的全部书签。
  function hayMark(book,x){
    const file=i=>i>=0&&book.pages[i]?shownName(book.pages[i]):'';
    return norm([ctx.title(book),book.title??'',file(x.i),x.bm.end?file(x.e):'',typeof x.bm.label==='string'?x.bm.label:''].join(' '));
  }
  // 按当前搜索词重建列表，start 为要选中的书签 id。带区段书签的书签左下角叠一张区段书签小图（与书签列表相同），点它跳到区段书签。
  function build(start){
    const words=norm(shelfSheet.query()).split(' ').filter(Boolean),ks=shelfSheet.kinds(),body=shelfSheet.body;marks=[];
    // 类型按书签所在页的类型（媒体书签即所在的视频 / 音频）。
    const keep=(book,x)=>(!ks.size||ks.has(pageKind(book.pages[x.i]??{name:''})))&&(!words.length||(h=>words.every(w=>h.includes(w)))(hayMark(book,x)));
    const list=words.length||ks.size?groups.map(({book,items})=>({book,items:items.filter(x=>keep(book,x))})).filter(g=>g.items.length):groups;
    body.replaceChildren(...list.map(({book,items})=>{
      const sec=make('section','ov-sec'+(book===ctx.current?' current':'')),head=make('div','ov-sec-head'),grid=make('div','ov-sec-grid');
      head.append(make('strong','',ctx.title(book)),make('span','',String(items.length)));sec.append(head,grid);
      for(const x of items){
        const node=make('div','ov-item ov-mark'),img=make('img');img.alt='';img.draggable=false;node.dataset.k=marks.length;node.setAttribute('role','option');
        node.setAttribute('aria-label',ctx.title(book)+' · '+(ctx.marks?.where(book,x)??fmt('bmPage',{n:x.i+1}))+(x.bm.end?' · '+t('secStart'):''));
        img.onload=()=>{node.dataset.r=Math.min(2.5,Math.max(.4,img.naturalHeight/img.naturalWidth));if(masonry())markSchedule();};
        node.append(img,make('span','ov-n',String(x.i+1)));
        // 媒体书签：视频为书签时间点的画面（懒生成）、音频为占位小块，带类型角标和时间点（bookmarks.mjs）。
        if(ctx.marks?.isMedia(x.bm)){ctx.marks.paint(node,img,book,x);node.append(ctx.marks.mediaBadge(book,x));}
        else ctx.getThumb(sm().thumbKey(book,x.bm)).then(th=>{if(th)img.src=th.url;else img.remove();},()=>img.remove());
        if(x.bm.end){
          const mk=kind=>{const el=make('span','bm-mk '+kind);el.append(ctx.icon('bm-'+kind));return el;},sub=make('span','bm-sub'+(x.live?'':' off')),simg=make('img');
          simg.alt='';simg.draggable=false;sub.append(simg,mk('end'));node.classList.add('paired');node.append(mk('start'),sub);
          const gone=()=>{simg.remove();sub.classList.add('empty');};if(ctx.marks?.isMedia(x.bm.end))ctx.marks.paint(sub,simg,book,x,true);else ctx.getThumb(sm().endKey(book,x.bm)).then(th=>{if(th)simg.src=th.url;else gone();},gone);
        }
        grid.append(node);marks.push({book,x,node});
      }
      return sec;}));
    msel=Math.max(0,marks.findIndex(m=>m.x.bm.id===start));shelfSheet.none(!marks.length);
  }
  // 书架关闭后回到下面的全屏界面：全屏书签按书架的最新状态（移动、删除、筛选）重排并保留选中，焦点回到列表。
  ctx.shelf.addEventListener('close',()=>{
    if(ctx.shelf.open)return;const s=sheets.find(o=>o.live());if(!s)return;
    if(s===shelfSheet){prefer=marks[msel]?.x.bm.id??null;s.reload();}
    if(s.live())s.scroller.focus({preventScroll:true});
  });
  function mark(i){
    if(!marks.length){shelfSheet.pos.textContent='';return;}i=Math.max(0,Math.min(marks.length-1,i));
    marks[msel]?.node.classList.remove('sel');marks[msel]?.node.setAttribute('aria-selected','false');msel=i;const m=marks[i];
    m.node.classList.add('sel');m.node.setAttribute('aria-selected','true');
    shelfSheet.pos.textContent=shelfSheet.pos.title=fmt('bmN',{n:i+1,m:marks.length})+' · '+ctx.title(m.book);
  }
  function markLayout(){
    const m=masonry(),body=shelfSheet.body,gap=4,def=1/Number(sm()?.ratio()||.75);body.classList.toggle('masonry',m);
    for(const list of body.querySelectorAll('.ov-sec-grid')){
      const kids=[...list.children];
      if(!m){list.style.height='';for(const k of kids)k.style.cssText='';continue;}
      const W=list.clientWidth,n=Math.max(1,Math.floor((W+gap)/(150+gap))),w=(W-gap*(n-1))/n,hs=Array(n).fill(0);
      for(const k of kids){let c=0;for(let j=1;j<n;j++)if(hs[j]<hs[c]-.5)c=j;const h=Math.round(w*(+k.dataset.r||def));
        Object.assign(k.style,{left:c*(w+gap)+'px',top:hs[c]+'px',width:w+'px',height:h+'px'});hs[c]+=h+gap;}
      list.style.height=Math.max(0,...hs)-gap+'px';
    }
  }
  // 缩略图加载出真实比例后重排；键盘选中的项保持可见（读者自己滚动、悬停后不再干预）。
  function markSchedule(){if(!mframe)mframe=requestAnimationFrame(()=>{mframe=0;if(!shelfSheet.dialog.open)return;markLayout();if(mfollow)marks[msel]?.node.scrollIntoView({block:'nearest'});});}
  for(const type of ['wheel','pointerdown'])shelfSheet.scroller.addEventListener(type,()=>{mfollow=false;},{passive:true});
  new ResizeObserver(()=>{if(shelfSheet.dialog.open&&masonry())markSchedule();}).observe(shelfSheet.scroller);
  // 上 / 下：网格里是方向上最近的一行中横向最近的一格；瀑布流优先同一列里最近的一格。Page Up / Down 先找距约一屏处最近的一行。
  // 一律按中心点比较：选中项以中心缩小（transform），中心不变，上沿却会下移，按上沿比会把同一行的邻居当成“上一行”。
  function near(d,far){
    const cur=marks[msel]?.node.getBoundingClientRect();if(!cur)return msel;
    const rects=marks.map(m=>m.node.getBoundingClientRect()),cx=r=>r.left+r.width/2,cy=r=>r.top+r.height/2;
    const ahead=rects.map((r,i)=>[r,i]).filter(([r])=>d>0?cy(r)>cy(cur)+1:cy(r)<cy(cur)-1);if(!ahead.length)return msel;
    const target=cy(cur)+d*(far?shelfSheet.scroller.clientHeight*.9:0);
    if(masonry()){const same=ahead.filter(([r])=>Math.abs(cx(r)-cx(cur))<cur.width/2);
      if(same.length)return same.reduce((a,b)=>Math.abs(cy(b[0])-target)<Math.abs(cy(a[0])-target)?b:a)[1];}
    const row=ahead.reduce((best,[r])=>Math.abs(cy(r)-target)<Math.abs(best-target)?cy(r):best,cy(ahead[0][0]));
    return ahead.filter(([r])=>Math.abs(cy(r)-row)<1).reduce((a,b)=>Math.abs(cx(b[0])-cx(cur))<Math.abs(cx(a[0])-cx(cur))?b:a)[1];
  }
  function pick(i,end=false){const m=marks[i];if(!m||end&&m.x.e<0)return;shelfSheet.close();sm()[end?'goEnd':'go'](m.book,m.x);}
  shelfSheet.body.addEventListener('click',e=>{const node=e.target.closest('.ov-mark');if(node)pick(+node.dataset.k,!!e.target.closest('.bm-sub'));});

  // ---- 缩略图栏顶部：占满整行的块状“全屏缩略图”按钮（图标、文字、页数；书架书签列表的同款按钮见 bookmarks.mjs，两侧镜像、等高）----
  // 浮动弹出和常驻时都可用；浮动时点开后先收起窄条。
  const panel=document.getElementById('panel'),pvHead=make('div','side-head pv-head'),pvName=make('span','side-title'),pvCount=make('span','count');
  const pvOpen=ctx.iconButton('overview','',()=>{if(thumbs.open()&&!document.body.classList.contains('docked'))ctx.fade(panel,false);},'side-open');
  pvOpen.append(pvName,pvCount);pvHead.append(pvOpen);panel.prepend(pvHead);
  function pvSync(){pvName.textContent=t('pvOpenLabel');pvCount.textContent=ctx.current?.pages.length||'';pvOpen.title=t('ovOpen');pvOpen.setAttribute('aria-label',t('ovOpen'));}
  pvSync();ctx.on('select',pvSync);ctx.on('books',pvSync);ctx.on('lang',pvSync);
  ctx.overview={thumbs,shelfmarks:shelfSheet};
}
