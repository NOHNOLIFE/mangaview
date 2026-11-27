// 文件栏与音频卡片右侧按钮的排布（src/core/filebar.mjs）：三个固定的按钮位、各类文件有的按钮、哪些收进「⋯」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTONS, DIRECT, PLACES, buttonsOf, arrange } from '../../src/core/filebar.mjs';

test('按钮：添加书签、添加区段书签、设置为封面、全屏；直接显示的只有前两个；三个按钮位', () => {
  assert.deepEqual(BUTTONS, ['bookmark', 'section', 'cover', 'full']);
  assert.deepEqual(DIRECT, ['bookmark', 'section']);
  assert.equal(PLACES, 3);
});

test('各类文件有的按钮：图片没有全屏，音频只有书签与区段；字幕不在文件栏', () => {
  assert.deepEqual(buttonsOf('image'), ['bookmark', 'section', 'cover']);
  assert.deepEqual(buttonsOf('video'), ['bookmark', 'section', 'cover', 'full']);
  assert.deepEqual(buttonsOf('audio'), ['bookmark', 'section']);
  assert.deepEqual(buttonsOf('invalid'), []);
  assert.deepEqual(buttonsOf(undefined), []);
  for (const k of ['image', 'video', 'audio']) assert.ok(!buttonsOf(k).includes('subs'), k);
});

test('排布：不超过 3 个时全部直接显示，否则书签、区段 + 「⋯」（其余收进去）；空位留空', () => {
  assert.deepEqual(arrange('image'), { row: ['bookmark', 'section', 'cover'], more: [] });
  assert.deepEqual(arrange('video'), { row: ['bookmark', 'section', 'more'], more: ['cover', 'full'] });
  assert.deepEqual(arrange('audio'), { row: ['bookmark', 'section', null], more: [] });
  assert.deepEqual(arrange(null), { row: [null, null, null], more: [] });
});

test('按钮位固定：每种文件都是三个位，书签、区段始终在前两个位', () => {
  for (const k of ['image', 'video', 'audio']) {
    const { row, more } = arrange(k);
    assert.equal(row.length, PLACES, k);
    assert.deepEqual(row.slice(0, 2), DIRECT, k);
    assert.deepEqual(
      [...row.filter((x) => x && x !== 'more'), ...more].sort(),
      buttonsOf(k).sort(),
      k + ': every button once',
    );
  }
});
