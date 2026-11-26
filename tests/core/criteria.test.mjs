import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, clean, same, tagsOf, marksOf, pagesOf, kindsOf } from '../../src/shelf/criteria.mjs';

test('筛选条件：旧数据或损坏的数据归一化，页数取非负整数，标签去重去空，类型只留已知的', () => {
  assert.deepEqual(clean(null), EMPTY);
  assert.deepEqual(clean('x'), EMPTY);
  assert.deepEqual(
    clean({ q: 5, min: '3.7', max: -1, tags: [' a ', 'A', '', 7, 'b'], marked: 1, kinds: ['audio', 'pdf', 'image'] }),
    { q: '', min: '3', max: '', tags: ['a', 'b'], marked: true, kinds: ['image', 'audio'] },
  );
});

test('筛选条件比较：忽略关键词首尾空白、标签顺序与大小写', () => {
  const f = (o) => clean({ ...EMPTY, ...o });
  assert.ok(same(f({ q: ' x ', tags: ['A', 'b'] }), f({ q: 'x', tags: ['B', 'a'] })));
  assert.ok(!same(f({ min: '1' }), f({})));
  assert.ok(!same(f({ kinds: ['video'] }), f({})));
});

test('书的标签、书签数、页数、页类型：缺字段时按空处理，页类型随页表变化重新计算', () => {
  assert.deepEqual(tagsOf({}), []);
  assert.equal(marksOf({ bookmarks: [{}, {}] }), 2);
  assert.equal(marksOf({}), 0);
  assert.equal(pagesOf({}), 0);
  const b = { pages: [{ name: '1.jpg' }, { name: 'a.mp4' }] };
  assert.deepEqual([...kindsOf(b)].sort(), ['image', 'video']);
  b.pages.push({ name: 'b.mp3' });
  assert.deepEqual([...kindsOf(b)].sort(), ['audio', 'image', 'video']);
  assert.deepEqual([...kindsOf({})], []);
});
