import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../src/core/normalize.mjs';

test('旧记录补齐字段，单文件夹记录转为一个源，会话内的标记清掉', () => {
  const dir = { kind: 'directory' };
  const b = normalize({
    id: 'a',
    title: 'A',
    path: 'x/A',
    dir,
    missing: true,
    tags: 'bad',
    pages: [{ name: '1.png' }],
  });
  assert.equal(b.place, 'shelf');
  assert.ok(Number.isFinite(b.added));
  assert.deepEqual(b.tags, []);
  assert.deepEqual(b.bookmarks, []);
  assert.deepEqual(b.sources, [{ key: '', title: 'A', path: 'x/A', dir }]);
  assert.equal('dir' in b, false);
  assert.equal('missing' in b, false);
});
test('坏的源和字段跳过；暂存的页放回原位并按书的排序排好', () => {
  const b = normalize({
    id: 'b',
    place: 'library',
    sources: [{ key: 'V1', title: 'V1', missing: true }, null, { key: 3 }, { key: 'V2', title: 'V2' }],
    roots: 'bad',
    pages: [{ name: 'V2/1.png', src: 'V2' }],
    parked: [{ name: 'V1/1.png', src: 'V1' }],
  });
  assert.equal(b.place, 'library');
  assert.deepEqual(
    b.sources.map((s) => s.key),
    ['V1', 'V2'],
  );
  assert.equal(b.sources[0].missing, undefined);
  assert.equal('roots' in b, false);
  assert.equal('parked' in b, false);
  assert.deepEqual(
    b.pages.map((p) => p.name),
    ['V1/1.png', 'V2/1.png'],
  );
});
test('散图图集：旧页名里的相对目录拆成 path 与 file', () => {
  const b = normalize({ id: 'c', title: null, pages: [{ name: 'sub/1.png' }, { name: '2.png' }] });
  assert.deepEqual(b.sources, []);
  assert.deepEqual(b.pages[0], { name: 'sub/1.png', path: 'sub', file: '1.png' });
});
