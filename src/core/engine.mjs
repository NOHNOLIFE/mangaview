// 总控运行引擎的纯逻辑，不碰界面和存储（reader/engine.mjs、reader/autoscroll.mjs、media/ 调用，tests/core/engine.test.mjs 覆盖）：
// 滚动速率换算成每帧位移、自动滚动的下一步（滚动 / 停下播放 / 跳到下一段 / 停留 / 到书末）、单文件模式下按页推进、
// 漫画模式只经过的图片段（imageRuns）、只播区段时的图片区段（imageSpans）与两者的交集（intersect）、跨书循环的下一本、翻屏时对齐视频。
// 坐标都是正文内容里的像素；「中线」指视窗中线（scrollTop + 视窗高度 / 2），停靠点、区段都用中线坐标表示。
import { union } from './sections.mjs';

// ---- 滚动速率：1.0× = 每秒滚过视窗高度的 10%。按帧间实际时间推进，帧间隔超过 MAX_DT 按 MAX_DT 算（卡顿、从后台回来时不跳一大段）。
export const BASE = 0.1,
  MAX_DT = 100;
export const scrollSpeed = (rate, viewH) => rate * BASE * viewH; // 像素 / 秒
export const travel = (speed, dt) => (speed * Math.min(MAX_DT, Math.max(0, dt || 0))) / 1000;

// ---- 下一步
// 停靠点与区段端点离当前中线不到 EPS 像素即视为已到达。
export const EPS = 1;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// 媒体停靠点：媒体页的中线夹在 [lo, hi] 内（书首、书尾的媒体无法真正居中，到滚动的尽头即算到达），按位置排序。
// pages：[{i, top, bottom}]（正文里的页序号与上下沿），lo / hi：视窗中线能到达的最小 / 最大值。
export const stopsOf = (pages, lo, hi) =>
  pages.map((p) => ({ i: p.i, at: clamp((p.top + p.bottom) / 2, lo, hi) })).sort((a, b) => a.at - b.at || a.i - b.i);
// 自动运行这一帧做什么。c：当前中线；d：这一帧应前进的距离；lo / hi：中线的范围；
// stops：媒体停靠点（stopsOf，漫画模式为空）；skip：已经播过或跳过、不再停靠的页序号（离开中线之后由调用方清掉）；
// spans：只经过的中线区间 [{a,b,hold?}]（按 a 排序、互不重叠），null 为不限：只播区段时的图片区段、漫画模式的图片段（imageRuns），或两者的交集。
// 比视窗还短的图片段是一个点（a = b），带 hold（像素）：中线到达后原地停留，相当于以滚动速率滚过 hold 像素的时间；
// held 为在这个点已停留的距离（调用方累计 d，离开或被挪动后清零）。
// 返回 {type:'scroll', to}（中线滚到 to）、{type:'play', i, to}（中线到 to 停下，播放第 i 页的媒体）、
// {type:'jump', to}（直接跳到下一段的起点）、{type:'hold'}（原地停留这一帧）、{type:'end'}（没有可走的了：书末，或最后一段之后）。
export function next({ c, d = 0, lo = 0, hi = Infinity, stops = [], skip = new Set(), spans = null, held = 0 }) {
  const ahead = stops.filter((s) => !skip.has(s.i) && s.at >= c - EPS);
  let limit = hi;
  if (spans) {
    const h = spans.find((s) => s.hold > 0 && Math.abs(c - s.a) <= EPS);
    if (h && held < h.hold) return { type: 'hold' };
    const cur = spans.find((s) => s.a - EPS <= c && c < s.b - EPS);
    if (!cur) {
      // 不在任何区段里：去下一个区段的起点；中间有自带区段的媒体时先去它那里（中间的图片不经过）。停留完的点不再回到它自己。
      const ns = spans.find((s) => s.a > (h ? c + EPS : c));
      const stop = ahead.find((s) => !ns || s.at < ns.a - EPS);
      if (stop) return { type: 'play', i: stop.i, to: stop.at };
      return ns ? { type: 'jump', to: clamp(ns.a, lo, hi) } : { type: 'end' };
    }
    limit = Math.min(hi, cur.b);
    const s = ahead.find((s) => s.at <= limit + EPS);
    if (s && s.at <= c + d + EPS) return { type: 'play', i: s.i, to: s.at };
    if (c + d < limit) return { type: 'scroll', to: c + d };
    if (limit >= hi && c >= hi - 0.5) return { type: 'end' };
    if (limit >= hi) return { type: 'scroll', to: hi };
    return next({ c: cur.b, lo, hi, stops, skip, spans }); // 到了区段终点：接着看后面
  }
  const s = ahead[0];
  if (s && s.at <= c + d + EPS) return { type: 'play', i: s.i, to: s.at };
  if (c >= hi - 0.5) return { type: 'end' };
  return { type: 'scroll', to: Math.min(hi, c + d) };
}

// ---- 单文件模式：运行时按页推进，不连续滚动。
// 漫画模式按间隔换到下一页（1.0× = PAGE_MS 一张，间隔 = PAGE_MS ÷ 滚动速率），跳过视频、音频页；
// 混合模式图片按间隔，媒体页停下播放、播完再换页；只播区段时只经过图片区段内的页（及规则下应播的媒体）。
export const PAGE_MS = 5000;
export const pageInterval = (rate) => PAGE_MS / (rate > 0 ? rate : 1);
// 第 j 页是否落在图片区段 s 之内（区段 [a, b] 与该页 [j, j+1) 有重叠；终点正好在页首的不算这一页）。
const inSpan = (s, j) => {
  const a = s.a.i + s.a.f,
    b = s.b.i + s.b.f;
  return a < j + 1 && (b > j || (b === a && s.a.i === j));
};
// 每一页在运行中的处理：'play' 停下播放（stops 里的页：混合模式下应播的媒体），'show' 按间隔显示，
// null 不经过（只播区段时区段之外的页、away 里的页：漫画模式下的视频、音频页）。
// n：页数；stops：应播媒体的页序号集合；spans：只播区段时的图片区段 [{a:{i,f}, b:{i,f}}]（imageSpans 的结果），null 为不限；away：不经过的页序号集合。
export function pagePlan({ n, stops = new Set(), spans = null, away = new Set() }) {
  return Array.from({ length: n }, (_, j) =>
    stops.has(j) ? 'play' : !away.has(j) && (!spans || spans.some((s) => inSpan(s, j))) ? 'show' : null,
  );
}
// 第 i 页之后下一个要经过的页：{type:'play'|'show', i}；没有了（书末，或最后一个区段之后）为 {type:'end'}。
export function pageAfter(plan, i) {
  for (let j = Math.max(-1, i) + 1; j < plan.length; j++) if (plan[j]) return { type: plan[j], i: j };
  return { type: 'end' };
}

// ---- 只播区段：书签列表（marks/list.mjs 的 list 结果）里生效的图片区段的并集 [{a:{i,f}, b:{i,f}}]，按起点排序、互不重叠：
// 区段可以嵌套、交叉，重叠的合并成一段（core/sections.mjs 的 union），运行时不重复经过。
// 图片书签的位置是添加时的视窗中线，所以区段换成中线坐标即为 [point(a), point(b)]。
const media = (m) => Number.isFinite(m?.t);
export const imageSpans = (items) =>
  union(
    items
      .filter((x) => x.live && !media(x.bm))
      .map((x) => ({ a: { i: x.i, f: x.bm.f }, b: { i: x.e, f: x.bm.end.f } })),
    (p) => p.i + p.f,
  );
// 第 i 页（媒体）是否整个处在某个图片区段之内（此时没有自己的区段也整段播放）。
export const covered = (spans, i) => spans.some((s) => s.a.i + s.a.f <= i + 1e-9 && s.b.i + s.b.f >= i + 1 - 1e-9);
// 本书有没有任何生效的区段（图片或媒体）。
export const hasSections = (items) => items.some((x) => x.live);

// ---- 漫画模式只滚图片：视频、音频页不进入画面。连续的图片页是一段，中线坐标的区间 [a, b]：从段首在视窗顶（a = 段首 + H/2）
// 滚到段尾到达视窗底（b = 段尾 − H/2），之后直接跳到下一段的开头（next 的 spans）。比视窗还短的段是一个点（段首在视窗顶），
// 带 hold = 段高：在那里停留以滚动速率滚过段高的时间。a、b 夹在中线的范围 [lo, hi] 内（书首、书尾）。
// starts：各页的上沿与总高（长度 n + 1）；image(i)：第 i 页是否为图片；H：视窗高度。
export function imageRuns({ starts, image, H, lo = H / 2, hi = Infinity }) {
  const out = [],
    n = starts.length - 1;
  for (let i = 0; i < n;) {
    if (!image(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && image(j + 1)) j++;
    const top = starts[i],
      bottom = starts[j + 1],
      a = clamp(top + H / 2, lo, hi),
      b = clamp(bottom - H / 2, lo, hi);
    out.push(b > a + EPS ? { a, b } : { a, b: a, hold: bottom - top });
    i = j + 1;
  }
  return out;
}
// 两组中线区间（各自按 a 排序、互不重叠）的交集：只播区段与漫画模式同时开启时只经过区段内的图片。
// 停留点（hold）落在另一组的某个区间之内（含端点）时保留。结果按 a 排序。
export function intersect(x, y) {
  const out = [],
    inside = (p, list) => list.some((s) => s.a - EPS <= p && p <= s.b + EPS);
  for (const s of x) {
    if (s.hold > 0) {
      if (inside(s.a, y)) out.push(s);
      continue;
    }
    for (const t of y) {
      if (t.hold > 0) continue;
      const a = Math.max(s.a, t.a),
        b = Math.min(s.b, t.b);
      if (b > a + EPS) out.push({ a, b });
    }
  }
  for (const t of y)
    if (
      t.hold > 0 &&
      inside(
        t.a,
        x.filter((s) => !(s.hold > 0)),
      )
    )
      out.push(t);
  return out.sort((p, q) => p.a - q.a);
}

// ---- 跨书循环：阅读列表 list 里 cur 之后第一本 ok 的书；到列表末尾时 loop 为真则从头接着找（可能回到 cur 自己），否则为 null。
export function nextBook(list, cur, loop, ok = () => true) {
  const n = list.length,
    i = list.indexOf(cur);
  for (let k = 1; k <= n; k++) {
    const j = i + k;
    if (j >= n && !loop) return null;
    const b = list[((j % n) + n) % n];
    if (ok(b)) return b;
  }
  return null;
}

// ---- 翻屏：从 top 翻 d 屏（step 像素）后，有视频的中线进入视窗（之前不在），这一次就落在该视频居中处（夹在 [0, max]）；
// 往下翻取最靠前的一个，往上翻取最靠后的一个。videos：[{mid}]，按位置排序。返回新的 scrollTop。
export function turnTo({ top, d, step, viewH, max, videos = [] }) {
  const to = clamp(top + d * step, 0, max),
    seen = (m, t) => m >= t && m <= t + viewH;
  const fresh = videos.filter((v) => seen(v.mid, to) && !seen(v.mid, top));
  if (!fresh.length) return to;
  const v = d > 0 ? fresh[0] : fresh.at(-1);
  return clamp(v.mid - viewH / 2, 0, max);
}

// ---- 混合模式的相邻媒体：第 i 页的媒体播完（或播不了）后，页序上紧挨的下一页也是要停下播放的媒体（在 stops 里、没有跳过）时，
// 直接定位到它的停靠点（居中）并播放，不匀速滚动过去：返回 {type:'play', i, to}；否则为 null（照常滚动，图片与媒体之间不受影响）。
// stops：stopsOf 的结果（混合模式下应播的媒体，只播区段时已按规则筛过）；单文件模式按页推进，不用它。
export function chained(stops, i, skip = new Set()) {
  const s = stops.find((s) => s.i === i + 1);
  return s && !skip.has(s.i) ? { type: 'play', i: s.i, to: s.at } : null;
}
