// 拖放导入：拖入覆盖层（默认区域、「添加为单个作品」、「添加到散图图集」三块）与窗口的拖放事件。拖放不经过选择框。
import { skipped, fileGroups, handleGroups, looseImages, looseFiles } from '../core/sources.mjs';
import { t } from '../core/locale.mjs';
import { $, notice, safe } from '../ui/dom.mjs';
import { add, addMerged, importPlace } from './import.mjs';
// 拖入覆盖层：放在顶层（popover），书架等对话框打开时也看得见。上方是默认区域（按文件夹建书），下方左右并排「添加为单个作品」和「添加到散图图集」两块区域。
// 散图区域：拖入内容里的所有图片（包括文件夹里的，递归）都作为散图加入散图图集，不按文件夹建书。
// 只拖入图片文件（没有文件夹）时，整个覆盖层就是「添加到散图图集」。拖动途中读不到文件内容，只能看 items 的 kind / type：
// 图片、视频、音频文件的 type 是 image/* 等，文件夹的 type 为空；判断不出时按含文件夹处理。
let dragDepth = 0,
  onlyImages = false;
const dropOverlay = $('dropOverlay'),
  zones = [...dropOverlay.querySelectorAll('.zone')];
const imagesOnly = (dt) => {
  const items = [...(dt?.items || [])];
  return items.length > 0 && items.every((x) => x.kind === 'file' && /^(image|video|audio)\//.test(x.type));
};
const zoneAt = (e) => {
  if (dropOverlay.hidden) return null;
  if (onlyImages) return 'loose';
  for (const z of zones) {
    const r = z.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)
      return z.dataset.zone;
  }
  return null;
};
function overlay(show, dt) {
  if (show) {
    onlyImages = imagesOnly(dt);
    dropOverlay.classList.toggle('images', onlyImages);
    dropOverlay.querySelector('.box use').setAttribute('href', onlyImages ? '#i-image-plus' : '#i-upload');
    $('dropText').textContent = t(onlyImages ? 'dropImages' : importPlace() === 'library' ? 'dropLibrary' : 'dropHere');
    dropOverlay.hidden = false;
    if (dropOverlay.showPopover && !dropOverlay.matches(':popover-open'))
      try {
        dropOverlay.showPopover();
      } catch {}
  } else {
    dropOverlay.hidden = true;
    for (const z of zones) z.classList.remove('over');
    if (dropOverlay.hidePopover && dropOverlay.matches(':popover-open'))
      try {
        dropOverlay.hidePopover();
      } catch {}
  }
}
export function install() {
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      dragDepth++;
      if (dropOverlay.hidden) overlay(true, e.dataTransfer);
    }
  });
  window.addEventListener('dragleave', (e) => {
    if (e.dataTransfer.types.includes('Files') && --dragDepth <= 0) {
      dragDepth = 0;
      overlay(false);
    }
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const at = onlyImages ? null : zoneAt(e);
      for (const z of zones) z.classList.toggle('over', z.dataset.zone === at);
    }
  });
  window.addEventListener('drop', (e) => {
    const zone = zoneAt(e),
      place = importPlace();
    dragDepth = 0;
    overlay(false);
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const items = [...e.dataTransfer.items].filter((x) => x.kind === 'file');
    const odd = skipped();
    if (items.length && items[0].getAsFileSystemHandle) {
      const handles = items.map((x) => x.getAsFileSystemHandle());
      safe(async () => {
        const list = (await Promise.all(handles)).filter(Boolean);
        if (zone === 'merge')
          await addMerged(
            list.filter((h) => h.kind === 'directory'),
            handleGroups(list, odd),
            place,
            odd,
          );
        else if (zone === 'loose') {
          notice('scanning');
          await add(await looseImages(list, odd), place, odd);
        } else await add(handleGroups(list, odd), place, odd);
      })();
    } else {
      const files = e.dataTransfer.files;
      safe(() =>
        zone === 'merge'
          ? addMerged(null, fileGroups(files, odd), place, odd)
          : add(zone === 'loose' ? looseFiles(files, odd) : fileGroups(files, odd), place, odd),
      )();
    }
  });
}
