import test from 'node:test';
import assert from 'node:assert/strict';
import { isContent, isPbf, pairPbf } from '../../src/core/model.mjs';
import {
  skipped,
  handleGroups,
  fileGroups,
  scan,
  applyNames,
  listDir,
  addLoose,
  looseImages,
  pairFrom,
  pbfFile,
  hasPbf,
} from '../../src/core/sources.mjs';
import { parsePbf, decodePbf, mergePbf, pbfId } from '../../src/marks/pbf.mjs';

// ---- PotPlayer 书签（.pbf，第 11 节）：测试用的 .pbf 现场构造，不读任何真实文件。
const BOM = String.fromCharCode(0xfeff),
  HEX = '89504e470d0a1a0a0000000d49484452'.repeat(4);
const pbfText = (lines) => BOM + '[Bookmark]\r\n' + lines.join('\r\n') + '\r\n';
const utf16 = (text) => new Uint8Array(Buffer.from(text, 'utf16le'));

test('解析 .pbf：UTF-16LE 带 BOM，[Bookmark] 小节，只取时间和名称', () => {
  const text = pbfText(['0=1500*Opening*' + HEX, '1=62000**', '2=90500*A * B*' + HEX, '3=120000*名前*ネーム*', '4=']);
  const bytes = utf16(text);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], 'The fixture starts with the UTF-16LE BOM');
  assert.deepEqual(
    parsePbf(decodePbf(bytes)),
    [
      { ms: 1500, name: 'Opening' },
      { ms: 62000, name: '' },
      { ms: 90500, name: 'A * B' },
      { ms: 120000, name: '名前*ネーム' },
    ],
    'Name is between the first and the last *, may contain *; empty image segment; trailing empty line skipped',
  );
  assert.deepEqual(parsePbf(decodePbf(utf16(text).buffer)), parsePbf(text), 'Accepts an ArrayBuffer');
  assert.deepEqual(
    parsePbf(decodePbf(new TextEncoder().encode(text))),
    parsePbf(text),
    'UTF-8 (with BOM) also decodes',
  );
  assert.deepEqual(parsePbf(decodePbf(utf16(text.slice(1)))), parsePbf(text), 'UTF-16LE without BOM is guessed');
});
test('解析 .pbf：坏行跳过，其他小节忽略，整个文件无法解析时为空', () => {
  const text =
    BOM +
    '[Settings]\n0=5000*Not a bookmark*\n[Bookmark]\n0=abc*x*\n1=2000\n2=3000*only one star\n3=-4000*neg*\n4=5000*bad image*xyz!\nnoise\n5 = 6000 * Spaced * ' +
    HEX +
    ' \n6=7000*ok*\n[Other]\n7=8000*after*\n';
  assert.deepEqual(parsePbf(text), [
    { ms: 6000, name: 'Spaced' },
    { ms: 7000, name: 'ok' },
  ]);
  for (const junk of ['', 'garbage', BOM, '[Bookmark]', null, undefined, 42]) assert.deepEqual(parsePbf(junk), []);
  assert.deepEqual(parsePbf(decodePbf(new Uint8Array([0, 1, 2, 3, 255, 254]))), []);
});
test('.pbf 与同目录主文件名相同的媒体配对，也接受 X.flac.pbf；有歧义时不猜', () => {
  assert.equal(isPbf('a.PBF'), true);
  assert.equal(isPbf('a.pbf.txt'), false);
  assert.equal(isContent('a.pbf'), false, 'A .pbf is not a page');
  const pairs = pairPbf(
    ['Song.flac', 'clip.mp4', 'Clip2.webm', 'pic.png', 'pic.mp3', 'dup.mp4', 'dup.mkv', 'img.jpg'],
    ['song.pbf', 'clip.mp4.pbf', 'CLIP2.pbf', 'pic.pbf', 'dup.pbf', 'img.pbf', 'none.pbf'],
  );
  assert.deepEqual(
    [...pairs].sort(),
    [
      ['Clip2.webm', 'CLIP2.pbf'],
      ['Song.flac', 'song.pbf'],
      ['clip.mp4', 'clip.mp4.pbf'],
      ['pic.mp3', 'pic.pbf'],
    ],
    'Case-insensitive; images are not paired; one stem with two media files is skipped; a .pbf without media is ignored',
  );
  assert.deepEqual(
    [...pairPbf(['X.flac'], ['X.pbf', 'X.flac.pbf'])],
    [['X.flac', 'X.flac.pbf']],
    'X.flac.pbf wins over X.pbf',
  );
  assert.deepEqual([...pairPbf(['X.flac'], ['X.pbf'])], [['X.flac', 'X.pbf']]);
  assert.equal(pairPbf(['a.mp3'], []).size, 0);
});
test('合并 .pbf：只增不删，1 秒内去重，名称跟随 .pbf（手动改过的除外），删过的不加回', () => {
  const user = { id: 'u', name: 'a.mp4', t: 10.4, at: 1, label: 'a-Bookmark1' },
    other = { id: 'o', name: 'b.mp4', t: 20, at: 1, label: 'b-Bookmark1' },
    sec = { id: 's', name: 'a.mp4', t: 40, at: 1, label: 'a-Bookmark2', end: { name: 'a.mp4', t: 50, at: 1 } };
  const marks = [user, other, sec],
    naming = { file: 'a', word: 'Bookmark' };
  let r = mergePbf(
    marks,
    'a.mp4',
    [
      { ms: 10000, name: 'Intro' },
      { ms: 20000, name: 'Chorus' },
      { ms: 20500, name: 'Near' },
      { ms: 49500, name: 'At end' },
      { ms: 30000, name: '' },
    ],
    [],
    7,
    naming,
  );
  assert.deepEqual(
    r.added,
    [
      { id: pbfId('a.mp4', 20000), name: 'a.mp4', t: 20, at: 7, label: 'a-Chorus', pbfName: 'Chorus', from: 'pbf' },
      { id: pbfId('a.mp4', 30000), name: 'a.mp4', t: 30, at: 7, label: 'a-Bookmark3', pbfName: '', from: 'pbf' },
    ],
    'Within 1 s of an existing bookmark (or a section end, or another new one) is the same; other files do not count; ' +
      '<file>-<pbf name>, unnamed ones numbered after the highest number in this file',
  );
  assert.equal(user.label, 'a-Intro', 'An app bookmark that has no .pbf name yet takes it');
  assert.equal(user.pbfName, 'Intro');
  assert.deepEqual(r.renamed, [user]);
  assert.equal(other.label, 'b-Bookmark1');
  assert.deepEqual(
    r.done.sort((a, b) => a - b),
    [10000, 20000, 20500, 30000, 49500],
  );
  assert.equal(pbfId('a.mp4', 20000), pbfId('a.mp4', 20000), 'Ids depend only on the page and the time');
  assert.notEqual(pbfId('a.mp4', 20000), pbfId('b.mp4', 20000));
  // 第二次：PotPlayer 里改了名称、删了一条、加了一条；应用内删掉了 30 秒那条。
  const [chorus] = r.added,
    all = [...marks, chorus];
  r = mergePbf(
    all,
    'a.mp4',
    [
      { ms: 10000, name: 'Intro' },
      { ms: 20000, name: 'Chorus 2' },
      { ms: 30000, name: '' },
      { ms: 60000, name: 'New * one' },
    ],
    r.done,
    8,
    naming,
  );
  assert.equal(chorus.label, 'a-Chorus 2', 'Names of imported bookmarks follow the .pbf');
  assert.equal(chorus.pbfName, 'Chorus 2');
  assert.deepEqual(r.renamed, [chorus]);
  assert.deepEqual(
    r.added.map((m) => [m.t, m.label]),
    [[60, 'a-New * one']],
    'Deleted in the app: not added back; new entries added',
  );
  assert.equal(all.length, 4, 'Entries removed in PotPlayer stay');
  // 手动改过名称的不被 .pbf 覆盖（原名照常记下）；.pbf 清空名称的按应用内规则编号。
  const added = r.added[0];
  added.label = 'Mine';
  added.named = true;
  r = mergePbf(
    [...all, added],
    'a.mp4',
    [
      { ms: 20000, name: '' },
      { ms: 10000, name: 'Renamed' },
      { ms: 60000, name: 'New name' },
    ],
    r.done,
    9,
    naming,
  );
  assert.equal(chorus.label, 'a-Bookmark3', 'Cleared name of an imported bookmark: numbered');
  assert.equal(chorus.pbfName, '');
  assert.equal(user.label, 'a-Intro', 'An app bookmark keeps the name it got');
  assert.equal(added.label, 'Mine', 'A name changed by the user is kept');
  assert.equal(added.pbfName, 'New name');
  assert.deepEqual(new Set(r.renamed), new Set([chorus, added]));
  // 没有变化时不算改名。
  r = mergePbf([...all, added], 'a.mp4', [{ ms: 20000, name: '' }], r.done, 10, naming);
  assert.deepEqual(r.renamed, []);
  assert.deepEqual(mergePbf([], 'a.mp4', [], []), { added: [], renamed: [], done: [] });
  assert.deepEqual(
    mergePbf([user], 'a.mp4', [
      { ms: 11400, name: 'x' },
      { ms: 12400, name: 'y' },
    ]).added.map((m) => [m.t, m.label]),
    [
      [11.4, 'a-x'],
      [12.4, 'a-y'],
    ],
    'Exactly 1 s apart is a different bookmark; the file name defaults to the page name without its extension',
  );
});
test('合并 .pbf：2.3.0 导入的书签只有原名（label），按新规则改名并另存原名', () => {
  const old = { id: pbfId('dir/Song.flac', 5000), name: 'dir/Song.flac', t: 5, at: 1, label: 'Verse', from: 'pbf' },
    bare = { id: pbfId('dir/Song.flac', 9000), name: 'dir/Song.flac', t: 9, at: 1, from: 'pbf' };
  const r = mergePbf(
    [old, bare],
    'dir/Song.flac',
    [
      { ms: 5000, name: 'Verse' },
      { ms: 9000, name: '' },
    ],
    [5000, 9000],
    2,
    { file: 'Song', word: '书签' },
  );
  assert.deepEqual(r.added, []);
  assert.deepEqual([old.label, old.pbfName], ['Song-Verse', 'Verse']);
  assert.deepEqual([bare.label, bare.pbfName], ['Song-书签1', '']);
  assert.deepEqual(new Set(r.renamed), new Set([old, bare]));
});
test('.pbf 的配对随扫描、刷新、散图一同得出，读取只取配对的那个文件', async () => {
  const file = (name, body = 'x') => ({
    kind: 'file',
    name,
    getFile: async () => new File([body], name, { lastModified: 5 }),
  });
  const dir = (name, entries) => ({
    name,
    kind: 'directory',
    queryPermission: async () => 'granted',
    async *values() {
      yield* entries;
    },
    async getFileHandle(n) {
      const h = entries.find((e) => e.name === n);
      if (!h) throw new DOMException('', 'NotFoundError');
      return h;
    },
  });
  const odd = skipped(),
    root = dir('Root', [
      file('a.mp4'),
      file('a.pbf', 'AAA'),
      file('b.flac'),
      file('b.flac.pbf'),
      file('c.png'),
      file('c.pbf'),
      file('lone.pbf'),
    ]);
  const [g] = await Array.fromAsync(scan(root, '', odd));
  assert.deepEqual(
    g.pages.map((p) => [p.name, p.pbf?.file ?? null]),
    [
      ['a.mp4', 'a.pbf'],
      ['b.flac', 'b.flac.pbf'],
      ['c.png', null],
    ],
    '.pbf files are not pages; images are not paired',
  );
  assert.equal(odd.n, 0, 'A .pbf is not reported as unsupported');
  const names = await listDir(root);
  assert.deepEqual(names, ['a.mp4', 'b.flac', 'c.png']);
  assert.deepEqual(names.pbf, ['a.pbf', 'b.flac.pbf', 'c.pbf', 'lone.pbf']);
  const s = { key: '', title: 'Root', dir: root },
    book = { id: 'x', sources: [s], pages: g.pages, bookmarks: [] };
  book.pages[0].pbf.done = [1000];
  assert.equal(await (await pbfFile(book, book.pages[0])).text(), 'AAA');
  assert.equal(await pbfFile(book, book.pages[2]), null);
  // 刷新：a.pbf 消失、c.mp3 出现并带着 c.pbf；配对消失时已处理过的条目保留。
  applyNames(book, s, Object.assign(['a.mp4', 'b.flac', 'c.png', 'c.mp3'], {}), false, ['b.flac.pbf', 'c.pbf']);
  assert.deepEqual(
    book.pages.map((p) => [p.name, p.pbf ?? null]),
    [
      ['a.mp4', { done: [1000] }],
      ['b.flac', { file: 'b.flac.pbf' }],
      ['c.png', null],
      ['c.mp3', { file: 'c.pbf' }],
    ],
  );
  assert.equal(hasPbf(book.pages[0]), false);
  assert.equal(hasPbf(book.pages[3]), true);
  applyNames(book, s, ['a.mp4', 'b.flac', 'c.png', 'c.mp3']);
  assert.equal(book.pages[1].pbf.file, 'b.flac.pbf', 'Without a listing of .pbf files the pairing is untouched');
  // 重新关联文件夹（app.mjs link）：按扫描结果配对。
  pairFrom(book, s, [{ name: 'a.mp4', pbf: { file: 'a.pbf' } }, { name: 'b.flac' }]);
  assert.deepEqual(
    book.pages.map((p) => p.pbf?.file ?? null),
    ['a.pbf', null, null, null],
  );
  assert.deepEqual(book.pages[0].pbf.done, [1000]);
  // 散图：只与同一批拖入（或同一目录里）的 .pbf 配对，记下句柄。
  const lp = (await Array.fromAsync(handleGroups([file('x.mp3'), file('x.pbf', 'X'), file('y.mp3'), root]))).find(
    (g) => g.title === null,
  );
  assert.deepEqual(
    lp.pages.map((p) => [p.name, !!p.pbf?.handle]),
    [
      ['x.mp3', true],
      ['y.mp3', false],
    ],
  );
  assert.equal(await (await pbfFile({ sources: [] }, lp.pages[0])).text(), 'X');
  const [li] = await looseImages([
    dir('Box', [file('m.webm'), file('m.pbf', 'M'), dir('Sub', [file('n.mp3'), file('m.pbf')])]),
    file('top.mp3'),
    file('top.pbf', 'T'),
  ]);
  assert.deepEqual(
    li.pages.map((p) => [p.name, !!p.pbf?.handle]).sort(),
    [
      ['Box/Sub/n.mp3', false],
      ['Box/m.webm', true],
      ['top.mp3', true],
    ],
    'A .pbf pairs only within its own folder',
  );
  // 文件选择器回退：本次会话的 File。
  const fg = fileGroups([
    new File(['1'], 'v.mp4', { type: 'video/mp4' }),
    new File(['P'], 'v.pbf'),
    new File(['2'], 'w.mp4', { type: 'video/mp4' }),
  ]);
  assert.deepEqual(fg.length, 1);
  assert.deepEqual(
    fg[0].pages.map((p) => [p.name, hasPbf(p)]),
    [
      ['v.mp4', true],
      ['w.mp4', false],
    ],
  );
  assert.equal(await (await pbfFile({ sources: [] }, fg[0].pages[0])).text(), 'P');
  // 并入散图图集时，已有的同一个文件接上新拖入的 .pbf。
  const album = { id: 'L', title: null, sources: [], pages: [], bookmarks: [] },
    h = file('q.mp3');
  await addLoose(album, [{ name: 'q.mp3', handle: h }]);
  await addLoose(album, [{ name: 'q.mp3', handle: h, pbf: { handle: file('q.pbf', 'Q') } }]);
  assert.equal(album.pages.length, 1);
  assert.equal(await (await pbfFile(album, album.pages[0])).text(), 'Q');
});
