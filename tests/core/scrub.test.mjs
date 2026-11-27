// 横向拖动快进 / 快退的纯逻辑（src/core/scrub.mjs）：方向判定、拖过全宽对应的秒数、整秒偏移与回差、目标时间。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECIDE, RATIO, SPAN_MIN, SPAN_MAX, direction, span, offset, target } from '../../src/core/scrub.mjs';

test('方向：没超过阈值不判定；明显横向才是定位，斜向、竖向是滚动', () => {
  assert.equal(RATIO, 2);
  assert.equal(direction(0, 0), null);
  assert.equal(direction(DECIDE, 0), null, 'at the threshold: not yet');
  assert.equal(direction(-DECIDE, DECIDE), null);
  assert.equal(direction(DECIDE + 1, 0), 'seek');
  assert.equal(direction(-(DECIDE + 1), 2), 'seek');
  assert.equal(direction(20, 10), 'seek', 'exactly twice as wide as tall');
  assert.equal(direction(20, 11), 'scroll');
  assert.equal(direction(10, -10), 'scroll', 'diagonal scrolls');
  assert.equal(direction(0, DECIDE + 1), 'scroll');
  assert.equal(direction(3, -40), 'scroll');
  assert.equal(direction(5, 1, 4), 'seek', 'custom threshold');
});

test('拖过全宽：时长的四分之一，限制在 30 秒到 5 分钟，不超过时长', () => {
  assert.deepEqual([SPAN_MIN, SPAN_MAX], [30, 300]);
  assert.equal(span(0), 0);
  assert.equal(span(null), 0);
  assert.equal(span(10), 10, 'short media: at most its duration');
  assert.equal(span(60), 30, 'at least 30 s');
  assert.equal(span(400), 100);
  assert.equal(span(1200), 300);
  assert.equal(span(7200), 300, 'at most 5 minutes');
});

test('偏移：按位移比例换算、取整秒；时长或宽度未知时为 0', () => {
  assert.equal(offset(0, 800, 400), 0);
  assert.equal(offset(800, 800, 400), 100);
  assert.equal(offset(-400, 800, 400), -50);
  assert.equal(offset(100, 800, 400), 13); // 12.5 → 13
  assert.equal(offset(-3, 800, 400), 0); // -0.375 → 0（不是 -0）
  assert.ok(Object.is(offset(-3, 800, 400), 0));
  assert.equal(offset(50, 0, 400), 0);
  assert.equal(offset(50, 800, 0), 0);
});

test('回差：指针在两个整秒的分界附近抖动时数字不来回跳，离开足够远才变', () => {
  const w = 1000,
    d = 4000; // span 300 s：每像素 0.3 秒
  let off = offset(5, w, d); // 1.5 → 2
  assert.equal(off, 2);
  for (const dx of [6, 5, 7, 5, 6]) {
    off = offset(dx, w, d, off); // 1.5 – 2.1：都在 2 ± 0.75 以内
    assert.equal(off, 2, 'jitter at ' + dx);
  }
  off = offset(4, w, d, off); // 1.2：离 2 超过 0.75 → 1
  assert.equal(off, 1);
  off = offset(5, w, d, off); // 1.5：没有回差会变成 2，离 1 不到 0.75，仍为 1
  assert.equal(off, 1);
  off = offset(10, w, d, off); // 3
  assert.equal(off, 3);
  // 结果只取决于这次的位移与上一次的值：同样的输入同样的输出
  assert.equal(offset(100, w, d, null), offset(100, w, d, null));
});

test('目标时间：起点加偏移，夹在 0 到时长之间', () => {
  assert.equal(target(10, 5, 60), 15);
  assert.equal(target(10, -30, 60), 0);
  assert.equal(target(50, 30, 60), 60);
  assert.equal(target(12.5, 3, 60), 15.5);
});
