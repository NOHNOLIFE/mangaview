// 媒体书签、区段书签与「只播放书签区段」、播放顺序与循环、播放位置记忆的端到端测试。
// 独立临时配置 + OPFS 测试数据；视频、音频由 tests/media-fixtures.mjs 在测试页里现场生成，不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/mediamarks.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-mediamarks-'));
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
  const wide = () =>
    cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  await wide();
  // 记录每次给媒体元素挂源（探测）的是哪一页：验证「播不了的文件不重复探测」「只有可见的媒体持有源」。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});
    window.srcLog=[];const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    Object.defineProperty(HTMLMediaElement.prototype,'src',{get(){return d.get.call(this);},set(v){window.srcLog.push(this.closest('.page')?.dataset.name);d.set.call(this,v);},configurable:true});`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    // 把某页滚到视窗中央（尺寸读到后会重排，重复到稳定为止）。
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};`;
  await js(helpers);

  const record = () =>
    js(`import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.title==='Media'))`);
  const thumbKeys = () => js(`import('./src/core/store.mjs').then(({thumbs})=>thumbs('getAllKeys'))`);
  const text = () => js(`document.getElementById('notice').textContent`);
  const said = async (msg) => {
    let seen = '';
    await wait(
      async () => (seen = await text()) === msg,
      'notice ' +
        msg +
        ' (saw: ' +
        JSON.stringify({
          get v() {
            return seen;
          },
        }) +
        ')',
    ).catch(async (e) => {
      const st = await js(
        `JSON.stringify({ae:document.activeElement?.className,ring:document.querySelector('.hold')?.textContent})`,
      ).catch((x) => String(x));
      throw Error(e.message + ' / last notice: ' + seen + ' / errors: ' + JSON.stringify(errors) + ' / ' + st);
    });
    await js('notice.textContent=""');
  };
  const codes = {
    f: ['KeyF', 70, 'f'],
    F: ['KeyF', 70, 'F'],
    c: ['KeyC', 67, 'c'],
    Escape: ['Escape', 27, ''],
    Enter: ['Enter', 13, '\r'],
  };
  async function press(name, type, mods = 0) {
    const [code, vk, t] = codes[name];
    await cdp('Input.dispatchKeyEvent', {
      type,
      key: name,
      code,
      windowsVirtualKeyCode: vk,
      modifiers: mods,
      ...(type === 'keyDown' && t ? { text: t } : {}),
    });
  }
  const tapKey = async (name, mods = 0) => {
    await press(name, 'keyDown', mods);
    await delay(40);
    await press(name, 'keyUp', mods);
  };
  const hold = async (sec = false) => {
    const n = sec ? 'F' : 'f',
      m = sec ? 8 : 0;
    await press(n, 'keyDown', m);
    await delay(700);
    await press(n, 'keyUp', m);
  };
  // 添加区段书签先弹出「选择起点」：等它打开后回车确认默认选中的（最近的）起点。
  const confirmStart = async () => {
    await wait(() => js(`!!document.querySelector('.start-pick')?.open`), 'start picker');
    await tapKey('Enter');
  };
  const ctl = (name, id) => `node(${JSON.stringify(name)}).querySelector('[data-control="${id}"]')`;
  const bar = (id) => `document.querySelector('#controlbar [data-id="${id}"]')`; // 总控栏上的按钮
  const ready = (name) => wait(() => js(`el(${JSON.stringify(name)})?.readyState>=1`), 'loaded ' + name);
  const at = (name, s) =>
    js(
      `new Promise(r=>{const e=el(${JSON.stringify(name)});e.addEventListener('seeked',()=>r(true),{once:true});e.currentTime=${s};})`,
    );
  const now = (name) => js(`el(${JSON.stringify(name)}).currentTime`);
  const paused = (name) => js(`el(${JSON.stringify(name)})?.paused??true`);
  const anyPlaying = () => js(`[...reader.querySelectorAll('video,audio')].some(e=>!e.paused)`);
  const centred = (name) =>
    js(
      `(()=>{const n=node(${JSON.stringify(name)});return Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;})()`,
    );
  const storage = (k, v) =>
    js(
      `(()=>{const key='mv2:${k}',v=JSON.stringify(${JSON.stringify(v)});localStorage.setItem(key,v);dispatchEvent(new StorageEvent('storage',{key,newValue:v,storageArea:localStorage}));})()`,
    );
  const playAt = async (name, s) => {
    await toPageReady(name);
    await at(name, s);
    await js(`el(${JSON.stringify(name)}).play()`);
  };
  // 取消选中媒体（中线离开视窗即取消）：之后的「当前文件」是视窗中心所在的页。
  // 取消当前曲目：后台播放的曲目离开视窗不取消，用文件栏的「停止」。
  const deselect = async () => {
    await js(`filebar.querySelector('[data-head="stop"]')?.click()`);
    await js('reader.scrollTop=0');
    await wait(() => js(`!reader.querySelector('.page.media.selected')`), 'nothing selected');
  };
  const toPageReady = async (name) => {
    await js(`toPage(${JSON.stringify(name)})`);
    await ready(name);
  };

  // 一本混排的书：图片、两段视频、两段音频（音频长一些，测试「剩余不足 5 秒清除位置」和区段）。
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Media',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(dir,'01.svg',svg(600,900,'teal'));
    await mvMedia.write(dir,'02 clip.webm',await mvMedia.webm({seconds:2.5,width:320,height:180}));
    await mvMedia.write(dir,'03 long.wav',mvMedia.wav({seconds:20}));
    await mvMedia.write(dir,'04 clip.webm',await mvMedia.webm({seconds:1.5,width:320,height:180}));
    await mvMedia.write(dir,'05.svg',svg(600,900,'purple'));
    await mvMedia.write(dir,'06 tail.wav',mvMedia.wav({seconds:10}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Media'`), 'book opened');
  await js('reader.focus()');
  // 添加书签的步骤里不让自动播放插手（由 media.browser.mjs 覆盖）；跳转书签时再打开。
  await js(`localStorage.setItem('mv2:autoplay','false')`);

  // ---- 总控栏上的播放顺序、循环、只播放书签区段按钮（设置类偏好，持久化，跨窗口同步）；面板上只有与该文件有关的按钮。
  await toPageReady('03 long.wav');
  assert.deepEqual(
    await js(`[...node('03 long.wav').querySelectorAll('[data-control]')].map(b=>b.dataset.control).sort()`),
    ['bookmark', 'pip', 'section'],
  );
  // 没有「播放顺序」按钮；循环是总控栏的三态按钮（见 controlbar.browser.mjs），别的窗口改了即时应用。
  assert.equal(await js(`!${bar('order')}`), true, 'No play order button');
  await storage('loopMode', 'file');
  assert.equal(await js(`${bar('loop')}.dataset.loop`), 'file', 'Synced from another window');
  await storage('loopMode', null);
  assert.equal(await js(`${bar('loop')}.dataset.loop`), 'book');
  // 书里一个区段都没有：开关可以开，提示「本书没有书签区段」。
  await js(`${bar('sections')}.click()`);
  await said('This book has no bookmark sections');
  assert.equal(await js(`${bar('sections')}.getAttribute('aria-pressed')`), 'true');
  assert.equal(await js(`localStorage.getItem('mv2:sectionsOnly')`), 'true');
  await js(`${bar('sections')}.click()`);

  // ---- 播放位置记忆。暂停时记入书目记录（book.mediaPos），重新打开从该处继续；剩余不足 5 秒清除。
  await playAt('03 long.wav', 7);
  await delay(250);
  await js(`el('03 long.wav').pause()`);
  const pos = await wait(
    async () => (await record()).mediaPos?.find((x) => x.id === '03 long.wav')?.t,
    'position saved',
  );
  assert.ok(pos >= 7 && pos < 8, 'Saved on pause: ' + pos);
  // 另放一个没有缩略图的视频书签（测试懒生成），重新载入。
  await js(
    `import('./src/core/store.mjs').then(async({library})=>{const b=(await library('getAll')).find(b=>b.title==='Media');b.bookmarks.push({id:'lazy',name:'04 clip.webm',t:.8,at:1});await library('put',b);})`,
  );
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Media'`), 'reloaded');
  await js(MEDIA_FIXTURES);
  await js(helpers);
  await js('reader.focus()');
  await toPageReady('03 long.wav');
  await wait(async () => Math.abs((await now('03 long.wav')) - pos) < 0.05, 'resumed from the saved position');
  await playAt('03 long.wav', 16.5);
  await delay(150);
  await js(`el('03 long.wav').pause()`);
  await wait(async () => !(await record()).mediaPos?.some((x) => x.id === '03 long.wav'), 'cleared near the end');

  // ---- 长按 F 在当前媒体的当前时间加书签；2 秒内已有书签提示已存在；壳上的按钮同样可加。
  await at('03 long.wav', 5);
  await hold();
  await said('Bookmark added');
  await at('03 long.wav', 6);
  await hold();
  await said('There is already a bookmark here');
  await at('03 long.wav', 12);
  await js(`${ctl('03 long.wav', 'bookmark')}.click()`);
  await said('Bookmark added');
  const mediaMarks = async () =>
    (await record()).bookmarks
      .filter((b) => b.t != null)
      .map((b) => [b.name, +b.t.toFixed(1), ...(b.end ? [+b.end.t.toFixed(1)] : [])]);
  assert.deepEqual(await mediaMarks(), [
    ['03 long.wav', 5],
    ['03 long.wav', 12],
    ['04 clip.webm', 0.8],
  ]);
  assert.ok(
    (await record()).bookmarks.every((b) => b.f === undefined),
    'Media bookmarks store a time, not a position in the page',
  );
  // 进度条上按时间位置画出标记点，悬停提示时间，点击跳到该时间。
  const dots = () =>
    js(
      `[...node('03 long.wav').querySelectorAll('.mv-marks .mv-mk')].map(b=>[b.className.replace('mv-mk ','').replace(' hot',''),Math.round(parseFloat(b.style.left)),b.getAttribute('aria-label')])`,
    );
  // 媒体书签的名称：<文件名>-书签N（文件名不含扩展名）。
  assert.deepEqual(await dots(), [
    ['mark', 25, '0:05 · 03 long-Bookmark1'],
    ['mark', 60, '0:12 · 03 long-Bookmark2'],
  ]);
  await js(`node('03 long.wav').querySelector('.mv-mk').click()`);
  await wait(async () => Math.abs((await now('03 long.wav')) - 5) < 0.05, 'marker click seeks');
  // 视频书签：在播放器里添加时直接截当前画面作缩略图。之前播放过的音频是选中媒体，先取消，长按 F 作用于视窗中心的视频。
  await deselect();
  await toPageReady('02 clip.webm');
  await at('02 clip.webm', 1);
  await hold();
  await said('Bookmark added');
  const rec = await record(),
    vid = rec.bookmarks.find((b) => b.name === '02 clip.webm');
  const th = await wait(
    () =>
      js(
        `import('./src/core/store.mjs').then(({thumbs})=>thumbs('get','${rec.id}:bm:${vid.id}')).then(r=>r&&[r.w,r.h,r.blob.type])`,
      ),
    'video bookmark thumbnail',
  );
  assert.deepEqual(th, [240, 135, 'image/webp']);

  // ---- 区段书签在同一文件内按时间配对；进度条上成对标记，悬停高亮区段。
  await toPageReady('03 long.wav');
  await at('03 long.wav', 9);
  await hold(true);
  await confirmStart();
  await said('Section bookmark added');
  assert.deepEqual(await mediaMarks(), [
    ['02 clip.webm', 1],
    ['03 long.wav', 5, 9],
    ['03 long.wav', 12],
    ['04 clip.webm', 0.8],
  ]);
  assert.deepEqual(
    (await dots()).map((d) => d[0]),
    ['start', 'end', 'mark'],
  );
  const startBox = await js(
    `(()=>{const r=node('03 long.wav').querySelector('.mv-mk.start').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
  );
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startBox[0], y: startBox[1] });
  await wait(
    () =>
      js(
        `node('03 long.wav').querySelector('.mv-span').classList.contains('hot')&&node('03 long.wav').querySelector('.mv-mk.end').classList.contains('hot')`,
      ),
    'hovering the start highlights the section',
  );
  await delay(200);
  await shot('mediamarks-bar');
  await wait(
    async () => (await js(`getComputedStyle(node('03 long.wav').querySelector('.mv-span')).opacity`)) === '1',
    'section shown',
  );
  assert.match(
    await js(`node('03 long.wav').querySelector('.mv-mk.start').getAttribute('aria-label')`),
    /^Section start 0:05 – 0:09/,
  );
  assert.match(
    await js(`document.querySelector('.mv-tip:popover-open')?.textContent`),
    /^Section start 0:05 – 0:09/,
    'The tooltip gives both ends',
  );
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 200 }); // 移开（不靠近四边，免得弹出侧栏）
  await wait(() => js(`!node('03 long.wav').querySelector('.mv-span.hot')`), 'highlight cleared');
  // 延长：在区段之后、下一个普通书签之前添加，延长这个区段。
  await at('03 long.wav', 10);
  await hold(true);
  await confirmStart();
  await said('Section end updated');
  assert.deepEqual(
    (await mediaMarks()).find((m) => m[1] === 5),
    ['03 long.wav', 5, 10],
  );
  // 图片与媒体互不配对：图片页前面只有媒体书签时不添加。
  await js(`toPage('05.svg')`);
  await delay(100);
  await hold(true);
  await said('No bookmark before this point to pair with — add a bookmark first');

  // 书签列表：媒体书签带类型角标和时间点；音频是占位小块；区段只占一格（区段书签是起点左下角的小图）；视频书签的缩略图在列表里可见时才截取。
  assert.ok(!(await thumbKeys()).includes((await record()).id + ':bm:lazy'), 'Not generated before it is shown');
  await js(`reader.scrollTop=0`);
  await delay(100);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'right', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 300, button: 'right', clickCount: 1 });
  await wait(() => js(`!document.querySelector('.bm-panel').hidden`), 'panel');
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.bm-panel .bm-item')].map(e=>[e.getAttribute('aria-label'),e.querySelector('.bm-thumb .bm-type')?.textContent??null,!!e.querySelector('.bm-thumb>.bm-ph.audio'),e.querySelector(':scope>.bm-thumb>.bm-name')?.textContent??null,e.querySelector(':scope>.bm-sub')?.getAttribute('aria-label')??null,!!e.querySelector(':scope>.bm-sub>.bm-ph.audio')])`,
    ),
    [
      ['Page 2 · 0:01 · 02 clip-Bookmark1', '0:01', false, '02 clip-Bookmark1', null, false],
      [
        'Page 3 · 0:05 · 03 long-Bookmark1 · Section start',
        '0:05',
        true,
        '03 long-Bookmark1',
        'Section bookmark · Page 3 · 0:10',
        true,
      ],
      ['Page 3 · 0:12 · 03 long-Bookmark2', '0:12', true, '03 long-Bookmark2', null, false],
      ['Page 4 · 0:00 · 04 clip-Bookmark1', '0:00', false, '04 clip-Bookmark1', null, false],
    ],
  );
  await wait(
    async () => (await thumbKeys()).includes((await record()).id + ':bm:lazy'),
    'lazy thumbnail generated once visible',
  );
  await wait(
    () =>
      js(
        `(()=>{const i=document.querySelector('.bm-panel .bm-item:last-child .bm-thumb img');return !!i&&!i.hidden&&i.src.startsWith('blob:')&&!document.querySelector('.bm-panel .bm-item:last-child .bm-ph');})()`,
      ),
    'lazy thumbnail shown',
  );
  await shot('mediamarks-panel');
  await tapKey('Escape');
  // 全屏书架书签里同样带类型角标（区段同样只占一格，区段书签是左下角的小图）。
  await tapKey('c');
  await wait(() => js(`document.getElementById('shelfOverview').open`), 'full-screen bookmarks');
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('#shelfOverview .ov-mark')].map(e=>e.querySelector('.bm-type').textContent+(e.querySelector(':scope>.bm-sub')?' +sub':''))`,
    ),
    ['0:01', '0:05 +sub', '0:12', '0:00'],
  );
  await tapKey('c');
  await wait(async () => !(await js(`document.getElementById('shelfOverview').open`)), 'closed');

  // ---- 单击 F 跳转书签对媒体生效：滚到该媒体、定位到书签时间并从该处开始后台播放（不取决于自动播放设置）。
  await js(`localStorage.setItem('mv2:autoplay','false');reader.scrollTop=0`);
  await delay(400);
  await tapKey('f');
  await wait(
    async () =>
      (await centred('02 clip.webm')) &&
      Math.abs((await now('02 clip.webm')) - 1) < 0.3 &&
      !(await paused('02 clip.webm')),
    'jumped to the video bookmark and plays',
  );
  await tapKey('f');
  await wait(
    async () =>
      (await centred('03 long.wav')) &&
      Math.abs((await now('03 long.wav')) - 5) < 0.5 &&
      !(await paused('03 long.wav')),
    'next bookmark in the audio',
  );
  await tapKey('f');
  await wait(async () => Math.abs((await now('03 long.wav')) - 12) < 0.5, 'next bookmark in the same audio by time');
  // 暂停之后再跳：同样从书签处播放。
  await js(`el('03 long.wav').pause()`);
  await tapKey('F', 8);
  await wait(async () => Math.abs((await now('03 long.wav')) - 5) < 0.5, 'Shift+F goes back');
  await wait(async () => !(await paused('03 long.wav')), 'plays from the bookmark again');
  await js(`localStorage.setItem('mv2:autoplay','false')`); // 下面显式播放，不让自动播放插手

  // ---- 影音模式的自动滚动（Shift+空格）播完后按页序切换，循环（本书〔默认〕/ 单文件）决定末尾与重复
  // （混合模式由自动滚动往下滚，不在这里切换；后台播放的接续见 background.browser.mjs）。
  await js(`${bar('mode-media')}.click()`);
  const stopAll = () =>
    js(
      `(()=>{const b=${bar('play')};if(b.getAttribute('aria-pressed')==='true')b.click();for(const e of reader.querySelectorAll('video,audio'))e.pause();})()`,
    );
  const nearEnd = async (name) => {
    await key(' ', 'Space', 32, { modifiers: 8 });
    await wait(async () => !(await paused(name)), 'auto-scroll plays ' + name);
    await js(`(()=>{const e=el(${JSON.stringify(name)});e.currentTime=Math.max(0,e.duration-.4);})()`);
  };
  // 按页序播放下一个媒体（图片跳过），滚到视窗中央、从头播放。
  await stopAll();
  await toPageReady('03 long.wav');
  await nearEnd('03 long.wav');
  await wait(
    async () => !(await paused('04 clip.webm')) && (await centred('04 clip.webm')),
    'next media in page order plays centred',
  );
  assert.ok((await now('04 clip.webm')) < 1, 'From the start');
  // 本书循环：最后一个之后回到第一个。
  await stopAll();
  await toPageReady('06 tail.wav');
  await nearEnd('06 tail.wav');
  await wait(
    async () => !(await paused('02 clip.webm')) && (await centred('02 clip.webm')),
    'book loop wraps to the first media',
  );
  // 单文件循环：重复播放当前媒体。
  await stopAll();
  await storage('loopMode', 'file');
  await toPageReady('04 clip.webm');
  await nearEnd('04 clip.webm');
  await wait(async () => !(await paused('04 clip.webm')) && (await now('04 clip.webm')) < 0.8, 'file loop repeats');
  await stopAll();
  await storage('loopMode', null);

  // ---- 只播放书签区段。03 有区段 5–10 和 12–14，06 有区段 2–4，04 没有区段（自动切换时跳过）。
  await deselect(); // 最后选中的媒体不再是当前文件，长按 Shift+F 作用于视窗中心的 03
  await toPageReady('03 long.wav');
  await at('03 long.wav', 14);
  await hold(true);
  await confirmStart();
  await said('Section bookmark added');
  await toPageReady('06 tail.wav');
  await at('06 tail.wav', 2);
  await js(`${ctl('06 tail.wav', 'bookmark')}.click()`);
  await said('Bookmark added');
  await at('06 tail.wav', 4);
  await js(`${ctl('06 tail.wav', 'section')}.click()`);
  await confirmStart();
  await said('Section bookmark added');
  await toPageReady('03 long.wav');
  await js(`${bar('sections')}.click()`);
  assert.equal(await js(`node('03 long.wav').classList.contains('sec-only')`), true);
  assert.deepEqual(
    await js(
      `[...node('03 long.wav').querySelectorAll('.mv-dim')].map(d=>[Math.round(parseFloat(d.style.left)),Math.round(parseFloat(d.style.width))])`,
    ),
    [
      [0, 25],
      [50, 10],
      [70, 30],
    ],
    'Outside the sections is dimmed',
  );
  await at('03 long.wav', 0);
  await key(' ', 'Space', 32, { modifiers: 8 }); // 影音模式的自动滚动从视窗里的 03 开始
  await wait(async () => {
    const t = await now('03 long.wav');
    return t >= 5 && t < 6;
  }, 'starts at the first section');
  await at('03 long.wav', 9.6);
  await wait(async () => {
    const t = await now('03 long.wav');
    return t >= 12 && t < 13;
  }, 'jumps to the next section');
  await at('03 long.wav', 13.6);
  await wait(
    async () => !(await paused('06 tail.wav')) && (await paused('03 long.wav')) && (await paused('04 clip.webm')),
    'after the last section: the next media with sections (04 skipped)',
  );
  const t6 = await now('06 tail.wav');
  assert.ok(t6 >= 2 && t6 < 3.5, 'From its first section: ' + t6);
  // 手动拖到区段之外：不强行跳回。
  await at('06 tail.wav', 5);
  await delay(600);
  assert.ok((await now('06 tail.wav')) > 5.3 && !(await paused('06 tail.wav')), 'Plays on outside the sections');
  await stopAll();
  await shot('mediamarks-only');
  const onColor = await js(`getComputedStyle(${bar('sections')}).color`);
  await js(`${bar('sections')}.click()`);
  await delay(250);
  assert.notEqual(await js(`getComputedStyle(${bar('sections')}).color`), onColor, 'The toggle shows its state');
  assert.equal(await js(`localStorage.getItem('mv2:sectionsOnly')`), 'false');
  await shot('mediamarks');

  // ---- 视频书签的缩略图截不到（文件打不开）时，连同文件的大小和修改时间记入页记录（page.vfail），重新打开后文件没变就不再尝试。
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Broken',{create:true});
    await mvMedia.write(dir,'01.svg',new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>'],{type:'image/svg+xml'}));
    await mvMedia.write(dir,'02 bad.mp4',new Blob([new Uint8Array(4096).fill(7)]));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Broken'`), 'Broken imported');
  const broken = () =>
    js(`import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.title==='Broken'))`);
  await js(
    `import('./src/core/store.mjs').then(async({library})=>{const b=(await library('getAll')).find(b=>b.title==='Broken');b.bookmarks=[{id:'bad',name:'02 bad.mp4',t:.5,at:1}];await library('put',b);})`,
  );
  const grabs = () => js('srcLog.filter(x=>x==null).length'); // 正文以外给视频挂源（截帧）的次数；该视频不在视窗里，正文的播放器不碰它
  const panelOpen = async () => {
    await cdp('Page.reload');
    await wait(() => js(`bookTitle.textContent==='Broken'`), 'reloaded');
    await js(MEDIA_FIXTURES);
    await js(helpers);
    await js('reader.scrollTop=0');
    await delay(200);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'right', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 300, button: 'right', clickCount: 1 });
    await wait(
      () =>
        js(`!document.querySelector('.bm-panel').hidden&&!!document.querySelector('.bm-panel .bm-item .bm-ph.video')`),
      'panel with the video bookmark',
    );
  };
  await panelOpen();
  await wait(
    async () => /^\d+:4096$/.test((await broken()).pages.find((p) => p.name === '02 bad.mp4').vfail ?? ''),
    'bookmark thumbnail failure recorded with size and time',
  );
  assert.ok((await grabs()) >= 1, 'It was tried once');
  await panelOpen();
  await delay(2500);
  assert.equal(await grabs(), 0, 'Not tried again while the file is unchanged');
  assert.ok(await js(`!!document.querySelector('.bm-panel .bm-item .bm-ph.video')`), 'Keeps the placeholder');
  await tapKey('Escape');

  assert.deepEqual(errors, []);
  console.log(
    'PASS: no play order button, loop synced, media mode moves on in page order (book loop wraps, file loop repeats), play position memory, media bookmarks (hold F, shell buttons, 2 s duplicates, time markers on the seek bar, type badges, lazy video thumbnails), media section bookmarks paired by time, F jumps into media, play bookmark sections only, bookmark thumbnail failures recorded with the file size and time',
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
