// 冒烟测试（也是 tests/harness.mjs 的最小用法示例）：应用能启动、首页显示空状态、标题与离线缓存同一版本号、
// 测试素材（mvMedia）与 ctx 钩子（mvCtx）可用、页面没有抛出异常。几秒跑完，改动后先跑它。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserTest } from './harness.mjs';

await browserTest({ name: 'smoke', media: true }, async ({ js, wait }) => {
  await wait(() => js('document.querySelector("#empty")?.hidden===false'), 'the empty state');
  const version = (await readFile(new URL('../sw.js', import.meta.url), 'utf8')).match(/prefix \+ '([^']+)'/)[1];
  assert.equal(await js('document.title'), 'MangaView v' + version, 'Title and cache share one version');
  await wait(() => js('!!window.mvCtx'), 'the ctx hook');
  assert.deepEqual(
    await js(`[typeof mvMedia.wav, mvMedia.wav({seconds:0.1}).type, typeof mvCtx.media.queue.items]`),
    ['function', 'audio/wav', 'function'],
    'Fixtures and ctx are available',
  );
  return 'the app starts on the empty state with the version in the title; media fixtures and the ctx hook work';
});
