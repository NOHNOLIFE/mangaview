import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  MAX_DT,
  scrollSpeed,
  travel,
  stopsOf,
  next,
  imageSpans,
  covered,
  hasSections,
  nextBook,
  turnTo,
  chained,
  PAGE_MS,
  pageInterval,
  pagePlan,
  pageAfter,
  imageRuns,
  intersect,
} from '../../src/core/engine.mjs';

test('scroll speed: 1.0× scrolls 10% of the view per second, by real frame time', () => {
  assert.equal(BASE, 0.1);
  assert.equal(scrollSpeed(1, 800), 80);
  assert.equal(scrollSpeed(0.25, 800), 20);
  assert.equal(scrollSpeed(4, 800), 320);
  assert.equal(travel(80, 16), 1.28);
  // 小数位移照样累计（低速下每帧不到一像素）
  assert.ok(Math.abs(travel(scrollSpeed(0.25, 800), 16) - 0.32) < 1e-9);
  // 帧间隔有上限：卡顿、从后台回来不跳一大段；负数、缺省为 0
  assert.equal(travel(80, 5000), travel(80, MAX_DT));
  assert.equal(travel(80, -5), 0);
  assert.equal(travel(80), 0);
});

test('media stops sit at the middle of the page, clamped to where the view can reach', () => {
  const s = stopsOf(
    [
      { i: 3, top: 2000, bottom: 2400 },
      { i: 0, top: 0, bottom: 200 },
      { i: 9, top: 5000, bottom: 5100 },
    ],
    400,
    4800,
  );
  assert.deepEqual(s, [
    { i: 0, at: 400 },
    { i: 3, at: 2200 },
    { i: 9, at: 4800 },
  ]);
});

test('next step: scroll, stop and play, end of book', () => {
  const stops = [{ i: 2, at: 1000 }];
  assert.deepEqual(next({ c: 500, d: 10, lo: 400, hi: 3000, stops }), { type: 'scroll', to: 510 });
  // 这一帧会越过媒体中线：停在中线上播放
  assert.deepEqual(next({ c: 995, d: 10, lo: 400, hi: 3000, stops }), { type: 'play', i: 2, to: 1000 });
  // 已经在中线上（开始运行、回到开头时）也停
  assert.deepEqual(next({ c: 1000, d: 0, lo: 400, hi: 3000, stops }), { type: 'play', i: 2, to: 1000 });
  // 播过的跳过，接着滚
  assert.deepEqual(next({ c: 1000, d: 10, lo: 400, hi: 3000, stops, skip: new Set([2]) }), {
    type: 'scroll',
    to: 1010,
  });
  // 已过中线的不回头
  assert.deepEqual(next({ c: 1200, d: 10, lo: 400, hi: 3000, stops }), { type: 'scroll', to: 1210 });
  // 书末：先滚到尽头，再报告结束
  assert.deepEqual(next({ c: 2995, d: 10, lo: 400, hi: 3000 }), { type: 'scroll', to: 3000 });
  assert.deepEqual(next({ c: 3000, d: 10, lo: 400, hi: 3000 }), { type: 'end' });
  // 书尾的媒体无法居中：到尽头即停下播放，播完才结束
  const tail = [{ i: 7, at: 3000 }];
  assert.deepEqual(next({ c: 3000, d: 10, lo: 400, hi: 3000, stops: tail }), { type: 'play', i: 7, to: 3000 });
  assert.deepEqual(next({ c: 3000, d: 10, lo: 400, hi: 3000, stops: tail, skip: new Set([7]) }), { type: 'end' });
  // 漫画模式没有停靠点
  assert.deepEqual(next({ c: 995, d: 10, lo: 400, hi: 3000 }), { type: 'scroll', to: 1005 });
});

test('next step with sections only: scroll inside image sections, jump between them', () => {
  const spans = [
    { a: 1000, b: 1500 },
    { a: 3000, b: 3500 },
  ];
  const base = { lo: 400, hi: 5000, spans };
  // 不在区段里：直接跳到下一个区段的起点
  assert.deepEqual(next({ ...base, c: 400, d: 10 }), { type: 'jump', to: 1000 });
  assert.deepEqual(next({ ...base, c: 2000, d: 10 }), { type: 'jump', to: 3000 });
  // 区段里照常滚动
  assert.deepEqual(next({ ...base, c: 1200, d: 10 }), { type: 'scroll', to: 1210 });
  // 到区段终点：跳到下一个区段起点
  assert.deepEqual(next({ ...base, c: 1495, d: 10 }), { type: 'jump', to: 3000 });
  // 最后一个区段之后：结束
  assert.deepEqual(next({ ...base, c: 3495, d: 10 }), { type: 'end' });
  // 区段之间有自带区段的媒体：先去它那里播放
  const stops = [
    { i: 4, at: 2200 },
    { i: 2, at: 1300 },
  ].sort((x, y) => x.at - y.at);
  assert.deepEqual(next({ ...base, stops, c: 1495, d: 10 }), { type: 'play', i: 4, to: 2200 });
  assert.deepEqual(next({ ...base, stops, c: 2200, d: 10, skip: new Set([4]) }), { type: 'jump', to: 3000 });
  // 区段之内的媒体：滚到它的中线停下
  assert.deepEqual(next({ ...base, stops, c: 1295, d: 10 }), { type: 'play', i: 2, to: 1300 });
  // 区段终点在书尾之后：滚到书尾即结束
  const late = { lo: 400, hi: 2000, spans: [{ a: 1000, b: 2600 }] };
  assert.deepEqual(next({ ...late, c: 1995, d: 10 }), { type: 'scroll', to: 2000 });
  assert.deepEqual(next({ ...late, c: 2000, d: 10 }), { type: 'end' });
  // 相邻的区段：接着滚，不算跳
  const adj = {
    lo: 400,
    hi: 5000,
    spans: [
      { a: 1000, b: 1500 },
      { a: 1500, b: 1800 },
    ],
  };
  assert.deepEqual(next({ ...adj, c: 1495, d: 10 }), { type: 'scroll', to: 1500 });
});

test('image sections from the bookmark list, media covered by them', () => {
  const items = [
    { bm: { f: 0.5, end: { f: 0.2 } }, i: 1, e: 4, live: true },
    { bm: { f: 0.1 }, i: 6, e: -1, live: false },
    { bm: { t: 3, end: { t: 9 } }, i: 7, e: 7, live: true },
    { bm: { f: 0.5, end: { f: 0.5 } }, i: 0, e: 0, live: true },
    { bm: { f: 0.9, end: { f: 0.1 } }, i: 8, e: 5, live: false },
  ];
  const spans = imageSpans(items);
  assert.deepEqual(spans, [
    { a: { i: 0, f: 0.5 }, b: { i: 0, f: 0.5 } },
    { a: { i: 1, f: 0.5 }, b: { i: 4, f: 0.2 } },
  ]);
  assert.equal(covered(spans, 2), true);
  assert.equal(covered(spans, 3), true);
  assert.equal(covered(spans, 1), false, 'Starts in the middle of the page');
  assert.equal(covered(spans, 4), false, 'Ends in the middle of the page');
  assert.equal(covered([{ a: { i: 2, f: 0 }, b: { i: 3, f: 0 } }], 2), true, 'Exactly the page');
  assert.equal(hasSections(items), true);
  assert.equal(hasSections([items[1]]), false);
  assert.equal(hasSections([]), false);
});

test('image sections nest and cross: running goes through their union once', () => {
  const sec = (i, f, e, g) => ({ bm: { f, end: { f: g } }, i, e, live: true });
  // [1.5, 6.5] 包含 [2.5, 3.5]；[6, 9.2] 与它交叉；[11, 12] 单独一段。
  const spans = imageSpans([sec(2, 0.5, 3, 0.5), sec(1, 0.5, 6, 0.5), sec(6, 0, 9, 0.2), sec(11, 0, 12, 0)]);
  assert.deepEqual(spans, [
    { a: { i: 1, f: 0.5 }, b: { i: 9, f: 0.2 } },
    { a: { i: 11, f: 0 }, b: { i: 12, f: 0 } },
  ]);
  assert.equal(covered(spans, 7), true, 'A page covered only by the union of two crossing sections');
  // 单文件模式：与并集有重叠的页都经过，各页只出现一次。
  assert.deepEqual(
    pagePlan({ n: 13, spans })
      .map((x, j) => (x ? j : null))
      .filter((j) => j != null),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
  );
});

test('next book across the reading list', () => {
  const [a, b, c] = ['a', 'b', 'c'];
  assert.equal(nextBook([a, b, c], a, false), b);
  assert.equal(nextBook([a, b, c], c, false), null, 'Stops after the last book');
  assert.equal(nextBook([a, b, c], c, true), a, 'Loop: back to the first');
  assert.equal(
    nextBook([a, b, c], a, false, (x) => x !== b),
    c,
    'Skips books without content',
  );
  assert.equal(
    nextBook([a, b, c], b, true, (x) => x === b),
    b,
    'Loop may come back to the same book',
  );
  assert.equal(
    nextBook([a, b, c], b, false, (x) => x === a),
    null,
  );
  assert.equal(nextBook([a, b, c], 'x', false), a, 'Not in the list: starts from the first');
  assert.equal(nextBook([], a, true), null);
});

test('turning a screen lands on a video that comes into range', () => {
  const base = { step: 736, viewH: 800, max: 10000 };
  // 没有视频进入：照常翻一屏
  assert.equal(turnTo({ ...base, top: 0, d: 1, videos: [] }), 736);
  assert.equal(turnTo({ ...base, top: 0, d: 1, videos: [{ mid: 3000 }] }), 736);
  // 有视频的中线进入视窗：落在它居中处
  assert.equal(turnTo({ ...base, top: 0, d: 1, videos: [{ mid: 1300 }, { mid: 1500 }] }), 900);
  // 已在视窗里的视频不算
  assert.equal(turnTo({ ...base, top: 0, d: 1, videos: [{ mid: 700 }] }), 736);
  // 往上翻取最靠后（离原视窗最近）的一个
  assert.equal(turnTo({ ...base, top: 2000, d: -1, videos: [{ mid: 1300 }, { mid: 1500 }] }), 1100);
  // 夹在可滚动范围内
  assert.equal(turnTo({ ...base, top: 9000, d: 1, max: 9500, videos: [{ mid: 9900 }] }), 9500);
  assert.equal(turnTo({ ...base, top: 500, d: -1, videos: [{ mid: 100 }] }), 0);
});

test('single file mode: one page every 5 s at 1.0×, interval = 5 s ÷ scroll speed', () => {
  assert.equal(PAGE_MS, 5000);
  assert.equal(pageInterval(1), 5000);
  assert.equal(pageInterval(2), 2500);
  assert.equal(pageInterval(0.25), 20000);
  assert.equal(pageInterval(4), 1250);
  assert.equal(pageInterval(0), 5000);
});

test('single file mode: comic passes the images and skips media pages, mixed stops at media to play them', () => {
  // 没有停靠的媒体、没有要跳过的页：每页都按间隔显示
  const all = pagePlan({ n: 4 });
  assert.deepEqual(all, ['show', 'show', 'show', 'show']);
  assert.deepEqual(pageAfter(all, 0), { type: 'show', i: 1 });
  assert.deepEqual(pageAfter(all, 3), { type: 'end' });
  // 漫画模式：第 1、2 页是视频、音频，换页时跳过
  const comic = pagePlan({ n: 5, away: new Set([1, 2]) });
  assert.deepEqual(comic, ['show', null, null, 'show', 'show']);
  assert.deepEqual(pageAfter(comic, 0), { type: 'show', i: 3 });
  assert.deepEqual(pageAfter(pagePlan({ n: 3, away: new Set([2]) }), 1), { type: 'end' }, 'A media page at the end');
  // 与只播区段一起：只经过区段内的图片
  const sec = [{ a: { i: 0, f: 0.5 }, b: { i: 3, f: 0.5 } }];
  assert.deepEqual(pagePlan({ n: 5, spans: sec, away: new Set([1]) }), ['show', null, 'show', 'show', null]);
  // 混合模式：第 1、3 页是应播的媒体
  const mixed = pagePlan({ n: 5, stops: new Set([1, 3]) });
  assert.deepEqual(mixed, ['show', 'play', 'show', 'play', 'show']);
  assert.deepEqual(pageAfter(mixed, 0), { type: 'play', i: 1 });
  assert.deepEqual(pageAfter(mixed, 1), { type: 'show', i: 2 });
  assert.deepEqual(pageAfter(mixed, 4), { type: 'end' });
  // 从书首之前开始（-1）：第一页
  assert.deepEqual(pageAfter(mixed, -1), { type: 'show', i: 0 });
  assert.deepEqual(pageAfter(pagePlan({ n: 0 }), -1), { type: 'end' });
});

test('single file mode with sections only: only pages inside image sections, plus the media that should play', () => {
  const span = (ai, af, bi, bf) => ({ a: { i: ai, f: af }, b: { i: bi, f: bf } });
  // 区段 1.5–3.2 覆盖第 1、2、3 页；区段 6.0–7.0 只覆盖第 6 页（终点正好在第 7 页页首）
  const spans = [span(1, 0.5, 3, 0.2), span(6, 0, 7, 0)];
  const plan = pagePlan({ n: 9, spans, stops: new Set([5]) });
  assert.deepEqual(plan, [null, 'show', 'show', 'show', null, 'play', 'show', null, null]);
  assert.deepEqual(pageAfter(plan, 0), { type: 'show', i: 1 });
  assert.deepEqual(pageAfter(plan, 3), { type: 'play', i: 5 });
  assert.deepEqual(pageAfter(plan, 5), { type: 'show', i: 6 });
  assert.deepEqual(pageAfter(plan, 6), { type: 'end' });
  // 起点和终点在同一页的区段（同一处）也经过那一页
  assert.deepEqual(pagePlan({ n: 3, spans: [span(1, 0.4, 1, 0.4)] }), [null, 'show', null]);
});

test('mixed mode: a media page right after the one that finished is positioned directly, not scrolled to', () => {
  const stops = [
    { i: 2, at: 1000 },
    { i: 3, at: 1600 },
    { i: 6, at: 3000 },
  ];
  // 第 2 页播完，第 3 页紧挨着也是要播的媒体：直接居中播放
  assert.deepEqual(chained(stops, 2), { type: 'play', i: 3, to: 1600 });
  // 第 3 页之后隔着图片（第 4、5 页）：照常滚动
  assert.equal(chained(stops, 3), null);
  // 下一页是媒体但不在要播的里（只播区段时没有区段、播不了被跳过）：照常
  assert.equal(chained(stops, 3, new Set()), null);
  assert.equal(chained(stops, 2, new Set([3])), null);
  // 最后一个媒体之后：照常（书末由 next 处理）
  assert.equal(chained(stops, 6), null);
  assert.equal(chained([], 0), null);
});

test('comic mode runs: consecutive images form a run from its top at the view top to its bottom at the view bottom', () => {
  // 页：0 图 0–1000、1 图 1000–2000、2 视频 2000–2500、3 图 2500–2800（比视窗短）、4 音频 2800–3000、5 图 3000–5000
  const starts = [0, 1000, 2000, 2500, 2800, 3000, 5000],
    kinds = ['i', 'i', 'v', 'i', 'a', 'i'],
    H = 800,
    lo = 400,
    hi = 4600;
  const runs = imageRuns({ starts, image: (i) => kinds[i] === 'i', H, lo, hi });
  assert.deepEqual(runs, [
    { a: 400, b: 1600 }, // 第 0–1 页：段尾 2000 到达视窗底时中线 1600
    { a: 2900, b: 2900, hold: 300 }, // 第 3 页比视窗短：段首在视窗顶，停留 300 像素的时间
    { a: 3400, b: 4600 },
  ]);
  // 没有图片 / 全是图片
  assert.deepEqual(imageRuns({ starts: [0, 500, 900], image: () => false, H, lo, hi: 500 }), []);
  assert.deepEqual(imageRuns({ starts: [0, 500, 3000], image: () => true, H, lo, hi: 2600 }), [{ a: 400, b: 2600 }]);
  // 书尾的短段：夹在中线的范围内
  assert.deepEqual(imageRuns({ starts: [0, 2000, 2300], image: (i) => i === 1, H, lo, hi: 1900 }), [
    { a: 1900, b: 1900, hold: 300 },
  ]);
});

test('comic mode: scroll inside a run, jump over media to the next run, hold on a short run, end after the last', () => {
  const spans = [
    { a: 400, b: 1600 },
    { a: 2900, b: 2900, hold: 300 },
    { a: 3400, b: 4600 },
  ];
  const base = { lo: 400, hi: 4600, spans };
  assert.deepEqual(next({ ...base, c: 400, d: 10 }), { type: 'scroll', to: 410 });
  assert.deepEqual(next({ ...base, c: 1585, d: 10 }), { type: 'scroll', to: 1595 });
  assert.deepEqual(
    next({ ...base, c: 1595, d: 10 }),
    { type: 'jump', to: 2900 },
    'This frame reaches the end of the run',
  );
  // 段尾到达视窗底：直接跳到下一段（短段）的开头
  assert.deepEqual(next({ ...base, c: 1600, d: 10 }), { type: 'jump', to: 2900 });
  // 在短段上原地停留，累计到段高后跳到下一段
  assert.deepEqual(next({ ...base, c: 2900, d: 10 }), { type: 'hold' });
  assert.deepEqual(next({ ...base, c: 2900.4, d: 10, held: 290 }), { type: 'hold' }, 'Rounded scroll position');
  assert.deepEqual(next({ ...base, c: 2899.6, d: 10, held: 300 }), { type: 'jump', to: 3400 });
  // 停在媒体上（开始运行时）：跳到后面最近的一段
  assert.deepEqual(next({ ...base, c: 2200, d: 10 }), { type: 'jump', to: 2900 });
  // 最后一段的尽头
  assert.deepEqual(next({ ...base, c: 4600, d: 10 }), { type: 'end' });
  assert.deepEqual(next({ lo: 400, hi: 4600, spans: [], c: 400, d: 10 }), { type: 'end' }, 'No images');
});

test('comic mode with sections only: intersect the image runs with the sections', () => {
  const runs = [
    { a: 400, b: 1600 },
    { a: 2900, b: 2900, hold: 300 },
    { a: 3400, b: 4600 },
  ];
  // 区段 1000–3000 盖住第一段的后半、短段与视频；区段 4000–4200
  assert.deepEqual(
    intersect(runs, [
      { a: 1000, b: 3000 },
      { a: 4000, b: 4200 },
    ]),
    [
      { a: 1000, b: 1600 },
      { a: 2900, b: 2900, hold: 300 },
      { a: 4000, b: 4200 },
    ],
  );
  // 区段不盖住短段：短段不经过；区段落在媒体上：没有交集
  assert.deepEqual(intersect(runs, [{ a: 2000, b: 2500 }]), []);
  assert.deepEqual(intersect(runs, []), []);
  // 交换次序结果相同
  assert.deepEqual(intersect([{ a: 1000, b: 3000 }], runs), [
    { a: 1000, b: 1600 },
    { a: 2900, b: 2900, hold: 300 },
  ]);
});
