// 最近书签的规则，纯函数，不碰界面和存储（tests/core/recent.test.mjs 覆盖）。书签面板、书架书签列表、全屏书架书签打开时的选中项共用。
// 把书签排成一条线：阅读列表里书的顺序 → 页序 → 页内位置（图片按页内位置，视频、音频按时间）；区段的起点和终点（区段书签）各算一项。
// 最近书签 = 当前阅读位置之前（含正好在这里）最近的一项，后面的不参与；本书前面没有时取列表里前面最近一本有书签的书的最后一项，都没有则为 null。
const spot = (m) => (Number.isFinite(m?.t) ? m.t : m?.f);

// 一本书的线：items 为 marks/list.mjs 的 list 结果（按起点排序），返回 [{id, end, i, v}]，按 (i, v) 排序；
// end：这一项是区段书签（终点）；i：所在的页序号；v：页内位置或时间（秒）。所在页已不存在的项不算。
export function line(items) {
  const out = [];
  for (const x of items) {
    if (x.i >= 0) out.push({ id: x.bm.id, end: false, i: x.i, v: spot(x.bm) });
    if (x.bm.end && x.e >= 0) out.push({ id: x.bm.id, end: true, i: x.e, v: spot(x.bm.end) });
  }
  return out.sort((p, q) => p.i - q.i || p.v - q.v);
}

// 这一项是否在阅读位置 here = {i, v} 之前（含正好在这里）。here.v 由调用方算好容差：图片为视窗中线的页内位置加上几像素，
// 媒体页为当前播放时间加半秒；单文件模式下这一页上的都算（Infinity）。
export const before = (e, here) => e.i < here.i || (e.i === here.i && e.v <= here.v);

// books：阅读列表（书的顺序，可以只有当前书）；cur：当前书；entries(book)：这本书的线（line）；here：当前书里的阅读位置。
// 返回 {book, id, end}；当前书不在 books 里时只看当前书。
export function recent(books, cur, entries, here) {
  const own = entries(cur).findLast((e) => before(e, here));
  if (own) return { book: cur, id: own.id, end: own.end };
  for (let k = books.indexOf(cur) - 1; k >= 0; k--) {
    const last = entries(books[k]).at(-1);
    if (last) return { book: books[k], id: last.id, end: last.end };
  }
  return null;
}
