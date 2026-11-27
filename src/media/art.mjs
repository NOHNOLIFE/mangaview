// 音频的图：音频卡片右侧的小图、音频书签、缩略图栏 / 全屏缩略图里的音频小块三处共用。
// 所在的书有封面时显示书的当前封面（ctx.coverBg，自定义封面优先；封面换了经 'cover' 事件跟着变）；没有封面时是占位图：
// 按文件名自动配色（同名同色）的浅色渐变 + 音符，由 art.css 现场画出，不用图片文件。
import { norm } from '../core/match.mjs';
import { shownName } from '../core/model.mjs';
// 占位图的配色：只看文件名（路径的最后一段，按标签配色的规则归一化），同名的文件颜色相同。
// 与标签配色（match.mjs hue）同样按名称散列，另加一步混合，只差一个序号的文件（01.mp3 / 02.mp3）也互不相关；
// h：主色相（0–359）；d：渐变另一端的色相偏移（±24–60）；a：渐变方向（度）。色相碰巧接近时，渐变的走向和方向通常也不同。
function hash(page) {
  const full = shownName(page);
  let h = 0x811c9dc5;
  for (const ch of norm(full.slice(full.lastIndexOf('/') + 1))) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function artLook(page) {
  const x = hash(page),
    y = Math.floor(x / 360);
  return { h: x % 360, d: (y & 1 ? 1 : -1) * (24 + ((y >>> 1) % 37)), a: [45, 135, 225, 315][(y >>> 7) & 3] };
}
export const artHue = (page) => artLook(page).h;
const NS = 'http://www.w3.org/2000/svg',
  NOTE = 'M9 17.2V5.6l11-2.4v11.6';
// 把 el 变成音频的图（类名 .mv-art、配色 --art-h / --art-d / --art-a、音符图形），并让它显示所在书的封面。el 自己负责定位与尺寸。
export function audioArt(ctx, el, book, page) {
  el.classList.add('mv-art');
  const { h, d, a } = artLook(page);
  el.style.setProperty('--art-h', String(h));
  el.style.setProperty('--art-d', String(d));
  el.style.setProperty('--art-a', a + 'deg');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'mv-note');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const stem = document.createElementNS(NS, 'path');
  stem.setAttribute('d', NOTE);
  svg.append(stem);
  for (const [cx, cy] of [
    [6.2, 17.4],
    [17.2, 15],
  ]) {
    const head = document.createElementNS(NS, 'ellipse');
    head.setAttribute('cx', cx);
    head.setAttribute('cy', cy);
    head.setAttribute('rx', 3.1);
    head.setAttribute('ry', 2.6);
    svg.append(head);
  }
  el.prepend(svg);
  if (book) ctx.coverBg?.(el, book);
  return el;
}
