// 正文与缩略图栏的点击：左右半屏翻屏（screenStep）、点媒体播放 / 暂停、触屏开关工具栏；回到书首 / 滚到书尾（toStart / toEnd）。
import { main, nav, showing } from '../ui/dom.mjs';
import { step, view } from './session.mjs';
import { bar, showBar } from './toolbar.mjs';
import { drag } from './drag.mjs';
let ctx;
export function screenStep(d) {
  main.scrollTop += d * Math.max(1, main.clientHeight - 64);
}
// 点击正文：左半屏前一屏、右半屏后一屏；点在视频、音频上是播放 / 暂停（media.mjs）；触屏点正文顶部的窄条开关工具栏（触屏没有鼠标悬停）。上 / 下一本、回到书首 / 滚到书尾在底缘弹出的操作栏里（endbar.mjs）。
export const atStart = () => main.scrollTop < 1,
  atEnd = () => main.scrollHeight - main.scrollTop - main.clientHeight <= 1;
export function toStart() {
  if (atStart()) step(-1);
  else main.scrollTop = 0;
}
export function toEnd() {
  if (atEnd()) step(1);
  else main.scrollTop = main.scrollHeight;
}
export function install(c) {
  ctx = c;
  drag(main, (e, target) => {
    const r = main.getBoundingClientRect();
    if (e.pointerType !== 'mouse' && e.clientY - r.top <= 40) {
      showBar(!showing(bar));
      return;
    }
    if (ctx.media?.tap(target)) return;
    screenStep(e.clientX - r.left < main.clientWidth / 2 ? -1 : 1);
  });
  drag(nav, (e) => view.fromPreview(e.clientY - nav.getBoundingClientRect().top));
}
