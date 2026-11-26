import test from 'node:test';
import assert from 'node:assert/strict';
import { snap, merge, changes, adopt, refresh, print } from '../../src/core/merge.mjs';

test('多窗口保存：以存储中的最新记录为基础，只写本窗口改过的字段；书签按 id、标签按集合合并，不认识的字段原样保留', () => {
  const stored = {
    id: 'b',
    name: null,
    place: 'shelf',
    tags: ['a', 'b'],
    bookmarks: [
      { id: '1', name: 'p1', f: 0.5 },
      { id: '2', name: 'p2', f: 0.1 },
    ],
    pages: [{ name: '1.jpg', w: 800 }, { name: '2.jpg' }],
  };
  const base = snap(structuredClone(stored)),
    mine = structuredClone(stored),
    theirs = structuredClone(stored);
  mine.bookmarks = mine.bookmarks.filter((x) => x.id !== '2');
  mine.bookmarks.push({ id: '3', name: 'p3', f: 0.2 });
  mine.tags = ['a', 'b', 'm'];
  mine.place = 'library';
  theirs.bookmarks.push({ id: '4', name: 'p4', f: 0.3 });
  theirs.bookmarks[0] = { ...theirs.bookmarks[0], end: { name: 'p9', f: 0.4 } };
  theirs.tags = ['b', 't'];
  theirs.name = 'Renamed';
  theirs.future = { x: 1 };
  const { out, take, joined } = merge(base, mine, theirs);
  assert.deepEqual(
    out.bookmarks.map((x) => x.id),
    ['1', '4', '3'],
    'Each side keeps its additions; a bookmark deleted here is not brought back',
  );
  assert.deepEqual(
    out.bookmarks[0].end,
    { name: 'p9', f: 0.4 },
    'An entry changed only by the other window keeps that change',
  );
  assert.deepEqual(out.tags, ['b', 't', 'm'], 'Tags merge as a set: removals on either side stick');
  assert.equal(out.name, 'Renamed');
  assert.deepEqual(out.future, { x: 1 });
  assert.equal(out.place, 'library');
  assert.deepEqual(out.pages, stored.pages);
  assert.deepEqual(take.sort(), ['future', 'name']);
  assert.deepEqual(joined.sort(), ['bookmarks', 'tags']);
  // 同一个字段两边都改成不同的值：以本窗口（后写入的）为准；对方删掉的书签不会被本窗口加回。
  const m2 = structuredClone(stored),
    t2 = structuredClone(stored);
  m2.name = 'Mine';
  t2.name = 'Theirs';
  t2.bookmarks = t2.bookmarks.slice(1);
  m2.bookmarks.push({ id: '5', name: 'p5', f: 0 });
  const r2 = merge(base, m2, t2);
  assert.equal(r2.out.name, 'Mine');
  assert.deepEqual(
    r2.out.bookmarks.map((x) => x.id),
    ['2', '5'],
  );
  // 本窗口删掉的字段：存储里没变就删掉。
  const m3 = structuredClone(stored);
  delete m3.name;
  assert.equal('name' in merge(base, m3, structuredClone(stored)).out, false);
});
test('多窗口接收：只换进本窗口没有未保存改动的字段；句柄按对象区分本窗口的改动，按种类和名称比较存储里的内容', () => {
  class Handle {
    constructor(name) {
      this.kind = 'directory';
      this.name = name;
    }
  }
  const dir = new Handle('Vol'),
    book = {
      id: 'b',
      sources: [{ key: '', title: 'Vol', dir }],
      bookmarks: [],
      tags: [],
      pages: [{ name: '1.jpg' }, { name: '2.jpg' }],
    };
  const base = snap(book),
    rec = structuredClone({ ...book, sources: [] });
  rec.sources = [{ key: '', title: 'Vol', dir: new Handle('Vol') }];
  assert.deepEqual(
    changes(base, book, rec),
    [],
    'A handle read back from storage is a new object with the same content',
  );
  rec.tags = ['x'];
  rec.pages = [{ name: '1.jpg', w: 5 }, { name: '2.jpg' }];
  book.bookmarks.push({ id: '1' });
  assert.deepEqual(
    changes(base, book, rec).sort(),
    ['pages', 'tags'],
    'Fields with unsaved local changes wait for the next save',
  );
  const page = book.pages[1];
  for (const k of ['pages', 'tags']) adopt(book, k, rec[k]);
  refresh(base, book, ['pages', 'tags']);
  assert.equal(book.pages[1], page, 'Unchanged entries keep their in-memory objects');
  assert.deepEqual(book.pages[0], { name: '1.jpg', w: 5 });
  assert.deepEqual(changes(base, book, rec), []);
  // 本窗口把卷接到同名文件夹的新句柄（恢复失效的句柄）：算作改动，保存时写入，不被存储中的旧句柄盖掉。
  book.sources[0].dir = new Handle('Vol');
  const r = merge(base, book, rec);
  assert.equal(r.out.sources[0].dir, book.sources[0].dir);
  assert.notEqual(print({ a: 1, b: 2 }).l, print({ a: 2, b: 1 }).l);
  assert.equal(print({ a: 1, b: 2 }).l, print({ b: 2, a: 1 }).l);
});
