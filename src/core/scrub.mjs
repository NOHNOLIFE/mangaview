// 横向拖动快进 / 快退的纯逻辑（手势在 media/scrub.mjs，方向判定由 ui/dragscroll.mjs 调用）：
// - 方向：位移超过 DECIDE 像素后一次判定并锁定：明显横向（|dx| ≥ RATIO × |dy|）才是定位，否则是原有的拖动滚动。
// - 换算：拖过全宽对应 span(时长)：时长的四分之一，限制在 SPAN_MIN 到 SPAN_MAX 秒之间，且不超过时长。
// - 偏移按整秒（offset），带少许回差：指针在两个整秒的分界上抖动时数字不来回跳；目标时间夹在 0 到时长之间（target）。
export const DECIDE = 8,
  RATIO = 2,
  SPAN_MIN = 30,
  SPAN_MAX = 300,
  HYSTERESIS = 0.25;
// 方向：还没超过阈值为 null，否则 'seek'（明显横向）或 'scroll'。
export function direction(dx, dy, slop = DECIDE) {
  if (Math.abs(dx) <= slop && Math.abs(dy) <= slop) return null;
  return Math.abs(dx) >= RATIO * Math.abs(dy) ? 'seek' : 'scroll';
}
// 拖过全宽对应的秒数（时长未知或为 0 时为 0）。
export const span = (d) => (d > 0 ? Math.min(d, Math.max(SPAN_MIN, Math.min(SPAN_MAX, d / 4))) : 0);
// 偏移（整秒）：dx 为从按下处起的横向位移，width 为全宽，d 为时长，prev 为上一次的结果（没有为 null）。
export function offset(dx, width, d, prev = null) {
  if (!(width > 0) || !(d > 0)) return 0;
  const raw = (dx / width) * span(d);
  if (prev != null && Math.abs(raw - prev) < 0.5 + HYSTERESIS) return prev;
  return Math.round(raw) || 0;
}
// 目标时间：起点 t0 加偏移，夹在 0 到时长之间。
export const target = (t0, off, d) => Math.min(d, Math.max(0, t0 + off));
