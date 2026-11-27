// 总控栏的纯逻辑（src/core/control.mjs）：模式归一化、速率的范围 / 档位 / 显示、各模式下的禁用规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES,
  modeOf,
  RATES,
  rateOf,
  stepRate,
  rateText,
  disabledControls,
  RIGHT,
  MEDIA_ONLY,
  ZONES,
  KEEP,
  arrange,
  nextMode,
} from '../../src/core/control.mjs';

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
  assert.deepEqual(MEDIA_ONLY, ['mediaPrev', 'mediaNext', 'order', 'playRate', 'volume', 'popout']);
  assert.deepEqual(RIGHT, MEDIA_ONLY);
  assert.deepEqual(off('comic', true), [...MEDIA_ONLY].sort());
  assert.deepEqual(off('mixed', true), ['order']);
  assert.deepEqual(off('media', true), ['scrollRate']);
  assert.deepEqual(off('mixed', false), [...MEDIA_ONLY].sort());
  assert.deepEqual(off('media', false), [...MEDIA_ONLY, 'play', 'scrollRate'].sort());
  assert.deepEqual(off('comic', false), [...MEDIA_ONLY].sort());
  // 中区的开关（播放模式、只播区段、单文件、循环）任何模式、有无媒体都可用
  for (const mode of ['comic', 'mixed', 'media'])
    for (const hasMedia of [true, false])
      for (const id of ['mode', 'sections', 'single', 'loop'])
        assert.ok(!disabledControls({ mode, hasMedia }).has(id), mode + ' ' + id);
});

test('三区排布：左 6、中 5、右 6，左右对称；循环在中区', () => {
  const ids = (z) => ZONES[z].filter((id) => id !== '|');
  assert.deepEqual(ids('left'), ['prevBook', 'toStart', 'toEnd', 'nextBook', 'crossBook', 'scrollRate']);
  assert.deepEqual(ZONES.mid, ['mode', 'sections', 'play', 'single', 'loop']);
  assert.deepEqual(ids('right'), ['mediaPrev', 'mediaNext', 'order', 'playRate', 'volume', 'popout']);
  assert.equal(ZONES.left.indexOf('|'), 4);
  assert.equal(ZONES.right.indexOf('|'), 3);
  assert.equal(ids('left').length + ZONES.mid.length + ids('right').length, 17);
  const every = [...ids('left'), ...ZONES.mid, ...ids('right')];
  assert.equal(new Set(every).size, every.length, 'Each control appears once');
});

test('窄窗口：左区留上一本 / 下一本，右区留下一个媒体 / 音量，其余收进本区的「⋯」；中区不收', () => {
  assert.deepEqual(arrange('left', false), { row: ZONES.left, more: [] });
  assert.deepEqual(arrange('left', true), {
    row: ['prevBook', 'nextBook', 'more'],
    more: ['toStart', 'toEnd', 'crossBook', 'scrollRate'],
  });
  assert.deepEqual(arrange('right', true), {
    row: ['mediaNext', 'volume', 'more'],
    more: ['mediaPrev', 'order', 'playRate', 'popout'],
  });
  assert.deepEqual(arrange('mid', true), { row: ZONES.mid, more: [] });
  assert.deepEqual(KEEP, { left: ['prevBook', 'nextBook'], right: ['mediaNext', 'volume'] });
  // 收起前后每个控件仍只出现一次
  for (const z of ['left', 'right']) {
    const { row, more } = arrange(z, true);
    assert.deepEqual(
      [...row.filter((id) => id !== 'more'), ...more].sort(),
      ZONES[z].filter((id) => id !== '|').sort(),
    );
  }
});

test('播放模式按钮：点击按漫画 → 混合 → 影音 → 漫画轮换，方向键反向也相接；坏值按混合', () => {
  assert.equal(nextMode('comic'), 'mixed');
  assert.equal(nextMode('mixed'), 'media');
  assert.equal(nextMode('media'), 'comic');
  assert.equal(nextMode('comic', -1), 'media');
  assert.equal(nextMode('mixed', -1), 'comic');
  assert.equal(nextMode('bogus'), 'media');
});
