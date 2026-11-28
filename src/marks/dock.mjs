import { clipEnd } from '../core/model.mjs';
import { list, entries, key, endKey } from './list.mjs';
// 书架书签栏（左侧，常驻或左缘弹出）：按阅读列表（ctx.readingList：书架页当前页签 + 筛选 + 书籍排序）集中显示各书的书签、标出最近书签（core/recent.mjs）、跨书跳转，以及供全屏书架书签用的 ctx.shelfmarks。
const DWELL = 150,
  MIN_W = 160,
  BROWSE = 1500; // DWELL / MIN_W：与右侧缩略图栏（reader/panel.mjs）一致；边缘触发区的距离见 ctx.atEdge。BROWSE：手动滚动书架书签列表后这段时间内不自动定位
export function install(ctx, S) {
  const { main, t, fmt, notice, make } = ctx;
  // 书架书签：开关打开后在左侧常驻一列（正文让出宽度），按阅读列表的顺序集中显示列表里所有书的书签。
  // 悬停不跳转，点击才跳转（可跨书）；此时短按 F / Enter（Shift 反向）也按这个列表跳到下一个书签，必要时切换书。
  const dock = make('aside', 'sm-dock'),
    dockHead = make('div', 'sm-head'),
    dockList = make('div', 'sm-list'),
    dockGrip = make('div', 'sm-grip');
  // 头部是一个占满整行的块状按钮：打开全屏书架书签（overview.mjs），按钮里有图标、文字和书签数；浮动时点开后先收起列表。没有书签时不可用。
  const dockOpen = ctx.iconButton(
      'overview',
      '',
      () => {
        if (ctx.overview?.shelfmarks.open() && !pinned) float(false);
      },
      'side-open',
    ),
    dockLabel = make('span', 'side-title'),
    dockCount = make('span', 'count');
  dockOpen.append(dockLabel, dockCount);
  dock.id = 'shelfmarks';
  dock.hidden = true;
  dockGrip.setAttribute('role', 'separator');
  dockGrip.setAttribute('aria-orientation', 'vertical');
  dockGrip.tabIndex = 0;
  dock.append(dockHead, dockList, dockGrip);
  S.cards(dockList);
  document.getElementById('toolbar').before(dock);
  // 阅读列表里的书（书架页当前选中的页签 + 筛选，不含过期书），顺序与上一本 / 下一本相同。
  const shelfBooks = () => ctx.readingList();
  // 书架上没有可显示的书签时的提示：书架页的筛选生效时，说明可能是筛选导致的（有清除筛选的接口时附一个按钮）；没有筛选才说书架上还没有书签。
  const emptyKey = () => (ctx.filtering?.() ? 'smFiltered' : 'smEmpty');
  function emptyNote() {
    const p = make('p', 'bm-empty', t(emptyKey()));
    if (emptyKey() === 'smFiltered' && ctx.clearFilters) {
      const b = make('button', 'link-btn', t('clearFilters'));
      b.type = 'button';
      b.onclick = () => {
        ctx.clearFilters();
        renderDock();
      };
      p.append(make('br'), b);
    }
    return p;
  }
  function renderDock() {
    if (dock.hidden) return;
    if (S.editing(dockList)) return S.later(renderDock); // 正在就地改名：改完再重画
    const groups = shelfBooks()
      .map((book) => ({ book, items: list(book) }))
      .filter((g) => g.items.length);
    dock.setAttribute('aria-label', t('shelfmarks'));
    dockGrip.title = t('smWidth');
    dockGrip.setAttribute('aria-label', t('smWidth'));
    dockOpen.title = t('smOvOpen');
    dockOpen.setAttribute('aria-label', dockOpen.title);
    dockOpen.disabled = !groups.some((g) => g.items.some((x) => x.i >= 0));
    dockLabel.textContent = t('smOpenLabel');
    dockCount.textContent = groups.reduce((n, g) => n + g.items.length, 0) || '';
    if (!dockOpen.isConnected) dockHead.append(dockOpen);
    dock.style.setProperty('--bm-ar', S.ratio());
    if (!groups.length) {
      dockList.replaceChildren(emptyNote());
      return;
    }
    marked = null;
    dockList.replaceChildren(
      ...groups.map(({ book, items }) => {
        // 每本书一组，不显示书名；当前书的一组高亮。
        const section = make('section', 'sm-book');
        section.dataset.book = book.id;
        section.setAttribute('aria-label', ctx.title(book));
        section.append(...entries(items).map(({ x, end }) => S.tile(book, x, true, end)));
        if (grid) section.style.containIntrinsicSize = sizeOf(section);
        return section;
      }),
    );
    markDock();
    estimate();
  }
  // 未排版的分组（content-visibility，bookmarks.css）按已排版的一组量出的列数、行高估算占位高度，列表总高和滚动条接近真实值。
  // 重建列表时新分组直接用上次的量度；列表显示、改变宽度时（ResizeObserver，已排版之后）重新量，列数、行高没变就不动。
  let grid = null;
  const sizeOf = (s, g = grid) => `auto ${Math.round(Math.ceil(s.children.length / g.cols) * g.row - g.gap + g.pad)}px`;
  function estimate() {
    if (dock.hidden) return;
    const all = dockList.querySelectorAll('.sm-book'),
      cur = dockList.querySelector('.sm-book.current'),
      ref = cur?.offsetHeight ? cur : [...all].find((s) => s.checkVisibility({ contentVisibilityAuto: true }));
    if (!ref?.offsetHeight) return;
    const cs = getComputedStyle(ref),
      cols = cs.gridTemplateColumns.split(' ').length || 1,
      gap = parseFloat(cs.rowGap) || 0,
      pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
      g = { cols, gap, pad, row: (ref.offsetHeight - pad + gap) / Math.ceil(ref.children.length / cols) };
    if (grid && g.cols === grid.cols && Math.abs(g.row - grid.row) < 0.5 && g.gap === grid.gap && g.pad === grid.pad)
      return;
    grid = g;
    for (const s of all) s.style.containIntrinsicSize = sizeOf(s);
  }
  new ResizeObserver(() => estimate()).observe(dockList);
  // 标出当前书的一组，以及最近书签（当前标记，.active；core/recent.mjs：阅读位置之前最近的一项，本书前面没有时是列表里前面某本书的最后一项；
  // 起点与区段书签各是一项，只高亮最近的那一项）。只改样式，不滚动列表。
  function markDock() {
    if (dock.hidden) return;
    for (const s of dockList.querySelectorAll('.sm-book'))
      s.classList.toggle('current', s.dataset.book === ctx.current?.id);
    markNear();
  }
  let marked = null;
  function markNear() {
    const r = ctx.current && S.nearest(shelfBooks()),
      item = r ? S.spotOf(dockList.querySelector(`.sm-book[data-book="${CSS.escape(r.book.id)}"]`), r) : null;
    if (item !== marked) {
      marked?.classList.remove('active');
      item?.classList.add('active');
      marked = item;
    }
  }
  // 阅读滚动时当前标记跟随更新：节流到每 200ms 至多一次，只改前后两个格子，不滚动列表。
  let nearTimer = 0;
  main.addEventListener(
    'scroll',
    () => {
      if (!nearTimer && (!dock.hidden || !S.panel.hidden))
        nearTimer = setTimeout(() => {
          nearTimer = 0;
          if (!dock.hidden) markNear();
          if (!S.panel.hidden) S.markPanel();
        }, 200);
    },
    { passive: true },
  );
  // 列表定位：切书、跳转书签、列表弹出 / 显示时，把当前标记（可能在前面某本书的一组里；没有时为当前书那一组）滚入可见范围；都没有则不动。
  // 用户正在浏览列表（指针在列表上，或刚手动滚动过）时不抢滚动位置；列表刚显示时（force）除外。只滚动列表本身，不影响正文。
  let browsedAt = -Infinity;
  for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
    dockList.addEventListener(
      type,
      () => {
        browsedAt = performance.now();
      },
      { passive: true },
    );
  function reveal(force = false) {
    if (dock.hidden || (!force && (dock.matches(':hover') || performance.now() - browsedAt < BROWSE))) return;
    const target = marked || dockList.querySelector('.sm-book.current');
    if (!target) return;
    const l = dockList.getBoundingClientRect(),
      r = target.getBoundingClientRect();
    if (r.top >= l.top && r.bottom <= l.bottom) return;
    dockList.scrollTop += r.top - l.top - Math.max(0, (l.height - r.height) / 2);
  }
  // 跳到某本书的某个书签；不是当前书时先打开那本书（select 会先恢复它的阅读位置，同一帧内再跳转）。
  function goShelf(book, x, end = false) {
    if (book !== ctx.current) ctx.select(book);
    if (ctx.current === book && S.starts()) (end ? S.goEnd : S.go)(x);
  }
  // 短按 F / Enter：当前书里位于屏幕中心之后的书签，没有则依次是后面各书的书签，最后回到列表开头。
  // d=-1（Shift）反向：屏幕中心之前的书签，没有则是前面各书的书签，最后回到列表末尾。
  // 当前书不在阅读列表里（被筛选掉、在别的页签里）时仍按本书内的书签循环。
  function nextShelf(d = 1) {
    const book = ctx.current,
      order = shelfBooks(),
      rank = new Map(order.map((b, i) => [b, i]));
    if (!rank.has(book)) return S.next(d);
    const all = order.flatMap((b) => list(b).map((x) => ({ ...x, book: b }))),
      flat = all.filter((x) => x.i >= 0);
    if (!flat.length) {
      notice(null, t(all.length ? 'bmAllGone' : emptyKey()));
      return;
    }
    const s = S.starts();
    if (!s) return;
    let k = -1,
      found = false;
    if (S.repeat(book)) {
      const j = flat.findIndex((x) => x.bm.id === S.last.id);
      if (j >= 0) {
        k = j + d;
        found = true;
      }
    }
    if (!found) {
      const r = rank.get(book),
        c = S.cursor();
      k =
        d > 0
          ? flat.findIndex((x) => rank.get(x.book) > r || (x.book === book && c(x) > 0))
          : flat.findLastIndex((x) => rank.get(x.book) < r || (x.book === book && c(x) < 0));
    }
    const wrap = k < 0 || k >= flat.length;
    if (wrap) k = d > 0 ? 0 : flat.length - 1;
    const x = flat[k],
      moved = x.book !== book;
    goShelf(x.book, x);
    notice(
      null,
      wrap
        ? t(d > 0 ? 'bmWrap' : 'bmWrapBack')
        : fmt('bmN', { n: k + 1, m: flat.length }) + (moved ? ' · ' + clipEnd(ctx.title(x.book)) : ''),
    );
  }
  dockList.addEventListener('click', (e) => {
    if (e.target.closest('.bm-del,.bm-ren,.bm-edit')) return;
    const section = e.target.closest('.sm-book'),
      book = section && ctx.books.get(section.dataset.book);
    if (!book) return;
    // 点哪项跳到哪里：区段书签那一项跳到区段书签。
    const item = e.target.closest('.bm-item'),
      end = !!item && 'end' in item.dataset;
    if (!item || item.classList.contains('gone')) return;
    const x = list(book).find((x) => x.bm.id === item.dataset.id);
    if (x && (end ? x.e >= 0 : x.i >= 0)) goShelf(book, x, end);
    main.focus();
  });
  dock.addEventListener('contextmenu', (e) => e.preventDefault());
  // 与右侧缩略图栏相同：默认不常驻，鼠标贴近左缘稍作停留即浮动弹出，离开后淡出收起；常驻时停靠在左侧，正文让出宽度。
  let pinned = ctx.get('shelfmarks', false) === true;
  const pressed = () =>
    document.querySelector('#bar [data-act="shelfmarks"]')?.setAttribute('aria-pressed', String(pinned));
  function setDock(pin) {
    pinned = pin;
    dock.classList.toggle('floating', !pin);
    document.body.classList.toggle('shelfmarks', pin);
    pressed();
    if (pin) {
      clearTimeout(dock.fadeTimer);
      dock.classList.remove('leaving');
      dock.hidden = false;
    } else dock.hidden = true;
    renderDock();
    reveal(true);
  }
  function float(open) {
    if (pinned) return;
    const was = !dock.hidden;
    ctx.fade(dock, open);
    if (open && !was) {
      renderDock();
      reveal(true);
    }
  }
  ctx.actions.shelfmarks = () => {
    ctx.put('shelfmarks', !pinned);
    setDock(!pinned);
  };
  let edgeTimer = 0;
  const cancelEdge = () => {
    clearTimeout(edgeTimer);
    edgeTimer = 0;
  };
  document.addEventListener('pointermove', (e) => {
    const near =
      e.pointerType === 'mouse' &&
      !e.buttons &&
      !pinned &&
      ctx.atEdge('left', e) &&
      !ctx.showing(dock) &&
      !document.querySelector('dialog[open]') &&
      ctx.get('edgeLeft', true);
    if (!near) cancelEdge();
    else if (!edgeTimer)
      edgeTimer = setTimeout(() => {
        edgeTimer = 0;
        if (!pinned && !document.querySelector('dialog[open]')) float(true);
      }, DWELL);
    // 与右侧缩略图栏相同的兜底：在静止的指针下弹出后没有 pointerleave，指针离开列表和左缘即收起。
    if (
      e.pointerType === 'mouse' &&
      !pinned &&
      !resizing &&
      ctx.showing(dock) &&
      !ctx.atEdge('left', e) &&
      !dock.contains(e.target)
    )
      float(false);
  });
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) cancelEdge();
  });
  dock.addEventListener('pointerleave', () => {
    if (!pinned && !resizing) float(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pinned && !S.editing(dock)) float(false);
  });
  ctx.on('books', renderDock);
  ctx.shelf.addEventListener('close', renderDock); // 在书架页移动、删除书目后同步
  // 拖动右缘或用左右方向键调整宽度，与右侧缩略图栏的拖动条一致。
  const width = (v) => {
    const w = Math.round(Math.max(MIN_W, Math.min(innerWidth * 0.45, v)));
    document.documentElement.style.setProperty('--sm-w', w + 'px');
    return w;
  };
  width(ctx.get('shelfmarksWidth', 260));
  let resizing = false;
  dockGrip.onpointerdown = (e) => {
    if (e.button !== 0) return;
    resizing = true;
    dockGrip.setPointerCapture(e.pointerId);
  };
  dockGrip.onpointermove = (e) => {
    if (resizing) width(e.clientX);
  };
  dockGrip.onlostpointercapture = () => {
    resizing = false;
    ctx.put('shelfmarksWidth', width(dock.offsetWidth));
    renderDock();
  };
  dockGrip.onkeydown = (e) => {
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      ctx.put('shelfmarksWidth', width(dock.offsetWidth + (e.key === 'ArrowRight' ? 16 : -16)));
    }
  };
  setDock(pinned);
  // 供全屏书架书签（overview.mjs）使用：有效书签按书分组、跳转、缩略图 key、显示比例，以及打开时默认选中的书签。
  ctx.shelfmarks = {
    groups: () =>
      shelfBooks()
        .map((book) => ({ book, items: list(book).filter((x) => x.i >= 0) }))
        .filter((g) => g.items.length),
    go: goShelf,
    goEnd: (book, x) => goShelf(book, x, true),
    thumbKey: key,
    endKey,
    ratio: S.ratio,
    emptyKey,
    // 打开时选中最近书签 {book, id, end}（与书架书签列表的当前标记相同）；没有时选中当前书的第一个书签，当前书也没有为 null。
    start() {
      const book = ctx.current;
      if (!book) return null;
      const r = S.nearest(shelfBooks());
      if (r) return r;
      const first = list(book).find((x) => x.i >= 0);
      return first ? { book, id: first.bm.id, end: false } : null;
    },
  };
  ctx.settings.push({
    id: 'edgeLeft',
    group: 'reading',
    label: 'smEdgeLeft',
    type: 'toggle',
    get: () => ctx.get('edgeLeft', true),
    set: (v) => ctx.put('edgeLeft', !!v),
  });
  Object.assign(S, { dock, renderDock, markDock, reveal, nextShelf, pinned: () => pinned });
}
