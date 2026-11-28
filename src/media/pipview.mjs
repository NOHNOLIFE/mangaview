// 画中画窗口里的播放器面板：可以装进任意文档里的任意容器（mount），真实的画中画窗口（pip.mjs）只是其中一种宿主，
// 自动化测试也把它装进普通容器。它不是另一套播放：曲目、进度、播放列表都是 ctx.media.queue 的同一份，这里只是显示和操作。
// - 自上而下：内容区（当前曲目的画面经 ctx.media.stage.take 搬进来：视频按画面比例显示，音频是它的图（art.mjs），字幕照常）、文件名、
//   播放 / 暂停 + 进度条（书签与区段标记，可点击拖动）+ 时间（悬停换成快退 / 快进，与文件栏同一份控件）、一行按钮（上一个、下一个、定位、
//   循环范围（三态轮换，图标随状态）、随机、音频 / 视频类型开关、停止），其下是播放列表。按钮只有图标，文字在 tooltip 与 aria-label；
//   状态随 'media' / 'queue' 事件同步（偏好在别的窗口改了也一样，queue.mjs 转发）。
// - 内容区的画面不在这里时（在页内播放、没有曲目）显示占位：说明正在主窗口播放 + 「在画中画显示」按钮（stage.take 收进来）；没有曲目时是一句说明。
// - 播放列表：只显示文件名（最末一段、不带扩展名），当前曲目高亮；固定行高、只渲染可视范围（core/pip.mjs span），数百项也不卡；
//   装好时滚到当前曲目，之后当前曲目变了且用户没在列表上悬停、刚滚动过时才跟过去。点击只播放（queue.play，主窗口不跳转）；
//   每项的「定位」「移除」只在悬停 / 选中的项上显示，位置固定。悬停 / 聚焦显示文件详情框（ctx.fileCard.within(窗口)，放不下时退回 title）。
// - 按键（装在 keys 上：画中画窗口是它的 window，普通容器是容器本身；处理过的按键不再冒泡，不会作用到主窗口的全局快捷键）：
//   空格 播放 / 暂停；← → / A D 点按 2 秒、按住递增快退 / 快进（ctx.pageHold，与长按 A / D 同一份逻辑）；↑ ↓ 在列表里移动选中项，Enter 播放它；
//   Q / ; 、E / ' 音量。焦点在按钮上时空格、Enter 交给按钮。
// - 装进别的文档时自带所需的样式表（STYLES）、图标 sprite、lang 属性，并对那个窗口接上拖动滚动（ui/dragscroll.mjs install）；
//   主文档上靠 document 委托的东西（悬停弹层、全局点击分派、快捷键）在那里不生效，面板里只用元素自己的事件。
// - 尺寸：容器是 size 查询容器；内容区的高度按宽度和画面比例，窗口变矮时先压缩列表区（flex-basis 0），再压缩内容区（画面 object-fit 保持比例），
//   任何尺寸都不溢出容器；很窄时时间收起（pipview.css）。
// mount(容器, {keys}) → {root, screen（交给 stage.take 的容器）, ready（样式表载入完成的 Promise）, destroy()}；destroy 时画面若在这里，先收回页内。
import { extend } from '../core/lang.mjs';
import { shownName, stem, nudge } from '../core/model.mjs';
import { nextScope, toggleType } from '../core/playlist.mjs';
import { span, centerTop, revealTop, ratio } from '../core/pip.mjs';
import { install as dragScroll } from '../ui/dragscroll.mjs';
import { midName } from '../reader/view.mjs';
import { audioArt } from './art.mjs';

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
  pipShuffle: ['Shuffle', '随机播放', 'シャッフル再生', '무작위 재생'],
  pipAudio: ['Type: audio', '类型：音频', '種類：音声', '유형: 오디오'],
  pipVideo: ['Type: video', '类型：视频', '種類：動画', '유형: 동영상'],
  pipRemove: ['Remove from the list', '从列表移除', 'リストから外す', '목록에서 제거'],
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
];
const ROW = 32, // 列表的行高（与 pipview.css 一致）
  FOLLOW = 3000; // 手动滚动列表后这么久之内，当前曲目变了也不把列表滚过去
const SCOPE_ICON = { file: 'loop-file', book: 'loop-book', books: 'loop-books' },
  SCOPE_LABEL = { file: 'cbLoopFile', book: 'cbLoopBook', books: 'cbLoopBooks' };

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
  const views = new Set();
  ctx.on('media', (key) => {
    for (const v of views) v.media(key);
  });
  ctx.on('queue', (key) => {
    for (const v of views) v.queue(key);
  });
  ctx.on('marks', (book) => {
    for (const v of views) v.marks(book);
  });
  ctx.on('synced', (book, keys) => {
    if (keys.includes('bookmarks')) for (const v of views) v.marks(book);
  });
  ctx.on('lang', () => {
    for (const v of views) v.lang();
  });
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
      stage = make('div', 'pip-stage'),
      art = make('div', 'pip-art-box'),
      screen = make('div', 'pip-screen'),
      idle = make('div', 'pip-idle'),
      hud = make('div', 'pip-hud'),
      name = make('div', 'pip-name'),
      line = make('div', 'pip-line'),
      tools = make('div', 'pip-tools'),
      list = make('div', 'pip-list'),
      rows = make('div', 'pip-rows');
    hud.hidden = true;
    hud.setAttribute('aria-hidden', 'true');
    stage.append(art, screen, idle, hud);
    const play = btn('play', 'play', 'mvPlay', () => Q().toggle(), 'pip-play'),
      seek = ctx.player.seekBar(() => tp()),
      time = ctx.player.timeBox(() => tp(), 'pip-time');
    line.append(play, seek.bar, time.box);
    const B = {
      prev: btn('prev', 'skip-back', 'cbMediaPrev', () => Q().prev()),
      next: btn('next', 'skip-forward', 'cbMediaNext', () => Q().next()),
      locate: btn('locate', 'locate', 'fbLocate', () => Q().locate()),
      scope: btn('scope', 'loop-book', 'cbLoopBook', () => Q().setScope(nextScope(Q().scope))),
      shuffle: btn('shuffle', 'shuffle', 'pipShuffle', () => Q().setShuffle(!Q().shuffle)),
      audio: btn('audio', 'music', 'pipAudio', () => Q().setTypes(toggleType(Q().types, 'audio'))),
      video: btn('video', 'film', 'pipVideo', () => Q().setTypes(toggleType(Q().types, 'video'))),
      stop: btn('stop', 'stop', 'fbStop', () => Q().stop()),
    };
    tools.append(...Object.values(B));
    list.tabIndex = 0;
    list.setAttribute('role', 'listbox');
    list.append(rows);
    root.append(stage, name, line, tools, list);
    box.append(root);

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
        p = tp(),
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
      const w = tr?.page.w || p?.el.videoWidth,
        h = tr?.page.h || p?.el.videoHeight;
      root.style.setProperty('--ratio', String(tr?.kind === 'video' ? ratio(w, h) : ratio(16, 9)));
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
      B.locate.disabled = B.stop.disabled = !tr;
      setIcon(B.scope, SCOPE_ICON[q.scope]);
      setLabel(B.scope, SCOPE_LABEL[q.scope]);
      B.scope.dataset.scope = q.scope;
      press(B.shuffle, q.shuffle);
      press(B.audio, q.types.includes('audio'));
      press(B.video, q.types.includes('video'));
    }
    function progress() {
      const p = tp(),
        text = ctx.player.paintBar(seek, p);
      time.text.textContent = p ? text : '';
      const d = p ? ctx.player.api.duration(p) : null;
      if (drawn?.p !== p || drawn.d !== d) {
        drawn = { p, d };
        paintStage(); // 读到元数据：视频的画面比例随之确定
        time.size(d);
        ctx.player.drawMarks?.(seek.bar, p);
      }
    }
    function refresh() {
      paintStage();
      paintName();
      states();
      progress();
      paintRows();
    }

    // ---- 播放列表
    let items = [],
      sel = -1, // 选中项（悬停与键盘共用）
      hovering = false,
      scrolled = 0; // 用户上次滚动列表的时间
    const shownRows = new Map(); // 页对象 → 行
    const card = ctx.fileCard?.within?.(win) ?? null;
    function row(it) {
      const r = make('div', 'pip-item'),
        full = shownName(it.page),
        n = midName(stem(full.slice(full.lastIndexOf('/') + 1)));
      r.setAttribute('role', 'option');
      r.append(icon(it.kind === 'audio' ? 'music' : 'film'), n);
      const locate = btn('locate', 'locate', 'fbLocate', () => Q().locate(r.item), 'pip-ib'),
        remove = btn('remove', 'close', 'pipRemove', () => Q().remove(r.item), 'pip-ib');
      r.append(locate, remove);
      r.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        Q().play(r.item);
      });
      return r;
    }
    function relist() {
      items = Q().items();
      const keep = new Set(items.map((it) => it.page));
      for (const [pg, r] of shownRows)
        if (!keep.has(pg)) {
          r.remove();
          shownRows.delete(pg);
        }
      if (sel >= items.length) sel = items.length - 1;
      rows.style.height = items.length * ROW + 'px';
      paintRows();
    }
    function paintRows() {
      const [from, to] = span(items.length, ROW, list.scrollTop, list.clientHeight),
        used = new Set();
      for (let i = from; i < to; i++) {
        const it = items[i];
        let r = shownRows.get(it.page);
        if (!r) shownRows.set(it.page, (r = row(it)));
        r.item = it;
        r.dataset.i = String(i);
        r.style.transform = 'translateY(' + i * ROW + 'px)';
        r.classList.toggle('current', it.current);
        r.classList.toggle('sel', i === sel);
        r.setAttribute('aria-selected', String(it.current));
        used.add(r);
        if (r.parentNode !== rows) rows.append(r);
      }
      for (const [pg, r] of shownRows)
        if (!used.has(r)) {
          r.remove();
          shownRows.delete(pg);
        }
      rows.classList.toggle('playing', Q().playing());
    }
    const currentIndex = () => items.findIndex((it) => it.current);
    function reveal(center) {
      const i = currentIndex();
      if (i < 0) return;
      list.scrollTop = center
        ? centerTop(i, items.length, ROW, list.clientHeight)
        : revealTop(i, ROW, list.scrollTop, list.clientHeight);
      paintRows();
    }
    function select(i, byKey) {
      if (!items.length) return;
      sel = Math.max(0, Math.min(items.length - 1, i));
      if (byKey) list.scrollTop = revealTop(sel, ROW, list.scrollTop, list.clientHeight);
      paintRows();
      const r = shownRows.get(items[sel].page);
      if (byKey && r && card) card.show(r, { book: items[sel].book, page: items[sel].page });
    }
    let scrollFrame = 0;
    list.addEventListener('scroll', () => {
      if (!scrollFrame)
        scrollFrame = win.requestAnimationFrame(() => {
          scrollFrame = 0;
          paintRows();
        });
    });
    for (const type of ['wheel', 'pointerdown'])
      list.addEventListener(type, () => (scrolled = Date.now()), { passive: true });
    list.addEventListener('pointerover', (e) => {
      hovering = true;
      const r = e.target.closest?.('.pip-item');
      if (r && sel !== +r.dataset.i) select(+r.dataset.i, false);
    });
    list.addEventListener('pointerleave', () => (hovering = false));
    card?.attach(list, (el) => {
      const r = el.closest('.pip-item');
      return r?.item && list.contains(r) ? { el: r, book: r.item.book, page: r.item.page } : null;
    });
    const sizes = new win.ResizeObserver(() => paintRows());
    sizes.observe(list);

    // ---- 提示（音量）
    let hudTimer = 0;
    function showHud(name, text) {
      hud.replaceChildren(icon(name), make('span', '', text));
      hud.hidden = false;
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => (hud.hidden = true), 900);
    }

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
      if (tg?.closest('input,textarea,[contenteditable="true"]')) return;
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
        const d = low === 'arrowup' ? -1 : 1,
          base = sel >= 0 ? sel : currentIndex();
        select(base < 0 ? (d > 0 ? 0 : items.length - 1) : base + d, true);
      } else if (k === 'Enter') {
        if (!e.repeat && items[sel]) Q().play(items[sel]);
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
      list.setAttribute('aria-label', t('pipList'));
      root.setAttribute('aria-label', t('pipPanel'));
      seek.bar.setAttribute('aria-label', t('mvSeek'));
      time.labels();
      if (own) doc.documentElement.lang = document.documentElement.lang;
    }
    let lastTrack = Q().track()?.page ?? null;
    const view = {
      media(key) {
        if (key === 'time') return progress();
        if (key === 'state') {
          states();
          progress();
          return paintRows();
        }
        if (key === 'volume' || key === 'current') return; // 当前文件（主窗口滚动）与面板无关：面板只显示当前曲目
        if (key === 'track') {
          const now = Q().track()?.page ?? null;
          relist();
          if (now !== lastTrack) {
            lastTrack = now;
            if (!hovering && Date.now() - scrolled > FOLLOW) win.requestAnimationFrame(() => reveal(false));
          }
        }
        later();
      },
      queue(key) {
        if (key === 'list') relist();
        states();
      },
      marks(book) {
        const p = tp();
        if (p?.book === book) ctx.player.drawMarks?.(seek.bar, p);
      },
      lang() {
        labels();
        later();
      },
    };
    views.add(view);
    labels();
    relist();
    refresh();
    ready.then(() => win.requestAnimationFrame(() => reveal(true)));
    return {
      root,
      screen,
      ready,
      destroy() {
        if (!views.delete(view)) return;
        stopHold();
        card?.hide();
        sizes.disconnect();
        keys.removeEventListener('keydown', down);
        keys.removeEventListener('keyup', up);
        win.removeEventListener('blur', stopHold);
        if (M().stage.container === screen) M().stage.drop();
        root.remove();
      },
    };
  };
}
