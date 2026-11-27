// 书目（books：id → 书）与保存：persist 只写本窗口改过的字段（多窗口合并见 merge.mjs），pull 接收别的窗口写入的改动，
// joinLoose 把旧版留下的多本散图图集并为一本（启动时）。
import { library, thumbs, update } from './store.mjs';
import { snap, merge, changes, adopt, refresh } from './merge.mjs';
import { sortMode, sortedPages } from './model.mjs';
import { dirOf, addLoose, allPages } from './sources.mjs';
import { emit } from './events.mjs';
import { get, dropKey } from './prefs.mjs';
import { normalize } from './normalize.mjs';
import { notice } from '../ui/dom.mjs';
import { forget, forgetPages, dropThumbs } from '../reader/thumbs.mjs';
import { current, reloadView, successorOf, leave } from '../reader/session.mjs';
import { toolsState } from '../reader/shell.mjs';
import { sortRequests } from '../reader/sort.mjs';
let ctx;
export const books = new Map();
// 已从 books 中移除（删除、清空、备份替换）的书不再写入：后台任务（封面、文件夹时间、排序）晚到的保存不会把刚删的记录写回。
// 多个窗口：以存储中的最新记录为基础，只写本窗口改过的字段（merge.mjs），存储中已变、本窗口没改的字段随之换进内存；
// 已被别的窗口删除的记录不写回，本窗口随之移除这本书。bases：书 → 本窗口所知的存储版本的逐字段指纹，没有表示尚未写入过。
export const bases = new WeakMap();
export function persist(book) {
  if (books.get(book.id) !== book) return Promise.resolve();
  let gone = false,
    took = [];
  return update(book.id, (stored) => {
    if (books.get(book.id) !== book) return;
    const base = bases.get(book);
    if (!stored && base) {
      gone = true;
      return;
    }
    let out = book;
    if (stored && base) {
      const r = merge(base, book, stored);
      out = r.out;
      took = r.take;
      for (const k of r.take) adopt(book, k, stored[k]);
      for (const k of r.joined) book[k] = out[k];
    }
    bases.set(book, snap(book));
    return out;
  }).then(
    () => {
      if (gone) {
        vanish(book);
        ctx.redrawShelf();
        emit('books');
      } else if (took.length) followed(book, took);
    },
    () => notice('storage'),
  );
}
// 别的窗口写入了这些书（windows.mjs 转来）：按书重读，只换进本窗口没有未保存改动的字段；记录已删除的移除，新增的加入。
export async function pull(ids) {
  const recs = await Promise.all(ids.map((id) => library('get', id).catch(() => null)));
  let any = false;
  // 一起被删除的书（别的窗口批量删除）：当前书在其中时只切换一次。
  const gone = new Set(ids.map((id, i) => recs[i] === undefined && books.get(id)).filter((b) => b && bases.has(b)));
  ids.forEach((id, i) => {
    const rec = recs[i],
      book = books.get(id);
    if (rec === null) return;
    if (!rec) {
      if (book && bases.has(book)) {
        vanish(book, gone);
        any = true;
      }
      return;
    }
    if (!book) {
      const base = snap(rec);
      books.set(id, normalize(rec));
      bases.set(rec, base);
      any = true;
      return;
    }
    const base = bases.get(book);
    if (!base) return; // 本窗口新建、尚未写入
    const keys = changes(base, book, rec);
    if (!keys.length) return;
    for (const k of keys) adopt(book, k, rec[k]);
    refresh(base, book, keys);
    followed(book, keys);
    any = true;
  });
  if (any) {
    ctx.redrawShelf();
    emit('books');
  }
}
// 别的窗口改过的字段已换进内存：页面列表变了才重排正文；各模块按 'synced' 事件（书, 字段名）更新受影响的界面。
function followed(book, keys) {
  if (book === current) {
    if (keys.some((k) => ['pages', 'sources', 'parked'].includes(k))) reloadView();
    toolsState();
  }
  emit('synced', book, keys);
}
// 别的窗口删除了这本书：从内存移除（之后不会写回）；正在读它时提示，并与本窗口删除一样切到阅读列表里原顺序的下一本（没有则上一本，
// 列表空了回到书架页；session.mjs 的 successorOf / leave）。gone：同一批被删除的书，切书时跳过。
function vanish(book, gone) {
  if (books.get(book.id) !== book) return;
  const was = book === current,
    next = was ? successorOf(book, gone) : null;
  sortRequests.delete(book);
  books.delete(book.id);
  forget(book.id + ':');
  forgetPages(book.id + ':');
  if (was) {
    leave(next);
    setTimeout(() => notice('removedElsewhere'));
  } // 延后：保存这本书的操作自己的提示（如“已添加书签”）不会盖掉它
}
// 只保留一个散图图集：旧版本遇到同名图片会另建一本，载入时并入一本（最近打开的那本，否则最新添加的那本，它的书名、位置、排序和阅读位置保留）。
// 各本的页按 addLoose 规则并入（同一个文件只留一份，同名的不同图片页名加序号），书签和播放位置（mediaPos，已有的为准）随之改写页名，标签取并集；
// 先保存并入后的图集，再删除其余记录，中途关闭也不丢数据（下次载入再并一次，重复的页按同一规则去掉）。
export async function joinLoose(list) {
  const last = get('last'),
    keep = list.find((b) => b.id === last) ?? list.reduce((a, b) => ((b.added ?? 0) > (a.added ?? 0) ? b : a)),
    moved = [];
  for (const b of list) {
    if (b === keep) continue;
    const names = await addLoose(keep, allPages(b)),
      have = new Set(keep.bookmarks.map((m) => m?.id));
    for (const m of b.bookmarks) {
      if (!m || have.has(m.id)) continue;
      if (typeof m.name === 'string') m.name = names.get(m.name) ?? m.name;
      if (typeof m.end?.name === 'string') m.end.name = names.get(m.end.name) ?? m.end.name;
      keep.bookmarks.push(m);
      if (m.id != null) moved.push([b, m]);
    }
    const pos = Array.isArray(keep.mediaPos) ? keep.mediaPos : [],
      had = new Set(pos.map((x) => x?.id));
    for (const x of Array.isArray(b.mediaPos) ? b.mediaPos : []) {
      const id = typeof x?.id === 'string' ? (names.get(x.id) ?? x.id) : null;
      if (id != null && !had.has(id)) {
        had.add(id);
        pos.push({ ...x, id });
      }
    }
    if (pos.length) keep.mediaPos = pos;
    keep.tags = [...new Set([...keep.tags, ...b.tags])];
    if (keep.name == null && b.name) keep.name = b.name;
  }
  if (sortMode(keep) !== 'shuffle') keep.pages = sortedPages(keep.pages, sortMode(keep), dirOf(keep));
  delete keep.folderTime;
  await persist(keep);
  for (const [b, m] of moved)
    for (const k of [':bm:' + m.id, ':bm:' + m.id + ':end']) {
      const th = await thumbs('get', b.id + k).catch(() => null);
      if (th) await thumbs('put', th, keep.id + k);
    } // 书签（及区段书签）缩略图键带书的 id（bookmarks.mjs）
  for (const b of list)
    if (b !== keep) {
      books.delete(b.id);
      await library('delete', b.id);
      await dropThumbs(b.id);
      dropKey('pos:' + b.id);
    }
}
export function install(c) {
  ctx = c;
}
