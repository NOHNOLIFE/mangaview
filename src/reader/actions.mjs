// 按钮动作表（ctx.actions：data-act 属性对应其中的键，其他模块也往里添加）与全局点击分派（含 data-close 关闭对话框）。
import { isStuck, sourceOf } from '../core/sources.mjs';
import { put } from '../core/prefs.mjs';
import { $, shelf, safe } from '../ui/dom.mjs';
import { current, unavailablePage, step, reloadView, view } from './session.mjs';
import { toolsState, staleCount } from './shell.mjs';
import { togglePinned } from './panel.mjs';
import { sortOptions, sortScope, showSortChoices } from './sort.mjs';
import { pick, pickMerged } from '../shelf/pick.mjs';
import { refreshAll } from '../shelf/refresh.mjs';
import { clearAll } from '../shelf/remove.mjs';
let ctx;
export const actions = {
  folder: () => pick('folder'),
  files: () => pick('file'),
  shelf: () => {
    shelf.showModal();
    ctx.drawShelf();
  },
  help: () => $('help').showModal(),
  prev: () => step(-1),
  next: () => step(1),
  sort: () => {
    sortScope.querySelector('[value="folder"]').disabled = !current;
    sortScope.value = current ? 'folder' : 'global';
    showSortChoices();
    sortOptions.showModal();
    sortOptions.querySelector('.options [aria-pressed=true]').focus();
  },
  fit: () => {
    view.fit = !view.fit;
    put('fit', view.fit);
    view.layout();
    toolsState();
  },
  full: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
  preview: () => togglePinned(),
  refresh: () => refreshAll(true),
  clear: clearAll,
  // 合并作品先向用户当初选的文件夹请求授权，一次即可覆盖其下各卷。
  allow: async () => {
    if (staleCount() && ctx.restoreBatch) return ctx.restoreBatch();
    const b = current;
    if (!b) return;
    const h =
      (unavailablePage && sourceOf(b, unavailablePage)?.dir) ||
      b.sources.find((s) => s.dir)?.dir ||
      unavailablePage?.handle;
    if (!h || isStuck(h)) return actions.locate();
    let ok = false; // 卡住的句柄授权也没用，直接重新指定文件夹 // 合并作品没有任何句柄时按卷匹配，不默认绑到第一卷
    for (const x of [...(b.roots || []).filter((r) => !isStuck(r)), h])
      if ((await x.requestPermission({ mode: 'read' }).catch(() => 'denied')) === 'granted') ok = true;
    if (ok && current === b) reloadView();
  },
  // 散图图集也选文件夹：按相对目录 + 文件名找回各页。
  locate: () =>
    current && (window.showDirectoryPicker && ctx.restoreOne ? ctx.restoreOne(current) : pick('folder', current)),
  merge: pickMerged,
};
export function install(c) {
  ctx = c;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
    else {
      const action = e.target.closest('[data-act]')?.dataset.act;
      if (action) safe(actions[action])();
    }
  });
}
