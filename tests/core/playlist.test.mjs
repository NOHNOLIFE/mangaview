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
  markedOf,
  passes,
  filtering,
  markKind,
  mediaOf,
  append,
  nearestOk,
  afterEnd,
  stepTo,
  stepIn,
  afterRemove,
  favoritesOf,
  defaultName,
} from '../../src/core/playlist.mjs';
import * as playlist from '../../src/core/playlist.mjs';
import { union } from '../../src/core/sections.mjs';

test('影音模式的接续：按页序，循环与否', () => {
  assert.deepEqual(
    Object.keys(playlist).sort(),
    [
      'EPS',
      'KINDS',
      'SCOPES',
      'afterEnd',
      'afterRemove',
      'append',
      'defaultName',
      'favoritesOf',
      'filtering',
      'following',
      'markKind',
      'markedOf',
      'mediaOf',
      'nearestOk',
      'nextScope',
      'passes',
      'scopeOf',
      'sectionStart',
      'sectionStep',
      'stepIn',
      'stepTo',
      'toggleType',
      'typeOk',
      'typesOf',
    ],
    'No shuffle, no play order',
  );
  const list = [1, 3, 4, 7];
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

test('播放列表的偏好：循环范围（默认列表，旧值「本书」读作列表）、过滤（类型全不选即不限、只含书签）', () => {
  assert.equal(scopeOf('file'), 'file');
  assert.equal(scopeOf('list'), 'list');
  assert.equal(scopeOf('books'), 'books');
  assert.equal(scopeOf('book'), 'list', 'The old "this book" value reads as the list');
  for (const v of [null, undefined, 'none', true, 3]) assert.equal(scopeOf(v), 'list', String(v));
  assert.deepEqual(typesOf(['video', 'audio', 'image', 'video']), ['audio', 'video'], 'Known kinds only, fixed order');
  assert.deepEqual(typesOf('audio'), []);
  assert.deepEqual(typesOf(null), []);
  assert.equal(typeOk([], 'audio'), true, 'None chosen: no limit');
  assert.equal(typeOk(['video'], 'audio'), false);
  assert.equal(typeOk(['video'], 'video'), true);
  assert.equal(markedOf(true), true);
  for (const v of [null, 'true', 1, false]) assert.equal(markedOf(v), false, String(v));
  assert.equal(passes({}, 'audio'), true);
  assert.equal(passes({ types: ['video'] }, 'audio', 3), false);
  assert.equal(passes({ marked: true }, 'audio', 0), false, 'Bookmarked only: needs at least one bookmark');
  assert.equal(passes({ marked: true, types: ['audio'] }, 'audio', 1), true);
  assert.equal(filtering({ types: [], marked: false }), false);
  assert.equal(filtering({ types: ['audio'], marked: false }), true);
  assert.equal(filtering({ types: [], marked: true }), true);
});

test('每项的书签情况：没有 / 有书签 / 有区段书签', () => {
  assert.equal(markKind(undefined), 'none');
  assert.equal(markKind({ n: 0, mark: false, start: false, end: false }), 'none');
  assert.equal(markKind({ n: 2, mark: true, start: false, end: false }), 'mark');
  assert.equal(markKind({ n: 1, mark: false, start: true, end: true }), 'section');
  assert.equal(markKind({ n: 3, mark: true, start: true, end: true }), 'section', 'A section wins over plain marks');
});

test('列表的内容：一本书可播放的视频、音频，按页序；追加时不重复', () => {
  const kinds = ['image', 'video', 'audio', 'image', 'audio', 'video'];
  assert.deepEqual(mediaOf(kinds), [1, 2, 4, 5]);
  assert.deepEqual(
    mediaOf(kinds, (i) => i === 4),
    [1, 2, 5],
    'Unplayable ones are left out',
  );
  assert.deepEqual(mediaOf(['image']), []);
  const key = (x) => x.b + '/' + x.n;
  const list = [
    { b: 'A', n: 1 },
    { b: 'A', n: 2 },
  ];
  const r = append(
    list,
    [
      { b: 'A', n: 2 },
      { b: 'B', n: 1 },
      { b: 'B', n: 1 },
      { b: 'B', n: 3 },
    ],
    key,
  );
  assert.deepEqual(r.list.map(key), ['A/1', 'A/2', 'B/1', 'B/3'], 'Appended at the end in order, without duplicates');
  assert.equal(r.added, 2);
  assert.deepEqual(list.length, 2, 'The original list is not changed');
  assert.equal(append(list, [{ b: 'A', n: 1 }], key).added, 0, 'Everything already there');
});

test('在列表里找可接续的项：跳过被过滤的，位置可以在两项之间', () => {
  const ok = [true, false, true, false, true];
  assert.equal(nearestOk(ok, 0, 1), 2);
  assert.equal(nearestOk(ok, 2, -1), 0);
  assert.equal(nearestOk(ok, 4, 1), null);
  assert.equal(nearestOk(ok, 0, -1), null);
  assert.equal(nearestOk(ok, 1.5, 1), 2, 'Between items 1 and 2');
  assert.equal(nearestOk(ok, 1.5, -1), 0);
  assert.equal(nearestOk(ok, -1, 1), 0, 'From the start');
  assert.equal(nearestOk(ok, ok.length, -1), 4, 'From the end');
});

test('播完之后：单文件重播、列表循环、跨书进入下一本；跳过被过滤的项', () => {
  const ok = [true, true, false, true];
  assert.deepEqual(afterEnd({ scope: 'file', ok, cur: 1 }), { type: 'replay' });
  assert.deepEqual(afterEnd({ scope: 'list', ok, cur: 1 }), { type: 'next', next: 3 }, 'Skips the filtered item');
  assert.deepEqual(afterEnd({ scope: 'list', ok, cur: 3 }), { type: 'next', next: 0 }, 'List loop: back to the first');
  assert.deepEqual(
    afterEnd({ scope: 'list', ok, cur: 2 }),
    { type: 'next', next: 3 },
    'A filtered item played by hand',
  );
  assert.deepEqual(afterEnd({ scope: 'list', ok: [false, true], cur: 1 }), { type: 'replay' }, 'Only itself');
  assert.deepEqual(afterEnd({ scope: 'list', ok: [false, false], cur: 0 }), { type: 'stop' }, 'Nothing to play');
  assert.deepEqual(afterEnd({ scope: 'books', ok, cur: 1 }), { type: 'next', next: 3 });
  assert.deepEqual(afterEnd({ scope: 'books', ok, cur: 3 }), { type: 'onward' }, 'Across books: on to the next book');
  assert.deepEqual(afterEnd({ scope: 'books', ok: [], cur: -0.5 }), { type: 'onward' });
  assert.deepEqual(
    afterEnd({ scope: 'list', ok, cur: 1.5 }),
    { type: 'next', next: 3 },
    'Not in the list: what follows it',
  );
});

test('上一个 / 下一个：按列表顺序跳过被过滤的项；两端在单文件、列表范围首尾相接，跨书范围进入上一本 / 下一本', () => {
  const ok = [true, false, true, true, false];
  assert.deepEqual(stepTo({ ok, cur: 0, d: 1 }), { type: 'item', i: 2 });
  assert.deepEqual(stepTo({ ok, cur: 2, d: -1 }), { type: 'item', i: 0 });
  assert.deepEqual(stepTo({ ok, cur: 3, d: 1 }), { type: 'item', i: 0 }, 'Wraps around at the end');
  assert.deepEqual(stepTo({ ok, cur: 0, d: -1 }), { type: 'item', i: 3 }, 'Wraps around at the start');
  assert.deepEqual(stepTo({ scope: 'file', ok, cur: 3, d: 1 }), { type: 'item', i: 0 });
  assert.deepEqual(stepTo({ scope: 'books', ok, cur: 3, d: 1 }), { type: 'book' }, 'Across books: the next book');
  assert.deepEqual(stepTo({ scope: 'books', ok, cur: 0, d: -1 }), { type: 'book' }, 'Across books: the previous book');
  assert.deepEqual(stepTo({ scope: 'books', ok, cur: 2, d: 1 }), { type: 'item', i: 3 });
  assert.deepEqual(stepTo({ ok, cur: 1, d: 1 }), { type: 'item', i: 2 }, 'From a filtered item');
  assert.equal(stepTo({ ok: [false, true], cur: 1, d: 1 }), null, 'Only itself');
  assert.equal(stepTo({ ok: [], cur: 0, d: 1 }), null);
});

test('没有当前曲目时的上一个 / 下一个媒体：按页序，两端相接；不在列表里时取页序上的前后', () => {
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

test('移除当前曲目之后：后面最近的可接续项，后面没有时从头找，都没有为 null', () => {
  // 移除之后的列表：原来的第 2 项被移除。
  assert.equal(afterRemove([true, false, false, true], 2), 3);
  assert.equal(afterRemove([true, false, false], 2), 0, 'Nothing after it: from the start');
  assert.equal(afterRemove([false, false], 1), null, 'Nothing to go on with');
  assert.equal(afterRemove([], 0), null);
});

test('收藏列表：读入时只留格式正确的；默认名与已有的重名时加序号', () => {
  assert.deepEqual(favoritesOf(null), []);
  assert.deepEqual(favoritesOf('x'), []);
  assert.deepEqual(
    favoritesOf([
      { id: 'a', name: 'A', items: [{ book: 'b1', page: '01.wav' }, { book: '', page: 'x' }, null, { book: 'b2' }] },
      { id: '', name: 'B', items: [] },
      { id: 'c', name: 3, items: [] },
      { id: 'd', name: 'D' },
      null,
      { id: 'e', name: '', items: [], extra: 1 },
    ]),
    [
      { id: 'a', name: 'A', items: [{ book: 'b1', page: '01.wav' }] },
      { id: 'e', name: '', items: [] },
    ],
  );
  assert.equal(defaultName('Alpha', []), 'Alpha');
  assert.equal(defaultName('Alpha', ['Alpha']), 'Alpha (2)');
  assert.equal(defaultName('Alpha', ['Alpha', 'Alpha (2)', 'Beta']), 'Alpha (3)');
});

test('画中画窗口的循环范围按钮轮换（单文件 → 列表 → 跨书 → 单文件），类型开关逐个切换、结果按固定顺序', () => {
  assert.equal(nextScope('file'), 'list');
  assert.equal(nextScope('list'), 'books');
  assert.equal(nextScope('books'), 'file');
  assert.equal(nextScope('book'), 'books', 'The old value reads as the list');
  assert.equal(nextScope('junk'), 'books', 'An unknown value reads as the list');
  assert.deepEqual(toggleType([], 'video'), ['video']);
  assert.deepEqual(toggleType(['video'], 'audio'), ['audio', 'video']);
  assert.deepEqual(toggleType(['audio', 'video'], 'audio'), ['video']);
  assert.deepEqual(toggleType(['video'], 'video'), [], 'Neither: no limit');
  assert.deepEqual(toggleType(null, 'audio'), ['audio']);
});
