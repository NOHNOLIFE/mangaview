// 文件栏的按钮排布（src/core/filebar.mjs）：固定的按钮位、各类文件有的按钮、窄时收进「⋯」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS, slotsOf, COLLAPSE, arrange, fitLevel } from '../../src/core/filebar.mjs';

test('按钮位固定：字幕、添加书签、添加区段书签、设置为封面、全屏', () => {
  assert.deepEqual(SLOTS, ['subs', 'bookmark', 'section', 'cover', 'full']);
});

test('各类文件有的按钮：图片没有字幕和全屏，音频没有封面和全屏', () => {
  assert.deepEqual([...slotsOf('image')], ['bookmark', 'section', 'cover']);
  assert.deepEqual([...slotsOf('video')], SLOTS);
  assert.deepEqual([...slotsOf('audio')], ['subs', 'bookmark', 'section']);
  assert.equal(slotsOf('invalid').size, 0);
  assert.equal(slotsOf(undefined).size, 0);
  for (const k of ['image', 'video', 'audio']) for (const s of slotsOf(k)) assert.ok(SLOTS.includes(s), k + ' ' + s);
});

test('收进「⋯」：添加书签始终留在行里；行里的按钮保持原来的次序', () => {
  assert.ok(!COLLAPSE.includes('bookmark'));
  assert.deepEqual(arrange(0), { row: SLOTS, more: [] });
  assert.deepEqual(arrange(2), { row: ['subs', 'bookmark', 'section', 'more'], more: ['cover', 'full'] });
  assert.deepEqual(arrange(COLLAPSE.length), { row: ['bookmark', 'more'], more: ['subs', 'section', 'cover', 'full'] });
  for (let n = 0; n <= COLLAPSE.length; n++) {
    const { row, more } = arrange(n);
    assert.equal(row.filter((s) => s !== 'more').length + more.length, SLOTS.length, 'n=' + n);
  }
});

test('放得下的最少收起个数：宽时不收，越窄收得越多，最窄时只留添加书签和「⋯」', () => {
  const size = { base: 300, slot: 36, gap: 2 },
    need = (k) => size.base + k * size.slot + (k - 1) * size.gap;
  assert.equal(fitLevel(2000, size), 0);
  assert.equal(fitLevel(need(5), size), 0);
  assert.equal(fitLevel(need(5) - 1, size), 2, '收起 1 个省不出位置（多了「⋯」），直接收 2 个');
  assert.equal(fitLevel(need(4), size), 2);
  assert.equal(fitLevel(need(3), size), 3);
  assert.equal(fitLevel(need(2), size), 4);
  assert.equal(fitLevel(10, size), COLLAPSE.length);
  let last = 0;
  for (let w = 1200; w > 0; w -= 7) {
    const n = fitLevel(w, size);
    assert.ok(n >= last, 'monotonic at ' + w);
    last = n;
  }
});
