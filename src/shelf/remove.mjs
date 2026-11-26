// 删除书：discard 直接删除记录，remove 先确认；clearAll 清空全部书目。只删除记录，不动原文件。
import { library, thumbs } from '../core/store.mjs';
import { t, title } from '../core/locale.mjs';
import { dropKey } from '../core/prefs.mjs';
import { books } from '../core/books.mjs';
import { dropThumbs } from '../reader/thumbs.mjs';
import { current, setCurrent, select, flush } from '../reader/session.mjs';
import { sortRequests } from '../reader/sort.mjs';
let ctx;
// 先从内存移除再删库，删除期间后台任务对这本书的保存会被 persist 忽略。
export async function discard(book) {
  sortRequests.delete(book);
  flush();
  books.delete(book.id);
  if (book === current) {
    setCurrent(null);
    select(books.values().next().value);
  }
  await library('delete', book.id);
  await dropThumbs(book.id);
  dropKey('pos:' + book.id);
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
