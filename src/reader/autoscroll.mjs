// 匀速滚动的推进：总控的自动滚动（reader/engine.mjs）与按住 W / S 的持续滚动（keys.mjs）共用。
// - 按帧间实际时间推进（core/engine.mjs travel），位置以小数累计、直接写入 scrollTop。浏览器把 scrollTop 取整到像素
//   （实测 Chrome 在设备像素比 1 / 1.25 / 1.5 / 2 下都取整到 CSS 像素），所以不能每帧 scrollTop += 小数（会一直被取整掉，低速下不动）；
//   小数位置自己保存，读回的值只用来判断别人有没有动过。按设备像素步进的做法实测每帧位移分布相同，没有更稳，故取直接写小数位置。
// - 别人动过滚动位置（用户滚动、翻屏、拖动、正文重排的锚定、窗口缩放）：下一帧从新的位置接着推进，不跳回去。
import { travel } from '../core/engine.mjs';

export class Glide {
  constructor(el) {
    this.el = el;
    this.pos = 0;
    this.seen = null; // 上次写入后读回的 scrollTop
  }
  // 当前位置：上次写入之后没有别人动过时是累计的小数位置；否则是 el 现在的位置（moved 为真）。
  here() {
    const top = this.el.scrollTop;
    if (this.seen != null && Math.abs(top - this.seen) <= 0.5) return { y: this.pos, moved: false };
    const moved = this.seen != null;
    this.pos = top;
    this.seen = top;
    return { y: top, moved };
  }
  // 滚到 y（夹在可滚动范围内），记下读回的值。
  set(y) {
    const el = this.el;
    this.pos = Math.min(Math.max(0, el.scrollHeight - el.clientHeight), Math.max(0, y));
    el.scrollTop = this.pos;
    this.seen = el.scrollTop;
  }
  // 忘掉上次写入（重新开始时调用）。
  reset() {
    this.seen = null;
  }
}
// 按 speed()（像素 / 秒，负数向上）持续滚动 el，返回停止函数。
export function cruise(el, speed) {
  const g = new Glide(el);
  let prev = performance.now(),
    frame = 0;
  const tick = (now) => {
    const dt = now - prev;
    prev = now;
    g.set(g.here().y + travel(speed(), dt));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
