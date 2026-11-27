import { at, point, offsets, shownName, splitTail, pageKind, videoWidth } from '../core/model.mjs';
import {
  pageKey,
  fileStamp,
  pageThumb,
  hasPageThumb,
  pageStale,
  pageChecked,
  keepPageThumb,
  dropPage,
} from './thumbs.mjs';
import { stop as stopFling, dragging } from '../ui/dragscroll.mjs';

// 正文、预读、预览与封面共用两个读取/解码名额。已脱离视口的排队任务不碰硬盘。
// 小图（缩略图栏、全屏缩略图）走 thumbs.mjs 的会话内存缓存：命中即显示、不读原图；正文解码后也顺手生成小图，
// 缩略图栏和全屏缩略图就不必为同一页再读一次硬盘。
// 浏览器的文件读取偶尔会挂起不返回：丢弃的任务立即让出名额，超时的任务按失败处理，单个文件卡住不会拖住整个队列。
const jobs = new Map(),
  SMALL_W = 256,
  SMALL_H = 4096;
export const limits = { read: 30000 }; // 单张图读取 + 解码的上限（毫秒），留足机械硬盘唤醒的时间
let running = 0;

// ---- 小图（缩略图栏、全屏缩略图）的加载时机：
// - 解码、缩小在 Worker 里进行（thumbworker.mjs），不占主线程；Worker 解不了的（SVG）退回 <img> 解码。
// - 所在列表滚动快于 FAST 像素 / 毫秒（高速拖动、滑行，或正文快速滚动带着缩略图栏走）时不开始新的读取，
//   降到 FAST 以下 SETTLE 毫秒后再读；会话缓存里已有的照常立即显示（不读硬盘）。
// - 占位尺寸固定（图片在格子里按比例完整显示）：拖动、滑行、快速滚动期间解码出的真实尺寸先不报告，停下后再报告，由使用方统一重排一次。
export const FAST = 1.5,
  SETTLE = 150;
let fastUntil = 0,
  wake = 0;
const fast = () => performance.now() < fastUntil;
const seen = new WeakMap(),
  boxes = new WeakSet(); // 含小图的滚动容器
function hasSmall(el) {
  if (boxes.has(el)) return true;
  for (const j of jobs.values())
    if (j.small && el.contains(j.slot)) {
      boxes.add(el);
      return true;
    }
  return false;
}
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target;
    if (!(el instanceof Element) || !hasSmall(el)) return;
    const now = performance.now(),
      top = el.scrollTop,
      p = seen.get(el);
    seen.set(el, { top, t: now });
    if (!p || now - p.t > 100 || Math.abs(top - p.top) <= FAST * (now - p.t)) return;
    fastUntil = now + SETTLE;
    clearTimeout(wake);
    wake = setTimeout(pump, SETTLE + 10);
  },
  { capture: true, passive: true },
);
// 小图的真实尺寸：拖动、滑行或快速滚动时先记下，停下后再交给 ready。
const waiting = [];
let waitTimer = 0;
function report(j, w, h) {
  if (!j.ready || j.dead) return;
  if (!dragging() && !fast()) return j.ready(w, h);
  waiting.push([j, w, h]);
  waitTimer ||= setInterval(() => {
    if (dragging() || fast()) return;
    clearInterval(waitTimer);
    waitTimer = 0;
    for (const [j, w, h] of waiting.splice(0)) if (!j.dead) j.ready(w, h);
  }, 100);
}
// Worker 解码：返回 {bitmap, blob, w, h}；Worker 不可用或解不了时为 null（调用方改用 <img>）。
let worker = null,
  asked = 0;
const asks = new Map();
function offThread(file) {
  if (worker === false || file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return null;
  if (!worker)
    try {
      worker = new Worker(new URL('./thumbworker.mjs', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const ok = asks.get(data.id);
        asks.delete(data.id);
        if (ok) ok(data.error ? null : data);
        else data.bitmap?.close();
      };
      worker.onerror = () => {
        worker = false;
        for (const ok of asks.values()) ok(null);
        asks.clear();
      };
    } catch {
      worker = false;
      return null;
    }
  return new Promise((ok) => {
    const id = ++asked;
    asks.set(id, ok);
    worker.postMessage({ id, file, maxW: SMALL_W, maxH: SMALL_H });
  });
}
function free(j) {
  if (j.held) {
    j.held = false;
    running--;
    queueMicrotask(pump);
  }
}
const within = (p) => {
  let t;
  return Promise.race([
    p,
    new Promise((_, no) => {
      t = setTimeout(() => no(new DOMException('', 'TimeoutError')), limits.read);
    }),
  ]).finally(() => clearTimeout(t));
};
export function release(slot) {
  if (slot._dispose) {
    const fn = slot._dispose;
    slot._dispose = null;
    fn();
  } // 媒体页：卸载源、释放解码器（media.mjs）
  const job = jobs.get(slot);
  if (job) {
    job.dead = true;
    free(job);
    if (job.url) URL.revokeObjectURL(job.url);
    jobs.delete(slot);
  }
  slot.replaceChildren();
}
// key：页面缓存键（thumbs.mjs 的 pageKey），省略则不用缓存。
export function imageJob(slot, file, priority, small, ready, fail, key = null) {
  const job = jobs.get(slot);
  if (job) {
    job.priority = priority;
    return;
  }
  const j = { slot, file, priority, small, ready, fail, key };
  jobs.set(slot, j);
  const hit = small && key && pageThumb(key);
  if (hit) {
    j.started = true;
    show(j, hit);
    return;
  }
  queueMicrotask(pump);
}
function show(j, e) {
  const img = new Image();
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  img.src = e.url;
  j.slot.replaceChildren(img);
  queueMicrotask(() => report(j, e.w, e.h));
  if (pageStale(e)) verify(j, e);
}
// 校验只读文件信息（不读图），单独两个名额，不占读图队列；文件变了就丢掉缓存、重新排队读图。
const checks = [];
let checking = 0;
function verify(j, e) {
  if (e.checking) return;
  e.checking = true;
  checks.push([j, e]);
  drain();
}
function drain() {
  while (checking < 2 && checks.length) {
    const [j, e] = checks.shift();
    if (j.dead) {
      e.checking = false;
      continue;
    }
    checking++;
    within(Promise.resolve().then(j.file))
      .then((f) => {
        if (fileStamp(f) === e.stamp) pageChecked(e);
        else {
          dropPage(j.key);
          if (!j.dead) {
            j.started = false;
            pump();
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        e.checking = false;
        checking--;
        drain();
      });
  }
}
function pump() {
  const hold = fast(); // 高速滚动中：小图先不读
  while (running < 2) {
    let best;
    for (const j of jobs.values())
      if (!j.started && !(hold && j.small) && (!best || j.priority < best.priority)) best = j;
    if (!best) break;
    best.started = best.held = true;
    running++;
    load(best).finally(() => free(best));
  }
}
function shrink(img, w, h) {
  const scale = Math.min(1, SMALL_W / w, SMALL_H / h),
    canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function keep(key, canvas, w, h, file) {
  const stamp = fileStamp(file);
  canvas.toBlob(
    (b) => {
      if (b) keepPageThumb(key, b, w, h, stamp);
    },
    'image/webp',
    0.8,
  );
}
const idle = window.requestIdleCallback
  ? (fn) => requestIdleCallback(fn, { timeout: 1500 })
  : (fn) => setTimeout(fn, 60);
async function load(j) {
  try {
    await within(read(j));
  } catch (e) {
    if (!j.dead) {
      j.dead = true;
      if (j.url) {
        URL.revokeObjectURL(j.url);
        j.url = null;
      }
      j.fail?.(e);
    }
  }
}
async function read(j) {
  if (j.small && j.key) {
    const hit = pageThumb(j.key);
    if (hit) {
      show(j, hit);
      return;
    }
  } // 排队期间正文已生成
  const file = await j.file();
  if (j.dead) return;
  if (j.small) {
    const out = await offThread(file);
    if (out) {
      if (j.dead) return out.bitmap.close();
      const canvas = document.createElement('canvas');
      canvas.width = out.bitmap.width;
      canvas.height = out.bitmap.height;
      canvas.getContext('bitmaprenderer').transferFromImageBitmap(out.bitmap);
      j.slot.replaceChildren(canvas);
      if (j.key && out.blob) keepPageThumb(j.key, out.blob, out.w, out.h, fileStamp(file));
      return report(j, out.w, out.h);
    }
    if (j.dead) return;
  }
  const img = new Image();
  img.alt = file.name;
  img.draggable = false;
  j.url = URL.createObjectURL(file);
  img.src = j.url;
  await img.decode();
  if (j.dead) return;
  const w = img.naturalWidth,
    h = img.naturalHeight;
  if (j.small) {
    const canvas = shrink(img, w, h);
    j.slot.replaceChildren(canvas);
    URL.revokeObjectURL(j.url);
    j.url = null;
    if (j.key) keep(j.key, canvas, w, h, file);
    return report(j, w, h);
  } else {
    j.slot.replaceChildren(img);
    // 正文的图已在内存里解码：空闲时缩成小图存进缓存（只占 CPU，不读硬盘）。
    if (j.key && !hasPageThumb(j.key)) {
      const key = j.key;
      idle(() => {
        if (!hasPageThumb(key))
          try {
            keep(key, shrink(img, w, h), w, h, file);
          } catch {}
      });
    }
  }
  j.ready?.(w, h);
}

// 文件名单行显示、中间省略：开头按宽度省略，结尾（集数、序号、扩展名）始终完整（splitTail，样式见 style.css .mid-name）。
export function midName(name) {
  const el = document.createElement('span'),
    head = document.createElement('span'),
    [a, b] = splitTail(name);
  el.className = 'mid-name';
  head.textContent = a;
  el.append(head, b);
  return el;
}

export class Reader {
  constructor(main, preview, hooks) {
    this.main = main;
    this.preview = preview;
    this.hooks = hooks;
    this.fit = true;
    this.panes = [main, preview].map((el) => ({ el, strip: el.firstElementChild, slots: new Map(), starts: [0] }));
    this.marker = document.createElement('div');
    this.marker.className = 'viewport-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    main.addEventListener(
      'scroll',
      () => {
        if (main.scrollTop !== this.correctedTop) {
          this.up = main.scrollTop < (this.previousTop || 0);
          this.browsing = false;
        }
        // 用户滚动结束缩放锚定；靠近书尾时浏览器把校正后的位置夹到最大值，不算用户滚动。
        if (
          this.held &&
          Math.abs(main.scrollTop - this.correctedTop) >= 1 &&
          !(this.correctedTop > main.scrollTop && main.scrollTop >= main.scrollHeight - main.clientHeight - 1)
        )
          this.held = null;
        this.previousTop = main.scrollTop;
        this.follow();
        this.schedule();
        hooks.progress();
      },
      { passive: true },
    );
    for (const type of ['wheel', 'pointerdown'])
      preview.addEventListener(
        type,
        () => {
          this.browsing = true;
        },
        { passive: true },
      );
    preview.addEventListener('scroll', () => this.schedule(), { passive: true });
    const resize = new ResizeObserver(() => this.resized());
    resize.observe(main);
    resize.observe(preview);
    this.cap = Infinity;
    // 单文件模式（single.mjs）：每页的槽高 = 视窗高度，图片按窗口完整显示，视频、音频面板在槽内居中。
    // keep：最近一次按页内位置跳转（书签、缩略图、进入单文件模式时的阅读位置）的 {name, f}，仍在该页时 anchor() 原样返回，退出后回到同一处。
    this.single = false;
    this.keep = null;
    main.style.setProperty('--vh', main.clientHeight + 'px');
  }
  // 视频的高度封顶值（阅读视窗高度）：窗口尺寸停止变化约 200ms 后才重新计算，拖动过程中占位高度不变；
  // 期间视窗变矮时，画面在原占位里按 --vh 临时等比缩小（media/shell.css）。重算时沿用缩放锚点（held）。
  recap() {
    const h = this.main.clientHeight;
    if (!h || h === this.cap) return;
    const had = this.cap !== Infinity;
    this.cap = h;
    if (had && this.book?.pages.some((p) => pageKind(p) === 'video')) {
      this.layout();
      this.paint();
    }
  }
  // 媒体读到帧尺寸后：与图片解码后相同，按锚点重排并保存。
  sized(page, w, h) {
    if (page.w === w && page.h === h) return;
    const anchor = this.held ? this.held.anchor : this.anchor();
    page.w = w;
    page.h = h;
    this.layout(anchor);
    this.hooks.measured();
  }
  // 阅读区尺寸变化（窗口缩放、侧栏停靠或调宽、进出全屏）：视窗中心处的内容不动。
  // 一次连续缩放的锚点在开始时按变化前的视窗高度取一次，沿用到停下（约 500ms 无变化）或用户滚动，不从已经漂移的滚动位置重新推导；
  // 重排后在同一帧内重画页面位置，不留一帧"滚动位置已更新、页面还在旧位置"的画面（缩放时来回跳动的原因）。
  resized() {
    const main = this.main,
      top = main.scrollTop,
      h = this.viewH ?? main.clientHeight;
    if (!this.held)
      this.held = {
        anchor: this.anchor(h),
        end: top >= 1 && main.scrollHeight - top - Math.max(h, main.clientHeight) <= 1,
      };
    clearTimeout(this.heldTimer);
    this.heldTimer = setTimeout(() => {
      this.held = null;
    }, 500);
    main.style.setProperty('--vh', main.clientHeight + 'px');
    clearTimeout(this.capTimer);
    this.capTimer = setTimeout(() => this.recap(), 200);
    this.layout();
    this.paint();
  }
  clear(p) {
    for (const el of p.slots.values()) release(el);
    p.slots.clear();
    p.strip.replaceChildren();
  }
  // 正文是否还有图在排队或读取：后台生成视频画面让位于阅读（thumbs.mjs installFrames）。
  busy() {
    for (const j of jobs.values()) if (!j.small && !j.dead && (!j.started || j.held)) return true;
    return false;
  }
  show(book, anchor) {
    for (const p of this.panes) this.clear(p);
    this.book = book;
    this.browsing = false;
    this.held = null;
    this.keep = null;
    stopFling();
    this.main.scrollTop = 0;
    this.preview.scrollTop = 0;
    this.cap = this.main.clientHeight || Infinity;
    this.layout(anchor || null);
  }
  anchor(h = this.main.clientHeight) {
    if (this.single) return this.singleAnchor(h);
    if (
      !this.book?.pages.length ||
      this.panes[0].starts.length !== this.book.pages.length + 1 ||
      this.main.scrollTop < 1
    )
      return null;
    const { i, f } = at(this.panes[0].starts, this.main.scrollTop + h / 2);
    return { name: this.book.pages[i].name, f };
  }
  // 单文件模式下的阅读位置：视窗中心所在的页（书首也不返回 null）；f 取 keep（仍在那一页时），否则取该页在长条里"上沿对齐视窗顶部、
  // 不高于视窗的页居中"的位置。保存的位置、书签因此在退出单文件模式后、或在长条模式下打开时同样有效。
  singleAnchor(h) {
    const pages = this.book?.pages,
      starts = this.panes[0].starts;
    if (!pages?.length || starts.length !== pages.length + 1) return null;
    const page = pages[at(starts, this.main.scrollTop + h / 2).i];
    if (this.keep?.name === page.name) return this.keep;
    return { name: page.name, f: this.stripF(page) };
  }
  stripF(page) {
    const H = this.main.clientHeight,
      h = this.stripH(page);
    return h > H ? H / 2 / h : 0.5;
  }
  // 该页在长条里的显示高度（与 layout 的长条排版同一规则）。
  stripH(page) {
    return offsets([page], Math.max(1, this.main.clientWidth), this.fit, this.cap)[1];
  }
  // 进入 / 退出单文件模式：停在同一页。进入时取视窗中心所在的页（含页内位置，退出时没翻页就回到原处）；退出时回到该页在长条里的位置。
  setSingle(on) {
    on = !!on;
    if (this.single === on) return;
    const pages = this.book?.pages,
      starts = this.panes[0].starts;
    let anchor = null;
    if (pages?.length && starts.length === pages.length + 1) {
      if (on) {
        const { i, f } = at(starts, this.main.scrollTop + this.main.clientHeight / 2);
        anchor = { name: pages[i].name, f };
      } else anchor = this.anchor();
    }
    stopFling();
    this.held = null;
    clearTimeout(this.heldTimer);
    this.single = on;
    this.keep = null;
    this.main.classList.toggle('single-file', on);
    this.layout(anchor, false);
    this.paint(); // 同一帧内按新版面重画：页的位置与滚动位置一致（当前媒体按页的位置判定）
  }
  // stick：已滚到书尾时重排后仍停在书尾（单文件模式下不需要：每页的位置是确定的；进出单文件模式时也不用，要停在同一页）。
  layout(anchor = this.held ? this.held.anchor : this.anchor(), stick = !this.single) {
    const nav = this.panes[1],
      H = this.preview.clientHeight,
      main = this.main;
    // 已滚到书尾时，补齐图片尺寸后仍停在书尾，“再按一次切书”才可靠。
    const end =
      stick &&
      (this.held ? this.held.end : main.scrollTop >= 1 && main.scrollHeight - main.scrollTop - main.clientHeight <= 1);
    if (!H) this.browsing = false;
    // 读者正在独立浏览缩略图时，补齐图片尺寸不能把导航拉回正文。
    const navPos = this.browsing && nav.starts.length > 1 ? at(nav.starts, this.preview.scrollTop + H / 2) : null;
    main.classList.toggle('natural-size', this.single && !this.fit);
    for (const [k, p] of this.panes.entries()) {
      if (!k && this.single) {
        const vh = Math.max(1, main.clientHeight);
        p.starts = Array.from({ length: (this.book?.pages.length || 0) + 1 }, (_, i) => i * vh);
        p.strip.style.height = p.starts.at(-1) + 'px';
        continue;
      }
      p.starts = offsets(
        this.book?.pages || [],
        Math.max(1, p.el.clientWidth),
        k === 1 || this.fit,
        k ? Infinity : this.cap,
        k === 1,
      );
      p.strip.style.height = p.starts.at(-1) + 'px';
    }
    const i = anchor ? this.book?.pages.findIndex((p) => p.name === anchor.name) : -1;
    if (i >= 0) this.place({ i, f: anchor.f });
    else this.main.scrollTop = 0;
    if (end && i >= 0) main.scrollTop = main.scrollHeight;
    this.correctedTop = this.main.scrollTop;
    this.viewH = main.clientHeight;
    if (navPos) this.preview.scrollTop = point(nav.starts, navPos) - H / 2;
    this.follow();
    this.schedule();
    this.hooks.laid?.();
  }
  // 下一帧按当前锚点重排一次（多张缩略图补齐尺寸时合并）。
  relayout() {
    if (this.relaying) return;
    this.relaying = requestAnimationFrame(() => {
      this.relaying = 0;
      if (!this.book) return;
      this.layout(this.held ? this.held.anchor : this.anchor());
      this.hooks.measured();
    });
  }
  // 页码与整体进度，供页码浮标、工具栏和书架显示。
  position() {
    const n = this.book?.pages.length || 0,
      starts = this.panes[0].starts;
    if (!n || starts.length !== n + 1) return null;
    const { i } = at(starts, this.main.scrollTop + this.main.clientHeight / 2),
      max = this.main.scrollHeight - this.main.clientHeight;
    return { i, n, ratio: max > 0 ? Math.min(1, Math.max(0, this.main.scrollTop / max)) : 1 };
  }
  // 跳到页内位置（书签、媒体、缩略图栏）：先停住拖动后的惯性。
  jump(pos) {
    stopFling();
    this.place(pos);
  }
  // 只定位、不打断惯性：补齐尺寸后的重排保持锚点也走这里，惯性在新位置上继续。
  // 单文件模式下页内位置 f 只决定落在哪一页（停在该页的上沿），带 f 的位置记为 keep，退出单文件模式时回到它。
  place(pos) {
    if (this.single) {
      const page = this.book?.pages[pos.i];
      if (page && pos.f != null) this.keep = { name: page.name, f: pos.f };
      this.main.scrollTop = this.panes[0].starts[pos.i] ?? 0;
      return;
    }
    this.main.scrollTop = point(this.panes[0].starts, pos) - this.main.clientHeight / 2;
  }
  fromPreview(y) {
    if (!this.book) return;
    this.browsing = false;
    this.jump(at(this.panes[1].starts, this.preview.scrollTop + y));
    this.follow();
  }
  follow() {
    if (!this.book?.pages.length || !this.preview.clientWidth) return;
    const [body, nav] = this.panes,
      top = this.main.scrollTop,
      H = this.main.clientHeight;
    const map = (y) => point(nav.starts, at(body.starts, y));
    if (!this.browsing) this.preview.scrollTop = map(top + H / 2) - this.preview.clientHeight / 2;
    if (!this.marker.isConnected) nav.strip.append(this.marker);
    const start = map(top);
    this.marker.style.top = start + 'px';
    this.marker.style.height = Math.max(2, map(top + H) - start) + 'px';
  }
  schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.paint();
      });
  }
  paint() {
    for (const [k, p] of this.panes.entries()) {
      const { el, starts, slots } = p,
        H = el.clientHeight,
        top = el.scrollTop;
      if (!this.book?.pages.length || !H) {
        if (slots.size) this.clear(p);
        continue;
      }
      // 单文件模式下停在整页上时，下一页的上沿正好在视窗下缘：不算可见（不为它挂媒体源）。
      const first = at(starts, top).i,
        last = at(starts, top + H - (!k && this.single ? 1 : 0)).i;
      const lo = Math.max(0, first - 1),
        hi = Math.min(this.book.pages.length - 1, last + 1);
      for (const [i, node] of slots)
        if (i < lo || i > hi) {
          release(node);
          node.remove();
          slots.delete(i);
        }
      for (let i = lo; i <= hi; i++) {
        const page = this.book.pages[i];
        let node = slots.get(i);
        if (!node) {
          node = document.createElement('div');
          node.className = 'page';
          node.dataset.name = page.name;
          node.dataset.n = i + 1;
          /* 只有缩略图悬停时显示文件名 */ if (k) node.title = shownName(page);
          p.strip.append(node);
          slots.set(i, node);
        }
        node.style.top = starts[i] + 'px';
        node.style.height = starts[i + 1] - starts[i] + 'px';
        const kind = pageKind(page);
        // 视频、音频页交给 media.mjs（hooks.media）：正文里是播放器，缩略图栏里是固定样式的占位；视频的占位上再叠真实画面（hooks.frame，持久化，只为可见项生成）。
        // visible：与视窗相交；只有它们持有媒体源，相邻页不预加载。
        if (kind !== 'image') {
          node.style.maxWidth =
            !k && kind === 'video' && !this.single ? videoWidth(page, el.clientWidth, this.fit, this.cap) + 'px' : '';
          this.hooks.media?.(node, this.book, page, kind, k, i >= first && i <= last);
          if (k && kind === 'video') this.hooks.frame?.(node, this.book, page, i >= first && i <= last); // 缩略图栏里的视频叠上真实画面（thumbs.mjs installFrames）
          continue;
        }
        if (!k && !this.fit && page.w && !this.single) node.style.maxWidth = page.w + 'px';
        else node.style.maxWidth = '';
        const ahead = this.up ? i < first : i > last;
        const priority = (k ? 8 : 0) + (ahead ? 2 : i < first || i > last ? 4 : 0);
        const book = this.book;
        imageJob(
          node,
          () => this.hooks.file(book, page),
          priority,
          k,
          (w, h) => {
            if (page.w === w && page.h === h) return;
            // 缩略图栏补齐的尺寸（view.mjs 已推迟到停下后才报告）：同一帧里的多张合并为一次重排。
            if (k) {
              page.w = w;
              page.h = h;
              return this.relayout();
            }
            const anchor = this.held ? this.held.anchor : this.anchor();
            page.w = w;
            page.h = h;
            this.layout(anchor);
            this.hooks.measured();
          },
          (e) => {
            node.classList.add('failed');
            node.title = shownName(page);
            node.replaceChildren(this.hooks.invalid(), midName(shownName(page)));
            this.hooks.error(e, page);
          },
          pageKey(book, page),
        );
      }
    }
  }
}
