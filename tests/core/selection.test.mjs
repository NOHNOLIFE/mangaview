// 当前曲目（选中媒体）的规则（src/core/selection.mjs）：成为当前曲目、保持、取消，以及当前文件与书签作用的对象。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PICKS, selectAfter, fileTarget, markTarget } from '../../src/core/selection.mjs';

const a = { id: 'a' },
  b = { id: 'b' };

test('点击画面 / 播放键、开始播放、上一个 / 下一个媒体切到、书签跳到：成为当前曲目', () => {
  assert.deepEqual([...PICKS].sort(), ['goto', 'play', 'press', 'switch']);
  for (const type of PICKS) {
    assert.equal(selectAfter(null, { type, player: a }), a, type);
    assert.equal(selectAfter(a, { type, player: b }), b, type + '：选中别的媒体即取消原来的（一个窗口最多一个）');
  }
});

test('暂停后仍是当前曲目；未知事件不变', () => {
  assert.equal(selectAfter(a, { type: 'pause', player: a }), a);
  assert.equal(selectAfter(a, { type: 'whatever' }), a);
  assert.equal(selectAfter(null, { type: 'pause', player: a }), null);
});

test('后台播放：离开视窗、切书都不取消', () => {
  assert.equal(selectAfter(a, { type: 'view', inView: true, full: false }), a);
  assert.equal(selectAfter(a, { type: 'view', inView: false, full: false }), a);
  assert.equal(selectAfter(a, { type: 'book' }), a);
  assert.equal(selectAfter(null, { type: 'view', inView: false }), null);
  assert.equal(selectAfter(null, { type: 'book' }), null);
});

test('自动播放开始、用户尚未接手的：中线离开视窗（全屏中的除外）或切书即取消', () => {
  assert.equal(selectAfter(a, { type: 'view', auto: true, inView: true, full: false }), a);
  assert.equal(selectAfter(a, { type: 'view', auto: true, inView: false, full: false }), null);
  assert.equal(selectAfter(a, { type: 'view', auto: true, inView: false, full: true }), a);
  assert.equal(selectAfter(a, { type: 'book', auto: true }), null);
});

test('「停止」、播放器被释放或打不开时取消；释放的是别的播放器时不变', () => {
  assert.equal(selectAfter(a, { type: 'stop' }), null);
  assert.equal(selectAfter(a, { type: 'gone', player: a }), null);
  assert.equal(selectAfter(a, { type: 'gone', player: b }), a);
});

test('当前文件：当前曲目在播放时是它（不在视窗、在别的书里也一样），暂停时只在本书且中线在视窗内才是它，否则是视窗中心所在的页', () => {
  const page = { name: '01.jpg' };
  assert.equal(fileTarget(a, page, { playing: true }), a, 'Playing: the track, wherever it is');
  assert.equal(fileTarget(a, page, { playing: true, inBook: false, inView: false }), a);
  assert.equal(fileTarget(a, page, { inBook: true, inView: true }), a, 'Paused in view: the track');
  assert.equal(fileTarget(a, page, { inBook: true, inView: false }), page, 'Paused, scrolled away: the centre page');
  assert.equal(fileTarget(a, page, { inBook: false, inView: false }), page, 'Paused in another book: the centre page');
  assert.equal(fileTarget(a, page), page, 'Paused, nothing known: the centre page');
  assert.equal(fileTarget(a, null), null, 'Paused away and no centre page');
  assert.equal(fileTarget(a, page, { full: true }), a, 'Fullscreen: the track even when paused');
  assert.equal(fileTarget(null, page, { playing: true }), page);
  assert.equal(fileTarget(undefined, undefined), null);
});

test('书签作用的对象：当前曲目在本书且中线在视窗内时是它，否则视窗中心所在的页', () => {
  const center = { name: '01.jpg' };
  assert.equal(markTarget(a, { inBook: true, inView: true }, center), a);
  assert.equal(markTarget(a, { inBook: true, inView: false }, center), center, 'Scrolled away: the centre page');
  assert.equal(markTarget(a, { inBook: false, inView: false }, center), center, 'In another book: the centre page');
  assert.equal(markTarget(null, {}, center), center);
  assert.equal(markTarget(a, { inBook: true, inView: false }), null);
});
