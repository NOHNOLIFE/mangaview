// 页面排序：按书自己的排序或全局默认排序重排页面（arrange），工具栏「排序」的选择对话框。
import { byTime, sortedPages, folderSort, needsSort } from '../core/model.mjs';
import { readMissingTimes, dirOf } from '../core/sources.mjs';
import { t } from '../core/locale.mjs';
import { get, put, prefs } from '../core/prefs.mjs';
import { books, persist } from '../core/books.mjs';
import { $, notice, safe } from '../ui/dom.mjs';
import { current, here, reloadView, savePos } from './session.mjs';
export let defaultSort;
export const sortRequests = new WeakMap();
export async function arrange(book, manual = false, anchor) {
  const override = folderSort(book),
    mode = override ?? defaultSort.mode;
  const reorder = mode !== 'shuffle' || manual || needsSort(book, defaultSort);
  book.sortOverride = override;
  const request = Symbol();
  sortRequests.set(book, request);
  const active = () =>
    sortRequests.get(book) === request && books.has(book.id) && mode === (folderSort(book) ?? defaultSort.mode);
  if (byTime(mode) && book.pages.some((p) => !Number.isFinite(p.lastModified))) {
    if (book === current) {
      if (!manual) reloadView(anchor); // 导入已改变页表，不能让旧视图一直等待读盘。
      notice('readingTimes');
    }
    await persist(book); // 即使读盘未完成就关闭，也能在下次打开时按已选规则继续。
    await readMissingTimes(book, active);
    if (!active()) return;
    anchor = undefined; // 等待读盘期间，读者可能已经滚到了别处。
    if (book === current && book.pages.some((p) => !Number.isFinite(p.lastModified))) notice('unknownTimes');
    else if ($('notice').textContent === t('readingTimes')) $('notice').textContent = '';
  }
  if (book === current && anchor === undefined) anchor = here();
  if (reorder) book.pages = sortedPages(book.pages, mode, dirOf(book));
  if (!override && mode === 'shuffle') book.shuffleRevision = defaultSort.revision;
  else delete book.shuffleRevision;
  book.sortMode = mode;
  delete book.random;
  if (book === current) {
    reloadView(anchor);
    savePos();
  }
  await persist(book);
}
export const sortOptions = $('sortOptions'),
  sortScope = $('sortScope');
export function showSortChoices() {
  const global = sortScope.value === 'global';
  const selected = global ? defaultSort.mode : (folderSort(current) ?? 'default');
  sortOptions.querySelector('[data-mode="default"]').hidden = global;
  $('defaultSortName').textContent = t(defaultSort.mode);
  for (const btn of sortOptions.querySelectorAll('[data-mode]'))
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === selected));
  for (const btn of sortOptions.querySelectorAll('[data-scope]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.scope === sortScope.value));
    btn.disabled = sortScope.querySelector(`[value="${btn.dataset.scope}"]`).disabled;
  }
}
export function install() {
  prefs.sync('defaultSort', (value) => {
    if (!value?.mode) return;
    defaultSort = value;
    if (sortOptions.open) showSortChoices();
    if (current && folderSort(current) === null && needsSort(current, defaultSort)) safe(arrange)(current);
  });
  defaultSort = get('defaultSort', { mode: 'nameAsc', revision: 0 });
  sortScope.onchange = showSortChoices;
  sortOptions.onclick = safe(async (e) => {
    const scope = e.target.closest('[data-scope]');
    if (scope) {
      sortScope.value = scope.dataset.scope;
      showSortChoices();
      return;
    }
    const choice = e.target.closest('[data-mode]');
    if (!choice) return;
    const mode = choice.dataset.mode;
    sortOptions.close();
    if (sortScope.value === 'global') {
      if (mode === defaultSort.mode && mode !== 'shuffle') return;
      defaultSort = { mode, revision: crypto.randomUUID() };
      put('defaultSort', defaultSort);
      // 未打开的书在选中时再应用默认值，不为了修改偏好遍历硬盘。
      if (current && folderSort(current) === null) await arrange(current);
    } else if (current) {
      current.sortOverride = mode === 'default' ? null : mode;
      await arrange(current, mode !== 'default');
    }
  });
}
