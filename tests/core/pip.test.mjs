import test from 'node:test';
import assert from 'node:assert/strict';
import { entry, span, centerTop, revealTop, ratio, MIN_RATIO, MAX_RATIO } from '../../src/core/pip.mjs';

test('入口：视频、音频成为当前曲目并在画中画显示，已在画中画的当前曲目再按即关闭；图片只开 / 关窗口', () => {
  assert.equal(entry({ open: false, kind: 'video' }), 'show', 'Opens the window with the file');
  assert.equal(entry({ open: true, kind: 'audio', track: false, out: false }), 'show', 'Another file: play it there');
  assert.equal(
    entry({ open: true, kind: 'video', track: true, out: false }),
    'show',
    'The track is in the page: bring it',
  );
  assert.equal(entry({ open: true, kind: 'video', track: true, out: true }), 'close', 'Again: close');
  assert.equal(entry({ open: false, kind: 'video', track: true, out: true }), 'show');
  assert.equal(entry({ open: false, kind: 'image' }), 'open', 'An image only opens the window');
  assert.equal(entry({ open: true, kind: 'image' }), 'close');
  assert.equal(entry({ open: false }), 'open', 'No file');
  assert.equal(entry({ open: true, kind: null }), 'close');
  assert.equal(entry(), 'open');
});

test('播放列表只渲染可视范围（前后多几项），打开时当前项居中，键盘移动时只在需要时滚动', () => {
  assert.deepEqual(span(0, 32, 0, 300), [0, 0]);
  assert.deepEqual(span(500, 32, 0, 320, 4), [0, 14]);
  assert.deepEqual(span(500, 32, 3200, 320, 4), [96, 114]);
  assert.deepEqual(span(10, 32, 3200, 320, 4), [10, 10], 'Scrolled past the end');
  assert.deepEqual(span(500, 32, 3200, 0, 0), [100, 100], 'Zero height');
  assert.deepEqual(span(500, 32, 15990, 320, 2), [497, 500]);
  assert.equal(centerTop(0, 500, 32, 320), 0);
  assert.equal(centerTop(100, 500, 32, 320), 100 * 32 + 16 - 160);
  assert.equal(centerTop(499, 500, 32, 320), 500 * 32 - 320, 'Clamped at the end');
  assert.equal(centerTop(3, 5, 32, 320), 0, 'A short list does not scroll');
  assert.equal(revealTop(5, 32, 0, 320), 0, 'Already visible');
  assert.equal(revealTop(10, 32, 0, 320), 11 * 32 - 320, 'Below: just enough to show it');
  assert.equal(revealTop(2, 32, 200, 320), 64, 'Above: its top');
});

test('内容区的画面比例：按帧尺寸，未知时 16:9，夹在合理范围内', () => {
  assert.equal(ratio(1920, 1080), 1080 / 1920);
  assert.equal(ratio(0, 0), 9 / 16);
  assert.equal(ratio(undefined, 100), 9 / 16);
  assert.equal(ratio(100, 1000), MAX_RATIO, 'Very tall');
  assert.equal(ratio(1000, 10), MIN_RATIO, 'Very wide');
});
