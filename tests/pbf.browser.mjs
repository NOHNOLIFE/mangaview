// PotPlayer 书签（.pbf）导入的端到端测试（docs/requirements-media.zh-CN.md 第 11 节）。
// 独立临时配置 + OPFS 测试数据；视频、音频由 tests/media-fixtures.mjs 现场生成，.pbf 在测试页里按格式现场构造（UTF-16LE 带 BOM），不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/pbf.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-pbf-'));
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
// 自动播放由应用自己的规则（有过用户操作才自动播放）判断，这里关掉浏览器的出声拦截，结果才确定。
const chrome = spawn(
  binary,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--disable-background-networking',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=800,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let ws,
  id = 0;
const pending = new Map(),
  errors = [];
async function wait(check, what = '') {
  let last;
  for (let i = 0; i < 160; i++) {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await delay(60);
  }
  throw Error('Timed out: ' + what + ' ' + check + '; last: ' + last);
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
  const key = async (key, code, vk, opts = {}) => {
    const text = key.length === 1 ? key : undefined;
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text, ...opts });
    if (!opts.hold) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  };
  const up = (key, code, vk) => cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  const click = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x, y });
  };
  const center = async (sel) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
  const tap = async (sel) => {
    const [x, y] = await center(sel);
    await click(x, y);
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  // 记下读取了哪些 .pbf 的内容（arrayBuffer）和元数据（getFile）：验证只在大小或修改时间变化时才读内容。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});
    window.pbfReads=[];window.pbfStats=[];const ab=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(/\\.pbf$/i.test(this.name||''))pbfReads.push(this.name);return ab.call(this);};
    const gf=FileSystemFileHandle.prototype.getFile;FileSystemFileHandle.prototype.getFile=function(){if(/\\.pbf$/i.test(this.name))pbfStats.push(this.name);return gf.call(this);};`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    // .pbf：UTF-16LE 带 BOM，[Bookmark] 小节，每行「序号=毫秒*名称*图片十六进制」，末尾一条空行。
    window.pbf=list=>{const s='[Bookmark]\\r\\n'+list.map(([ms,name,img],i)=>i+'='+ms+'*'+name+'*'+(img??'')).join('\\r\\n')+'\\r\\n'+list.length+'=\\r\\n';
      const b=new Uint8Array(2+s.length*2);b[0]=0xFF;b[1]=0xFE;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);b[2+i*2]=c&255;b[3+i*2]=c>>8;}return new Blob([b]);};
    window.folder=()=>navigator.storage.getDirectory().then(r=>r.getDirectoryHandle('Pbf',{create:true}));`;
  await js(helpers);
  const record = () =>
    js(`import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.title==='Pbf'))`);
  const thumbKeys = () => js(`import('./src/core/store.mjs').then(({thumbs})=>thumbs('getAllKeys'))`);
  const marks = async () =>
    (await record()).bookmarks.map((b) => [b.name, b.t, b.label ?? null, b.pbfName ?? null, b.from ?? null]);
  const HEX = '89504E470D0A1A0A0000000D4948445200000010'.repeat(8);

  // 一本书：视频配 X.pbf，音频配 X.wav.pbf，另有一个没有媒体的 .pbf 和一张图。
  await js(`(async()=>{const dir=await folder();
    await mvMedia.write(dir,'01 clip.webm',await mvMedia.webm({seconds:2.5,width:320,height:180}));
    await mvMedia.write(dir,'01 clip.pbf',pbf([[500,'Intro','${HEX}'],[1500,'Mid * part']]));
    await mvMedia.write(dir,'02 song.wav',mvMedia.wav({seconds:10}));
    await mvMedia.write(dir,'02 song.wav.pbf',pbf([[2000,'Verse','${HEX}'],[6000,'']]));
    await mvMedia.write(dir,'03.svg',new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>'],{type:'image/svg+xml'}));
    await mvMedia.write(dir,'lonely.pbf',pbf([[1000,'Nobody']]));
    localStorage.setItem('mv2:autoplay','false');
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Pbf'`), 'book opened');
  await js('reader.focus()');

  // ---- 11.1 / 11.2 / 11.3：导入后在后台读取配对的 .pbf，书签进入普通书签列表，带名称、来源为 .pbf；.pbf 本身不是页。
  const notes = [];
  await js(
    `window.notes=[];new MutationObserver(()=>notes.push(notice.textContent)).observe(notice,{childList:true,characterData:true,subtree:true})`,
  ).catch(() => {});
  await wait(async () => (await record())?.bookmarks?.length === 4, 'imported').catch(async (e) => {
    throw Error(
      e.message +
        ' / ' +
        JSON.stringify({
          rec: await record(),
          errors,
          reads: await js('pbfReads'),
          stats: await js('pbfStats'),
          notes: await js('notes'),
          log: await js('typeof mvLog==="undefined"?null:mvLog'),
        }),
    );
  });
  assert.ok(
    (await js('notes')).includes('Added 4 bookmarks from PotPlayer') ||
      (await js(`notice.textContent==='Added 4 bookmarks from PotPlayer'`)),
    'import notice',
  );
  // 名称为「<文件名>-<pbf 里的名称>」（文件名不含扩展名），没有名称的按应用内规则编号；原名另存为 pbfName。
  assert.deepEqual(await marks(), [
    ['01 clip.webm', 0.5, '01 clip-Intro', 'Intro', 'pbf'],
    ['01 clip.webm', 1.5, '01 clip-Mid * part', 'Mid * part', 'pbf'],
    ['02 song.wav', 2, '02 song-Verse', 'Verse', 'pbf'],
    ['02 song.wav', 6, '02 song-Bookmark1', '', 'pbf'],
  ]);
  let rec = await record();
  assert.deepEqual(
    rec.pages.map((p) => p.name).sort(),
    ['01 clip.webm', '02 song.wav', '03.svg'],
    '.pbf files are not pages',
  );
  assert.deepEqual(
    rec.pages
      .map((p) => [
        p.name,
        p.pbf?.file ?? null,
        Number.isFinite(p.pbf?.size) && Number.isFinite(p.pbf?.mtime),
        p.pbf?.done ?? null,
      ])
      .sort(),
    [
      ['01 clip.webm', '01 clip.pbf', true, [500, 1500]],
      ['02 song.wav', '02 song.wav.pbf', true, [2000, 6000]],
      ['03.svg', null, false, null],
    ],
  );
  assert.deepEqual(
    await js('pbfReads.slice().sort()'),
    ['01 clip.pbf', '02 song.wav.pbf'],
    'Each paired .pbf read once; an unpaired one never',
  );
  assert.equal((await js(`document.querySelectorAll('.page').length`)) > 0, true);
  assert.ok(!(await thumbKeys()).some((k) => k.includes(':bm:pbf-')), 'No screenshots at import');

  // ---- 11.5：书签列表里可见时才懒生成视频书签的缩略图；音频书签是占位（图标）；名称叠在缩略图下沿，也在提示和说明里。
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'right', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 300, button: 'right', clickCount: 1 });
  await wait(() => js(`!document.querySelector('.bm-panel').hidden`), 'panel');
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.bm-panel .bm-item')].map(e=>[e.getAttribute('aria-label'),e.title,e.querySelector('.bm-name')?.textContent??null,!!e.querySelector('.bm-ph.audio')])`,
    ),
    [
      ['Page 1 · 0:00 · 01 clip-Intro', '01 clip-Intro', '01 clip-Intro', false],
      ['Page 1 · 0:01 · 01 clip-Mid * part', '01 clip-Mid * part', '01 clip-Mid * part', false],
      ['Page 2 · 0:02 · 02 song-Verse', '02 song-Verse', '02 song-Verse', true],
      ['Page 2 · 0:06 · 02 song-Bookmark1', '02 song-Bookmark1', '02 song-Bookmark1', true],
    ],
  );
  const ids = (await record()).bookmarks.map((b) => b.id),
    bmKey = (k) => rec.id + ':bm:' + k;
  await wait(async () => {
    const ks = await thumbKeys();
    return ks.includes(bmKey(ids[0])) && ks.includes(bmKey(ids[1]));
  }, 'video bookmark thumbnails generated once visible');
  assert.ok(
    !(await thumbKeys()).some((k) => k === bmKey(ids[2]) || k === bmKey(ids[3])),
    'Audio bookmarks keep the placeholder',
  );
  await wait(
    () =>
      js(
        `[...document.querySelectorAll('.bm-panel .bm-item')].slice(0,2).every(e=>{const i=e.querySelector('.bm-thumb img');return i&&!i.hidden&&i.src.startsWith('blob:');})`,
      ),
    'thumbnails shown',
  );
  await shot('pbf-panel');
  // 在应用内删除一个来自 .pbf 的书签。
  await js(
    `document.querySelector('.bm-panel .bm-item[aria-label="Page 1 · 0:01 · 01 clip-Mid * part"] .bm-del').click()`,
  );
  await wait(async () => (await record()).bookmarks.length === 3, 'deleted in the app');
  // 手动改名（铅笔按钮，就地编辑）：之后 .pbf 里改名也不覆盖它。
  await js(`document.querySelector('.bm-panel .bm-item[aria-label="Page 2 · 0:02 · 02 song-Verse"] .bm-ren').click()`);
  await wait(
    () => js(`document.activeElement?.classList.contains('bm-edit')&&document.activeElement.value==='02 song-Verse'`),
    'editor',
  );
  await cdp('Input.insertText', { text: 'My verse' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait(async () => (await record()).bookmarks.some((b) => b.label === 'My verse' && b.named), 'renamed');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  // 进度条上的标记带名称。
  await js(`toPage('02 song.wav')`);
  await wait(
    () =>
      js(
        `[...node('02 song.wav').querySelectorAll('.mv-marks .mv-mk')].map(b=>b.title).join('|')==='0:02 · My verse|0:06 · 02 song-Bookmark1'`,
      ),
    'markers with names',
  );

  // ---- 11.3 / 11.4：PotPlayer 里改了名称、加了条目、删了条目；随切回窗口的检查（现有时机）合并：只增不删、1 秒内去重、名称更新、应用内删过的不加回。
  await js(`(async()=>{const dir=await folder();
    await mvMedia.write(dir,'01 clip.pbf',pbf([[500,'Opening'],[1500,'Mid * part'],[2200,'Late']]));
    await mvMedia.write(dir,'02 song.wav.pbf',pbf([[2000,'Verse 2'],[2400,'Near verse']]));})()`);
  await delay(1600);
  await js(`dispatchEvent(new Event('focus'))`); // 切回窗口的检查有 1.5 秒的间隔
  await wait(async () => (await record()).bookmarks.length === 4, 'merged after the folder check').catch(async (e) => {
    throw Error(
      e.message +
        ' / ' +
        JSON.stringify({
          rec: await record(),
          errors,
          reads: await js('pbfReads'),
          stats: await js('pbfStats'),
          notes: await js('notes'),
        }),
    );
  });
  assert.deepEqual(await marks(), [
    ['01 clip.webm', 0.5, '01 clip-Opening', 'Opening', 'pbf'],
    ['01 clip.webm', 2.2, '01 clip-Late', 'Late', 'pbf'],
    ['02 song.wav', 2, 'My verse', 'Verse 2', 'pbf'],
    ['02 song.wav', 6, '02 song-Bookmark1', '', 'pbf'],
  ]);
  assert.equal(await js('pbfReads.length'), 4, 'Changed files are read again');
  // 没有变化：只取大小和修改时间，不读内容。
  const stats = await js('pbfStats.length');
  await delay(1600);
  await js(`dispatchEvent(new Event('focus'))`);
  await wait(async () => (await js('pbfStats.length')) > stats, 'checked again');
  await delay(300);
  assert.equal(await js('pbfReads.length'), 4, 'Unchanged .pbf files are not read');

  // ---- 重新载入：书签与已处理过的条目都在，不重复导入、不读内容。
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Pbf'`), 'reloaded');
  await js(helpers);
  await wait(async () => (await js('pbfStats.length')) >= 2, 'startup check of the current book');
  await delay(500);
  assert.deepEqual(await js('pbfReads'), []);
  assert.equal((await record()).bookmarks.length, 4);
  await js(`(async()=>{const dir=await folder();await dir.removeEntry('01 clip.pbf');})()`);
  await js(`dispatchEvent(new Event('focus'))`);
  await delay(1000);
  assert.equal((await record()).bookmarks.length, 4, 'Removing the .pbf keeps its bookmarks');

  assert.deepEqual(errors, []);
  console.log(
    'PASS: .pbf pairing (X.pbf, X.wav.pbf, unpaired ignored, not pages), UTF-16LE parsing with names containing *, import into the bookmark list with names, lazy video thumbnails and audio placeholders, merge on the existing folder check (add only, 1 s duplicates, <file>-<name> names follow renames unless renamed in the app, deleted ones stay deleted), size/mtime check without re-reading',
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
