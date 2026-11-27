// 媒体的接续与只播放书签区段的纯逻辑，不碰界面和存储（media/ 调用，tests/core/playlist.test.mjs 覆盖）。
// ---- 接续：一个媒体播完之后播哪个。list 为可播放的媒体的页序号（按页序），cur 为刚播完的页序号；
// shuffle 为真时随机：played 为本轮已播过的页序号（含 cur），不重复地播完一轮，random 返回 [0,1) 的随机数；否则按页序。
// loop 为真时到列表末尾（随机时一轮播完）从头接着（重新洗牌，刚播完的不紧接着重复），否则为 null（由调用方决定：停下，或跨书循环进入下一本）。
// 单文件循环不经过这里（调用方直接重播当前媒体）。返回 {next, played}：next 为下一个的页序号（等于 cur 即只有它自己），played 为更新后的本轮集合。
// 影音模式的自动滚动按页序（shuffle 为假）；随机留给播放列表使用。
export function following({ shuffle = false, loop = false, list = [], cur, played = new Set(), random = Math.random }) {
  if (shuffle) {
    let round = new Set(played);
    round.add(cur);
    let pool = list.filter((i) => !round.has(i));
    if (!pool.length) {
      if (!loop) return { next: null, played: round };
      round = new Set([cur]);
      pool = list.filter((i) => i !== cur); // 一轮播完重新洗牌，刚播完的不紧接着重复
      if (!pool.length) return { next: list.includes(cur) ? cur : null, played: round };
    }
    const next = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    round.add(next);
    return { next, played: round };
  }
  const after = list.find((i) => i > cur);
  if (after != null) return { next: after, played };
  return { next: loop && list.length ? list[0] : null, played };
}
// ---- 只播放书签区段：ranges 为一个媒体内生效的区段的并集 [{a,b}]（秒，按起点排序，互不重叠）：区段可以嵌套、交叉，
// 调用方先用 core/sections.mjs 的 union 合并（media/sections.mjs 的 rangesOf），重叠的部分只播一次。
// 开始播放（或自动切到该媒体）时从哪里播：在某个区段内就从当前时间继续；否则从当前时间之后的第一个区段起点开始，之后没有区段时从第一个区段开始。
export function sectionStart(ranges, t) {
  if (!ranges.length) return t;
  if (ranges.some((r) => r.a <= t && t < r.b)) return t;
  return (ranges.find((r) => r.a >= t) ?? ranges[0]).a;
}
// 播放中每次进度更新时调用：k 为正在播放的区段序号（不在区段里为 null）。
// 返回 {k, seek?, done?}：播到区段末尾跳到下一个区段的起点（seek）；最后一个区段播完即 done（视为该媒体播完）。
// 手动拖到区段之外（k 由调用方清为 null）时不强行跳回，进入后面的区段后恢复按区段跳转。
export const EPS = 0.05;
export function sectionStep(ranges, t, k) {
  const r = k == null ? null : ranges[k];
  if (r && t >= r.b - EPS) {
    if (k + 1 < ranges.length) return { k: k + 1, seek: ranges[k + 1].a };
    return { k: null, done: true };
  }
  if (r && t >= r.a - EPS) return { k };
  const i = ranges.findIndex((x) => x.a <= t && t < x.b - EPS);
  return { k: i < 0 ? null : i };
}
