// 媒体与总控（reader/transport.mjs 的 ctx.transport）的衔接：
// - 'media' 模式的驱动器：开始 = 播放当前媒体（没有当前媒体时取视窗内或其后最近的媒体，滚到居中再播放），停止 = 暂停；
//   播完之后的切换沿用 order.mjs 的「播放顺序 × 循环」。running 与实际播放保持一致：有媒体开始播放即报告运行，
//   暂停、播完不再继续、打不开时报告停止（ctx.transport.report，只在 'media' 是当前模式生效的驱动器时起作用）。
// - 单个媒体自己的播放键（press，也用于点击画面）：影音、混合模式下等同大播放键并把它设为当前媒体（混合模式下由 reader/engine.mjs 先播它，
//   播完接着往下滚）；漫画模式下只播这一个文件，播完即停。
// - 混合模式的驱动器（reader/engine.mjs）经 ctx.media.run 播放、暂停媒体并查看它的状态；翻屏对齐经 ctx.media.align（autoplay.mjs）。
// - 当前媒体（autoplay.mjs current）带 .current 类（强调色外框）。S.chosen 是选定的媒体（按过自己的播放键、开始播放或被切到的）：
//   在播放或仍在视窗内时优先作为当前媒体；没有在播放时，正文一滚动就不再优先。
// - 上一个 / 下一个媒体（总控栏）：按播放顺序找（列表、单集按页序，随机按本轮洗牌、上一个按播放记录），滚到居中；在播放时接着播放。
// - 播放速率 ctx.transport.playRate 作用于所有媒体元素（含之后加载的），变速不变调（preservesPitch 保持默认）。
// - 总控栏经 ctx.media 读写音量、播放顺序、循环，读当前媒体的名称与时间（now）；变化时派发 ctx.emit('media', 字段名)。
import { pageKind, shownName } from '../core/model.mjs';
import { following } from '../core/playlist.mjs';

export function install(ctx, S) {
  const { main } = ctx,
    { players, times, rounds, api } = S;
  const start = (...a) => S.start(...a),
    toggle = (...a) => S.toggle(...a),
    current = (...a) => S.current(...a),
    claimNow = (...a) => S.claimNow(...a),
    candidates = (...a) => S.candidates(...a),
    sectionMap = (...a) => S.sectionMap(...a),
    switchTo = (...a) => S.switchTo(...a),
    savedPos = (...a) => S.savedPos(...a),
    popout = (...a) => S.popout(...a),
    inView = (...a) => S.inView(...a),
    align = (...a) => S.align(...a);
  const on = (p) => (p.state === 'ready' && !p.el.paused) || p.wantPlay;
  const busy = () => [...players.values()].some(on) || !!S.queued?.play;
  const playerOf = (el) => players.get(el?.closest?.('.page'));

  // ---- 'media' 驱动器
  ctx.transport.drive('media', {
    start() {
      const p = current();
      if (p) {
        S.chosen = p;
        p.solo = false;
        if (!on(p)) start(p);
        return true;
      }
      return ahead();
    },
    stop: pauseAll,
  });
  // 停止：暂停正在播放和等着播放的媒体（算作手动暂停）。
  function pauseAll() {
    if (S.queued?.play) S.queued = null;
    for (const p of players.values())
      if (p.wantPlay) {
        p.wantPlay = false;
        p.userPaused = true;
      } else if (p.state === 'ready' && !p.el.paused) {
        p.userPaused = true;
        p.el.pause();
      }
  }
  // 视窗里没有当前媒体：从视窗顶部所在的页起往后找第一个可播放的媒体，滚到居中，从记住的位置播放。
  function ahead() {
    const book = ctx.current;
    if (!book) return false;
    const starts = ctx.view.panes?.[0]?.starts ?? [];
    let from = 0;
    while (from < book.pages.length && starts[from + 1] != null && starts[from + 1] <= main.scrollTop) from++;
    const i = candidates(book, sectionMap(book)).find((x) => x >= from);
    if (i == null) return false;
    const page = book.pages[i],
      time = times.get(page) ?? savedPos(book, page);
    S.queued = { page, time, play: true, auto: false };
    ctx.view.jump({ i, f: 0.5 });
    claimNow();
    requestAnimationFrame(claimNow);
    return true;
  }
  // 运行状态：开始播放即运行；暂停、播完、打不开后稍等片刻（播完可能正切到下一个）再看是否还有媒体在播放或等着播放。
  let syncTimer = 0;
  function changed() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => ctx.transport.report('media', busy()), 250);
    later();
  }
  S.changed = changed;

  // ---- 单个媒体自己的播放键、点击画面
  function press(p) {
    if (p.state === 'failed') return;
    S.chosen = p;
    mark();
    if (ctx.transport.mode === 'comic') {
      if (!on(p)) p.solo = true;
      toggle(p);
    } else if (on(p)) {
      ctx.transport.stop();
      if (on(p)) toggle(p); // 未运行时在播放的（混合模式下自动播放的视频）：直接暂停
    } else {
      S.pressed = p; // 混合模式的驱动器从它开始（run.first）
      ctx.transport.start();
      S.pressed = null;
    }
  }

  // ---- 混合模式的驱动器（reader/engine.mjs）用：媒体按页（page 对象）指称，只看当前书、正文里的播放器。
  const playerAt = (page) => [...players.values()].find((p) => p.page === page && p.book === ctx.current);
  const run = {
    // 能否停下来播放：视频、音频，且没有记为播不了。
    playable: (page) => ['video', 'audio'].includes(pageKind(page)) && !page.bad && !S.failedPages.has(page),
    // 开始运行时先播哪一个：刚按了自己播放键的；否则正在播放的；否则选定的当前媒体（仍在视窗内、没有播完）；都没有为 null。
    first() {
      const ok = (p) => p && players.has(p.node) && p.book === ctx.current && p.state !== 'failed';
      if (ok(S.pressed)) return S.pressed.page;
      const p = [...players.values()].find((q) => ok(q) && on(q));
      if (p) return p.page;
      const c = S.chosen;
      return ok(c) && !c.done && inView(c) ? c.page : null;
    },
    // 播放这一页的媒体（已滚到视窗中央）：正在播放的不动；否则从记住的位置播放（只播区段时从区段开始，见 player.mjs start）。
    play(page) {
      const p = playerAt(page);
      if (p && on(p)) {
        S.chosen = p;
        return;
      }
      if (p && p.state === 'ready' && inView(p)) {
        S.chosen = p;
        start(p);
        mark();
        return;
      }
      S.queued = { page, time: times.get(page) ?? savedPos(ctx.current, page), play: true, auto: false };
      claimNow();
      requestAnimationFrame(claimNow);
    },
    // 'wait' 等着挂源 / 播放；'playing' 在播放；'done' 播完（含区段播完）；'failed' 播不了；'away' 已离开视窗；'paused' 在视窗内被暂停。
    state(page) {
      if (S.queued?.page === page && S.queued.play) return 'wait';
      const p = playerAt(page);
      if (!p) return 'away';
      if (p.state === 'failed') return 'failed';
      if (on(p)) return 'playing';
      if (p.done || (p.state === 'ready' && p.el.ended)) return 'done'; // 'pause' 先于 'ended' 到达
      return inView(p) ? 'paused' : 'away';
    },
    pause: pauseAll,
    get loop() {
      return S.loop;
    },
  };

  // ---- 当前媒体的外框
  let marked = null,
    frame = 0;
  function mark() {
    const p = current() ?? null;
    if (p === marked) return;
    marked?.node.classList.remove('current');
    marked = p;
    p?.node.classList.add('current');
    ctx.emit('media', 'current');
  }
  function later() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        mark();
      });
  }
  // 滚动后，选定但没有在播放的媒体不再优先：当前媒体回到「正在播放的，否则离视窗中心最近的」。
  main.addEventListener(
    'scroll',
    () => {
      if (S.chosen && !on(S.chosen)) S.chosen = null;
      later();
    },
    { passive: true },
  );

  // ---- 播放速率
  const rate = () => ctx.transport.playRate;
  function applyRate(p) {
    p.el.defaultPlaybackRate = rate();
    p.el.playbackRate = rate();
  }

  // ---- 原生媒体元素的事件（不冒泡，在阅读区上用捕获监听）
  main.addEventListener(
    'play',
    (e) => {
      const p = playerOf(e.target);
      if (!p) return;
      S.chosen = p;
      const trail = (S.trail ??= []);
      if (trail.at(-1) !== p.page.name) trail.push(p.page.name);
      if (trail.length > 200) trail.shift();
      clearTimeout(syncTimer);
      ctx.transport.report('media', true);
      later();
      ctx.emit('media', 'state');
    },
    true,
  );
  for (const type of ['pause', 'ended', 'emptied'])
    main.addEventListener(
      type,
      (e) => {
        if (!playerOf(e.target)) return;
        changed();
        ctx.emit('media', 'state');
      },
      true,
    );
  for (const type of ['timeupdate', 'durationchange', 'seeked'])
    main.addEventListener(
      type,
      (e) => {
        const p = playerOf(e.target);
        if (p && p === marked) ctx.emit('media', 'time');
      },
      true,
    );
  main.addEventListener(
    'loadedmetadata',
    (e) => {
      const p = playerOf(e.target);
      if (p) applyRate(p);
    },
    true,
  );
  ctx.on('transport', (key) => {
    if (key === 'playRate') for (const p of players.values()) applyRate(p);
  });
  // 切书。影音模式运行中用户切到别的书：在新书里接着运行（从阅读位置往后找媒体），没有媒体即停止；跨书自动切过去的由 order.mjs 接手。
  ctx.on('select', (book) => {
    S.trail = [];
    S.chosen = null;
    if (book && book === S.onward) S.onward = null;
    else if (book && ctx.transport.running && ctx.transport.driver === 'media') ahead();
    changed();
  });

  // ---- 上一个 / 下一个媒体：按当前播放顺序找目标的页序号（没有为 null）。
  function target(d, roll = false) {
    const book = ctx.current;
    if (!book) return null;
    const list = candidates(book, sectionMap(book));
    if (!list.length) return null;
    const p = current(),
      cur = p ? book.pages.indexOf(p.page) : (ctx.view.position()?.i ?? 0);
    const others = list.filter((i) => i !== cur);
    if (!others.length) return null;
    if (S.order === 'shuffle') {
      if (d > 0) {
        if (!roll) return others[0];
        const names = rounds.get(book) ?? new Set();
        const r = following({
          order: 'shuffle',
          loop: true,
          list,
          cur,
          played: new Set(book.pages.flatMap((pg, i) => (names.has(pg.name) ? [i] : []))),
        });
        rounds.set(book, new Set([...r.played].map((i) => book.pages[i]?.name)));
        return r.next === cur ? null : r.next;
      }
      // 随机的上一个：本窗口的播放记录里，当前之前播过的那个。
      const trail = S.trail ?? [];
      for (let k = trail.length - 1; k >= 0; k--) {
        const i = book.pages.findIndex((pg) => pg.name === trail[k]);
        if (i !== cur && list.includes(i)) return i;
      }
    }
    const pick = d > 0 ? list.find((i) => i > cur) : list.findLast((i) => i < cur);
    if (pick != null) return pick;
    return S.loop ? (d > 0 ? list[0] : list.at(-1)) : null;
  }
  function step(d) {
    const book = ctx.current,
      i = target(d, true);
    if (i == null || !book) return;
    const play = ctx.transport.running || [...players.values()].some(on);
    if (d < 0 && S.order === 'shuffle' && S.trail?.length) {
      // 回到播放记录里的上一个：从记录中去掉当前这个，避免来回跳
      const name = book.pages[i].name;
      while (S.trail.length && S.trail.at(-1) !== name) S.trail.pop();
      S.trail.pop();
    }
    switchTo(book, i, sectionMap(book), play);
  }

  // ---- 总控栏读写的接口（ctx.media 由 media.mjs 建立；按属性描述符并入，保留取值函数）
  const bar = {
    press: (target) => {
      const p = playerOf(target);
      if (p) press(p);
    },
    get volume() {
      return S.volume;
    },
    get muted() {
      return S.muted;
    },
    setVolume: (v) => S.setVolume(v),
    setMuted: (b) => S.setMuted(b),
    volIcon: () => S.volIcon(),
    get order() {
      return S.order;
    },
    get loop() {
      return S.loop;
    },
    cycleOrder: () => S.cycleOrder(),
    toggleLoop: () => S.toggleLoop(),
    popout() {
      const p = current();
      if (p && p.state !== 'failed') popout(p);
    },
    canPopout: () => {
      const p = current();
      return !!p && p.state !== 'failed';
    },
    step,
    canStep: (d) => target(d) != null,
    hasMedia: (book) => !!book?.pages.some((pg) => ['video', 'audio'].includes(pageKind(pg))),
    run,
    align: (d, step) => align(d, step),
    // 当前媒体的名称（最末一段）、完整路径、时间与时长（秒）、是否在播放；没有当前媒体时为 null。
    now() {
      const p = marked && players.has(marked.node) ? marked : current();
      if (!p) return null;
      const full = shownName(p.page);
      return {
        name: full.slice(full.lastIndexOf('/') + 1),
        full,
        time: api.time(p),
        duration: api.duration(p),
        playing: on(p),
      };
    },
  };
  Object.defineProperties(ctx.media, Object.getOwnPropertyDescriptors(bar));
  Object.assign(S, { press, mark: later });
}
