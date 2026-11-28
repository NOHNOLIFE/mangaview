// 画中画窗口里的播放器面板：可以装进任意文档里的任意容器（mount），真实的画中画窗口（pip.mjs）只是其中一种宿主，
// 自动化测试也把它装进普通容器。它不是另一套播放：曲目、进度、播放列表都是 ctx.media.queue 的同一份，这里只是显示和操作。
// - 自上而下：内容区（当前曲目的画面经 ctx.media.stage.take 搬进来：视频按画面比例完整显示，音频是它的图（art.mjs），字幕照常）、
//   标题行（文件名，末尾依次是「固定操作面板」「播放列表」「收藏列表」三个按钮）、操作面板（播放 / 暂停 + 进度条（书签与区段标记，
//   可点击拖动）+ 时间（悬停换成快退 / 快进，与文件栏同一份控件）；按钮行：上一个、下一个、循环范围（三态轮换，图标随状态）、
//   过滤（悬停 / 聚焦 / 点击弹出二级按钮：音频、视频、只含书签；有任何过滤生效时显示为按下）、只播放书签区段（与总控栏的开关是同一个偏好，
//   图标、说明相同），「定位」在最右）。播放列表在窗口右侧（piplist.mjs），收藏列表的菜单见 pipfav.mjs。
//   按钮只有图标，文字在 tooltip 与 aria-label；状态随 'media' / 'queue' / 'transport' 事件同步（偏好在别的窗口改了也一样）。
// - 操作面板的固定（布局类偏好 'pipDock'，默认固定）：固定时标题行与操作面板常显在内容区下方；不固定时两者收起、内容区占满，
//   鼠标移到面板下部（它们原来所在的高度）稍停即浮在内容区上弹出，移开淡出（键盘聚焦其中、过滤或收藏菜单开着时不淡出）。
// - 内容区的画面不在这里时（在页内播放、没有曲目）显示占位：说明正在主窗口播放 + 「在画中画显示」按钮（stage.take 收进来）；没有曲目时是一句说明。
// - 内容区上按住横向拖动即快进 / 快退当前曲目（media/scrub.mjs 的 ctx.media.scrubArea，与主窗口同一套判定与换算），提示显示在面板自己的浮层里。
// - 按键（装在 keys 上：画中画窗口是它的 window，普通容器是容器本身；处理过的按键不再冒泡，不会作用到主窗口的全局快捷键）：
//   空格 播放 / 暂停；← → / A D 点按 2 秒、按住递增快退 / 快进（ctx.pageHold，与长按 A / D 同一份逻辑）；↑ ↓ 在列表里移动选中项，Enter 播放它；
//   Q / ; 、E / ' 音量。焦点在按钮上时空格、Enter 交给按钮；菜单、输入框里的按键不在这里处理。
// - 装进别的文档时自带所需的样式表（STYLES）、图标 sprite、lang 属性，并对那个窗口接上拖动滚动（ui/dragscroll.mjs install）；
//   主文档上靠 document 委托的东西（全局点击分派、快捷键）在那里不生效，面板里只用元素自己的事件（悬停弹层 ui/hoverpop.mjs 按按钮所在的文档工作）。
// - 尺寸：容器是 size 查询容器（pip）；内容区占去其余高度（画面 object-fit 保持比例），窗口变矮时依次收起按钮行、标题行，
//   变窄时收起时间、固定的播放列表改为浮出，任何尺寸都不溢出容器（pipview.css）。
// mount(容器, {keys}) → {root, screen（交给 stage.take 的容器）, ready（样式表载入完成的 Promise）, destroy()}；destroy 时画面若在这里，先收回页内。
import { extend } from '../core/lang.mjs';
import { shownName, stem, nudge } from '../core/model.mjs';
import { nextScope, toggleType } from '../core/playlist.mjs';
import { install as dragScroll } from '../ui/dragscroll.mjs';
import { morePop } from '../ui/hoverpop.mjs';
import { midName } from '../reader/view.mjs';
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
  pipDock: ['Pin the controls', '固定操作面板', 'コントロールを固定', '컨트롤 고정'],
  pipLoopList: ['Loop: play list', '循环：列表', 'ループ：リスト', '반복: 목록'],
  pipFilter: ['Filter', '过滤', 'フィルター', '필터'],
  pipAudio: ['Type: audio', '类型：音频', '種類：音声', '유형: 오디오'],
  pipVideo: ['Type: video', '类型：视频', '種類：動画', '유형: 동영상'],
  pipMarked: ['Only files with bookmarks', '只含书签', 'しおりのあるファイルだけ', '책갈피가 있는 파일만'],
});
// 装进别的文档时链接的样式表（相对本文件）：全局样式与深色主题变量、播放器（进度条、时间、字幕容器）、书签标记、音频的图、字幕、文件详情框、本面板。
const STYLES = [
  '../style.css',
  './shell.css',
  './media.css',
  './art.css',
  './subtitles.css',
  './filecard.css',
  './pipview.css',
  './piplist.css',
  './pipfav.css',
];
const SCOPE_ICON = { file: 'loop-file', list: 'loop-book', books: 'loop-books' },
  SCOPE_LABEL = { file: 'cbLoopFile', list: 'pipLoopList', books: 'cbLoopBooks' };
const DOCK = 'pipDock',
  DWELL = 150, // 浮出前的停留（毫秒），防误触
  LEAVE = 400; // 指针离开后多久淡出

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
  ctx.prefs.add(DOCK);
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

  return function mount(box, { keys = box } = {}) {
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
      hud = make('div', 'pip-hud'),
      dock = make('div', 'pip-dock'),
      head = make('div', 'pip-head'),
      name = make('div', 'pip-name'),
      line = make('div', 'pip-line'),
      tools = make('div', 'pip-tools');
    hud.hidden = true;
    hud.setAttribute('aria-hidden', 'true');
    stage.append(art, screen, idle, hud);
    const play = btn('play', 'play', 'mvPlay', () => Q().toggle(), 'pip-play'),
      seek = ctx.player.seekBar(() => tp()),
      time = ctx.player.timeBox(() => tp(), 'pip-time');
    line.append(play, seek.bar, time.box);
    const H = {
      dock: btn('dock', 'pin', 'pipDock', () => pinDock(!dockPinned), 'pip-hb'),
      list: btn('list', 'playlist', 'pipList', () => {}, 'pip-hb'),
      fav: btn('fav', 'star', 'pipFav', () => {}, 'pip-hb'),
    };
    head.append(name, ...Object.values(H));
    const B = {
      prev: btn('prev', 'skip-back', 'cbMediaPrev', () => Q().prev()),
      next: btn('next', 'skip-forward', 'cbMediaNext', () => Q().next()),
      scope: btn('scope', 'loop-book', 'pipLoopList', () => Q().setScope(nextScope(Q().scope))),
      filter: btn('filter', 'filter', 'pipFilter', () => {}),
      sections: btn('sections', 'sections', 'mvSections', () =>
        ctx.transport.setSectionsOnly(!ctx.transport.sectionsOnly),
      ),
      locate: btn('locate', 'locate', 'fbLocate', () => Q().locate(), 'pip-locate'),
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

    // ---- 浮出：操作面板（不固定时）与播放列表（不固定时）。want(是否显示, 延迟)；busy() 为真时不收起（check() 在它变化后补收起）。
    function peeker(cls, busy) {
      let target = false,
        timer = 0;
      const shown = () => root.classList.contains(cls);
      const apply = () => {
        timer = 0;
        if (!target && busy()) return;
        root.classList.toggle(cls, target);
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
          if (!target && !timer && shown() && !busy()) root.classList.remove(cls);
        },
      };
    }
    let dockPinned = ctx.get(DOCK, true) !== false;
    const dockBusy = () => dock.matches(':hover') || dock.matches(':focus-within') || filterPop.open() || fav.open();
    const dockPeek = peeker('dock-peek', dockBusy);
    function pinDock(on) {
      dockPinned = on;
      ctx.put(DOCK, on);
      root.classList.toggle('dock-pinned', on);
      press(H.dock, on);
      // 取消固定时指针就在面板上：保持弹出，移开再淡出。
      dockPeek.want(!on, 0);
    }
    root.classList.toggle('dock-pinned', dockPinned);
    press(H.dock, dockPinned);
    const fav = favorites(ctx, { root, button: H.fav, onClose: () => dockPeek.check() });
    pop.addEventListener('toggle', () => queueMicrotask(() => dockPeek.check()));
    dock.addEventListener('focusin', () => dockPinned || dockPeek.want(true, 0));
    dock.addEventListener('focusout', () => queueMicrotask(() => dockPeek.check()));
    const L = playlist(ctx, { win, root, button: H.list, peeker });
    root.append(L.side);
    // 指针在面板上移动：下部（操作面板原来的高度）弹出操作面板；右缘弹出播放列表（piplist.mjs）。
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (!dockPinned) {
        const b = body.getBoundingClientRect();
        dockPeek.want(e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.bottom - dock.offsetHeight);
      }
      L.hover(e);
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
    function paintName() {
      const tr = Q().track();
      if (tr?.page === named) return;
      named = tr?.page ?? null;
      if (!named) return name.replaceChildren();
      const full = shownName(named),
        n = midName(stem(full.slice(full.lastIndexOf('/') + 1)));
      n.title = full;
      n.dataset.nodrag = '';
      name.replaceChildren(n);
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
      B.locate.disabled = !tr;
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

    // ---- 提示（音量、横向拖动定位）：ms 为 0 时常显，直到 hideHud。
    let hudTimer = 0;
    function showHud(name, text, ms = 900) {
      hud.replaceChildren(icon(name), make('span', '', text));
      hud.hidden = false;
      clearTimeout(hudTimer);
      if (ms) hudTimer = setTimeout(() => (hud.hidden = true), ms);
    }
    function hideHud(ms) {
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => (hud.hidden = true), ms);
    }
    const unscrub = M().scrubArea?.(stage, { show: (n, s) => showHud(n, s, 0), hide: hideHud });

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
          ctx.pageHold?.start(low === 'arrowleft' || low === 'a' ? -1 : 1, tp());
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
        ctx.media.setVolume(nudge(ctx.media.volume, d));
        showHud(ctx.media.volIcon(), Math.round(ctx.media.volume * 100) + '%');
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
        unscrub?.();
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
