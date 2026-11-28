// 书签的显示与命名的端到端测试：独立临时配置 + OPFS 里现场生成的测试图和媒体，不读取用户的书库或浏览器配置。
// 设置封面不重叠、区段的起点 / 终点两项与配色、媒体书签的名称（新增、旧书签补名）、就地重命名（面板 / 书架书签栏 / 全屏书签）、音频以书的封面作背景、备份带上新字段。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/marknames.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-marknames-'));
const mime = {
  mjs: 'text/javascript',
  js: 'text/javascript',
  html: 'text/html',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  css: 'text/css',
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!/^(?:[\w-]+\/)*[\w.-]+$/.test(path)) throw Error();
    const data = await readFile(new URL('../' + path, import.meta.url));
    res.writeHead(200, { 'Content-Type': mime[path.split('.').pop()], 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port + '/';
const chrome = spawn(
  binary,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--disable-background-networking',
    '--window-size=800,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let ws,
  id = 0;
const pending = new Map(),
  errors = [];
async function wait(check) {
  let last;
  for (let i = 0; i < 150; i++) {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await delay(50);
  }
  throw Error('Timed out: ' + check + '; last: ' + last);
}
try {
  const port = await wait(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(Error(m.error.message));
      else p.resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    if (!process.env.MV_SHOTS) return;
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.MV_SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  // 缩略图栏常驻（正文让出宽度），书架书签不常驻，不自动播放。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});try{if(!localStorage.getItem('mv2:preview'))localStorage.setItem('mv2:preview','true');if(!localStorage.getItem('mv2:shelfmarks'))localStorage.setItem('mv2:shelfmarks','false');localStorage.setItem('mv2:focusMode','false');localStorage.setItem('mv2:autoplay','false');}catch{}`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  // 12 张 800×1120 的图、一段 10 秒的音频、一段 2.5 秒的视频。
  const svg = (i) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120"><rect width="100%" height="100%" fill="hsl(' +
    i * 47 +
    ',55%,38%)"/><text x="400" y="600" font-size="260" text-anchor="middle" fill="white" font-family="sans-serif">' +
    i +
    '</text></svg>';
  const pics = Array.from({ length: 12 }, (_, i) => [String(i).padStart(2, '0') + '.svg', svg(i)]);
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Names',{create:true});
    for(const [name,body] of ${JSON.stringify(pics)})await mvMedia.write(dir,name,new Blob([body],{type:'image/svg+xml'}));
    await mvMedia.write(dir,'song.wav',mvMedia.wav({seconds:10}));
    await mvMedia.write(dir,'clip.webm',await mvMedia.webm({seconds:2.5,width:320,height:180}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`document.querySelector('#reader [data-name="00.svg"] img')?.naturalHeight===1120`));
  const store = `import('./src/core/store.mjs')`;
  const record = (title = 'Names') =>
    js(`${store}.then(async({library})=>(await library('getAll')).find(b=>b.title===${JSON.stringify(title)}))`);
  // 在页面里改存储中的记录（句柄等不能经 JSON 往返）。
  const patch = (title, fields) =>
    js(
      `${store}.then(async({library})=>{const b=(await library('getAll')).find(b=>b.title===${JSON.stringify(title)});Object.assign(b,${JSON.stringify(fields)});await library('put',b);})`,
    );
  const mouse = (type, x, y, button = 'none') =>
    cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount: button === 'none' ? 0 : 1 });
  const click = async (x, y) => {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 'left');
    await mouse('mouseReleased', x, y, 'left');
  };
  const box = (sel) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};})()`,
    );
  const codes = {
    F2: ['F2', 113],
    Enter: ['Enter', 13, '\r'],
    Escape: ['Escape', 27],
    Backspace: ['Backspace', 8],
    ArrowRight: ['ArrowRight', 39],
    ArrowLeft: ['ArrowLeft', 37],
    c: ['KeyC', 67, 'c'],
    f: ['KeyF', 70, 'f'],
  };
  const tap = async (name) => {
    const [code, vk, text] = codes[name];
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: name,
      code,
      windowsVirtualKeyCode: vk,
      ...(text && { text }),
    });
    await delay(30);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk });
  };
  const type = (text) => cdp('Input.insertText', { text });
  const reload = async () => {
    await cdp('Page.reload');
    await wait(() => js(`bookTitle.textContent==='Names'&&!!document.querySelector('#reader .page')`));
    await js(MEDIA_FIXTURES);
  };

  // ==== 1. 写入书签：24 个图片书签（每页两个）、一个图片区段，以及旧格式的媒体书签（没有名称、2.3.0 导入的 .pbf 书签只有原名） ====
  const rec = await record();
  const imgMarks = pics.flatMap(([name], i) => [
    { id: 'i' + i + 'a', name, f: 0.25, at: 1 },
    { id: 'i' + i + 'b', name, f: 0.75, at: 1 },
  ]);
  imgMarks[2].end = { name: '02.svg', f: 0.5, at: 1 }; // 01.svg@.25 → 02.svg@.5
  await patch('Names', {
    bookmarks: [
      ...imgMarks,
      { id: 's5', name: 'song.wav', t: 5, at: 2, end: { name: 'song.wav', t: 8, at: 2 } },
      { id: 's2', name: 'song.wav', t: 2, at: 2 },
      { id: 's3', name: 'song.wav', t: 3, at: 2, label: 'Verse', from: 'pbf' },
      { id: 'c1', name: 'clip.webm', t: 1, at: 2 },
    ],
  });
  // 图片书签的缩略图（正常添加时截取，这里直接按测试图生成）。
  await js(`(async()=>{const {thumbs}=await import('./src/core/store.mjs'),{makeThumb}=await import('./src/reader/thumbs.mjs');
    const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Names');
    for(const m of ${JSON.stringify(imgMarks)}){const th=await makeThumb(await (await dir.getFileHandle(m.name)).getFile(),{width:240});await thumbs('put',{blob:th.blob,w:th.w,h:th.h},${JSON.stringify(rec.id)}+':bm:'+m.id);
      if(m.end){const e=await makeThumb(await (await dir.getFileHandle(m.end.name)).getFile(),{width:240});await thumbs('put',{blob:e.blob,w:e.w,h:e.h},${JSON.stringify(rec.id)}+':bm:'+m.id+':end');}}})()`);
  await reload();
  // 旧的媒体书签读入时补上名称并保存：按书签顺序编号，2.3.0 的 .pbf 书签改为「<文件名>-<原名>」、原名另存。
  const names = async () =>
    Object.fromEntries(
      (await record()).bookmarks
        .filter((m) => Number.isFinite(m.t))
        .map((m) => [m.id, [m.label ?? null, m.pbfName ?? null]]),
    );
  await wait(async () => (await names()).c1[0] !== null);
  assert.deepEqual(await names(), {
    s5: ['song-Bookmark2', null],
    s2: ['song-Bookmark1', null],
    s3: ['song-Verse', 'Verse'],
    c1: ['clip-Bookmark1', null],
  });

  // ==== 2. 设置封面：书签多时缩略图不互相重叠；不再显示「点选一个书签作为封面」 ====
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await js(`barTitle.click()`);
  await wait(() => js('shelf.open'));
  await wait(() => js(`!!document.querySelector('#books .book .actions .more')`));
  await js(
    `document.querySelector('#books .book .actions .more').click();[...cardMenu.querySelectorAll('[role=menuitem]')].find(x=>x.textContent==='Set cover').click()`,
  );
  await wait(() =>
    js(
      `document.querySelector('.cover-pick')?.open&&document.querySelectorAll('.cover-pick .cp-item img[src^="blob:"]').length>=20`,
    ),
  );
  await delay(200);
  await shot('marknames-cover-pick');
  const cells = await js(
    `[...document.querySelectorAll('.cover-pick .cp-item')].map(b=>{const r=b.getBoundingClientRect();return [r.left,r.top,r.width,r.height];})`,
  );
  assert.equal(cells.length, 25, '24 image bookmarks and the video one; the audio ones are not listed');
  const ratio = +(await js(`getComputedStyle(document.querySelector('.cover-pick')).getPropertyValue('--bm-ar')`));
  for (const [i, [l, t, w, h]] of cells.entries()) {
    assert.ok(Math.abs(h - w / ratio) < 1, 'Cell ' + i + ' keeps its shape: ' + [w, h]);
    for (const [l2, t2, w2, h2] of cells.slice(i + 1))
      assert.ok(
        l + w <= l2 + 0.5 || l2 + w2 <= l + 0.5 || t + h <= t2 + 0.5 || t2 + h2 <= t + 0.5,
        'Cells do not overlap',
      );
  }
  assert.equal(await js(`document.querySelector('.cover-pick .cp-hint').hidden`), true, 'No pick hint');
  assert.ok(!(await js(`document.querySelector('.cover-pick').textContent`)).includes('Pick a bookmark'));
  await js(`document.querySelector('.cover-pick').close()`);
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));
  await cdp('Emulation.clearDeviceMetricsOverride');
  await delay(200);

  // ==== 3. 书签面板：区段的起点和终点是前后紧挨、同样大小的两项，区段配色；媒体书签显示名称 ====
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.center=()=>{const c=reader.scrollTop+reader.clientHeight/2;const ps=[...reader.querySelectorAll('.page')].find(p=>p.offsetTop<=c&&p.offsetTop+p.offsetHeight>c);return ps?[ps.dataset.name,+((c-ps.offsetTop)/ps.offsetHeight).toFixed(2)]:null;};`;
  await js(helpers);
  await js('reader.focus()');
  async function menu() {
    await mouse('mouseMoved', 300, 400);
    await mouse('mousePressed', 300, 400, 'right');
    await mouse('mouseReleased', 300, 400, 'right');
    await wait(() => js('!document.querySelector(".bm-panel").hidden'));
    await delay(200);
  }
  const SEC = 'rgb(90, 180, 255)';
  const items = (root = '.bm-panel') =>
    js(
      `[...document.querySelectorAll('${root} .bm-item')].map(e=>[e.dataset.id,'end' in e.dataset,e.getAttribute('aria-label'),e.querySelector(':scope>.bm-thumb>.bm-name')?.textContent??null])`,
    );
  await menu();
  const list1 = await items();
  assert.equal(list1.length, 30, '28 bookmarks and two section bookmarks, one item each');
  assert.equal(await js(`document.querySelector('.bm-head .count').textContent`), '28', 'Section ends are not counted');
  // 按位置排序：区段书签（02.svg 的中间）夹在 02.svg 的两个书签之间，区段内的书签在起点和它之间。
  assert.deepEqual(list1.slice(1, 7), [
    ['i0b', false, 'Page 1', null],
    ['i1a', false, 'Page 2 · Section start', null],
    ['i1b', false, 'Page 2', null],
    ['i2a', false, 'Page 3', null],
    ['i1a', true, 'Section bookmark · Page 3', null],
    ['i2b', false, 'Page 3', null],
  ]);
  assert.deepEqual(list1.slice(25), [
    ['c1', false, 'Page 13 · 0:01 · clip-Bookmark1', 'clip-Bookmark1'],
    ['s2', false, 'Page 14 · 0:02 · song-Bookmark1', 'song-Bookmark1'],
    ['s3', false, 'Page 14 · 0:03 · song-Verse', 'song-Verse'],
    ['s5', false, 'Page 14 · 0:05 · song-Bookmark2 · Section start', 'song-Bookmark2'],
    ['s5', true, 'Section bookmark · Page 14 · 0:08', 'song-Bookmark2'],
  ]);
  const nth = (n, sel = '') => '.bm-panel .bm-item:nth-child(' + n + ')' + sel;
  const [t1, ts, te] = await Promise.all([
    box(nth(1, ' .bm-thumb')),
    box(nth(3, ' .bm-thumb')),
    box(nth(6, ' .bm-thumb')),
  ]);
  assert.ok(
    Math.abs(ts.width - te.width) < 0.5 && Math.abs(ts.height - te.height) < 0.5 && Math.abs(ts.width - t1.width) < 0.5,
    'Start and section bookmark are the same size as other items',
  );
  assert.equal(await js(`getComputedStyle(document.querySelector('${nth(3, ' .bm-mk.start')}')).color`), SEC);
  assert.equal(await js(`getComputedStyle(document.querySelector('${nth(6, ' .bm-mk.end')}')).color`), SEC);
  // 区段的两项平时不描边，只靠互相呼应的标记区分；悬停 / 选中时才一起高亮。
  for (const n of [1, 3, 6])
    assert.equal(
      await js(`getComputedStyle(document.querySelector('${nth(n, ' .bm-thumb')}'),'::after').content`),
      'none',
    );
  const ring = (sel) => js(`getComputedStyle(document.querySelector('${sel}')).boxShadow`);
  // 悬停区段书签：起点一起高亮（区段配色）；夹在中间的书签和其他项不高亮。
  await mouse('mouseMoved', te.x, te.y);
  await wait(
    async () => /rgb\(90, 180, 255\) 0px 0px 0px 2px/.test(await ring(nth(3, ' .bm-thumb'))),
    'start highlighted',
  );
  assert.match(await ring(nth(6, ' .bm-thumb')), /rgb\(90, 180, 255\) 0px 0px 0px 2px/);
  assert.doesNotMatch(await ring(nth(4, ' .bm-thumb')), /0px 0px 0px 2px/);
  assert.doesNotMatch(await ring(nth(8, ' .bm-thumb')), /0px 0px 0px 2px/);
  // 悬停起点：区段书签一起高亮。
  await mouse('mouseMoved', ts.x, ts.y);
  await wait(
    async () => /rgb\(90, 180, 255\) 0px 0px 0px 2px/.test(await ring(nth(6, ' .bm-thumb'))),
    'Hovering the start highlights the end',
  );
  // 名称叠在缩略图下沿，底色接近不透明；类型角标在名称上方。
  await js(`document.querySelector('.bm-panel .bm-grid').scrollTop=1e5`);
  await delay(100);
  const [nt, nn, nb] = await Promise.all([
    box(nth(27, ' .bm-thumb')),
    box(nth(27, ' .bm-name')),
    box(nth(27, ' .bm-type')),
  ]);
  assert.ok(
    Math.abs(nn.bottom - nt.bottom) < 0.5 && Math.abs(nn.left - nt.left) < 0.5 && Math.abs(nn.right - nt.right) < 0.5,
  );
  assert.ok(nb.bottom <= nn.top + 0.5, 'Type badge above the name');
  assert.equal(
    await js(`getComputedStyle(document.querySelector('${nth(27, ' .bm-name')}')).backgroundColor`),
    'rgba(10, 10, 12, 0.88)',
  );
  // 音频书签：书有封面（默认封面取自第一张图）时以封面作背景。
  await wait(() =>
    js(
      `(document.querySelector('${nth(27, ' .bm-ph.audio')}')?.style.getPropertyValue('--cover')||'').includes('blob:')`,
    ),
  );
  assert.ok(await js(`document.querySelector('${nth(27, ' .bm-ph.audio')}').classList.contains('has-cover')`));
  await shot('marknames-panel');
  // 点区段书签那一项：跳到区段书签的位置。
  await js(`document.querySelector('.bm-panel .bm-grid').scrollTop=0`);
  await delay(100);
  const end1 = await box(nth(6, ' .bm-thumb'));
  await click(end1.x, end1.y);
  await wait(() => js('document.querySelector(".bm-panel").hidden'));
  await wait(async () => JSON.stringify(await js('center()')) === JSON.stringify(['02.svg', 0.5]));

  // ==== 4. 就地重命名（书签面板）：F2 / 铅笔按钮，回车确认、Esc 取消，清空恢复默认 ====
  const marksOf = async () =>
    Object.fromEntries((await record()).bookmarks.map((m) => [m.id, [m.label ?? null, !!m.named]]));
  const editor = () =>
    js(
      `(()=>{const i=document.activeElement;return i?.classList.contains('bm-edit')?[i.value,i.placeholder,i.closest('[data-id]').dataset.id]:null;})()`,
    );
  await menu();
  let p = await box(nth(5, ' .bm-thumb'));
  await mouse('mouseMoved', p.x, p.y);
  await delay(100);
  await tap('F2');
  assert.deepEqual(await editor(), ['', 'Page 3', 'i2a'], 'An image bookmark has no default name');
  await type('Cliff');
  await tap('Enter');
  await wait(async () => (await marksOf()).i2a[0] === 'Cliff');
  assert.deepEqual((await marksOf()).i2a, ['Cliff', true]);
  assert.equal(await js('document.querySelector(".bm-panel").hidden'), false, 'The panel stays open');
  await wait(() => js(`document.querySelector('${nth(5, ' .bm-name')}')?.textContent==='Cliff'`));
  assert.equal(await js(`document.querySelector('${nth(5)}').title`), 'Cliff');
  // Esc 取消：名称不变，面板不关闭。
  await js(`document.querySelector('.bm-panel .bm-grid').scrollTop=1e5`);
  await delay(100);
  p = await box(nth(27, ' .bm-thumb'));
  await mouse('mouseMoved', p.x, p.y);
  await wait(() => js(`getComputedStyle(document.querySelector('${nth(27, ' .bm-ren')}')).opacity==='1'`));
  p = await box(nth(27, ' .bm-ren'));
  await click(p.x, p.y);
  assert.deepEqual(await editor(), ['song-Bookmark1', 'song-Bookmark1', 's2']);
  const ed = await box(nth(27, ' .bm-edit')),
    th = await box(nth(27, ' .bm-thumb'));
  assert.ok(Math.abs(ed.bottom - th.bottom) < 0.5 && Math.abs(ed.width - th.width) < 0.5, 'Editor over the name');
  await shot('marknames-edit');
  await type('Zzz');
  await tap('Escape');
  await wait(() => js(`!document.querySelector('.bm-edit')`));
  assert.equal(await js('document.querySelector(".bm-panel").hidden'), false, 'Esc only cancels the edit');
  assert.deepEqual((await marksOf()).s2, ['song-Bookmark1', false]);
  // 手动改名后清空：媒体书签恢复自动名称（编号接着该文件已有的最大序号）。
  await click(p.x, p.y);
  await type('Intro');
  await tap('Enter');
  await wait(async () => (await marksOf()).s2[0] === 'Intro');
  assert.deepEqual((await marksOf()).s2, ['Intro', true]);
  await js(`document.querySelector('.bm-panel .bm-grid').scrollTop=1e5`);
  p = await box(nth(27, ' .bm-thumb'));
  await mouse('mouseMoved', p.x + 1, p.y);
  await tap('F2');
  assert.deepEqual(await editor(), ['Intro', 'song-Bookmark3', 's2']);
  await tap('Backspace');
  await tap('Enter');
  await wait(async () => !(await marksOf()).s2[1]);
  assert.deepEqual((await marksOf()).s2, ['song-Bookmark3', false]);
  // 图片书签清空：恢复无名称，不再显示名称。
  await js(`document.querySelector('.bm-panel .bm-grid').scrollTop=0`);
  await delay(100);
  p = await box(nth(5, ' .bm-thumb'));
  await mouse('mouseMoved', p.x, p.y + 1);
  await tap('F2');
  await tap('Backspace');
  await tap('Enter');
  await wait(async () => (await marksOf()).i2a[0] === null);
  assert.deepEqual((await marksOf()).i2a, [null, false]);
  await wait(() => js(`!document.querySelector('${nth(5, ' .bm-name')}')`));
  await tap('Escape');
  await wait(() => js('document.querySelector(".bm-panel").hidden'));

  // ==== 5. 应用内新增的媒体书签：<文件名>-书签N ====
  await js(`toPage('song.wav')`);
  await wait(() => js(`!!node('song.wav').querySelector('[data-control="bookmark"]')`));
  await js(`node('song.wav').querySelector('[data-control="bookmark"]').click()`);
  await wait(async () => (await record()).bookmarks.length === 29);
  const added = (await record()).bookmarks.find(
    (m) => !['s2', 's3', 's5', 'c1'].includes(m.id) && Number.isFinite(m.t),
  );
  assert.deepEqual([added.name, added.label, added.named ?? false], ['song.wav', 'song-Bookmark4', false]);

  // ==== 6. 书架书签栏：同样两项各占一格，F2 重命名悬停的项 ====
  await js(`document.querySelector('#bar [data-act="shelfmarks"]').click()`);
  await wait(() =>
    js(`!document.getElementById('shelfmarks').hidden&&document.querySelectorAll('#shelfmarks .bm-item').length===31`),
  );
  assert.deepEqual(
    await js(
      `(()=>{const [a,b]=document.querySelectorAll('#shelfmarks .bm-item[data-id="i1a"]');return [b.previousElementSibling.dataset.id,'end' in b.dataset,!!b.querySelector('.bm-mk.end'),b.querySelector('.bm-del').getAttribute('aria-label'),Math.abs(a.offsetWidth-b.offsetWidth)<1&&Math.abs(a.offsetHeight-b.offsetHeight)<1];})()`,
    ),
    ['i2a', true, true, 'Delete section bookmark', true],
    'Start and section bookmark as two items in position order in the shelf bookmarks too',
  );
  await js(`document.querySelector('#shelfmarks .bm-item[data-id="i3a"]').scrollIntoView({block:'center'})`);
  await delay(150);
  p = await box('#shelfmarks .bm-item[data-id="i3a"] .bm-thumb');
  await mouse('mouseMoved', p.x, p.y);
  await delay(100);
  await tap('F2');
  assert.deepEqual(await editor(), ['', 'Page 4', 'i3a']);
  await type('Dock name');
  await tap('Enter');
  await wait(async () => (await marksOf()).i3a[0] === 'Dock name');
  await wait(() =>
    js(`document.querySelector('#shelfmarks .bm-item[data-id="i3a"] .bm-name')?.textContent==='Dock name'`),
  );
  await shot('marknames-dock');
  await js(`document.querySelector('#bar [data-act="shelfmarks"]').click()`);
  await wait(() => js(`document.getElementById('shelfmarks').hidden`));
  await js('reader.focus()');

  // ==== 7. 全屏书架书签：区段书签是单独的一项（键盘可达），选中一项两项一起高亮；回车跳到区段书签；F2 / 铅笔按钮重命名 ====
  const sheetOpen = () =>
    js(
      `document.getElementById('shelfOverview').open&&!document.getElementById('shelfOverview').classList.contains('closing')`,
    );
  await tap('c');
  await wait(sheetOpen);
  await delay(250);
  const ovNodes = () =>
    js(`[...document.querySelectorAll('#shelfOverview .ov-mark')].map(n=>n.dataset.id+('end' in n.dataset?':end':''))`);
  const ids = await ovNodes();
  assert.equal(ids.length, 31);
  assert.deepEqual(ids.slice(2, 7), ['i1a', 'i1b', 'i2a', 'i1a:end', 'i2b']);
  const ovNode = (k) => '#shelfOverview .ov-mark[data-k="' + k + '"]';
  await js(`document.querySelector('${ovNode(2)}').scrollIntoView({block:'center'})`);
  await delay(150);
  p = await box(ovNode(2));
  await mouse('mouseMoved', p.x + 1, p.y + 1);
  await mouse('mouseMoved', p.x, p.y);
  await wait(() => js(`document.querySelector('${ovNode(2)}').classList.contains('sel')`));
  // 选中起点：它的区段书签一起以区段配色高亮。
  for (const k of [2, 5])
    await wait(async () =>
      /rgb\(90, 180, 255\) 0px 0px 0px 3px/.test(
        await js(`getComputedStyle(document.querySelector('${ovNode(k)}')).boxShadow`),
      ),
    );
  assert.ok(await js(`document.querySelector('${ovNode(5)}').classList.contains('mate')`));
  assert.equal(
    await js(`document.querySelector('#shelfOverview .ov-pos').textContent`),
    'Bookmark 3 / 29 · Names',
    'Ends are not counted',
  );
  // 方向键以项为单位：区段书签是单独的一项（位置文字显示它起点的序号）。
  await tap('ArrowRight');
  await wait(() => js(`document.querySelector('${ovNode(3)}').classList.contains('sel')`));
  assert.equal(await js(`document.querySelector('#shelfOverview .ov-pos').textContent`), 'Bookmark 4 / 29 · Names');
  assert.equal(await js(`document.querySelectorAll('#shelfOverview .ov-mark.mate').length`), 0);
  await tap('ArrowRight');
  await tap('ArrowRight');
  await wait(() => js(`document.querySelector('${ovNode(5)}').classList.contains('sel')`));
  assert.ok(await js(`document.querySelector('${ovNode(2)}').classList.contains('mate')`));
  assert.equal(await js(`document.querySelector('#shelfOverview .ov-pos').textContent`), 'Bookmark 3 / 29 · Names');
  await shot('marknames-overview');
  // 回车：跳到区段书签。
  await tap('Enter');
  await wait(async () => !(await js(`document.getElementById('shelfOverview').open`)));
  await wait(async () => JSON.stringify(await js('center()')) === JSON.stringify(['02.svg', 0.5]));
  await js('reader.focus()');
  await tap('c');
  await wait(sheetOpen);
  await delay(250);
  const s5 = (await ovNodes()).indexOf('s5');
  await js(`document.querySelector('${ovNode(s5)}').scrollIntoView({block:'center'})`);
  await delay(150);
  p = await box(ovNode(s5));
  await mouse('mouseMoved', p.x + 1, p.y + 1);
  await mouse('mouseMoved', p.x, p.y);
  await wait(() => js(`document.querySelector('${ovNode(s5)}').classList.contains('sel')`));
  await tap('F2');
  assert.deepEqual(await editor(), ['song-Bookmark2', 'song-Bookmark2', 's5']);
  await type('Chorus');
  await tap('Enter');
  await wait(async () => (await marksOf()).s5[0] === 'Chorus');
  assert.deepEqual((await marksOf()).s5, ['Chorus', true]);
  assert.deepEqual(
    await js(`[...document.querySelectorAll('#shelfOverview .ov-mark[data-id="s5"] .bm-name')].map(n=>n.textContent)`),
    ['Chorus', 'Chorus'],
    'Both items of the section show the new name',
  );
  assert.ok(await sheetOpen(), 'Still open after renaming');
  assert.equal(
    await js(`document.activeElement===document.querySelector('#shelfOverview .ov-scroll')`),
    true,
    'Focus back on the list',
  );
  // 铅笔按钮（选中项上）；Esc 只取消编辑，不关闭全屏界面。
  await wait(() => js(`getComputedStyle(document.querySelector('${ovNode(s5)} .bm-ren')).opacity==='1'`));
  p = await box(ovNode(s5) + ' .bm-ren');
  await click(p.x, p.y);
  assert.deepEqual(
    await editor(),
    ['Chorus', 'song-Bookmark5', 's5'],
    'Cleared: numbered after the highest number again',
  );
  await tap('Escape');
  await wait(() => js(`!document.querySelector('.bm-edit')`));
  await delay(200);
  assert.ok(await sheetOpen(), 'Esc cancels the edit only');
  assert.deepEqual((await marksOf()).s5, ['Chorus', true]);
  await tap('Escape');
  await wait(async () => !(await js(`document.getElementById('shelfOverview').open`)));
  await js('reader.focus()');

  // ==== 8. 音频以书的当前封面作背景：缩略图栏的占位、音频书签；封面换了跟着变；没有封面（纯音频的书）沿用原样式 ====
  await js(`toPage('song.wav')`);
  const stripCover = () =>
    js(
      `(()=>{const t=document.querySelector('#preview .page[data-name="song.wav"] .mv-tile.audio');return t&&t.classList.contains('has-cover')?t.style.getPropertyValue('--cover'):null;})()`,
    );
  await wait(async () => (await stripCover())?.includes('blob:'));
  const before = await stripCover();
  assert.equal(
    await js(`!!document.querySelector('#preview .page[data-name="clip.webm"] .mv-tile.has-cover')`),
    false,
    'Only audio',
  );
  await shot('marknames-strip');
  await js(`barTitle.click()`);
  await wait(() => js('shelf.open'));
  await js(
    `document.querySelector('#books .book .actions .more').click();[...cardMenu.querySelectorAll('[role=menuitem]')].find(x=>x.textContent==='Set cover').click()`,
  );
  await wait(() => js(`document.querySelector('.cover-pick')?.open`));
  await js(`document.querySelector('.cover-pick .cp-item:nth-child(9)').click()`);
  await wait(async () => !!(await record()).customCover);
  await wait(async () => (await stripCover()) !== before && (await stripCover())?.includes('blob:'));
  assert.ok(
    await js(
      `import('./src/reader/thumbs.mjs').then(async({getThumb})=>(await getThumb(${JSON.stringify(rec.id + ':custom')})).url)`,
    ).then(async (u) => (await stripCover()).includes(u)),
    'The custom cover is used',
  );
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));
  // 纯音频的书（文字封面）：没有背景。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Tunes',{create:true});
    await mvMedia.write(dir,'a.wav',mvMedia.wav({seconds:3}));
    window.showDirectoryPicker=async()=>dir;const b=document.createElement('button');b.dataset.act='folder';document.body.append(b);b.click();b.remove();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Tunes'&&!!document.querySelector('#preview .mv-tile.audio')`));
  await wait(async () => !!(await record('Tunes'))?.fp?.text);
  await delay(300);
  assert.equal(await js(`document.querySelector('#preview .mv-tile.audio').classList.contains('has-cover')`), false);

  // ==== 9. 备份：名称相关的字段（label / named / pbfName）随书目导出，替换导入后保留 ====
  await js(`document.querySelector('[data-act="settings"]').click()`);
  await wait(() => js('document.getElementById("settings").open'));
  await js(
    `window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async b=>{window.saved=b;},close:async()=>{window.savedDone=true;}})});settings.querySelector('[data-id=bakExport] button').click()`,
  );
  const data = JSON.parse(await wait(() => js('window.savedDone&&window.saved.text()')));
  const pick = (b) =>
    Object.fromEntries(
      b.bookmarks
        .filter((m) => ['s3', 's5', 'i3a'].includes(m.id))
        .map((m) => [m.id, [m.label, m.named ?? false, m.pbfName ?? null]]),
    );
  const want = { s3: ['song-Verse', false, 'Verse'], s5: ['Chorus', true, null], i3a: ['Dock name', true, null] };
  assert.deepEqual(pick(data.books.find((b) => b.title === 'Names')), want, 'Exported');
  await js(`settings.close()`);
  await js(
    `window.showOpenFilePicker=async()=>[{getFile:async()=>new File([window.saved],'backup.json',{type:'application/json'})}];document.querySelector('[data-act="settings"]').click()`,
  );
  await wait(() => js('document.getElementById("settings").open'));
  await js(`settings.querySelector('[data-id=bakImport] button').click()`);
  await wait(() => js(`document.querySelector('dialog.bak-ask')?.open`));
  await js(`window.before=1;document.querySelector('.bak-ask .bak-actions .danger').click()`);
  await js(`document.querySelector('.bak-ask .bak-actions .danger').click()`);
  await wait(() => js('!window.before&&document.readyState==="complete"'));
  await wait(async () => (await record())?.bookmarks?.length === 29);
  assert.deepEqual(pick(await record()), want, 'Imported');

  assert.deepEqual(errors, []);
  console.log(
    'PASS: cover picker without overlapping cells or hint, start and section bookmark as two items in position order with the section colour and paired highlight, jump to the end, media bookmark names (new, legacy filled in, .pbf 2.3.0), names over thumbnails, in-place rename (panel, shelf bookmarks, full-screen; F2 / pencil, Enter / Esc, clear restores the default), audio covers from the book cover (updates on change, none for text covers), backup keeps the name fields',
  );
} finally {
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }));
    ws.close();
  }
  server.close();
  for (let i = 0; i < 30 && chrome.exitCode === null; i++) await delay(100);
  if (chrome.exitCode === null) chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
