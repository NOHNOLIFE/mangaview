import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMedia,
  key,
  endKey,
  list,
  coord,
  coords,
  mediaRanges,
  pageMarks,
  sig,
  spans,
} from '../../src/marks/list.mjs';

const pages = ['a', 'b', 'c', 'v'].map((name) => ({ name }));
const book = (bookmarks) => ({ id: 'B', pages, bookmarks });

test('书签按页序、页内位置排列，文件已不存在的排在最后', () => {
  const b = book([
    { id: '1', name: 'c', f: 0.2, at: 1 },
    { id: '2', name: 'gone', f: 0.1, at: 2 },
    { id: '3', name: 'a', f: 0.9, at: 3 },
    { id: '4', name: 'a', f: 0.1, at: 4 },
    { id: '5', name: 'v', t: 3, at: 5 },
  ]);
  const items = list(b);
  assert.deepEqual(
    items.map((x) => x.bm.id),
    ['4', '3', '1', '5', '2'],
  );
  assert.deepEqual(
    items.map((x) => x.i),
    [0, 0, 2, 3, -1],
  );
  assert.equal(isMedia(items[3].bm), true);
  assert.equal(isMedia(items[0].bm), false);
});
test('区段书签：终点在起点之后才生效；媒体只在同一文件内按时间', () => {
  const b = book([
    { id: 's', name: 'a', f: 0.5, at: 1, end: { name: 'c', f: 0.1, at: 2 } },
    { id: 'r', name: 'c', f: 0.5, at: 3, end: { name: 'b', f: 0.1, at: 4 } },
    { id: 'm', name: 'v', t: 2, at: 5, end: { name: 'v', t: 8, at: 6 } },
    { id: 'n', name: 'v', t: 9, at: 7, end: { name: 'v', t: 4, at: 8 } },
  ]);
  const by = Object.fromEntries(list(b).map((x) => [x.bm.id, x]));
  assert.equal(by.s.live, true);
  assert.equal(by.s.e, 2);
  assert.equal(by.r.live, false);
  assert.equal(by.m.live, true);
  assert.equal(by.n.live, false);
  assert.equal(coord(2, { f: 0.25 }), 2.25);
  assert.deepEqual(coords(list(b)), [
    { id: 's', at: 0.5, end: 2.1 },
    { id: 'r', at: 2.5, end: null },
  ]);
  assert.deepEqual(coords(list(b), 3), [
    { id: 'm', at: 2, end: 8 },
    { id: 'n', at: 9, end: null },
  ]);
  assert.deepEqual([...mediaRanges(b)], [['v', [{ id: 'm', a: 2, b: 8 }]]]);
  assert.deepEqual(spans(b), [
    { id: 's', a: 0, b: 2, lv: 0 },
    { id: 'm', a: 3, b: 3, lv: 0 },
  ]);
});
test('每页的标记汇总：计数不含区段书签，媒体页不画页内细标记', () => {
  const b = book([
    { id: 's', name: 'a', f: 0.5, at: 1, end: { name: 'c', f: 0.1, at: 2 } },
    { id: 'p', name: 'a', f: 0.8, at: 3 },
    { id: 'm', name: 'v', t: 2, at: 5 },
  ]);
  const m = pageMarks(b);
  assert.deepEqual(m.get(0), {
    n: 2,
    mark: true,
    start: true,
    end: false,
    ticks: [
      { f: 0.5, kind: 'start', id: 's', lv: 0 },
      { f: 0.8, kind: 'mark', id: 'p' },
    ],
  });
  assert.deepEqual(m.get(2), {
    n: 0,
    mark: false,
    start: false,
    end: true,
    ticks: [{ f: 0.1, kind: 'end', id: 's', lv: 0 }],
  });
  assert.deepEqual(m.get(3), { n: 1, mark: true, start: false, end: false, ticks: [] });
  assert.equal(m.has(1), false);
  assert.equal(sig(m.get(3)), '1|true|false|false');
});
test('嵌套、交叉的区段：细标记和区段范围带嵌套层级，图片与每个媒体文件各自分层', () => {
  const b = book([
    { id: 'o', name: 'a', f: 0.1, at: 1, end: { name: 'c', f: 0.9, at: 2 } },
    { id: 'i', name: 'b', f: 0.2, at: 3, end: { name: 'b', f: 0.8, at: 4 } },
    { id: 'x', name: 'b', f: 0.5, at: 5, end: { name: 'c', f: 0.95, at: 6 } },
    { id: 'm', name: 'v', t: 2, at: 7, end: { name: 'v', t: 9, at: 8 } },
    { id: 'n', name: 'v', t: 3, at: 9, end: { name: 'v', t: 5, at: 10 } },
  ]);
  assert.deepEqual(
    spans(b).map((s) => [s.id, s.lv]),
    [
      ['o', 0],
      ['i', 1],
      ['x', 2],
      ['m', 0],
      ['n', 1],
    ],
  );
  const m = pageMarks(b);
  assert.deepEqual(
    m.get(1).ticks.map((t) => t.kind + ':' + t.id + ':' + t.lv),
    ['start:i:1', 'end:i:1', 'start:x:2'],
  );
  assert.notEqual(sig(m.get(1)), sig({ ...m.get(1), ticks: m.get(1).ticks.map((t) => ({ ...t, lv: 0 })) }));
});
test('书签缩略图键带书的 id，区段书签另加 :end', () => {
  assert.equal(key({ id: 'B' }, { id: 'x' }), 'B:bm:x');
  assert.equal(endKey({ id: 'B' }, { id: 'x' }), 'B:bm:x:end');
});
