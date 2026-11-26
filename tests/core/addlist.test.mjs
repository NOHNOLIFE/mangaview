import test from 'node:test';
import assert from 'node:assert/strict';
import { limits } from '../../src/core/sources.mjs';
import {
  ACCEPT,
  PICK_TYPES,
  fromHandle,
  fromFiles,
  typeOf,
  same,
  append,
  split,
  hasFolder,
} from '../../src/shelf/addlist.mjs';

// 模拟的句柄：isSameEntry 按 id 比较，并记下调用次数。
let asked = 0;
const handle = (kind, name, id = name, extra = {}) => ({
  kind,
  name,
  id,
  isSameEntry: async (o) => (asked++, o.id === id),
  ...extra,
});
const file = (path, size = 1, lastModified = 1) => {
  const name = path.split('/').pop();
  return { name, size, lastModified, webkitRelativePath: path.includes('/') ? path : '' };
};

test('文件选择框在图片、视频、音频、.pbf 之外也接受外挂字幕', () => {
  const exts = Object.values(PICK_TYPES).flat();
  for (const x of ['.srt', '.vtt', '.ass', '.ssa', '.lrc', '.pbf', '.jpg', '.mp4', '.flac'])
    assert.ok(exts.includes(x), x);
  assert.equal(ACCEPT, 'image/*,video/*,audio/*,.pbf,.srt,.vtt,.ass,.ssa,.lrc');
});

test('待添加项只记句柄；回退的 <input>：一次文件夹选择是一项，选中的文件各是一项', () => {
  const d = handle('directory', 'Vol 1');
  assert.deepEqual(fromHandle(d), { kind: 'directory', name: 'Vol 1', handle: d });
  const items = fromFiles([file('A/1.jpg'), file('A/sub/2.jpg'), file('B/1.jpg'), file('x.png'), file('x.srt')]);
  assert.deepEqual(
    items.map((it) => [it.kind, it.name, it.files.length]),
    [
      ['directory', 'A', 2],
      ['directory', 'B', 1],
      ['file', 'x.png', 1],
      ['file', 'x.srt', 1],
    ],
  );
});

test('列表里的类型图标：文件夹、图片、视频、音频，其余（字幕、.pbf）为普通文件', () => {
  const t = (kind, name) => typeOf({ kind, name });
  assert.equal(t('directory', 'a.mp4'), 'folder');
  assert.equal(t('file', 'a.JPG'), 'image');
  assert.equal(t('file', 'a.mkv'), 'video');
  assert.equal(t('file', 'a.flac'), 'audio');
  assert.equal(t('file', 'a.zh.srt'), 'file');
  assert.equal(t('file', 'a.pbf'), 'file');
});

test('重复选入同一个文件夹 / 文件只列一次：句柄用 isSameEntry，名称不同的不必再问', async () => {
  const list = [];
  const a = handle('directory', 'A', 1),
    a2 = handle('directory', 'A', 1), // 再次选择同一个文件夹得到的新句柄
    other = handle('directory', 'A', 2), // 别处的同名文件夹
    f = handle('file', 'A', 3); // 同名的文件不是同一项
  let r = await append(list, [a, handle('file', 'p.png', 9)].map(fromHandle));
  assert.equal(r.added.length, 2);
  asked = 0;
  r = await append(list, [a2, other, f, a2].map(fromHandle));
  assert.deepEqual(
    r.added.map((it) => it.handle),
    [other, f],
  );
  assert.deepEqual(r.dups, [list[0]], 'The existing row is reported once');
  assert.equal(list.length, 4);
  assert.ok(asked <= 6, 'Only same-name entries are compared: ' + asked);
  assert.equal(await same(fromHandle(a), fromHandle(handle('directory', 'B', 1))), false);
});

test('isSameEntry 卡住时按不同处理（经 sources 的 timed 限时）', async () => {
  const keep = { ...limits };
  limits.first = limits.next = 30;
  try {
    const hang = handle('directory', 'H', 1, { isSameEntry: () => new Promise(() => {}) });
    assert.equal(await same(fromHandle(hang), fromHandle(handle('directory', 'H', 1))), false);
  } finally {
    Object.assign(limits, keep);
  }
});

test('回退项按相对路径、大小、修改时间去重', async () => {
  const list = fromFiles([file('A/1.jpg'), file('A/2.jpg'), file('x.png', 5, 7)]);
  const r = await append(list, [
    ...fromFiles([file('A/2.jpg'), file('A/1.jpg')]),
    ...fromFiles([file('A/1.jpg', 2)]),
    ...fromFiles([file('x.png', 5, 7), file('x.png', 5, 8)]),
  ]);
  assert.equal(r.added.length, 2, 'Changed folder content and a different file are new');
  assert.equal(r.dups.length, 2);
  assert.equal(list.length, 4);
});

test('确认时交给导入流程：句柄、其中的文件夹（单个作品的根）与回退的 File', () => {
  const d = handle('directory', 'D'),
    f = handle('file', 'f.jpg'),
    files = fromFiles([file('B/1.jpg'), file('c.png')]);
  const out = split([fromHandle(d), fromHandle(f), ...files]);
  assert.deepEqual(out.handles, [d, f]);
  assert.deepEqual(out.dirs, [d]);
  assert.deepEqual(
    out.files.map((x) => x.name),
    ['1.jpg', 'c.png'],
  );
  assert.equal(hasFolder([fromHandle(f)]), false);
  assert.equal(hasFolder([fromHandle(f), ...files]), true);
});
