// 单个文件的播放面板（壳）：正文里每个媒体页的 DOM（build）、音频卡片上的控件与宽度不够时的「更多」弹出层、进度条（makeBar，文件栏共用），
// 以及状态显示（render：播放键、登记的按钮、进度与时间）、书签标记等装饰（decorate）的重画、视频全屏（fullscreen）。
// 视频画面内没有控件，只有字幕和未选中时的大播放键；它的文件名、播放键、进度条、字幕等按钮在文件栏（reader/filebar.mjs）。
// 音频卡片的控件常显：播放 / 暂停、进度条（含书签标记）、时间、登记的按钮（字幕、添加书签、添加区段书签），与文件栏同时存在、状态同步；
// 音量、播放顺序、循环、只播区段、新窗口播放等列表级控制在总控栏（reader/controlbar.mjs）。
// 外观（视频、音频统一）：未选中（见 core/selection.mjs）压暗并在中央显示大播放键（点它等同点击画面）；选中不压暗、不描边；
// 播放与暂停只在播放键图标、进度条颜色和音频的跳动音柱上有区别。播放不了的不显示大播放键。
// 字幕容器 .mv-subs 由这里建好并留空（aria-live="off"）：视频叠在画面底部；音频是卡片里始终占位、可容 3 行的区域。
// 只有按钮、进度条、可选中的文件名带 data-nodrag，面板的空白处可以拖动滚动正文。
// 音频卡片：纯色底，右侧一张方形小图（像内嵌的专辑图，art.mjs：书的当前封面，没有封面时按文件名配色的占位图；封面换了已显示的卡片跟着变）。
// 视频全屏：整个页面进入全屏（已在全屏时不再请求），该视频成为选中媒体并铺满窗口（.mv-full），其余照常：鼠标到底缘弹出文件栏和总控栏，快捷键、字幕照常；
// 全屏期间滚轮不滚动正文，退出后回到进入前的阅读位置。
import { extend } from '../core/lang.mjs';
import { shownName, clock } from '../core/model.mjs';
import { midName } from '../reader/view.mjs';
import { audioArt } from './art.mjs';

extend({
  mvPlay: ['Play', '播放', '再生', '재생'],
  mvPause: ['Pause', '暂停', '一時停止', '일시 정지'],
  mvSeek: ['Playback position', '播放进度', '再生位置', '재생 위치'],
  mvFull: ['Fullscreen', '全屏', '全画面', '전체 화면'],
  mvExitFull: ['Exit fullscreen', '退出全屏', '全画面を終了', '전체 화면 종료'],
  mvMore: ['More controls', '更多控件', 'その他の操作', '더 보기'],
});
// 壳的宽度预算（像素，与 shell.css 一致）：放不下全部控件时，次要控件收进「更多」弹出层。
const BTN = 32,
  GAP = 2,
  PAD = 12,
  BAR_MIN = 120;

export function install(ctx, S) {
  const { t, make, icon } = ctx,
    { players, times, controls, decorators, api } = S;
  const savedPos = (...a) => S.savedPos(...a),
    events = (...a) => S.events(...a),
    dispose = (...a) => S.dispose(...a),
    seek = (...a) => S.seek(...a),
    press = (...a) => S.press(...a),
    rangesOf = (...a) => S.rangesOf(...a);
  // 壳里的按钮：鼠标点击不夺焦点（否则之后按空格会再点一次它），键盘仍可 Tab 聚焦；不参与拖动滚动。
  function button(name, label, action, cls = '') {
    const b = ctx.iconButton(name, label, action, cls);
    b.dataset.nodrag = '';
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') e.preventDefault();
    });
    return b;
  }
  const setIcon = (b, name) => b.querySelector('use').setAttribute('href', '#i-' + name);
  const setLabel = (b, label) => {
    if (b.title !== label) {
      b.title = label;
      b.setAttribute('aria-label', label);
    }
  };

  // ---- 播放器
  function build(node, book, page, kind) {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.controls = false;
    el.disableRemotePlayback = true;
    if (kind === 'video') {
      el.playsInline = true;
      el.disablePictureInPicture = true;
    }
    const p = {
      node,
      book,
      page,
      kind,
      el,
      state: 'idle',
      url: null,
      stamp: null,
      timer: 0,
      time: times.get(page) ?? savedPos(book, page),
      wantPlay: false,
      userPaused: false,
      done: false,
      narrow: null,
      extra: new Map(),
    };
    node.classList.add('media', kind);
    p.subs = make('div', 'mv-subs');
    p.subs.setAttribute('aria-live', 'off');
    // 未选中时中央的大播放键：不接收指针，点击落在画面 / 卡片上，等同点击画面（media.mjs tap）。
    p.big = make('span', 'mv-big');
    p.big.setAttribute('aria-hidden', 'true');
    p.big.append(icon('play'));
    if (kind === 'video') node.replaceChildren(el, p.subs, p.big);
    else {
      shell(p);
      // 文件名只显示最末一段（不带路径），完整路径放悬停提示；可选中复制。
      const full = shownName(page),
        name = midName(full.slice(full.lastIndexOf('/') + 1));
      name.title = full;
      name.dataset.nodrag = '';
      const card = make('div', 'mv-card'),
        head = make('div', 'mv-head'),
        eq = make('span', 'mv-eq');
      eq.setAttribute('aria-hidden', 'true');
      eq.append(make('i'), make('i'), make('i'), make('i'));
      head.append(icon('music'), eq, name);
      const art = audioArt(ctx, make('span'), book, page); // 不存进页记录，每次建卡片时取当前封面
      card.append(head, art, p.subs, p.shell);
      node.replaceChildren(card, el, p.big);
    }
    p.fail = make('div', 'mv-fail');
    p.fail.dataset.nodrag = '';
    p.fail.hidden = true;
    node.append(p.fail);
    el.volume = S.volume;
    el.muted = S.muted;
    el.defaultPlaybackRate = el.playbackRate = ctx.transport?.playRate ?? 1;
    events(p);
    node._dispose = () => dispose(p);
    players.set(node, p);
    decorate(p);
    render(p);
    return p;
  }
  // 音频卡片上的一行控件（视频没有）：播放键、进度条、时间、登记的按钮、「更多」。
  function shell(p) {
    const s = make('div', 'mv-shell'),
      { bar, fill, knob } = makeBar(() => p),
      timeEl = make('span', 'mv-time');
    const play = button('play', t('mvPlay'), () => press(p), 'mv-play');
    const more = button('more', t('mvMore'), () => {}, 'mv-more'),
      pop = make('div', 'mv-pop');
    pop.popover = 'auto';
    pop.dataset.nodrag = '';
    more.hidden = true;
    more.popoverTargetElement = pop;
    more.setAttribute('aria-haspopup', 'true'); // 由浏览器开关：再点一次即收起，点别处也收起
    pop.addEventListener('toggle', (e) => {
      more.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState === 'open') placePop(p);
    });
    Object.assign(p, { shell: s, bar, fill, knob, timeEl, play, more, pop });
    s.append(play, bar, timeEl, more, pop);
    layoutControls(p);
  }
  // 登记的按钮（ctx.player.add）在这个播放器上的那一个：点击、状态都带上按钮本身（字幕菜单按它定位）。
  function extraButton(p, c) {
    let b = p.extra.get(c);
    if (!b) {
      b = button(c.icon, t(c.label), () => c.click?.(p, api, b), 'mv-x');
      b.dataset.control = c.id;
      p.extra.set(c, b);
    }
    return b;
  }
  // 次要控件：登记的按钮。宽度够时排在一行，不够时收进「更多」弹出层（不换行、不溢出）。
  function secondary(p) {
    const list = [];
    for (const c of controls)
      if (!c.kinds || c.kinds.includes(p.kind)) {
        const b = extraButton(p, c);
        if (c.secondary === false) continue;
        list.push({ node: b, w: BTN, order: c.order ?? 50 });
      }
    return list.sort((a, b) => a.order - b.order);
  }
  function primaryExtra(p) {
    return controls
      .filter((c) => c.secondary === false && (!c.kinds || c.kinds.includes(p.kind)))
      .map((c) => p.extra.get(c))
      .filter(Boolean);
  }
  function layoutControls(p) {
    if (!p.shell) return;
    const sec = secondary(p),
      W = p.shell.clientWidth,
      extra = primaryExtra(p);
    const fixed = PAD + BTN + p.timeEl.offsetWidth + BTN + extra.length * BTN + BAR_MIN + GAP * (4 + extra.length);
    const need = fixed + sec.reduce((n, x) => n + x.w + GAP, 0),
      narrow = W > 0 && W < need;
    p.more.before(...extra);
    if (narrow) {
      p.pop.append(...sec.map((x) => x.node));
      p.more.hidden = false;
    } else {
      p.more.before(...sec.map((x) => x.node));
      p.more.hidden = true;
      if (p.pop.matches(':popover-open')) p.pop.hidePopover();
    }
    p.narrow = narrow;
    p.shell.classList.toggle('narrow', narrow);
    renderControls(p);
  }
  const fitter = new ResizeObserver((entries) => {
    for (const e of entries) {
      const p = players.get(e.target.closest('.page'));
      if (p) layoutControls(p);
    }
  });
  function placePop(p) {
    const r = p.more.getBoundingClientRect();
    Object.assign(p.pop.style, {
      left: 'auto',
      top: 'auto',
      right: Math.max(4, innerWidth - r.right) + 'px',
      bottom: Math.max(4, innerHeight - r.top + 6) + 'px',
    });
  }
  // 进度条（音频卡片、文件栏共用）：可点击、拖动、方向键定位；get() 为它当前作用的播放器（没有时为 null，不响应）。
  // 上面有一层 .mv-marks（书签标记，marks.mjs），进度由 paintBar 画。
  function makeBar(get) {
    const bar = make('div', 'mv-bar'),
      track = make('div', 'mv-track'),
      fill = make('i', 'mv-fill'),
      knob = make('i', 'mv-knob');
    bar.dataset.nodrag = '';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', t('mvSeek'));
    bar.setAttribute('aria-valuemin', '0');
    track.append(fill);
    bar.append(track, make('div', 'mv-marks'), knob);
    let scrub = false;
    const to = (e) => {
      const p = get(),
        r = bar.getBoundingClientRect(),
        d = p && api.duration(p);
      if (!d || !r.width) return;
      seek(p, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d);
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !get()) return;
      e.preventDefault();
      scrub = true;
      bar.setPointerCapture(e.pointerId);
      to(e);
    });
    bar.addEventListener('pointermove', (e) => {
      if (scrub) to(e);
    });
    bar.addEventListener('lostpointercapture', () => {
      scrub = false;
    });
    bar.addEventListener('keydown', (e) => {
      const p = get(),
        d = p && api.duration(p);
      if (!d) return;
      const now = api.time(p);
      const k = e.key,
        next =
          k === 'ArrowLeft' || k === 'ArrowDown'
            ? now - 5
            : k === 'ArrowRight' || k === 'ArrowUp'
              ? now + 5
              : k === 'Home'
                ? 0
                : k === 'End'
                  ? d
                  : null;
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      seek(p, Math.min(d, Math.max(0, next)));
    });
    return { bar, fill, knob };
  }
  // 画进度：parts 为 makeBar 的结果（播放器自己的就是 p），p 为作用的播放器（null 为空），at 为指定的时间（拖动、定位时）。
  function paintBar(parts, p, at) {
    const d = p ? api.duration(p) : null,
      now = p ? (at ?? api.time(p)) : 0,
      f = d ? Math.min(1, Math.max(0, now / d)) : 0,
      text = clock(now) + ' / ' + (d ? clock(d) : '-:--');
    parts.fill.style.transform = 'scaleX(' + f + ')';
    parts.knob.style.left = f * 100 + '%';
    parts.bar.setAttribute('aria-valuemax', String(Math.round(d || 0)));
    parts.bar.setAttribute('aria-valuenow', String(Math.round(now)));
    parts.bar.setAttribute('aria-valuetext', text);
    return text;
  }
  // 时间显示的宽度（ch）：按总时长的位数预留，播放中数字变化不推动其他控件。
  const timeWidth = (d) => (clock(d || 0) + ' / ' + clock(d || 0)).length;
  // 时间显示按总时长的位数预留宽度：播放中数字变化不推动其他控件。
  function sizeTime(p) {
    if (!p.timeEl) return;
    const w = timeWidth(api.duration(p));
    if (p.timeEl.dataset.w !== String(w)) {
      p.timeEl.dataset.w = w;
      p.timeEl.style.width = w + 'ch';
      layoutControls(p);
    }
  }
  function progress(p, at) {
    if (p.bar) p.timeEl.textContent = paintBar(p, p, at);
  }
  function renderControls(p) {
    for (const [c, b] of p.extra) {
      const s = c.state?.(p, api, b) ?? {};
      b.disabled = !!s.disabled;
      if (s.pressed != null) b.setAttribute('aria-pressed', String(!!s.pressed));
      if (s.icon) setIcon(b, s.icon);
      setLabel(b, t(s.label ?? c.label));
    }
  }
  function render(p) {
    const on = !p.el.paused && p.state === 'ready';
    if (p.play) {
      setIcon(p.play, on ? 'pause' : 'play');
      setLabel(p.play, t(on ? 'mvPause' : 'mvPlay'));
    }
    p.node.classList.toggle('playing', on);
    renderControls(p);
    progress(p);
  }
  // ---- 视频全屏：页面全屏，该视频铺满窗口（.mv-full，样式在 shell.css），总控栏与文件栏照常从底缘弹出。
  // own：全屏是这里请求的（退出视频全屏时一并退出）；进入前已在全屏（工具栏的全屏按钮）时只铺满、不改变页面的全屏。
  let own = false,
    back = null;
  function fullscreen(p) {
    if (S.full === p) return leaveFull();
    if (S.full) drop();
    if (p.kind !== 'video' || p.state === 'failed') return;
    back = ctx.view.anchor();
    S.select(p, 'press'); // 全屏的视频即选中媒体（不压暗、没有大播放键）
    S.full = p;
    p.node.classList.add('mv-full');
    document.body.classList.add('mv-fullvideo');
    own = !document.fullscreenElement;
    if (own)
      document.documentElement.requestFullscreen?.().catch(() => {
        own = false;
        if (S.full === p) leaveFull();
      });
    changedFull();
  }
  // 退出视频全屏：取消铺满，这里请求的页面全屏一并退出，回到进入前的阅读位置。
  function leaveFull() {
    if (!S.full) return;
    drop();
    if (own && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    own = false;
    restore();
    changedFull();
  }
  function drop() {
    S.full?.node.classList.remove('mv-full');
    S.full = null;
    document.body.classList.remove('mv-fullvideo');
  }
  // 窗口尺寸的变化由正文按视窗中心保持；全屏期间改变过的阅读位置在尺寸稳定后放回进入前的位置。
  function restore() {
    const a = back;
    back = null;
    const book = ctx.current;
    if (!book) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (ctx.current !== book) return;
        const now = ctx.view.anchor(),
          i = a ? book.pages.findIndex((pg) => pg.name === a.name) : -1;
        if (!a) {
          if (now) ctx.main.scrollTop = 0;
        } else if (i >= 0 && (now?.name !== a.name || Math.abs(now.f - a.f) > 0.001)) ctx.view.jump({ i, f: a.f });
      }),
    );
  }
  function changedFull() {
    for (const p of players.values()) render(p);
    ctx.emit('media', 'full');
  }
  // 按 Esc 或别的方式退出了页面全屏：视频全屏随之结束。
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && S.full) {
      own = false;
      leaveFull();
    }
  });
  // 全屏期间滚轮不滚动正文（画面铺满窗口，滚动只会改变背后的阅读位置）。
  ctx.main.addEventListener(
    'wheel',
    (e) => {
      if (S.full) e.preventDefault();
    },
    { passive: false },
  );
  // 进度条上的标记、区段常显 / 变暗（sec-only）随书签、设置变化重画。
  function decorate(p) {
    p.node.classList.toggle('sec-only', S.only && rangesOf(p).length > 0);
    for (const fn of decorators)
      try {
        fn(p);
      } catch (e) {
        console.warn(e);
      }
  }
  // 登记的按钮的状态变了（字幕开关等）：音频卡片上的重画，文件栏随 'media' 事件（'controls'）重画。
  function refreshControls() {
    for (const p of players.values()) renderControls(p);
    ctx.emit('media', 'controls');
  }
  function refreshAll() {
    for (const p of players.values()) {
      p.ranges = null;
      renderControls(p);
      decorate(p);
    }
    ctx.emit('media', 'controls');
  }
  ctx.on('lang', () => {
    for (const p of players.values()) {
      if (p.bar) {
        p.bar.setAttribute('aria-label', t('mvSeek'));
        setLabel(p.more, t('mvMore'));
      }
      render(p);
    }
  });
  Object.assign(S, {
    button,
    setLabel,
    build,
    extraButton,
    layoutControls,
    fitter,
    makeBar,
    paintBar,
    timeWidth,
    sizeTime,
    progress,
    renderControls,
    render,
    decorate,
    refreshControls,
    refreshAll,
    fullscreen,
    leaveFull,
  });
}
