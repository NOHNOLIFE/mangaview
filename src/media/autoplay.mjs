// 当前媒体与自动播放：当前媒体的判定（current：选定的媒体 S.chosen（见 driver.mjs）正在播放或中线仍在视窗内时是它；
// 否则本窗口正在播放的；否则中线在视窗内、离视窗中心最近的）、
// 媒体中线离开视窗即暂停、滚动停稳后自动播放、启动或切书后有过用户操作才自动播放；设置里的「自动播放」开关。
// 未运行时（手动浏览，requirements-2.4 8.1）：漫画模式下任何媒体都不自动播放；混合、影音模式下只有视频在滚动停稳时自动播放，
// 音频只在点击音频书签、播放顺序 / 循环切到它、运行中轮到它时开始。运行中由总控的驱动器决定播放什么，这里不插手。
// 翻屏对齐（align，keys.mjs 的 A / D / ← / →）：翻过去之后有视频进入播放范围时，直接落在该视频居中处（漫画模式、自动播放关闭时不对齐）。
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
    { players, rounds } = S;
  const start = (...a) => S.start(...a);
  let armed = false;
  ctx.prefs.sync('autoplay');
  // ---- 当前媒体与自动播放
  const middle = (p) => p.node.offsetTop + p.node.offsetHeight / 2;
  const inView = (p) => {
    const y = middle(p);
    return y >= main.scrollTop && y <= main.scrollTop + main.clientHeight;
  };
  function nearest(ok = () => true) {
    let best = null,
      bd = Infinity;
    const c = main.scrollTop + main.clientHeight / 2;
    for (const p of players.values()) {
      if (p.state === 'failed' || !inView(p) || !ok(p)) continue;
      const d = Math.abs(middle(p) - c);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  const current = () => {
    const c = S.chosen;
    if (c && players.has(c.node) && c.state !== 'failed' && (c === S.playing || inView(c))) return c;
    return S.playing && players.has(S.playing.node) ? S.playing : nearest();
  };
  // 正在播放的媒体中线离开视窗即暂停（位置记在会话里）；手动暂停、播完的标记在它中线离开视窗后清除。
  function watch() {
    for (const p of players.values()) {
      if (document.fullscreenElement === p.node || inView(p)) continue;
      if (p.state === 'ready' && !p.el.paused) p.el.pause();
      if (p.wantPlay) p.wantPlay = false;
      p.userPaused = false;
      p.done = false;
    }
  }
  let settleTimer = 0;
  const allowed = () => get('autoplay', true) && ctx.transport?.mode !== 'comic';
  function settled() {
    if (!allowed() || !armed || document.hidden || ctx.transport?.running) return;
    if ([...players.values()].some((p) => (p.state === 'ready' && !p.el.paused) || p.wantPlay)) return;
    const p = nearest((p) => p.kind === 'video' && !p.userPaused && !p.done);
    if (p) start(p);
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
  main.addEventListener(
    'scroll',
    () => {
      watch();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settled, SETTLE);
    },
    { passive: true },
  );
  // 启动或切书（恢复阅读位置）后，本窗口有过用户操作（按键、点击、滚轮）之前不自动播放，避免一打开就出声。
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
    S.queued = null;
    S.chosen = null;
    rounds.delete(ctx.current);
  });

  // ---- 设置：自动播放（默认开启，设置类偏好，跨窗口同步）。
  ctx.settings.push({
    id: 'autoplay',
    group: 'reading',
    label: 'mvAutoplay',
    hint: 'mvAutoplayHint',
    type: 'toggle',
    get: () => get('autoplay', true),
    set: (v) => put('autoplay', v),
  });
  Object.assign(S, { inView, current, align });
}
