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
import { $, main, nav, safe } from '../ui/dom.mjs';
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
// 当前导航范围：上一本 / 下一本在当前书所在的列表（书架或书库）内、且符合书架页当前筛选条件的书中切换，跳过过期书；
// 书架书签列表（bookmarks.mjs、overview.mjs）用 ctx.readingList({place:'shelf'}) 取同一范围。
// 顺序与书架页相同（ctx.orderBooks、ctx.matchFilter 由 shelf.mjs 按“书籍排序”和筛选条件提供）。
export function readingList(book) {
  const place = book?.place ?? 'shelf';
  return ctx.orderBooks([...books.values()].filter((b) => b.place === place && !expired(b) && ctx.matchFilter(b)));
}
export function step(d) {
  const list = readingList(current);
  if (!list.length) return;
  let i = list.indexOf(current),
    next;
  // 当前书不在筛选结果里（仍可正常阅读）：按排序从它所在的位置走到最近的一本结果。
  if (i < 0 && current) {
    const all = ctx.orderBooks([...list, current]);
    i = all.indexOf(current);
    next = all[(i + d + all.length) % all.length];
  } else next = list[i < 0 ? (d < 0 ? list.length - 1 : 0) : (i + d + list.length) % list.length];
  select(next);
}

export function install(c) {
  ctx = c;
  window.addEventListener('pagehide', flush);
}
