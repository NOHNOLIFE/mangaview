import test from 'node:test';
import assert from 'node:assert/strict';
import { expired, lostSources, looseLost, handlesOf } from '../../src/core/status.mjs';

test('全部源都找不到才算过期，合并作品只统计暂时找不到的卷', () => {
  const dir = { kind: 'directory' };
  const book = (...missing) => ({
    sources: ['A', 'B', 'C'].map((key, i) => ({ key, title: key, dir, ...(missing[i] && { missing: true }) })),
    pages: [],
  });
  assert.equal(expired(book(0, 0, 0)), false);
  assert.equal(expired(book(1, 1, 1)), true);
  assert.equal(lostSources(book(0, 1, 0)), 1);
  assert.equal(lostSources(book(1, 1, 1)), 0);
  assert.equal(lostSources({ sources: [{ key: '', title: 'A', missing: true }], pages: [] }), 0);
});
test('散图图集：没有可用句柄即过期，缺句柄的页在恢复时顺带找回', () => {
  const handle = { kind: 'file' };
  assert.equal(expired({ sources: [], pages: [{ name: '1.png' }] }), true);
  assert.equal(expired({ sources: [], pages: [{ name: '1.png', handle }] }), false);
  assert.equal(looseLost({ sources: [], pages: [{ name: '1.png', handle }, { name: '2.png' }] }), true);
  assert.equal(looseLost({ sources: [], pages: [{ name: '1.png', handle }] }), false);
});
test('书引用的文件夹句柄含合并作品的根文件夹，没有句柄的源不计', () => {
  const a = { kind: 'directory' },
    b = { kind: 'directory' },
    root = { kind: 'directory' };
  assert.deepEqual(
    handlesOf([{ sources: [{ key: '', dir: a }] }, { sources: [{ key: 'x', dir: b }, { key: 'y' }], roots: [root] }]),
    [a, b, root],
  );
});
