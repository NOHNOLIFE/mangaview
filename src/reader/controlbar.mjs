// 总控栏：取代原来的底部操作栏。鼠标贴近底缘稍作停留即弹出、移开后收起（设置里可关闭底缘弹出），不常驻；
// 新窗口播放的窗口里同样有。分三区，每区两行（第二行是小号灰字或模式切换），高度约 84px：
// - 左（阅读）：上一本、到顶部、到底部、下一本（书架有筛选时带小圆点，只在筛选结果内切换）、跨书开关、滚动速率；第二行页码与进度。
// - 中（通用）：只播区段开关、大的播放 / 暂停（唯一的主按钮，= 空格）、单文件模式开关；第二行模式切换（漫画 / 混合 / 影音）。
// - 右（媒体）：上一个媒体、下一个媒体、播放顺序、循环、播放速率、音量、新窗口播放；第二行当前媒体的文件名（最末一段）· 时间。
// 状态在 ctx.transport（transport.mjs）与 ctx.media（media/driver.mjs）；禁用规则在 core/control.mjs（与当前模式无关的变暗禁用，不隐藏、不移动）。
// 位置稳定：数字按位数预留宽度（::after 占位串），按钮禁用只变暗。窄窗口：先把次要按钮（到顶部、到底部、播放顺序、循环、新窗口播放）
// 收进各区的「⋯」弹出层（.compact），仍放不下时三区分两行排（中区在上，.stacked），再放不下时三区各占一行（.tall），约 360px 宽时不溢出。
import { extend } from '../core/lang.mjs';
import { clock } from '../core/model.mjs';
import { RATES, rateOf, stepRate, rateText, disabledControls, MODES } from '../core/control.mjs';
import { nudge } from '../core/model.mjs';
import { make, icon } from '../ui/dom.mjs';
import { ORDER_ICON, ORDER_LABEL } from '../media/order.mjs';
import { DWELL, LEAVE } from './toolbar.mjs';
import { dial } from './controlbar-dial.mjs';

extend({
  tbEdgeBottom: [
    'Show the control bar at the bottom edge',
    '鼠标移到底缘时弹出总控栏',
    '下端でコントロールバーを表示',
    '아래쪽 가장자리에서 컨트롤 바 표시',
  ],
  cbScoped: [
    'Only switches within the shelf filter results',
    '仅在书架筛选结果内切换',
    '本棚の絞り込み結果の中だけで切り替え',
    '책장 필터 결과 안에서만 전환',
  ],
  cbCrossBook: ['Continue across books', '跨书', '本をまたいで続ける', '책을 넘어 계속'],
  cbScrollRate: ['Scroll speed', '滚动速率', 'スクロール速度', '스크롤 속도'],
  cbPlayRate: ['Playback speed', '播放速率', '再生速度', '재생 속도'],
  cbSingle: ['Single file', '单文件模式', '1 ファイルずつ表示', '한 파일씩 보기'],
  cbMode: ['Play mode', '播放模式', '再生モード', '재생 모드'],
  cbComic: ['Comic', '漫画', '漫画', '만화'],
  cbMixed: ['Mixed', '混合', 'ミックス', '혼합'],
  cbMedia: ['Media', '影音', 'メディア', '미디어'],
  cbMediaPrev: ['Previous media', '上一个媒体', '前のメディア', '이전 미디어'],
  cbMediaNext: ['Next media', '下一个媒体', '次のメディア', '다음 미디어'],
  cbVolume: ['Volume', '音量', '音量', '볼륨'],
  cbMute: ['Mute', '静音', 'ミュート', '음소거'],
  cbUnmute: ['Unmute', '取消静音', 'ミュート解除', '음소거 해제'],
  cbMore: ['More', '更多', 'その他', '더 보기'],
  cbLoopBook: ['Loop: the whole book', '循环：整本', 'ループ：本全体', '반복: 책 전체'],
  cbLoopList: ['Loop: the whole reading list', '循环：整个阅读列表', 'ループ：読書リスト全体', '반복: 읽기 목록 전체'],
});
// 弹出层的尺寸（与 controlbar.css 一致）：按钮 36px，内边距 6px + 边框 1px。
const BTN = 36,
  POP_PAD = 14;
const MODE_ICON = { comic: 'mode-comic', mixed: 'mode-mixed', media: 'mode-media' },
  MODE_LABEL = { comic: 'cbComic', mixed: 'cbMixed', media: 'cbMedia' };

export function install(ctx) {
  const { main, t } = ctx;
  const T = () => ctx.transport,
    M = () => ctx.media;
  const dialog = () => document.querySelector('dialog[open]');

  // ---- DOM
  const bar = make('div');
  bar.id = 'controlbar';
  bar.setAttribute('role', 'toolbar');
  bar.hidden = true;
  const zone = (cls) => {
    const z = make('div', 'cb-zone ' + cls),
      row = make('div', 'cb-row');
    z.append(row);
    bar.append(z);
    return row;
  };
  const left = zone('cb-left'),
    mid = zone('cb-mid'),
    right = zone('cb-right');
  // 图标按钮：文字只在 title 与 aria-label（label 为文案 key 或函数）。
  const btns = {};
  function btn(id, name, label, action, cls = '') {
    const b = make('button', 'cb-btn ' + cls);
    b.type = 'button';
    b.dataset.id = id;
    b.append(icon(name));
    b.label = label;
    if (action) b.addEventListener('click', action);
    btns[id] = b;
    return b;
  }
  const setIcon = (b, name) => b.querySelector('use').setAttribute('href', '#i-' + name);
  const setLabel = (b, text) => {
    if (b.title !== text) b.title = text;
    if (b.getAttribute('aria-label') !== text) b.setAttribute('aria-label', text);
  };
  const pressed = (b, on) => b.setAttribute('aria-pressed', String(!!on));
  // 「⋯」弹出层：窄窗口时收进来的次要按钮（各区一个）。
  function more(id) {
    const b = btn(id, 'more', 'cbMore', null, 'cb-more'),
      pop = make('div', 'cb-pop cb-more-pop');
    pop.popover = 'auto';
    b.popoverTargetElement = pop;
    b.setAttribute('aria-haspopup', 'true');
    b.hidden = true;
    pop.addEventListener('click', (e) => {
      if (e.target.closest('button')) pop.hidePopover(); // 选了一项即收起
    });
    // 打开前（同步）按按钮定位在它上方、夹在窗口内：弹出层是一行固定尺寸的按钮，尺寸可以直接算出。
    pop.addEventListener('beforetoggle', (e) => {
      b.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState !== 'open') return;
      const r = b.getBoundingClientRect(),
        n = pop.children.length,
        w = n * BTN + (n - 1) * 2 + POP_PAD,
        h = BTN + POP_PAD;
      pop.style.left = Math.round(Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2))) + 'px';
      pop.style.top = Math.round(Math.max(4, r.top - h - 8)) + 'px';
    });
    return { b, pop };
  }

  // 左区
  const prevBook = btn('prevBook', 'book-prev', 'prev', null, 'cb-book'),
    toStart = btn('toStart', 'to-top', 'toTop', null, 'cb-minor'),
    toEnd = btn('toEnd', 'to-end', 'toEnd', null, 'cb-minor'),
    nextBook = btn('nextBook', 'book-next', 'next', null, 'cb-book'),
    moreL = more('moreLeft'),
    cross = btn('crossBook', 'cross-book', 'cbCrossBook', () => T().setCrossBook(!T().crossBook), 'cb-toggle');
  prevBook.dataset.act = 'prev';
  nextBook.dataset.act = 'next';
  toStart.dataset.act = 'toStart';
  toEnd.dataset.act = 'toEnd';
  const scrollDial = dial({
    id: 'scrollRate',
    cls: 'cb-rate',
    label: () => t('cbScrollRate') + ' ' + rateText(T().scrollRate),
    face: (b) => {
      b.textContent = rateText(T().scrollRate);
    },
    click: () => T().setScrollRate(1),
    nudge: (d) => T().setScrollRate(stepRate(T().scrollRate, d, 'scroll')),
    slider: {
      min: RATES.scroll.min,
      max: RATES.scroll.max,
      step: 0.05,
      get: () => T().scrollRate,
      set: (v) => T().setScrollRate(rateOf(v, 'scroll')),
      text: rateText,
    },
    presets: RATES.scroll.presets.map((v) => ({ value: v, text: rateText(v) })),
  });
  btns.scrollRate = scrollDial.button;
  left.append(prevBook, toStart, toEnd, nextBook, moreL.b, moreL.pop, cross, scrollDial.button, scrollDial.pop);
  const pos = make('div', 'cb-info cb-pos');
  left.after(pos);

  // 中区
  const sections = btn('sections', 'sections', 'mvSections', () => T().setSectionsOnly(!T().sectionsOnly), 'cb-toggle'),
    play = btn('play', 'play', 'mvPlay', () => T().toggle(), 'cb-play'),
    single = btn('single', 'single-file', 'cbSingle', () => T().setSingle(!T().single), 'cb-toggle');
  mid.append(sections, play, single);
  const modes = make('div', 'cb-modes');
  modes.setAttribute('role', 'radiogroup');
  for (const m of MODES) {
    const b = btn('mode-' + m, MODE_ICON[m], MODE_LABEL[m], () => T().setMode(m), 'cb-mode');
    b.setAttribute('role', 'radio');
    b.dataset.mode = m;
    modes.append(b);
  }
  mid.after(modes);

  // 右区
  const mediaPrev = btn('mediaPrev', 'skip-back', 'cbMediaPrev', () => M()?.step(-1)),
    mediaNext = btn('mediaNext', 'skip-forward', 'cbMediaNext', () => M()?.step(1)),
    order = btn('order', 'order-list', 'mvOrderList', () => M()?.cycleOrder(), 'cb-minor'),
    loop = btn('loop', 'repeat', 'mvLoop', () => M()?.toggleLoop(), 'cb-minor cb-toggle'),
    moreR = more('moreRight');
  const playDial = dial({
    id: 'playRate',
    cls: 'cb-rate',
    label: () => t('cbPlayRate') + ' ' + rateText(T().playRate),
    face: (b) => {
      b.textContent = rateText(T().playRate);
    },
    click: () => T().setPlayRate(1),
    nudge: (d) => T().setPlayRate(stepRate(T().playRate, d, 'play')),
    slider: {
      min: RATES.play.min,
      max: RATES.play.max,
      step: 0.05,
      get: () => T().playRate,
      set: (v) => T().setPlayRate(rateOf(v, 'play')),
      text: rateText,
    },
    presets: RATES.play.presets.map((v) => ({ value: v, text: rateText(v) })),
  });
  btns.playRate = playDial.button;
  const muteBtn = make('button', 'cb-btn dial-mute');
  muteBtn.type = 'button';
  muteBtn.append(icon('volume-x'));
  muteBtn.addEventListener('click', () => M()?.setMuted(!M().muted));
  const level = () => (M() ? (M().muted ? 0 : Math.round(M().volume * 100)) : 100);
  const volDial = dial({
    id: 'volume',
    cls: 'cb-volume',
    label: () => t('cbVolume') + ' ' + level() + '%',
    face: (b) => {
      if (!b.firstChild) b.append(icon('volume'));
      setIcon(b, M()?.volIcon() ?? 'volume');
      b.setAttribute('aria-pressed', String(!!M()?.muted));
    },
    click: () => M()?.setMuted(!M().muted),
    nudge: (d) => M()?.setVolume(nudge(M().muted ? 0 : M().volume, d)),
    slider: {
      min: 0,
      max: 100,
      step: 5,
      get: level,
      set: (v) => M()?.setVolume(v / 100),
      text: (v) => v + '%',
    },
    presets: [25, 50, 75, 100].map((v) => ({ value: v, text: v + '%' })),
    extra: muteBtn,
  });
  btns.volume = volDial.button;
  const popout = btn('popout', 'popout', 'mvPopout', () => M()?.popout(), 'cb-minor');
  right.append(
    mediaPrev,
    mediaNext,
    order,
    loop,
    moreR.b,
    moreR.pop,
    playDial.button,
    playDial.pop,
    volDial.button,
    volDial.pop,
    popout,
  );
  const now = make('div', 'cb-info cb-now'),
    nowName = make('span', 'cb-name'),
    nowTime = make('span', 'cb-time');
  nowName.dataset.nodrag = '';
  now.append(nowName, nowTime);
  right.after(now);
  document.body.append(bar);
  const dials = [scrollDial, playDial, volDial];

  // ---- 状态显示
  const showing = () => ctx.showing(bar);
  const others = () => !!ctx.current && ctx.readingList(ctx.current).some((b) => b !== ctx.current);
  let hasMedia = false;
  function texts() {
    bar.setAttribute('aria-label', t('controlBar'));
    modes.setAttribute('aria-label', t('cbMode'));
    for (const b of Object.values(btns)) if (b.label) setLabel(b, t(b.label));
    setLabel(muteBtn, t('cbMute'));
  }
  // 左区第二行：已读页 / 总页数 · 进度。按总页数的位数预留宽度（::after 占位串），滚动中位数变化不推动别的元素。
  function syncPos() {
    const p = ctx.current && ctx.view.position(),
      n = p?.n ?? ctx.current?.pages.length ?? 0,
      d = String(n).length;
    pos.textContent = p ? `${ctx.atEnd() ? n : p.i + 1} / ${n} · ${Math.round(p.ratio * 100)}%` : '';
    pos.dataset.room = n ? `${'0'.repeat(d)} / ${'0'.repeat(d)} · 100%` : '';
  }
  function syncBooks() {
    const o = others(),
      scoped = !!ctx.filtering?.();
    for (const b of [prevBook, nextBook]) {
      b.disabled = !o;
      b.classList.toggle('scoped', scoped);
      setLabel(b, t(b.label) + (scoped ? ' · ' + t('cbScoped') : ''));
    }
  }
  function syncScroll() {
    toStart.disabled = ctx.atStart();
    toEnd.disabled = ctx.atEnd();
    syncPos();
    syncSteps();
  }
  function syncSteps() {
    if (!showing()) return; // 要逐页查找，只在显示时计算
    const off = disabledControls({ mode: T().mode, hasMedia });
    mediaPrev.disabled = off.has('mediaPrev') || !M()?.canStep(-1);
    mediaNext.disabled = off.has('mediaNext') || !M()?.canStep(1);
    popout.disabled = off.has('popout') || !M()?.canPopout();
  }
  // 右区第二行：当前媒体的文件名（最末一段，放不下省略，完整路径在悬停提示）· 时间（按时长位数预留宽度）。
  function syncNow() {
    const n = M()?.now();
    nowName.textContent = n?.name ?? '';
    nowName.title = n?.full ?? '';
    const d = n?.duration;
    nowTime.textContent = n ? clock(n.time) + ' / ' + (d ? clock(d) : '-:--') : '';
    nowTime.dataset.room = n ? clock(d || 0).replace(/\d/g, '0') + ' / ' + clock(d || 0).replace(/\d/g, '0') : '';
    now.classList.toggle('empty', !n);
  }
  function syncTransport() {
    hasMedia = !!M()?.hasMedia(ctx.current);
    const tr = T(),
      off = disabledControls({ mode: tr.mode, hasMedia });
    pressed(cross, tr.crossBook);
    pressed(sections, tr.sectionsOnly);
    pressed(single, tr.single);
    setIcon(play, tr.running ? 'pause' : 'play');
    play.label = tr.running ? 'mvPause' : 'mvPlay';
    setLabel(play, t(play.label));
    pressed(play, tr.running);
    play.disabled = off.has('play');
    for (const b of modes.children) b.setAttribute('aria-checked', String(b.dataset.mode === tr.mode));
    for (const id of ['scrollRate', 'order', 'loop', 'playRate', 'volume']) btns[id].disabled = off.has(id);
    // 循环在漫画、混合模式下是整本循环（跨书开启时是整个阅读列表），提示里写明。
    loop.label = tr.mode === 'media' ? 'mvLoop' : tr.crossBook ? 'cbLoopList' : 'cbLoopBook';
    setLabel(loop, t(loop.label));
    for (const d of dials) d.sync();
    bar.dataset.mode = tr.mode;
    syncMedia();
  }
  function syncMedia() {
    const m = M();
    if (m) {
      setIcon(order, ORDER_ICON[m.order]);
      order.label = ORDER_LABEL[m.order];
      setLabel(order, t(order.label));
      pressed(loop, m.loop);
    }
    volDial.sync();
    setIcon(muteBtn, m?.muted ? 'volume' : 'volume-x');
    setLabel(muteBtn, t(m?.muted ? 'cbUnmute' : 'cbMute'));
    pressed(muteBtn, m?.muted);
    syncSteps();
  }
  function syncAll() {
    texts();
    syncBooks();
    syncTransport();
    syncScroll();
    syncNow();
  }

  // ---- 窄窗口：先收次要按钮，仍放不下再分两行。
  const minors = [
    [toStart, nextBook, moreL],
    [toEnd, nextBook, moreL],
    [order, moreR.b, moreR],
    [loop, moreR.b, moreR],
    [popout, null, moreR],
  ];
  function compact(on) {
    for (const [b, before, m] of minors)
      if (on) m.pop.append(b);
      else if (before) before.before(b);
      else right.append(b);
    moreL.b.hidden = moreR.b.hidden = !on;
    if (!on) for (const m of [moreL, moreR]) if (m.pop.matches(':popover-open')) m.pop.hidePopover();
    bar.classList.toggle('compact', on);
  }
  const overflows = () =>
    bar.scrollWidth > bar.clientWidth + 1 || [...bar.children].some((z) => z.scrollWidth > z.clientWidth + 1);
  function fit() {
    if (bar.hidden) return;
    bar.classList.remove('stacked', 'tall');
    compact(false);
    if (!overflows()) return;
    compact(true);
    if (!overflows()) return;
    bar.classList.add('stacked');
    if (overflows()) bar.classList.add('tall');
  }

  // ---- 弹出与收起（底缘停留弹出，离开收起；Esc 收起）
  let showTimer = 0,
    leaveTimer = 0;
  const cancel = () => {
      clearTimeout(showTimer);
      showTimer = 0;
    },
    stay = () => {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    };
  function show(open) {
    stay();
    ctx.fade(bar, open);
    document.body.classList.toggle('controlbar-open', open);
    if (open) {
      syncAll();
      fit();
    } else {
      for (const d of dials) d.hide();
      for (const m of [moreL, moreR]) if (m.pop.matches(':popover-open')) m.pop.hidePopover();
    }
  }
  const nearBottom = (e) => {
    const r = main.getBoundingClientRect();
    return ctx.atEdge('bottom', e) && e.clientX >= r.left && e.clientX <= r.right;
  };
  let scrollFrame = 0;
  main.addEventListener(
    'scroll',
    () => {
      if (showing() && !scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0;
          syncScroll();
        });
    },
    { passive: true },
  );
  new ResizeObserver(() => {
    if (showing()) fit();
  }).observe(main); // 窗口缩放、侧栏停靠时阅读区宽度变化
  bar.addEventListener('click', (e) => {
    if (!e.target.closest('.dial-pop')) main.focus(); // 按钮不留焦点，F / Enter / 空格继续作用于正文
  });
  ctx.on('select', () => {
    if (!ctx.current) show(false);
    else setTimeout(() => (showing() ? syncAll() : syncTransport()));
  });
  ctx.on('books', () => showing() && syncBooks());
  ctx.on('synced', (book) => book === ctx.current && syncTransport());
  // 开关与模式的状态随时更新（不显示时也保持最新，开销很小）；时间与逐页查找只在显示时更新。
  ctx.on('transport', syncTransport);
  ctx.on('media', (key) => {
    if (key === 'time' || key === 'current' || key === 'state') {
      if (!showing()) return;
      syncNow();
      if (key !== 'time') syncSteps();
    } else syncMedia();
  });
  ctx.on('lang', () => showing() && (syncAll(), fit()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && showing()) show(false);
  });
  document.addEventListener('pointermove', (e) => {
    const mouse = e.pointerType === 'mouse' && !e.buttons;
    const low = mouse && ctx.current && nearBottom(e) && !showing() && !dialog() && ctx.get('edgeBottom', true);
    if (!low) cancel();
    else if (!showTimer)
      showTimer = setTimeout(() => {
        showTimer = 0;
        if (ctx.current && !dialog()) show(true);
      }, DWELL);
    if (showing() && e.pointerType === 'mouse') {
      if (bar.contains(e.target) || nearBottom(e)) stay();
      else if (!leaveTimer)
        leaveTimer = setTimeout(() => {
          leaveTimer = 0;
          if (!bar.matches(':hover') && !bar.querySelector(':focus-visible')) show(false);
        }, LEAVE);
    }
  });
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) cancel();
  });
  // 到顶部 / 到底部只滚动（已在首尾时变灰），切书交给两端的上一本 / 下一本；Home / End 在首尾再按一次切书的键盘行为不变（keys.mjs）。
  ctx.actions.toStart = () => {
    if (!ctx.atStart()) ctx.toStart();
  };
  ctx.actions.toEnd = () => {
    if (!ctx.atEnd()) ctx.toEnd();
  };
  texts();
  ctx.prefs?.sync('edgeBottom');
  ctx.settings.push({
    id: 'edgeBottom',
    group: 'toolbar',
    label: 'tbEdgeBottom',
    type: 'toggle',
    get: () => ctx.get('edgeBottom', true),
    set: (v) => ctx.put('edgeBottom', !!v),
  });
  ctx.controlBar = { show, fit };
}
