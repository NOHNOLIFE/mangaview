// 总控栏的纯逻辑（src/core/control.mjs）：模式归一化、速率的范围 / 档位 / 显示、循环的三态、各模式下的禁用规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES,
  modeOf,
  RATES,
  rateOf,
  stepRate,
  rateText,
  rateLabel,
  RATE_STEP,
  disabledControls,
  RIGHT,
  MEDIA_ONLY,
  ZONES,
  KEEP,
  arrange,
  nextMode,
  LOOPS,
  loopOf,
  nextLoop,
} from '../../src/core/control.mjs';

test('模式：三种，默认（及读到坏值时）为混合', () => {
  assert.deepEqual(MODES, ['comic', 'mixed', 'media']);
  for (const m of MODES) assert.equal(modeOf(m), m);
  for (const v of [null, undefined, '', 'video', 3, {}]) assert.equal(modeOf(v), 'mixed');
});

test('速率：滚动 0.2–4.0、播放 0.5–3.0，坏值为 1，按 0.1 取整并夹在范围内（旧值读入时同样）', () => {
  assert.equal(RATE_STEP, 0.1);
  assert.equal(rateOf(null, 'scroll'), 1);
  assert.equal(rateOf('abc', 'play'), 1);
  assert.equal(rateOf(0, 'scroll'), 1);
  assert.equal(rateOf(-2, 'play'), 1);
  assert.equal(rateOf(0.1, 'scroll'), 0.2);
  assert.equal(rateOf(9, 'scroll'), 4);
  assert.equal(rateOf(0.3, 'play'), 0.5);
  assert.equal(rateOf(5, 'play'), 3);
  assert.equal(rateOf('1.5', 'scroll'), 1.5);
  // 旧版本按 0.05 一档存下的值：取整到 0.1
  assert.equal(rateOf(0.25, 'scroll'), 0.3);
  assert.equal(rateOf(1.25, 'play'), 1.3);
  assert.equal(rateOf(1.75, 'play'), 1.8);
  assert.equal(rateOf(1.2345, 'play'), 1.2);
  for (const k of ['scroll', 'play']) {
    const r = RATES[k];
    assert.ok(r.presets.includes(1), k + ' presets include 1.0');
    assert.ok(
      r.presets.every((x, i) => (i === 0 || x > r.presets[i - 1]) && x >= r.min && x <= r.max),
      k + ' presets ascend within the range',
    );
    for (const x of r.presets) assert.equal(rateOf(x, k), x, k + ' preset ' + x + ' is on the 0.1 grid');
  }
  assert.deepEqual([RATES.scroll.min, RATES.scroll.max, RATES.play.min, RATES.play.max], [0.2, 4, 0.5, 3]);
});

test('逐档调整：每次 0.1，两端不变；不在 0.1 档上的旧值先取整', () => {
  assert.equal(stepRate(1, 1, 'scroll'), 1.1);
  assert.equal(stepRate(1, -1, 'scroll'), 0.9);
  assert.equal(stepRate(4, 1, 'scroll'), 4);
  assert.equal(stepRate(0.2, -1, 'scroll'), 0.2);
  assert.equal(stepRate(0.3, -1, 'scroll'), 0.2);
  assert.equal(stepRate(3, 1, 'play'), 3);
  assert.equal(stepRate(0.5, -1, 'play'), 0.5);
  assert.equal(stepRate(1.25, 1, 'play'), 1.4);
  // 连续逐档不累积浮点误差
  let v = 0.2;
  for (let i = 0; i < 38; i++) v = stepRate(v, 1, 'scroll');
  assert.equal(v, 4);
  for (let i = 0; i < 15; i++) v = stepRate(v, -1, 'play'); // 4 读作播放速率时夹到 3
  assert.equal(v, 1.5);
});

test('速率的显示：一位小数、不带单位；提示与面板里带「×」', () => {
  assert.equal(rateText(1), '1.0');
  assert.equal(rateText(0.5), '0.5');
  assert.equal(rateText(4), '4.0');
  assert.equal(rateText(1.3), '1.3');
  assert.equal(rateText(0.30000000000000004), '0.3');
  assert.equal(rateLabel(1.5), '1.5×');
  for (const k of ['scroll', 'play'])
    for (let v = RATES[k].min; v <= RATES[k].max + 1e-9; v = stepRate(v, 1, k) + (v === RATES[k].max ? 1 : 0))
      assert.equal(rateText(v).length, 3, k + ' ' + v + ': the same width for every value');
});

test('禁用规则：右区不随模式禁用，书里没有媒体时右区（字幕除外）全部；影音模式滚动速率，没有媒体时连同大按钮；漫画模式没有图片时大按钮', () => {
  const off = (mode, hasMedia, hasImages = true) => [...disabledControls({ mode, hasMedia, hasImages })].sort();
  assert.deepEqual(MEDIA_ONLY, ['mediaPrev', 'mediaNext', 'playRate', 'volume']);
  assert.deepEqual(RIGHT, [...MEDIA_ONLY, 'subs']);
  assert.deepEqual(off('comic', true), []);
  assert.deepEqual(off('mixed', true), []);
  assert.deepEqual(off('media', true), ['scrollRate']);
  assert.deepEqual(off('mixed', false), [...MEDIA_ONLY].sort());
  assert.deepEqual(off('media', false), [...MEDIA_ONLY, 'play', 'scrollRate'].sort());
  assert.deepEqual(off('comic', false), [...MEDIA_ONLY].sort());
  assert.deepEqual(off('comic', true, false), ['play'], 'Comic mode without images: nothing to scroll');
  assert.deepEqual(off('mixed', true, false), [], 'Mixed mode without images still plays the media');
  assert.deepEqual(off('media', true, false), ['scrollRate']);
  // 本书没有媒体但有当前曲目（后台播放的文件在别的书里）：右区照常可用。
  assert.deepEqual([...disabledControls({ mode: 'comic', hasMedia: false, hasTrack: true })], []);
  assert.deepEqual([...disabledControls({ mode: 'media', hasMedia: false, hasTrack: true })].sort(), [
    'play',
    'scrollRate',
  ]);
  // 中区的开关（播放模式、只播区段、单文件、循环）任何模式、有无媒体都可用
  for (const mode of ['comic', 'mixed', 'media'])
    for (const hasMedia of [true, false])
      for (const id of ['mode', 'sections', 'single', 'loop'])
        assert.ok(!disabledControls({ mode, hasMedia }).has(id), mode + ' ' + id);
});

test('循环：单文件 / 本书（默认）/ 跨书三态轮换；旧偏好「跨书」开着读作跨书循环，其余为本书循环', () => {
  assert.deepEqual(LOOPS, ['file', 'book', 'books']);
  for (const v of LOOPS) assert.equal(loopOf(v), v);
  for (const v of [null, undefined, '', 'none', true, 3]) assert.equal(loopOf(v), 'book');
  assert.equal(loopOf(null, true), 'books', 'Old cross-book on');
  assert.equal(loopOf(null, false), 'book');
  assert.equal(loopOf(undefined, 'yes'), 'book');
  assert.equal(loopOf('file', true), 'file', 'A saved loop mode wins over the old key');
  assert.equal(nextLoop('file'), 'book');
  assert.equal(nextLoop('book'), 'books');
  assert.equal(nextLoop('books'), 'file');
  assert.equal(nextLoop('bogus'), 'books', 'A bad value counts as the book loop');
});

test('三区排布：左 5、中 5、右 5（字幕在右区末尾），左右对称；循环在中区', () => {
  const ids = (z) => ZONES[z].filter((id) => id !== '|');
  assert.deepEqual(ids('left'), ['prevBook', 'toStart', 'toEnd', 'nextBook', 'scrollRate']);
  assert.deepEqual(ZONES.mid, ['mode', 'sections', 'play', 'single', 'loop']);
  assert.deepEqual(ids('right'), ['mediaPrev', 'mediaNext', 'playRate', 'volume', 'subs']);
  assert.equal(ZONES.left.indexOf('|'), 4);
  assert.equal(ZONES.right.indexOf('|'), 2);
  assert.equal(ids('left').length, ids('right').length, 'Symmetric');
  assert.equal(ids('left').length + ZONES.mid.length + ids('right').length, 15);
  const every = [...ids('left'), ...ZONES.mid, ...ids('right')];
  assert.equal(new Set(every).size, every.length, 'Each control appears once');
  for (const gone of ['crossBook', 'order', 'popout']) assert.ok(!every.includes(gone), gone + ' removed');
});

test('窄窗口：左区留上一本 / 下一本，右区留下一个媒体 / 音量，其余收进本区的「⋯」；中区不收', () => {
  assert.deepEqual(arrange('left', false), { row: ZONES.left, more: [] });
  assert.deepEqual(arrange('left', true), {
    row: ['prevBook', 'nextBook', 'more'],
    more: ['toStart', 'toEnd', 'scrollRate'],
  });
  assert.deepEqual(arrange('right', true), {
    row: ['mediaNext', 'volume', 'more'],
    more: ['mediaPrev', 'playRate', 'subs'],
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
