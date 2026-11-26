// 书架排序：书架、书库、所有书籍共用的书籍排序（ctx.orderBooks）、排序菜单，以及按文件夹时间排序时在后台补算文件夹时间。
import { natural } from '../core/model.mjs';
import { readMissingTimes } from '../core/sources.mjs';
import { extend } from '../core/lang.mjs';
import { $, anchor } from './util.mjs';

extend({
  sortNow: ['Sort: {s}', '排序：{s}', '並べ替え：{s}', '정렬: {s}'],
});
// S：书架各子模块共享的状态与函数（见 shelf.mjs）。
export function install(ctx, S) {
  const { books, t, fmt, make, icon, get, put, shelf } = ctx;
  const draw = (...a) => S.draw(...a);
  const queue = (...a) => S.queue(...a);
  // ---- 书籍排序：书架、书库、所有书籍共用一个设置，上一本 / 下一本和书架书签列表也按此顺序（ctx.orderBooks）。
  // 文件夹时间：浏览器读不到文件夹本身的修改时间，用其中最新一张图片的修改时间代替；未知的排在最后。
  const SORTS = ['addedNew', 'addedOld', 'folderNew', 'folderOld', 'nameAsc', 'nameDesc'];
  let sortBy = get('shelfSort', 'addedNew');
  if (!SORTS.includes(sortBy)) sortBy = 'addedNew';
  const byName = (a, b) => natural(ctx.title(a), ctx.title(b));
  const byNumber = (key, dir) => (a, b) => {
    const ka = Number.isFinite(a[key]),
      kb = Number.isFinite(b[key]);
    return ka !== kb ? (ka ? -1 : 1) : ka && a[key] !== b[key] ? dir * (a[key] - b[key]) : byName(a, b);
  };
  const compare = {
    addedNew: byNumber('added', -1),
    addedOld: byNumber('added', 1),
    folderNew: byNumber('folderTime', -1),
    folderOld: byNumber('folderTime', 1),
    nameAsc: byName,
    nameDesc: (a, b) => byName(b, a),
  };
  const byTitle = (list) => list.sort(compare[sortBy]);
  ctx.orderBooks = byTitle;
  // 排序菜单：与预设菜单同样的弹出层；按钮只显示图标，当前排序写在提示文字里。
  const sortLabel = {
      addedNew: 'bsAddedNew',
      addedOld: 'bsAddedOld',
      folderNew: 'bsFolderNew',
      folderOld: 'bsFolderOld',
      nameAsc: 'bsNameAsc',
      nameDesc: 'bsNameDesc',
    },
    sortBtn = $('sortBtn'),
    sortPop = $('sortPop');
  function setSort(v) {
    if (!SORTS.includes(v) || v === sortBy) return;
    sortBy = v;
    put('shelfSort', sortBy);
    draw('sort');
    ctx.emit('books');
    sweepTimes();
  }
  function drawSortBtn() {
    sortBtn.title = fmt('sortNow', { s: t(sortLabel[sortBy]) });
    sortBtn.setAttribute('aria-label', sortBtn.title);
    sortBtn.dataset.sort = sortBy;
  }
  function drawSortPop() {
    sortPop.replaceChildren(
      ...SORTS.map((v) => {
        const b = make('button', 'sp-item');
        b.type = 'button';
        b.dataset.sort = v;
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', String(v === sortBy));
        b.append(icon('check'), make('span', '', t(sortLabel[v])));
        b.onclick = () => {
          sortPop.hidePopover();
          sortBtn.focus();
          setSort(v);
        };
        return b;
      }),
    );
  }
  sortPop.addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') drawSortPop();
  });
  sortPop.addEventListener('toggle', (e) => {
    if (e.newState === 'open') sortPop.querySelector('[aria-checked=true]')?.focus({ preventScroll: true });
  });
  sortPop.addEventListener('keydown', (e) => {
    const items = [...sortPop.querySelectorAll('button')],
      i = items.indexOf(document.activeElement),
      n = items.length;
    const j = { ArrowDown: (i + 1) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (j == null) return;
    e.preventDefault();
    items[j].focus();
  });
  // 按文件夹时间排序时才计算（只读文件元数据，串行，不与阅读抢硬盘）；算出新值后刷新列表。
  let timing = false,
    retime = false;
  async function sweepTimes() {
    if (!sortBy.startsWith('folder')) return;
    if (timing) {
      retime = true;
      return;
    }
    timing = true;
    retime = false;
    let changed = false,
      drawn = Date.now();
    const refresh = () => {
      changed = false;
      drawn = Date.now();
      if (shelf.open) draw();
      ctx.emit('books');
    };
    try {
      for (const b of [...books.values()]) {
        if (Number.isFinite(b.folderTime) || ctx.expired(b) || !books.has(b.id)) continue;
        await ctx.disk.turn(); // 多个窗口时只由持有后台磁盘任务的窗口读盘，且只在窗口可见时（app.mjs / windows.mjs）
        if (Number.isFinite(b.folderTime) || !books.has(b.id)) continue; // 等待期间别的窗口已经算好
        await queue(async () => {
          await readMissingTimes(b, () => books.has(b.id));
          if (!books.has(b.id)) return;
          let t = -Infinity;
          for (const p of b.pages) if (Number.isFinite(p.lastModified) && p.lastModified > t) t = p.lastModified;
          if (t > -Infinity) {
            b.folderTime = t;
            await ctx.persist(b);
            changed = true;
          }
        });
        if (changed && Date.now() - drawn > 1000) refresh();
      }
    } finally {
      timing = false;
      if (changed) refresh();
      if (retime) setTimeout(sweepTimes, 800);
    }
  }
  setTimeout(sweepTimes, 1500);
  ctx.on('books', () => setTimeout(sweepTimes, 800));
  S.byTitle = byTitle;
  S.drawSortBtn = drawSortBtn;
  anchor(sortPop, sortBtn, true);
}
