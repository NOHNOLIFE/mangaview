// 单文件模式（总控栏的开关，状态在 ctx.transport.single）：阅读区一次只显示一个文件。
// 做法：不另盖一层，正文每页占满一屏（view.mjs 的 single 布局：槽高 = 视窗高度，图片按窗口完整显示，视频、音频面板在槽内居中），
// 阅读位置、书签跳转、播放器、缩略图联动、当前媒体的判定都沿用长条的实现。这里负责：
// - 进入 / 退出（view.setSingle，停在同一页），状态变化（含别的窗口）时跟随；
// - 翻页：flip(d) 供翻屏（tap.mjs 的 screenStep：A / D / ← / →、点击左右半屏）、W / S / ↑ / ↓、Page Up / Page Down（keys.mjs）使用；
//   滚轮一格一页，连续滚动不会一次翻过多页；
// - 吸附：自由滚动（拖动与惯性、中键自动滚动、滚动条）停下后对齐到最近的整页。
//   不用 CSS scroll-snap：mandatory 吸附会把拖动、惯性、按住滚动逐帧设置的 scrollTop 立即拉回整页，
//   而且吸附点只能来自虚拟化后实际存在的槽，程序性跳到远处时会被吸回旧页。
// - 对外接口 ctx.single = { active, index(), go(i), next(), prev() }（next / prev 返回是否翻了页），供运行中按间隔自动换页使用。
import { main } from '../ui/dom.mjs';
import { stop } from '../ui/dragscroll.mjs';
import { view } from './session.mjs';

// SETTLE：滚动停下多久后吸附（毫秒）；GAP：两次翻页的最短间隔（滚轮连续转动、按住 W / S 时）；QUIET：触控板的一次滑动之间至少停顿这么久才算新的一次。
const SETTLE = 160,
  GAP = 280,
  QUIET = 160,
  NOTCH = 50; // 一次滚轮事件的位移达到这么多像素算鼠标滚轮的一格，否则按触控板的连续小位移累计
let lastFlip = -Infinity;

const starts = () => {
  const s = view.panes[0].starts,
    n = view.book?.pages.length || 0;
  return n && s.length === n + 1 ? s : null;
};
// 当前页：视窗中心所在的页（滚动中为离视窗最近的整页）。
export function index() {
  return view.single ? (view.position()?.i ?? -1) : -1;
}
// 跳到第 i 页（夹在首尾之间）；返回位置是否改变。
export function go(i) {
  const s = starts();
  if (!view.single || !s) return false;
  i = Math.max(0, Math.min(s.length - 2, Math.round(i)));
  const top = main.scrollTop;
  view.jump({ i });
  return Math.abs(main.scrollTop - top) >= 1;
}
// 上一个 / 下一个文件。repeat：按住键时的连发，按 GAP 限速。
export function flip(d, repeat = false) {
  const now = performance.now();
  if (repeat && now - lastFlip < GAP) return false;
  lastFlip = now;
  const i = index();
  return i >= 0 && go(i + Math.sign(d));
}

export function install(ctx) {
  const apply = () => view.setSingle(ctx.transport.single);
  apply();
  ctx.on('transport', (field) => {
    if (field === 'single') apply();
  });
  // 滚轮：一格翻一页（两次翻页至少间隔 GAP，转得再快也不会一下翻过多页）；触控板的一次滑动只翻一页。Ctrl+滚轮（缩放）和横向滚动不拦。
  let lastWheel = -Infinity,
    turned = -Infinity,
    acc = 0,
    armed = true;
  main.addEventListener(
    'wheel',
    (e) => {
      if (!view.single || !view.book || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return;
      if (e.target.closest?.('[popover]')) return; // 播放面板的弹出层（字幕菜单等）照常滚动
      e.preventDefault();
      const now = e.timeStamp,
        quiet = now - lastWheel > QUIET;
      lastWheel = now;
      if (quiet) {
        acc = 0;
        armed = true;
      }
      if (e.deltaMode || Math.abs(e.deltaY) >= NOTCH) {
        if (now - turned < GAP) return;
      } else {
        acc += e.deltaY;
        if (!armed || Math.abs(acc) < NOTCH) return;
        armed = false;
        acc = 0;
      }
      turned = now;
      const i = index();
      if (i >= 0) go(i + Math.sign(e.deltaY));
    },
    { passive: false },
  );
  // 吸附：滚动停下 SETTLE 毫秒后不在整页上就滑到最近的整页；仍按着拖动时等松手（拖动期间 html 带 .dragscroll）。
  let timer = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function settle() {
    timer = 0;
    const s = starts();
    if (!view.single || !s) return;
    if (document.documentElement.classList.contains('dragscroll')) {
      timer = setTimeout(settle, SETTLE);
      return;
    }
    const top = s[index()];
    if (top == null || Math.abs(main.scrollTop - top) < 1) return;
    stop();
    main.scrollTo({ top, behavior: reduced.matches ? 'instant' : 'smooth' });
  }
  main.addEventListener(
    'scroll',
    () => {
      if (!view.single) return;
      clearTimeout(timer);
      timer = setTimeout(settle, SETTLE);
    },
    { passive: true },
  );
  ctx.single = {
    get active() {
      return view.single;
    },
    index,
    go,
    next: () => flip(1),
    prev: () => flip(-1),
  };
}
