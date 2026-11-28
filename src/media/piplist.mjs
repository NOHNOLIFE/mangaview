// 画中画面板里的播放列表（pipview.mjs 装配；数据与操作都是 ctx.media.queue 的同一份）：窗口右侧的一栏。
// - 显示：不固定时收起，鼠标靠近面板右缘（ctx.atEdge 的 EDGE，按面板的矩形算）停留片刻即浮在内容上淡入，移开稍等淡出；键盘聚焦列表或按 ↑ ↓ 时也浮出。
//   指针在功能栏所在的高度范围内（面板下部，不论功能栏是否已浮出）时靠近右缘不触发（保证功能栏最右的按钮点得到）；列表已浮出、指针在列表上时不受此限。
//   标题行的「固定」（pipview.mjs，根元素的 .pinned）固定时停靠在右侧（固定宽度 core/pip.mjs SIDE），内容区、标题行、操作面板相应变窄；
//   面板太窄（DOCK_MIN，piplist.css 的容器查询）时固定也不停靠，按收起时的方式浮出。
// - 「已完全显示」：.pip-side 上的 .revealed——停靠时始终成立；浮出时淡入结束（transitionend，或超时兜底）才加上，开始收起即去掉。
//   文件详情框据此判断列表里的项能不能弹详情框（淡入完成之前不弹）。
// - 行：固定行高（ROW）的虚拟列表，只渲染可视范围（core/pip.mjs span）；列表跨多本书时每段同一本书的项前有一行书名小标题（listRows），也占一行。
//   每项：书签标记位（与缩略图的书签角标同一画法 ctx.marks.badge：书签图标，多于一个带数量，有区段书签时区段配色；没有书签留空位，各行对齐）、
//   类型图标、文件名（最末一段、不带扩展名，占满到行尾）；「定位」「移除」叠在行的右端（不占文件名的宽度），只在悬停 / 选中 / 聚焦的项上显示，
//   带与该行底色一致的底（左侧渐变过渡）。当前曲目高亮，被过滤的项（.filtered）弱化但仍可读、可点。
// - 装好时滚到当前曲目，之后当前曲目变了且用户没在列表上悬停、刚滚动过时才跟过去。点击只播放（queue.play，主窗口不跳转）。
// - 悬停 / 键盘选中显示带缩略图的文件详情框（ctx.fileCard.within(窗口, {thumb})，放不下时退回 title）。
// playlist(ctx, {win, root, peeker}) → {side, relist(), paint(), reveal(center), track(), move(d), enter(), hover(e, band), hide(), pin(), lang(), destroy()}；
// peeker(类名, busy, changed) 为 pipview.mjs 的浮出控制；pin() 在「固定」切换后调用；hover 的 band 为指针在功能栏的高度范围内。
import { extend } from '../core/lang.mjs';
import { shownName, stem } from '../core/model.mjs';
import { span, centerTop, revealTop, listRows } from '../core/pip.mjs';
import { midName } from '../reader/view.mjs';

extend({
  pipLocate: ['Locate', '定位', '場所へ移動', '위치로 이동'],
  pipRemove: ['Remove from the list', '从列表移除', 'リストから外す', '목록에서 제거'],
});
const ROW = 32, // 行高（与 piplist.css 一致）
  FOLLOW = 3000, // 手动滚动列表后这么久之内，当前曲目变了也不把列表滚过去
  SHOWN = 260; // 浮出后最晚这么久算作已完全显示（淡入的 transitionend 没来时的兜底，比 piplist.css 的淡入长）

export function playlist(ctx, { win, root, peeker }) {
  const { t, make, icon } = ctx;
  const Q = () => ctx.media.queue;
  const side = make('div', 'pip-side'),
    list = make('div', 'pip-list'),
    rows = make('div', 'pip-rows');
  list.tabIndex = 0;
  list.setAttribute('role', 'listbox');
  list.append(rows);
  side.append(list);

  // ---- 停靠 / 浮出
  const docked = () => root.classList.contains('pinned') && win.getComputedStyle(side).position !== 'absolute';
  const peek = peeker('list-peek', () => side.matches(':hover') || side.matches(':focus-within'), settle);
  // 「已完全显示」（.revealed）：停靠时立即成立；浮出时等淡入结束，收起时立即去掉。
  let shownTimer = 0;
  function settle() {
    clearTimeout(shownTimer);
    shownTimer = 0;
    if (docked()) return side.classList.add('revealed');
    side.classList.remove('revealed');
    if (peek.shown()) shownTimer = setTimeout(revealed, SHOWN);
  }
  function revealed() {
    clearTimeout(shownTimer);
    shownTimer = 0;
    if (peek.shown() || docked()) side.classList.add('revealed');
  }
  side.addEventListener('transitionend', (e) => {
    if (e.target === side && e.propertyName === 'opacity' && peek.shown()) revealed();
  });
  // 「固定」切换之后（pipview.mjs）：收起浮出的状态，按新的布局重画。
  function pin() {
    peek.want(false, 0);
    settle();
    win.requestAnimationFrame(() => paintRows());
  }
  // 指针移动（pipview.mjs 在面板上转发）：靠近右缘或停在浮出的列表上时浮出，否则收起；band（指针在功能栏的高度范围内）时右缘不触发。
  function hover(e, band = false) {
    if (docked()) return;
    const s = side.getBoundingClientRect(),
      over = peek.shown() && e.clientX >= s.left && e.clientY >= s.top && e.clientY <= s.bottom;
    peek.want(over || (!band && ctx.atEdge('right', e, 0, root.getBoundingClientRect())));
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
      mk = make('span', 'pip-mk'),
      acts = make('span', 'pip-acts');
    r.setAttribute('role', 'option');
    mk.setAttribute('aria-hidden', 'true');
    r.append(mk, icon(it.kind === 'audio' ? 'music' : 'film'), n);
    const locate = ctx.iconButton('locate', t('pipLocate'), () => Q().locate(r.item), 'pip-ib'),
      remove = ctx.iconButton('close', t('pipRemove'), () => Q().remove(r.item), 'pip-ib');
    for (const [b, id, label] of [
      [locate, 'locate', 'pipLocate'],
      [remove, 'remove', 'pipRemove'],
    ]) {
      b.dataset.id = id;
      b.dataset.label = label;
      b.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && e.preventDefault());
    }
    acts.append(locate, remove);
    r.append(acts);
    r.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      Q().play(r.item);
    });
    r._mk = mk;
    return r;
  }
  // 书签标记位：缩略图的书签角标（ctx.marks.badge），书签情况变了才重建。
  function marks(slot, it) {
    const k = it.marks + ':' + it.count;
    if (slot.dataset.marks === k) return;
    slot.dataset.marks = k;
    slot.replaceChildren();
    if (it.marks !== 'none' && ctx.marks?.badge)
      slot.append(ctx.marks.badge({ n: it.count, start: it.marks === 'section' }));
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
        marks(r._mk, it);
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
  const sizes = new win.ResizeObserver(() => {
    paintRows();
    if (docked() !== side.classList.contains('revealed') && !peek.shown()) settle();
  });
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
  settle();
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
    pin,
    lang,
    destroy() {
      clearTimeout(shownTimer);
      card?.hide();
      sizes.disconnect();
    },
  };
}
