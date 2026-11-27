// 选中媒体的规则（src/core/selection.mjs）：成为选中、保持、取消，以及当前文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PICKS, selectAfter, fileTarget } from '../../src/core/selection.mjs';

const a = { id: 'a' },
  b = { id: 'b' };

test('点击画面 / 播放键、开始播放、上一个 / 下一个媒体切到、书签跳到：成为选中', () => {
  assert.deepEqual([...PICKS].sort(), ['goto', 'play', 'press', 'switch']);
  for (const type of PICKS) {
    assert.equal(selectAfter(null, { type, player: a }), a, type);
    assert.equal(selectAfter(a, { type, player: b }), b, type + '：选中别的媒体即取消原来的（一个窗口最多一个）');
  }
});

test('暂停后仍是选中；未知事件不变', () => {
  assert.equal(selectAfter(a, { type: 'pause', player: a }), a);
  assert.equal(selectAfter(a, { type: 'whatever' }), a);
  assert.equal(selectAfter(null, { type: 'pause', player: a }), null);
});

test('中线离开视窗取消（全屏中的不取消）', () => {
  assert.equal(selectAfter(a, { type: 'view', inView: true, full: false }), a);
  assert.equal(selectAfter(a, { type: 'view', inView: false, full: false }), null);
  assert.equal(selectAfter(a, { type: 'view', inView: false, full: true }), a);
  assert.equal(selectAfter(null, { type: 'view', inView: false }), null);
});

test('切书、播放器被释放时取消；释放的是别的播放器时不变', () => {
  assert.equal(selectAfter(a, { type: 'book' }), null);
  assert.equal(selectAfter(a, { type: 'gone', player: a }), null);
  assert.equal(selectAfter(a, { type: 'gone', player: b }), a);
});

test('当前文件：有选中媒体时是它，否则是视窗中心所在的页', () => {
  const page = { name: '01.jpg' };
  assert.equal(fileTarget(a, page), a);
  assert.equal(fileTarget(null, page), page);
  assert.equal(fileTarget(undefined, undefined), null);
});
