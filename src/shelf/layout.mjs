// 书籍列表的布局与焦点：普通网格 / 瀑布流两种绝对定位布局、只挂载可见范围附近的卡片（虚拟列表）、
// 选中的卡片（鼠标与键盘同一状态）与方向键导航。卡片内容见 card.mjs，何时重画见 shelf.mjs 的 draw。
import { $ } from './util.mjs';

export function install(ctx, S) {
  const { books, make, safe, get, shelf } = ctx,
    holder = $('books');
  const card = (...a) => S.card(...a);
  const fill = (...a) => S.fill(...a);
  const sig = (...a) => S.sig(...a);
  const ratioOf = (...a) => S.ratioOf(...a);
  // ---- 列表：两种布局，都用绝对定位，只挂载可见范围附近的卡片，数千本书也只有几十个节点。
  // 普通网格（默认）：等宽等高的单元格按行对齐，封面裁切填满；瀑布流：按封面比例，依次放进最短的一列，阅读顺序大体从左到右。
  // 卡片按书 id 复用：删除、移动、改名后只更新受影响的卡片，其余卡片和已加载的封面保持不动，位置变化以过渡移动。
  const MIN = 168,
    grid = make('div', 'grid'),
    empty = make('div', 'shelf-empty');
  grid.setAttribute('role', 'list');
  empty.hidden = true;
  holder.replaceChildren(grid, empty);
  let slots = new Map(),
    columns = [],
    laidWidth = 0,
    moveTimer = 0,
    frame = 0;
  S.shown = [];
  S.activeId = null;
  const nodes = new Map(); // 书 id → 卡片节点（含已加载的封面）；不在可见范围的节点暂时摘下，超过上限时丢弃最早的
  const innerWidth = () => {
    const s = getComputedStyle(holder);
    return holder.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  };
  S.layoutMode = get('shelfLayout', 'grid') === 'masonry' ? 'masonry' : 'grid';
  function place(animate = false) {
    const w = innerWidth(),
      gap = w < 520 ? 10 : 16,
      cols = Math.max(2, Math.floor((w + gap) / (MIN + gap))),
      cw = (w - gap * (cols - 1)) / cols,
      hs = Array(cols).fill(0),
      ch = Math.round(cw * 1.42);
    slots = new Map();
    columns = Array.from({ length: cols }, () => []);
    laidWidth = w;
    S.shown.forEach((b, i) => {
      let k = 0;
      if (S.layoutMode === 'grid') k = i % cols;
      else for (let j = 1; j < cols; j++) if (hs[j] < hs[k] - 1) k = j;
      const h = S.layoutMode === 'grid' ? ch : Math.round(cw * ratioOf(b));
      slots.set(b.id, { x: k * (cw + gap), y: hs[k], w: cw, h, i, col: k, row: columns[k].length });
      columns[k].push(b);
      hs[k] += h + gap;
    });
    grid.style.height = Math.max(0, ...hs.map((h) => h - gap)) + 'px';
    clearTimeout(moveTimer);
    grid.classList.toggle('moving', animate);
    if (animate) moveTimer = setTimeout(() => grid.classList.remove('moving'), 420);
    mount(true);
  }
  function position(el, s) {
    el.style.translate = s.x + 'px ' + s.y + 'px';
    el.style.width = s.w + 'px';
    el.style.height = s.h + 'px';
    el.dataset.i = s.i;
    el.style.setProperty('--d', Math.min(s.i, 24) * 14 + 'ms');
  }
  function mount(check = false) {
    if (!shelf.open) return;
    const top = holder.scrollTop - grid.offsetTop,
      h = holder.clientHeight,
      lo = top - h * 0.75,
      hi = top + h * 1.75,
      want = new Set();
    for (const b of S.shown) {
      const s = slots.get(b.id);
      if (s.y + s.h >= lo && s.y <= hi) want.add(b.id);
    }
    if (slots.has(S.activeId)) want.add(S.activeId); // 焦点所在的卡片始终挂载
    for (const [id, el] of nodes) if (!want.has(id) && el.isConnected) el.remove();
    for (const id of want) {
      const b = books.get(id);
      let el = nodes.get(id);
      if (!el) {
        el = card(b);
        nodes.set(id, el);
      } else if (check || !el.isConnected) {
        if (el._sig !== sig(b)) fill(el, b);
      }
      position(el, slots.get(id));
      if (!el.isConnected) grid.append(el);
    }
    if (nodes.size > 360)
      for (const [id, el] of nodes) {
        if (nodes.size <= 240) break;
        if (!el.isConnected) nodes.delete(id);
      }
  }
  holder.addEventListener(
    'scroll',
    () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          mount();
        });
    },
    { passive: true },
  );
  let relayout = 0;
  const relayoutSoon = () => {
    if (!relayout)
      relayout = requestAnimationFrame(() => {
        relayout = 0;
        if (shelf.open && S.shown.length) place();
      });
  };
  new ResizeObserver(() => {
    if (shelf.open && S.shown.length && Math.abs(innerWidth() - laidWidth) > 0.5) place();
  }).observe(holder);
  // ---- 焦点：同一时间只有一张“选中”的卡片。鼠标移到卡片上和键盘方向键移动是同一个状态，显示相同的书名、进度、标签和操作按钮。
  function mark(el, on) {
    el.classList.toggle('active', on);
    for (const x of el.querySelectorAll('button')) x.tabIndex = on ? 0 : -1;
  }
  function setActive(id, { focus = false, scroll = null } = {}) {
    const prev = S.activeId !== id && nodes.get(S.activeId);
    S.activeId = id ?? null;
    if (prev) mark(prev, false);
    if (!id || !slots.has(id)) return;
    if (scroll) reveal(id, scroll);
    else if (!nodes.get(id)?.isConnected) mount();
    const el = nodes.get(id);
    if (!el) return;
    mark(el, true);
    if (focus) el._pick.focus({ preventScroll: true });
  }
  function reveal(id, how) {
    const s = slots.get(id);
    if (!s) return;
    const top = s.y + grid.offsetTop,
      h = holder.clientHeight,
      pad = 12;
    if (how === 'center') holder.scrollTop = top + s.h / 2 - h / 2;
    else if (top < holder.scrollTop + pad) holder.scrollTop = top - pad;
    else if (top + s.h > holder.scrollTop + h - pad) holder.scrollTop = top + s.h - h + pad;
    mount();
  }
  // 只响应真实的鼠标移动：键盘滚动列表时卡片从静止的鼠标下经过，不能抢走键盘焦点。
  let lastXY = '';
  grid.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const xy = e.screenX + ',' + e.screenY;
    if (xy === lastXY) return;
    lastXY = xy;
    const el = e.target.closest('.book');
    if (!el || (el.dataset.id === S.activeId && grid.contains(document.activeElement))) return;
    const ae = document.activeElement,
      typing = ae?.matches('input,select,textarea') || !!ae?.closest('[popover]');
    setActive(el.dataset.id, { focus: !typing });
  });
  function beside(s, d) {
    const col = columns[s.col + d];
    if (!col) return null;
    const c = s.y + s.h / 2;
    let best = null,
      dist = Infinity;
    for (const b of col) {
      const o = slots.get(b.id),
        x = Math.abs(o.y + o.h / 2 - c);
      if (x < dist) {
        dist = x;
        best = b;
      }
    }
    return best;
  }
  function near(col, y) {
    let best = null,
      dist = Infinity;
    for (const b of col) {
      const o = slots.get(b.id),
        x = Math.abs(o.y - y);
      if (x < dist) {
        dist = x;
        best = b;
      }
    }
    return best;
  }
  grid.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !e.target.closest('.book')) return;
    const s = slots.get(S.activeId);
    if (!s) return;
    let to;
    switch (e.key) {
      case 'ArrowUp':
        to = columns[s.col][s.row - 1];
        break;
      case 'ArrowDown':
        to = columns[s.col][s.row + 1];
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const d = e.key === 'ArrowLeft' ? -1 : 1;
        to = beside(s, d) ?? S.shown[s.i + d];
        break;
      }
      case 'PageUp':
      case 'PageDown':
        to = near(columns[s.col], s.y + (e.key === 'PageUp' ? -1 : 1) * holder.clientHeight * 0.85);
        break;
      case 'Home':
        to = S.shown[0];
        break;
      case 'End':
        to = S.shown.at(-1);
        break;
      case 'Delete': {
        e.preventDefault();
        const b = books.get(S.activeId);
        if (b && !e.repeat) safe(ctx.remove)(b);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    if (to) setActive(to.id, { focus: true, scroll: 'nearest' });
  });
  S.grid = grid;
  S.empty = empty;
  S.nodes = nodes;
  S.place = place;
  S.mount = mount;
  S.relayoutSoon = relayoutSoon;
  S.mark = mark;
  S.setActive = setActive;
}
