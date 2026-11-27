// 选中媒体的规则（纯逻辑）：每个窗口最多一个选中媒体（视频或音频），图片没有任何状态，也不引入键盘焦点之类的状态。
// - 成为选中：点击画面或播放键（press）、开始播放（play，含自动播放、运行引擎轮到它）、上一个 / 下一个媒体切到（switch）、书签跳到它（goto）。
// - 暂停后仍是选中；中线离开视窗（全屏中的除外）、选中了别的媒体、切书、播放器被释放时取消。
// - 当前文件（文件栏、书签快捷键、长按 A / D 作用的对象）：有选中媒体时是它，否则是视窗中心所在的页。
export const PICKS = new Set(['press', 'play', 'switch', 'goto']);
// 事件之后的选中媒体：e = {type, player?, inView?, full?}；'view' 是滚动、重排后对选中媒体的检查（inView：中线在视窗内，full：正在全屏）。
export function selectAfter(sel, e) {
  if (PICKS.has(e.type)) return e.player ?? sel;
  if (e.type === 'book') return null;
  if (e.type === 'gone') return e.player === sel ? null : sel;
  if (e.type === 'view') return sel && !e.full && !e.inView ? null : sel;
  return sel; // 'pause' 等：不变
}
// 当前文件：选中媒体优先，否则视窗中心所在的页；都没有为 null。
export const fileTarget = (selected, center) => selected ?? center ?? null;
