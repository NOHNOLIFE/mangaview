// 媒体的接续、播放列表与只播放书签区段的纯逻辑，不碰界面和存储（media/ 调用，tests/core/playlist.test.mjs 覆盖）。
// ---- 影音模式的自动滚动（media/order.mjs）：一个媒体播完之后播哪个。list 为可播放的媒体的页序号（按页序），cur 为刚播完的页序号。
// 按页序取下一个；loop 为真时到列表末尾从头接着，否则为 null（由调用方决定：停下，或跨书循环进入下一本）。
// 单文件循环不经过这里（调用方直接重播当前媒体）。返回 {next}：next 为下一个的页序号（等于 cur 即只有它自己）。
export function following({ loop = false, list = [], cur }) {
  const after = list.find((i) => i > cur);
  if (after != null) return { next: after };
  return { next: loop && list.length ? list[0] : null };
}
// 没有当前曲目时总控栏的上一个 / 下一个媒体（media/driver.mjs，d 为 ±1）：list 为本书可播放的媒体的页序号，按页序，两端相接；
// cur 不在列表里时取页序上的前 / 后一项。没有别的项为 null。
export function stepIn(list, cur, d) {
  const others = list.filter((i) => i !== cur);
  if (!others.length) return null;
  return (d > 0 ? others.find((i) => i > cur) : others.findLast((i) => i < cur)) ?? (d > 0 ? others[0] : others.at(-1));
}
// ---- 播放列表（后台播放，media/queue.mjs）：有序的项（书 + 文件，可以跨书），只在本窗口内存里。
// 下面的函数按项在列表里的序号工作：ok[k] 为第 k 项可接续（没有被过滤、播得了；接续时另按只播区段的规则），cur 为当前曲目的序号
// （不在列表里时可以是两项之间的小数，如 1.5 表示在第 1、2 项之间）。
// 循环范围（设置类偏好 'playScope'）：'file' 单文件 | 'list' 列表（默认）| 'books' 跨书，都循环；旧值 'book'（本书）与不认识的值读作列表。
export const SCOPES = ['file', 'list', 'books'];
export const scopeOf = (v) => (SCOPES.includes(v) ? v : 'list');
// 循环范围按钮（画中画窗口）：点击按 SCOPES 的顺序轮换。
export const nextScope = (v) => SCOPES[(SCOPES.indexOf(scopeOf(v)) + 1) % SCOPES.length];
// 过滤（设置类偏好）：类型 'playTypes'（音频、视频，可多选，全不选即不限；读入时只留认识的值，按固定顺序）、
// 「只含书签」'playMarked'（文件上至少有一个书签）。被过滤的项留在列表里，只是接续、上一个 / 下一个跳过它们。
export const KINDS = ['audio', 'video'];
export const typesOf = (v) => (Array.isArray(v) ? KINDS.filter((k) => v.includes(k)) : []);
export const typeOk = (types, kind) => !types.length || types.includes(kind);
// 类型开关：切换其中一种，结果按固定顺序。
export const toggleType = (types, kind) =>
  typesOf(typesOf(types).includes(kind) ? typesOf(types).filter((k) => k !== kind) : [...typesOf(types), kind]);
export const markedOf = (v) => v === true;
// 一项是否通过过滤：kind 为它的类型，n 为它上面的书签数。
export const passes = ({ types = [], marked = false }, kind, n = 0) => typeOk(types, kind) && (!marked || n > 0);
// 有没有过滤生效。
export const filtering = ({ types = [], marked = false }) => types.length > 0 || !!marked;
// 一项的书签情况：m 为该页的书签汇总（marks/list.mjs pageMarks 的一项，没有为 undefined）。
// 'section' 有生效的区段书签 | 'mark' 有书签 | 'none' 没有。
export const markKind = (m) => (m?.start || m?.end ? 'section' : m?.n ? 'mark' : 'none');
// 一本书里能放进列表的页：kinds 为各页的类型（'image' | 'video' | 'audio'），skip(i) 为不列入的页（播不了的）；返回按页序的页序号。
export function mediaOf(kinds, skip = () => false) {
  const out = [];
  kinds.forEach((k, i) => {
    if ((k === 'video' || k === 'audio') && !skip(i)) out.push(i);
  });
  return out;
}
// 追加：list 后面按顺序接上 more 里还没有的项（key 判断是否同一项，more 里重复的也只接一次）。返回 {list, added}。
export function append(list, more, key = (x) => x) {
  const have = new Set(list.map(key)),
    out = [...list];
  for (const x of more) {
    const k = key(x);
    if (have.has(k)) continue;
    have.add(k);
    out.push(x);
  }
  return { list: out, added: out.length - list.length };
}
// cur 之后（d 为 1）/ 之前（d 为 -1）最近的可接续项的序号，没有为 null。
export function nearestOk(ok, cur, d) {
  if (d > 0) {
    for (let k = Math.max(0, Math.floor(cur) + 1); k < ok.length; k++) if (ok[k]) return k;
  } else for (let k = Math.min(ok.length - 1, Math.ceil(cur) - 1); k >= 0; k--) if (ok[k]) return k;
  return null;
}
// 当前曲目播完之后。返回 {type, next?}：'replay' 重播它（单文件循环，或列表里只有它可接续）；'next' 播第 next 项；
// 'onward' 列表播完、进入下一本（跨书循环，由调用方找阅读列表里末项所在书的下一本）；'stop' 没有可接续的项。
export function afterEnd({ scope = 'list', ok = [], cur }) {
  if (scope === 'file') return { type: 'replay' };
  const next = nearestOk(ok, cur, 1);
  if (next != null) return { type: 'next', next };
  if (scope === 'books') return { type: 'onward' };
  const first = nearestOk(ok, -1, 1);
  if (first == null) return { type: 'stop' };
  return first === cur ? { type: 'replay' } : { type: 'next', next: first };
}
// 上一个 / 下一个（d 为 ±1）：按列表顺序跳过不可接续的项。返回 {type: 'item', i} 切到第 i 项；在列表一端时，单文件、列表范围首尾相接，
// 跨书范围为 {type: 'book'}（由调用方进入上一本 / 下一本）；没有别的项可切换时为 null。
export function stepTo({ scope = 'list', ok = [], cur, d }) {
  const i = nearestOk(ok, cur, d);
  if (i != null) return { type: 'item', i };
  if (scope === 'books') return { type: 'book' };
  const w = nearestOk(ok, d > 0 ? -1 : ok.length, d);
  return w == null || w === cur ? null : { type: 'item', i: w };
}
// 移除当前曲目之后播哪一项：ok 为移除之后的列表，at 为被移除的项原来的序号。取它后面最近的可接续项，后面没有时从头找；都没有为 null。
export const afterRemove = (ok, at) => nearestOk(ok, at - 1, 1) ?? nearestOk(ok, -1, 1);
// ---- 收藏列表（media/queue.mjs，存在 localStorage 的 'playlists'，属于用户数据，随备份导出）：
// [{id, name, items: [{book: 书的 id, page: 页名}]}]。读入时只留格式正确的，坏数据跳过。
export function favoritesOf(v) {
  if (!Array.isArray(v)) return [];
  const ok = (s) => typeof s === 'string' && !!s;
  return v
    .filter((f) => f && typeof f === 'object' && ok(f.id) && typeof f.name === 'string' && Array.isArray(f.items))
    .map((f) => ({
      id: f.id,
      name: f.name,
      items: f.items.filter((x) => x && ok(x.book) && ok(x.page)).map((x) => ({ book: x.book, page: x.page })),
    }));
}
// 收藏的默认名：base（列表第一项所在的书名），与已有的名称重复时加上序号「base (2)」「base (3)」…
export function defaultName(base, taken = []) {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(base + ' (' + n + ')')) return base + ' (' + n + ')';
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
