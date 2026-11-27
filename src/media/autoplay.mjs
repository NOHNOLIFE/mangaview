// 选中媒体、当前文件与自动播放：
// - 选中媒体 S.selected（规则见 core/selection.mjs，select / release）：带 .selected 类（不压暗、没有大播放键，shell.css）；
//   中线离开视窗（全屏中的除外）、切书、播放器被释放时取消。
// - 当前文件（target：选中的媒体，否则视窗中心所在的页，含图片）：文件栏、书签快捷键、长按 A / D、Z 新窗口播放作用的对象；
//   current 是其中的媒体播放器（播不了的、图片为 null）。
// - 运行引擎挑哪个媒体（pick：选中的，否则正在播放的，否则中线在视窗内、离视窗中心最近的）与自动播放挑哪个视频的规则另算，不随当前文件变化。
// 媒体中线离开视窗即暂停、滚动停稳后自动播放、启动或切书后有过用户操作才自动播放；设置里的「自动播放」开关。
// 未运行时（手动浏览）：漫画模式下任何媒体都不自动播放；混合、影音模式下只有视频在滚动停稳时自动播放，
// 音频只在点击音频书签、播放顺序 / 循环切到它、运行中轮到它时开始。运行中由总控的驱动器决定播放什么，这里不插手。
// 翻屏对齐（align，keys.mjs 的 A / D / ← / →）：翻过去之后有视频进入播放范围时，直接落在该视频居中处（漫画模式、自动播放关闭时不对齐）。
// 视窗中心所在的视频带 .mv-center（未选中的视频压得更暗，它恢复到普通的压暗程度，shell.css）：滚动、重画时每帧至多更新一次，
// 只按页的累计高度二分查找（centerIndex），不遍历页、不读布局。
import { extend } from '../core/lang.mjs';
import { pageKind, at } from '../core/model.mjs';
import { turnTo } from '../core/engine.mjs';
import { selectAfter } from '../core/selection.mjs';

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
  // ---- 选中媒体：type 为成为选中的原因（'press' | 'play' | 'switch' | 'goto'）。
  function setSelected(p) {
    if (p === S.selected) return;
    S.selected?.node.classList.remove('selected');
    S.selected = p;
    p?.node.classList.add('selected');
    S.markNow?.(); // 当前文件随之变化：立即派发，总控栏、文件栏与 .selected 同步
  }
  const select = (p, type = 'press') => setSelected(selectAfter(S.selected, { type, player: p }));
  const release = (p) => setSelected(selectAfter(S.selected, { type: 'gone', player: p }));
  const live = (p) => !!p && players.has(p.node) && p.book === ctx.current;
  // 视窗中心所在的页（单文件模式下是显示的那一页），没有时为 -1。
  function centerIndex() {
    const book = ctx.current,
      view = ctx.view;
    if (!book?.pages.length) return -1;
    if (view.single) {
      const a = view.anchor();
      return a ? book.pages.findIndex((pg) => pg.name === a.name) : -1;
    }
    const s = view.panes?.[0]?.starts ?? [];
    return s.length === book.pages.length + 1 ? at(s, main.scrollTop + main.clientHeight / 2).i : -1;
  }
  // 当前文件 {book, page, i, kind, player}：选中的媒体，否则视窗中心所在的页（媒体页带上它的播放器）；没有为 null。
  function target() {
    const book = ctx.current;
    if (!book) return null;
    const sel = live(S.selected) ? S.selected : null;
    if (sel) return { book, page: sel.page, i: book.pages.indexOf(sel.page), kind: sel.kind, player: sel };
    const i = centerIndex();
    if (i < 0) return null;
    const page = book.pages[i],
      kind = pageKind(page),
      player =
        kind === 'video' || kind === 'audio'
          ? ([...players.values()].find((q) => q.page === page && q.book === book) ?? null)
          : null;
    return { book, page, i, kind, player };
  }
  // 当前媒体：当前文件的播放器（播不了的不算）。
  const current = () => {
    const p = target()?.player;
    return p && p.state !== 'failed' ? p : null;
  };
  // 运行引擎（影音模式开始、混合模式先播哪个）挑的媒体：选中的，否则正在播放的，否则中线在视窗内、离视窗中心最近的。
  const pick = () => {
    const c = S.selected;
    if (live(c) && c.state !== 'failed') return c;
    return S.playing && players.has(S.playing.node) ? S.playing : nearest();
  };
  // 正在播放的媒体中线离开视窗即暂停（位置记在会话里）；手动暂停、播完的标记在它中线离开视窗后清除；选中的媒体中线离开视窗即取消选中。
  function watch() {
    const sel = S.selected;
    if (sel)
      setSelected(
        selectAfter(sel, { type: 'view', inView: players.has(sel.node) && inView(sel), full: S.full === sel }),
      );
    for (const p of players.values()) {
      if (S.full === p || inView(p)) continue;
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
    setSelected(selectAfter(S.selected, { type: 'book' }));
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
  Object.assign(S, { inView, current, target, pick, select, release, align, centerSoon });
}
