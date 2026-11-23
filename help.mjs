// 键鼠操作（工具栏的键盘按钮打开的 #help 对话框）：按左手、右手、鼠标三种用法画出的键位图，下方是图示覆盖不到的补充按键。
// 键位图只画用得到的局部键盘：有功能的键高亮并在键帽上写短标签，其余键是暗淡的占位，只为保持真实的相对位置。
// 悬停或键盘聚焦一个功能键 / 鼠标操作时显示完整说明（与它的 aria-label 相同）；占位键 aria-hidden。
import {extend} from './lang.mjs';
extend({
  hkLeft:['Left hand','左手','左手','왼손'],hkRight:['Right hand','右手','右手','오른손'],hkMouse:['Mouse','鼠标','マウス','마우스'],
  hkTap:['Tap','单击','短押し','짧게'],hkHold:['Hold','长按','長押し','길게'],hkWithShift:['With Shift: reverse','加 Shift：反向','Shift 併用：逆方向','Shift와 함께: 반대로'],
  hkHint:['Hover or focus a key for details','悬停或聚焦按键查看完整说明','キーにポインターを重ねるかフォーカスすると詳細を表示','키에 포인터를 올리거나 포커스하면 자세히 표시'],
  hkSpace:['Space','空格','スペース','스페이스'],hkKeyTip:['{key} — {text}','{key} — {text}','{key} — {text}','{key} — {text}'],
  // 键帽上的短标签：约 1 个键宽（中日韩 4 字、英文 7 个字母以内），放不下时省略，靠悬停说明兜底。
  hkHide:['Hide','收起','閉じる','닫기'],hkUp:['Up','向上','上へ','위로'],hkDown:['Down','向下','下へ','아래로'],
  hkBack:['Back','前一屏','戻る','뒤로'],hkFwd:['Forward','后一屏','進む','앞으로'],hkPrevBook:['◂ Book','上一本','前の本','이전 책'],hkNextBook:['Book ▸','下一本','次の本','다음 책'],
  hkMark:['Mark ▸','下个书签','しおり ▸','책갈피 ▸'],hkAddMark:['+ Mark','加书签','追加','추가'],hkReverse:['Reverse','反向','逆方向','반대로'],
  hkMarks:['Marks','书签','しおり','책갈피'],hkThumbs:['Pages','缩略图','サムネ','썸네일'],hkShelf:['Shelf','书架','本棚','책장'],hkTools:['Tools','工具栏','ツール','도구'],
  hkStart:['Start','书首','先頭','처음'],hkEnd:['End','书尾','末尾','끝'],hkDelete:['Delete','删记录','記録削除','삭제'],
  hkClick:['Click','单击','クリック','클릭'],hkThumbBar:['Thumbnails','缩略图栏','サムネイル','미리보기'],
  hkMouseL:['Click: turn · Drag: scroll','单击翻屏 · 拖动滚动','クリックでめくる · ドラッグでスクロール','클릭: 넘기기 · 드래그: 스크롤'],
  hkMouseW:['Wheel: scroll · Middle: auto-scroll','滚轮滚动 · 中键自动滚动','ホイールでスクロール · 中ボタンで自動','휠: 스크롤 · 가운데: 자동 스크롤'],
  hkMouseR:['Right click: bookmark panel','右键：书签面板','右クリック：しおりパネル','오른쪽 클릭: 책갈피 패널'],
  // 完整说明（悬停 / 聚焦提示与 aria-label）
  hkTipEsc:['Close the toolbar, the action bar and floating side panels','收起工具栏、操作栏和浮动的侧栏','ツール・操作バー・浮いているパネルを閉じる','도구, 작업 표시줄, 떠 있는 패널 닫기'],
  hkTipUp:['Scroll up; hold to keep going','向上滚动，按住持续滚动','上へスクロール（長押しで連続）','위로 스크롤, 누르고 있으면 계속'],
  hkTipDown:['Scroll down; hold to keep going','向下滚动，按住持续滚动','下へスクロール（長押しで連続）','아래로 스크롤, 누르고 있으면 계속'],
  hkTipSpace:['Scroll down; hold to keep going · Shift+Space: scroll up','向下滚动，按住持续滚动 · Shift+空格：向上','下へスクロール（長押しで連続） · Shift+スペース：上へ','아래로 스크롤, 누르고 있으면 계속 · Shift+스페이스: 위로'],
  hkTipBack:['Tap: back one screen · Hold: previous book','单击：前一屏 · 长按：切到上一本','短押し：1画面戻る · 長押し：前の本','짧게: 한 화면 뒤로 · 길게: 이전 책'],
  hkTipFwd:['Tap: forward one screen · Hold: next book','单击：后一屏 · 长按：切到下一本','短押し：1画面進む · 長押し：次の本','짧게: 한 화면 앞으로 · 길게: 다음 책'],
  hkTipMark:['Tap: next bookmark · Hold: add a bookmark · With Shift: previous bookmark','单击：跳到下一个书签 · 长按：添加书签 · 加 Shift：跳到上一个书签','短押し：次のしおり · 長押し：しおりを追加 · Shift 併用：前のしおり','짧게: 다음 책갈피 · 길게: 책갈피 추가 · Shift와 함께: 이전 책갈피'],
  hkTipShift:['With Space, F or Enter: reverse (scroll up, previous bookmark)','与空格、F、Enter 同按时反向：向上滚动、跳到上一个书签','スペース・F・Enter と同時に押すと逆方向（上へスクロール、前のしおり）','스페이스, F, Enter와 함께 누르면 반대로 (위로 스크롤, 이전 책갈피)'],
  hkTipMarks:['Open or close full-screen shelf bookmarks','打开 / 关闭全屏书架书签','全画面の本棚しおりを開く／閉じる','전체 화면 책장 책갈피 열기 / 닫기'],
  hkTipThumbs:['Open or close full-screen thumbnails','打开 / 关闭全屏缩略图','全画面サムネイルを開く／閉じる','전체 화면 미리보기 열기 / 닫기'],
  hkTipShelf:['Open or close the shelf','打开 / 关闭书架','本棚を開く／閉じる','책장 열기 / 닫기'],hkTipTools:['Show or hide the toolbar','显示 / 隐藏工具栏','ツールの表示／非表示','도구 표시 / 숨기기'],
  hkTipStart:['Start of the book; press again there for the previous book','回到书首；已在书首时再按一次切到上一本','先頭へ。先頭でもう一度押すと前の本','처음으로, 처음에서 다시 누르면 이전 책'],
  hkTipEnd:['End of the book; press again there for the next book','滚到书尾；已在书尾时再按一次切到下一本','末尾へ。末尾でもう一度押すと次の本','끝으로, 끝에서 다시 누르면 다음 책'],
  hkTipDelete:['Delete the current book\'s record (asks first; image files are kept)','删除当前书的记录（需确认，不删除原图）','現在の本の記録を削除（確認あり・元画像は削除しません）','현재 책 기록 삭제 (확인 후 삭제, 원본 이미지는 유지)'],
  hkTipMouseL:['Click the left / right half of the page: back / forward one screen · Drag with the left button: scroll','单击正文左 / 右半屏：前一屏 / 后一屏 · 按住左键拖动：滚动','本文の左／右半分をクリック：1画面戻る／進む · 左ボタンでドラッグ：スクロール','본문 왼쪽 / 오른쪽 절반 클릭: 한 화면 뒤로 / 앞으로 · 왼쪽 버튼 드래그: 스크롤'],
  hkTipMouseW:['Wheel: scroll · Middle click: browser auto-scroll (where supported)','滚轮：滚动 · 中键：浏览器原生自动滚动（需平台支持）','ホイール：スクロール · 中クリック：自動スクロール（対応環境のみ）','휠: 스크롤 · 가운데 클릭: 자동 스크롤 (지원 환경)'],
  hkTipMouseR:['Right click: open the bookmark panel at the pointer','右键：在鼠标处打开书签面板','右クリック：ポインターの位置にしおりパネルを開く','오른쪽 클릭: 포인터 위치에 책갈피 패널 열기'],
  hkTipTop:['Rest the mouse at the top edge: toolbar','鼠标移到顶缘：弹出工具栏','上端にマウス：ツールを表示','위쪽 가장자리에 마우스: 도구 표시'],
  hkTipBottom:['Rest the mouse at the bottom edge: action bar (previous / next book, start / end)','鼠标移到底缘：弹出操作栏（上一本 / 下一本、回到书首 / 滚到书尾）','下端にマウス：操作バー（前の本／次の本、先頭／末尾）','아래쪽 가장자리에 마우스: 작업 표시줄 (이전 / 다음 책, 처음 / 끝)'],
  hkTipLeft:['Rest the mouse at the left edge: shelf bookmarks (when not pinned); the top button opens them full screen','鼠标移到左缘：弹出书架书签（未常驻时）；栏顶按钮：全屏书架书签','左端にマウス：本棚のしおり（固定していないとき） · 上部のボタンで全画面','왼쪽 가장자리에 마우스: 책장 책갈피 (고정하지 않았을 때) · 상단 버튼: 전체 화면'],
  hkTipRight:['Rest the mouse at the right edge: thumbnails (when not pinned); click one to jump there, the top button opens full-screen thumbnails','鼠标移到右缘：弹出缩略图栏（未常驻时）；点击缩略图跳到对应位置，栏顶按钮：全屏缩略图','右端にマウス：サムネイル（固定していないとき） · クリックでその位置へ · 上部のボタンで全画面','오른쪽 가장자리에 마우스: 미리보기 (고정하지 않았을 때) · 클릭하면 해당 위치로 · 상단 버튼: 전체 화면'],
  hkTipHalfL:['Click the left half: back one screen','单击左半屏：前一屏','左半分をクリック：1画面戻る','왼쪽 절반 클릭: 한 화면 뒤로'],
  hkTipHalfR:['Click the right half: forward one screen','单击右半屏：后一屏','右半分をクリック：1画面進む','오른쪽 절반 클릭: 한 화면 앞으로'],
  // 图示下方的补充按键
  hkMoreOverview:['Full-screen views: choose · Space / Enter: open · Esc: close','全屏缩略图 / 书签中：选择 · 空格 / Enter 打开 · Esc 关闭','全画面一覧：選択 · Space / Enter で開く · Esc で閉じる','전체 화면 목록: 선택 · Space / Enter로 열기 · Esc로 닫기'],
  hkMoreSearch:['Shelf: focus the search box','书架页：聚焦搜索框','本棚：検索欄へ移動','책장: 검색창으로 이동'],
  hkMoreShelf:['Shelf: move between books · Enter: open · Delete: delete record (asks first)','书架页：在书之间移动 · Enter 打开 · Delete 删除记录（需确认）','本棚：本を選ぶ · Enter で開く · Delete で記録を削除（確認あり）','책장: 책 사이 이동 · Enter 열기 · Delete 기록 삭제 (확인 후)'],
  hkMoreCopy:['Copy the titles listed on the shelf','复制书架当前筛选出的书名','本棚に表示中の書名をコピー','책장에 표시된 제목 복사']
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
// 有功能的键：tap 键帽上的主标签，hold 长按标签，tip 完整说明（均为文案 key）；shift：加 Shift 反向；mod：Shift 键本身；icon：标签前的小图标。
const up={tap:'hkUp',tip:'hkTipUp'},down={tap:'hkDown',tip:'hkTipDown'},back={tap:'hkBack',hold:'hkPrevBook',tip:'hkTipBack'},fwd={tap:'hkFwd',hold:'hkNextBook',tip:'hkTipFwd'},
  mark={tap:'hkMark',hold:'hkAddMark',shift:true,tip:'hkTipMark'},rev={tap:'hkReverse',mod:true,tip:'hkTipShift'},
  marks={tap:'hkMarks',icon:'overview',tip:'hkTipMarks'},thumbs={tap:'hkThumbs',icon:'overview',tip:'hkTipThumbs'};
export const KEYS={
  Esc:{tap:'hkHide',tip:'hkTipEsc'},W:up,S:down,A:back,D:fwd,F:mark,C:marks,V:thumbs,B:{tap:'hkShelf',tip:'hkTipShelf'},T:{tap:'hkTools',tip:'hkTipTools'},
  ShiftLeft:rev,Space:{tap:'hkDown',shift:true,tip:'hkTipSpace'},
  Enter:mark,ShiftRight:rev,'[':marks,']':thumbs,Home:{tap:'hkStart',tip:'hkTipStart'},End:{tap:'hkEnd',tip:'hkTipEnd'},
  PageUp:{tap:'hkPrevBook',tip:'prev'},PageDown:{tap:'hkNextBook',tip:'next'},Delete:{tap:'hkDelete',tip:'hkTipDelete'},
  ArrowUp:up,ArrowDown:down,ArrowLeft:back,ArrowRight:fwd
};
const NAMES={Insert:'Ins',PageUp:'PgUp',PageDown:'PgDn',Delete:'Del',CapsLock:'Caps',ShiftLeft:'Shift',ShiftRight:'Shift',ControlLeft:'Ctrl',ControlRight:'Ctrl',
  MetaLeft:'Win',AltLeft:'Alt',AltRight:'Alt',ContextMenu:'Menu',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'};
// 鼠标：三个按键，以及阅读区示意（四条边缘呼出、左 / 右半屏单击翻屏）。
export const MOUSE={
  buttons:[{part:'l',label:'hkMouseL',tip:'hkTipMouseL'},{part:'w',label:'hkMouseW',tip:'hkTipMouseW'},{part:'r',label:'hkMouseR',tip:'hkTipMouseR'}],
  areas:[{id:'top',label:'hkTools',tip:'hkTipTop'},{id:'left',label:'shelfmarks',tip:'hkTipLeft'},{id:'half-l',label:'hkBack',tip:'hkTipHalfL'},
    {id:'half-r',label:'hkFwd',tip:'hkTipHalfR'},{id:'right',label:'hkThumbBar',tip:'hkTipRight'},{id:'bottom',label:'endbar',tip:'hkTipBottom'}]
};
// 图示覆盖不到的按键：[[按键…], 说明]，多个按键之间是“或”，“+”表示组合键。
export const MORE=[[['W A S D','↑ ↓ ← →'],'hkMoreOverview'],[['/','Ctrl+F'],'hkMoreSearch'],[['↑ ↓ ← →'],'hkMoreShelf'],[['Ctrl+C'],'hkMoreCopy']];

export function install(ctx){
  const {t,fmt,make}=ctx,dialog=document.getElementById('help'),body=document.getElementById('helpBody'),tip=make('div','hk-tip');
  tip.hidden=true;tip.setAttribute('aria-hidden','true');dialog.append(tip);
  const name=id=>id==='Space'?t('hkSpace'):NAMES[id]??id;
  // 功能项：可聚焦，完整说明写进 aria-label，也是悬停 / 聚焦时的提示。
  function item(el,text,key){el.tabIndex=0;el.setAttribute('role','listitem');el.dataset.tip=key?fmt('hkKeyTip',{key,text}):text;el.setAttribute('aria-label',el.dataset.tip);return el;}
  // 占位键的键名用 ::after 画（极淡），不进入 textContent 和读屏。
  function key(id){
    const f=KEYS[id],el=make('div','hk-key');el.dataset.key=id;
    if(!f){el.dataset.cap=name(id);el.setAttribute('aria-hidden','true');return el;}
    el.classList.add('on');if(f.mod)el.classList.add('mod');if(f.shift)el.classList.add('shift');
    const tap=make('span','hk-tap',t(f.tap));if(f.icon)tap.prepend(ctx.icon(f.icon));
    el.append(make('span','hk-cap',name(id)),tap);if(f.hold)el.append(make('span','hk-hold',t(f.hold)));
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
        if(id&&b-a>=.25){const el=key(id);el.style.gridArea=(i+1)+' / '+(Math.round((a-z.from)*4)+1)+' / auto / span '+Math.round((b-a)*4);
          if(x<z.from){el.classList.add('cut-l');cutL=true;}if(x+w>z.to){el.classList.add('cut-r');cutR=true;}grid.append(el);}
        x+=w;
      }});
    grid.classList.toggle('fade-l',cutL);grid.classList.toggle('fade-r',cutR);
    sec.append(make('h3','',t(z.title)),grid);return sec;
  }
  function mouse(){
    const sec=make('section','hk-zone hk-mouse'),wrap=make('div','hk-mouse-body'),btns=make('div','hk-buttons'),screen=make('div','hk-screen');
    wrap.setAttribute('role','list');wrap.setAttribute('aria-label',t('hkMouse'));
    for(const b of MOUSE.buttons){
      const el=make('div','hk-btn'),ico=make('span','hk-mouse-ico');ico.dataset.part=b.part;ico.setAttribute('aria-hidden','true');ico.append(make('i','l'),make('i','r'),make('i','w'));
      el.dataset.mouse=b.part;el.append(ico,make('span','',t(b.label)));btns.append(item(el,t(b.tip)));
    }
    for(const a of MOUSE.areas){
      const el=make('div','hk-area hk-a-'+a.id);el.dataset.area=a.id;
      if(a.id.startsWith('half'))el.append(make('small','',t('hkClick')));
      el.append(make('span','',t(a.label)));screen.append(item(el,t(a.tip)));
    }
    wrap.append(btns,screen);sec.append(make('h3','',t('hkMouse')),wrap);return sec;
  }
  function more(){
    const list=make('dl','hk-more');
    for(const [alternatives,text] of MORE){
      const line=make('div'),keys=make('dt');
      alternatives.forEach((combo,i)=>{if(i)keys.append(make('span','or','/'));combo.split('+').forEach((k,j)=>{if(j)keys.append('+');keys.append(make('kbd','',k));});});
      line.append(keys,make('dd','',t(text)));list.append(line);
    }
    return list;
  }
  function legend(){
    const p=make('p','hk-legend');
    p.append(make('span','lg-tap',t('hkTap')),make('span','lg-hold',t('hkHold')),make('span','lg-shift',t('hkWithShift')),make('span','lg-hint',t('hkHint')));
    return p;
  }
  // 图例放在标题行（窄窗口时自动换行），省出竖向空间。
  function render(){hide();dialog.querySelector('.hk-legend')?.remove();dialog.querySelector('header>[data-close]').before(legend());body.replaceChildren(...ZONES.map(zone),mouse(),more());}

  // 悬停与键盘焦点是同一个“选中”：显示同一条提示；指针离开后回到焦点所在的项。
  let pointed=null;
  function show(el){
    if(!el?.dataset.tip||!dialog.open){tip.hidden=true;return;}
    tip.textContent=el.dataset.tip;tip.hidden=false;
    const d=dialog.getBoundingClientRect(),r=el.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
    const x=Math.max(8,Math.min(d.width-w-8,r.left+r.width/2-w/2-d.left));
    let y=r.bottom+6-d.top;if(y+h>d.height-8)y=r.top-6-h-d.top;
    tip.style.left=x+'px';tip.style.top=Math.max(8,y)+'px';
  }
  function hide(){pointed=null;tip.hidden=true;}
  const focused=()=>body.contains(document.activeElement)?document.activeElement:null;
  body.addEventListener('pointerover',e=>{const el=e.target.closest('[data-tip]');if(el===pointed)return;pointed=el;show(el||focused());});
  body.addEventListener('pointerleave',()=>{pointed=null;show(focused());});
  body.addEventListener('focusin',e=>show(e.target.closest('[data-tip]')));
  body.addEventListener('focusout',()=>queueMicrotask(()=>show(pointed||focused())));
  body.addEventListener('scroll',()=>{tip.hidden=true;},{passive:true});
  dialog.addEventListener('close',hide);
  render();ctx.on('lang',render);
}
