// 书架的批量操作：「全部」菜单（复制书名、全部移到书架 / 书库、清空书架 / 书库、全部恢复、删除全部过期书）与移动书籍。
import { $, anchor } from './util.mjs';

export function install(ctx, S) {
  const { books, t, fmt, notice, make, icon, safe } = ctx;
  const draw = (...a) => S.draw(...a);
  const inView = (...a) => S.inView(...a);
  const restoreBatch = (...a) => S.restoreBatch(...a);
  async function move(list, place) {
    // 分批并发写入：数千本时不逐本串行等待。
    for (let i = 0; i < list.length; i += 200)
      await Promise.all(
        list.slice(i, i + 200).map((b) => {
          b.place = place;
          return ctx.persist(b);
        }),
      );
    notice(null, fmt(place === 'shelf' ? 'movedShelfN' : 'movedLibraryN', { n: list.length }));
    draw();
    ctx.emit('books');
  }
  async function clearPlace(place) {
    const list = [...books.values()].filter((b) => inView(b, place));
    if (
      !list.length ||
      !confirm(fmt(place === 'shelf' ? 'confirmClearShelf' : 'confirmClearLibrary', { n: list.length }))
    )
      return;
    for (const b of list) if (books.has(b.id)) await ctx.discard(b);
    notice(null, fmt('clearedN', { n: list.length }));
    draw();
    ctx.emit('books');
  }
  async function removeAll(list) {
    if (!confirm(fmt('confirmRemoveAll', { n: list.length }))) return;
    for (const b of list) if (books.has(b.id)) await ctx.discard(b);
    draw();
    ctx.emit('books');
  }
  function drawBulk(counts) {
    const acts = $('bulkActions'),
      list = S.shown;
    acts.replaceChildren();
    const btn = (name, label, fn, cls = '') => {
      const el = make('button', cls);
      el.type = 'button';
      el.append(icon(name), make('span', '', label));
      el.onclick = safe(async () => {
        if ($('bulkPop').matches(':popover-open')) $('bulkPop').hidePopover();
        await fn();
      });
      return el;
    };
    if (list.length) acts.append(btn('copy', t('copy'), () => ctx.actions.copy()));
    if (S.view === 'expired') {
      acts.append(btn('link', t('restoreAll'), restoreBatch));
      if (list.length) acts.append(btn('trash', fmt('removeAll', { n: list.length }), () => removeAll(list), 'danger'));
    } else {
      const toShelf = list.filter((b) => b.place !== 'shelf'),
        toLib = list.filter((b) => b.place !== 'library');
      if (toShelf.length)
        acts.append(btn('library', fmt('allToShelf', { n: toShelf.length }), () => move(toShelf, 'shelf')));
      if (toLib.length)
        acts.append(btn('archive', fmt('allToLibrary', { n: toLib.length }), () => move(toLib, 'library')));
      // 清空：书架 / 书库整个列表（不受搜索和筛选影响），确认后删除记录。
      const place = S.view,
        whole = place === 'all' ? 0 : counts[place];
      if (whole)
        acts.append(
          btn(
            'trash',
            fmt(place === 'shelf' ? 'clearShelf' : 'clearLibrary', { n: whole }),
            () => clearPlace(place),
            'danger',
          ),
        );
    }
    $('bulkBtn').disabled = !acts.childElementCount;
  }
  anchor($('bulkPop'), $('bulkBtn'), true);
  S.move = move;
  S.drawBulk = drawBulk;
}
