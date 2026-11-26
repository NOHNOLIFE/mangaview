// 总控栏的纯逻辑（src/core/control.mjs）：模式归一化、速率的范围 / 档位 / 显示、各模式下的禁用规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeOf, RATES, rateOf, stepRate, rateText, disabledControls, RIGHT } from '../../src/core/control.mjs';

test('模式：三种，默认（及读到坏值时）为混合', () => {
  assert.deepEqual(MODES, ['comic', 'mixed', 'media']);
  for (const m of MODES) assert.equal(modeOf(m), m);
  for (const v of [null, undefined, '', 'video', 3, {}]) assert.equal(modeOf(v), 'mixed');
});

test('速率：滚动 0.25×–4×、播放 0.5×–3×，坏值为 1，按 0.05 取整', () => {
  assert.equal(rateOf(null, 'scroll'), 1);
  assert.equal(rateOf('abc', 'play'), 1);
  assert.equal(rateOf(0, 'scroll'), 1);
  assert.equal(rateOf(-2, 'play'), 1);
  assert.equal(rateOf(0.1, 'scroll'), 0.25);
  assert.equal(rateOf(9, 'scroll'), 4);
  assert.equal(rateOf(0.25, 'play'), 0.5);
  assert.equal(rateOf(5, 'play'), 3);
  assert.equal(rateOf(1.2345, 'play'), 1.25);
  assert.equal(rateOf('1.5', 'scroll'), 1.5);
  for (const k of ['scroll', 'play']) {
    const r = RATES[k];
    assert.ok(r.steps.includes(1) && r.presets.includes(1), k + ' includes 1.0×');
    assert.ok(
      r.steps.every((x, i) => i === 0 || x > r.steps[i - 1]),
      k + ' steps ascend',
    );
    assert.equal(r.steps[0], r.min);
    assert.equal(r.steps.at(-1), r.max);
  }
});

test('逐档调整：取相邻的档位，两端不变；不在档位上的值走到最近的一档', () => {
  assert.equal(stepRate(1, 1, 'scroll'), 1.25);
  assert.equal(stepRate(1, -1, 'scroll'), 0.75);
  assert.equal(stepRate(4, 1, 'scroll'), 4);
  assert.equal(stepRate(0.25, -1, 'scroll'), 0.25);
  assert.equal(stepRate(1.1, 1, 'play'), 1.25);
  assert.equal(stepRate(1.1, -1, 'play'), 1);
  assert.equal(stepRate(3, 1, 'play'), 3);
  assert.equal(stepRate(0.5, -1, 'play'), 0.5);
});

test('速率的显示：整十分位一位小数，否则两位', () => {
  assert.equal(rateText(1), '1.0×');
  assert.equal(rateText(0.5), '0.5×');
  assert.equal(rateText(0.25), '0.25×');
  assert.equal(rateText(1.25), '1.25×');
  assert.equal(rateText(4), '4.0×');
  assert.equal(rateText(1.3), '1.3×');
});

test('禁用规则：漫画模式右区全部；影音模式滚动速率；混合模式播放顺序；没有媒体时右区全部，影音模式下大播放键也禁用', () => {
  const off = (mode, hasMedia) => [...disabledControls({ mode, hasMedia })].sort();
  assert.deepEqual(off('comic', true), [...RIGHT].sort());
  assert.deepEqual(off('mixed', true), ['order']);
  assert.deepEqual(off('media', true), ['scrollRate']);
  assert.deepEqual(off('mixed', false), [...RIGHT].sort());
  assert.deepEqual(off('media', false), [...RIGHT, 'play', 'scrollRate'].sort());
  assert.deepEqual(off('comic', false), [...RIGHT].sort());
});
