// 键鼠操作（工具栏的键盘按钮打开的 #help 对话框）：按左手、右手、鼠标三种用法画出的键位图，下方是图示覆盖不到的补充按键。
// 键位图只画用得到的局部键盘：有功能的键高亮，键帽上只写键名；其余键是暗淡的占位，只为保持真实的相对位置。
// 功能说明只在提示框里：悬停、键盘聚焦或点按一个功能键 / 阅读区边缘时显示（与它的 aria-label 相同）；占位键 aria-hidden。
// 说明只写功能名，不写“打开 / 关闭”“单击”等常规动作；*…* 包住的“长按”和文案里的“Shift”用各自的强调色显示。
import {extend} from './lang.mjs';
extend({
  hkLeft:['Left hand','左手','左手','왼손'],hkRight:['Right hand','右手','右手','오른손'],hkMouse:['Mouse','鼠标','マウス','마우스'],
  hkHold:['Hold','长按','長押し','길게'],
  hkHint:['Hover a key to see what it does','悬停按键查看功能','キーに重ねると説明を表示','키에 올리면 설명 표시'],
  hkSpace:['Space','空格','スペース','스페이스'],
  hkTipEsc:['Hide toolbar, action bar, floating panels','收起工具栏、操作栏、浮动侧栏','ツール・操作バー・浮いたパネルを隠す','도구·작업 표시줄·떠 있는 패널 숨기기'],
  hkTipUp:['Scroll up, Shift: previous book','向上滚动，Shift 上一本','上へスクロール、Shift で前の本','위로 스크롤, Shift: 이전 책'],hkTipDown:['Scroll down, Shift: next book','向下滚动，Shift 下一本','下へスクロール、Shift で次の本','아래로 스크롤, Shift: 다음 책'],
  hkTipSpace:['Play / pause media','播放 / 暂停媒体','メディアを再生／一時停止','미디어 재생 / 일시 정지'],
  hkTipBack:['Previous screen, *hold*: rewind media','上一屏，*长按*媒体快退','前の画面、*長押し*でメディアを巻き戻し','이전 화면, *길게*: 미디어 되감기'],
  hkTipFwd:['Next screen, *hold*: fast-forward media','下一屏，*长按*媒体快进','次の画面、*長押し*でメディアを早送り','다음 화면, *길게*: 미디어 빨리 감기'],
  hkTipVolDown:['Volume down','音量减','音量を下げる','볼륨 낮추기'],hkTipVolUp:['Volume up','音量加','音量を上げる','볼륨 높이기'],
  hkTipMark:['Next bookmark, *hold*: add bookmark, Shift: reverse','跳转书签，*长按*添加书签，Shift 反向','次のしおり、*長押し*で追加、Shift で逆方向','다음 책갈피, *길게*: 추가, Shift: 반대로'],
  hkTipShift:['With W, S, ↑, ↓: change books; with F, Enter: reverse','配合 W、S、↑、↓ 切书，配合 F、Enter 反向','W・S・↑・↓ と併用で本の切替、F・Enter と併用で逆方向','W·S·↑·↓와 함께: 책 전환, F·Enter와 함께: 반대로'],
  hkTipMarks:['Full-screen bookmarks','全屏书签','全画面しおり','전체 화면 책갈피'],hkTipThumbs:['Full-screen thumbnails','全屏缩略图','全画面サムネイル','전체 화면 미리보기'],
  hkTipShelf:['Shelf','书架','本棚','책장'],hkTipTools:['Toolbar','工具栏','ツール','도구'],
  hkTipStart:['Start of book, again: previous book','书首，再按上一本','先頭へ、もう一度で前の本','처음으로, 한 번 더: 이전 책'],
  hkTipEnd:['End of book, again: next book','书尾，再按下一本','末尾へ、もう一度で次の本','끝으로, 한 번 더: 다음 책'],
  hkTipDelete:['Delete this book\'s record (files kept)','删除本书记录（不删原文件）','この本の記録を削除（元のファイルは残す）','이 책 기록 삭제 (원본 파일 유지)'],
  // 鼠标：按键是“小图标 + 文字”的图例；阅读区示意的边缘标注是位置信息，说明在提示框里。
  hkMouseL:['Turn screens (left / right half), on media: play / pause, drag: scroll','翻屏（左 / 右半屏），点媒体播放 / 暂停，拖动滚动','画面送り（左／右半分）、メディアは再生／一時停止、ドラッグでスクロール','화면 넘기기 (왼쪽 / 오른쪽 절반), 미디어: 재생 / 일시 정지, 드래그: 스크롤'],
  hkMouseW:['Scroll, middle click: auto-scroll','滚动，中键自动滚动','スクロール、中クリックで自動スクロール','스크롤, 가운데 클릭: 자동 스크롤'],
  hkMouseR:['Bookmark panel','书签面板','しおりパネル','책갈피 패널'],
  hkThumbBar:['Thumbnails','缩略图栏','サムネイル','미리보기'],hkHalfL:['Previous screen','上一屏','前の画面','이전 화면'],hkHalfR:['Next screen','下一屏','次の画面','다음 화면'],
  hkTipTop:['Rest at the top edge: toolbar','停在顶缘：工具栏','上端で止める：ツール','위쪽 가장자리: 도구'],
  hkTipBottom:['Rest at the bottom edge: action bar (books, start / end)','停在底缘：操作栏（切书、书首 / 书尾）','下端で止める：操作バー（本の切替、先頭／末尾）','아래쪽 가장자리: 작업 표시줄 (책 전환, 처음 / 끝)'],
  hkTipLeft:['Rest at the left edge: shelf bookmarks (when not pinned)','停在左缘：书架书签（未常驻时）','左端で止める：本棚のしおり（固定していないとき）','왼쪽 가장자리: 책장 책갈피 (고정하지 않았을 때)'],
  hkTipRight:['Rest at the right edge: thumbnails (when not pinned)','停在右缘：缩略图栏（未常驻时）','右端で止める：サムネイル（固定していないとき）','오른쪽 가장자리: 미리보기 (고정하지 않았을 때)'],
  // 图示下方的补充按键
  hkMoreOverview:['In full-screen views: choose, Space / Enter: jump','全屏界面内：选择，空格 / Enter 跳转','全画面内：選択、Space / Enter で移動','전체 화면에서: 선택, Space / Enter: 이동'],
  hkMoreSearch:['Shelf: search','书架页：搜索','本棚：検索','책장: 검색'],
  hkMoreShelf:['Shelf: choose a book, Enter: read, Delete: delete record','书架页：选书，Enter 阅读，Delete 删除记录','本棚：本を選ぶ、Enter で読む、Delete で記録を削除','책장: 책 선택, Enter: 읽기, Delete: 기록 삭제'],
  hkMoreCopy:['Copy the listed titles','复制书架列出的书名','本棚の書名をコピー','책장 제목 복사']
});

// ==== 键位数据。改键位（app.mjs、bookmarks.mjs、overview.mjs、shelf.mjs 的按键处理）要同步这里的 KEYS / MORE 和 README 的按键表。====
// 真实键盘（ANSI 布局）每一行从左到右：[键 id, 宽度(u)]；id 为 null 是键之间的空隙。
const row=s=>s.split(' ').map(k=>[k,1]);
export const ROWS={
  fn:[['Esc',1],[null,1],...row('F1 F2 F3 F4'),[null,.5],...row('F5 F6 F7 F8')],
  num:[...row('` 1 2 3 4 5 6 7 8 9 0 - ='),['Backspace',2],[null,.25],...row('Insert Home PageUp')],
  tab:[['Tab',1.5],...row('Q W E R T Y U I O P [ ]'),['\\',1.5],[null,.25],...row('Delete End PageDown')],
  caps:[['CapsLock',1.75],...row("A S D F G H J K L ; '"),['Enter',2.25]],
  shift:[['ShiftLeft',2.25],...row('Z X C V B N M , . /'),['ShiftRight',2.75],[null,1.25],['ArrowUp',1]],
  ctrl:[['ControlLeft',1.25],['MetaLeft',1.25],['AltLeft',1.25],['Space',6.25],['AltRight',1.25],['Fn',1.25],['ContextMenu',1.25],['ControlRight',1.25],[null,.25],...row('ArrowLeft ArrowDown ArrowRight')]
};
// 两块键盘局部：rows 为显示的行（null 是行间的小空隙），from / to 为显示的横向范围（u）；跨边界的键截断，边缘淡出。
export const ZONES=[
  {id:'left',title:'hkLeft',rows:['fn',null,'tab','caps','shift','ctrl'],from:0,to:8},
  {id:'right',title:'hkRight',rows:['num','tab','caps','shift','ctrl'],from:10.5,to:18.25}
];
// 有功能的键：tip 说明（文案 key）；hold：有长按功能，shift：受 Shift 影响（键帽角上的小标记）；mod：Shift 键本身。
const up={tip:'hkTipUp',shift:true},down={tip:'hkTipDown',shift:true},back={tip:'hkTipBack',hold:true},fwd={tip:'hkTipFwd',hold:true},
  mark={tip:'hkTipMark',hold:true,shift:true},rev={tip:'hkTipShift',mod:true},marks={tip:'hkTipMarks'},thumbs={tip:'hkTipThumbs'},
  volDown={tip:'hkTipVolDown'},volUp={tip:'hkTipVolUp'};
export const KEYS={
  Esc:{tip:'hkTipEsc'},W:up,S:down,A:back,D:fwd,F:mark,C:marks,V:thumbs,B:{tip:'hkTipShelf'},T:{tip:'hkTipTools'},Q:volDown,E:volUp,
  ShiftLeft:rev,Space:{tip:'hkTipSpace'},';':volDown,"'":volUp,
  Enter:mark,ShiftRight:rev,'[':marks,']':thumbs,Home:{tip:'hkTipStart'},End:{tip:'hkTipEnd'},
  PageUp:{tip:'prev'},PageDown:{tip:'next'},Delete:{tip:'hkTipDelete'},
  ArrowUp:up,ArrowDown:down,ArrowLeft:back,ArrowRight:fwd
};
const NAMES={Insert:'Ins',PageUp:'PgUp',PageDown:'PgDn',Delete:'Del',CapsLock:'Caps',ShiftLeft:'Shift',ShiftRight:'Shift',ControlLeft:'Ctrl',ControlRight:'Ctrl',
  MetaLeft:'Win',AltLeft:'Alt',AltRight:'Alt',ContextMenu:'Menu',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'};
// 鼠标：三个按键的图例，以及阅读区示意（四条边缘呼出带提示框；左 / 右半屏翻屏只是标注）。
export const MOUSE={
  buttons:[{part:'l',label:'hkMouseL'},{part:'w',label:'hkMouseW'},{part:'r',label:'hkMouseR'}],
  areas:[{id:'top',label:'hkTipTools',tip:'hkTipTop'},{id:'left',label:'shelfmarks',tip:'hkTipLeft'},{id:'half-l',label:'hkHalfL'},
    {id:'half-r',label:'hkHalfR'},{id:'right',label:'hkThumbBar',tip:'hkTipRight'},{id:'bottom',label:'endbar',tip:'hkTipBottom'}]
};
// 图示覆盖不到的按键：[[按键…], 说明]，多个按键之间是“或”，“+”表示组合键。
export const MORE=[[['W A S D','↑ ↓ ← →'],'hkMoreOverview'],[['/','Ctrl+F'],'hkMoreSearch'],[['↑ ↓ ← →'],'hkMoreShelf'],[['Ctrl+C'],'hkMoreCopy']];
// 说明文字拆成片段：*…* 是长按（.em-hold），“Shift”是修饰键（.em-shift），其余是普通文字。plain 为去掉标记的纯文本。
export const plain=text=>text.replace(/\*/g,'');
export function pieces(text){return text.split(/(\*[^*]+\*|\bShift\b)/).filter(Boolean).map(s=>s[0]==='*'?['hold',s.slice(1,-1)]:s==='Shift'?['shift',s]:['',s]);}

export function install(ctx){
  const {t,make}=ctx,dialog=document.getElementById('help'),body=document.getElementById('helpBody'),tip=make('div','hk-tip');
  tip.hidden=true;tip.setAttribute('aria-hidden','true');dialog.append(tip);
  const name=id=>id==='Space'?t('hkSpace'):NAMES[id]??id;
  const rich=text=>pieces(text).map(([kind,s])=>kind?make('span','em-'+kind,s):s);
  const richEl=(tag,cls,text)=>{const el=make(tag,cls);el.append(...rich(text));return el;};
  // 功能项：可聚焦；说明（功能键前加键名）写进 aria-label，也是悬停 / 聚焦时提示框的文字。
  function item(el,text,key){
    el.tabIndex=0;el.setAttribute('role','listitem');el.dataset.tip=text;if(key)el.dataset.name=key;
    el.setAttribute('aria-label',(key?key+' ':'')+plain(text));return el;
  }
  // 键帽上只有键名（单键宽放不下的长键名如 Home、PgUp 略小一号）；占位键的键名用 ::after 画（极淡），不进入 textContent 和读屏。长按 / Shift 的角标也是 CSS 画的。
  function key(id){
    const f=KEYS[id],el=make('div','hk-key');el.dataset.key=id;
    if(!f){el.dataset.cap=name(id);el.setAttribute('aria-hidden','true');return el;}
    el.classList.add('on');if(f.mod)el.classList.add('mod');if(f.shift)el.classList.add('has-shift');if(f.hold)el.classList.add('has-hold');
    el.append(make('span','hk-cap',name(id)));
    return item(el,t(f.tip),name(id));
  }
  // 键帽按 1/4 键宽的网格列排布，列号由真实键盘上的位置算出。
  function zone(z){
    const sec=make('section','hk-zone hk-'+z.id),grid=make('div','hk-keys');let cutL=false,cutR=false;
    grid.setAttribute('role','list');grid.setAttribute('aria-label',t(z.title));
    grid.style.gridTemplateColumns='repeat('+Math.round((z.to-z.from)*4)+',1fr)';
    grid.style.gridTemplateRows=z.rows.map(r=>!r?'2px':r==='fn'||r==='num'?'var(--hk-row1)':'var(--hk-row)').join(' ');
    z.rows.forEach((r,i)=>{if(!r)return;let x=0;
      for(const [id,w] of ROWS[r]){
        const a=Math.max(x,z.from),b=Math.min(x+w,z.to);
        if(id&&b-a>=.25){const el=key(id);if(KEYS[id]&&w<=1&&name(id).length>3)el.classList.add('long');el.style.gridArea=(i+1)+' / '+(Math.round((a-z.from)*4)+1)+' / auto / span '+Math.round((b-a)*4);
          if(x<z.from){el.classList.add('cut-l');cutL=true;}if(x+w>z.to){el.classList.add('cut-r');cutR=true;}grid.append(el);}
        x+=w;
      }});
    grid.classList.toggle('fade-l',cutL);grid.classList.toggle('fade-r',cutR);
    sec.append(make('h3','',t(z.title)),grid);return sec;
  }
  function mouse(){
    const sec=make('section','hk-zone hk-mouse'),wrap=make('div','hk-mouse-body'),btns=make('div','hk-buttons'),screen=make('div','hk-screen');
    btns.setAttribute('role','list');btns.setAttribute('aria-label',t('hkMouse'));
    for(const b of MOUSE.buttons){
      const el=make('div','hk-btn'),ico=make('span','hk-mouse-ico');ico.dataset.part=b.part;ico.setAttribute('aria-hidden','true');ico.append(make('i','l'),make('i','r'),make('i','w'));
      el.dataset.mouse=b.part;el.setAttribute('role','listitem');el.append(ico,richEl('span','',t(b.label)));btns.append(el);
    }
    screen.setAttribute('role','list');screen.setAttribute('aria-label',t('hkMouse'));
    for(const a of MOUSE.areas){
      const el=make('div','hk-area hk-a-'+a.id);el.dataset.area=a.id;el.append(make('span','',t(a.label)));
      if(a.tip)item(el,t(a.tip));else el.setAttribute('role','listitem');screen.append(el);
    }
    wrap.append(btns,screen);sec.append(make('h3','',t('hkMouse')),wrap);return sec;
  }
  function more(){
    const list=make('dl','hk-more');
    for(const [alternatives,text] of MORE){
      const line=make('div'),keys=make('dt');
      alternatives.forEach((combo,i)=>{if(i)keys.append(make('span','or','/'));combo.split('+').forEach((k,j)=>{if(j)keys.append('+');keys.append(make('kbd','',k));});});
      line.append(keys,richEl('dd','',t(text)));list.append(line);
    }
    return list;
  }
  // 图例只说明两种强调色（与键帽角标、提示框里的颜色一致）。
  function legend(){
    const p=make('p','hk-legend');
    p.append(make('span','lg-hold em-hold',t('hkHold')),make('span','lg-shift em-shift','Shift'),make('span','lg-hint',t('hkHint')));
    return p;
  }
  // 图例放在标题行（窄窗口时自动换行），省出竖向空间。
  function render(){hide();dialog.querySelector('.hk-legend')?.remove();dialog.querySelector('header>[data-close]').before(legend());body.replaceChildren(...ZONES.map(zone),mouse(),more());}

  // 悬停与键盘焦点是同一个“选中”：同一时间只有一个提示框；指针离开后回到焦点所在的项。
  // 提示框放在该项正下方，下面放不下就放上方，横向夹在对话框内，不遮住该项。
  let pointed=null;
  function show(el){
    if(!el?.dataset.tip||!dialog.open){tip.hidden=true;return;}
    tip.replaceChildren(...el.dataset.name?[make('kbd','',el.dataset.name),' ']:[],...rich(el.dataset.tip));tip.hidden=false;
    const d=dialog.getBoundingClientRect(),r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
    const x=Math.max(8,Math.min(d.width-w-8,r.left+r.width/2-w/2-d.left));
    const below=r.bottom+6-d.top,above=r.top-6-h-d.top;
    tip.style.left=x+'px';tip.style.top=(below+h<=d.height-8||above<8?Math.min(below,d.height-8-h):above)+'px';
  }
  function hide(){pointed=null;tip.hidden=true;}
  const focused=()=>body.contains(document.activeElement)?document.activeElement:null;
  body.addEventListener('pointerover',e=>{const el=e.target.closest('[data-tip]');if(el===pointed)return;pointed=el;show(el||focused());});
  body.addEventListener('pointerleave',()=>{pointed=null;show(focused());});
  body.addEventListener('focusin',e=>show(e.target.closest('[data-tip]')));
  body.addEventListener('focusout',()=>queueMicrotask(()=>show(pointed||focused())));
  // 滚动后提示框跟着焦点项重新定位，焦点项滚出可见范围（或只是悬停）就收起。
  body.addEventListener('scroll',()=>{pointed=null;const el=focused(),r=el?.getBoundingClientRect(),b=body.getBoundingClientRect();show(r&&r.bottom>b.top&&r.top<b.bottom?el:null);},{passive:true});
  dialog.addEventListener('close',hide);
  render();ctx.on('lang',render);
}
