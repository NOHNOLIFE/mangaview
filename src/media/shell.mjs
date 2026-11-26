// 单个文件的播放面板（壳）：正文里每个媒体页的 DOM（build、shell）、壳上的控件与宽度不够时的「更多」弹出层、进度条拖动，
// 以及状态显示（render：播放键、全屏、登记的按钮、进度与时间）和书签标记等装饰（decorate）的重画。
// 面板只放与这个文件有关的控件：播放 / 暂停、进度条（含书签标记）、时间、文件名、登记的按钮（添加书签、添加区段书签、字幕等），视频另有全屏；
// 音量、播放顺序、循环、只播区段、新窗口播放等列表级控制在总控栏（reader/controlbar.mjs）。
// 字幕容器 .mv-subs 由这里建好并留空（aria-live="off"）：视频叠在画面底部、控件上方；音频是卡片里始终占位、可容 3 行的区域。
// 只有按钮、进度条、可选中的文件名带 data-nodrag，面板的空白处可以拖动滚动正文。
// 音频卡片：书有封面时（ctx.bookCover，可选）以压暗的封面作背景。
import { extend } from '../core/lang.mjs';
import { shownName, clock } from '../core/model.mjs';
import { midName } from '../reader/view.mjs';

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
    shell(p);
    // 文件名只显示最末一段（不带路径），完整路径放悬停提示；可选中复制。
    const full = shownName(page),
      name = midName(full.slice(full.lastIndexOf('/') + 1));
    name.title = full;
    name.dataset.nodrag = '';
    p.subs = make('div', 'mv-subs');
    p.subs.setAttribute('aria-live', 'off');
    if (kind === 'video') {
      p.big = make('span', 'mv-big');
      p.big.append(icon('play'));
      const title = make('div', 'mv-title');
      title.append(name);
      node.replaceChildren(el, p.big, p.subs, title, p.shell);
    } else {
      const card = make('div', 'mv-card'),
        head = make('div', 'mv-head'),
        eq = make('span', 'mv-eq');
      eq.setAttribute('aria-hidden', 'true');
      eq.append(make('i'), make('i'), make('i'), make('i'));
      head.append(icon('music'), eq, name);
      card.append(head, p.subs, p.shell);
      node.replaceChildren(card, el);
      cover(p, card);
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
  // 音频卡片的背景：书的当前封面（每次建卡片时取，不存进页记录），压暗以保证文字对比度。ctx.bookCover(book) → Promise<地址|null>，未提供时不显示。
  function cover(p, card) {
    Promise.resolve()
      .then(() => ctx.bookCover?.(p.book))
      .then((url) => {
        if (!url || !players.has(p.node)) return;
        card.style.setProperty('--cover', 'url("' + String(url).replace(/["\\]/g, '\\  function shell(p) {') + '")');
        card.classList.add('has-cover');
      })
      .catch(() => {});
  }
  function shell(p) {
    const s = make('div', 'mv-shell'),
      bar = make('div', 'mv-bar'),
      track = make('div', 'mv-track'),
      fill = make('i', 'mv-fill'),
      knob = make('i', 'mv-knob'),
      marks = make('div', 'mv-marks'),
      timeEl = make('span', 'mv-time');
    bar.dataset.nodrag = '';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', t('mvSeek'));
    bar.setAttribute('aria-valuemin', '0');
    track.append(fill);
    bar.append(track, marks, knob);
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
    Object.assign(p, { shell: s, bar, fill, knob, marks, timeEl, play, more, pop });
    p.full = p.kind === 'video' ? button('full-enter', t('mvFull'), () => fullscreen(p), 'mv-full') : null;
    s.append(play, bar, timeEl, more, pop);
    seekBar(p);
    layoutControls(p);
  }
  // 次要控件：登记的按钮、全屏（仅视频）。宽度够时排在一行，不够时收进「更多」弹出层（不换行、不溢出）。
  function secondary(p) {
    const list = [];
    for (const c of controls)
      if (!c.kinds || c.kinds.includes(p.kind)) {
        let b = p.extra.get(c);
        if (!b) {
          b = button(c.icon, t(c.label), () => c.click?.(p, api), 'mv-x');
          b.dataset.control = c.id;
          p.extra.set(c, b);
        }
        if (c.secondary === false) continue;
        list.push({ node: b, w: BTN, order: c.order ?? 50 });
      }
    if (p.full) list.push({ node: p.full, w: BTN, order: 90 });
    return list.sort((a, b) => a.order - b.order);
  }
  function primaryExtra(p) {
    return controls
      .filter((c) => c.secondary === false && (!c.kinds || c.kinds.includes(p.kind)))
      .map((c) => p.extra.get(c))
      .filter(Boolean);
  }
  function layoutControls(p) {
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
  function seekBar(p) {
    const { bar } = p;
    let scrub = false;
    const to = (e) => {
      const r = bar.getBoundingClientRect(),
        d = api.duration(p);
      if (!d || !r.width) return;
      seek(p, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d);
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
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
      const d = api.duration(p),
        now = api.time(p);
      if (!d) return;
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
  }
  // 时间显示按总时长的位数预留宽度：播放中数字变化不推动其他控件。
  function sizeTime(p) {
    const d = api.duration(p),
      w = (clock(d || 0) + ' / ' + clock(d || 0)).length;
    if (p.timeEl.dataset.w !== String(w)) {
      p.timeEl.dataset.w = w;
      p.timeEl.style.width = w + 'ch';
      layoutControls(p);
    }
  }
  function progress(p, at) {
    const d = api.duration(p),
      now = at ?? api.time(p),
      f = d ? Math.min(1, Math.max(0, now / d)) : 0;
    p.fill.style.transform = 'scaleX(' + f + ')';
    p.knob.style.left = f * 100 + '%';
    p.timeEl.textContent = clock(now) + ' / ' + (d ? clock(d) : '-:--');
    p.bar.setAttribute('aria-valuemax', String(Math.round(d || 0)));
    p.bar.setAttribute('aria-valuenow', String(Math.round(now)));
    p.bar.setAttribute('aria-valuetext', p.timeEl.textContent);
  }
  function renderControls(p) {
    for (const [c, b] of p.extra) {
      const s = c.state?.(p, api) ?? {};
      b.disabled = !!s.disabled;
      if (s.pressed != null) b.setAttribute('aria-pressed', String(!!s.pressed));
      if (s.icon) setIcon(b, s.icon);
      setLabel(b, t(s.label ?? c.label));
    }
  }
  function render(p) {
    const on = !p.el.paused && p.state === 'ready';
    setIcon(p.play, on ? 'pause' : 'play');
    setLabel(p.play, t(on ? 'mvPause' : 'mvPlay'));
    p.node.classList.toggle('playing', on);
    if (p.full) {
      const full = document.fullscreenElement === p.node;
      setIcon(p.full, full ? 'full-exit' : 'full-enter');
      setLabel(p.full, t(full ? 'mvExitFull' : 'mvFull'));
    }
    renderControls(p);
    progress(p);
  }
  function fullscreen(p) {
    if (document.fullscreenElement === p.node) document.exitFullscreen().catch(() => {});
    else p.node.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => {
    for (const p of players.values()) render(p);
  });
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
  function refreshControls() {
    for (const p of players.values()) renderControls(p);
  }
  function refreshAll() {
    for (const p of players.values()) {
      p.ranges = null;
      renderControls(p);
      decorate(p);
    }
  }
  ctx.on('lang', () => {
    for (const p of players.values()) {
      p.bar.setAttribute('aria-label', t('mvSeek'));
      setLabel(p.more, t('mvMore'));
      render(p);
    }
  });
  Object.assign(S, {
    button,
    setLabel,
    build,
    layoutControls,
    fitter,
    sizeTime,
    progress,
    renderControls,
    render,
    decorate,
    refreshControls,
    refreshAll,
  });
}
