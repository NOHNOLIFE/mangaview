// 删除书：discard 直接删除记录，remove 先确认，discardAll 批量删除；clearAll 清空全部书目。只删除记录，不动原文件。
// 删除的是当前书时切到阅读列表里原顺序的下一本，没有则上一本，列表空了回到书架页（reader/session.mjs 的 successorOf / leave）。
import { library, thumbs } from '../core/store.mjs';
import { t, title } from '../core/locale.mjs';
import { dropKey } from '../core/prefs.mjs';
import { books } from '../core/books.mjs';
import { dropThumbs } from '../reader/thumbs.mjs';
import { current, setCurrent, select, flush, successorOf, leave } from '../reader/session.mjs';
import { sortRequests } from '../reader/sort.mjs';
let ctx;
// 先从内存移除再删库，删除期间后台任务对这本书的保存会被 persist 忽略。next：删除当前书后要切到的书（批量删除时由 discardAll 先算好）。
export async function discard(book, next) {
  sortRequests.delete(book);
  flush();
  const was = book === current;
  if (was && next === undefined) next = successorOf(book);
  books.delete(book.id);
  if (was) leave(next);
  await library('delete', book.id);
  await dropThumbs(book.id);
  dropKey('pos:' + book.id);
}
// 批量删除（清空书架 / 书库、删除全部过期书）：当前书在其中时只切换一次，切到删除范围之外最近的一本。
export async function discardAll(list) {
  const gone = new Set(list),
    next = current && gone.has(current) ? successorOf(current, gone) : undefined;
  for (const b of list) if (books.has(b.id)) await discard(b, next);
}
export async function remove(book) {
  if (!book || !confirm(t('confirmRemove') + '\n' + title(book))) return;
  await discard(book);
  ctx.redrawShelf();
}

// 其他窗口先停止写入，清空后自动重新载入（windows.mjs）。
export async function clearAll() {
  if (!books.size || !confirm(t('confirmClear'))) return;
  await ctx.hold?.();
  try {
    for (const book of books.values()) sortRequests.delete(book);
    flush();
    const ids = [...books.keys()];
    books.clear();
    setCurrent(null);
    select(null);
    await library('clear');
    await thumbs('clear');
    for (const id of ids) dropKey('pos:' + id);
    ctx.redrawShelf();
  } finally {
    ctx.reloadOthers?.('clear');
  }
}
export function install(c) {
  ctx = c;
}
