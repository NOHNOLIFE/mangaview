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
