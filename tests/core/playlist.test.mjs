import test from 'node:test';
import assert from 'node:assert/strict';
import {
  following,
  sectionStart,
  sectionStep,
  scopeOf,
  nextScope,
  toggleType,
  typesOf,
  typeOk,
  queueOf,
  afterEnd,
  stepIn,
} from '../../src/core/playlist.mjs';
import * as playlist from '../../src/core/playlist.mjs';
import { union } from '../../src/core/sections.mjs';

test('接续：一个媒体播完之后播哪个（按页序或随机，循环与否）', () => {
  assert.deepEqual(
    Object.keys(playlist).sort(),
    [
      'EPS',
      'KINDS',
      'SCOPES',
      'afterEnd',
      'following',
      'nextScope',
      'queueOf',
      'scopeOf',
      'sectionStart',
      'sectionStep',
      'stepIn',
      'toggleType',
      'typeOk',
      'typesOf',
    ],
    'No play order, no new window',
  );
  const list = [1, 3, 4, 7];
  // 按页序：按页序播放下一个（图片、无法播放的不在 list 里）；最后一个播完停下，循环开回到第一个。
  assert.equal(following({ list, cur: 3 }).next, 4);
  assert.equal(
    following({ list, cur: 5 }).next,
    7,
    'A media not in the list (e.g. without sections) continues with the next one in page order',
  );
  assert.equal(following({ list, cur: 7 }).next, null);
  assert.equal(following({ loop: true, list, cur: 7 }).next, 1);
  assert.equal(following({ loop: true, list: [4], cur: 4 }).next, 4, 'A single media loops onto itself');
  assert.equal(following({ list: [], cur: 2 }).next, null);
  // 随机：不重复，全部播过一遍后停下；循环开则重新洗牌继续，刚播完的不紧接着重复。
  let played = new Set(),
    cur = 1,
    seen = [cur];
  const rnd = () => 0.6;
  for (;;) {
    const r = following({ shuffle: true, list, cur, played, random: rnd });
    if (r.next == null) break;
    seen.push(r.next);
    played = r.played;
    cur = r.next;
  }
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    list,
    'Each media once per round',
  );
  assert.equal(seen.length, 4);
  const again = following({ shuffle: true, loop: true, list, cur, played });
  assert.ok(again.next != null && again.next !== cur, 'Looping starts a new round without repeating the last one');
  assert.deepEqual([...again.played].sort(), [cur, again.next].sort());
  assert.equal(following({ shuffle: true, loop: true, list: [4], cur: 4, played: new Set([4]) }).next, 4);
  assert.equal(following({ shuffle: true, loop: false, list: [4], cur: 4 }).next, null);
});

test('只播放书签区段：从哪里开始、何时跳到下一个区段', () => {
  const rs = [
    { a: 5, b: 9 },
    { a: 12, b: 14 },
  ];
  assert.equal(sectionStart(rs, 0), 5, 'From the first section after the current time');
  assert.equal(sectionStart(rs, 6), 6, 'Inside a section: keep going');
  assert.equal(sectionStart(rs, 10), 12);
  assert.equal(sectionStart(rs, 20), 5, 'Past the last section: back to the first');
  assert.equal(sectionStart([], 3), 3, 'No sections: unchanged');
  assert.deepEqual(sectionStep(rs, 6, null), { k: 0 }, 'Entering a section starts following it');
  assert.deepEqual(sectionStep(rs, 8.5, 0), { k: 0 });
  assert.deepEqual(sectionStep(rs, 9, 0), { k: 1, seek: 12 }, 'At the end of a section jump to the next one');
  assert.deepEqual(sectionStep(rs, 14, 1), { k: null, done: true }, 'The last section ends the media');
  assert.deepEqual(sectionStep(rs, 10, null), { k: null }, 'Dragged outside the sections: play on normally');
  assert.deepEqual(sectionStep(rs, 12.5, null), { k: 1 }, 'Reaching a later section resumes section jumps');
});

test('只播放书签区段：嵌套、交叉的区段按并集播放，重叠的部分只播一次', () => {
  // 5–9 包含 6–8，8.5–12 与 5–9 交叉，15–16 单独：并集为 5–12、15–16。
  const rs = union([
    { id: 'a', a: 5, b: 9 },
    { id: 'b', a: 6, b: 8 },
    { id: 'c', a: 8.5, b: 12 },
    { id: 'd', a: 15, b: 16 },
  ]);
  assert.deepEqual(rs, [
    { a: 5, b: 12 },
    { a: 15, b: 16 },
  ]);
  assert.equal(sectionStart(rs, 0), 5);
  assert.deepEqual(sectionStep(rs, 9.5, 0), { k: 0 }, 'No jump at the end of an inner or crossing section');
  assert.deepEqual(sectionStep(rs, 12, 0), { k: 1, seek: 15 });
  assert.deepEqual(sectionStep(rs, 16, 1), { k: null, done: true });
});

test('播放列表的偏好：循环范围（默认本书）、类型开关（全不选即不限）', () => {
  assert.equal(scopeOf('file'), 'file');
  assert.equal(scopeOf('books'), 'books');
  for (const v of [null, undefined, 'none', true, 3]) assert.equal(scopeOf(v), 'book', String(v));
  assert.deepEqual(typesOf(['video', 'audio', 'image', 'video']), ['audio', 'video'], 'Known kinds only, fixed order');
  assert.deepEqual(typesOf('audio'), []);
  assert.deepEqual(typesOf(null), []);
  assert.equal(typeOk([], 'audio'), true, 'None chosen: no limit');
  assert.equal(typeOk(['video'], 'audio'), false);
  assert.equal(typeOk(['video'], 'video'), true);
});

test('播放列表的内容：本书可播放的视频、音频，按页序；类型开关、播不了的、移除的不列入', () => {
  const kinds = ['image', 'video', 'audio', 'image', 'audio', 'video'];
  assert.deepEqual(queueOf(kinds), [1, 2, 4, 5]);
  assert.deepEqual(queueOf(kinds, ['audio']), [2, 4]);
  assert.deepEqual(queueOf(kinds, ['video']), [1, 5]);
  assert.deepEqual(
    queueOf(kinds, ['audio', 'video'], (i) => i === 4),
    [1, 2, 5],
  );
  assert.deepEqual(queueOf(['image']), []);
});

test('播完之后：单文件重播、本书循环、跨书进入下一本；随机不重复地播完一轮', () => {
  const list = [1, 2, 4, 5];
  assert.equal(afterEnd({ scope: 'file', list, cur: 2 }).type, 'replay');
  assert.deepEqual(afterEnd({ scope: 'book', list, cur: 2 }), { type: 'next', next: 4, played: new Set() });
  assert.equal(afterEnd({ scope: 'book', list, cur: 5 }).next, 1, 'Book loop: back to the first');
  assert.equal(afterEnd({ scope: 'book', list: [3], cur: 3 }).type, 'replay', 'Only itself: replay');
  assert.equal(afterEnd({ scope: 'book', list: [], cur: 3 }).type, 'stop', 'Nothing to play');
  assert.deepEqual(afterEnd({ scope: 'books', list, cur: 4 }).next, 5);
  assert.equal(afterEnd({ scope: 'books', list, cur: 5 }).type, 'onward', 'Books loop: on to the next book');
  assert.equal(afterEnd({ scope: 'books', list: [], cur: 0 }).type, 'onward');
  assert.equal(afterEnd({ scope: 'book', list, cur: 3 }).next, 4, 'Not in the list: next in page order');
  // 随机（本书循环）：一轮里每项只播一次，之后重新洗牌继续。
  let played = new Set(),
    cur = 1;
  const seen = [cur];
  for (let k = 0; k < 3; k++) {
    const r = afterEnd({ scope: 'book', shuffle: true, list, cur, played, random: () => 0 });
    assert.equal(r.type, 'next');
    played = r.played;
    cur = r.next;
    seen.push(cur);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 4, 5], 'One round without repeats');
  const again = afterEnd({ scope: 'book', shuffle: true, list, cur, played, random: () => 0 });
  assert.equal(again.type, 'next');
  assert.notEqual(again.next, cur, 'A new round does not repeat the one just played');
  // 随机（跨书）：一轮播完进入下一本。
  assert.equal(afterEnd({ scope: 'books', shuffle: true, list, cur, played, random: () => 0 }).type, 'onward');
});

test('上一项 / 下一项：按页序，两端相接；不在列表里时取页序上的前后', () => {
  const list = [1, 2, 4, 5];
  assert.equal(stepIn(list, 2, 1), 4);
  assert.equal(stepIn(list, 2, -1), 1);
  assert.equal(stepIn(list, 5, 1), 1);
  assert.equal(stepIn(list, 1, -1), 5);
  assert.equal(stepIn(list, 3, 1), 4);
  assert.equal(stepIn(list, 3, -1), 2);
  assert.equal(stepIn([2], 2, 1), null, 'Only itself');
  assert.equal(stepIn([], 2, 1), null);
});

test('画中画窗口的循环范围按钮轮换（单文件 → 本书 → 跨书 → 单文件），类型开关逐个切换、结果按固定顺序', () => {
  assert.equal(nextScope('file'), 'book');
  assert.equal(nextScope('book'), 'books');
  assert.equal(nextScope('books'), 'file');
  assert.equal(nextScope('junk'), 'books', 'An unknown value reads as this book');
  assert.deepEqual(toggleType([], 'video'), ['video']);
  assert.deepEqual(toggleType(['video'], 'audio'), ['audio', 'video']);
  assert.deepEqual(toggleType(['audio', 'video'], 'audio'), ['video']);
  assert.deepEqual(toggleType(['video'], 'video'), [], 'Neither: no limit');
  assert.deepEqual(toggleType(null, 'audio'), ['audio']);
});
