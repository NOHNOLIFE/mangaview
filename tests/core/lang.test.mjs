import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detect, translate } from '../../src/core/lang.mjs';

test('语言按偏好顺序匹配地区变体，否则显示英文', () => {
  for (const [list, want] of [
    [['fr-CA', 'zh-Hant-TW', 'en'], 'zh'],
    [['ko-KR'], 'ko'],
    [['ja-JP'], 'ja'],
    [['en-US', 'zh'], 'en'],
    [['fr', 'de'], 'en'],
    [[], 'en'],
  ])
    assert.equal(detect(list), want);
});
test('所有静态界面标签均有四种离线翻译', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-(?:t|label|aria|placeholder)="([^"]+)"/g))
    for (const lang of ['en', 'zh', 'ja', 'ko']) assert.ok(translate(key, lang));
});
