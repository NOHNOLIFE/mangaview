// 右侧缩略图栏的开合：常驻停靠 / 浮动弹出（preview），右缘呼出与移开收起，拖动调宽。
import { get, put } from '../core/prefs.mjs';
import { $, fade, showing } from '../ui/dom.mjs';
import { current } from './session.mjs';
let ctx;
export let pinned = false;
let edgeTimer = 0;
// 临时弹出时浮在正文上方；常驻时停靠在右侧，正文让出宽度，不被遮挡。
export function preview(open) {
  const panel = $('panel'),
    floating = !document.body.classList.contains('docked');
  if (open && current) fade(panel, true);
  else if (floating && current) fade(panel, false);
  else {
    clearTimeout(panel.fadeTimer);
    panel.classList.remove('leaving');
    panel.hidden = true;
  }
  document.body.classList.toggle('docked', pinned && !!current);
  document.querySelector('[data-act="preview"][aria-pressed]').setAttribute('aria-pressed', String(pinned));
}
// 工具栏的「固定缩略图栏」按钮（ctx.actions.preview）：常驻 / 浮动切换，记住选择。
export function togglePinned() {
  pinned = !pinned;
  put('preview', pinned);
  preview(pinned);
}
// 边缘触发区（ctx.atEdge）：顶缘工具栏（toolbar.mjs）、左缘书架书签（bookmarks.mjs）、右缘缩略图栏（这里）同为 EDGE 像素，底缘总控栏（controlbar.mjs）为 EDGE_BOTTOM。
// 改距离只改 app.mjs 的 EDGE / EDGE_BOTTOM；各自的停留延迟（DWELL）用来防误触，可以不同。
// 鼠标贴近右缘停留 SIDE_DWELL 毫秒即弹出缩略图栏，离开后自动收起；左侧书架书签相同。两侧栏拖宽度的下限也统一为 SIDE_MIN。
const SIDE_DWELL = 150,
  SIDE_MIN = 160;
function cancelEdge() {
  clearTimeout(edgeTimer);
  edgeTimer = 0;
}
let resizing = false;
function setWidth(value) {
  const w = Math.max(SIDE_MIN, Math.min(innerWidth * 0.55, value));
  document.documentElement.style.setProperty('--panel', w + 'px');
  return w;
}
const grip = $('grip');
export function install(c) {
  ctx = c;
  pinned = get('preview', false);
  document.addEventListener('pointermove', (e) => {
    const near =
      e.pointerType === 'mouse' &&
      !e.buttons &&
      current &&
      !pinned &&
      get('edgeRight', true) &&
      !showing($('panel')) &&
      ctx.atEdge('right', e) &&
      !document.querySelector('dialog[open]');
    if (!near) cancelEdge();
    else if (!edgeTimer)
      edgeTimer = setTimeout(() => {
        edgeTimer = 0;
        if (!pinned && !document.querySelector('dialog[open]')) preview(true);
      }, SIDE_DWELL);
    // 窄条在静止的指针下弹出时浏览器未必补发 pointerenter，之后也就没有 pointerleave：指针已离开窄条和右缘就直接收起。
    if (
      e.pointerType === 'mouse' &&
      !pinned &&
      !resizing &&
      showing($('panel')) &&
      !ctx.atEdge('right', e) &&
      !$('panel').contains(e.target)
    )
      preview(false);
  });
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) cancelEdge();
  });
  $('panel').onpointerleave = () => {
    if (!pinned && !resizing) preview(false);
  };
  setWidth(get('width', 190));
  grip.onpointerdown = (e) => {
    if (e.button !== 0) return;
    resizing = true;
    grip.setPointerCapture(e.pointerId);
  };
  grip.onpointermove = (e) => {
    if (resizing) setWidth(innerWidth - e.clientX);
  };
  grip.onlostpointercapture = () => {
    resizing = false;
    put('width', $('panel').offsetWidth);
  };
  grip.onkeydown = (e) => {
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      put('width', setWidth($('panel').offsetWidth + (e.key === 'ArrowLeft' ? 16 : -16)));
    }
  };
}
