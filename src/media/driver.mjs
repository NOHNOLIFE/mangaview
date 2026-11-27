// 媒体与总控（reader/transport.mjs 的 ctx.transport）、文件栏、总控栏的衔接：
// - 后台播放（press，用于点击画面 / 卡片、它自己的播放键、文件栏的播放键、空格）：只播放 / 暂停这个文件，不滚动、不跳转，不启动自动滚动；
//   开始播放时它成为当前曲目（p.by = 'user'）。在阅读区点击（from 'page'）开始播放时重建播放列表，其余方式（'bar'）只在它不在列表里时重建（queue.mjs）。
//   自动滚动运行中：点的是自动滚动正在播的那个，则暂停它并停止自动滚动；是别的媒体（不是当前曲目），则停止自动滚动并后台播放它；
//   是与自动滚动无关的当前曲目（漫画模式下，或混合模式尚未遇到媒体时）则只播放 / 暂停它，不影响自动滚动。
//   画面在外部容器里的当前曲目在阅读区被点击：画面收回页内并播放。
// - 'media' 模式的驱动器（影音模式的自动滚动）：开始 = 当前曲目在本书且中线在视窗内就播放它，否则播放视窗内离中心最近的媒体，
//   都没有时从视窗顶部所在的页往后找第一个媒体，滚到居中再播放；停止 = 暂停自动滚动播放的媒体。播完之后按页序与循环切换（order.mjs finished）。
//   running 与自动滚动播放的媒体（p.by === 'scroll'）保持一致：它开始播放即报告运行，暂停、播完不再继续、打不开时报告停止
//   （ctx.transport.report，只在 'media' 是当前模式生效的驱动器时起作用）；后台播放的媒体不影响运行状态。
// - 混合模式的驱动器（reader/engine.mjs）经 ctx.media.run 播放、暂停媒体并查看它的状态；它播放的媒体成为当前曲目（p.by = 'scroll'），
//   不读写播放列表。翻屏对齐经 ctx.media.align（autoplay.mjs）。
// - 当前文件（track.mjs target）变化时派发 ctx.emit('media', 'current')；当前曲目变了另派发 'track'（track.mjs），播放 / 暂停派发 'state'，
//   当前文件的时间变化派发 'time'（媒体元素自己的事件经 S.notify 转来，元素停放或在外部容器里时照样派发）。
// - 上一个 / 下一个媒体（总控栏）：自动滚动运行中由自动滚动切换（滚到居中播放）；否则有当前曲目时在播放列表里切换（不跳转，保持播放或暂停，queue.mjs）；
//   都不是时在本书里按页序定位到上一个 / 下一个媒体并居中（两端相接），不播放、不选中。
// - 播放速率 ctx.transport.playRate 作用于所有媒体元素（含之后加载的），变速不变调（preservesPitch 保持默认）。
// - 总控栏、文件栏经 ctx.media 读写音量，读当前文件（target）与当前媒体的名称与时间（now）；变化时派发 ctx.emit('media', 字段名)。
import { pageKind, shownName } from '../core/model.mjs';
import { stepIn } from '../core/playlist.mjs';

export function install(ctx, S) {
  const { main } = ctx,
    { players, times, api } = S;
  const start = (...a) => S.start(...a),
    current = (...a) => S.current(...a),
    fileTarget = (...a) => S.target(...a),
    pick = (...a) => S.pick(...a),
    select = (...a) => S.select(...a),
    claimNow = (...a) => S.claimNow(...a),
    candidates = (...a) => S.candidates(...a),
    sectionMap = (...a) => S.sectionMap(...a),
    switchTo = (...a) => S.switchTo(...a),
    savedPos = (...a) => S.savedPos(...a),
    inView = (...a) => S.inView(...a),
    align = (...a) => S.align(...a);
  const on = (p) => (p.state === 'ready' && !p.el.paused) || p.wantPlay;
  const busy = () => S.all().some((p) => p.by === 'scroll' && on(p)) || (!!S.queued?.play && S.queued.by === 'scroll');
  const playerOf = (el) => players.get(el?.closest?.('.page'));
  const pause = (p) => {
    if (p.wantPlay) p.wantPlay = false;
    else if (p.state === 'ready' && !p.el.paused) p.el.pause();
    p.userPaused = true;
  };

  // ---- 'media' 驱动器
  ctx.transport.drive('media', {
    start() {
      const p = pick();
      if (p) {
        p.by = 'scroll';
        select(p, 'play');
        if (!on(p)) start(p);
        return true;
      }
      return ahead();
    },
    stop: pauseScroll,
  });
  // 停止自动滚动：暂停它正在播放和等着播放的媒体（算作手动暂停）；后台播放的不动。
  function pauseScroll() {
    if (S.queued?.play && S.queued.by === 'scroll') S.queued = null;
    for (const p of S.all()) if (p.by === 'scroll' && on(p)) pause(p);
  }
  // 视窗里没有可播的媒体：从视窗顶部所在的页起往后找第一个可播放的媒体，滚到居中，从记住的位置播放。
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
    S.queued = { page, time, play: true, hop: false, by: 'scroll' };
    ctx.view.jump({ i, f: 0.5 });
    claimNow();
    requestAnimationFrame(claimNow);
    return true;
  }
  // 运行状态：自动滚动的媒体开始播放即运行；暂停、播完、打不开后稍等片刻（播完可能正切到下一个）再看是否还有它的媒体在播放或等着播放。
  let syncTimer = 0;
  function changed() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => ctx.transport.report('media', busy()), 250);
    later();
  }
  S.changed = changed;

  // ---- 后台播放：单个媒体自己的播放键、点击画面、文件栏的播放键、空格。from：'page' 在阅读区点击，'bar' 文件栏的播放键、空格。
  function press(p, from = 'bar') {
    if (p.state === 'failed') return;
    const tr = ctx.transport;
    if (tr.running && p === S.track && p.by === 'scroll') {
      if (on(p)) pause(p);
      tr.stop();
      return;
    }
    if (tr.running && p !== S.track) tr.stop();
    if (from === 'page' && p === S.track && S.stage.where() === 'out') {
      S.stage.back();
      if (on(p)) return;
    } else if (on(p)) {
      pause(p);
      return;
    }
    p.by = 'user';
    S.fresh?.(p);
    select(p, 'press');
    if (from === 'page') S.rebuild?.(p);
    else S.ensure?.(p);
    start(p);
  }

  // ---- 混合模式的驱动器（reader/engine.mjs）用：媒体按页（page 对象）指称，只看当前书、正文里的播放器。
  const playerAt = (page) => [...players.values()].find((p) => p.page === page && p.book === ctx.current);
  const run = {
    // 能否停下来播放：视频、音频，且没有记为播不了。
    playable: (page) => ['video', 'audio'].includes(pageKind(page)) && !page.bad && !S.failedPages.has(page),
    // 开始运行时先播哪一个：当前曲目在本书且中线在视窗内就是它（在播放的接着播），否则视窗内离中心最近的媒体；都没有为 null（直接滚动）。
    first() {
      const p = pick();
      return p && !(p === S.track && p.done) ? p.page : null;
    },
    // 播放这一页的媒体（已滚到视窗中央）：正在播放的不动；否则从记住的位置播放（只播区段时从区段开始，见 player.mjs start）。
    play(page) {
      const p = playerAt(page);
      if (p && (on(p) || (p.state === 'ready' && inView(p)))) {
        p.by = 'scroll';
        select(p, 'play');
        if (!on(p)) start(p);
        return;
      }
      S.queued = { page, time: times.get(page) ?? savedPos(ctx.current, page), play: true, hop: false, by: 'scroll' };
      claimNow();
      requestAnimationFrame(claimNow);
    },
    // 'wait' 等着挂源 / 播放；'playing' 在播放；'done' 播完（含区段播完）；'failed' 播不了；'away' 已离开视窗；'paused' 在视窗内被暂停。
    state(page) {
      if (S.queued?.page === page && S.queued.play) return 'wait';
      const p = playerAt(page);
      if (!p || !inView(p)) return 'away';
      if (p.state === 'failed') return 'failed';
      if (on(p)) return 'playing';
      if (p.done || (p.state === 'ready' && p.el.ended)) return 'done'; // 'pause' 先于 'ended' 到达
      return 'paused';
    },
    pause: pauseScroll,
  };

  // ---- 当前文件的变化（选中、滚动、切书后）：派发 'current'；marked 是当前媒体（它的时间变化派发 'time'）。
  let marked = null,
    markedPage = null,
    frame = 0;
  function mark() {
    const tg = fileTarget(),
      p = current() ?? null,
      page = tg?.page ?? null;
    if (p === marked && page === markedPage) return;
    marked = p;
    markedPage = page;
    ctx.emit('media', 'current');
  }
  function later() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        mark();
      });
  }
  // 滚动后当前文件可能变了（视窗中心换了一页）。
  main.addEventListener('scroll', later, { passive: true });

  // ---- 播放速率
  const rate = () => ctx.transport.playRate;
  function applyRate(p) {
    p.el.defaultPlaybackRate = rate();
    p.el.playbackRate = rate();
  }

  // ---- 媒体元素的事件（player.mjs 经 S.notify 转来）
  S.notify = (p, type) => {
    if (type === 'play') {
      select(p, 'play', { stay: true });
      if (p.by === 'scroll') {
        clearTimeout(syncTimer);
        ctx.transport.report('media', true);
      }
      later();
      ctx.emit('media', 'state');
    } else if (type === 'pause' || type === 'ended' || type === 'emptied') {
      changed();
      ctx.emit('media', 'state');
    } else if (type === 'time' || type === 'durationchange') {
      if (p === marked) ctx.emit('media', 'time');
    } else if (type === 'meta') applyRate(p);
  };
  ctx.on('transport', (key) => {
    if (key === 'playRate') for (const p of S.all()) applyRate(p);
  });
  // 切书。影音模式运行中用户切到别的书：在新书里接着运行（从阅读位置往后找媒体），没有媒体即停止；跨书自动切过去的由 order.mjs 接手。
  ctx.on('select', (book) => {
    if (book && book === S.onward) S.onward = null;
    else if (book && ctx.transport.running && ctx.transport.driver === 'media') ahead();
    changed();
  });

  // ---- 上一个 / 下一个媒体
  // 本书里按页序的目标页序号（两端相接；没有别的媒体时为 null）：从当前媒体或视窗中心所在的页算起。
  function target(d) {
    const book = ctx.current;
    if (!book) return null;
    const list = candidates(book, sectionMap(book)),
      p = current(),
      cur = p && p.book === book ? book.pages.indexOf(p.page) : (ctx.view.position()?.i ?? 0);
    return stepIn(list, cur, d);
  }
  const queueMode = () => !ctx.transport.running && !!S.track;
  function step(d) {
    if (queueMode()) return ctx.media.queue.step(d);
    const book = ctx.current,
      i = target(d);
    if (i == null || !book) return;
    if (ctx.transport.running) switchTo(book, i, sectionMap(book));
    else {
      if (S.full) S.leaveFull();
      ctx.view.jump({ i, f: 0.5 });
    }
  }

  // ---- 总控栏读写的接口（ctx.media 由 media.mjs 建立；按属性描述符并入，保留取值函数）
  const bar = {
    // 后台播放 / 暂停：x 为播放器（文件栏传 target().player）或正文里媒体页内的元素。
    press: (x, from = 'bar') => {
      const p = x?.el instanceof HTMLMediaElement ? x : playerOf(x);
      if (p) press(p, from);
    },
    // 当前文件（文件栏）：{book, page, i, kind, player}，见 track.mjs target。
    target: () => fileTarget(),
    // 视频全屏（文件栏的全屏按钮）：再按一次退出；isFull(p) 是否正在全屏。
    fullscreen: (p) => S.fullscreen(p),
    isFull: (p) => !!p && S.full === p,
    get volume() {
      return S.volume;
    },
    get muted() {
      return S.muted;
    },
    setVolume: (v) => S.setVolume(v),
    setMuted: (b) => S.setMuted(b),
    volIcon: () => S.volIcon(),
    step,
    canStep: (d) => (queueMode() ? ctx.media.queue.canStep(d) : target(d) != null),
    hasMedia: (book) => !!book?.pages.some((pg) => ['video', 'audio'].includes(pageKind(pg))),
    // 有没有当前曲目（总控栏右区的禁用规则用）。
    hasTrack: () => !!S.track,
    run,
    align: (d, step) => align(d, step),
    // 当前媒体的名称（最末一段）、完整路径、时间与时长（秒）、是否在播放；没有当前媒体时为 null。
    now() {
      const p = current();
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
  Object.assign(S, { press, mark: later, markNow: mark, on, pause });
}
