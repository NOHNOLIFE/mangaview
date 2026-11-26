import test from 'node:test';
import assert from 'node:assert/strict';
import { pair, ranges, fits } from '../../src/core/sections.mjs';

test('区段书签配对：在区段内更新终点，否则配给前面最近的区段或普通书签', () => {
  // 坐标：页序 + 页内位置。a 带区段 [1.5, 3.5]，b 在区段内（不参与配对），c 在区段之后，d 在当前位置之后。
  const items = [
    { id: 'a', at: 1.5, end: 3.5 },
    { id: 'b', at: 2.2 },
    { id: 'c', at: 5.1 },
    { id: 'd', at: 9.5 },
  ];
  assert.deepEqual(pair(items, 3), { kind: 'update', id: 'a', inside: true }, '在区段内：更新这个区段的终点（可缩短）');
  assert.deepEqual(pair(items, 1.5), { kind: 'update', id: 'a', inside: true }, '区段两端算在区段内');
  assert.deepEqual(pair(items, 3.5), { kind: 'update', id: 'a', inside: true });
  assert.deepEqual(pair(items, 4), { kind: 'update', id: 'a', inside: false }, '最近的是区段：延长它');
  assert.deepEqual(
    pair(items, 7),
    { kind: 'create', id: 'c', inside: false },
    '最近的是不在区段内的普通书签：以它为起点新建',
  );
  assert.deepEqual(
    pair(items, 5.1),
    { kind: 'create', id: 'c', inside: false },
    '坐标相同也算在前面（是否太近由界面判断）',
  );
  assert.equal(pair(items, 1), null, '前面什么都没有');
  assert.equal(pair([], 3), null);
  // 区段内的普通书签不参与配对：区段之后要延长的仍是区段本身。
  assert.deepEqual(
    pair(
      [
        { id: 'a', at: 1, end: 5 },
        { id: 'b', at: 4.9 },
      ],
      6,
    ),
    { kind: 'update', id: 'a', inside: false },
  );
  // 暂不生效的区段（end 为 null）按起点算远近，配到它即更新终点；不在任何区段内的位置不受它影响。
  assert.deepEqual(
    pair(
      [
        { id: 'a', at: 2, end: null },
        { id: 'b', at: 1 },
      ],
      3,
    ),
    { kind: 'update', id: 'a', inside: false },
  );
  assert.deepEqual(
    pair(
      [
        { id: 'a', at: 2, end: null },
        { id: 'b', at: 2.5 },
      ],
      3,
    ),
    { kind: 'create', id: 'b', inside: false },
  );
  // 图片已不存在的书签（坐标 NaN）忽略。
  assert.deepEqual(
    pair(
      [
        { id: 'x', at: NaN },
        { id: 'b', at: 1 },
      ],
      3,
    ),
    { kind: 'create', id: 'b', inside: false },
  );
  // 同一坐标上优先选生效的区段。
  assert.deepEqual(
    pair(
      [
        { id: 'n', at: 4 },
        { id: 'a', at: 1, end: 4 },
      ],
      6,
    ),
    { kind: 'update', id: 'a', inside: false },
  );
});
test('区段书签不嵌套、不交叉：按规则依次添加的结果始终互不重叠', () => {
  // 随机地添加书签和区段书签，任何时候生效的区段都两两不重叠，且区段内的普通书签不会成为起点。
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let round = 0; round < 200; round++) {
    const items = [];
    let n = 0;
    for (let step = 0; step < 25; step++) {
      const x = Math.round(rand() * 2000) / 100;
      if (rand() < 0.5) {
        items.push({ id: 'm' + n++, at: x });
        continue;
      }
      const r = pair(items, x);
      if (!r) continue;
      const m = items.find((m) => m.id === r.id);
      if (x <= m.at) continue;
      m.end = x;
      const spans = ranges(items);
      for (let i = 1; i < spans.length; i++) assert.ok(spans[i].a > spans[i - 1].b, '区段互不重叠');
    }
  }
  assert.deepEqual(
    ranges([
      { id: 'a', at: 1, end: 2 },
      { id: 'b', at: 0, end: null },
      { id: 'c', at: 3 },
    ]),
    [{ id: 'a', a: 1, b: 2 }],
    '只列出生效的区段',
  );
  assert.equal(fits([{ id: 'a', at: 1, end: 3 }], 'b', 4, 6), true);
  assert.equal(fits([{ id: 'a', at: 1, end: 3 }], 'b', 2, 6), false, '交叉');
  assert.equal(fits([{ id: 'a', at: 1, end: 3 }], 'b', 0, 6), false, '嵌套');
  assert.equal(fits([{ id: 'a', at: 1, end: 3 }], 'a', 1, 6), true, '自己不算冲突');
  assert.equal(fits([], 'a', 3, 3), false, '终点必须在起点之后');
});
