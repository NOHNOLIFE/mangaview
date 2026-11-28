// 画中画面板里的播放列表（pipview.mjs 装配；数据与操作都是 ctx.media.queue 的同一份）：窗口右侧的一栏。
// - 显示：默认收起，鼠标靠近面板右缘（ctx.atEdge 的 EDGE，按面板的矩形算）停留片刻即浮在内容上弹出，移开收起；键盘聚焦列表或按 ↑ ↓ 时也弹出。
//   标题行的「播放列表」按钮固定打开 / 关闭（布局类偏好 'pipList'，默认不固定）：固定时停靠在右侧，内容区、标题行、操作面板相应变窄；
//   面板太窄（pipview.css 的容器查询）时固定也不停靠，按收起时的方式弹出。
// - 行：固定行高（ROW）的虚拟列表，只渲染可视范围（core/pip.mjs span）；列表跨多本书时每段同一本书的项前有一行书名小标题（listRows），也占一行。
//   每项：书签标记位（有书签显示书签图标，有区段书签时是区段配色；没有书签留空位）、类型图标、文件名（最末一段、不带扩展名）、
//   「定位」「移除」（只在悬停 / 选中的项上显示，位置固定）。当前曲目高亮，被过滤的项（.filtered）弱化但仍可读、可点。
// - 装好时滚到当前曲目，之后当前曲目变了且用户没在列表上悬停、刚滚动过时才跟过去。点击只播放（queue.play，主窗口不跳转）。
// - 悬停 / 键盘选中显示带缩略图的文件详情框（ctx.fileCard.within(窗口, {thumb})，放不下时退回 title）。
// playlist(ctx, {win, root, button, peeker}) → {side, relist(), paint(), reveal(center), track(), move(d), enter(), hover(e), lang(), destroy()}；
// button 为标题行的「播放列表」按钮（这里维护它的按下状态），peeker(类名, busy) 为 pipview.mjs 的浮出控制。
import { extend } from '../core/lang.mjs';
import { shownName, stem } from '../core/model.mjs';
import { span, centerTop, revealTop, listRows } from '../core/pip.mjs';
import { midName } from '../reader/view.mjs';

extend({
  pipRemove: ['Remove from the list', '从列表移除', 'リストから外す', '목록에서 제거'],
});
const ROW = 32, // 行高（与 piplist.css 一致）
  FOLLOW = 3000, // 手动滚动列表后这么久之内，当前曲目变了也不把列表滚过去
  PIN = 'pipList';

export function playlist(ctx, { win, root, button, peeker }) {
  const { t, make, icon } = ctx;
  const Q = () => ctx.media.queue;
  ctx.prefs.add(PIN);
  const side = make('div', 'pip-side'),
    list = make('div', 'pip-list'),
    rows = make('div', 'pip-rows');
  list.tabIndex = 0;
  list.setAttribute('role', 'listbox');
  list.append(rows);
  side.append(list);

  // ---- 固定 / 浮出
  let pinned = ctx.get(PIN, false) === true;
  const docked = () => pinned && win.getComputedStyle(side).position !== 'absolute';
  const peek = peeker('list-peek', () => side.matches(':hover') || side.matches(':focus-within'));
  function pin(on) {
    pinned = on;
    ctx.put(PIN, on);
    root.classList.toggle('list-pinned', on);
    button.setAttribute('aria-pressed', String(on));
    peek.want(false, 0);
    win.requestAnimationFrame(() => paintRows());
  }
  root.classList.toggle('list-pinned', pinned);
  button.setAttribute('aria-pressed', String(pinned));
  button.addEventListener('click', () => pin(!pinned));
  // 指针移动（pipview.mjs 在面板上转发）：靠近右缘或停在弹出的列表上时弹出，否则收起。
  function hover(e) {
    if (docked()) return;
    const s = side.getBoundingClientRect(),
      over = peek.shown() && e.clientX >= s.left && e.clientY >= s.top && e.clientY <= s.bottom;
    peek.want(over || ctx.atEdge('right', e, 0, root.getBoundingClientRect()));
  }
  side.addEventListener('focusin', () => docked() || peek.want(true, 0));
  side.addEventListener('focusout', () => queueMicrotask(() => peek.check()));

  // ---- 行
  let items = [],
    flat = [], // 行：{head: 书} | {item, i}
    at = [], // 第 i 项所在的行号
    sel = -1, // 选中项（悬停与键盘共用）
    hovering = false,
    scrolled = 0; // 用户上次滚动列表的时间
  const shown = new Map(); // 项的页对象 / 小标题的键 → 行元素
  const card = ctx.fileCard?.within?.(win, { thumb: true }) ?? null;
  function itemRow(it) {
    const r = make('div', 'pip-item'),
      full = shownName(it.page),
      n = midName(stem(full.slice(full.lastIndexOf('/') + 1))),
      mk = make('span', 'pip-mk');
    r.setAttribute('role', 'option');
    mk.setAttribute('aria-hidden', 'true');
    mk.append(icon('bookmark'));
    r.append(mk, icon(it.kind === 'audio' ? 'music' : 'film'), n);
    const locate = ctx.iconButton('locate', t('fbLocate'), () => Q().locate(r.item), 'pip-ib'),
      remove = ctx.iconButton('close', t('pipRemove'), () => Q().remove(r.item), 'pip-ib');
    for (const [b, id, label] of [
      [locate, 'locate', 'fbLocate'],
      [remove, 'remove', 'pipRemove'],
    ]) {
      b.dataset.id = id;
      b.dataset.label = label;
      b.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && e.preventDefault());
    }
    r.append(locate, remove);
    r.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      Q().play(r.item);
    });
    r._mk = mk;
    return r;
  }
  function headRow(book) {
    const r = make('div', 'pip-group'),
      s = make('span', '', ctx.title(book));
    r.setAttribute('role', 'presentation');
    s.title = ctx.title(book);
    r.append(s);
    return r;
  }
  function relist() {
    items = Q().items();
    ({ rows: flat, at } = listRows(items));
    const keep = new Set(items.map((it) => it.page));
    for (const [k, r] of shown)
      if (typeof k === 'string' || !keep.has(k)) {
        r.remove();
        shown.delete(k);
      }
    if (sel >= items.length) sel = items.length - 1;
    rows.style.height = flat.length * ROW + 'px';
    paintRows();
  }
  function paintRows() {
    const [from, to] = span(flat.length, ROW, list.scrollTop, list.clientHeight),
      used = new Set();
    for (let k = from; k < to; k++) {
      const row = flat[k];
      let r;
      if (row.head) {
        const key = 'h' + k + ':' + row.head.id;
        r = shown.get(key);
        if (!r) shown.set(key, (r = headRow(row.head)));
      } else {
        const it = row.item;
        r = shown.get(it.page);
        if (!r) shown.set(it.page, (r = itemRow(it)));
        r.item = it;
        r.dataset.i = String(row.i);
        r._mk.dataset.marks = it.marks;
        r.classList.toggle('current', it.current);
        r.classList.toggle('filtered', it.filtered);
        r.classList.toggle('sel', row.i === sel);
        r.setAttribute('aria-selected', String(it.current));
      }
      r.style.transform = 'translateY(' + k * ROW + 'px)';
      used.add(r);
      if (r.parentNode !== rows) rows.append(r);
    }
    for (const [k, r] of shown)
      if (!used.has(r)) {
        r.remove();
        shown.delete(k);
      }
    rows.classList.toggle('playing', Q().playing());
  }
  const currentIndex = () => items.findIndex((it) => it.current);
  function reveal(center) {
    const i = currentIndex();
    if (i < 0) return;
    const k = at[i];
    list.scrollTop = center
      ? centerTop(k, flat.length, ROW, list.clientHeight)
      : revealTop(k, ROW, list.scrollTop, list.clientHeight);
    paintRows();
  }
  function select(i, byKey) {
    if (!items.length) return;
    sel = Math.max(0, Math.min(items.length - 1, i));
    if (byKey) {
      // 选中项在小标题之下时连小标题一起露出。
      const k = at[sel],
        head = k > 0 && flat[k - 1].head ? k - 1 : k;
      list.scrollTop = revealTop(k, ROW, revealTop(head, ROW, list.scrollTop, list.clientHeight), list.clientHeight);
    }
    paintRows();
    const r = shown.get(items[sel].page);
    if (byKey && r && card) card.show(r, { book: items[sel].book, page: items[sel].page });
  }
  // 键盘（pipview.mjs 的按键）：↑ ↓ 移动选中项（收起时先弹出列表，一会儿没有操作再收起），Enter 播放它。
  function move(d) {
    if (!docked()) {
      peek.want(true, 0);
      peek.want(false, 2500);
    }
    const base = sel >= 0 ? sel : currentIndex();
    select(base < 0 ? (d > 0 ? 0 : items.length - 1) : base + d, true);
  }
  const enter = () => items[sel] && Q().play(items[sel]);
  let scrollFrame = 0;
  list.addEventListener('scroll', () => {
    if (!scrollFrame)
      scrollFrame = win.requestAnimationFrame(() => {
        scrollFrame = 0;
        paintRows();
      });
  });
  for (const type of ['wheel', 'pointerdown'])
    list.addEventListener(type, () => (scrolled = Date.now()), { passive: true });
  list.addEventListener('pointerover', (e) => {
    hovering = true;
    const r = e.target.closest?.('.pip-item');
    if (r && sel !== +r.dataset.i) select(+r.dataset.i, false);
  });
  list.addEventListener('pointerleave', () => (hovering = false));
  card?.attach(list, (el) => {
    const r = el.closest('.pip-item');
    return r?.item && list.contains(r) ? { el: r, book: r.item.book, page: r.item.page } : null;
  });
  const sizes = new win.ResizeObserver(() => paintRows());
  sizes.observe(list);

  // 当前曲目变了：列表跟过去（用户没在列表上悬停、刚滚动过时）。
  let lastTrack = Q().track()?.page ?? null;
  function track() {
    const now = Q().track()?.page ?? null;
    relist();
    if (now === lastTrack) return;
    lastTrack = now;
    if (!hovering && Date.now() - scrolled > FOLLOW) win.requestAnimationFrame(() => reveal(false));
  }
  // 行上按钮的文字随 pipview.mjs 的 labels()（data-label）更新。
  const lang = () => list.setAttribute('aria-label', t('pipList'));
  lang();
  return {
    side,
    relist,
    paint: paintRows,
    reveal,
    track,
    move,
    enter,
    hover,
    hide: () => peek.want(false),
    lang,
    destroy() {
      card?.hide();
      sizes.disconnect();
    },
  };
}
