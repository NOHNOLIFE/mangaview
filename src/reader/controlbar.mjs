// 总控栏：取代原来的底部操作栏。鼠标贴近底缘稍作停留即弹出、移开后收起（设置里可关闭底缘弹出），按 T 与顶部工具栏一起显示 / 收起；
// 新窗口播放的窗口里同样有。默认一行，分三区（排布见 core/control.mjs 的 ZONES，左右对称）：
// - 左（阅读）：上一本、书首、书尾、下一本（书架有筛选时带小圆点，只在筛选结果内切换）│ 跨书开关、滚动速率。
// - 中（运行）：播放模式（二级按钮：图标是当前模式，悬停 / 聚焦在上方弹出三种模式，点击轮换）、只播区段、大的播放 / 暂停（唯一的主按钮，= 空格）、
//   单文件模式、循环。
// - 右（媒体）：上一个媒体、下一个媒体、播放顺序 │ 播放速率、音量、新窗口播放、字幕（作用于文件栏显示的那个媒体：开 / 关，
//   多个字幕时弹出选择菜单，菜单与开关在 media/subtitles.mjs；没有字幕或不是媒体时变灰）。
// 速率按钮只显示一位小数的数字（不带「×」，与其他图标按钮同宽），提示与小面板里带「×」。
// 二级按钮（播放模式、速率、音量、「⋯」）悬停或键盘聚焦即在按钮正上方弹出，移开收起（ui/hoverpop.mjs）。
// 书名与阅读进度在顶部工具栏下方的名称区（toolbar.mjs）。三区那一行的上方是文件栏的行容器（#filebar，内容由文件栏模块放入；
// 空时 hidden、不占高度），与总控栏一起显示 / 收起、同宽：经 ctx.controlBar.fileRow 取得，显示 / 收起时派发 'controlbar'（是否显示）。
// 状态在 ctx.transport（transport.mjs）与 ctx.media（media/driver.mjs）；禁用规则在 core/control.mjs（与当前模式无关的变暗禁用，不隐藏、不移动）。
// 位置稳定：速率的数字宽度固定（一位小数），按钮禁用只变暗。窄窗口：先把左、右区的次要按钮收进本区末尾的「⋯」弹出层（.compact，仍是一行），
// 仍放不下时分两行（.stacked：中区一行，左、右区并排一行）；总控栏自身最多两行，任何宽度都不横向溢出。
import { extend } from '../core/lang.mjs';
import {
  RATES,
  RATE_STEP,
  rateOf,
  stepRate,
  rateText,
  rateLabel,
  disabledControls,
  MODES,
  arrange,
  nextMode,
} from '../core/control.mjs';
import { nudge } from '../core/model.mjs';
import { make, icon } from '../ui/dom.mjs';
import { ORDER_ICON, ORDER_LABEL } from '../media/order.mjs';
import { DWELL, LEAVE } from './toolbar.mjs';
import { hoverPop, morePop } from '../ui/hoverpop.mjs';
import { dial, arrows } from './controlbar-dial.mjs';

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

const MODE_ICON = { comic: 'mode-comic', mixed: 'mode-mixed', media: 'mode-media' },
  MODE_LABEL = { comic: 'cbComic', mixed: 'cbMixed', media: 'cbMedia' };

export function install(ctx) {
  const { main, t } = ctx;
  const T = () => ctx.transport,
    M = () => ctx.media;
  const dialog = () => document.querySelector('dialog[open]');

  // ---- DOM：#controlbar 是弹出层，内含文件栏的行容器与三区那一行。
  const bar = make('div');
  bar.id = 'controlbar';
  bar.setAttribute('role', 'toolbar');
  bar.hidden = true;
  const fileRow = make('div');
  fileRow.id = 'filebar';
  fileRow.hidden = true;
  const zones = make('div', 'cb-zones');
  bar.append(fileRow, zones);
  const zone = (cls) => {
    const z = make('div', 'cb-zone ' + cls);
    zones.append(z);
    return z;
  };
  const left = zone('cb-left'),
    mid = zone('cb-mid'),
    right = zone('cb-right');
  // 图标按钮：文字只在 title 与 aria-label（label 为文案 key 或返回文字的函数）。
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
  const labelOf = (b) => (typeof b.label === 'function' ? b.label() : t(b.label));
  const pressed = (b, on) => b.setAttribute('aria-pressed', String(!!on));
  const sep = () => {
    const s = make('span', 'cb-sep');
    s.setAttribute('aria-hidden', 'true');
    return s;
  };
  // 「⋯」弹出层：窄窗口时收进来的次要按钮（左、右区各一个，位于本区末尾）。悬停或键盘聚焦即在「⋯」正上方弹出，点了里面的按钮即收起
  // （速率按钮除外：它的小面板在弹出层上方接着用，与「⋯」嵌套显示）。
  const dials = [];
  function more(id) {
    const b = btn(id, 'more', 'cbMore', null, 'cb-more'),
      pop = make('div', 'cb-pop cb-more-pop');
    return { b, pop, h: morePop(b, pop) };
  }
  const closeMore = (m) => m.h.hide();

  // 左区
  const prevBook = btn('prevBook', 'book-prev', 'prev', null, 'cb-book'),
    toStart = btn('toStart', 'to-top', 'toTop', null),
    toEnd = btn('toEnd', 'to-end', 'toEnd', null),
    nextBook = btn('nextBook', 'book-next', 'next', null, 'cb-book'),
    cross = btn('crossBook', 'cross-book', 'cbCrossBook', () => T().setCrossBook(!T().crossBook), 'cb-toggle'),
    moreL = more('moreLeft');
  prevBook.dataset.act = 'prev';
  nextBook.dataset.act = 'next';
  toStart.dataset.act = 'toStart';
  toEnd.dataset.act = 'toEnd';
  const scrollDial = dial({
    id: 'scrollRate',
    cls: 'cb-rate',
    label: () => t('cbScrollRate') + ' ' + rateLabel(T().scrollRate),
    face: (b) => {
      b.textContent = rateText(T().scrollRate);
    },
    click: () => T().setScrollRate(1),
    nudge: (d) => T().setScrollRate(stepRate(T().scrollRate, d, 'scroll')),
    slider: {
      min: RATES.scroll.min,
      max: RATES.scroll.max,
      step: RATE_STEP,
      get: () => T().scrollRate,
      set: (v) => T().setScrollRate(rateOf(v, 'scroll')),
      text: rateLabel,
    },
    presets: RATES.scroll.presets.map((v) => ({ value: v, text: rateLabel(v) })),
  });
  btns.scrollRate = scrollDial.button;

  // 中区：播放模式是二级按钮（图标为当前模式；悬停 / 聚焦弹出三种模式，与速率小面板的交互一致；点击轮换，方向键逐个切换）。
  const modeBtn = btn(
      'mode',
      MODE_ICON.mixed,
      () => t('cbMode') + ' · ' + t(MODE_LABEL[T()?.mode ?? 'mixed']),
      () => T().setMode(nextMode(T().mode)),
    ),
    modePop = make('div', 'cb-pop mode-pop');
  modePop.dataset.for = 'mode';
  modePop.setAttribute('role', 'radiogroup');
  for (const m of MODES) {
    const b = btn('mode-' + m, MODE_ICON[m], MODE_LABEL[m], () => T().setMode(m), 'cb-mode');
    b.setAttribute('role', 'radio');
    b.dataset.mode = m;
    modePop.append(b);
  }
  const modeHover = hoverPop(modeBtn, modePop);
  arrows(modeBtn, (d) => T().setMode(nextMode(T().mode, d)));
  const sections = btn('sections', 'sections', 'mvSections', () => T().setSectionsOnly(!T().sectionsOnly), 'cb-toggle'),
    play = btn('play', 'play', 'mvPlay', () => T().toggle(), 'cb-play'),
    single = btn('single', 'single-file', 'cbSingle', () => T().setSingle(!T().single), 'cb-toggle'),
    loop = btn('loop', 'repeat', 'mvLoop', () => M()?.toggleLoop(), 'cb-toggle');

  // 右区
  const mediaPrev = btn('mediaPrev', 'skip-back', 'cbMediaPrev', () => M()?.step(-1)),
    mediaNext = btn('mediaNext', 'skip-forward', 'cbMediaNext', () => M()?.step(1)),
    order = btn('order', 'order-list', 'mvOrderList', () => M()?.cycleOrder()),
    moreR = more('moreRight');
  const playDial = dial({
    id: 'playRate',
    cls: 'cb-rate',
    label: () => t('cbPlayRate') + ' ' + rateLabel(T().playRate),
    face: (b) => {
      b.textContent = rateText(T().playRate);
    },
    click: () => T().setPlayRate(1),
    nudge: (d) => T().setPlayRate(stepRate(T().playRate, d, 'play')),
    slider: {
      min: RATES.play.min,
      max: RATES.play.max,
      step: RATE_STEP,
      get: () => T().playRate,
      set: (v) => T().setPlayRate(rateOf(v, 'play')),
      text: rateLabel,
    },
    presets: RATES.play.presets.map((v) => ({ value: v, text: rateLabel(v) })),
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
  const popout = btn('popout', 'popout', 'mvPopout', () => M()?.popout());
  // 字幕：作用于文件栏显示的那个媒体（ctx.media.target()），开关与选择菜单用字幕模块登记的同一份控件（ctx.player.add 的 'subs'）。
  const subsControl = () => ctx.player?.controls().find((x) => x.id === 'subs');
  const subsTarget = () => {
    const p = M()?.target?.()?.player ?? null;
    return p && p.state !== 'failed' ? p : null;
  };
  const subs = btn('subs', 'subtitles', 'mvSubs', () => {
    const p = subsTarget();
    if (p) subsControl()?.click?.(p, ctx.player.api, subs);
    syncSubs();
  });
  subs.dataset.control = 'subs'; // 字幕菜单按 [data-control="subs"] 判断是否点在同一个按钮上（再点一次即收起）
  dials.push(scrollDial, playDial, volDial);
  document.body.append(bar);

  // ---- 排布：按 core/control.mjs 的 arrange 把按钮（连同它的小面板）、分隔线、「⋯」放进各区与「⋯」弹出层。
  const popOf = { scrollRate: scrollDial.pop, playRate: playDial.pop, volume: volDial.pop, mode: modePop };
  const parts = {
    left: { row: left, sep: sep(), more: moreL },
    mid: { row: mid },
    right: { row: right, sep: sep(), more: moreR },
  };
  let compacted = null;
  function hidePops() {
    for (const d of dials) d.hide();
    modeHover.hide();
    closeMore(moreL);
    closeMore(moreR);
  }
  function arrangeAll(compact) {
    if (compacted === compact) return;
    compacted = compact;
    hidePops();
    for (const [name, p] of Object.entries(parts)) {
      const nodes = (id) =>
        id === '|' ? [p.sep] : id === 'more' ? [p.more.b, p.more.pop] : [btns[id], ...(popOf[id] ? [popOf[id]] : [])];
      const { row, more: inMore } = arrange(name, compact);
      p.row.replaceChildren(...row.flatMap(nodes));
      p.more?.pop.replaceChildren(...inMore.flatMap(nodes));
    }
    bar.classList.toggle('compact', compact);
  }
  arrangeAll(false);

  // ---- 状态显示
  const showing = () => ctx.showing(bar);
  const others = () => !!ctx.current && ctx.readingList(ctx.current).some((b) => b !== ctx.current);
  let hasMedia = false;
  function texts() {
    bar.setAttribute('aria-label', t('controlBar'));
    modePop.setAttribute('aria-label', t('cbMode'));
    for (const b of Object.values(btns)) if (b.label) setLabel(b, labelOf(b));
    setLabel(muteBtn, t('cbMute'));
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
    syncSteps();
  }
  function syncSteps() {
    if (!showing()) return; // 要逐页查找，只在显示时计算
    const off = disabledControls({ mode: T().mode, hasMedia });
    mediaPrev.disabled = off.has('mediaPrev') || !M()?.canStep(-1);
    mediaNext.disabled = off.has('mediaNext') || !M()?.canStep(1);
    popout.disabled = off.has('popout') || !M()?.canPopout();
    syncSubs();
  }
  function syncSubs() {
    const p = subsTarget(),
      ctl = subsControl(),
      s = p && ctl?.state ? (ctl.state(p, ctx.player.api, subs) ?? {}) : { disabled: true };
    if (!p) subs.removeAttribute('aria-haspopup');
    subs.disabled = !!s.disabled;
    pressed(subs, !s.disabled && s.pressed);
    subs.label = s.label ?? 'mvSubs';
    setLabel(subs, t(subs.label));
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
    setIcon(modeBtn, MODE_ICON[tr.mode]);
    setLabel(modeBtn, labelOf(modeBtn));
    for (const b of modePop.children) b.setAttribute('aria-checked', String(b.dataset.mode === tr.mode));
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
  }

  // ---- 窄窗口：一行放不下时先收次要按钮（仍一行），仍放不下再分两行（中区一行，左、右区并排一行）。
  const overflows = () =>
    bar.scrollWidth > bar.clientWidth + 1 ||
    zones.scrollWidth > zones.clientWidth + 1 ||
    [...zones.children].some((z) => z.scrollWidth > z.clientWidth + 1);
  function fit() {
    if (bar.hidden) return;
    bar.classList.remove('stacked');
    arrangeAll(false);
    if (!overflows()) return;
    arrangeAll(true);
    if (overflows()) bar.classList.add('stacked');
  }

  // ---- 弹出与收起（底缘停留弹出，离开收起；T 与工具栏一起开关；Esc 收起）
  let showTimer = 0,
    leaveTimer = 0,
    open = false,
    auto = false; // 由底缘弹出（或指针进过栏）：指针离开后自动收起；按 T 打开的不随指针移动收起
  const cancel = () => {
      clearTimeout(showTimer);
      showTimer = 0;
    },
    stay = () => {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    };
  function show(on, edge = false) {
    stay();
    if (on) auto = edge;
    ctx.fade(bar, on);
    document.body.classList.toggle('controlbar-open', on);
    if (on) {
      syncAll();
      fit();
    } else hidePops();
    if (on !== open) {
      open = on;
      ctx.emit('controlbar', on);
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
  // 按钮不留焦点，F / Enter / 空格继续作用于正文；速率小面板里的滑杆、键盘操作的小面板除外。
  bar.addEventListener('click', (e) => {
    if (e.target.closest('.dial-pop') || (e.detail === 0 && e.target.closest('.hover-pop'))) return;
    main.focus();
  });
  ctx.on('select', () => {
    if (!ctx.current) show(false);
    else setTimeout(() => (showing() ? syncAll() : syncTransport()));
  });
  ctx.on('books', () => showing() && syncBooks());
  ctx.on('synced', (book) => book === ctx.current && syncTransport());
  // 开关与模式的状态随时更新（不显示时也保持最新，开销很小）；逐页查找只在显示时更新。
  ctx.on('transport', syncTransport);
  ctx.on('media', (key) => {
    if (key === 'time') return;
    if (key === 'current' || key === 'state') syncSteps();
    else syncMedia();
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
        if (ctx.current && !dialog()) show(true, true);
      }, DWELL);
    if (showing() && e.pointerType === 'mouse') {
      if (bar.contains(e.target)) auto = true;
      if (!auto) return;
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
  // 书首 / 书尾只滚动（已在首尾时变灰），切书交给两端的上一本 / 下一本；Home / End 在首尾再按一次切书的键盘行为不变（keys.mjs）。
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
  // show(是否显示)：按 T 时与工具栏一起开关（keys.mjs）；fileRow：文件栏的行容器；showing()：总控栏是否显示。
  ctx.controlBar = { show: (on) => show(!!on), fit, fileRow, showing };
}
