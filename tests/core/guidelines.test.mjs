// 开发约定（docs/dev-guidelines.zh-CN.md）「7. 代码结构」的文件列表：目录为一级条目，其下每个文件一行、按文件名字母序，
// 正好是 src/ 下的全部文件（多了、少了都失败）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('开发约定第 7 节的文件列表与 src/ 下的文件一致，每个目录下按文件名字母序', async () => {
  const root = new URL('../../', import.meta.url),
    doc = await readFile(new URL('docs/dev-guidelines.zh-CN.md', root), 'utf8');
  const lines = doc.slice(doc.indexOf('## 7.'), doc.indexOf('## 8.')).split(/\r?\n/);
  const listed = [],
    dirs = [];
  let dir = null,
    names = [];
  const flush = () => {
    if (dir) assert.deepEqual(names, [...names].sort(), dir + ' 下按文件名字母序');
  };
  for (const line of lines) {
    const d = line.match(/^ {2}- `(src\/(?:[\w-]+\/)*)`：/);
    if (d) {
      flush();
      dir = d[1];
      dirs.push(dir);
      names = [];
      continue;
    }
    const f = line.match(/^ {4}- `([^`]+)`：/);
    if (f) {
      assert.ok(dir, '文件条目在目录条目之下：' + line);
      names.push(f[1]);
      listed.push(dir + f[1]);
    } else if (/^\S/.test(line) || /^ {2}-/.test(line)) {
      flush();
      dir = null;
    }
  }
  flush();
  assert.deepEqual(dirs, [...dirs].sort(), '目录按字母序');
  const files = (await readdir(new URL('src/', root), { recursive: true }))
    .map((p) => 'src/' + p.replaceAll('\\', '/'))
    .filter((p) => /\.\w+$/.test(p));
  assert.deepEqual(
    [...listed].sort(),
    [...files].sort(),
    '新增、移动或删除 src/ 下的文件后同步开发约定第 7 节的文件列表',
  );
});
