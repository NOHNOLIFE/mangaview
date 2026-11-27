import test from 'node:test';
import assert from 'node:assert/strict';
import { listOf, inList, stepBook, successor } from '../../src/core/reading.mjs';

const book = (n, place = 'shelf') => ({ n, place });
const byN = (l) => l.sort((a, b) => a.n - b.n);

test('the reading list follows the selected shelf tab; the expired tab keeps the previous one', () => {
  assert.equal(listOf('shelf'), 'shelf');
  assert.equal(listOf('library', 'shelf'), 'library');
  assert.equal(listOf('all', 'library'), 'all');
  assert.equal(listOf('expired', 'library'), 'library');
  assert.equal(listOf('expired', 'all'), 'all');
  assert.equal(listOf('expired'), 'shelf');
  assert.equal(listOf('expired', 'expired'), 'shelf');
  assert.equal(listOf(undefined, undefined), 'shelf');
  const s = book(1),
    l = book(2, 'library');
  assert.deepEqual(
    ['shelf', 'library', 'all'].map((v) => [inList(s, v), inList(l, v)]),
    [
      [true, false],
      [false, true],
      [true, true],
    ],
  );
});

test('previous / next book: wraps around, starts from an end without a current book', () => {
  const [a, b, c] = [book(1), book(2), book(3)],
    list = [a, b, c];
  assert.equal(stepBook(list, a, 1), b);
  assert.equal(stepBook(list, c, 1), a);
  assert.equal(stepBook(list, a, -1), c);
  assert.equal(stepBook(list, null, 1), a);
  assert.equal(stepBook(list, null, -1), c);
  assert.equal(stepBook([], a, 1), null);
  // 当前书不在列表里：从它按排序应在的位置走到最近的一本
  const x = book(2.5);
  assert.equal(stepBook(list, x, 1, byN), c);
  assert.equal(stepBook(list, x, -1, byN), b);
  assert.equal(stepBook([a], x, 1, byN), a);
  assert.equal(stepBook([a], x, -1, byN), a);
});

test('deleting the current book moves to the next one in the list, else the previous one', () => {
  const [a, b, c, d] = [book(1), book(2), book(3), book(4)],
    list = [a, b, c, d];
  assert.equal(successor(list, b), c);
  assert.equal(successor(list, d), c, 'no next: the previous one');
  assert.equal(successor([a], a), null, 'the list is empty now');
  assert.equal(successor([], a), null);
  // 批量删除：一起删除的书都跳过
  assert.equal(successor(list, b, undefined, new Set([b, c])), d);
  assert.equal(successor(list, c, undefined, new Set([b, c, d])), a);
  assert.equal(successor(list, a, undefined, new Set(list)), null);
  // 当前书不在列表里（被筛选掉、在别的页签）：按它应在的位置取后一本，没有则前一本
  assert.equal(successor([a, c, d], book(2), byN), c);
  assert.equal(successor([a, b], book(9), byN), b);
});
