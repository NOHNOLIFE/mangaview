// 区段书签的规则，纯函数，不碰界面和存储（tests/core/sections.test.mjs 覆盖）：添加区段书签时可选的起点、区段的并集（只播放书签区段）、
// 嵌套 / 交叉区段的分层（缩略图栏的细标记、全屏缩略图的区段范围；进度条上的区段不分层）。
// 位置用一维坐标表示，坐标越大越靠后：图片书签为「页序 + 页内位置」（i+f，可以跨页比较），媒体书签为同一文件内的时间（秒）。
// 只有同一坐标系里的书签才互相配对（图片一组，每个媒体文件各一组），调用方先按坐标系分好组再传进来。
// 区段之间可以嵌套，也可以交叉：起点由用户在「选择起点」里选（marks/startpick.mjs），选哪个就配哪个。

// 添加区段书签时可选的起点。items：[{id, at, end}]（marks/list.mjs 的 coords）：at 是书签的坐标；end 是它的区段书签（终点）的坐标——
// 没有区段书签为 undefined，区段暂不生效（页序变化使终点排到起点之前、终点所在的页不存在）为 null。
// 返回坐标在 x 之前（at < x）的书签 [{id, at, moves}]，按坐标排序，最后一个就是离 x 最近的（默认选中它）；
// moves：它已有区段书签，选它即把终点移到 x。区段书签（终点）本身不在 items 里，不能作起点。
export const starts = (items, x) =>
  items
    .filter((m) => Number.isFinite(m.at) && m.at < x)
    .sort((p, q) => p.at - q.at)
    .map((m) => ({ id: m.id, at: m.at, moves: m.end !== undefined }));

// 并集：[{a, b}] 合并成按起点排序、互不重叠的 [{a, b}]：重叠、嵌套、首尾相接的合并成一段，不重复经过。
// at 把端点换成坐标（默认端点本身就是数）；输出保留原来的端点值（例如图片区段的 {i, f}）。终点在起点之前（或坐标无效）的区段忽略。
export function union(spans, at = (v) => v) {
  const out = [];
  for (const s of spans.filter((s) => at(s.b) >= at(s.a)).sort((p, q) => at(p.a) - at(q.a))) {
    const last = out.at(-1);
    if (last && at(s.a) <= at(last.b)) {
      if (at(s.b) > at(last.b)) last.b = s.b;
    } else out.push({ a: s.a, b: s.b });
  }
  return out;
}

// 分层：每个区段画在第几层（0 为最外层），与 spans 一一对应。规则：被别的区段包含（嵌套）的至少比包含它的深一层；
// 与先画的区段交叉时，取一个它们没有占用的层。按起点排序（同起点的长的在前）依次放置。最多 LAYERS 层，更深的并入最后一层。
export const LAYERS = 3;
export function layers(spans, at = (v) => v) {
  const n = spans.map((s) => ({ a: at(s.a), b: at(s.b), lv: 0 })),
    order = n.map((_, k) => k).sort((p, q) => n[p].a - n[q].a || n[q].b - n[p].b || p - q),
    placed = [];
  for (const k of order) {
    const s = n[k];
    let floor = 0;
    const used = new Set();
    for (const o of placed) {
      if (o.a <= s.a && s.b <= o.b) floor = Math.max(floor, o.lv + 1);
      else if (o.a < s.b && s.a < o.b) used.add(o.lv);
    }
    let lv = floor;
    while (used.has(lv)) lv++;
    s.lv = lv;
    placed.push(s);
  }
  return n.map((s) => Math.min(LAYERS - 1, s.lv));
}
