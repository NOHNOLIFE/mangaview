import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, assign, coverName, hue, norm, mediaOverlap } from '../../src/core/match.mjs';

test('过期书匹配：同名同封面自动恢复，改名或换封面需确认，一个文件夹只配一本书', () => {
  const book = (title, hash, names = ['1.jpg', '2.jpg']) => ({
    title,
    pages: names.map((name) => ({ name })),
    fp: hash && { cover: { hash } },
  });
  const cand = (title, hash, names = ['1.jpg', '2.jpg']) => ({ title, hash, names });
  assert.equal(grade(book('Ａlpha  Book', 'h1'), cand('alpha book', 'h1')).level, 2);
  assert.equal(grade(book('A', 'h1'), cand('B', 'h1')).level, 1);
  assert.equal(grade(book('A', 'h1'), cand('A', 'h2')).level, 1);
  assert.equal(grade(book('A', null), cand('A', null)).level, 2);
  assert.equal(grade(book('A', null, ['1.jpg']), cand('A', null, ['9.jpg'])).level, 1);
  assert.equal(grade(book('A', 'h1'), cand('B', 'h2')).level, 0);
  const b1 = book('A', 'h1'),
    b2 = book('A', 'h2'),
    c1 = cand('A', 'h1');
  const out = assign([
    { book: b2, cand: c1, ...grade(b2, c1) },
    { book: b1, cand: c1, ...grade(b1, c1) },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].book, b1);
  assert.equal(coverName(['10.jpg', '2.jpg', 'b.png']), '2.jpg');
  assert.equal(hue('热血'), hue(' 热血 '));
  assert.equal(norm('ＡＢ  c'), 'ab c');
});

test('媒体的恢复与识别：不做全文件哈希，按文件名 + 精确大小比较；改名或首个文件对不上时按重合度列出确认，同名不同大小不自动匹配', () => {
  const vids = ['01.mp4', '02.mp4', '03.mkv', '04.mp3'],
    sizes = new Map(vids.map((n, i) => [n, 1000 + i]));
  const book = (title, hash, size = (i) => 1000 + i) => ({
    title,
    pages: vids.map((name, i) => ({ name, size: size(i) })),
    fp: hash && { cover: { hash } },
  });
  const cand = (title, hash, s = sizes) => ({ title, hash, names: vids, sizes: s });
  assert.equal(mediaOverlap(book('A').pages, sizes), 1);
  assert.equal(mediaOverlap(book('A').pages, new Map([...sizes, ['02.mp4', 5]])), 0.6, '同名不同大小不算重合');
  assert.equal(mediaOverlap([{ name: '1.jpg', size: 1 }], sizes), null, '只比较媒体文件');
  assert.equal(mediaOverlap([{ name: '01.mp4' }], sizes), null, '记录里还不知道大小的不比较');
  assert.equal(mediaOverlap(book('A').pages, undefined), null);
  // 名称与首个文件的指纹都一致：自动接回（不变）。
  assert.equal(grade(book('A', 'h'), cand('A', 'h')).level, 2);
  // 文件夹改名、首个文件也对不上：媒体的文件名 + 大小几乎全对上时列出来由用户确认；对不上的仍不匹配。
  assert.equal(grade(book('A', 'h'), cand('B', 'x')).level, 1);
  assert.equal(grade(book('A', 'h'), cand('B', 'x', new Map([['01.mp4', 1]]))).level, 0);
  assert.equal(grade(book('A', 'h'), cand('B', 'x', null)).level, 0, '没有读到大小时照旧不匹配');
  assert.equal(
    grade(
      book('A', 'h', (i) => (i ? 1000 + i : 1)),
      cand('B', 'x'),
    ).level,
    1,
    '首个文件变了、其余都对上（4 个里 3 个，0.6）也列出来确认',
  );
  assert.equal(
    grade(
      book('A', 'h', (i) => (i > 1 ? 1000 + i : i)),
      cand('B', 'x'),
    ).level,
    0,
    '只对上一半不列出',
  );
  // 名称相同、没有指纹可比：文件名全重合但有媒体大小不同，不自动接回。
  assert.equal(grade(book('A', null), cand('A', null)).level, 2);
  assert.equal(
    grade(
      book('A', null, (i) => (i === 1 ? 7 : 1000 + i)),
      cand('A', null),
    ).level,
    1,
  );
  // 重合度高的排在前面。
  assert.ok(
    grade(book('A', 'h'), cand('B', 'x')).score >
      grade(book('A', 'h'), cand('B', 'x', new Map([['01.mp4', 1000]]))).score,
  );
});
test('一个文件夹只能接回一本单文件夹书，但可以同时是多本合并作品中的一卷', () => {
  const c = { title: 'Vol 1', hash: 'h', names: ['1.jpg'] },
    one = { title: 'Vol 1', pages: [{ name: '1.jpg' }], fp: { cover: { hash: 'h' } } };
  const slot = (book, merged) => ({ book, source: {}, merged, cand: c, ...grade(one, c) });
  const out = assign([slot({}, false), slot({}, false), slot({}, true), slot({}, true)]);
  assert.equal(out.length, 3);
  assert.equal(out.filter((p) => !p.merged).length, 1);
  const book = {},
    a = { ...slot(book, true), source: {} },
    b = { ...slot(book, true), source: {} };
  assert.equal(assign([a, b]).length, 1, '同一本合并作品的两卷不能接到同一个文件夹');
});
