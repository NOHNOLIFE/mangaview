// 后台播放（media/track.mjs、queue.mjs、driver.mjs）：当前曲目离开视窗、切书继续播放，播完按播放列表接续且主窗口不滚动、不跳转，
// 回到视窗时画面无缝回到页里；同一时间只有一个媒体在播放；文件栏的「定位」；移除到没有可接续项时停止；播放列表的模型（跨书的项、追加、过滤、两端跨书、收藏列表）；画面交给外部容器与收回（ctx.media.stage）；
// 播放列表的类型、移除、循环范围（单文件、跨书）；点击媒体不启动自动滚动、空格的智能规则；自动播放的视频离开视窗即暂停并取消。
// 独立临时配置 + OPFS 测试数据；音频、视频由 tests/media-fixtures.mjs 在测试页里现场生成，不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/background.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-background-'));
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

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  // 测试里经 ctx 调用接口：ctx 不暴露到全局，这里在它被赋上 fileBar 时记下（只在测试页里）。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','false');
    Object.defineProperty(Object.prototype,'fileBar',{configurable:true,set(v){Object.defineProperty(this,'fileBar',{value:v,writable:true,configurable:true,enumerable:true});window.mvCtx=this;}});`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  const svg = `const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});`;
  const addBook = (name, files, button) =>
    js(`(async()=>{const root=await navigator.storage.getDirectory(),d=await root.getDirectoryHandle('${name}',{create:true});${svg}
    ${files}
    window.showDirectoryPicker=async()=>d;document.querySelector('${button}').click();
    await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  // Alpha：图、音频、高图、视频、音频、图。Beta：图、音频。Gamma：只有图。
  await addBook(
    'Alpha',
    `await mvMedia.write(d,'01.svg',svg(600,900,'teal'));await mvMedia.write(d,'02 song.wav',mvMedia.wav({seconds:3}));
    await mvMedia.write(d,'03.svg',svg(600,2000,'#345'));await mvMedia.write(d,'04 clip.webm',await mvMedia.webm({seconds:4,width:320,height:180}));
    await mvMedia.write(d,'05 b.wav',mvMedia.wav({seconds:2,freq:660}));await mvMedia.write(d,'06.svg',svg(600,900,'#543'));`,
    '#empty [data-act="folder"]',
  );
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha');
  await addBook(
    'Beta',
    `await mvMedia.write(d,'01.svg',svg(600,900,'#355'));await mvMedia.write(d,'02 tune.wav',mvMedia.wav({seconds:2,freq:550}));`,
    '#bar [data-act="folder"]',
  );
  await wait(() => js(`bookTitle.textContent==='Beta'`), 'Beta');
  await addBook('Gamma', `await mvMedia.write(d,'01.svg',svg(600,900,'#553'));`, '#bar [data-act="folder"]');
  await wait(() => js(`bookTitle.textContent==='Gamma'`), 'Gamma');
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.P=name=>mvCtx.player.list().find(p=>p.page.name===name)??null;
    window.elOf=name=>P(name)?.el??null;
    window.on=()=>[...document.querySelectorAll('video,audio')].filter(m=>!m.paused);
    window.track=()=>mvCtx.media.queue.track()?.page.name??null;
    window.bookOf=t=>[...mvCtx.books.values()].find(b=>b.title===t);
    window.names=()=>mvCtx.media.queue.items().map(x=>x.book.title+':'+x.page.name);
    window.mvClearQueue=()=>{const q=mvCtx.media.queue,tr=q.track();if(tr)q.addBook(tr.book);for(const x of q.items().filter(x=>!x.current))q.remove(x);for(const x of q.items())q.remove(x);};
    window.open=async t=>{const s=await import('./src/reader/session.mjs'),{books}=await import('./src/core/books.mjs');s.select([...books.values()].find(b=>b.title===t));};
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.loads=0;window.watchLoads=name=>{loads=0;elOf(name).addEventListener('loadstart',()=>loads++);};`);
  const B = (id) => `document.querySelector('#controlbar [data-id="${id}"]')`;
  const H = (id) => `document.querySelector('#filebar [data-head="${id}"]')`;
  const running = async () => (await js(`${B('play')}.getAttribute('aria-pressed')`)) === 'true';
  const showBar = async () => {
    await wait(() => js(`!controlbar.classList.contains('leaving')`), 'fade finished');
    if (await js('controlbar.hidden')) await key('t', 'KeyT', 84);
    await wait(() => js(`!controlbar.hidden&&!controlbar.getAnimations().length`), 'control bar shown');
    await js('frame()');
  };
  const fbName = () => js(`filebar.querySelector('.fb-name')?.textContent??''`);
  const click = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x, y });
  };
  const tap = async (sel) => {
    const [x, y] = await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
    await click(x, y);
  };
  const onlyOne = async (what) => assert.ok((await js('on().length')) <= 1, 'Only one media plays: ' + what);

  // ---- 点击音频卡片：后台播放它（成为当前曲目），不启动自动滚动。
  await js(`open('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'back to Alpha');
  await js(`${B('mode-mixed')}.click()`);
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`!!elOf('02 song.wav')&&!elOf('02 song.wav').paused`), 'song plays');
  assert.equal(await running(), false, 'Clicking a media does not start auto-scroll');
  assert.equal(await js('track()'), '02 song.wav');
  assert.deepEqual(
    await js(`mvCtx.media.queue.items().map(x=>x.page.name)`),
    ['02 song.wav', '04 clip.webm', '05 b.wav'],
    'The play list: the media of the book in page order',
  );
  // ---- 滚出视窗（页被正文回收）：继续播放，元素停放在主文档里；文件栏仍显示它。
  await js(`elOf('02 song.wav').dataset.mark='song';watchLoads('02 song.wav')`);
  await js(`reader.scrollTop=reader.scrollHeight`);
  await wait(() => js(`!node('02 song.wav')`), 'song page recycled');
  const t0 = await js(`elOf('02 song.wav').currentTime`);
  await delay(400);
  assert.deepEqual(
    await js(
      `[elOf('02 song.wav').paused,elOf('02 song.wav').currentTime>${t0},elOf('02 song.wav').isConnected,elOf('02 song.wav').parentNode.id,loads]`,
    ),
    [false, true, true, 'mv-park', 0],
    'Scrolled away: keeps playing, parked in the document, not reloaded',
  );
  await showBar();
  await wait(async () => (await fbName()) === '02 song', 'file bar shows the track');
  assert.equal(await js(`${H('locate')}.disabled`), false, 'Locate enabled');
  await onlyOne('song away');
  // ---- 播完按列表接续：下一项（视频）在停放处播放，主窗口不滚动、不跳转。
  const top = await js('reader.scrollTop');
  await wait(() => js(`!!elOf('04 clip.webm')&&!elOf('04 clip.webm').paused`), 'the list goes on with the video');
  assert.equal(await js('reader.scrollTop'), top, 'The main window does not scroll');
  assert.deepEqual(await js(`[track(),elOf('04 clip.webm').parentNode.id,!P('02 song.wav')]`), [
    '04 clip.webm',
    'mv-park',
    true,
  ]);
  await onlyOne('clip parked');
  // ---- 回到视窗：画面无缝回到页里（同一个元素，不重新加载、不中断）。
  await js(`elOf('04 clip.webm').dataset.mark='clip';watchLoads('04 clip.webm')`);
  const c0 = await js(`elOf('04 clip.webm').currentTime`);
  assert.ok(await js(`toPage('04 clip.webm')`));
  assert.deepEqual(
    await js(
      `(()=>{const v=node('04 clip.webm').querySelector('video');return [v?.dataset.mark,v?.paused,v?.currentTime>=${c0},loads,node('04 clip.webm').classList.contains('selected')];})()`,
    ),
    ['clip', false, true, 0, true],
    'Back in view: the same element, still playing, not reloaded',
  );
  await shot('background-back-in-page');
  // ---- 切书：继续播放；「定位」切回原书并把它放到视窗中央。
  await js(`open('Beta')`);
  await wait(() => js(`bookTitle.textContent==='Beta'`), 'Beta opened');
  await delay(300);
  assert.deepEqual(await js(`[on().length,track()!==null]`), [1, true], 'Switching books does not stop the track');
  await showBar();
  await wait(async () => ['04 clip', '05 b'].includes(await fbName()), 'file bar shows the track from the other book');
  await wait(() => js(`track()==='05 b.wav'&&!elOf('05 b.wav').paused`), 'continues with the next item while in Beta');
  assert.equal(await js(`bookTitle.textContent`), 'Beta', 'Continuing does not switch the book');
  await js(`${H('locate')}.click()`);
  await wait(() => js(`bookTitle.textContent==='Alpha'&&!!node('05 b.wav')`), 'locate opens the book');
  await wait(
    () =>
      js(
        `(()=>{const n=node('05 b.wav');return Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;})()`,
      ),
    'locate centres the file',
  );
  assert.equal(await js(`!elOf('05 b.wav').paused`), true, 'Locating does not interrupt');
  // ---- 移除列表的全部项：最后移除当前曲目时没有可接续项，停止播放、取消当前曲目，文件栏回到视窗中心所在的页。
  await js(`mvClearQueue()`);
  await wait(() => js(`on().length===0&&track()===null`), 'stopped');
  assert.deepEqual(
    await js(
      `[mvCtx.media.queue.items().length,!!reader.querySelector('.page.media.selected'),${H('locate')}.disabled]`,
    ),
    [0, false, true],
  );
  await showBar();
  await wait(async () => (await fbName()) === '05 b', 'file bar back to the centre page');

  // ---- 画面交给外部容器（ctx.media.stage，画中画窗口用）：搬动不重新加载、不中断；页内显示占位，点占位收回。
  await js(
    `window.box=document.createElement('div');box.id='testStage';box.style.cssText='position:fixed;right:0;top:0;width:320px;height:200px;z-index:50;background:#222';document.body.append(box)`,
  );
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`!elOf('02 song.wav')?.paused`), 'song plays again');
  await js(`watchLoads('02 song.wav');elOf('02 song.wav').dataset.mark='s2'`);
  await js(`mvCtx.media.stage.take(box)`);
  assert.deepEqual(
    await js(
      `(()=>{const s=box.querySelector('.mv-screen.audio'),n=node('02 song.wav');return [mvCtx.media.stage.where(),s?.querySelector('audio')?.dataset.mark,!!s?.querySelector('.mv-subs'),!!n.querySelector('.mv-card>.mv-away'),n.classList.contains('mv-out'),elOf('02 song.wav').paused,loads,mvCtx.media.stage.screen()===s];})()`,
    ),
    ['out', 's2', true, true, true, false, 0, true],
    'Audio handed to the container with its subtitles area; a placeholder in the card',
  );
  await shot('background-away-audio');
  await tap('#reader .page[data-name="02 song.wav"] .mv-away');
  await wait(() => js(`mvCtx.media.stage.where()==='page'`), 'the placeholder brings it back');
  assert.deepEqual(
    await js(
      `(()=>{const n=node('02 song.wav');return [n.querySelector('audio')?.dataset.mark,!!n.querySelector('.mv-card>.mv-subs'),!!n.querySelector('.mv-away'),!box.children.length,elOf('02 song.wav').paused,loads];})()`,
    ),
    ['s2', true, false, true, false, 0],
    'Back in the page: same element, still playing',
  );
  // 视频：占位盖住画面；列表内切换（下一项）时画面留在外部容器里。
  assert.ok(await js(`toPage('04 clip.webm')`));
  await tap('#reader .page[data-name="04 clip.webm"]');
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'clip plays');
  await js(`mvCtx.media.stage.take(box)`);
  const away = await js(
    `(()=>{const n=node('04 clip.webm'),a=n.querySelector(':scope>.mv-away'),r=a.getBoundingClientRect(),q=n.getBoundingClientRect();return {cover:[r.left,r.top,r.width,r.height].map(Math.round).join()===[q.left,q.top,q.width,q.height].map(Math.round).join(),inBox:box.querySelector('.mv-screen.video>video')===elOf('04 clip.webm'),text:a.textContent,playing:!elOf('04 clip.webm').paused};})()`,
  );
  assert.deepEqual(
    away,
    { cover: true, inBox: true, text: 'Playing in picture-in-pictureClick to show it here', playing: true },
    'Video handed out; the placeholder covers the picture',
  );
  await shot('background-away-video');
  await js(`mvCtx.media.queue.next()`);
  await wait(() => js(`track()==='05 b.wav'`), 'next item');
  assert.deepEqual(
    await js(
      `[!!box.querySelector('.mv-screen.audio>audio'),!box.querySelector('video'),node('04 clip.webm').querySelector(':scope>video')===elOf('04 clip.webm')||!P('04 clip.webm'),!node('04 clip.webm').querySelector('.mv-away')]`,
    ),
    [true, true, true, true],
    'Switching within the list keeps the picture outside; the previous one goes back',
  );
  await js(`mvCtx.media.stage.drop()`);
  assert.deepEqual(await js(`[mvCtx.media.stage.where(),mvCtx.media.stage.container,box.children.length]`), [
    'page',
    null,
    0,
  ]);
  await js(`mvClearQueue()`);
  await wait(() => js('on().length===0'), 'stopped');

  // ---- 播放列表：过滤（留在列表里）、移除、单文件循环、跨书接续。
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`track()==='02 song.wav'&&!elOf('02 song.wav').paused`), 'song');
  await js(`window.qev=[];mvCtx.on('queue',k=>qev.push(k));mvCtx.media.queue.setTypes(['audio'])`);
  assert.deepEqual(
    await js(`mvCtx.media.queue.items().map(x=>x.page.name+':'+x.filtered)`),
    ['02 song.wav:false', '04 clip.webm:true', '05 b.wav:false'],
    'Filtered items stay in the list, marked as filtered',
  );
  assert.deepEqual(
    await js(
      `[localStorage.getItem('mv2:playTypes'),qev.includes('types'),qev.includes('list'),mvCtx.media.queue.filtering()]`,
    ),
    ['["audio"]', true, true, true],
  );
  await js(`mvCtx.media.queue.remove(mvCtx.media.queue.items()[1])`);
  assert.deepEqual(await js(`mvCtx.media.queue.items().map(x=>x.page.name)`), ['02 song.wav', '05 b.wav'], 'Removed');
  await js(`mvCtx.media.queue.setTypes([])`);
  assert.deepEqual(
    await js(`mvCtx.media.queue.items().map(x=>x.page.name)`),
    ['02 song.wav', '05 b.wav'],
    'Changing the filter does not change the list',
  );
  await js(`mvCtx.media.queue.setScope('file');window.ends=0;elOf('02 song.wav').addEventListener('ended',()=>ends++)`);
  await wait(
    () => js(`ends>0&&!elOf('02 song.wav').paused&&elOf('02 song.wav').currentTime>.2`),
    'single file loop: replays after the end',
  );
  assert.equal(await js('track()'), '02 song.wav', 'Single file: replays itself');
  // 跨书：列表播完进入阅读列表里末项所在书的下一本有媒体的书（跳过 Gamma），它不在列表里：列表换成那本，主窗口不切书。
  await js(`mvCtx.media.queue.setScope('books');mvCtx.media.queue.play(mvCtx.media.queue.items()[1],{time:1.2})`);
  await wait(() => js(`track()==='05 b.wav'&&!elOf('05 b.wav').paused`), 'last item');
  await wait(() => js(`track()==='02 tune.wav'&&!elOf('02 tune.wav').paused`), 'cross-book: on to Beta');
  assert.deepEqual(
    await js(`[bookTitle.textContent,names().join()]`),
    ['Alpha', 'Beta:02 tune.wav'],
    'The list is now Beta; the main window stays in Alpha',
  );
  await onlyOne('cross-book');
  // 总控栏右区：本书没有媒体但有当前曲目时可用，停止后禁用。
  await js(`open('Gamma')`);
  await wait(() => js(`bookTitle.textContent==='Gamma'`), 'Gamma');
  await showBar();
  assert.equal(await js(`${B('volume')}.disabled`), false, 'A track keeps the media zone enabled');
  await js(`mvClearQueue();mvCtx.media.queue.setScope('list')`);
  await wait(() => js(`${B('volume')}.disabled&&${B('mediaNext')}.disabled`), 'no media, no track: disabled');

  // ---- 播放列表的模型：跨书的项与追加、点已在列表里的文件不改列表、两端的跨书、只含书签与书签情况、收藏列表、移除到没有可接续项。
  await js(`open('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha for the model');
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`track()==='02 song.wav'&&!elOf('02 song.wav').paused`), 'song for the model');
  await js(`mvCtx.media.queue.toggle()`);
  await wait(() => js(`elOf('02 song.wav').paused`), 'paused');
  assert.deepEqual(
    await js(
      `[mvCtx.media.queue.addBook(bookOf('Beta')),mvCtx.media.queue.addBook(bookOf('Beta')),mvCtx.media.queue.addBook(bookOf('Gamma'))]`,
    ),
    [1, 0, 0],
    'addBook returns how many were appended',
  );
  assert.deepEqual(
    await js(`[names(),track(),elOf('02 song.wav').paused]`),
    [['Alpha:02 song.wav', 'Alpha:04 clip.webm', 'Alpha:05 b.wav', 'Beta:02 tune.wav'], '02 song.wav', true],
    'Appended at the end; nothing plays, the track stays',
  );
  // 点一个已在列表里的文件本体：不改列表。
  assert.ok(await js(`toPage('04 clip.webm')`));
  await tap('#reader .page[data-name="04 clip.webm"]');
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'clip from the list');
  await js(`mvCtx.media.queue.toggle()`);
  await wait(() => js(`elOf('04 clip.webm').paused`), 'clip paused');
  assert.equal(await js(`names().length`), 4, 'Playing a file already in the list keeps the list');
  // 过滤：上一个 / 下一个跳过被过滤的项；列表范围在两端首尾相接；保持暂停。
  await js(`mvCtx.media.queue.setTypes(['audio'])`);
  const steps = async (...ds) => {
    const out = [];
    for (const d of ds) {
      await js(`mvCtx.media.queue.step(${d})`);
      out.push(await js(`(mvCtx.media.queue.track()?.book.title??'')+':'+track()`));
    }
    return out;
  };
  assert.deepEqual(
    await steps(1, 1, 1),
    ['Alpha:05 b.wav', 'Beta:02 tune.wav', 'Alpha:02 song.wav'],
    'Next skips the filtered, wraps',
  );
  assert.deepEqual(await steps(-1, -1), ['Beta:02 tune.wav', 'Alpha:05 b.wav']);
  assert.equal(await js('mvCtx.media.queue.playing()'), false, 'Stepping keeps it paused');
  // 跨书范围：在两端进入上一本 / 下一本；已在列表里就跳到它的项，不替换；不在列表里时列表换成那本书。
  await js(`mvCtx.media.queue.setScope('books')`);
  assert.deepEqual(
    await steps(-1, -1),
    ['Alpha:02 song.wav', 'Beta:02 tune.wav'],
    'At the start: the previous book, already in the list',
  );
  assert.deepEqual(await steps(1), ['Alpha:02 song.wav'], 'At the end: the next book with media, already in the list');
  assert.equal(await js(`names().length`), 4, 'The list stays');
  await js(`mvCtx.media.queue.remove(mvCtx.media.queue.items()[3])`);
  assert.deepEqual(await steps(-1), ['Beta:02 tune.wav'], 'At the start: the previous book, not in the list');
  assert.deepEqual(
    await js(`[names().join(),bookTitle.textContent]`),
    ['Beta:02 tune.wav', 'Alpha'],
    'Beta replaces the list',
  );
  assert.deepEqual(await steps(-1), ['Alpha:05 b.wav'], 'The previous book: its last item that can go on');
  assert.deepEqual(await js(`names().join()`), 'Alpha:02 song.wav,Alpha:04 clip.webm,Alpha:05 b.wav');
  await js(`mvCtx.media.queue.setTypes([]);mvCtx.media.queue.setScope('list')`);
  // 只含书签与每项的书签情况（书签、区段书签）。
  await js(`mvCtx.media.queue.setMarked(true)`);
  assert.deepEqual(
    await js(
      `[mvCtx.media.queue.items().every(x=>x.filtered),localStorage.getItem('mv2:playMarked'),mvCtx.media.queue.filtering()]`,
    ),
    [true, 'true', true],
    'Bookmarked only: no bookmarks yet',
  );
  await js(
    `(async()=>{const b=bookOf('Alpha');window.oldMarks=b.bookmarks;b.bookmarks=[{id:'qm1',name:'05 b.wav',t:0.5,at:1,label:'x'},{id:'qm2',name:'02 song.wav',t:0.2,at:2,label:'y',end:{name:'02 song.wav',t:1,at:3,label:'z'}}];qev=[];(await import('./src/core/events.mjs')).emit('marks',b);})()`,
  );
  assert.deepEqual(
    await js(`[mvCtx.media.queue.items().map(x=>x.page.name+':'+x.marks+':'+x.filtered),qev.includes('list')]`),
    [['02 song.wav:section:false', '04 clip.webm:none:true', '05 b.wav:mark:false'], true],
    'Marks per item; bookmarked ones pass the filter',
  );
  await js(`mvCtx.media.queue.setMarked(false)`);
  // 收藏列表：只存没有被过滤的项，默认名为第一项所在的书名（跨书时注明本数）；改名、删除；别的窗口的改动经 storage 事件同步。
  await js(`mvCtx.media.queue.addBook(bookOf('Beta'));mvCtx.media.queue.setTypes(['audio']);qev=[]`);
  const fav = await js(
    `(()=>{const f=mvCtx.media.queue.favorites,d=f.defaultName(),a=f.save(),b=f.save('  Mine  ');return {d,a,b,list:f.list(),stored:JSON.parse(localStorage.getItem('mv2:playlists')).map(x=>x.items.map(i=>i.page).join())};})()`,
  );
  assert.equal(fav.d, 'Alpha and more (2 books)');
  assert.deepEqual(
    [fav.a.name, fav.a.count, fav.b.name, fav.b.count],
    ['Alpha and more (2 books)', 3, 'Mine', 3],
    'Only items that are not filtered are saved',
  );
  assert.deepEqual(fav.stored, ['02 song.wav,05 b.wav,02 tune.wav', '02 song.wav,05 b.wav,02 tune.wav']);
  assert.equal(
    await js(`mvCtx.media.queue.favorites.defaultName()`),
    'Alpha and more (2 books) (2)',
    'A taken name gets a number',
  );
  await js(`mvCtx.media.queue.setTypes([])`);
  assert.deepEqual(
    await js(
      `(()=>{const f=mvCtx.media.queue.favorites;return [f.rename('${fav.b.id}','Renamed'),f.rename('${fav.b.id}','  '),f.remove('${fav.b.id}'),f.remove('${fav.b.id}'),f.list().map(x=>x.name+':'+x.count),qev.filter(k=>k==='favorites').length];})()`,
    ),
    [true, false, true, false, ['Alpha and more (2 books):3'], 4],
  );
  await js(
    `(()=>{const v=JSON.stringify([...JSON.parse(localStorage.getItem('mv2:playlists')),{id:'gone',name:'Gone',items:[{book:'nope',page:'1.wav'},{book:bookOf('Alpha').id,page:'missing.wav'}]}]);localStorage.setItem('mv2:playlists',v);qev=[];dispatchEvent(new StorageEvent('storage',{key:'mv2:playlists',newValue:v,storageArea:localStorage}));})()`,
  );
  assert.deepEqual(
    await js(`[qev.includes('favorites'),mvCtx.media.queue.favorites.list().map(x=>x.name).join()]`),
    [true, 'Alpha and more (2 books),Gone'],
    'Changes from another window',
  );
  assert.deepEqual(
    await js(`[mvCtx.media.queue.favorites.load('gone'),names().length,document.querySelector('#notice').textContent]`),
    [false, 4, 'None of the files in this list can be found'],
    'Nothing found: a hint, the list stays',
  );
  // 载入：列表换成收藏的内容，从第一项开始播放。
  await js(`mvCtx.media.queue.favorites.load('${fav.a.id}')`);
  await wait(() => js(`track()==='02 song.wav'&&!elOf('02 song.wav').paused`), 'loading plays the first item');
  assert.deepEqual(await js(`names()`), ['Alpha:02 song.wav', 'Alpha:05 b.wav', 'Beta:02 tune.wav']);
  // 在阅读区开始播放一个不在列表里的文件：列表换成它所在的书。
  assert.ok(await js(`toPage('04 clip.webm')`));
  await tap('#reader .page[data-name="04 clip.webm"]');
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'clip not in the list');
  assert.deepEqual(await js(`names()`), ['Alpha:02 song.wav', 'Alpha:04 clip.webm', 'Alpha:05 b.wav']);
  // 移除当前曲目、没有可接续的项（其余的都被过滤）：停止播放、取消当前曲目；列表里其余的项留着。
  await js(`mvCtx.media.queue.setTypes(['video']);mvCtx.media.queue.remove(mvCtx.media.queue.items()[1])`);
  await wait(() => js(`track()===null&&on().length===0`), 'removing the track with nothing to go on stops');
  assert.deepEqual(await js(`names()`), ['Alpha:02 song.wav', 'Alpha:05 b.wav']);
  await js(
    `(async()=>{const b=bookOf('Alpha');b.bookmarks=oldMarks;(await import('./src/core/events.mjs')).emit('marks',b);mvCtx.media.queue.setTypes([]);localStorage.removeItem('mv2:playlists');})()`,
  );

  // ---- 自动滚动与后台播放：后台曲目在漫画模式的自动滚动中照常播放；运行中空格只停止自动滚动；
  // 没有当前曲目时上一个 / 下一个媒体只定位、不播放。
  await js(`open('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha again');
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`!elOf('02 song.wav').paused`), 'song');
  await js(`${B('mode-comic')}.click()`);
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(running, 'auto-scroll runs');
  await delay(400);
  assert.equal(await js(`!elOf('02 song.wav').paused`), true, 'The background track keeps playing');
  await key(' ', 'Space', 32);
  await wait(async () => !(await running()), 'Space stops auto-scroll');
  assert.equal(await js(`!elOf('02 song.wav').paused`), true, '…and leaves the background track alone');
  await key(' ', 'Space', 32);
  await wait(() => js(`elOf('02 song.wav').paused`), 'Space pauses the file bar media');
  assert.equal(await running(), false);
  await js(`mvClearQueue();${B('mode-mixed')}.click()`);
  assert.ok(await js(`toPage('01.svg')`));
  const at0 = await js('reader.scrollTop');
  await js(`${B('mediaNext')}.click()`);
  await wait(
    () =>
      js(
        `(()=>{const n=node('02 song.wav');return !!n&&Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;})()`,
      ),
    'next media centred',
  );
  assert.deepEqual(await js(`[on().length,track(),reader.scrollTop!==${at0}]`), [0, null, true], 'Located, not played');

  // ---- 书签作用的对象：当前曲目在视窗内时是它，滚开后是视窗中心的页（图片：没有媒体）。
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`!elOf('02 song.wav').paused`), 'song');
  assert.equal(await js(`mvCtx.media.here()?.page.name`), '02 song.wav');
  assert.ok(await js(`toPage('01.svg')`));
  await js('reader.scrollTop=0');
  await js('frame()');
  assert.deepEqual(
    await js(`[mvCtx.media.here(),mvCtx.media.current()?.page.name]`),
    [null, '02 song.wav'],
    'Bookmarks: the centre page; file bar: the track',
  );
  await js(`mvClearQueue()`);

  // ---- 自动播放开始的视频：离开视窗即暂停并取消，不接续。
  await js(
    `localStorage.setItem('mv2:autoplay','true');dispatchEvent(new StorageEvent('storage',{key:'mv2:autoplay',newValue:'true',storageArea:localStorage}))`,
  );
  assert.ok(await js(`toPage('04 clip.webm')`));
  const [rx, ry] = await js(
    `(()=>{const r=reader.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
  );
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rx, y: ry, deltaX: 0, deltaY: 5 });
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'autoplay');
  assert.equal(await js(`mvCtx.media.queue.track().by`), 'auto');
  await js('reader.scrollTop=0');
  await wait(() => js(`track()===null&&on().length===0`), 'autoplayed video paused and released when it leaves');
  await js(
    `localStorage.setItem('mv2:autoplay','false');dispatchEvent(new StorageEvent('storage',{key:'mv2:autoplay',newValue:'false',storageArea:localStorage}))`,
  );

  await js('box.remove()');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: background play (keeps playing when scrolled away and across books, parked without reloading, back into the page seamlessly), list continuation without scrolling, locate, removing everything stops, one media at a time, handing the picture to an outside container and back (placeholder), play list filter (kept in the list) / remove / single file loop / cross-book, the list model (items across books, addBook, steps skipping filtered items, both ends across books, bookmarked only and marks per item, favorites saved / renamed / removed / synced / loaded, removing the track with nothing to go on), media zone enabled by a track, auto-scroll separate from background play, Space rules, bookmark target, autoplayed video released when it leaves',
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
