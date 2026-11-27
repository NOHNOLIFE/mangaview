import test from 'node:test';
import assert from 'node:assert/strict';
import {
  natural,
  shuffled,
  offsets,
  at,
  point,
  sortedPages,
  sortMode,
  folderSort,
  needsSort,
  fileOf,
  shownName,
  compareDirs,
  clipEnd,
  splitTail,
  kindOf,
  pageKind,
  isContent,
  unplayable,
  videoWidth,
  AUDIO_H,
  clock,
  seekStep,
  nudge,
  cellRatio,
} from '../../src/core/model.mjs';
import { dirOf } from '../../src/core/sources.mjs';

test('混合宽度和超长图按同一张图的相对高度定位，而不是按整本比例', () => {
  const pages = [
    { w: 500, h: 500 },
    { w: 1000, h: 20000 },
    { w: 500, h: 500 },
  ];
  const body = offsets(pages, 850, false),
    nav = offsets(pages, 100, true),
    hit = at(nav, 1500);
  assert.deepEqual(hit, { i: 1, f: 0.7 });
  assert.equal(point(body, hit), 12400);
  assert.deepEqual(at(body, 12400), hit);
  assert.deepEqual(at(body, body.at(-1)), { i: 2, f: 1 });
});
test('排序不会漏图、重复或修改原序列', () => {
  const a = ['10.png', '1.png', '2.png'].sort(natural);
  assert.deepEqual(a, ['1.png', '2.png', '10.png']);
  const b = shuffled(a);
  assert.notDeepEqual(a, b);
  assert.deepEqual([...b].sort(natural), a);
  assert.deepEqual(shuffled([]), []);
});
test('旧书保留乱序；文件名和修改时间可反向，未知时间始终在末尾', () => {
  assert.equal(sortMode({ random: true }), 'shuffle');
  assert.equal(sortMode({}), 'nameAsc');
  const pages = [
    { name: '10', lastModified: 5 },
    { name: '2', lastModified: 5 },
    { name: '1' },
    { name: '3', lastModified: 0 },
  ];
  const names = (mode) => sortedPages(pages, mode).map((p) => p.name);
  assert.deepEqual(names('nameAsc'), ['1', '2', '3', '10']);
  assert.deepEqual(names('nameDesc'), ['10', '3', '2', '1']);
  assert.deepEqual(names('timeAsc'), ['3', '2', '10', '1']);
  assert.deepEqual(names('timeDesc'), ['2', '10', '3', '1']);
});
test('默认和单书偏好独立；历史乱序不因升级或重开而重洗', () => {
  const defaults = { mode: 'shuffle', revision: 'one' };
  assert.equal(folderSort({}), null);
  assert.equal(folderSort({ random: true }), 'shuffle');
  assert.equal(folderSort({ sortMode: 'timeDesc' }), 'timeDesc');
  assert.equal(needsSort({ sortMode: 'timeDesc' }, defaults), false);
  assert.equal(needsSort({ random: true }, defaults), false);
  const inherited = { sortOverride: null, sortMode: 'shuffle', shuffleRevision: 'one' };
  assert.equal(needsSort(inherited, defaults), false);
  assert.equal(needsSort(inherited, { ...defaults, revision: 'two' }), true);
  assert.equal(needsSort(inherited, { mode: 'nameDesc' }), true);
  assert.equal(needsSort({ ...inherited, sortOverride: 'shuffle' }, { mode: 'nameDesc' }), false);
});
test('文件名排序统一按路径：目录逐段自然比较，父目录自己的图在子目录之前，同名散图按加入先后', () => {
  assert.ok(compareDirs('A', 'A/sub') < 0);
  assert.ok(compareDirs('Vol 2', 'Vol 10') < 0);
  assert.ok(compareDirs('A/z', 'B') < 0);
  assert.ok(compareDirs('', 'A') < 0);
  assert.ok(compareDirs('Vol 1/x', 'Vol 1 extra') < 0, '逐段比较，不受分隔符字符影响');
  const pages = [
    { name: 'B/1.jpg', path: 'B', file: '1.jpg' },
    { name: 'A/sub/1.jpg', path: 'A/sub', file: '1.jpg' },
    { name: '10.jpg' },
    { name: 'A/2.jpg', path: 'A', file: '2.jpg' },
    { name: '2.jpg (2)', file: '2.jpg' },
    { name: '2.jpg' },
    { name: 'A/10.jpg', path: 'A', file: '10.jpg' },
  ];
  const loose = { sources: [], pages };
  assert.deepEqual(
    sortedPages(pages, 'nameAsc', dirOf(loose)).map((p) => p.name),
    ['2.jpg', '2.jpg (2)', '10.jpg', 'A/2.jpg', 'A/10.jpg', 'A/sub/1.jpg', 'B/1.jpg'],
  );
  assert.deepEqual(
    sortedPages(pages, 'nameDesc', dirOf(loose)).map((p) => p.name),
    ['B/1.jpg', 'A/sub/1.jpg', 'A/10.jpg', 'A/2.jpg', '10.jpg', '2.jpg (2)', '2.jpg'],
  );
  // 单文件夹书：路径只有文件名，结果与按文件名自然排序相同。
  const single = { sources: [{ key: '', path: 'x/y' }], pages: ['10.jpg', '2.jpg', '1.jpg'].map((name) => ({ name })) };
  assert.deepEqual(
    sortedPages(single.pages, 'nameAsc', dirOf(single)).map((p) => p.name),
    ['1.jpg', '2.jpg', '10.jpg'],
  );
  assert.deepEqual(
    ['2.jpg (2)', 'A/2.jpg', '2.jpg'].map((name) => shownName(pages.find((p) => p.name === name))),
    ['2.jpg', 'A/2.jpg', '2.jpg'],
    '界面显示原文件名（带相对目录），不带区分用的序号',
  );
});
test('长名称：作品名末尾省略，文件名拆成可省略的开头和保留的结尾（扩展名及其前 8 个字符）', () => {
  assert.equal(clipEnd('短名'), '短名');
  assert.equal(clipEnd('a'.repeat(40)), 'a'.repeat(40));
  assert.equal(clipEnd('a'.repeat(41)), 'a'.repeat(39) + '…');
  assert.equal([...clipEnd('漫'.repeat(100))].length, 40);
  assert.equal(clipEnd('😀'.repeat(50), 10), '😀'.repeat(9) + '…', '按字符截断，不拆开代理对');
  assert.deepEqual(splitTail('Very long series name - Episode 012.mp4'), [
    'Very long series name - Epi',
    'sode 012.mp4',
  ]);
  assert.deepEqual(splitTail('no extension here at all'), ['no extension her', 'e at all']);
  assert.deepEqual(splitTail('short.jpg'), ['short.jpg', '']);
  assert.deepEqual(splitTail('第一卷第十二话很长很长的名字.webp', 4), ['第一卷第十二话很长很', '长的名字.webp']);
  for (const s of ['Very long series name - Episode 012.mp4', 'x', '第一卷.png'])
    assert.equal(splitTail(s).join(''), s);
});
test('媒体按扩展名识别：视频、音频、图片三类；浏览器播不了的格式单独认出，其余文件不是内容', () => {
  for (const n of ['a.mp4', 'b.M4V', 'c.webm', 'd.mkv', 'e.mov', 'f.ogv']) assert.equal(kindOf(n), 'video', n);
  for (const n of ['a.mp3', 'b.FLAC', 'c.wav', 'd.ogg', 'e.oga', 'f.opus', 'g.m4a', 'h.aac', 'i.weba'])
    assert.equal(kindOf(n), 'audio', n);
  for (const n of ['a.jpg', 'b.PNG', 'c.svg', 'd.webp']) assert.equal(kindOf(n), 'image', n);
  for (const n of ['a.txt', 'b.pbf', 'c.avi', 'noext', 'dir.mp4/readme']) assert.equal(isContent(n), false, n);
  for (const n of [
    'a.avi',
    'b.WMV',
    'c.flv',
    'd.rmvb',
    'e.ts',
    'f.mpg',
    'g.wma',
    'h.ape',
    'i.ac3',
    'j.dts',
    'k.3gp',
    'l.vob',
    'm.m2ts',
    'n.asf',
    'o.rm',
    'p.mpeg',
  ])
    assert.equal(unplayable(n), true, n);
  for (const n of ['a.mp4', 'b.jpg', 'c.txt']) assert.equal(unplayable(n), false, n);
  // 散图的页名可能带区分序号：按文件名（fileOf）判断。
  assert.equal(pageKind({ name: 'clip.mp4 (2)', file: 'clip.mp4' }), 'video');
  assert.equal(pageKind({ name: 'v/song.flac', src: 'v' }), 'audio');
  assert.equal(pageKind({ w: 1, h: 1 }), 'image');
});
test('媒体排版：视频按帧比例（未知按 16:9），高于视窗封顶到一屏并等比缩窄；音频在正文是固定高度、在缩略图栏是小块', () => {
  const pages = [
    { name: '1.jpg', w: 800, h: 1200 },
    { name: '2.mp4', w: 1920, h: 1080 },
    { name: '3.mp4' },
    { name: '4.webm', w: 400, h: 1600 },
    { name: '5.mp3' },
  ];
  const s = offsets(pages, 800, true, 900),
    h = s.slice(1).map((x, i) => Math.round(x - s[i]));
  assert.deepEqual(h, [1200, 450, 450, 900, AUDIO_H]);
  assert.equal(Math.round(videoWidth(pages[3], 800, true, 900)), 225, '封顶后宽度按比例缩小');
  assert.equal(videoWidth(pages[1], 800, true, 900), 800);
  // 「小图不放大」：视频宽度不超过帧宽，与图片同一规则。
  const small = offsets([{ name: 'a.mp4', w: 320, h: 180 }], 800, false, 900);
  assert.equal(small[1], 180);
  assert.equal(videoWidth({ name: 'a.mp4', w: 320, h: 180 }, 800, false, 900), 320);
  // 缩略图栏（nav）：图片照常；视频、音频是与全屏缩略图格子同样比例的小块（cellRatio：已知比例的中位数 1.5）。
  const nav = offsets(pages, 100, true, Infinity, true),
    n = nav.slice(1).map((x, i) => Math.round(x - nav[i]));
  assert.deepEqual(n, [150, 150, 150, 150, 150]);
  const fixed = offsets(pages, 100, true, Infinity, 0.8);
  assert.deepEqual(
    fixed.slice(1).map((x, i) => Math.round(x - fixed[i])),
    [150, 80, 80, 80, 80],
    'nav 为数字时即用它作媒体的比例',
  );
});
test('全屏缩略图的格子比例：已知比例的中位数，限制在 0.7 ~ 1.6，都未知时 1.4', () => {
  assert.equal(cellRatio([]), 1.4);
  assert.equal(cellRatio([{ name: 'a.mp3' }, { name: 'b.jpg' }]), 1.4);
  assert.equal(
    cellRatio([
      { w: 100, h: 120 },
      { w: 100, h: 130 },
      { w: 100, h: 900 },
    ]),
    1.3,
  );
  assert.equal(cellRatio([{ w: 1920, h: 1080 }]), 0.7);
  assert.equal(cellRatio([{ w: 100, h: 400 }]), 1.6);
});
test('媒体时间、快进步长与音量步进', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(65.9), '1:05');
  assert.equal(clock(3600 + 62), '1:01:02');
  assert.equal(clock(NaN), '0:00');
  assert.deepEqual([0, 999, 1000, 1999, 2000, 2999, 3000, 60000].map(seekStep), [2, 2, 5, 5, 10, 10, 30, 30]);
  assert.equal(nudge(1, 1), 1);
  assert.equal(nudge(0, -1), 0);
  assert.equal(nudge(0.5, 1), 0.55);
  let v = 1;
  for (let i = 0; i < 7; i++) v = nudge(v, -1);
  assert.equal(v, 0.65);
  assert.equal(nudge(undefined, -1), 0.95);
});
