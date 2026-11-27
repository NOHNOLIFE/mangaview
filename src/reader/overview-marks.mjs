import { shownName, pageKind } from '../core/model.mjs';
import { norm } from '../core/match.mjs';
// 全屏书架书签：阅读列表里各书的书签按书分组显示（网格或瀑布流），搜索作品名、文件名、书签名称，点击跳转（数据来自 ctx.shelfmarks）。
export function install(ctx, { sheet, sheets, masonry }) {
  const { t, fmt, make } = ctx;
  // ---- 全屏书架书签 ----
  // 网格：书签缩略图都按同一比例显示（CSS grid）；瀑布流：按缩略图自身比例在每组里逐列排布（markLayout）。
  // 按书分组并显示书名，当前书高亮。上下按画面位置找最近的一格。
  let marks = [],
    count = 0,
    msel = 0,
    mframe = 0,
    mfollow = false,
    prefer = null; // prefer：重建时保留的选中项 {book, id, end}
  const sm = () => ctx.shelfmarks;
  // groups：打开时的全部书签（按书分组）；搜索只在其中过滤后重建列表，不重新读取书架。
  let groups = [];
  const shelfSheet = sheet('shelfOverview', ['c', '['], 'ov-marks', {
    find: 'ovFindMarks',
    setup(quiet) {
      groups = sm()?.groups() || [];
      if (!groups.length) {
        if (!quiet) ctx.notice(null, t(sm()?.emptyKey() ?? 'smEmpty'));
        return false;
      }
      shelfSheet.name.textContent = t('shelfmarks');
      shelfSheet.body.style.setProperty('--bm-ar', sm().ratio());
      const start = prefer ?? sm().start();
      prefer = null;
      build(start);
      return true;
    },
    show() {
      markLayout();
      mark(msel);
      mfollow = true;
      marks[msel]?.node.scrollIntoView({ block: 'center' });
    },
    // 搜索词变化：保留仍在结果里的选中项，否则选中第一个结果；清空后回到当前位置附近的书签。
    filter() {
      const all = !shelfSheet.filtered();
      build(all ? sm().start() : at(msel));
      markLayout();
      mark(msel);
      mfollow = true;
      marks[msel]?.node.scrollIntoView({ block: all ? 'center' : 'nearest' });
    },
    move(act) {
      const to = {
        left: msel - 1,
        right: msel + 1,
        home: 0,
        end: marks.length - 1,
        up: near(-1, 0),
        down: near(1, 0),
        pageUp: near(-1, 1),
        pageDown: near(1, 1),
      }[act];
      mark(to);
      mfollow = true;
      marks[msel]?.node.scrollIntoView({ block: 'nearest' });
    },
    relayout() {
      markLayout();
      marks[msel]?.node.scrollIntoView({ block: 'nearest' });
    },
    hover(node) {
      const k = +node.dataset.k;
      if (k !== msel) {
        mfollow = false;
        mark(k);
      }
    },
    choose() {
      pick(msel);
    },
    cleanup() {
      shelfSheet.body.replaceChildren();
      marks = [];
    },
  });
  // 匹配作品名（含原文件夹名）、书签所在文件和区段终点所在文件的文件名、书签名称；作品名命中即显示该作品的全部书签。
  function hayMark(book, x) {
    const file = (i) => (i >= 0 && book.pages[i] ? shownName(book.pages[i]) : '');
    return norm(
      [ctx.title(book), book.title ?? '', file(x.i), x.bm.end ? file(x.e) : '', ctx.marks?.name(book, x.bm) ?? ''].join(
        ' ',
      ),
    );
  }
  // 第 k 项是哪个书签：{book, id, end}（end：区段书签那一项），重建后据此找回选中项。
  const at = (k) => (marks[k] ? { book: marks[k].book, id: marks[k].x.bm.id, end: marks[k].end } : null);
  // 按当前搜索词重建列表，start 为要选中的项 {book, id, end}（打开时为最近书签，见 dock.mjs 的 start）。区段书签的起点和终点是前后紧挨的两项（与书签列表相同），键盘导航把终点当作独立的一项，
  // 选中其中一项时两项一起高亮（.mate），点终点跳到终点。位置文字只数书签（终点显示它起点的序号）。
  function build(start) {
    const words = norm(shelfSheet.query()).split(' ').filter(Boolean),
      ks = shelfSheet.kinds(),
      body = shelfSheet.body;
    marks = [];
    count = 0;
    // 类型按书签所在页的类型（媒体书签即所在的视频 / 音频）。
    const keep = (book, x) =>
      (!ks.size || ks.has(pageKind(book.pages[x.i] ?? { name: '' }))) &&
      (!words.length || ((h) => words.every((w) => h.includes(w)))(hayMark(book, x)));
    const list =
      words.length || ks.size
        ? groups
            .map(({ book, items }) => ({ book, items: items.filter((x) => keep(book, x)) }))
            .filter((g) => g.items.length)
        : groups;
    body.replaceChildren(
      ...list.map(({ book, items }) => {
        const sec = make('section', 'ov-sec' + (book === ctx.current ? ' current' : '')),
          head = make('div', 'ov-sec-head'),
          grid = make('div', 'ov-sec-grid');
        head.append(make('strong', '', ctx.title(book)), make('span', '', String(items.length)));
        sec.append(head, grid);
        for (const x of items) {
          count++;
          for (const end of x.bm.end ? [false, true] : [false]) {
            const node = item(book, x, end);
            node.dataset.k = marks.length;
            grid.append(node);
            marks.push({ book, x, node, end, n: count });
          }
        }
        return sec;
      }),
    );
    msel = Math.max(
      0,
      marks.findIndex((m) => !!start && m.x.bm.id === start.id && m.end === !!start.end && m.book === start.book),
    );
    shelfSheet.none(!marks.length);
  }
  function item(book, x, end) {
    const node = make('div', 'ov-item ov-mark' + (x.bm.end ? (end ? ' sec-end' : ' sec-start') : '')),
      img = make('img'),
      i = end ? x.e : x.i;
    img.alt = '';
    img.draggable = false;
    node.dataset.id = x.bm.id;
    if (end) node.dataset.end = '';
    if (end && !x.live) node.classList.add('off');
    node.setAttribute('role', 'option');
    label(node, book, x, end);
    img.onload = () => {
      node.dataset.r = Math.min(2.5, Math.max(0.4, img.naturalHeight / img.naturalWidth));
      if (masonry()) markSchedule();
    };
    node.append(img, make('span', 'ov-n', i >= 0 ? String(i + 1) : ''));
    // 画面（视频为书签时间点的画面，懒生成；音频为占位，有书的封面时以它作背景）、类型角标、区段标记、名称（bookmarks.mjs）。
    if (ctx.marks) ctx.marks.face(node, img, book, x, end);
    // 铅笔按钮：就地重命名（与 F2 相同）。
    node.append(ctx.iconButton('pencil', t('bmRename'), () => rename(node), 'bm-ren'));
    return node;
  }
  function label(node, book, x, end) {
    node.setAttribute(
      'aria-label',
      ctx.title(book) +
        ' · ' +
        (end
          ? t('secEnd') + ' · ' + (ctx.marks?.where(book, x, true) ?? fmt('bmPage', { n: x.e + 1 }))
          : (ctx.marks?.where(book, x) ?? fmt('bmPage', { n: x.i + 1 })) + (x.bm.end ? ' · ' + t('secStart') : '')),
    );
  }
  // 重命名选中的书签（F2 或铅笔按钮），改完后同一书签的两项都更新名称；焦点回到列表。
  function rename(node) {
    const m = marks[+node.dataset.k];
    if (!m || !ctx.marks) return;
    if (+node.dataset.k !== msel) mark(+node.dataset.k);
    ctx.marks.edit(node, m.book, m.x.bm, () => {
      for (const o of marks)
        if (o.x.bm === m.x.bm) {
          ctx.marks.named(o.node, o.book, o.x.bm);
          label(o.node, o.book, o.x, o.end);
        }
      if (shelfSheet.dialog.open) shelfSheet.scroller.focus({ preventScroll: true });
    });
  }
  shelfSheet.dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'F2' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !marks[msel]) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) rename(marks[msel].node);
  });
  // 书架关闭后回到下面的全屏界面：全屏书签按书架的最新状态（移动、删除、筛选）重排并保留选中，焦点回到列表。
  ctx.shelf.addEventListener('close', () => {
    if (ctx.shelf.open) return;
    const s = sheets.find((o) => o.live());
    if (!s) return;
    if (s === shelfSheet) {
      prefer = at(msel);
      s.reload();
    }
    if (s.live()) s.scroller.focus({ preventScroll: true });
  });
  function mark(i) {
    if (!marks.length) {
      shelfSheet.pos.textContent = '';
      return;
    }
    i = Math.max(0, Math.min(marks.length - 1, i));
    marks[msel]?.node.classList.remove('sel');
    marks[msel]?.node.setAttribute('aria-selected', 'false');
    msel = i;
    const m = marks[i];
    m.node.classList.add('sel');
    m.node.setAttribute('aria-selected', 'true');
    mate(m.node);
    shelfSheet.pos.textContent = shelfSheet.pos.title = fmt('bmN', { n: m.n, m: count }) + ' · ' + ctx.title(m.book);
  }
  function markLayout() {
    const m = masonry(),
      body = shelfSheet.body,
      gap = 4,
      def = 1 / Number(sm()?.ratio() || 0.75);
    body.classList.toggle('masonry', m);
    for (const list of body.querySelectorAll('.ov-sec-grid')) {
      const kids = [...list.children];
      if (!m) {
        list.style.height = '';
        for (const k of kids) k.style.cssText = '';
        continue;
      }
      const W = list.clientWidth,
        n = Math.max(1, Math.floor((W + gap) / (150 + gap))),
        w = (W - gap * (n - 1)) / n,
        hs = Array(n).fill(0);
      for (const k of kids) {
        let c = 0;
        for (let j = 1; j < n; j++) if (hs[j] < hs[c] - 0.5) c = j;
        const h = Math.round(w * (+k.dataset.r || def));
        Object.assign(k.style, { left: c * (w + gap) + 'px', top: hs[c] + 'px', width: w + 'px', height: h + 'px' });
        hs[c] += h + gap;
      }
      list.style.height = Math.max(0, ...hs) - gap + 'px';
    }
  }
  // 缩略图加载出真实比例后重排；键盘选中的项保持可见（读者自己滚动、悬停后不再干预）。
  function markSchedule() {
    if (!mframe)
      mframe = requestAnimationFrame(() => {
        mframe = 0;
        if (!shelfSheet.dialog.open) return;
        markLayout();
        if (mfollow) marks[msel]?.node.scrollIntoView({ block: 'nearest' });
      });
  }
  for (const type of ['wheel', 'pointerdown'])
    shelfSheet.scroller.addEventListener(
      type,
      () => {
        mfollow = false;
      },
      { passive: true },
    );
  new ResizeObserver(() => {
    if (shelfSheet.dialog.open && masonry()) markSchedule();
  }).observe(shelfSheet.scroller);
  // 上 / 下：网格里是方向上最近的一行中横向最近的一格；瀑布流优先同一列里最近的一格。Page Up / Down 先找距约一屏处最近的一行。
  // 一律按中心点比较：选中项以中心缩小（transform），中心不变，上沿却会下移，按上沿比会把同一行的邻居当成“上一行”。
  function near(d, far) {
    const cur = marks[msel]?.node.getBoundingClientRect();
    if (!cur) return msel;
    const rects = marks.map((m) => m.node.getBoundingClientRect()),
      cx = (r) => r.left + r.width / 2,
      cy = (r) => r.top + r.height / 2;
    const ahead = rects.map((r, i) => [r, i]).filter(([r]) => (d > 0 ? cy(r) > cy(cur) + 1 : cy(r) < cy(cur) - 1));
    if (!ahead.length) return msel;
    const target = cy(cur) + d * (far ? shelfSheet.scroller.clientHeight * 0.9 : 0);
    if (masonry()) {
      const same = ahead.filter(([r]) => Math.abs(cx(r) - cx(cur)) < cur.width / 2);
      if (same.length)
        return same.reduce((a, b) => (Math.abs(cy(b[0]) - target) < Math.abs(cy(a[0]) - target) ? b : a))[1];
    }
    const row = ahead.reduce(
      (best, [r]) => (Math.abs(cy(r) - target) < Math.abs(best - target) ? cy(r) : best),
      cy(ahead[0][0]),
    );
    return ahead
      .filter(([r]) => Math.abs(cy(r) - row) < 1)
      .reduce((a, b) => (Math.abs(cx(b[0]) - cx(cur)) < Math.abs(cx(a[0]) - cx(cur)) ? b : a))[1];
  }
  function pick(i) {
    const m = marks[i];
    if (!m || (m.end ? m.x.e : m.x.i) < 0) return;
    shelfSheet.close();
    sm()[m.end ? 'goEnd' : 'go'](m.book, m.x);
  }
  shelfSheet.body.addEventListener('click', (e) => {
    if (e.target.closest('.bm-ren,.bm-edit')) return;
    const node = e.target.closest('.ov-mark');
    if (node) pick(+node.dataset.k);
  });
  // 选中区段的起点或终点时，两项一起高亮（悬停即选中，见 overview-sheet.mjs）。
  const mate = (node) => {
    for (const o of shelfSheet.body.querySelectorAll('.ov-mark.mate')) o.classList.remove('mate');
    if (node.classList.contains('sec-start') || node.classList.contains('sec-end'))
      for (const o of shelfSheet.body.querySelectorAll('.ov-mark[data-id="' + CSS.escape(node.dataset.id) + '"]'))
        o.classList.add('mate');
  };
  return shelfSheet;
}
