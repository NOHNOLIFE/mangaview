// 画中画窗口里的播放器面板：可以装进任意文档里的任意容器（mount），真实的画中画窗口（pip.mjs）只是其中一种宿主，
// 自动化测试也把它装进普通容器。它不是另一套播放：曲目、进度、播放列表都是 ctx.media.queue 的同一份，这里只是显示和操作。
// - 自上而下：内容区（当前曲目的画面经 ctx.media.stage.take 搬进来：视频按画面比例完整显示，音频是它的图（art.mjs），字幕照常）、
//   功能栏（.pip-dock）：标题行（文件名居中，与文件栏的标题行同一表现（reader/view.mjs fileName）：点击 / Enter 让主窗口定位到当前曲目，
//   完整路径在悬停提示里；右端只有「固定」，比按钮行的按钮小一号）、播放行（播放 / 暂停 + 进度条（书签与区段标记，可点击拖动）
//   + 时间（悬停换成快退 / 快进，与文件栏同一份控件））、按钮行（左组：上一个、下一个、循环范围（三态轮换，图标随状态）、
//   只播放书签区段（与总控栏的开关是同一个偏好，图标、说明相同）；右组：过滤（悬停 / 聚焦 / 点击弹出二级按钮：音频、视频、只含书签；
//   有任何过滤生效时显示为按下）、收藏列表（最右，菜单见 pipfav.mjs））。三行共用同一个左右内边距（pipview.css）。播放列表在窗口右侧（piplist.mjs）。
//   按钮只有图标，文字在 tooltip 与 aria-label；状态随 'media' / 'queue' / 'transport' 事件同步（偏好在别的窗口改了也一样）。
// - 「固定」（布局类偏好 'pipPin'，默认不固定）：功能栏与播放列表一起切换。固定时功能栏常显在内容区下方、列表停靠在右侧；
//   不固定时两者收起、内容区占满：鼠标移到面板下部（功能栏所在的高度）稍停即浮在内容区上淡入，移开稍等淡出
//   （键盘聚焦其中、过滤或收藏菜单开着时不淡出）；列表靠近右缘浮出（piplist.mjs，功能栏的高度范围内不触发）。
// - 真实的画中画窗口（mount 的 resize 选项）里切换「固定」时保持内容区的大小：在点击的手势里同步调用窗口的 resizeBy
//   （需要用户激活并消耗它，每次手势只能调整一次，所以不做逐帧动画），等窗口的 'resize' 再切换布局（设超时兜底），两者落在同一帧；
//   目标尺寸见 core/pip.mjs pinResize。浏览器拒绝、或被屏幕与尺寸上限截断时照常切换布局，由内容区让出空间。普通容器里不调整窗口。
// - 画中画窗口的标题（document.title）是当前曲目的文件名（与标题行相同），没有曲目时是主窗口的标题（应用名）。
// - 内容区的画面不在这里时（在页内播放、没有曲目）显示占位：说明正在主窗口播放 + 「在画中画显示」按钮（stage.take 收进来）；没有曲目时是一句说明。
// - 内容区与主窗口的画面是同一套交互（media/surface.mjs 的 ctx.media.surface）：单击（没有拖动）= 播放 / 暂停当前曲目，按住横向拖动 =
//   快进 / 快退（同一套判定与换算），按钮（占位的「在画中画显示」）、带 data-nodrag 的元素除外；竖向拖动什么也不做。
// - 提示浮层（hud.mjs，与主窗口同一个组件、同一套样式，在内容区中上部，按内容区大小缩放）：这个面板里发生的操作——内容区的拖动、
//   窗口里的按键（← → / A D、Q / E）、时间处的快退 / 快进——提示都显示在这里，不显示到主窗口。
// - 按键（装在 keys 上：画中画窗口是它的 window，普通容器是容器本身；处理过的按键不再冒泡，不会作用到主窗口的全局快捷键）：
//   空格 播放 / 暂停；← → / A D 点按 2 秒、按住递增快退 / 快进（ctx.pageHold，与长按 A / D 同一份逻辑）；↑ ↓ 在列表里移动选中项，Enter 播放它；
//   Q / ; 、E / ' 音量（提示带音量条）。焦点在按钮上时空格、Enter 交给按钮；菜单、输入框里的按键不在这里处理。
// - 装进别的文档时自带所需的样式表（STYLES）、图标 sprite、lang 属性，并对那个窗口接上拖动滚动（ui/dragscroll.mjs install）；
//   主文档上靠 document 委托的东西（全局点击分派、快捷键）在那里不生效，面板里只用元素自己的事件（悬停弹层 ui/hoverpop.mjs 按按钮所在的文档工作）。
// - 尺寸：容器是 size 查询容器（pip）；内容区占去其余高度（画面 object-fit 保持比例），窗口变矮时依次收起按钮行、标题行，
//   变窄时收起时间、按钮行的按钮等分缩小、固定的播放列表改为浮出，任何尺寸都不溢出容器（pipview.css）。
// mount(容器, {keys, resize}) → {root, screen（交给 stage.take 的容器）, ready（样式表载入完成的 Promise）, destroy()}；resize 为真时切换「固定」
// 会调整容器所在窗口的大小（只给真实的画中画窗口）；destroy 时画面若在这里，先收回页内。
import { extend } from '../core/lang.mjs';
import { shownName, stem, nudge } from '../core/model.mjs';
import { nextScope, toggleType } from '../core/playlist.mjs';
import { pinResize, SIDE, DOCK_MIN } from '../core/pip.mjs';
import { install as dragScroll } from '../ui/dragscroll.mjs';
import { morePop } from '../ui/hoverpop.mjs';
import { fileName } from '../reader/view.mjs';
import { audioArt } from './art.mjs';
import { playlist } from './piplist.mjs';
import { favorites } from './pipfav.mjs';

extend({
  pipPanel: ['Picture-in-picture', '画中画', 'ピクチャーインピクチャー', 'PIP 화면'],
  pipHere: ['Playing in the main window', '正在主窗口播放', 'メインウィンドウで再生中', '메인 창에서 재생 중'],
  pipShow: ['Show here', '在画中画显示', 'ここに表示', '여기에 표시'],
  pipEmpty: [
    'Nothing is playing. Click a video or audio in the reader to play it.',
    '没有正在播放的媒体。在阅读区点视频或音频即可播放。',
    '再生中のメディアはありません。リーダーで動画か音声をクリックすると再生します。',
    '재생 중인 미디어가 없습니다. 리더에서 동영상이나 오디오를 클릭하면 재생됩니다.',
  ],
  pipList: ['Play list', '播放列表', '再生リスト', '재생 목록'],
  pipFav: ['Saved play lists', '收藏列表', '保存したリスト', '저장된 목록'],
  pipPin: [
    'Pin the controls and the play list',
    '固定功能栏与播放列表',
    'コントロールと再生リストを固定',
    '컨트롤과 재생 목록 고정',
  ],
  pipLoopList: ['Loop: play list', '循环：列表', 'ループ：リスト', '반복: 목록'],
  pipFilter: ['Filter', '过滤', 'フィルター', '필터'],
  pipAudio: ['Type: audio', '类型：音频', '種類：音声', '유형: 오디오'],
  pipVideo: ['Type: video', '类型：视频', '種類：動画', '유형: 동영상'],
  pipMarked: ['Only files with bookmarks', '只含书签', 'しおりのあるファイルだけ', '책갈피가 있는 파일만'],
});
// 装进别的文档时链接的样式表（相对本文件）：全局样式与深色主题变量、播放器（进度条、时间、字幕容器）、书签标记、
// 书签角标（.mk，播放列表的书签标记位）、音频的图、字幕、文件详情框、本面板。
const STYLES = [
  '../style.css',
  './shell.css',
  './media.css',
  '../marks/bookmarks.css',
  './art.css',
  './subtitles.css',
  './filecard.css',
  './pipview.css',
  './piplist.css',
  './pipfav.css',
];
const lastPart = (s) => s.slice(s.lastIndexOf('/') + 1);
const SCOPE_ICON = { file: 'loop-file', list: 'loop-book', books: 'loop-books' },
  SCOPE_LABEL = { file: 'cbLoopFile', list: 'pipLoopList', books: 'cbLoopBooks' };
const PIN = 'pipPin',
  DWELL = 150, // 浮出前的停留（毫秒），防误触（与主窗口的侧栏一致）
  LEAVE = 400, // 指针离开后多久淡出
  RESIZED = 300; // 调整窗口大小后最多等这么久的 'resize'，之后照常切换布局

// 文档里还没有的样式表补上，返回全部载入（或失败、超时）的 Promise。
function styles(doc) {
  const have = new Set([...doc.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href));
  const loads = [];
  for (const s of STYLES) {
    const href = new URL(s, import.meta.url).href;
    if (have.has(href)) continue;
    const l = doc.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    loads.push(
      new Promise((r) => {
        l.onload = l.onerror = r;
        setTimeout(r, 2000);
      }),
    );
    doc.head.append(l);
  }
  return Promise.all(loads);
}

export function install(ctx) {
  const { t, make, icon } = ctx;
  const Q = () => ctx.media.queue,
    M = () => ctx.media;
  ctx.prefs.add(PIN);
  const views = new Set();
  const each = (fn) => {
    for (const v of views) fn(v);
  };
  ctx.on('media', (key) => each((v) => v.media(key)));
  ctx.on('queue', (key) => each((v) => v.queue(key)));
  ctx.on('transport', (field) => field === 'sectionsOnly' && each((v) => v.states()));
  ctx.on('marks', (book) => each((v) => v.marks(book)));
  ctx.on('synced', (book, keys) => keys.includes('bookmarks') && each((v) => v.marks(book)));
  ctx.on('lang', () => each((v) => v.lang()));
  const wired = new WeakSet(); // 已接上拖动滚动的窗口

  return function mount(box, { keys = box, resize = false } = {}) {
    const doc = box.ownerDocument,
      win = doc.defaultView,
      own = doc !== document;
    const ready = styles(doc);
    if (own) {
      if (!doc.querySelector('svg.sprite')) doc.body.prepend(document.querySelector('svg.sprite').cloneNode(true));
      doc.documentElement.lang = document.documentElement.lang;
      if (!wired.has(win)) {
        wired.add(win);
        dragScroll(win);
      }
    }
    // 播放器：当前曲目的（与主窗口的当前文件无关），没有为 null。
    const tp = () => M().track?.() ?? null;

    // ---- DOM
    // 按钮：鼠标点击不夺焦点（之后按空格仍是播放 / 暂停，不会再点一次它）；键盘仍可 Tab 聚焦。
    function btn(id, name, label, action, cls = '') {
      const b = ctx.iconButton(name, t(label), action, cls);
      b.dataset.id = id;
      b.dataset.label = label;
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') e.preventDefault();
      });
      return b;
    }
    const setIcon = (b, name) => b.querySelector('use').setAttribute('href', '#i-' + name);
    const setLabel = (b, key) => {
      b.dataset.label = key;
      const s = t(key);
      if (b.title !== s) b.title = s;
      if (b.getAttribute('aria-label') !== s) b.setAttribute('aria-label', s);
    };
    const press = (b, on) => b.setAttribute('aria-pressed', String(!!on));
    const root = make('div', 'pip'),
      body = make('div', 'pip-body'),
      stage = make('div', 'pip-stage'),
      art = make('div', 'pip-art-box'),
      screen = make('div', 'pip-screen'),
      idle = make('div', 'pip-idle'),
      dock = make('div', 'pip-dock'),
      head = make('div', 'pip-head'),
      name = make('div', 'pip-name'),
      pinBox = make('div', 'pip-head-end'),
      line = make('div', 'pip-line'),
      tools = make('div', 'pip-tools');
    stage.append(art, screen, idle);
    // 提示浮层：这个面板里的操作的提示都在这里（见文件开头）。
    const hud = M().hud(stage);
    const play = btn('play', 'play', 'mvPlay', () => Q().toggle(), 'pip-play'),
      seek = ctx.player.seekBar(() => tp()),
      time = ctx.player.timeBox(() => tp(), 'pip-time', hud);
    line.append(play, seek.bar, time.box);
    const pinBtn = btn('pin', 'pin', 'pipPin', () => pin(!pinned), 'pip-pin');
    pinBox.append(pinBtn);
    head.append(name, pinBox);
    // 按钮行：左组（上一个、下一个、循环范围、只播放书签区段），右组（过滤、收藏列表）。
    const B = {
      prev: btn('prev', 'skip-back', 'cbMediaPrev', () => Q().prev()),
      next: btn('next', 'skip-forward', 'cbMediaNext', () => Q().next()),
      scope: btn('scope', 'loop-book', 'pipLoopList', () => Q().setScope(nextScope(Q().scope))),
      sections: btn('sections', 'sections', 'mvSections', () =>
        ctx.transport.setSectionsOnly(!ctx.transport.sectionsOnly),
      ),
      filter: btn('filter', 'filter', 'pipFilter', () => {}, 'pip-right'),
      fav: btn('fav', 'star', 'pipFav', () => {}),
    };
    tools.append(...Object.values(B));
    // 过滤的二级按钮：弹出层里的开关，点了不收起（keep-pop）。
    const pop = make('div', 'pip-pop'),
      F = {
        audio: btn('audio', 'music', 'pipAudio', () => Q().setTypes(toggleType(Q().types, 'audio')), 'keep-pop'),
        video: btn('video', 'film', 'pipVideo', () => Q().setTypes(toggleType(Q().types, 'video')), 'keep-pop'),
        marked: btn('marked', 'bookmark', 'pipMarked', () => Q().setMarked(!Q().marked), 'keep-pop'),
      };
    pop.append(...Object.values(F));
    dock.append(head, line, tools);
    body.append(stage, dock);
    root.append(body);
    box.append(root);
    root.append(pop); // 弹出层与按钮在同一个文档里（hoverpop 按按钮所在的文档定位）
    const filterPop = morePop(B.filter, pop);

    // ---- 浮出：功能栏（不固定时）与播放列表（不固定或太窄时）。want(是否显示, 延迟)；busy() 为真时不收起（check() 在它变化后补收起）；
    // changed(是否显示) 在类切换之后调用。
    function peeker(cls, busy, changed = () => {}) {
      let target = false,
        timer = 0;
      const shown = () => root.classList.contains(cls);
      const set = (v) => {
        if (shown() === v) return;
        root.classList.toggle(cls, v);
        changed(v);
      };
      const apply = () => {
        timer = 0;
        if (!target && busy()) return;
        set(target);
      };
      return {
        shown,
        want(v, ms = v ? DWELL : LEAVE) {
          if (v === target && (timer || shown() === v)) return;
          target = v;
          clearTimeout(timer);
          timer = 0;
          if (ms) timer = setTimeout(apply, ms);
          else apply();
        },
        check() {
          if (!target && !timer && shown() && !busy()) set(false);
        },
      };
    }
    let pinned = ctx.get(PIN, false) === true;
    const dockBusy = () => dock.matches(':hover') || dock.matches(':focus-within') || filterPop.open() || fav.open();
    const dockPeek = peeker('dock-peek', dockBusy);
    const fav = favorites(ctx, { root, button: B.fav, onClose: () => dockPeek.check() });
    pop.addEventListener('toggle', () => queueMicrotask(() => dockPeek.check()));
    dock.addEventListener('focusin', () => pinned || dockPeek.want(true, 0));
    dock.addEventListener('focusout', () => queueMicrotask(() => dockPeek.check()));
    const L = playlist(ctx, { win, root, peeker });
    root.append(L.side);
    // 「固定」：功能栏与列表一起切换布局。
    function layout(on) {
      root.classList.toggle('pinned', on);
      // 取消固定时指针就在功能栏上：保持浮出，移开再淡出。
      dockPeek.want(!on, 0);
      L.pin();
    }
    let resizing = null; // 等待窗口 'resize' 的 {on, done}
    function pin(on) {
      pinned = on;
      ctx.put(PIN, on);
      press(pinBtn, on);
      resizing?.done(false);
      if (!resize) return layout(on);
      // 真实的画中画窗口：内容区保持原来的大小，改为调整窗口（见文件开头）。
      const r = pinResize({
        on,
        width: win.innerWidth,
        height: win.innerHeight,
        side: SIDE,
        dock: dock.offsetHeight,
        dockMin: DOCK_MIN,
      });
      if (!r.dw && !r.dh) return layout(on);
      let timer = 0;
      const done = (apply = true) => {
        if (resizing?.done !== done) return;
        resizing = null;
        clearTimeout(timer);
        win.removeEventListener('resize', onResize);
        if (apply) layout(on);
      };
      const onResize = () => done();
      resizing = { on, done };
      win.addEventListener('resize', onResize);
      timer = setTimeout(done, RESIZED);
      try {
        win.resizeBy(r.dw, r.dh);
      } catch {
        done();
      }
    }
    root.classList.toggle('pinned', pinned);
    press(pinBtn, pinned);
    // 指针在面板上移动：下部（功能栏所在的高度）浮出功能栏；右缘浮出播放列表（piplist.mjs），功能栏的高度范围内右缘不触发。
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const b = body.getBoundingClientRect(),
        band = e.clientY >= b.bottom - dock.offsetHeight && e.clientY <= b.bottom;
      if (!pinned) dockPeek.want(e.clientX >= b.left && e.clientX <= b.right && band);
      L.hover(e, band);
    });
    root.addEventListener('pointerleave', () => {
      dockPeek.want(false);
      L.hide();
    });
    // 浮出的操作面板盖在内容区上时，字幕让到它上面（--dock-h）。
    const dockSize = new win.ResizeObserver(() => root.style.setProperty('--dock-h', dock.offsetHeight + 'px'));
    dockSize.observe(dock);

    // ---- 内容区与状态
    let artPage = null,
      idleKey = '',
      named = null,
      drawn = null; // 书签标记按哪个播放器、哪个时长画的
    function here() {
      const st = M().stage;
      return !!Q().track() && st.container === screen && !!st.screen();
    }
    function paintStage() {
      const tr = Q().track(),
        shown = here();
      stage.dataset.kind = tr?.kind ?? '';
      stage.classList.toggle('away', !shown);
      // 音频：书的封面或按文件名配色的占位图（画面在不在这里都显示）。
      if (tr?.kind === 'audio') {
        if (artPage !== tr.page) {
          artPage = tr.page;
          art.replaceChildren(audioArt(ctx, make('span', 'pip-art'), tr.book, tr.page));
        }
      } else if (artPage) {
        artPage = null;
        art.replaceChildren();
      }
      idle.hidden = shown;
      // 占位的内容只在类型、语言变了时重建（不打断键盘焦点）。
      const key = shown ? '' : (tr?.kind ?? 'none') + ':' + ctx.lang;
      if (key && key !== idleKey) {
        if (tr) {
          const go = make('button', 'pip-show');
          go.type = 'button';
          go.append(icon('pip'), make('span', '', t('pipShow')));
          go.addEventListener('click', () => M().stage.take(screen));
          idle.replaceChildren(icon(tr.kind === 'audio' ? 'music' : 'film'), make('p', '', t('pipHere')), go);
        } else idle.replaceChildren(make('p', '', t('pipEmpty')));
      }
      idleKey = key;
    }
    // 标题行的文件名（点击定位当前曲目），真实窗口的标题随之更新。
    function paintName() {
      const tr = Q().track();
      if (tr?.page === named) return;
      named = tr?.page ?? null;
      if (own) doc.title = named ? stem(lastPart(shownName(named))) : document.title;
      if (!named) return name.replaceChildren();
      name.replaceChildren(fileName(named, () => Q().locate()));
    }
    function states() {
      const tr = Q().track(),
        p = tp(),
        on = Q().playing(),
        q = Q();
      setIcon(play, on ? 'pause' : 'play');
      setLabel(play, on ? 'mvPause' : 'mvPlay');
      play.disabled = !tr;
      time.sync(p);
      line.classList.toggle('playing', on);
      stage.classList.toggle('playing', on);
      stage.classList.toggle('nosubs', !!p?.node.classList.contains('mv-nosubs'));
      B.prev.disabled = !q.canStep(-1);
      B.next.disabled = !q.canStep(1);
      setIcon(B.scope, SCOPE_ICON[q.scope]);
      setLabel(B.scope, SCOPE_LABEL[q.scope]);
      B.scope.dataset.scope = q.scope;
      press(B.filter, q.filtering());
      press(F.audio, q.types.includes('audio'));
      press(F.video, q.types.includes('video'));
      press(F.marked, q.marked);
      press(B.sections, ctx.transport.sectionsOnly);
    }
    function progress() {
      const p = tp(),
        text = ctx.player.paintBar(seek, p);
      time.text.textContent = p ? text : '';
      const d = p ? ctx.player.api.duration(p) : null;
      if (drawn?.p !== p || drawn.d !== d) {
        drawn = { p, d };
        paintStage();
        paintName();
        time.size(d);
        ctx.player.drawMarks?.(seek.bar, p);
      }
    }
    function refresh() {
      paintStage();
      paintName();
      states();
      progress();
      L.paint();
    }

    // ---- 内容区的交互（media/surface.mjs）：单击播放 / 暂停当前曲目，横向拖动定位，提示在这个面板里。
    const unsurface = M().surface(stage, {
      player: () => tp(),
      seek: (e) => !e.target.closest('button'),
      play: (t) => !t.closest('button'),
      press: () => Q().toggle(),
      hud: () => hud,
      tap: true,
    });

    // ---- 按键
    let holding = null;
    function stopHold() {
      if (!holding) return;
      holding = null;
      ctx.pageHold?.stop();
    }
    function down(e) {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target?.nodeType === 1 ? e.target : null;
      if (tg?.closest('input,textarea,[contenteditable="true"],.pip-menu')) return;
      const k = e.key,
        low = k.toLowerCase();
      if (tg?.closest('button') && (k === ' ' || k === 'Enter')) return e.stopPropagation();
      if (k === ' ') {
        if (!e.repeat) Q().toggle();
      } else if (['arrowleft', 'arrowright', 'a', 'd'].includes(low)) {
        if (!e.repeat && !holding && Q().track()) {
          holding = e.code;
          ctx.pageHold?.start(low === 'arrowleft' || low === 'a' ? -1 : 1, tp(), hud);
        }
      } else if (low === 'arrowup' || low === 'arrowdown') {
        L.move(low === 'arrowup' ? -1 : 1);
      } else if (k === 'Enter') {
        if (!e.repeat) L.enter();
      } else if (
        low === 'q' ||
        low === ';' ||
        e.code === 'Semicolon' ||
        low === 'e' ||
        low === "'" ||
        e.code === 'Quote'
      ) {
        const d = low === 'q' || low === ';' || e.code === 'Semicolon' ? -1 : 1;
        M().setVolume(nudge(M().volume, d), hud);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    }
    function up(e) {
      if (!holding || e.code !== holding) return;
      stopHold();
      e.stopPropagation();
    }
    keys.addEventListener('keydown', down);
    keys.addEventListener('keyup', up);
    win.addEventListener('blur', stopHold);

    // ---- 更新（这个窗口的动画帧：主窗口在后台时画中画照常更新）
    let frame = 0;
    function later() {
      if (!frame)
        frame = win.requestAnimationFrame(() => {
          frame = 0;
          refresh();
        });
    }
    function labels() {
      for (const b of root.querySelectorAll('button[data-label]')) setLabel(b, b.dataset.label);
      root.setAttribute('aria-label', t('pipPanel'));
      seek.bar.setAttribute('aria-label', t('mvSeek'));
      time.labels();
      L.lang();
      if (own) doc.documentElement.lang = document.documentElement.lang;
    }
    const view = {
      media(key) {
        if (key === 'time') return progress();
        if (key === 'state') {
          states();
          progress();
          return L.paint();
        }
        if (key === 'volume' || key === 'current') return; // 当前文件（主窗口滚动）与面板无关：面板只显示当前曲目
        if (key === 'track') L.track();
        later();
      },
      queue(key) {
        if (key === 'list') {
          L.relist();
          fav.refresh();
        }
        if (key === 'favorites') fav.refresh();
        states();
      },
      states,
      marks(book) {
        const p = tp();
        if (p?.book === book) ctx.player.drawMarks?.(seek.bar, p);
      },
      lang() {
        labels();
        fav.refresh();
        later();
      },
    };
    views.add(view);
    labels();
    L.relist();
    refresh();
    ready.then(() => win.requestAnimationFrame(() => L.reveal(true)));
    return {
      root,
      screen,
      ready,
      destroy() {
        if (!views.delete(view)) return;
        stopHold();
        L.destroy();
        filterPop.hide();
        fav.close();
        unsurface();
        hud.hide();
        dockSize.disconnect();
        keys.removeEventListener('keydown', down);
        keys.removeEventListener('keyup', up);
        win.removeEventListener('blur', stopHold);
        if (M().stage.container === screen) M().stage.drop();
        root.remove();
      },
    };
  };
}
