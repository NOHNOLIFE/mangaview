import test from 'node:test';
import assert from 'node:assert/strict';
import { starts, union, layers, LAYERS } from '../../src/core/sections.mjs';

test('区段书签可选的起点：当前位置之前的书签，按位置排序，最后一个最近；已有区段的标明', () => {
  // 坐标：页序 + 页内位置。a 带区段 [1.5, 3.5]，b 在区段内，c 的区段暂不生效（null），d 在当前位置之后。
  const items = [
    { id: 'd', at: 9.5 },
    { id: 'b', at: 2.2 },
    { id: 'a', at: 1.5, end: 3.5 },
    { id: 'c', at: 5.1, end: null },
    { id: 'x', at: NaN },
  ];
  assert.deepEqual(starts(items, 7), [
    { id: 'a', at: 1.5, moves: true },
    { id: 'b', at: 2.2, moves: false },
    { id: 'c', at: 5.1, moves: true },
  ]);
  assert.deepEqual(
    starts(items, 2.2).map((m) => m.id),
    ['a'],
    '正好在当前位置的不算“之前”',
  );
  assert.deepEqual(starts(items, 1), [], '前面没有书签');
  assert.deepEqual(starts([], 5), []);
});

test('区段的并集：重叠、嵌套、首尾相接的合并成一段，按起点排序', () => {
  assert.deepEqual(
    union([
      { a: 10, b: 20 },
      { a: 2, b: 4 },
      { a: 12, b: 15 },
      { a: 18, b: 25 },
      { a: 4, b: 6 },
      { a: 30, b: 31 },
      { a: 9, b: 8 },
    ]),
    [
      { a: 2, b: 6 },
      { a: 10, b: 25 },
      { a: 30, b: 31 },
    ],
  );
  assert.deepEqual(union([]), []);
  // 端点可以是对象，按 at 换算后比较，输出保留原来的端点。
  const p = (i, f) => ({ i, f });
  assert.deepEqual(
    union(
      [
        { a: p(1, 0.5), b: p(4, 0.2) },
        { a: p(2, 0.1), b: p(6, 0.9) },
        { a: p(3, 0), b: p(3, 0.5) },
      ],
      (x) => x.i + x.f,
    ),
    [{ a: p(1, 0.5), b: p(6, 0.9) }],
  );
  const input = [{ a: 1, b: 3 }];
  union([...input, { a: 2, b: 5 }]);
  assert.deepEqual(input, [{ a: 1, b: 3 }], '不改动传入的区段');
});

test('区段分层：嵌套的深一层，交叉的错开，不相交的同一层，最多三层', () => {
  assert.equal(LAYERS, 3);
  const s = (a, b) => ({ a, b });
  assert.deepEqual(layers([s(0, 10), s(2, 4), s(5, 8), s(12, 14)]), [0, 1, 1, 0], '嵌套');
  assert.deepEqual(layers([s(0, 4), s(3, 8), s(7, 12)]), [0, 1, 0], '交叉：错开一层，与前一个不相交的回到外层');
  assert.deepEqual(layers([s(0, 4), s(4, 8)]), [0, 0], '首尾相接不算重叠');
  assert.deepEqual(layers([s(5, 6), s(0, 10)]), [1, 0], '与输入顺序无关：外层的先放');
  assert.deepEqual(layers([s(0, 10), s(1, 9), s(2, 8), s(3, 7), s(4, 6)]), [0, 1, 2, 2, 2], '更深的并入第三层');
  // 被包含的区段一定比包含它的深：A 包含 D，D 包含 C，即使 C 所在的位置在中间层空着。
  assert.deepEqual(layers([s(0, 10), s(1, 3), s(2, 8), s(5, 7)]), [0, 1, 2, 2]);
  assert.deepEqual(layers([s(0, 4), s(0, 4)]), [0, 1], '完全相同的两个区段也分开画');
  assert.deepEqual(layers([]), []);
});
