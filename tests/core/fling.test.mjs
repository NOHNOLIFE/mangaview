import test from 'node:test';
import assert from 'node:assert/strict';
import { velocity, glide, stack, TAU, KNEE, REST, SPAN, START, MAX } from '../../src/core/fling.mjs';

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

test('fast flings decay slower: the cap is 20 px/ms and the fastest one glides about 12000px', () => {
  assert.equal(MAX, 20);
  const far = glide(MAX, 1e7).d;
  assert.ok(far > 11000 && far < 13000, String(far));
  // 低速段与原来相同（纯指数衰减）；8 px/ms 与原来的上限滑行距离相近（原来约 2600px）。
  assert.ok(Math.abs(glide(KNEE, 1e7).d - KNEE * TAU) < 1e-6);
  assert.ok(Math.abs(glide(8, 1e7).d - 2600) < 200);
  // 高速时相对衰减更慢：同样 100ms，20 px/ms 剩下的比例高于 2 px/ms。
  assert.ok(glide(20, 100).v / 20 > glide(2, 100).v / 2);
  // 减速度在 KNEE 处连续：刚过 KNEE 与刚低于 KNEE 的 1ms 速度损失几乎相同。
  const above = KNEE + 1e-6 - glide(KNEE + 1e-6, 1).v,
    below = KNEE - 1e-6 - glide(KNEE - 1e-6, 1).v;
  assert.ok(Math.abs(above - below) < 1e-4, [above, below].join());
  // 跨过 KNEE 的一段也与帧率无关；方向对称。
  const one = glide(15, 2000);
  let v = 15,
    d = 0;
  for (let i = 0; i < 120; i++) {
    const g = glide(v, 2000 / 120);
    d += g.d;
    v = g.v;
  }
  assert.ok(Math.abs(d - one.d) < 1e-6 && Math.abs(v - one.v) < 1e-9, [d, one.d, v, one.v].join());
  assert.deepEqual(glide(-15, 300), { d: -glide(15, 300).d, v: -glide(15, 300).v });
});

test('flinging again in the same direction while still gliding adds up, capped', () => {
  assert.equal(stack(3, 4), 7);
  assert.equal(stack(-3, -4), -7);
  assert.equal(stack(15, 10), MAX);
  assert.equal(stack(-15, -10), -MAX);
  // 反方向、没有滑行、新的一甩太慢（不滑行）：只按新速度
  assert.equal(stack(3, -4), -4);
  assert.equal(stack(0, 4), 4);
  assert.equal(stack(3, START / 2), START / 2);
});
