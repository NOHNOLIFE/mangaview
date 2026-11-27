// 后台播放（media/track.mjs、queue.mjs、driver.mjs）：当前曲目离开视窗、切书继续播放，播完按播放列表接续且主窗口不滚动、不跳转，
// 回到视窗时画面无缝回到页里；同一时间只有一个媒体在播放；文件栏的「定位」「停止」；画面交给外部容器与收回（ctx.media.stage）；
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
  assert.equal(await js(`${H('stop')}.disabled||${H('locate')}.disabled`), false, 'Locate and stop enabled');
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
  // ---- 「停止」：停止播放、清空列表、取消当前曲目，文件栏回到视窗中心所在的页。
  await js(`${H('stop')}.click()`);
  await wait(() => js(`on().length===0&&track()===null`), 'stopped');
  assert.deepEqual(
    await js(
      `[mvCtx.media.queue.items().length,!!reader.querySelector('.page.media.selected'),${H('stop')}.disabled,${H('locate')}.disabled]`,
    ),
    [0, false, true, true],
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
  await js(`mvCtx.media.queue.stop()`);
  await wait(() => js('on().length===0'), 'stopped');

  // ---- 播放列表：类型开关、移除、单文件循环、跨书接续。
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`track()==='02 song.wav'&&!elOf('02 song.wav').paused`), 'song');
  await js(`window.qev=[];mvCtx.on('queue',k=>qev.push(k));mvCtx.media.queue.setTypes(['audio'])`);
  assert.deepEqual(await js(`mvCtx.media.queue.items().map(x=>x.page.name)`), ['02 song.wav', '05 b.wav']);
  assert.deepEqual(await js(`[localStorage.getItem('mv2:playTypes'),qev.includes('types'),qev.includes('list')]`), [
    '["audio"]',
    true,
    true,
  ]);
  await js(`mvCtx.media.queue.remove(mvCtx.media.queue.items()[1])`);
  assert.deepEqual(
    await js(`mvCtx.media.queue.items().map(x=>x.page.name)`),
    ['02 song.wav'],
    'Removed for this list only',
  );
  await js(`mvCtx.media.queue.setTypes([])`);
  assert.deepEqual(
    await js(`mvCtx.media.queue.items().map(x=>x.page.name)`),
    ['02 song.wav', '04 clip.webm', '05 b.wav'],
    'Changing the types rebuilds the list',
  );
  await js(`mvCtx.media.queue.setScope('file');window.ends=0;elOf('02 song.wav').addEventListener('ended',()=>ends++)`);
  await wait(
    () => js(`ends>0&&!elOf('02 song.wav').paused&&elOf('02 song.wav').currentTime>.2`),
    'single file loop: replays after the end',
  );
  assert.equal(await js('track()'), '02 song.wav', 'Single file: replays itself');
  // 跨书：本书的列表播完进入阅读列表里下一本有媒体的书（跳过 Gamma），主窗口不切书。
  await js(`mvCtx.media.queue.setScope('books');mvCtx.media.queue.play(mvCtx.media.queue.items()[2],{time:1.2})`);
  await wait(() => js(`track()==='05 b.wav'&&!elOf('05 b.wav').paused`), 'last item');
  await wait(() => js(`track()==='02 tune.wav'&&!elOf('02 tune.wav').paused`), 'cross-book: on to Beta');
  assert.deepEqual(
    await js(
      `[bookTitle.textContent,mvCtx.media.queue.book().title,mvCtx.media.queue.items().map(x=>x.page.name).join()]`,
    ),
    ['Alpha', 'Beta', '02 tune.wav'],
    'The list is now Beta; the main window stays in Alpha',
  );
  await onlyOne('cross-book');
  // 总控栏右区：本书没有媒体但有当前曲目时可用，停止后禁用。
  await js(`open('Gamma')`);
  await wait(() => js(`bookTitle.textContent==='Gamma'`), 'Gamma');
  await showBar();
  assert.equal(await js(`${B('volume')}.disabled`), false, 'A track keeps the media zone enabled');
  await js(`mvCtx.media.queue.stop();mvCtx.media.queue.setScope('book')`);
  await wait(() => js(`${B('volume')}.disabled&&${B('mediaNext')}.disabled`), 'no media, no track: disabled');

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
  await js(`mvCtx.media.queue.stop();${B('mode-mixed')}.click()`);
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
  await js(`mvCtx.media.queue.stop()`);

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
    'PASS: background play (keeps playing when scrolled away and across books, parked without reloading, back into the page seamlessly), list continuation without scrolling, locate / stop, one media at a time, handing the picture to an outside container and back (placeholder), play list types / remove / single file loop / cross-book, media zone enabled by a track, auto-scroll separate from background play, Space rules, bookmark target, autoplayed video released when it leaves',
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
