import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';

test('页面标题与离线缓存使用同一版本号',async()=>{
  const html=await readFile(new URL('../../index.html',import.meta.url),'utf8'),sw=await readFile(new URL('../../sw.js',import.meta.url),'utf8');
  const version=html.match(/<title>MangaView v([\d.]+)<\/title>/)?.[1];
  assert.ok(version);assert.equal(sw.match(/cacheName\s*=\s*prefix\s*\+\s*'([^']+)'/)?.[1],version);
});
test('离线缓存的 shell 列表一项一行、按字母序，正好是根目录的壳文件加 src/ 下全部 .mjs / .css',async()=>{
  const root=new URL('../../',import.meta.url),sw=await readFile(new URL('sw.js',root),'utf8');
  const items=sw.match(/const shell=\[([^\]]*)\]/)[1].split(/\r?\n/).filter(line=>line.trim());
  const list=items.map(line=>line.match(/^  '([^']+)',$/)?.[1]);
  assert.ok(list.every(Boolean),'每项独占一行：'+items.join(' | '));
  assert.deepEqual(list,[...list].sort(),'按字母序');
  const src=(await readdir(new URL('src/',root),{recursive:true})).map(p=>'src/'+p.replaceAll('\\','/')).filter(p=>/\.(?:mjs|css)$/.test(p));
  const icons=(await readdir(new URL('icons/',root))).map(p=>'icons/'+p);
  assert.deepEqual(list,['app.webmanifest','index.html',...icons,...src].sort(),'新增、移动或删除源文件后同步 sw.js 的 shell 列表');
});
