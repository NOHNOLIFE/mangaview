// 画中画窗口的纯规则（media/pip.mjs、media/pipview.mjs 调用，tests/core/pip.test.mjs 覆盖）：入口的作用、播放列表的可见范围与滚动位置、内容区的画面比例。
// 入口（文件栏标题行的「画中画」、音频卡片上的同一个按钮、Z 键）按作用的文件与窗口的状态决定做什么（entry）：
// - 视频、音频：它是当前曲目且画面已在画中画窗口里 → 'close' 关闭窗口；否则 'show'：它成为当前曲目、开始播放（已在播放的不中断），
//   画面搬进窗口（没开就打开）；
// - 图片或没有文件：窗口开着 → 'close'，否则 'open' 只打开窗口（不搬动现有曲目的画面）。
// 入口按钮在 entry 为 'close' 时显示为按下（pressed）。
// open：窗口开着；kind：作用的文件的类型；track：它是当前曲目；out：当前曲目的画面在画中画窗口里。
export function entry({ open = false, kind = null, track = false, out = false } = {}) {
  if (kind === 'video' || kind === 'audio') return open && track && out ? 'close' : 'show';
  return open ? 'close' : 'open';
}
// 虚拟列表：n 项、每项 row 像素高，可视区从 top 起 height 高，前后各多渲染 extra 项；返回要渲染的 [from, to)。
export function span(n, row, top, height, extra = 4) {
  if (!n || !(row > 0)) return [0, 0];
  const from = Math.max(0, Math.floor(Math.max(0, top) / row) - extra),
    to = Math.min(n, Math.ceil((Math.max(0, top) + Math.max(0, height)) / row) + extra);
  return [Math.min(from, to), to];
}
// 让第 i 项居中的滚动位置（打开窗口时滚到当前曲目），夹在可滚动范围内。
export function centerTop(i, n, row, height) {
  const max = Math.max(0, n * row - height);
  return Math.min(max, Math.max(0, i * row + row / 2 - height / 2));
}
// 让第 i 项完整可见所需的滚动位置（键盘移动选中项时）：已完整可见则不变。
export function revealTop(i, row, top, height) {
  const a = i * row,
    b = a + row;
  if (a < top) return a;
  if (b > top + height) return Math.max(0, b - height);
  return top;
}
// 内容区的画面比例（高 / 宽）：帧尺寸已知用它，否则 16:9；夹在 [MIN_RATIO, MAX_RATIO]，极端比例时内容区不至于过扁或过高。
export const MIN_RATIO = 0.25,
  MAX_RATIO = 1.5;
export function ratio(w, h) {
  const r = w > 0 && h > 0 ? h / w : 9 / 16;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}
