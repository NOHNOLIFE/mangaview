import { imageJob, release } from './view.mjs';
import { pageKey } from './thumbs.mjs';
import { shownName, pageKind, cellRatio } from '../core/model.mjs';
import { sourceOf } from '../core/sources.mjs';
import { norm } from '../core/match.mjs';
// 全屏缩略图：整本书的页面排成规整网格或瀑布流，只为可见范围创建元素；书签角标与区段范围；按文件名搜索、按类型过滤。
// 网格：列宽不小于 MIN_COL；格子比例取本书已知页面比例的中位数（限制在 0.7 ~ 1.6），打开期间不变，图片加载不会挪动格子。
// 比格子高出 TALL 倍以上的长条页只显示顶部（裁切），其余按比例完整显示。
// 瀑布流：每张放进当前最短的一列，高度按页面比例，超长条最多 MAX_RATIO 倍列宽（只显示顶部）。
const GAP = 6,
  MIN_COL = 150,
  TALL = 1.6,
  MAX_RATIO = 3;
export function install(ctx, { sheet, masonry }) {
  const { fmt, make, main, view } = ctx;
  // ---- 全屏缩略图 ----
  // items：每页的位置 {x,y,w,h,c(列),r(列内序号),k(结果内序号),tall}，不符合搜索的页为 null；cols：每列的页序号；shown：符合搜索的页序号。
  // 网格与瀑布流共用这套数据，导航也就一致，且只在结果内移动。
  // pm：每页的书签标记（ctx.marks.pages），格子一角显示角标；spans：生效的区段，选中带起点或区段书签的页时标出区段覆盖的页（span）。
  let book = null,
    items = [],
    cols = [],
    shown = [],
    n = 2,
    ratio = 1.4,
    sel = 0,
    here = -1,
    frame = 0,
    dirty = false,
    follow = false,
    hays = [],
    pm = new Map(),
    spans = [],
    span = null,
    spanKey = '',
    keyed = false; // 这次选中来自键盘移动：选中后为它弹出文件详情框
  const nodes = new Map();
  const thumbs = sheet('overview', ['v', ']'], 'ov-grid', {
    find: 'ovFindPages',
    setup() {
      const b = ctx.current;
      if (!b?.pages.length) return false;
      book = b;
      thumbs.name.textContent = thumbs.name.title = ctx.title(b);
      here = view.position()?.i ?? 0;
      sel = here;
      ratio = cellRatio(b.pages);
      hays = [];
      pm = ctx.marks?.pages(b) ?? new Map();
      spans = ctx.marks?.spans(b) ?? [];
      return true;
    },
    show() {
      follow = false;
      layout();
      if (!items[sel]) sel = shown[0] ?? sel;
      const it = items[sel];
      sc.scrollTop = it ? it.y + it.h / 2 - sc.clientHeight / 2 : 0;
      thumbs.none(!shown.length);
      select(sel, false);
      paint();
    },
    move(act) {
      const it = items[sel];
      if (!it) return;
      keyed = true;
      select(
        {
          left: shown[it.k - 1] ?? sel,
          right: shown[it.k + 1] ?? sel,
          home: shown[0],
          end: shown.at(-1),
          up: vertical(-1),
          down: vertical(1),
          pageUp: vertical(-1, true),
          pageDown: vertical(1, true),
        }[act],
      );
      keyed = false;
    },
    hover(node) {
      const i = +node.dataset.i;
      if (i !== sel) {
        follow = false;
        select(i, false);
      }
      card(i);
    },
    relayout() {
      keep(layout);
      reveal(sel);
      schedule();
    },
    choose() {
      if (items[sel]) choose(sel);
    },
    // 搜索词变化：保留仍在结果里的选中项，否则选中第一个结果；清空后回到当前页。
    filter() {
      if (!book) return;
      const all = !thumbs.filtered();
      layout();
      thumbs.none(!shown.length);
      const to = all ? here : items[sel] ? sel : shown[0];
      if (items[to]) {
        if (all) {
          const it = items[to];
          sc.scrollTop = it.y + it.h / 2 - sc.clientHeight / 2;
          select(to, false);
        } else {
          if (to !== sel) sc.scrollTop = 0;
          select(to);
        }
      }
      paint();
    },
    cleanup() {
      ctx.fileCard?.hide();
      for (const i of [...nodes.keys()]) drop(i);
      items = [];
      cols = [];
      shown = [];
      hays = [];
      book = null;
      span = null;
      spanKey = '';
    },
  });
  // 搜索：文件名（合并作品含卷的文件夹名和路径），多个词须都出现。
  const terms = (s) => norm(s).split(' ').filter(Boolean);
  function hayOf(i) {
    const p = book.pages[i],
      s = sourceOf(book, p);
    return (hays[i] ??= norm([shownName(p), s?.key ? (s.title ?? '') : '', s?.key ? (s.path ?? '') : ''].join(' ')));
  }
  const sc = thumbs.scroller,
    grid = thumbs.body;
  function layout() {
    const pages = book?.pages || [],
      W = sc.clientWidth,
      m = masonry(),
      words = terms(thumbs.query()),
      ks = thumbs.kinds();
    n = Math.max(2, Math.floor((W - GAP) / (MIN_COL + GAP)));
    const w = (W - GAP * (n + 1)) / n,
      gh = Math.round(w * ratio),
      heights = Array(n).fill(GAP);
    cols = Array.from({ length: n }, () => []);
    shown = [];
    items = pages.map((p, i) => {
      if ((ks.size && !ks.has(pageKind(p))) || (words.length && !words.every((x) => hayOf(i).includes(x)))) return null;
      const k = shown.length;
      shown.push(i);
      let c = k % n;
      if (m) {
        c = 0;
        for (let j = 1; j < n; j++) if (heights[j] < heights[c] - 0.5) c = j;
      }
      const pr = (p.h || 1120) / (p.w || 800),
        h = m ? Math.round(w * Math.min(MAX_RATIO, pr)) : gh;
      const it = {
        x: GAP + c * (w + GAP),
        y: m ? heights[c] : GAP + Math.floor(k / n) * (gh + GAP),
        w,
        h,
        c,
        r: cols[c].length,
        k,
        tall: !!p.w && pr > (m ? MAX_RATIO : ratio * TALL),
      };
      heights[c] = it.y + h + GAP;
      cols[c].push(i);
      return it;
    });
    grid.style.height = Math.max(...heights) + 'px';
    for (const [i, node] of nodes) place(node, i);
  }
  function place(node, i) {
    const it = items[i];
    if (!it) return;
    Object.assign(node.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' });
    node.classList.toggle('tall', it.tall);
  }
  function drop(i) {
    const node = nodes.get(i);
    release(node.firstChild);
    node.remove();
    nodes.delete(i);
  }
  function paint() {
    if (!book) return;
    const top = sc.scrollTop,
      H = sc.clientHeight,
      lo = top - H * 0.5,
      hi = top + H * 1.5,
      b = book;
    for (const i of [...nodes.keys()]) {
      const it = items[i];
      if (!it || it.y + it.h < lo || it.y > hi) drop(i);
    }
    items.forEach((it, i) => {
      if (!it || it.y + it.h < lo || it.y > hi) return;
      const visible = it.y + it.h >= top && it.y <= top + H,
        page = b.pages[i];
      let node = nodes.get(i);
      if (!node) {
        node = make('div', 'ov-item');
        node.dataset.i = i;
        node.setAttribute('role', 'option');
        if (pageKind(page) === 'image') node.title = shownName(page); // 视频、音频显示文件详情框

        node.append(make('div', 'ov-img'), make('span', 'ov-n', String(i + 1)));
        node.classList.toggle('sel', i === sel);
        node.classList.toggle('here', i === here);
        node.setAttribute('aria-selected', String(i === sel));
        badge(node, i);
        inSpan(node, i);
        place(node, i);
        grid.append(node);
        nodes.set(i, node);
      }
      // 已在队列里的只更新优先级（imageJob 对同一个槽位不会重复读取）；缓存命中时立即显示。
      // 视频、音频：固定样式的占位（media.mjs）；视频叠上真实画面（ctx.frames，持久化，只为可见项生成），音频不读文件。
      const kind = pageKind(page);
      if (kind !== 'image') {
        if (!node.firstChild.firstChild) node.firstChild.append(ctx.mediaTile(page));
        if (kind === 'video') ctx.frames?.show(node.firstChild, b, page, visible);
        return;
      }
      imageJob(
        node.firstChild,
        () => view.hooks.file(b, page),
        visible ? 1 : 3,
        true,
        (w, h) => {
          if (page.w !== w || page.h !== h) {
            page.w = w;
            page.h = h;
            dirty = true;
            schedule();
          }
        },
        () => node.classList.add('failed'),
        pageKey(b, page),
      );
    });
  }
  const keep = (fn) => {
    const it = items[sel],
      off = it ? it.y - sc.scrollTop : 0;
    fn();
    if (it && items[sel]) sc.scrollTop = items[sel].y - off;
  };
  // 解码后补齐的真实尺寸：总览按选中项保持位置重排（网格的格子不变，只更新长条标记），正文也一起重排（与 view.mjs 自己测量时一致）。
  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!thumbs.dialog.open) return;
        if (dirty) {
          dirty = false;
          keep(layout);
          if (follow) reveal(sel);
          view.layout();
          view.hooks.measured();
        }
        paint();
      });
  }
  // 用键盘选中后，补齐尺寸的重排仍保证选中项完整可见；读者自己滚动后不再干预。
  for (const type of ['wheel', 'pointerdown'])
    sc.addEventListener(
      type,
      () => {
        follow = false;
      },
      { passive: true },
    );
  sc.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(() => {
    if (thumbs.dialog.open && book) {
      keep(layout);
      if (follow) reveal(sel);
      schedule();
    }
  }).observe(sc);
  // 书签角标：只在内容变化时替换（ctx.on('marks')）。
  function badge(node, i) {
    const m = pm.get(i),
      k = m ? ctx.marks.sig(m) : '';
    if (node._mk === k) return;
    node._mk = k;
    node.querySelector(':scope>.mk')?.remove();
    if (m) node.append(ctx.marks.badge(m));
  }
  // 区段范围：选中（悬停或键盘聚焦）带起点或区段书签的页时，标出这些区段覆盖的所有页（in-sec，两端 sec-a / sec-b）；移到别的页即消失。
  // 每个区段一圈描边（.ov-ring），嵌套的按层级（ctx.marks.spans 的 lv，最多 3 级）向内缩进一级。叠加层，不改变排布。
  // span：选中页上起止的区段 [{id,a,b,lv}]，没有为 null。
  function inSpan(node, i) {
    const hit = span ? span.filter((s) => i >= s.a && i <= s.b) : [],
      rings = new Map(); // 层级 → 是否为端点（同一层只画一圈）
    for (const s of hit) rings.set(s.lv, rings.get(s.lv) || i === s.a || i === s.b);
    const k = [...rings].join();
    if (node._sec === k) return;
    node._sec = k;
    node.classList.toggle('in-sec', hit.length > 0);
    node.classList.toggle(
      'sec-a',
      hit.some((s) => i === s.a),
    );
    node.classList.toggle(
      'sec-b',
      hit.some((s) => i === s.b),
    );
    for (const r of node.querySelectorAll(':scope>.ov-ring')) r.remove();
    for (const [lv, end] of rings) {
      const r = make('i', 'ov-ring' + (end ? ' end' : ''));
      r.style.setProperty('--lv', lv);
      node.append(r);
    }
  }
  function showSpan(i) {
    const next = spans.filter((s) => s.a === i || s.b === i),
      k = next.map((s) => s.id + ':' + s.lv).join();
    if (k === spanKey) return;
    spanKey = k;
    span = next.length ? next : null;
    for (const [j, node] of nodes) inSpan(node, j);
  }
  ctx.on('marks', (b) => {
    if (!thumbs.dialog.open || b !== book) return;
    pm = ctx.marks.pages(b);
    spans = ctx.marks.spans(b);
    for (const [i, node] of nodes) badge(node, i);
    spanKey = null;
    showSpan(sel);
  });
  function select(i, scroll = true) {
    if (!items[i]) return;
    const old = nodes.get(sel);
    old?.classList.remove('sel');
    old?.setAttribute('aria-selected', 'false');
    sel = i;
    nodes.get(sel)?.classList.add('sel');
    nodes.get(sel)?.setAttribute('aria-selected', 'true');
    thumbs.pos.textContent = fmt('ovPos', { n: i + 1, m: items.length });
    showSpan(i);
    if (scroll) {
      follow = true;
      reveal(i);
      schedule();
    }
    if (keyed) {
      keyed = false;
      paint(); // 键盘移到的格子可能刚滚进来，先建出元素
      card(i);
    }
  }
  // 文件详情框：选中（悬停或键盘移动）的是视频、音频时弹出，其余收起；指针离开列表时收起。
  function card(i) {
    const node = nodes.get(i),
      page = book?.pages[i];
    if (node && page && pageKind(page) !== 'image') ctx.fileCard?.show(node, { book, page });
    else ctx.fileCard?.hide();
  }
  grid.addEventListener('pointerleave', () => ctx.fileCard?.hide());
  function reveal(i) {
    const it = items[i];
    if (!it) return;
    const top = sc.scrollTop,
      H = sc.clientHeight;
    if (it.y < top + GAP || it.h > H - 2 * GAP) sc.scrollTop = it.y - GAP;
    else if (it.y + it.h > top + H - GAP) sc.scrollTop = it.y + it.h - H + GAP;
  }
  // 上下在同一列里移动（网格即上 / 下一行）；网格末行较短、本列下面没有格子时停在最后一张。Page Up / Down 在同一列跳过约一屏。
  function vertical(d, far) {
    const it = items[sel],
      col = cols[it.c];
    if (!far) {
      const to = col[it.r + d];
      if (to != null) return to;
      return d > 0 && !masonry() && Math.floor(it.k / n) < Math.floor((shown.length - 1) / n) ? shown.at(-1) : sel;
    }
    const target = it.y + d * sc.clientHeight * 0.9;
    let k = it.r;
    while (col[k + d] != null && (d > 0 ? items[col[k]].y < target : items[col[k]].y > target)) k += d;
    return col[k];
  }
  // 跳过去：图片停在该页的上沿；视频、音频把该文件放到阅读区中央（不选中、不播放）。
  function choose(i) {
    const b = book,
      s = view.panes[0].starts;
    thumbs.close();
    if (b && ctx.current === b && s.length === b.pages.length + 1) {
      view.browsing = false;
      if (pageKind(b.pages[i]) !== 'image') view.jump({ i, f: 0.5 });
      else main.scrollTop = s[i];
    }
  }
  grid.addEventListener('click', (e) => {
    const node = e.target.closest('.ov-item');
    if (node) choose(+node.dataset.i);
  });
  ctx.on('select', () => {
    if (thumbs.live() && ctx.current !== book) thumbs.reload();
  });
  return thumbs;
}
