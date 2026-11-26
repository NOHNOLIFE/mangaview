// 播放器的壳：正文里每个媒体页的 DOM（build、shell）、壳上的控件与宽度不够时的「更多」弹出层、进度条拖动，
// 以及状态显示（render：播放键、全屏、音量、登记的按钮、进度与时间）和书签标记等装饰（decorate）的重画。
import { extend } from '../core/lang.mjs';
import { shownName, clock } from '../core/model.mjs';
import { midName } from '../reader/view.mjs';

extend({
  mvPlay: ['Play', '播放', '再生', '재생'],
  mvPause: ['Pause', '暂停', '一時停止', '일시 정지'],
  mvSeek: ['Playback position', '播放进度', '再生位置', '재생 위치'],
  mvMute: ['Mute', '静音', 'ミュート', '음소거'],
  mvUnmute: ['Unmute', '取消静音', 'ミュート解除', '음소거 해제'],
  mvVolume: ['Volume', '音量', '音量', '볼륨'],
  mvFull: ['Fullscreen', '全屏', '全画面', '전체 화면'],
  mvExitFull: ['Exit fullscreen', '退出全屏', '全画面を終了', '전체 화면 종료'],
  mvMore: ['More controls', '更多控件', 'その他の操作', '더 보기'],
});
// 壳的宽度预算（像素，与 shell.css 一致）：放不下全部控件时，次要控件收进「更多」弹出层。
const BTN = 32,
  VOL = 72,
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
    toggle = (...a) => S.toggle(...a),
    setMuted = (...a) => S.setMuted(...a),
    setVolume = (...a) => S.setVolume(...a),
    volIcon = (...a) => S.volIcon(...a),
    rangesOf = (...a) => S.rangesOf(...a);
  // 壳里的按钮：鼠标点击不夺焦点（否则之后按空格会再点一次它），键盘仍可 Tab 聚焦。
  function button(name, label, action, cls = '') {
    const b = ctx.iconButton(name, label, action, cls);
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
    if (kind === 'video') {
      p.big = make('span', 'mv-big');
      p.big.append(icon('play'));
      node.replaceChildren(el, p.big, p.shell);
    } else {
      const card = make('div', 'mv-card'),
        head = make('div', 'mv-head'),
        name = midName(shownName(page));
      name.title = shownName(page);
      name.dataset.nodrag = '';
      head.append(icon('music'), name);
      card.append(head, p.shell);
      node.replaceChildren(card, el);
    }
    p.fail = make('div', 'mv-fail');
    p.fail.dataset.nodrag = '';
    p.fail.hidden = true;
    node.append(p.fail);
    el.volume = S.volume;
    el.muted = S.muted;
    events(p);
    node._dispose = () => dispose(p);
    players.set(node, p);
    decorate(p);
    render(p);
    return p;
  }
  function shell(p) {
    const s = make('div', 'mv-shell'),
      bar = make('div', 'mv-bar'),
      track = make('div', 'mv-track'),
      fill = make('i', 'mv-fill'),
      knob = make('i', 'mv-knob'),
      marks = make('div', 'mv-marks'),
      timeEl = make('span', 'mv-time');
    s.dataset.nodrag = '';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', t('mvSeek'));
    bar.setAttribute('aria-valuemin', '0');
    track.append(fill);
    bar.append(track, marks, knob);
    const play = button('play', t('mvPlay'), () => toggle(p), 'mv-play'),
      mute = button('volume', t('mvMute'), () => setMuted(!S.muted), 'mv-mute');
    const vol = make('input', 'mv-vol');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.step = '5';
    vol.setAttribute('aria-label', t('mvVolume'));
    vol.oninput = () => setVolume(vol.value / 100);
    vol.addEventListener('keydown', (e) => e.stopPropagation()); // 方向键只调这个滑块，不翻屏
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
    Object.assign(p, { shell: s, bar, fill, knob, marks, timeEl, play, mute, vol, more, pop });
    p.full = p.kind === 'video' ? button('full-enter', t('mvFull'), () => fullscreen(p), 'mv-full') : null;
    s.append(play, bar, timeEl, mute, more, pop);
    seekBar(p);
    layoutControls(p);
  }
  // 次要控件：音量滑块、登记的按钮、全屏（仅视频）。宽度够时排在一行，不够时收进「更多」弹出层（不换行、不溢出）。
  function secondary(p) {
    const list = [{ node: p.vol, w: VOL, order: 10 }];
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
    p.mute.before(...extra);
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
  function renderVolume(p) {
    const off = S.muted || !S.volume;
    setIcon(p.mute, volIcon());
    setLabel(p.mute, t(off ? 'mvUnmute' : 'mvMute'));
    p.mute.setAttribute('aria-pressed', String(S.muted));
    p.vol.value = String(Math.round(S.volume * 100));
    p.vol.style.setProperty('--v', S.muted ? 0 : S.volume);
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
    renderVolume(p);
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
      p.vol.setAttribute('aria-label', t('mvVolume'));
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
    renderVolume,
    renderControls,
    render,
    decorate,
    refreshControls,
    refreshAll,
  });
}
