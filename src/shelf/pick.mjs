// 文件 / 文件夹选择入口：系统选择框（showDirectoryPicker / showOpenFilePicker）与不支持时回退的 <input>，
// 「导入为单个作品」的文件夹选择，给单本书重新指定文件夹、散图图集定位原文件（relocate）。
import {
  scan,
  skipped,
  fileGroups,
  handleGroups,
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
import { add, addMerged } from './import.mjs';
let pendingInput = null,
  pendingMerge = false;
function input(kind, book, merge = false) {
  pendingInput = book;
  pendingMerge = merge;
  const el = $(kind + 'Input');
  el.value = '';
  el.click();
}
export function install() {
  for (const kind of ['folder', 'file'])
    $(kind + 'Input').onchange = safe(async (e) => {
      const odd = skipped(),
        groups = fileGroups(e.target.files, odd),
        book = pendingInput,
        merge = pendingMerge;
      pendingInput = null;
      pendingMerge = false;
      if (book && isLoose(book)) {
        const [g] = looseFiles(e.target.files);
        await rebound(book, g ? reconnect(book, g) : 0);
      } else if (book) {
        let count = 0;
        for (const g of groups) {
          const s = isMerged(book) ? book.sources.find((s) => s.title === g.title) : book.sources[0];
          if (isMerged(book) ? s : !book.title || g.title === book.title || groups.length === 1)
            count += reconnect(book, g, s);
        }
        await rebound(book, count);
      } else if (merge) await addMerged(null, groups, undefined, odd);
      else await add(groups, undefined, odd);
    });
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
export async function pick(kind, book = null) {
  if (kind === 'folder' && window.showDirectoryPicker) {
    const dir = await showDirectoryPicker({ mode: 'read' });
    if (book && isLoose(book)) await relocate(book, dir);
    else if (book) {
      const pages = [];
      for await (const h of dir.values()) if (h.kind === 'file') pages.push({ name: h.name });
      await rebound(book, reconnect(book, { dir, pages }));
    } else {
      const odd = skipped();
      await add(scan(dir, '', odd), undefined, odd);
    }
  } else if (kind === 'file' && window.showOpenFilePicker) {
    const handles = await showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: t('imageTypes'),
          accept: {
            'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg'],
            'video/*': ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv'],
            'audio/*': ['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.weba'],
            'application/x-potplayer-bookmark': ['.pbf'],
          },
        },
      ],
    });
    const odd = skipped();
    await add(handleGroups(handles, odd), undefined, odd);
  } else input(kind, book);
}
// 不依赖拖拽的「导入为单个作品」：选一个文件夹，其下所有带图片的文件夹合成一本。
export async function pickMerged() {
  if (!window.showDirectoryPicker) return input('folder', null, true);
  const dir = await showDirectoryPicker({ mode: 'read' }),
    odd = skipped();
  await addMerged([dir], scan(dir, '', odd), undefined, odd);
}
