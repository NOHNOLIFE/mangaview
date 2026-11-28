// 画中画窗口的纯规则（media/pip.mjs、media/pipview.mjs、media/piplist.mjs 调用，tests/core/pip.test.mjs 覆盖）：入口的作用、
// 播放列表的行（书名小标题）、可见范围与滚动位置，「固定」切换时窗口尺寸的变化。
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
// 播放列表的行：列表跨多本书时，每段连续的同一本书的项前加一行书名小标题（与项同样的行高，虚拟列表按行计算）；只有一本书时不加。
// items 为列表的项，bookOf(项) 取它所在的书。返回 {rows, at}：rows 为 {head: 书} 或 {item: 项, i: 项的序号}，at[i] 为第 i 项所在的行号。
export function listRows(items, bookOf = (it) => it.book) {
  const many = new Set(items.map(bookOf)).size > 1,
    rows = [],
    at = [];
  let last;
  items.forEach((item, i) => {
    const b = bookOf(item);
    if (many && (i === 0 || b !== last)) rows.push({ head: b });
    last = b;
    at.push(rows.length);
    rows.push({ item, i });
  });
  return { rows, at };
}
// 「固定」（功能栏停靠在画面下方 + 播放列表停靠在右侧）：停靠的列表是固定宽度 SIDE（不随面板宽度变化），面板至少 DOCK_MIN 宽时
// 才停靠，更窄时固定也按浮出的方式显示。两个值与 piplist.css 的 --side、容器查询一致（改一处要同步另一处）。
export const SIDE = 220,
  DOCK_MIN = 420;
// 真实画中画窗口里切换「固定」时窗口要变化的尺寸，使内容区（画面）的宽高保持不变：固定时宽度加上列表宽（列表会停靠时）、
// 高度加上功能栏高；取消时减回。on：切到固定；width / height：窗口当前的内尺寸；side：停靠列表的宽；dock：功能栏的高；
// dockMin：停靠所需的最小面板宽。返回 {dw, dh}（resizeBy 的参数）与目标内尺寸 {width, height}。
export function pinResize({ on, width, height, side = SIDE, dock = 0, dockMin = DOCK_MIN }) {
  const docks = on ? width + side >= dockMin : width >= dockMin, // 固定之后 / 取消之前，列表是否停靠
    dw = docks ? (on ? side : -side) : 0,
    dh = Math.max(0, dock) * (on ? 1 : -1);
  return { dw, dh, width: Math.max(0, width + dw), height: Math.max(0, height + dh) };
}
