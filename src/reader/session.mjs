// 当前书与阅读位置：正文视图（view）、选书与切书（select / step）、阅读范围（readingList），
// 阅读位置与页尺寸的保存（flush）。
import { Reader } from './view.mjs';
import { needsSort } from '../core/model.mjs';
import { source } from '../core/sources.mjs';
import { t } from '../core/locale.mjs';
import { emit } from '../core/events.mjs';
import { get, put } from '../core/prefs.mjs';
import { books, persist } from '../core/books.mjs';
import { expired } from '../core/status.mjs';
import { listOf, inList, stepBook, successor } from '../core/reading.mjs';
import { $, main, nav, shelf, safe } from '../ui/dom.mjs';
import { accessState, toolsState, updateProgress } from './shell.mjs';
import { arrange, defaultSort } from './sort.mjs';
let ctx;
export let current = null,
  unavailablePage = null;
// 删除、清空或被别的窗口删除时先把当前书置空再 select，select 就不会为已删除的书保存阅读位置。
export function setCurrent(book) {
  current = book;
}
let posTimer, dimTimer, dirty, hudFrame;
// 阅读位置所在的卷暂时找不到时，正文退回书首（anchor 为 null）：已保存的位置保留不动，卷找回后回到原处（here）。
// 读者在缺失期间滚到别处阅读（anchor 不为 null）才覆盖为新位置。
const held = () => {
  const pos = current && get('pos:' + current.id);
  return pos && current.parked?.some((p) => p.name === pos.name) ? pos : null;
};
export const here = () => view.anchor() ?? held();
export function savePos() {
  clearTimeout(posTimer);
  posTimer = 0;
  if (!current) return;
  const pos = view.anchor();
  if (pos || !held()) put('pos:' + current.id, pos);
}
function saveDims() {
  clearTimeout(dimTimer);
  if (dirty) {
    persist(dirty);
    dirty = null;
  }
}
export function flush() {
  savePos();
  saveDims();
}
export let view;
export function createView() {
  view = new Reader(main, nav, {
    file: source,
    invalid: () => t('invalid'),
    error(e, page) {
      if (e.name !== 'EncodingError') {
        unavailablePage = page;
        accessState();
        $('access').hidden = false;
      }
    },
    progress() {
      if (!posTimer) posTimer = setTimeout(savePos, 250);
      if (!hudFrame)
        hudFrame = requestAnimationFrame(() => {
          hudFrame = 0;
          updateProgress(true);
        });
    },
    measured() {
      dirty = current;
      clearTimeout(dimTimer);
      dimTimer = setTimeout(saveDims, 800);
    },
    laid() {
      emit('layout');
    }, // 重新排版后（缩略图栏的书签标记据此重新定位）
  });
  view.fit = get('fit', true);
  return view;
}
// 书架进度按保存的阅读位置估算，当前书使用实时位置。
export function readRatio(book) {
  const pos = book === current ? view.anchor() : get('pos:' + book.id),
    n = book.pages.length;
  if (!pos || !n) return 0;
  const i = book.pages.findIndex((p) => p.name === pos.name);
  return i < 0 ? 0 : Math.min(1, (i + pos.f) / n);
}
export function select(book) {
  flush();
  current = book || null;
  queueMicrotask(() => emit('select', current));
  put('last', current?.id ?? null);
  $('access').hidden = true;
  view.show(current, current ? get('pos:' + current.id) : null);
  toolsState();
  if (book && needsSort(book, defaultSort)) safe(arrange)(book);
}
export function reloadView(anchor = here()) {
  if (!current) return;
  $('access').hidden = true;
  view.show(current, anchor);
  updateProgress();
}
// 阅读列表（规则见 core/reading.mjs）：书架页当前选中的页签（ctx.listView，由 shelf.mjs 提供；选中「过期书籍」时沿用之前的页签）里、
// 符合筛选条件（ctx.matchFilter）的书，按书籍排序（ctx.orderBooks），跳过过期书。与当前书在哪个列表无关。
// 上一本 / 下一本、跨书运行（engine.mjs、media/order.mjs）、书签快捷键跨书与书架书签列表（marks/dock.mjs）、删除当前书后切书都用它。
export function readingList() {
  const list = ctx.listView?.() ?? listOf();
  return ctx.orderBooks([...books.values()].filter((b) => inList(b, list) && !expired(b) && ctx.matchFilter(b)));
}
// 上一本 / 下一本：当前书不在阅读列表里时，从它按排序应在的位置走到最近的一本。
export function step(d) {
  const next = stepBook(readingList(), current, d, ctx.orderBooks);
  if (next) select(next);
}
// 删除当前书（本窗口删除，或别的窗口删除了它）：在从 books 移除之前取得之后要切到的书——阅读列表里原顺序的下一本，没有则上一本；
// gone：一起删除的书（批量删除），都跳过。
export const successorOf = (book, gone) => successor(readingList(), book, ctx.orderBooks, gone);
// 当前书已从 books 移除：切到 next；没有（阅读列表空了）时回到书架页，一本书都没有时显示欢迎页。
export function leave(next) {
  setCurrent(null);
  select(next ?? null);
  if (!next && books.size && !shelf.open) ctx.actions.shelf();
}

export function install(c) {
  ctx = c;
  window.addEventListener('pagehide', flush);
}
