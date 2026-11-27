// 自动播放、翻屏对齐视频与视窗中心所在的视频（.mv-center）：
// - 自动播放（设置里的「自动播放」，默认关闭）：未在自动滚动、混合 / 影音模式、没有任何媒体在播放（含后台播放的当前曲目）时，
//   滚动停稳后播放中线在视窗内、离视窗中心最近的视频（音频不自动开始；手动暂停过、播完的在它中线离开视窗之前不再自动播放；
//   不碰当前曲目）。启动或切书后，本窗口有过用户操作才自动播放，避免一打开就出声。
// - 由自动播放开始的视频（p.by === 'auto'）成为当前曲目，但中线离开视窗（全屏中的除外）或切书即暂停并取消（core/selection.mjs），
//   播完不接续，不重建播放列表；用户手动接管（点它播放 / 暂停，driver.mjs press）后按后台播放对待。
// - 翻屏对齐（align，keys.mjs 的 A / D / ← / →）：翻过去之后有视频进入播放范围时，直接落在该视频居中处（漫画模式、自动播放关闭时不对齐）。
// - 视窗中心所在的视频带 .mv-center（未选中的视频压得更暗，它恢复到普通的压暗程度，shell.css）：滚动、重画时每帧至多更新一次，
//   只按页的累计高度二分查找（centerIndex），不遍历页、不读布局。
import { extend } from '../core/lang.mjs';
import { pageKind } from '../core/model.mjs';
import { turnTo } from '../core/engine.mjs';

extend({
  mvAutoplay: ['Autoplay media', '自动播放', 'メディアを自動再生', '미디어 자동 재생'],
  mvAutoplayHint: [
    'Play a video when scrolling stops on it (not in Comic mode)',
    '滚动停在视频上时自动开始播放（漫画模式除外）',
    'スクロールが止まったところの動画を再生します（漫画モードを除く）',
    '스크롤이 멈춘 곳의 동영상을 재생합니다 (만화 모드 제외)',
  ],
});
// 自动播放：滚动停稳 SETTLE 毫秒后才开始。
const SETTLE = 300;

export function install(ctx, S) {
  const { main, get, put } = ctx,
    { players } = S;
  const start = (...a) => S.start(...a),
    inView = (...a) => S.inView(...a),
    nearest = (...a) => S.nearest(...a),
    centerIndex = (...a) => S.centerIndex(...a);
  let armed = false;
  ctx.prefs.sync('autoplay');
  // 由自动播放开始、用户尚未接手的当前曲目离开视窗或切书：暂停并取消。
  function drop(p) {
    p.wantPlay = false;
    if (p.state === 'ready' && !p.el.paused) p.el.pause();
  }
  // 滚动、重排后：自动播放的当前曲目中线离开视窗即暂停并取消；其余播放器中线离开视窗后清掉手动暂停、播完的标记（当前曲目除外）。
  function watch() {
    const tr = S.track;
    if (tr?.by === 'auto' && !inView(tr) && S.full !== tr) {
      drop(tr);
      S.after({ type: 'view', inView: false, full: false });
    }
    for (const p of players.values()) {
      if (p === S.track || S.full === p || inView(p)) continue;
      p.wantPlay = false;
      p.userPaused = false;
      p.done = false;
    }
  }
  let settleTimer = 0;
  const allowed = () => get('autoplay', false) === true && ctx.transport?.mode !== 'comic';
  function settled() {
    if (!allowed() || !armed || document.hidden || ctx.transport?.running) return;
    if (S.all().some((p) => (p.state === 'ready' && !p.el.paused) || p.wantPlay)) return;
    const p = nearest((p) => p.kind === 'video' && !p.userPaused && !p.done && p !== S.track);
    if (!p) return;
    p.by = 'auto';
    S.select(p, 'play');
    start(p);
  }
  // 翻屏的落点：从当前位置翻 d 屏（step 像素）后有视频进入播放范围时为该视频居中的 scrollTop，否则为 null（照常翻屏）。
  // 只在未运行、混合 / 影音模式、自动播放开启时对齐；播不了的视频不算。
  function align(d, step) {
    const book = ctx.current,
      starts = ctx.view.panes?.[0]?.starts ?? [];
    if (!book || !allowed() || ctx.transport?.running || starts.length !== book.pages.length + 1) return null;
    const videos = [];
    book.pages.forEach((pg, i) => {
      if (pageKind(pg) === 'video' && !pg.bad && !S.failedPages.has(pg))
        videos.push({ mid: (starts[i] + starts[i + 1]) / 2 });
    });
    if (!videos.length) return null;
    const top = main.scrollTop,
      max = Math.max(0, main.scrollHeight - main.clientHeight),
      to = turnTo({ top, d, step, viewH: main.clientHeight, max, videos });
    return Math.abs(to - Math.min(max, Math.max(0, top + d * step))) < 0.5 ? null : to;
  }
  // 视窗中心所在的视频（.mv-center）。
  let centered = null,
    centerFrame = 0;
  function markCenter() {
    centerFrame = 0;
    const book = ctx.current,
      i = centerIndex(),
      page = i >= 0 ? book.pages[i] : null,
      node = (page && pageKind(page) === 'video' && ctx.view.panes?.[0]?.slots?.get(i)) || null;
    if (node === centered) return;
    centered?.classList.remove('mv-center');
    centered = node;
    node?.classList.add('mv-center');
  }
  const centerSoon = () => {
    if (!centerFrame) centerFrame = requestAnimationFrame(markCenter);
  };
  main.addEventListener(
    'scroll',
    () => {
      centerSoon();
      watch();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settled, SETTLE);
    },
    { passive: true },
  );
  for (const type of ['keydown', 'pointerdown', 'wheel'])
    window.addEventListener(
      type,
      (e) => {
        if (e.isTrusted) armed = true;
      },
      { capture: true, passive: true },
    );
  ctx.on('select', () => {
    armed = false;
    const tr = S.track;
    if (tr?.by === 'auto') drop(tr);
    S.after({ type: 'book' });
  });

  // ---- 设置：自动播放（默认关闭，设置类偏好，跨窗口同步）。
  ctx.settings.push({
    id: 'autoplay',
    group: 'reading',
    label: 'mvAutoplay',
    hint: 'mvAutoplayHint',
    type: 'toggle',
    get: () => get('autoplay', false) === true,
    set: (v) => put('autoplay', v),
  });
  Object.assign(S, { align, centerSoon });
}
