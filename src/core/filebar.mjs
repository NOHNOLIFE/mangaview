// 文件栏与音频卡片右侧按钮的排布（纯逻辑）：三个固定的按钮位，各类文件有哪些按钮、哪些收进「⋯」。
// 直接显示的只有「添加书签」「添加区段书签」（DIRECT），其余收进第三个位上的「⋯」；这种文件的按钮总数不超过 PLACES（3）个时全部直接显示。
// 即图片：书签、区段、设置为封面；视频：书签、区段、「⋯」（设置为封面、全屏）；音频：书签、区段（第三个位留空）。
// 按钮位固定：每个位置始终在同一处，不随文件类型跳动，这种文件没有的位置留空。
export const BUTTONS = ['bookmark', 'section', 'cover', 'full'];
export const DIRECT = ['bookmark', 'section'];
export const PLACES = 3;
const HAS = {
  image: ['bookmark', 'section', 'cover'],
  video: ['bookmark', 'section', 'cover', 'full'],
  audio: ['bookmark', 'section'],
};
// 某类文件（'image' | 'video' | 'audio'，其他为空）有的按钮，按 BUTTONS 的次序。
export const buttonsOf = (kind) => [...(HAS[kind] ?? [])];
// 排布：row 为 PLACES 个按钮位上的内容（按钮 id、'more' 或 null 空位），more 为「⋯」里的按钮。
export function arrange(kind) {
  const has = buttonsOf(kind);
  if (has.length <= PLACES) return { row: [...has, ...Array(PLACES - has.length).fill(null)], more: [] };
  return { row: [...DIRECT, 'more'], more: has.filter((id) => !DIRECT.includes(id)) };
}
