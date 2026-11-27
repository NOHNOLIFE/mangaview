// 文件栏的按钮排布（纯逻辑）：右侧固定的按钮位、各类文件有哪些、窄时收进「⋯」的次序。
// 三种文件布局一致：按钮位不随类型变化，这种文件没有的按钮留空位。
export const SLOTS = ['subs', 'bookmark', 'section', 'cover', 'full'];
const HAS = {
  image: ['bookmark', 'section', 'cover'],
  video: ['subs', 'bookmark', 'section', 'cover', 'full'],
  audio: ['subs', 'bookmark', 'section'],
};
// 某类文件（'image' | 'video' | 'audio'，其他为空）有的按钮。
export const slotsOf = (kind) => new Set(HAS[kind] ?? []);
// 宽度不够时依次收进「⋯」的按钮（添加书签始终留在行里）。
export const COLLAPSE = ['full', 'cover', 'subs', 'section'];
// 收起 n 个之后：行里的按钮位（按 SLOTS 的次序，有收起的时末尾加 'more'）与「⋯」里的按钮。
export function arrange(n) {
  const gone = new Set(COLLAPSE.slice(0, n));
  const row = SLOTS.filter((s) => !gone.has(s));
  return { row: n ? [...row, 'more'] : row, more: SLOTS.filter((s) => gone.has(s)) };
}
// 放得下的最少收起个数：avail 为文件栏的可用宽度，base 为文件名、播放键、进度条、时间都缩到最小时的宽度（含间距），
// slot 为一个按钮的宽度，gap 为按钮间距。全部收起仍放不下时返回最大值（此时文件名、进度条已是最小宽度）。
export function fitLevel(avail, { base, slot, gap }) {
  for (let n = 0; n <= COLLAPSE.length; n++) {
    const k = arrange(n).row.length;
    if (base + k * slot + Math.max(0, k - 1) * gap <= avail) return n;
  }
  return COLLAPSE.length;
}
