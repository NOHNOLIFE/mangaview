import test from 'node:test';
import assert from 'node:assert/strict';
import { isContent, isSub, pairSubs, defaultSub } from '../../src/core/model.mjs';
import { parseSubs, decodeSubs, encodings, cuesAt, clockOf } from '../../src/core/subtitles.mjs';
import {
  skipped,
  scan,
  listDir,
  applyNames,
  pairFrom,
  handleGroups,
  looseImages,
  fileGroups,
  addLoose,
  addLooseSubs,
  reconnect,
  subsOf,
  subFile,
} from '../../src/core/sources.mjs';
import { strip } from '../../src/panels/backup.mjs';

const cues = (text, name) => parseSubs(text, name).map((c) => [c.start, c.end, c.text]);

test('字幕：SRT 去掉 <i> <b> <font> 与夹带的 ASS 覆写，CRLF、缺空行、坏时间都不报错', () => {
  const srt =
    '1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> &amp; <font color="red">world</font>\r\n<b>two</b>\r\n\r\n' +
    '2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Top\r\n3\r\n00:00:05.5 --> 00:00:06\r\nNo blank line\r\n\r\n' +
    '4\r\n00:00:xx,000 --> 00:00:08,000\r\nbad time\r\n\r\n5\r\n00:00:09,000 --> 00:00:08,000\r\nends early\r\n\r\n' +
    '6\r\n00:00:10,000 --> 00:00:11,000\r\n<i></i>\r\n';
  assert.deepEqual(cues(srt, 'a.srt'), [
    [1, 2.5, 'Hello & world\ntwo'],
    [3, 4, 'Top'],
    [5.5, 6, 'No blank line'],
  ]);
  assert.deepEqual(cues('﻿1\n01:02:03,04 --> 01:02:04,5\nX\n', 'B.SRT'), [[3723.04, 3724.5, 'X']], 'BOM, hours');
});
test('字幕：VTT 跳过文件头、NOTE / STYLE / REGION，忽略定位设置，去掉 <v> <c> <ruby> 与行内时间', () => {
  const vtt =
    'WEBVTT - title\nKind: captions\n\nSTYLE\n::cue { color: red }\n\nNOTE a comment\n--> not a cue\n\n' +
    'intro\n00:01.000 --> 00:02.000 position:10% line:0 align:start\n<v Bob>Hi <c.yellow>you</c></v>\n\n' +
    '00:00:02.500 --> 00:00:04.000\n<ruby>漢<rt>かん</rt></ruby>字 &lt;3 <00:00:03.000>later\n';
  assert.deepEqual(cues(vtt, 'a.vtt'), [
    [1, 2, 'Hi you'],
    [2.5, 4, '漢字 <3 later'],
  ]);
});
test('字幕：ASS / SSA 只取 Dialogue 的文字和时间，去掉覆写、定位，\\N 换行，绘图整行丢弃，多层相同的只留一条', () => {
  const ass =
    '[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Arial\n\n[Events]\n' +
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\pos(10,20)\\b1\\c&H00FFFF&}Hello, world\\Nnext\\hline\n' +
    'Dialogue: 1,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\bord3}Hello, world\\Nnext\\hline\n' +
    'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}\n' +
    'Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\p2}m 0 0 l 1 1{\\p0}Caption\n' +
    'Comment: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,hidden\n' +
    'Dialogue: 0,0:00:bad,0:00:06.00,Default,,0,0,0,,bad\nDialogue: too,few\n';
  assert.deepEqual(cues(ass, 'a.ass'), [
    [1, 2.5, 'Hello, world\nnext line'],
    [4, 5, 'Caption'],
  ]);
  const ssa =
    '[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    'Dialogue: Marked=0,0:00:00.50,0:00:01.00,*Default,,0000,0000,0000,,SSA {\\i1}text\n';
  assert.deepEqual(cues(ssa, 'a.ssa'), [[0.5, 1, 'SSA text']]);
});
test('字幕：LRC 一行多个时间标签、offset、逐字时间；每行持续到下一行，最后一行到结束，空行清屏', () => {
  const lrc =
    '[ti:Song]\n[ar:Someone]\n[offset:+500]\n[00:01.00][00:05.50]Chorus <00:01.50>word\n[00:03.00]Verse\n[00:04.00]\n' +
    '[bad]x\n[1:7]Short\n';
  assert.deepEqual(cues(lrc, 'a.lrc'), [
    [0.5, 2.5, 'Chorus word'],
    [2.5, 3.5, 'Verse'],
    [5, 66.5, 'Chorus word'],
    [66.5, Infinity, 'Short'],
  ]);
  assert.deepEqual(cues('[offset:-1000]\n[00:00.20]A\n', 'x.lrc'), [[1.2, Infinity, 'A']]);
});
test('字幕：认不出的扩展名按内容判断；不是字幕的内容、非字符串为空列表', () => {
  assert.deepEqual(cues('1\n00:00:01,000 --> 00:00:02,000\nX\n', 'a.txt'), [[1, 2, 'X']]);
  assert.deepEqual(cues('[00:01.00]L\n', ''), [[1, Infinity, 'L']]);
  assert.deepEqual(cues('just text', 'a.txt'), []);
  assert.deepEqual(parseSubs(null, 'a.srt'), []);
  assert.deepEqual(parseSubs('garbage --> more\n\n', 'a.srt'), []);
  assert.ok(Number.isNaN(clockOf('1:2:3:4')));
});
test('字幕：某一时刻正在显示的 cue，重叠的都算，长时间重叠的不漏', () => {
  const list = parseSubs(
    '00:00:00,000 --> 00:00:10,000\nlong\n\n00:00:01,000 --> 00:00:02,000\na\n\n00:00:01,500 --> 00:00:03,000\nb\n\n00:00:05,000 --> 00:00:06,000\nc\n',
    'a.srt',
  );
  const at = (t) => cuesAt(list, t).map((c) => c.text);
  assert.deepEqual(at(0.5), ['long']);
  assert.deepEqual(at(1.7), ['long', 'a', 'b']);
  assert.deepEqual(at(2), ['long', 'b'], 'end is exclusive');
  assert.deepEqual(at(5.5), ['long', 'c']);
  assert.deepEqual(at(10), []);
  assert.deepEqual(cuesAt([], 1), []);
  assert.deepEqual(cuesAt(list, NaN), []);
});
test('字幕解码：BOM 优先，再 UTF-8 严格，再按界面语言的顺序试 GB18030 / Big5 / Shift_JIS / EUC-KR，都不行宽松 UTF-8', () => {
  const b = (...x) => new Uint8Array(x);
  assert.equal(decodeSubs(b(0xef, 0xbb, 0xbf, 0x41)), 'A');
  assert.equal(decodeSubs(b(0xff, 0xfe, 0x60, 0x4f)), '你');
  assert.equal(decodeSubs(b(0xfe, 0xff, 0x4f, 0x60)), '你');
  assert.equal(decodeSubs(new TextEncoder().encode('字幕 ok')), '字幕 ok');
  const gbk = b(0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7);
  assert.equal(decodeSubs(gbk, 'zh'), '你好世界');
  assert.equal(decodeSubs(gbk, 'en'), '你好世界');
  assert.equal(decodeSubs(b(0xa7, 0x41, 0xa6, 0x6e), 'zh', ['zh-TW']), '你好', 'Big5 first in Traditional Chinese');
  assert.equal(decodeSubs(b(0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd), 'ja'), 'こんにちは');
  assert.equal(decodeSubs(b(0xbe, 0xc8, 0xb3, 0xe7), 'ko'), '안녕');
  // 哪种编码都解不了时按 UTF-8 宽松解码、不报错（浏览器的 Big5 遇到 0xFF 报错；Node 的 Big5 把它解成私用区字符，这里只核对不报错）。
  assert.match(decodeSubs(b(0x41, 0xff), 'zh'), /^A.$/u);
  assert.deepEqual(encodings('ja'), ['utf-8', 'shift_jis', 'gb18030', 'big5', 'euc-kr']);
  assert.deepEqual(encodings('ko'), ['utf-8', 'euc-kr', 'gb18030', 'big5', 'shift_jis']);
  assert.deepEqual(encodings('zh', ['zh-HK']), ['utf-8', 'big5', 'gb18030', 'shift_jis', 'euc-kr']);
  assert.deepEqual(encodings('en'), ['utf-8', 'gb18030', 'big5', 'shift_jis', 'euc-kr']);
});
test('字幕配对：文件名以媒体主文件名接 "." 开头（不分大小写），最长的主文件名优先，图片不配；默认完全同名的优先', () => {
  assert.ok(isSub('a.SRT') && isSub('x.vtt') && isSub('x.ass') && isSub('x.ssa') && isSub('x.lrc'));
  assert.ok(!isSub('x.txt') && !isSub(null) && !isContent('a.srt'));
  const map = pairSubs(
    ['Ep1.mp4', 'ep1.part2.mp4', 'Song.flac', 'Song.wav', 'pic.png', 'clip.webm'],
    [
      'ep1.zh.srt',
      'EP1.srt',
      'ep1.part2.srt',
      'song.lrc',
      'pic.srt',
      'other.srt',
      'clipx.srt',
      'clip.chs.ass',
      'clip.srt',
    ],
  );
  assert.deepEqual([...map].sort(), [
    ['Ep1.mp4', ['EP1.srt', 'ep1.zh.srt']],
    ['Song.flac', ['song.lrc']],
    ['Song.wav', ['song.lrc']],
    ['clip.webm', ['clip.chs.ass', 'clip.srt']],
    ['ep1.part2.mp4', ['ep1.part2.srt']],
  ]);
  assert.equal(defaultSub('clip.webm', ['clip.chs.ass', 'clip.srt']), 'clip.srt');
  assert.equal(defaultSub('clip.webm', ['clip.zh.srt', 'clip.chs.ass']), 'clip.chs.ass');
  assert.equal(defaultSub('clip.webm', []), null);
});

const file = (name, body = 'x', mtime = 5) => ({
  kind: 'file',
  name,
  getFile: async () => new File([body], name, { lastModified: mtime }),
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
test('字幕随扫描、刷新记下文件名（不算页、不计数、不读文件），按文件名经源文件夹读取；刷新时的增删报告给调用方', async () => {
  const odd = skipped(),
    root = dir('Root', [
      file('a.mp4'),
      file('a.srt', 'AAA'),
      file('a.zh.ass'),
      file('b.png'),
      file('b.srt'),
      file('x.avi'),
    ]);
  const [g] = await Array.fromAsync(scan(root, '', odd));
  assert.deepEqual(
    g.pages.map((p) => [p.name, p.subs ?? null]),
    [
      ['a.mp4', [{ file: 'a.srt' }, { file: 'a.zh.ass' }]],
      ['b.png', null],
    ],
  );
  assert.deepEqual([odd.n, [...odd.exts]], [1, ['avi']], 'Subtitles are not reported as skipped');
  const names = await listDir(root);
  assert.deepEqual(names, ['a.mp4', 'b.png']);
  assert.deepEqual(names.subs, ['a.srt', 'a.zh.ass', 'b.srt']);
  const s = { key: '', title: 'Root', dir: root },
    book = { id: 'x', sources: [s], pages: g.pages };
  assert.deepEqual(subsOf(book.pages[0]), ['a.srt', 'a.zh.ass']);
  assert.equal(await (await subFile(book, book.pages[0], 'a.srt')).text(), 'AAA');
  await assert.rejects(subFile(book, book.pages[0], 'nope.srt'), { name: 'NotFoundError' });
  // 刷新：a.zh.ass 删掉、新增 a.en.srt 和 c.mp3 + c.lrc；只有字幕变化时页表不变，subs 为 true。
  let d = applyNames(book, s, Object.assign(['a.mp4', 'b.png'], { subs: ['a.srt', 'a.en.srt'] }));
  assert.deepEqual(d, { added: 0, removed: 0, subs: true });
  assert.deepEqual(subsOf(book.pages[0]), ['a.en.srt', 'a.srt']);
  d = applyNames(book, s, Object.assign(['a.mp4', 'b.png'], { subs: ['a.srt', 'a.en.srt'] }));
  assert.equal(d.subs, false, 'Unchanged');
  d = applyNames(book, s, Object.assign(['a.mp4', 'b.png', 'c.mp3'], { subs: ['c.lrc'] }));
  assert.deepEqual(d, { added: 1, removed: 0, subs: true });
  assert.deepEqual(
    book.pages.map((p) => [p.name, subsOf(p)]),
    [
      ['a.mp4', []],
      ['b.png', []],
      ['c.mp3', ['c.lrc']],
    ],
  );
  assert.equal('subs' in book.pages[0], false, 'No empty list left on the record');
  applyNames(book, s, ['a.mp4', 'b.png', 'c.mp3']);
  assert.deepEqual(subsOf(book.pages[2]), ['c.lrc'], 'Without a listing of subtitles the pairing is untouched');
  pairFrom(book, s, [{ name: 'a.mp4', subs: [{ file: 'a.srt' }] }, { name: 'c.mp3' }]);
  assert.deepEqual(
    book.pages.map((p) => subsOf(p)),
    [['a.srt'], [], []],
    'Relinking a folder takes the pairing from the scan',
  );
});
test('散图：与同一批（或同一目录）的媒体配对并记下句柄；没配上的之后按主文件名并入图集里已有的媒体；接回时字幕句柄一并接回', async () => {
  const srt = file('x.srt', 'X');
  const [lp] = await Array.fromAsync(handleGroups([file('x.mp3'), srt, file('y.mp3'), file('z.vtt')]));
  assert.deepEqual(
    lp.pages.map((p) => [p.name, subsOf(p)]),
    [
      ['x.mp3', ['x.srt']],
      ['y.mp3', []],
    ],
  );
  assert.equal(lp.pages[0].subs[0].handle, srt);
  assert.deepEqual(
    lp.subs.map((e) => e.file),
    ['z.vtt'],
    'Unpaired ones are carried along',
  );
  assert.equal(await (await subFile({ sources: [] }, lp.pages[0], 'x.srt')).text(), 'X');
  const only = await Array.fromAsync(handleGroups([file('q.srt')]));
  assert.deepEqual(
    only.map((g) => [g.pages.length, g.subs.map((e) => e.file)]),
    [[0, ['q.srt']]],
    'Subtitles alone still form a group (for the atlas)',
  );
  const [li] = await looseImages([
    dir('Box', [file('m.webm'), file('m.srt'), file('n.lrc'), dir('Sub', [file('n.mp3'), file('m.zh.srt')])]),
    file('top.mp3'),
    file('top.ass'),
  ]);
  assert.deepEqual(
    li.pages.map((p) => [p.name, subsOf(p)]).sort(),
    [
      ['Box/Sub/n.mp3', []],
      ['Box/m.webm', ['m.srt']],
      ['top.mp3', ['top.ass']],
    ],
    'A subtitle pairs only within its own folder',
  );
  assert.deepEqual(
    li.subs.map((e) => [e.file, e.path]),
    [
      ['m.zh.srt', 'Box/Sub'],
      ['n.lrc', 'Box'],
    ],
  );
  // 图集：加入这批；之后单独加入的字幕按主文件名（同一相对目录优先）配上已有的媒体。
  const atlas = { id: 'L', sources: [], pages: [] };
  await addLoose(atlas, li.pages, li.subs);
  assert.deepEqual(subsOf(atlas.pages.find((p) => p.name === 'Box/Sub/n.mp3')), [], 'n.lrc is in another folder');
  const n = addLooseSubs(atlas, [
    { file: 'n.srt', handle: file('n.srt') },
    { file: 'top.zh.ass', handle: file('top.zh.ass'), path: 'Elsewhere' },
    { file: 'none.srt', handle: file('none.srt') },
  ]);
  assert.equal(n, 2);
  assert.deepEqual(subsOf(atlas.pages.find((p) => p.name === 'Box/Sub/n.mp3')), ['n.srt']);
  assert.deepEqual(subsOf(atlas.pages.find((p) => p.name === 'top.mp3')), ['top.ass', 'top.zh.ass']);
  // 同一个文件再次拖入（句柄相同）：不新增页，字幕并到已有的那页。
  const again = {
    name: 'top.mp3',
    handle: li.pages.find((p) => p.name === 'top.mp3').handle,
    subs: [{ file: 'top.en.srt', handle: file('top.en.srt') }],
  };
  await addLoose(atlas, [again]);
  assert.equal(atlas.pages.length, 3);
  assert.deepEqual(subsOf(atlas.pages.find((p) => p.name === 'top.mp3')), ['top.ass', 'top.en.srt', 'top.zh.ass']);
  // 备份：只留文件名；恢复（定位原文件）后句柄接回。
  const saved = JSON.parse(
    JSON.stringify(strip(atlas), (k, v) => (v && typeof v === 'object' && v.kind === 'file' ? undefined : v)),
  );
  const top = saved.pages.find((p) => p.name === 'top.mp3');
  assert.deepEqual(top.subs, [{ file: 'top.ass' }, { file: 'top.en.srt' }, { file: 'top.zh.ass' }]);
  await assert.rejects(subFile(saved, top, 'top.ass'), { name: 'NotFoundError' });
  const [found] = await looseImages([file('top.mp3'), file('top.ass', 'BACK')]);
  assert.equal(reconnect(saved, found), 1);
  assert.equal(await (await subFile(saved, top, 'top.ass')).text(), 'BACK');
});
test('文件选择器回退：字幕只在本次会话持有 File，不写进记录', async () => {
  const f = (name, body = 'x') => new File([body], name, { lastModified: 1 });
  const [g] = fileGroups([f('v.mp4'), f('v.srt', 'S'), f('w.ass')]);
  assert.deepEqual(
    g.pages.map((p) => [p.name, subsOf(p), p.subs ?? null]),
    [['v.mp4', ['v.srt'], null]],
  );
  assert.equal(await (await subFile({ sources: [] }, g.pages[0], 'v.srt')).text(), 'S');
});
