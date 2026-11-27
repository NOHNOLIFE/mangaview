// 阅读列表的纯规则（reader/session.mjs 调用，tests/core/reading.test.mjs 覆盖）。
// 阅读列表 = 书架页当前选中的页签（书架 / 书库 / 全部；选中「过期书籍」时沿用之前选中的页签）里、符合书架页筛选条件的书，按「书籍排序」排列，
// 过期书不在其中。上一本 / 下一本、跨书运行、书签快捷键跨书、书架书签列表、删除当前书后切到哪本都按它。
// order：按书籍排序排好一组书（ctx.orderBooks），用来确定不在列表里的书“按排序应在的位置”。
export const LISTS = ['shelf', 'library', 'all'];
// 页签 view 对应的列表；last：之前选中的书架 / 书库 / 全部页签。
export const listOf = (view, last = 'shelf') => (LISTS.includes(view) ? view : LISTS.includes(last) ? last : 'shelf');
// 书是否在列表 list 的范围里（与书架页各页签显示的书一致，过期另判）。
export const inList = (book, list) => list === 'all' || book.place === list;
// 上一本 / 下一本（d = -1 / 1），首尾循环；没有当前书时从列表的头 / 尾开始。
// 当前书不在列表里（被筛选掉、在别的页签里）：从它按排序应在的位置走到最近的一本。列表为空时为 null。
export function stepBook(list, cur, d, order = (l) => l) {
  if (!list.length) return null;
  const i = cur ? list.indexOf(cur) : -1;
  if (i >= 0) return list[(i + d + list.length) % list.length];
  if (!cur) return d < 0 ? list.at(-1) : list[0];
  const all = order([...list, cur]),
    k = all.indexOf(cur);
  return all[(k + d + all.length) % all.length];
}
// 删除当前书 book 后切到哪本：列表里原顺序的下一本，没有则上一本；gone 为一起删除的书（批量删除），都跳过；都没有时为 null（列表空了）。
// book 不在列表里时按它应在的位置找前后。list 是删除前的阅读列表。
export function successor(list, book, order = (l) => l, gone = new Set([book])) {
  const all = list.includes(book) ? list : order([...list, book]),
    i = all.indexOf(book);
  for (let j = i + 1; j < all.length; j++) if (!gone.has(all[j]) && all[j] !== book) return all[j];
  for (let j = i - 1; j >= 0; j--) if (!gone.has(all[j]) && all[j] !== book) return all[j];
  return null;
}
