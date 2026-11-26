// 文件 / 文件夹选择入口：系统选择框（showDirectoryPicker / showOpenFilePicker）与不支持时回退的 <input>。
// choose 给添加对话框（add.mjs）选文件夹或文件，只返回待添加项（句柄或本次会话的 File），不扫描；
// pick 给单本书重新指定文件夹，relocate 给散图图集定位原文件。
import {
  skipped,
  fileGroups,
  looseImages,
  looseFiles,
  reconnect,
  settle,
  isMerged,
  isLoose,
  mediaSizes,
} from '../core/sources.mjs';
import { t } from '../core/locale.mjs';
import { $, notice, safe } from '../ui/dom.mjs';
import { arrange } from '../reader/sort.mjs';
import { add } from './import.mjs';
import { PICK_TYPES, ACCEPT, fromHandle, fromFiles } from './addlist.mjs';
// 回退的 <input>：pendingInput 为要重新指定文件夹的书，或接收所选 File 的函数（添加对话框）。
let pendingInput = null;
function input(kind, target) {
  if (typeof pendingInput === 'function') pendingInput([]); // 上一次选择没有结果（取消）
  pendingInput = target;
  const el = $(kind + 'Input');
  el.value = '';
  el.click();
}
export function install() {
  $('fileInput').accept = ACCEPT;
  for (const kind of ['folder', 'file']) {
    $(kind + 'Input').addEventListener('cancel', () => {
      const target = pendingInput;
      pendingInput = null;
      if (typeof target === 'function') target([]);
    });
    $(kind + 'Input').onchange = safe(async (e) => {
      const files = [...e.target.files],
        book = pendingInput;
      pendingInput = null;
      if (typeof book === 'function') return book(files);
      const odd = skipped(),
        groups = fileGroups(files, odd);
      if (book && isLoose(book)) {
        const [g] = looseFiles(files);
        await rebound(book, g ? reconnect(book, g) : 0);
      } else if (book) {
        let count = 0;
        for (const g of groups) {
          const s = isMerged(book) ? book.sources.find((s) => s.title === g.title) : book.sources[0];
          if (isMerged(book) ? s : !book.title || g.title === book.title || groups.length === 1)
            count += reconnect(book, g, s);
        }
        await rebound(book, count);
      } else await add(groups, undefined, odd);
    });
  }
}
async function rebound(book, count) {
  if (!count) {
    notice('noImages');
    return;
  }
  settle(book);
  await arrange(book);
}
// 散图图集定位原文件 / 恢复：在所选文件夹里（递归）按“相对目录 + 文件名”找回各页，见 sources.mjs reconnect。返回找回的页数。
export async function relocate(book, dir, quiet) {
  const [g] = await looseImages([dir]);
  if (g) await mediaSizes(book, g);
  const n = g ? reconnect(book, g) : 0;
  if (n || !quiet) await rebound(book, n);
  return n;
}
// 给已有的书重新指定文件夹（重新授权、定位原文件）。
export async function pick(kind, book) {
  if (kind === 'folder' && window.showDirectoryPicker) {
    const dir = await showDirectoryPicker({ mode: 'read' });
    if (isLoose(book)) await relocate(book, dir);
    else {
      const pages = [];
      for await (const h of dir.values()) if (h.kind === 'file') pages.push({ name: h.name });
      await rebound(book, reconnect(book, { dir, pages }));
    }
  } else input(kind, book);
}
// 添加对话框的选择：kind 为 'folder'（一个文件夹）或 'file'（可多选）。返回待添加项（addlist.mjs），取消时为空数组。
export async function choose(kind) {
  try {
    if (kind === 'folder' && window.showDirectoryPicker)
      return [fromHandle(await showDirectoryPicker({ mode: 'read' }))];
    if (kind === 'file' && window.showOpenFilePicker)
      return (
        await showOpenFilePicker({ multiple: true, types: [{ description: t('imageTypes'), accept: PICK_TYPES }] })
      ).map(fromHandle);
  } catch (e) {
    if (e.name === 'AbortError') return [];
    throw e;
  }
  return fromFiles(await new Promise((r) => input(kind, r)));
}
