import test from 'node:test';
import assert from 'node:assert/strict';
import { artHue, artLook } from '../../src/media/art.mjs';

// 两个色相在色环上的距离（0–180）。
const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
test('音频占位图的配色：按文件名（路径最后一段）散列出固定色相，同名同色，只差序号的文件也明显不同', () => {
  const h = artHue({ name: 'Disc 1/01 Intro.mp3' });
  assert.ok(Number.isInteger(h) && h >= 0 && h < 360);
  // 同名文件不论在哪个文件夹、是不是散图（散图的页名带区分序号，显示名取 path + file）颜色都相同；大小写、空白不影响。
  assert.equal(artHue({ name: '01 Intro.mp3' }), h);
  assert.equal(artHue({ name: '01 Intro.mp3#2', path: 'Other', file: '01 Intro.mp3' }), h);
  assert.equal(artHue({ name: '01  intro.MP3' }), h);
  // 一张专辑里按序号命名的相邻曲目：色相各不相同，相邻两首在色环上相距较远。
  for (const fmt of [(n) => n + '.mp3', (n) => n + ' c.wav', (n) => 'Track ' + n + ' - Song.flac']) {
    const hues = Array.from({ length: 8 }, (_, i) => artHue({ name: fmt(String(i + 1).padStart(2, '0')) }));
    assert.equal(new Set(hues).size, hues.length, String(hues));
    const near = hues.slice(1).filter((x, i) => gap(x, hues[i]) < 15).length;
    assert.ok(near <= 1, 'Neighbours stand apart: ' + hues);
  }
  // 渐变的另一端与方向也由文件名决定：偏移 ±24–60 度，方向是四个对角之一。
  const looks = Array.from({ length: 40 }, (_, i) => artLook({ name: 'Track ' + i + '.mp3' }));
  for (const { d, a } of looks) {
    assert.ok(Math.abs(d) >= 24 && Math.abs(d) <= 60, String(d));
    assert.ok([45, 135, 225, 315].includes(a));
  }
  assert.ok(new Set(looks.map((l) => l.a)).size === 4 && new Set(looks.map((l) => Math.sign(l.d))).size === 2);
  assert.deepEqual(artLook({ name: 'x/Track 1.mp3' }), looks[1]);
});
