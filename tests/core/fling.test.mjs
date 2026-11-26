import test from 'node:test';
import assert from 'node:assert/strict';
import { velocity, glide, TAU, REST, SPAN, MAX } from '../../src/core/fling.mjs';

test('velocity uses only the last moments before release', () => {
  // 先慢后快：只按最后 SPAN 毫秒算。
  const s = [];
  for (let t = 0; t <= 300; t += 10) s.push({ t, x: 0, y: t < 200 ? t * 0.1 : 20 + (t - 200) * 2 });
  const v = velocity(s, 300);
  assert.ok(Math.abs(v.y - 2) < 0.05, JSON.stringify(v));
  assert.equal(v.x, 0);
});

test('a pause before release gives no inertia', () => {
  const s = [
    { t: 0, x: 0, y: 0 },
    { t: 16, x: 0, y: 40 },
  ];
  assert.deepEqual(velocity(s, 16 + REST + 1), { x: 0, y: 0 });
  assert.ok(velocity(s, 20).y > 2);
});

test('a single sample or no movement gives no speed', () => {
  assert.deepEqual(velocity([], 0), { x: 0, y: 0 });
  assert.deepEqual(velocity([{ t: 5, x: 1, y: 1 }], 5), { x: 0, y: 0 });
});

test('very short windows reach back one sample, speed is capped', () => {
  const s = [
    { t: 0, x: 0, y: 0 },
    { t: SPAN - 5, x: 0, y: 100 },
    { t: SPAN + 1, x: 0, y: 110 },
  ];
  const v = velocity(s, SPAN + 1);
  assert.ok(Math.abs(v.y - 110 / (SPAN + 1)) < 1e-9, JSON.stringify(v));
  assert.equal(
    velocity(
      [
        { t: 0, x: 0, y: 0 },
        { t: 10, x: -1000, y: 0 },
      ],
      10,
    ).x,
    -MAX,
  );
});

test('glide decays exponentially and does not depend on the frame rate', () => {
  const one = glide(2, 100);
  assert.ok(Math.abs(one.v - 2 * Math.exp(-100 / TAU)) < 1e-12);
  // 每帧 16ms 走 100ms，与一次走 100ms 的距离、剩余速度相同。
  let v = 2,
    d = 0;
  for (let i = 0; i < 6; i++) {
    const g = glide(v, 100 / 6);
    d += g.d;
    v = g.v;
  }
  assert.ok(Math.abs(d - one.d) < 1e-9 && Math.abs(v - one.v) < 1e-12);
  // 总距离约为 起步速度 × TAU。
  assert.ok(Math.abs(glide(2, 1e6).d - 2 * TAU) < 1e-6);
  assert.deepEqual(glide(-1, 0), { d: -0, v: -1 });
});
