// 书签列表的纯逻辑（不操作界面，可在 Node 里测试）：排序与区段是否生效、配对坐标、媒体区段、每页的标记汇总（含区段的嵌套层级）、缩略图键。
// 书签的数据格式见 bookmarks.mjs 开头的说明。
import { layers } from '../core/sections.mjs';
export const isMedia = (m) => Number.isFinite(m?.t),
  spot = (m) => (isMedia(m) ? m.t : m?.f);
export const key = (book, bm) => book.id + ':bm:' + bm.id,
  endKey = (book, bm) => key(book, bm) + ':end';
// 按当前页序排列；文件名已不存在的排在最后，i 为 -1。e：区段书签所在的页（没有或已不存在为 -1）；
// live：区段生效（两头都在、区段书签在起点之后）；页序改变使区段书签排到前面时暂不生效，数据保留。
export function list(book) {
  const pos = new Map(book.pages.map((p, i) => [p.name, i]));
  return (book.bookmarks || [])
    .map((bm) => {
      const i = pos.get(bm.name) ?? -1,
        e = bm.end ? (pos.get(bm.end.name) ?? -1) : -1;
      return {
        bm,
        i,
        e,
        live:
          i >= 0 &&
          e >= 0 &&
          (isMedia(bm)
            ? e === i && isMedia(bm.end) && bm.end.t > bm.t
            : !isMedia(bm.end) && coord(e, bm.end) > coord(i, bm)),
      };
    })
    .sort((a, b) => (a.i < 0) - (b.i < 0) || a.i - b.i || spot(a.bm) - spot(b.bm) || a.bm.at - b.bm.at);
}
// 配对用的一维坐标（sections.mjs）：图片为页序 + 页内位置，全书一个坐标系（page 为 -1）；媒体按所在文件分组（page 为它的页序），以时间为坐标。
// 图片书签与媒体书签互不配对。
export const coord = (i, m) => i + m.f;
export const coords = (items, page = -1) =>
  items
    .filter((x) => x.i >= 0 && (page < 0 ? !isMedia(x.bm) : x.i === page && isMedia(x.bm)))
    .map((x) => ({
      id: x.bm.id,
      at: page < 0 ? coord(x.i, x.bm) : x.bm.t,
      end: x.bm.end ? (x.live ? (page < 0 ? coord(x.e, x.bm.end) : x.bm.end.t) : null) : undefined,
    }));
// 一个媒体内生效的区段 [{id,a,b}]（秒，按起点排序）；mediaRanges：全书各媒体的区段（页名 → 区段），供只播放书签区段（media.mjs）使用。
export function mediaRanges(book) {
  const out = new Map();
  for (const x of list(book))
    if (x.live && isMedia(x.bm)) {
      const name = book.pages[x.i].name;
      let r = out.get(name);
      if (!r) out.set(name, (r = []));
      r.push({ id: x.bm.id, a: x.bm.t, b: x.bm.end.t });
    }
  for (const r of out.values()) r.sort((a, b) => a.a - b.a);
  return out;
}
// 生效的图片区段的嵌套层级（core/sections.mjs 的 layers，按「页序 + 页内位置」）与媒体区段的层级（每个文件按时间各自分层）：起点书签 id → 层（0 起，最多 3 层）。
function levels(items) {
  const out = new Map(),
    groups = new Map();
  for (const x of items)
    if (x.live) {
      const g = isMedia(x.bm) ? x.i : -1;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(x);
    }
  for (const [g, xs] of groups) {
    const lv = layers(
      xs.map((x) => (g < 0 ? { a: coord(x.i, x.bm), b: coord(x.e, x.bm.end) } : { a: x.bm.t, b: x.bm.end.t })),
    );
    xs.forEach((x, k) => out.set(x.bm.id, lv[k]));
  }
  return out;
}
// 每页一份：n 为书签数（起点和普通书签，区段书签不计数）；mark / start / end 表示这一页出现的标记种类；
// ticks 为页内位置的细标记 [{f,kind,id,lv}]（只在缩略图栏画，媒体页不画位置标记；lv 为区段的嵌套层级，嵌套的向内缩进）。
// 暂不生效的区段，起点按普通书签显示，区段书签不画。
export function pageMarks(book) {
  const items = list(book),
    lvs = levels(items),
    out = new Map(),
    at = (i) => {
      let m = out.get(i);
      if (!m) out.set(i, (m = { n: 0, mark: false, start: false, end: false, ticks: [] }));
      return m;
    };
  for (const x of items) {
    if (x.i < 0) continue;
    const m = at(x.i);
    m.n++;
    const media = isMedia(x.bm);
    if (x.live) {
      m.start = true;
      const lv = lvs.get(x.bm.id) ?? 0;
      if (!media) m.ticks.push({ f: x.bm.f, kind: 'start', id: x.bm.id, lv });
      const e = at(x.e);
      e.end = true;
      if (!media) e.ticks.push({ f: x.bm.end.f, kind: 'end', id: x.bm.id, lv });
    } else {
      m.mark = true;
      if (!media) m.ticks.push({ f: x.bm.f, kind: 'mark', id: x.bm.id });
    }
  }
  return out;
}
export const sig = (m) =>
  [m.n, m.mark, m.start, m.end, ...m.ticks.map((t) => t.kind + t.f + t.id + ':' + (t.lv ?? ''))].join('|');
// 生效的区段覆盖的页：[{id,a,b,lv}]（a 起点页，b 区段书签所在页，lv 嵌套层级），全屏缩略图悬停 / 聚焦时标出范围，嵌套的向内缩进。
export function spans(book) {
  const items = list(book),
    lvs = levels(items);
  return items.filter((x) => x.live).map((x) => ({ id: x.bm.id, a: x.i, b: x.e, lv: lvs.get(x.bm.id) ?? 0 }));
}
