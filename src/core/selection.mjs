// 当前曲目（选中媒体）的规则（纯逻辑）：每个窗口最多一个当前曲目（视频或音频），图片没有任何状态，也不引入键盘焦点之类的状态。
// - 成为当前曲目：点击画面或播放键（press）、开始播放（play，含自动滚动、自动播放、播放列表接续）、上一个 / 下一个媒体切到（switch）、书签跳到它（goto）。
// - 后台播放：暂停后仍是当前曲目；离开视窗、切书都不取消。选中了别的媒体、播放列表结束后台播放（stop）、文件打不开或播放器被释放（gone）时取消。
//   例外：由自动播放开始、用户尚未接手的（auto）中线离开视窗（全屏中的除外）或切书时取消。
// - 当前文件（文件栏、长按 A / D、空格作用的对象）：有当前曲目时是它（不在视窗里、在别的书里也一样），否则是视窗中心所在的页。
// - 书签作用的对象（书签快捷键、右键书签面板）：当前曲目在本书且中线在视窗内时是它，否则是视窗中心所在的页。
export const PICKS = new Set(['press', 'play', 'switch', 'goto']);
// 事件之后的当前曲目：e = {type, player?, auto?, inView?, full?}；auto：当前曲目由自动播放开始、用户尚未接手。
// 'view' 是滚动、重排后的检查（inView：中线在视窗内，full：正在全屏），'book' 是切书。
export function selectAfter(sel, e) {
  if (PICKS.has(e.type)) return e.player ?? sel;
  if (e.type === 'stop') return null;
  if (e.type === 'gone') return e.player === sel ? null : sel;
  if (!sel || !e.auto) return sel; // 后台播放：离开视窗、切书都不取消
  if (e.type === 'book') return null;
  if (e.type === 'view') return !e.full && !e.inView ? null : sel;
  return sel; // 'pause' 等：不变
}
// 当前文件：当前曲目优先，否则视窗中心所在的页；都没有为 null。
export const fileTarget = (track, center) => track ?? center ?? null;
// 书签作用的对象：当前曲目在本书（inBook）且中线在视窗内（inView）时是它，否则视窗中心所在的页；都没有为 null。
export const markTarget = (track, { inBook = false, inView = false } = {}, center = null) =>
  track && inBook && inView ? track : (center ?? null);
