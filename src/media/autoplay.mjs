// 当前媒体与自动播放：当前媒体的判定（current：选定的媒体 S.chosen（见 driver.mjs）正在播放或中线仍在视窗内时是它；
// 否则本窗口正在播放的；否则中线在视窗内、离视窗中心最近的）、
// 媒体中线离开视窗即暂停、滚动停稳后自动播放、启动或切书后有过用户操作才自动播放；设置里的「自动播放」开关。
import { extend } from '../core/lang.mjs';

extend({
  mvAutoplay: ['Autoplay media', '自动播放', 'メディアを自動再生', '미디어 자동 재생'],
  mvAutoplayHint: [
    'Play a video or audio when scrolling stops on it',
    '滚动停在视频或音频上时自动开始播放',
    'スクロールが止まったところの動画や音声を再生します',
    '스크롤이 멈춘 곳의 동영상이나 오디오를 재생합니다',
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
  function settled() {
    if (!get('autoplay', true) || !armed || document.hidden) return;
    if ([...players.values()].some((p) => (p.state === 'ready' && !p.el.paused) || p.wantPlay)) return;
    const p = nearest((p) => !p.userPaused && !p.done);
    if (p) start(p);
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
  Object.assign(S, { inView, current });
}
