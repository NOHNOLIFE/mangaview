// 画中画窗口的纯规则（media/pip.mjs、media/pipview.mjs、media/piplist.mjs 调用，tests/core/pip.test.mjs 覆盖）：入口的作用、
// 播放列表的行（书名小标题）、可见范围与滚动位置。
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
