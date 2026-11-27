// 媒体的接续、播放列表与只播放书签区段的纯逻辑，不碰界面和存储（media/ 调用，tests/core/playlist.test.mjs 覆盖）。
// ---- 接续：一个媒体播完之后播哪个。list 为可播放的媒体的页序号（按页序），cur 为刚播完的页序号；
// shuffle 为真时随机：played 为本轮已播过的页序号（含 cur），不重复地播完一轮，random 返回 [0,1) 的随机数；否则按页序。
// loop 为真时到列表末尾（随机时一轮播完）从头接着（重新洗牌，刚播完的不紧接着重复），否则为 null（由调用方决定：停下，或跨书循环进入下一本）。
// 单文件循环不经过这里（调用方直接重播当前媒体）。返回 {next, played}：next 为下一个的页序号（等于 cur 即只有它自己），played 为更新后的本轮集合。
// 影音模式的自动滚动按页序（shuffle 为假）；随机只用于播放列表（afterEnd）。
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
// ---- 播放列表（后台播放，media/queue.mjs）。
// 循环范围（设置类偏好 'playScope'）：'file' 单文件 | 'book' 本书（默认）| 'books' 跨书，都循环；不认识的值读作本书。
export const SCOPES = ['file', 'book', 'books'];
export const scopeOf = (v) => (SCOPES.includes(v) ? v : 'book');
// 循环范围按钮（画中画窗口）：点击按 SCOPES 的顺序轮换。
export const nextScope = (v) => SCOPES[(SCOPES.indexOf(scopeOf(v)) + 1) % SCOPES.length];
// 类型开关（设置类偏好 'playTypes'）：音频、视频，可多选，全不选即不限；读入时只留认识的值，按固定顺序。
export const KINDS = ['audio', 'video'];
export const typesOf = (v) => (Array.isArray(v) ? KINDS.filter((k) => v.includes(k)) : []);
export const typeOk = (types, kind) => !types.length || types.includes(kind);
// 类型开关（画中画窗口的音频、视频两个按钮）：切换其中一种，结果按固定顺序。
export const toggleType = (types, kind) =>
  typesOf(typesOf(types).includes(kind) ? typesOf(types).filter((k) => k !== kind) : [...typesOf(types), kind]);
// 列表内容：kinds 为书里各页的类型（'image' | 'video' | 'audio'），skip(i) 为不列入的页（播不了的、本次移除的）；返回按页序的页序号。
export function queueOf(kinds, types = [], skip = () => false) {
  const out = [];
  kinds.forEach((k, i) => {
    if ((k === 'video' || k === 'audio') && typeOk(types, k) && !skip(i)) out.push(i);
  });
  return out;
}
// 当前曲目播完之后：list 为可接续的页序号（按页序），cur 为刚播完的页序号，played 为随机时本轮已播过的。
// 返回 {type, next?, played}：'replay' 重播它（单文件循环，或列表里只有它）；'next' 播 next；
// 'onward' 本书的列表播完、进入下一本（跨书循环，由调用方找下一本有可播放媒体的书）；'stop' 没有可播的（列表空了）。
export function afterEnd({
  scope = 'book',
  shuffle = false,
  list = [],
  cur,
  played = new Set(),
  random = Math.random,
}) {
  if (scope === 'file') return { type: 'replay', played };
  const r = following({ shuffle, loop: scope === 'book', list, cur, played, random });
  if (r.next == null) return { type: scope === 'books' ? 'onward' : 'stop', played: new Set() };
  return { type: r.next === cur ? 'replay' : 'next', next: r.next, played: r.played };
}
// 上一项 / 下一项（d 为 ±1，列表内切换）：按页序，两端相接；cur 不在列表里时取页序上的前 / 后一项。没有别的项为 null。
export function stepIn(list, cur, d) {
  const others = list.filter((i) => i !== cur);
  if (!others.length) return null;
  return (d > 0 ? others.find((i) => i > cur) : others.findLast((i) => i < cur)) ?? (d > 0 ? others[0] : others.at(-1));
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
