import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nameOf,
  stem,
  fileStem,
  numberOf,
  nextNumber,
  autoName,
  defaultName,
  fillNames,
} from '../../src/marks/names.mjs';

test('书签名称：<文件名> 不含路径和扩展名，序号为该文件内已有序号的最大值加一（任一语言的「书签」都算）', () => {
  assert.equal(stem('a/b/01 Song.final.flac'), '01 Song.final');
  assert.equal(stem('.hidden'), '.hidden');
  assert.equal(stem('noext'), 'noext');
  const book = { pages: [{ name: 'v1/x.mp4', file: 'clip.mp4', src: 'v1' }] };
  assert.equal(fileStem(book, 'v1/x.mp4'), 'clip', 'The file of the page, not its internal name');
  assert.equal(fileStem(book, 'gone/old.webm'), 'old', 'A page that no longer exists: from the name');
  assert.equal(numberOf('clip-Bookmark7', 'clip'), 7);
  assert.equal(numberOf('clip-书签12', 'clip'), 12);
  assert.equal(numberOf('clip-しおり3', 'clip'), 3);
  assert.equal(numberOf('clip-책갈피4', 'clip'), 4);
  assert.equal(numberOf('clip-Intro', 'clip'), 0);
  assert.equal(numberOf('other-书签9', 'clip'), 0);
  assert.equal(numberOf('clip-书签x', 'clip'), 0);
  const marks = [
    { name: 'a.mp4', t: 1, label: 'a-书签2' },
    { name: 'a.mp4', t: 2, label: 'a-Bookmark5' },
    { name: 'a.mp4', t: 3, label: 'mine' },
    { name: 'b.mp4', t: 1, label: 'a-书签9' },
    { name: 'a.mp4', f: 0.5, label: 'a-书签8' },
  ];
  assert.equal(nextNumber(marks, 'a.mp4', 'a'), 6, 'Only media bookmarks of the same file count');
  assert.equal(nextNumber([], 'a.mp4', 'a'), 1);
  assert.equal(autoName('a', '书签', 6), 'a-书签6');
  assert.equal(defaultName(marks, { name: 'a.mp4', t: 9, pbfName: 'Hi' }, 'a', '书签'), 'a-Hi');
  assert.equal(defaultName(marks, marks[1], 'a', '书签'), 'a-书签3', 'Not counting itself');
  assert.equal(nameOf({ label: 'x' }), 'x');
  assert.equal(nameOf({}), '');
  assert.equal(nameOf(null), '');
});

test('旧的媒体书签补上名称：按书签顺序编号，2.3.0 的 .pbf 书签改为「<文件名>-<原名>」，图片书签和已有名称的不动', () => {
  const pages = ['1.png', 'Song.flac', 'clip.webm'].map((name) => ({ name }));
  const book = {
    pages,
    bookmarks: [
      { id: 'b', name: 'Song.flac', t: 30, at: 1 },
      { id: 'a', name: 'Song.flac', t: 10, at: 2 },
      { id: 'p', name: 'Song.flac', t: 20, at: 3, label: 'Chorus', from: 'pbf' },
      { id: 'q', name: 'Song.flac', t: 25, at: 3, from: 'pbf' },
      { id: 'k', name: 'clip.webm', t: 5, at: 4, label: 'Kept', named: true },
      { id: 'n', name: 'clip.webm', t: 9, at: 4, label: 'clip-书签4' },
      { id: 'c', name: 'clip.webm', t: 7, at: 4 },
      { id: 'i', name: '1.png', f: 0.5, at: 5 },
      { id: 'g', name: 'gone.mp3', t: 1, at: 6 },
    ],
  };
  const changed = fillNames(book, 'Bookmark');
  const got = Object.fromEntries(book.bookmarks.map((m) => [m.id, [m.label, m.pbfName]]));
  assert.deepEqual(got, {
    b: ['Song-Bookmark3', undefined],
    a: ['Song-Bookmark1', undefined],
    p: ['Song-Chorus', 'Chorus'],
    q: ['Song-Bookmark2', ''],
    k: ['Kept', undefined],
    n: ['clip-书签4', undefined],
    c: ['clip-Bookmark5', undefined],
    i: [undefined, undefined],
    g: ['gone-Bookmark1', undefined],
  });
  assert.deepEqual(changed.map((m) => m.id).sort(), ['a', 'b', 'c', 'g', 'p', 'q']);
  assert.deepEqual(fillNames(book, 'Bookmark'), [], 'Nothing left to fill');
});
