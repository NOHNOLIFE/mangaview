// 全应用统一的鼠标拖动滚动与惯性：在 document 上委托，按下时分别找横向、纵向最近的可滚动祖先，新界面无需另接。
// 只对鼠标主键；位移超过 SLOP 像素才算拖动，拖动后这一下不再触发点击（click 在捕获阶段被拦下，包括正文的点击翻屏和列表项的点击）；没有拖动的点击不受影响。
// 不参与拖动（按下处，或从它到滚动容器之间的元素）：
// - 需要自己按住拖动或输入的控件：输入框、下拉框、可编辑区、滑杆、进度条、分隔条（调宽手柄）及其他 resize 光标的元素、带 data-nodrag 的元素；
// - 原生可拖放的元素（draggable，包括带 href 的链接和没有关掉 draggable 的图片）、滚动条本身；
// - 按在可选中的文字上（user-select 不为 none 的文本，保持可选可复制）；按下事件已被控件自己 preventDefault 的。
// 按钮和列表项（button、[role=option] 等）照常可拖动，与触屏的系统滚动一致；拖动后不触发它们的点击。
// 松手后按松手前的速度带惯性（core/fling.mjs）；再次按下、滚轮、按键、程序性跳转（stop()）立即停止。
// 滑行未停时在同一个列表里按住再同方向甩出（CHAIN 毫秒内松手），新速度叠加上被按住时剩下的速度（core/fling.mjs 的 stack）；反方向照常只按新速度。
// 惯性滑行快时（START 以上）在滑行的列表里按下，这一下只用来停住，不触发点击。
// 每帧至多写一次滚动位置：拖动的位移先累计，在下一帧写入；松手时还没写入的部分并进惯性的第一帧。
import { SLOP, START, END, velocity, glide, stack } from '../core/fling.mjs';

const CHAIN = 500;

const BLOCK = [
  'input',
  'textarea',
  'select',
  'option',
  '[contenteditable]:not([contenteditable="false"])',
  'a[href]',
  '[role="slider"]',
  '[role="scrollbar"]',
  '[role="separator"]',
  '[role="textbox"]',
  '[role="spinbutton"]',
  'progress',
  'meter',
  '[data-nodrag]',
].join(',');
const SCROLLS = /^(auto|scroll|overlay)$/;
let gesture = null,
  flight = null,
  caught = null; // 被按住停下的滑行：{x, y, vx, vy, t}，供紧接着的同方向再甩叠加速度

// 停止惯性滑行（程序性跳转、切书前调用）。
export function stop() {
  if (!flight) return;
  cancelAnimationFrame(flight.frame);
  flight = null;
}
const isMoving = () => !!flight && Math.hypot(flight.vx, flight.vy) >= START;
// 正在拖动或惯性滑行（缩略图据此推迟补齐尺寸的重排，见 reader/view.mjs）。
export const dragging = () => !!flight || !!gesture?.moved;

// 从 el 往上分别找纵向、横向可滚动的最近祖先。
function scrollers(el) {
  let x = null,
    y = null;
  for (; el && el !== document.documentElement && !(x && y); el = el.parentElement) {
    const s = getComputedStyle(el);
    if (!y && SCROLLS.test(s.overflowY) && el.scrollHeight - el.clientHeight > 1) y = el;
    if (!x && SCROLLS.test(s.overflowX) && el.scrollWidth - el.clientWidth > 1) x = el;
  }
  return { x, y };
}
// 按在滚动容器自己的滚动条（或边框）上。
function onScrollbar(el, x, y) {
  const s = getComputedStyle(el);
  if (!SCROLLS.test(s.overflowX) && !SCROLLS.test(s.overflowY)) return false;
  const r = el.getBoundingClientRect(),
    left = r.left + el.clientLeft,
    top = r.top + el.clientTop;
  return x < left || y < top || x >= left + el.clientWidth || y >= top + el.clientHeight;
}
// 文字是否可选：从元素往上第一个不是 auto 的 user-select 决定。
function selectable(el) {
  for (; el; el = el.parentElement) {
    const s = getComputedStyle(el),
      u = s.userSelect || s.webkitUserSelect;
    if (u && u !== 'auto') return u !== 'none';
  }
  return true;
}
// 指针确实落在 el 自己的可选文字上（而不是文字旁边的空白）。
function onText(el, x, y) {
  const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.data.trim());
  if (!texts.length || !selectable(el)) return false;
  const range = document.createRange();
  return texts.some((n) => {
    range.selectNodeContents(n);
    return [...range.getClientRects()].some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
  });
}
// 这次按下能否开始拖动；能则返回要滚动的容器。
function start(e) {
  const t = e.target;
  if (!(t instanceof Element) || t.closest(BLOCK)) return null;
  const { x, y } = scrollers(t);
  if (!x && !y) return null;
  const outer = x && y ? (x.contains(y) ? x : y) : x || y;
  for (let el = t; el && el !== outer.parentElement; el = el.parentElement) {
    if (el.draggable || /resize$/.test(getComputedStyle(el).cursor)) return null;
  }
  if (onScrollbar(t, e.clientX, e.clientY) || onText(t, e.clientX, e.clientY)) return null;
  return { x, y };
}
// 按 d 像素滚动一个方向，累计到不了一像素的余数；返回实际滚动的距离。
function scroll(el, prop, d, carry, key) {
  if (!el) return 0;
  const want = d + carry[key],
    before = el[prop];
  el[prop] = before + want;
  const got = el[prop] - before;
  carry[key] = Math.abs(want - got) < 1 ? want - got : 0;
  return got;
}
// 拖动之后的这次 click 不再派发（拖动、按下只为停住惯性）。
function swallowClick() {
  const kill = (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      off();
    },
    off = () => {
      clearTimeout(timer);
      window.removeEventListener('click', kill, true);
    },
    timer = setTimeout(off, 0);
  window.addEventListener('click', kill, true);
}
function fling(g, now) {
  stop();
  const v = velocity(g.samples, now),
    prev = caught && now - caught.t <= CHAIN ? caught : null,
    f = {
      x: g.x,
      y: g.y,
      vx: g.x ? stack(prev?.x === g.x ? prev.vx : 0, -v.x) : 0,
      vy: g.y ? stack(prev?.y === g.y ? prev.vy : 0, -v.y) : 0,
      t: now,
      carry: { x: 0, y: 0 },
      frame: 0,
      pend: { x: 0, y: 0 },
    };
  caught = null;
  if (Math.hypot(f.vx, f.vy) < START) return false;
  // 拖动还没写入的位移并进第一帧，这一帧只写一次。
  if (g.frame) {
    cancelAnimationFrame(g.frame);
    g.frame = 0;
    f.pend = { x: g.dx, y: g.dy };
  }
  const live = (el) => el && el.isConnected && el.clientHeight > 0;
  const tick = (time) => {
    if (flight !== f) return;
    const dt = Math.max(0, time - f.t);
    f.t = time;
    for (const [axis, prop] of [
      ['x', 'scrollLeft'],
      ['y', 'scrollTop'],
    ]) {
      const key = 'v' + axis,
        pend = f.pend[axis];
      f.pend[axis] = 0;
      if (!f[key]) {
        if (pend) scroll(f[axis], prop, pend, f.carry, axis);
        continue;
      }
      if (!live(f[axis])) {
        f[key] = 0;
        continue;
      }
      const g = glide(f[key], dt),
        got = scroll(f[axis], prop, g.d + pend, f.carry, axis) - pend;
      // 到了边缘（这一帧该走一像素以上却没动）就停下这个方向。
      f[key] = Math.abs(g.d) >= 1 && !got ? 0 : g.v;
      if (Math.abs(f[key]) < END) f[key] = 0;
    }
    if (!f.vx && !f.vy) flight = null;
    else f.frame = requestAnimationFrame(tick);
  };
  flight = f;
  f.frame = requestAnimationFrame(tick);
  return true;
}
function end(e, glideOn) {
  const g = gesture;
  gesture = null;
  if (!g.moved || !glideOn) caught = null; // 按住后没有再甩（点按、移出窗口松开）：不再叠加
  if (!g.moved) return;
  document.documentElement.classList.remove('dragscroll');
  if (g.held?.hasPointerCapture(g.id)) g.held.releasePointerCapture(g.id);
  swallowClick();
  if (glideOn) fling(g, e.timeStamp);
}

// 容器上的"点按"（正文翻屏、缩略图栏定位）：主键按下后没有拖动就松开，回调收到 click 事件和按下事件（target、pointerType 以按下时为准）。
// 按在 data-nodrag 区域或滚动条上的不算；拖动、按下只为停住惯性，或按下事件被上层拦下（stopPropagation）时都不触发。
export function tap(el, fn) {
  let down = null;
  // 每次按下先清掉上一次（拖动后的 click 被拦下，记录会留着）；按下被上层拦下时就不会误用旧记录。
  window.addEventListener('pointerdown', () => (down = null), true);
  el.addEventListener('pointerdown', (e) => {
    down =
      e.button === 0 &&
      !e.target.closest?.('[data-nodrag]') &&
      !(e.target === el && onScrollbar(el, e.clientX, e.clientY))
        ? e
        : null;
  });
  el.addEventListener('click', (e) => {
    const d = down;
    down = null;
    if (d) fn(e, d);
  });
}

export function install() {
  // 任何按下、滚轮、按键都先停住惯性（按下时记下剩下的速度，供同方向再甩叠加）；滑行较快时按在滑行的列表里，这一下不触发点击。
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!flight) return;
      caught = { x: flight.x, y: flight.y, vx: flight.vx, vy: flight.vy, t: e.timeStamp };
      const box = [flight.x, flight.y].filter(Boolean);
      if (isMoving() && box.some((el) => el.contains(e.target)))
        window.addEventListener('pointerup', swallowClick, { capture: true, once: true });
      stop();
    },
    true,
  );
  for (const type of ['wheel', 'keydown']) window.addEventListener(type, stop, { capture: true, passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (gesture || e.pointerType !== 'mouse' || e.button !== 0 || !e.isPrimary || e.defaultPrevented) return;
    const s = start(e);
    if (!s) return;
    gesture = {
      id: e.pointerId,
      x: s.x,
      y: s.y,
      x0: e.clientX,
      y0: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      moved: false,
      held: null,
      carry: { x: 0, y: 0 },
      dx: 0,
      dy: 0,
      frame: 0,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
    };
  });
  // 跟随指针滚动（位移累计到下一帧一次写入），记下轨迹供松手时估算速度。
  const follow = (g, e) => {
    g.dx += g.lx - e.clientX;
    g.dy += g.ly - e.clientY;
    if (!g.frame)
      g.frame = requestAnimationFrame(() => {
        g.frame = 0;
        scroll(g.x, 'scrollLeft', g.dx, g.carry, 'x');
        scroll(g.y, 'scrollTop', g.dy, g.carry, 'y');
        g.dx = g.dy = 0;
      });
    g.lx = e.clientX;
    g.ly = e.clientY;
    g.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (g.samples.length > 64) g.samples.splice(0, 32);
  };
  const move = (e) => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    // 在窗口外松开、没收到 pointerup：按松开处理，不滑行。
    if (!(e.buttons & 1)) return end(e, false);
    if (!g.moved) {
      if (Math.abs(e.clientX - g.x0) <= SLOP && Math.abs(e.clientY - g.y0) <= SLOP) return;
      g.moved = true;
      // 指针捕获到滚动容器上：移出容器、窗口也继续拖；选中文字在拖动期间关掉（style.css 的 .dragscroll）。
      g.held = g.x && g.y ? (g.x.contains(g.y) ? g.y : g.x) : g.x || g.y;
      g.held.setPointerCapture(g.id);
      document.documentElement.classList.add('dragscroll');
      getSelection()?.removeAllRanges();
    }
    follow(g, e);
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener(
    'pointerup',
    (e) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      if (gesture.moved) follow(gesture, e);
      end(e, true);
    },
    true,
  );
  window.addEventListener(
    'pointercancel',
    (e) => {
      if (gesture && e.pointerId === gesture.id) end(e, false);
    },
    true,
  );
  // 滚动容器被移除、隐藏等原因丢了捕获：结束拖动，不滑行。
  document.addEventListener(
    'lostpointercapture',
    (e) => {
      if (gesture?.moved && e.pointerId === gesture.id && e.target === gesture.held) end(e, false);
    },
    true,
  );
}
