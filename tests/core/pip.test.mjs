import test from 'node:test';
import assert from 'node:assert/strict';
import { entry, span, centerTop, revealTop, listRows, pinResize, SIDE, DOCK_MIN } from '../../src/core/pip.mjs';

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

test('播放列表的行：跨多本书时每段连续的同一本书前有一行书名小标题，只有一本书时没有', () => {
  const it = (book, name) => ({ book, name });
  const one = [it('A', 1), it('A', 2)];
  assert.deepEqual(
    listRows(one),
    {
      rows: [
        { item: one[0], i: 0 },
        { item: one[1], i: 1 },
      ],
      at: [0, 1],
    },
    'One book',
  );
  const mix = [it('A', 1), it('A', 2), it('B', 1), it('A', 3)];
  const r = listRows(mix);
  assert.deepEqual(
    r.rows.map((x) => (x.head ? 'h:' + x.head : x.i)),
    ['h:A', 0, 1, 'h:B', 2, 'h:A', 3],
    'A heading before every run of one book',
  );
  assert.deepEqual(r.at, [1, 2, 4, 6]);
  assert.deepEqual(listRows([]), { rows: [], at: [] });
  assert.deepEqual(
    listRows([{ b: 1 }, { b: 2 }], (x) => x.b).rows.map((x) => x.head ?? '-'),
    [1, '-', 2, '-'],
    'Custom book key',
  );
});

test('切换固定时窗口尺寸的变化：内容区保持不变，列表只在会停靠时计入宽度', () => {
  assert.deepEqual(pinResize({ on: true, width: 480, height: 480, side: 220, dock: 112, dockMin: 420 }), {
    dw: 220,
    dh: 112,
    width: 700,
    height: 592,
  });
  assert.deepEqual(
    pinResize({ on: false, width: 700, height: 592, side: 220, dock: 112, dockMin: 420 }),
    { dw: -220, dh: -112, width: 480, height: 480 },
    'Unpinning gives it back',
  );
  assert.deepEqual(
    pinResize({ on: true, width: 150, height: 300, side: 220, dock: 76, dockMin: 420 }),
    { dw: 0, dh: 76, width: 150, height: 376 },
    'Still too narrow to dock: the list floats, the width stays',
  );
  assert.deepEqual(
    pinResize({ on: false, width: 360, height: 400, side: 220, dock: 112, dockMin: 420 }),
    { dw: 0, dh: -112, width: 360, height: 288 },
    'The list was floating: only the height changes',
  );
  assert.equal(
    pinResize({ on: true, width: 200, height: 200, side: 220, dock: 0, dockMin: 420 }).dw,
    220,
    'Exactly wide enough',
  );
  assert.deepEqual(pinResize({ on: false, width: 10, height: 10, dock: 40, side: 220, dockMin: 420 }), {
    dw: 0,
    dh: -40,
    width: 10,
    height: 0,
  });
  assert.equal(pinResize({ on: true, width: 480, height: 480 }).dw, SIDE, 'Defaults');
  assert.ok(DOCK_MIN > SIDE);
});
