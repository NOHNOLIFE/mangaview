import test from 'node:test';
import assert from 'node:assert/strict';
import { line, before, recent } from '../../src/core/recent.mjs';

// list(book) 的结果（按起点排序）：i 起点所在页，e 区段书签所在页（没有为 -1）。
const item = (id, i, pos, end = null) => ({
  bm: { id, ...pos, ...(end ? { end: end.pos } : {}) },
  i,
  e: end ? end.e : -1,
});

test('一本书的线：页序 → 页内位置 / 时间，区段的起点和终点各算一项，页已不存在的不算', () => {
  const items = [
    item('a', 1, { f: 0.5 }, { e: 4, pos: { f: 0.2 } }),
    item('b', 2, { f: 0.3 }),
    item('m', 3, { t: 65 }, { e: 3, pos: { t: 200 } }),
    item('n', 3, { t: 120 }),
    item('g', -1, { f: 0.1 }),
    item('h', 5, { f: 0.9 }, { e: -1, pos: { f: 0.1 } }),
  ];
  assert.deepEqual(line(items), [
    { id: 'a', end: false, i: 1, v: 0.5 },
    { id: 'b', end: false, i: 2, v: 0.3 },
    { id: 'm', end: false, i: 3, v: 65 },
    { id: 'n', end: false, i: 3, v: 120 },
    { id: 'm', end: true, i: 3, v: 200 },
    { id: 'a', end: true, i: 4, v: 0.2 },
    { id: 'h', end: false, i: 5, v: 0.9 },
  ]);
});

test('最近书签：当前位置之前最近的一项，后面的不参与', () => {
  // 例：播放到 6:30，本文件 5:23 的书签最近，4:20 的更远，前面页的更远；7:00 的在后面不算。
  const items = [
    item('img', 0, { f: 0.5 }),
    item('t1', 1, { t: 260 }),
    item('t2', 1, { t: 323 }),
    item('t3', 1, { t: 420 }),
  ];
  const own = (b) => (b === 'A' ? line(items) : []);
  assert.deepEqual(recent(['A'], 'A', own, { i: 1, v: 390 }), { book: 'A', id: 't2', end: false });
  assert.deepEqual(
    recent(['A'], 'A', own, { i: 1, v: 100 }),
    { book: 'A', id: 'img', end: false },
    '本文件里还没到第一个',
  );
  assert.deepEqual(recent(['A'], 'A', own, { i: 0, v: 0.2 }), null, '前面没有书签：不高亮');
  assert.deepEqual(recent(['A'], 'A', own, { i: 0, v: 0.5 }), { book: 'A', id: 'img', end: false }, '正好在这里也算');
  assert.deepEqual(recent(['A'], 'A', own, { i: 9, v: 0 }), { book: 'A', id: 't3', end: false });
});

test('最近书签：区段只高亮离得最近的一端', () => {
  const items = [item('s', 1, { f: 0.5 }, { e: 6, pos: { f: 0.5 } }), item('p', 3, { f: 0.5 })];
  const own = () => line(items);
  assert.deepEqual(recent(['A'], 'A', own, { i: 2, v: 0 }), { book: 'A', id: 's', end: false }, '区段内：起点');
  assert.deepEqual(recent(['A'], 'A', own, { i: 4, v: 0 }), { book: 'A', id: 'p', end: false }, '区段内的普通书签更近');
  assert.deepEqual(recent(['A'], 'A', own, { i: 7, v: 0 }), { book: 'A', id: 's', end: true }, '区段之后：终点');
});

test('最近书签：本书前面没有时取列表里前面最近一本有书签的书的最后一项', () => {
  const marks = {
    A: line([item('a1', 0, { f: 0.5 }), item('a2', 2, { f: 0.5 }, { e: 5, pos: { f: 0.5 } })]),
    B: [],
    C: line([item('c1', 3, { f: 0.5 })]),
  };
  const entries = (b) => marks[b] ?? [];
  assert.deepEqual(recent(['A', 'B', 'C'], 'C', entries, { i: 1, v: 0 }), { book: 'A', id: 'a2', end: true });
  assert.deepEqual(recent(['A', 'B', 'C'], 'B', entries, { i: 0, v: 0 }), { book: 'A', id: 'a2', end: true });
  assert.deepEqual(recent(['A', 'B', 'C'], 'A', entries, { i: 0, v: 0.1 }), null, '列表开头之前没有');
  assert.deepEqual(recent(['A', 'B'], 'C', entries, { i: 1, v: 0 }), null, '当前书不在列表里：只看本书');
  assert.deepEqual(recent(['C'], 'C', entries, { i: 1, v: 0 }), null, '只看本书（书签面板）');
});

test('在前面：先比页序，同一页比位置（含相等）', () => {
  assert.equal(before({ i: 1, v: 0.9 }, { i: 2, v: 0 }), true);
  assert.equal(before({ i: 2, v: 0.5 }, { i: 2, v: 0.5 }), true);
  assert.equal(before({ i: 2, v: 0.6 }, { i: 2, v: 0.5 }), false);
  assert.equal(before({ i: 2, v: 0.6 }, { i: 2, v: Infinity }), true, '单文件模式：这一页上的都算');
  assert.equal(before({ i: 3, v: 0 }, { i: 2, v: Infinity }), false);
});
