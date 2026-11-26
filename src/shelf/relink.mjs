// 把书的源接到文件夹上（导入、刷新、恢复共用）：link / relink / relinkAll，
// 合并作品的查找（findMerged，按句柄或相对路径）与按新的扫描结果重建（rebuild）。
import {
  timed,
  applyNames,
  pairFrom,
  reconnect,
  addLoose,
  settle,
  isMerged,
  keyOf,
  makePage,
} from '../core/sources.mjs';
import { emit } from '../core/events.mjs';
import { books } from '../core/books.mjs';
import { forgetPages } from '../reader/thumbs.mjs';
import { current, here } from '../reader/session.mjs';
import { arrange } from '../reader/sort.mjs';
export const sameDir = async (a, b) =>
  !!a?.isSameEntry && !!b && (a === b || (await timed(a, () => a.isSameEntry(b)).catch(() => false)));
// 把书的一个源接到（新的）文件夹上：保留仍存在的页面及其尺寸，追加新图，去掉已不存在的图。
// links：[{cand,source}]，同一本书的多个源一次处理完再排序保存。
function link(book, cand, s) {
  applyNames(
    book,
    s,
    cand.pages.map((p) => p.name),
    true,
  );
  if (cand.dir) pairFrom(book, s, cand.pages); // PotPlayer 书签（.pbf）的配对，扫描时已按文件名得出（sources.mjs）
  if (!cand.dir) reconnect(book, cand, s); // 回退模式（无目录句柄）：页面绑定到本次会话选中的文件
  s.dir = cand.dir;
  s.title = cand.title;
  if (cand.path) s.path = cand.path;
  delete s.missing;
  if (!s.key) {
    book.title = cand.title;
    if (cand.path) book.path = cand.path;
  }
}
export async function relink(book, cand, s = book.sources[0]) {
  return relinkAll(book, [{ cand, source: s }]);
}
// 接到别的文件夹后同名文件可能是不同的图：丢弃这本书在内存里的页面小图（thumbs.mjs），下次显示时重新生成。
export async function relinkAll(book, links) {
  const before = book === current ? here() : null;
  forgetPages(book.id + ':');
  for (const { cand, source: s } of links) {
    if (cand.dir && s) link(book, cand, s);
    else await addLoose(book, cand.pages);
  } // 无源：加入散图图集
  delete book.folderTime;
  settle(book);
  await arrange(book, false, before);
  emit('books');
}
// 只比较目录句柄；记录里的源没有句柄（备份导入后尚未接回，或回退模式导入）时按相对路径比较。
export async function findMerged(roots, folders) {
  const same = async (a, b, name, match) =>
    a.length === b.length &&
    (
      await Promise.all(
        b.map(async (x) => {
          for (const y of a) if (name(y) === name(x) && (await match(y, x))) return true;
          return false;
        }),
      )
    ).every(Boolean);
  const volume = async (y, x) => (y.dir ? sameDir(y.dir, x.dir) : !!y.path && y.path === x.path);
  for (const b of books.values()) {
    if (!isMerged(b)) continue;
    if (roots?.length && b.roots?.length && (await same(b.roots, roots, (x) => x.name, sameDir))) return b;
    if (await same(b.sources, folders, (x) => x.title, volume)) return b;
  }
  return null;
}
// 用新的扫描结果重建合并作品：同一文件夹（或相对路径相同）的卷保留原 key，页名不变，书签和进度随之保留；
// 新文件夹追加为新卷；不在其中的卷连同其页面一起移除。order 为 mergeKeys 的结果，决定各卷的顺序。
// 先在全部卷中按目录句柄（同一个文件夹）配对，剩下的再按 key 配对：key 因同名去重后缀而错位时，不会把一卷接到别的文件夹的内容上。
export async function rebuild(book, order) {
  const before = book === current ? here() : null,
    old = [...book.sources],
    next = [],
    hit = new Map();
  forgetPages(book.id + ':');
  for (const { group: g } of order)
    for (const s of old)
      if (![...hit.values()].includes(s) && s.title === g.title && (await sameDir(s.dir, g.dir))) {
        hit.set(g, s);
        break;
      }
  for (const s of hit.values()) old.splice(old.indexOf(s), 1);
  for (const { group: g, key } of order) {
    let s = hit.get(g),
      i = s ? -1 : old.findIndex((x) => x.key === key);
    if (i >= 0) s = old.splice(i, 1)[0];
    if (s) link(book, g, s);
    else {
      let k = key;
      for (let n = 2; book.sources.some((x) => x.key === k) || next.some((x) => x.key === k); n++)
        k = key + ' (' + n + ')';
      s = { key: k, title: g.title, ...(g.path && { path: g.path }), ...(g.dir && { dir: g.dir }) };
      book.pages.push(...g.pages.map((p) => makePage(k, p.name)));
      pairFrom(book, s, g.pages);
    }
    next.push(s);
  }
  const gone = new Set(old.map((s) => s.key));
  if (gone.size) {
    const keep = (p) => !gone.has(keyOf(p));
    book.pages = book.pages.filter(keep);
    if (book.parked) book.parked = book.parked.filter(keep);
  }
  book.sources = next;
  delete book.folderTime;
  settle(book);
  await arrange(book, false, before);
  emit('books');
}
