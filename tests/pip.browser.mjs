// 画中画窗口（media/pip.mjs、media/pipview.mjs）：无头 Chrome 支持文档画中画，直接测真实窗口（打开要用户手势：真实的点击、按键，
// 或带 userGesture 的调用）；窗口里的按键用合成事件派发到画中画窗口；布局另把面板装进主文档里的普通容器，按不同尺寸断言。
// 框架同 tests/background.browser.mjs；独立临时配置 + OPFS 测试数据，音频、视频由 tests/media-fixtures.mjs 现场生成，不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/pip.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-pip-'));
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
  const gesture = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  // 测试里经 ctx 调用接口：ctx 不暴露到全局，这里在它被赋上 fileBar 时记下（只在测试页里）。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','false');
    if(sessionStorage.noPip)delete window.documentPictureInPicture;
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
  // Alpha：图、长音频、高图、视频、音频、图。Beta：图、音频。Many：300 个极短的音频（长列表）。
  await addBook(
    'Alpha',
    `await mvMedia.write(d,'01.svg',svg(600,900,'teal'));await mvMedia.write(d,'02 song.wav',mvMedia.wav({seconds:30}));
    await mvMedia.write(d,'03.svg',svg(600,2000,'#345'));await mvMedia.write(d,'04 clip.webm',await mvMedia.webm({seconds:4,width:320,height:180}));
    await mvMedia.write(d,'05 b.wav',mvMedia.wav({seconds:20,freq:660}));await mvMedia.write(d,'06.svg',svg(600,900,'#543'));`,
    '#empty [data-act="folder"]',
  );
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha');
  await addBook(
    'Beta',
    `await mvMedia.write(d,'01.svg',svg(600,900,'#355'));await mvMedia.write(d,'02 tune.wav',mvMedia.wav({seconds:20,freq:550}));`,
    '#bar [data-act="folder"]',
  );
  await wait(() => js(`bookTitle.textContent==='Beta'`), 'Beta');
  await addBook(
    'Many',
    `const w=mvMedia.wav({seconds:0.2});for(let i=0;i<300;i++)await mvMedia.write(d,'m'+String(i).padStart(3,'0')+'.wav',w);`,
    '#bar [data-act="folder"]',
  );
  await wait(() => js(`bookTitle.textContent==='Many'`), 'Many');
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.P=name=>mvCtx.player.list().find(p=>p.page.name===name)??null;
    window.elOf=name=>P(name)?.el??null;
    window.track=()=>mvCtx.media.queue.track()?.page.name??null;
    window.openBook=async t=>{const s=await import('./src/reader/session.mjs'),{books}=await import('./src/core/books.mjs');s.select([...books.values()].find(b=>b.title===t));};
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.loads=0;window.watchLoads=name=>{loads=0;elOf(name).addEventListener('loadstart',()=>loads++);};
    window.W=()=>mvCtx.pip.window();window.D=()=>W()?.document??null;
    window.pq=s=>D()?.querySelector(s)??null;
    window.rows=()=>[...(D()?.querySelectorAll('.pip-item')??[])].sort((a,b)=>a.dataset.i-b.dataset.i);
    window.rowOf=name=>rows().find(r=>r.item.page.name===name)??null;
    window.pkey=(key,code,type='keydown')=>D().body.dispatchEvent(new (W().KeyboardEvent)(type,{key,code,bubbles:true,cancelable:true}));`);
  const H = (id) => `document.querySelector('#filebar [data-head="${id}"]')`;
  const showBar = async () => {
    await wait(() => js(`!controlbar.classList.contains('leaving')`), 'fade finished');
    if (await js('controlbar.hidden')) await key('t', 'KeyT', 84);
    await wait(() => js(`!controlbar.hidden&&!controlbar.getAnimations().length`), 'control bar shown');
    await js('frame()');
  };
  const click = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x, y });
  };
  const tap = async (sel) => {
    const [x, y] = await js(
      `(()=>{const r=${sel.startsWith('document') ? sel : 'document.querySelector(' + JSON.stringify(sel) + ')'}.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
    await click(x, y);
  };
  const isOpen = () => js('!!W()');
  // 画中画窗口的截图（MV_SHOTS）：它是一个单独的 about:blank 页目标。
  const shotPip = async (name) => {
    if (!process.env.MV_SHOTS) return;
    const t = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(
      (x) => x.type === 'page' && x.url === 'about:blank',
    );
    if (!t) return;
    const w = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => w.addEventListener('open', r, { once: true }));
    const data = await new Promise((r) => {
      w.onmessage = ({ data }) => r(JSON.parse(data).result?.data);
      w.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    w.close();
    if (data) await writeFile(join(process.env.MV_SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };

  // ---- 入口：文件栏标题行的「画中画」（order 20，在「定位」之后）；显示的是图片时只打开窗口（没有曲目时是一句说明），再按关闭。
  await js(`openBook('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha');
  assert.ok(await js(`toPage('01.svg')`));
  await showBar();
  assert.deepEqual(
    await js(`[...document.querySelectorAll('#filebar .fb-head-tools [data-head]')].map(b=>b.dataset.head)`),
    ['locate', 'pip'],
  );
  assert.equal(await js(`${H('pip')}.getAttribute('aria-label')`), 'Picture-in-picture');
  const top0 = await js('reader.scrollTop');
  await tap(`${H('pip')}`);
  await wait(isOpen, 'the window opens from the file bar');
  await wait(
    () => js(`!!pq('.pip')&&pq('.pip-idle')?.textContent.includes('Nothing is playing')`),
    'panel with the hint',
  );
  assert.deepEqual(
    await js(
      `[D().documentElement.lang,!!D().querySelector('svg.sprite #i-pip'),getComputedStyle(pq('.pip')).backgroundColor!=='rgba(0, 0, 0, 0)',reader.scrollTop,track()]`,
    ),
    ['en', true, true, top0, null],
    'Own styles, icons and lang; the main window does not move; no track',
  );
  await showBar();
  await wait(() => js(`${H('pip')}.getAttribute('aria-pressed')==='true'`), 'entry pressed while open');
  assert.equal(await js(`${H('pip')}.getAttribute('aria-label')`), 'Exit picture-in-picture');
  await tap(`${H('pip')}`);
  await wait(async () => !(await isOpen()), 'pressing again closes it');
  await wait(() => js(`${H('pip')}.getAttribute('aria-pressed')==='false'`), 'entry released');

  // ---- 音频卡片上的同一个按钮（书签、区段、画中画三个直接显示）：它成为当前曲目、开始播放，画面搬进窗口。
  assert.ok(await js(`toPage('02 song.wav')`));
  assert.deepEqual(
    await js(
      `[...node('02 song.wav').querySelectorAll('.mv-shell > .mv-x')].filter(b=>!b.closest('.mv-pop')).map(b=>b.dataset.control)`,
    ),
    ['bookmark', 'section', 'pip'],
  );
  await js(`watchLoads('02 song.wav');elOf('02 song.wav').dataset.mark='song'`);
  await tap(`#reader .page[data-name="02 song.wav"] .mv-x[data-control="pip"]`);
  await wait(isOpen, 'the card button opens the window');
  await wait(
    () =>
      js(
        `track()==='02 song.wav'&&!elOf('02 song.wav').paused&&pq('.pip-screen .mv-screen.audio>audio')?.dataset.mark==='song'&&pq('.pip-idle').hidden`,
      ),
    'the song plays in the window',
  );
  assert.deepEqual(
    await js(
      `[loads,mvCtx.media.stage.where(),!!node('02 song.wav').querySelector('.mv-away'),pq('.pip-name').textContent,!!pq('.pip-art.mv-art'),pq('.pip-idle').hidden,rows().map(r=>r.textContent),rowOf('02 song.wav').classList.contains('current')]`,
    ),
    [0, 'out', true, '02 song', true, true, ['02 song', '04 clip', '05 b'], true],
    'Picture in the window, placeholder in the page, name, art and the list',
  );
  await shotPip('pip-window-audio');
  await wait(
    () => js(`node('02 song.wav').querySelector('.mv-x[data-control="pip"]').getAttribute('aria-pressed')==='true'`),
    'card button pressed',
  );

  // ---- Z：画面已在窗口里的当前曲目再按即关闭：画面回到页内，继续播放，不重新加载、时间连续。
  let t0 = await js(`elOf('02 song.wav').currentTime`);
  await js('reader.focus()');
  await key('z', 'KeyZ', 90);
  await wait(async () => !(await isOpen()), 'Z closes');
  assert.deepEqual(
    await js(
      `[node('02 song.wav').contains(elOf('02 song.wav')),elOf('02 song.wav').paused,elOf('02 song.wav').currentTime>=${t0},loads,mvCtx.media.stage.where(),!!node('02 song.wav').querySelector('.mv-away')]`,
    ),
    [true, false, true, 0, 'page', false],
    'Closing brings the picture back; playback goes on',
  );
  // Z 再开：画面搬进去，不中断。
  t0 = await js(`elOf('02 song.wav').currentTime`);
  await key('z', 'KeyZ', 90);
  await wait(() => js(`!!pq('.pip-screen audio')`), 'Z opens with the track');
  await delay(300);
  assert.deepEqual(
    await js(`[elOf('02 song.wav').paused,elOf('02 song.wav').currentTime>${t0},loads]`),
    [false, true, 0],
    'Moved into the window without a reload or a pause',
  );
  // 点页内的占位收回页内；窗口里是占位（「在画中画显示」），点它再搬回去。
  await tap('#reader .page[data-name="02 song.wav"] .mv-away');
  await wait(() => js(`mvCtx.media.stage.where()==='page'&&!pq('.pip-idle').hidden`), 'placeholder brings it back');
  assert.deepEqual(
    await js(
      `[node('02 song.wav').contains(elOf('02 song.wav')),elOf('02 song.wav').paused,loads,pq('.pip-idle').textContent]`,
    ),
    [true, false, 0, 'Playing in the main windowShow here'],
  );
  await shotPip('pip-window-away');
  await js(`pq('.pip-show').click()`);
  await wait(() => js(`!!pq('.pip-screen audio')&&pq('.pip-idle').hidden`), 'show here takes it again');
  assert.deepEqual(await js(`[elOf('02 song.wav').paused,loads]`), [false, 0]);

  // ---- 显示位置跟随上一次的明确选择：画面在画中画里时，在阅读区点别的媒体，画面直接进画中画（页内是占位）；文件名、列表、进度照常同步。
  assert.ok(await js(`toPage('04 clip.webm')`));
  await tap('#reader .page[data-name="04 clip.webm"]');
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'clip plays');
  await wait(
    () => js(`!!pq('.pip-screen video')&&pq('.pip-idle').hidden&&pq('.pip-name').textContent==='04 clip'`),
    'straight into the window',
  );
  assert.deepEqual(
    await js(
      `[mvCtx.media.stage.where(),!!node('04 clip.webm').querySelector(':scope>.mv-away'),rowOf('04 clip.webm').classList.contains('current'),elOf('02 song.wav')?.paused??true]`,
    ),
    ['out', true, true, true],
  );
  const v1 = await js(`+pq('.pip-line .mv-bar').getAttribute('aria-valuenow')*0+elOf('04 clip.webm').currentTime`);
  await wait(
    () => js(`pq('.pip-line .mv-clock').textContent.startsWith('0:0')&&elOf('04 clip.webm').currentTime>${v1}+0.5`),
    'progress goes on',
  );
  assert.match(await js(`pq('.pip-line .mv-clock').textContent`), / \/ 0:04$/, 'The time of the new track');
  // 点页内占位：只把画面收回页内（不翻屏）；之后新的曲目在页内显示，直到再次按画中画入口。
  const top2 = await js('reader.scrollTop');
  await tap('#reader .page[data-name="04 clip.webm"] .mv-away');
  await wait(() => js(`mvCtx.media.stage.where()==='page'&&!pq('.pip-idle').hidden`), 'the placeholder brings it back');
  await delay(200);
  assert.deepEqual(
    await js(`[reader.scrollTop,node('04 clip.webm').contains(elOf('04 clip.webm'))]`),
    [top2, true],
    'Clicking the placeholder does not turn the page',
  );
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`track()==='02 song.wav'&&!elOf('02 song.wav').paused`), 'song plays');
  await wait(() => js(`!pq('.pip-idle').hidden&&pq('.pip-name').textContent==='02 song'`), 'window follows');
  assert.deepEqual(
    await js(`[mvCtx.media.stage.where(),node('02 song.wav').contains(elOf('02 song.wav')),!!pq('.pip-screen audio')]`),
    ['page', true, false],
    'After bringing it back, a new track plays in the page',
  );

  // ---- 列表项：点击只播放，主窗口不滚动；画面留在原来的显示位置（这里在画中画里）。
  await js(`mvCtx.media.stage.take(pq('.pip-screen'))`);
  await wait(() => js(`!!pq('.pip-screen audio')`), 'song in the window');
  await shotPip('pip-window-video');
  const top1 = await js('reader.scrollTop');
  await js(`rowOf('05 b.wav').click()`);
  await wait(() => js(`track()==='05 b.wav'&&!elOf('05 b.wav').paused`), 'the row plays');
  await wait(() => js(`!!pq('.pip-screen .mv-screen.audio>audio')`), 'the new track shows in the window');
  assert.deepEqual(
    await js(`[reader.scrollTop,bookTitle.textContent]`),
    [top1, 'Alpha'],
    'The main window does not move',
  );

  // ---- 每项的「定位」：主窗口跳到它所在的页（必要时切书），不播放、不改变当前曲目；按钮只在悬停 / 选中的项上显示，位置固定。
  await js(`openBook('Beta')`);
  await wait(() => js(`bookTitle.textContent==='Beta'`), 'Beta');
  const rel = `(()=>{const r=rowOf('02 song.wav'),b=r.querySelector('[data-id="locate"]'),x=b.getBoundingClientRect(),y=r.getBoundingClientRect();return [getComputedStyle(b).visibility,[x.left-y.left,x.top-y.top,x.width].map(Math.round).join()];})()`;
  const r0 = await js(rel);
  await js(
    `rowOf('02 song.wav').dispatchEvent(new (W().PointerEvent)('pointerover',{bubbles:true,pointerType:'mouse'}))`,
  );
  const r1 = await js(rel);
  assert.deepEqual(
    [r0[0], r1[0], r0[1] === r1[1]],
    ['hidden', 'visible', true],
    'Row buttons show on hover in place ' + r0[1] + r1[1],
  );
  // 悬停显示文件详情框（建在画中画窗口的文档里），不设 title。
  await wait(() => js(`!!D().querySelector('.fc:popover-open')`), 'file card in the window');
  assert.deepEqual(
    await js(
      `[D().querySelector('.fc .fc-name').textContent,rowOf('02 song.wav').title,!!document.querySelector('.fc:popover-open')]`,
    ),
    ['02 song.wav', '', false],
  );
  await js(`rowOf('02 song.wav').querySelector('[data-id="locate"]').click()`);
  await wait(() => js(`bookTitle.textContent==='Alpha'&&!!node('02 song.wav')`), 'locate switches the book');
  await wait(
    () =>
      js(
        `(()=>{const n=node('02 song.wav');return Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;})()`,
      ),
    'locate centres the file',
  );
  assert.deepEqual(await js(`[track(),!elOf('05 b.wav').paused]`), ['05 b.wav', true], 'Locating does not play');
  // 窗口按钮行的「定位」：跳到当前曲目。
  await js(`pq('.pip-tools [data-id="locate"]').click()`);
  await wait(
    () =>
      js(
        `(()=>{const n=node('05 b.wav');return !!n&&Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;})()`,
      ),
    'locate the track',
  );

  // ---- 上一个 / 下一个（保持显示位置）；移除别的项、移除当前曲目（接着播下一项）、移除最后一项（停止）。
  await js(`pq('.pip-tools [data-id="prev"]').click()`);
  await wait(() => js(`track()==='04 clip.webm'&&!!pq('.pip-screen video')`), 'previous, still in the window');
  await js(`pq('.pip-tools [data-id="next"]').click()`);
  await wait(() => js(`track()==='05 b.wav'`), 'next');
  await js(`rowOf('02 song.wav').querySelector('[data-id="remove"]').click()`);
  await wait(() => js(`rows().map(r=>r.textContent).join()==='04 clip,05 b'`), 'removed from the list');
  assert.equal(await js('track()'), '05 b.wav', 'Removing another row keeps the track');
  await js(`rowOf('05 b.wav').querySelector('[data-id="remove"]').click()`);
  await wait(
    () => js(`track()==='04 clip.webm'&&rows().map(r=>r.textContent).join()==='04 clip'`),
    'removing the track plays the next',
  );
  await js(`rowOf('04 clip.webm').querySelector('[data-id="remove"]').click()`);
  await wait(() => js(`track()===null&&rows().length===0`), 'removing the last item stops');
  await wait(() => js(`pq('.pip-idle').textContent.includes('Nothing is playing')`), 'the hint again');
  assert.deepEqual(
    await js(`['prev','next','locate','play'].map(id=>pq('[data-id="'+id+'"]').disabled)`),
    [true, true, true, true],
    'Track buttons disabled without a track',
  );
  assert.equal(await isOpen(), true, 'Stopping does not close the window');
  assert.equal(await js(`!!pq('[data-id="stop"]')||!!pq('[data-id="shuffle"]')`), false, 'No stop or shuffle button');

  // ---- 循环范围、类型：与偏好同步（本窗口、主窗口的接口、别的窗口改了偏好；旧值「本书」读作列表）。
  const look = () =>
    js(
      `['scope','audio','video'].map(id=>{const b=pq('.pip-tools [data-id="'+id+'"]');return id==='scope'?b.dataset.scope+':'+b.querySelector('use').getAttribute('href')+':'+b.getAttribute('aria-label'):b.getAttribute('aria-pressed');})`,
    );
  assert.deepEqual(await look(), ['list:#i-loop-book:Loop: play list', 'false', 'false']);
  await js(`pq('.pip-tools [data-id="scope"]').click()`);
  await js(`pq('.pip-tools [data-id="audio"]').click()`);
  assert.deepEqual(await look(), ['books:#i-loop-books:Loop: across books', 'true', 'false']);
  assert.deepEqual(await js(`['playScope','playTypes'].map(k=>localStorage.getItem('mv2:'+k))`), [
    '"books"',
    '["audio"]',
  ]);
  await js(`mvCtx.media.queue.setScope('file');mvCtx.media.queue.setTypes([])`);
  await wait(
    async () => (await look()).join() === 'file:#i-loop-file:Loop: single file,false,false',
    'follows the API',
  );
  // 别的窗口写入偏好（storage 事件）。
  await js(
    `(()=>{const e=(k,v)=>{localStorage.setItem('mv2:'+k,v);window.dispatchEvent(new StorageEvent('storage',{key:'mv2:'+k,newValue:v,storageArea:localStorage}));};e('playTypes','["video"]');e('playScope','"book"');})()`,
  );
  await wait(
    async () => (await look()).join() === 'list:#i-loop-book:Loop: play list,false,true',
    'follows other windows',
  );
  await js(`mvCtx.media.queue.setTypes([])`);

  // ---- 窗口里的按键：空格播放 / 暂停，← → 点按 2 秒，↑ ↓ 选中、Enter 播放，Q / E 音量；不作用到主窗口。
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(
    () => js(`track()==='02 song.wav'&&!elOf('02 song.wav').paused&&elOf('02 song.wav').currentTime>0.3`),
    'song',
  );
  await js(`mvCtx.media.stage.take(pq('.pip-screen'))`);
  await wait(() => js(`!!pq('.pip-screen audio')`), 'song in the window');
  const mainTop = await js('reader.scrollTop');
  await js(`pkey(' ','Space')`);
  await wait(() => js(`elOf('02 song.wav').paused`), 'Space pauses');
  assert.equal(
    await js(`document.querySelector('#controlbar [data-id="play"]').getAttribute('aria-pressed')`),
    'false',
    'Space in the window does not start auto-scroll',
  );
  const c0 = await js(`elOf('02 song.wav').currentTime`);
  await js(`pkey('ArrowRight','ArrowRight');pkey('ArrowRight','ArrowRight','keyup')`);
  await wait(() => js(`Math.abs(elOf('02 song.wav').currentTime-(${c0}+2))<0.3`), '→ taps 2 s forward');
  await js(`pkey('a','KeyA');pkey('a','KeyA','keyup')`);
  await wait(() => js(`Math.abs(elOf('02 song.wav').currentTime-${c0})<0.3`), 'A taps 2 s back');
  // 按住递增（与长按 A / D 同一份逻辑）：按住一秒多走得比 2 秒远。
  await js(`pkey('d','KeyD')`);
  await delay(1300);
  await js(`pkey('d','KeyD','keyup')`);
  assert.ok((await js(`elOf('02 song.wav').currentTime`)) - c0 > 4, 'Holding speeds up');
  await js(`pkey(' ','Space')`);
  await wait(() => js(`!elOf('02 song.wav').paused`), 'Space plays');
  const vol = await js('mvCtx.media.volume');
  await js(`pkey('q','KeyQ')`);
  assert.ok(Math.abs((await js('mvCtx.media.volume')) - (vol - 0.05)) < 0.001, 'Q: volume down');
  assert.equal(await js(`pq('.pip-hud').hidden`), false, 'Volume hint in the window');
  await js(`pkey('e','KeyE')`);
  assert.ok(Math.abs((await js('mvCtx.media.volume')) - vol) < 0.001, 'E: volume up');
  await js(`pkey('ArrowDown','ArrowDown')`);
  await wait(() => js(`rowOf('04 clip.webm').classList.contains('sel')`), '↓ selects the next row');
  await js(`pkey('ArrowDown','ArrowDown');pkey('ArrowUp','ArrowUp');pkey('Enter','Enter')`);
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'Enter plays the selected row');
  await js(`pkey('b','KeyB');pkey('w','KeyW');pkey('w','KeyW','keyup')`);
  await delay(200);
  assert.deepEqual(
    await js(`[shelf.open,reader.scrollTop]`),
    [false, mainTop],
    'Keys in the window never reach the main window',
  );

  // ---- 长列表：只渲染可视范围；打开窗口时滚到当前曲目。
  await js(`openBook('Many')`);
  await wait(() => js(`bookTitle.textContent==='Many'`), 'Many');
  await js(`(()=>{const b=mvCtx.current;mvCtx.media.queue.play({book:b,page:b.pages[250]});})()`);
  await wait(() => js(`track()==='m250.wav'`), 'm250');
  // 真实窗口：300 项只渲染可视范围附近的几十行。
  await wait(() => js(`rows().length>0`), 'rows');
  assert.ok((await js('rows().length')) < 50, 'Only the visible rows are rendered');
  // 装进普通容器（无头模式下画中画窗口的大小不受控制）：装好时滚到当前曲目，滚动时跟着换行。
  await js(
    `window.box=document.createElement('div');box.style.cssText='position:fixed;left:8px;top:8px;width:420px;height:520px;z-index:50';document.body.append(box);window.view=mvCtx.pip.mount(box);`,
  );
  await js('view.ready.then(frame).then(frame)');
  const brow = (name) => `[...box.querySelectorAll('.pip-item')].find(r=>r.item.page.name==='${name}')`;
  const long = await js(
    `(()=>{const l=box.querySelector('.pip-list'),r=${brow('m250.wav')}?.getBoundingClientRect(),b=l.getBoundingClientRect();return {items:mvCtx.media.queue.items().length,rendered:box.querySelectorAll('.pip-item').length,inView:!!r&&r.top>=b.top-1&&r.bottom<=b.bottom+1,mid:!!r&&Math.abs(r.top+r.height/2-b.top-b.height/2)<=16,height:box.querySelector('.pip-rows').offsetHeight};})()`,
  );
  assert.ok(
    long.items === 300 && long.rendered < 50 && long.inView && long.mid && long.height === 300 * 32,
    JSON.stringify(long),
  );
  await shot('pip-panel-long');
  await js(`box.querySelector('.pip-list').scrollTop=0`);
  await wait(() => js(`!!${brow('m000.wav')}&&!${brow('m250.wav')}`), 'rows follow the scroll');
  await js(`view.destroy();box.remove()`);

  // ---- 布局：装进普通容器，按不同尺寸断言不溢出；内容区按画面比例，窗口变矮时先压缩列表区。
  await js(`mvCtx.pip.close()`);
  await js(`openBook('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha again');
  assert.ok(await js(`toPage('04 clip.webm')`));
  await tap('#reader .page[data-name="04 clip.webm"]');
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'clip');
  await js(
    `window.box=document.createElement('div');box.style.cssText='position:fixed;left:8px;top:8px;z-index:50;outline:1px solid red';document.body.append(box);window.view=mvCtx.pip.mount(box);mvCtx.media.stage.take(view.screen);`,
  );
  await js('view.ready');
  const fit = (w, h) =>
    js(`(async()=>{box.style.width='${w}px';box.style.height='${h}px';await frame();await frame();const b=box.getBoundingClientRect(),out=[];
      for(const el of box.querySelectorAll('*')){const r=el.getBoundingClientRect();if(!r.width&&!r.height)continue;if(el.closest('.pip-rows')&&!el.closest('.pip-list'))continue;
        const clip=el.closest('.pip-list');const c=clip&&el!==clip?clip.getBoundingClientRect():b;
        if(r.left<c.left-0.5||r.right>c.right+0.5||(!clip||el===clip)&&(r.top<c.top-0.5||r.bottom>c.bottom+0.5))out.push(el.className.baseVal??el.className);}
      const s=box.querySelector('.pip-stage').getBoundingClientRect(),l=box.querySelector('.pip-list').getBoundingClientRect();
      return {out:[...new Set(out)],stage:[Math.round(s.width),Math.round(s.height)],list:Math.round(l.height)};})()`);
  let f = await fit(420, 520);
  assert.deepEqual(f.out, [], 'Nothing sticks out at 420×520');
  assert.ok(
    Math.abs(f.stage[1] - (f.stage[0] * 180) / 320) <= 1 && f.list > 100,
    'Picture ratio, list below: ' + JSON.stringify(f),
  );
  await shot('pip-panel-420x520');
  f = await fit(420, 300);
  assert.deepEqual(f.out, []);
  assert.ok(f.list <= 1 && f.stage[1] > 150, 'Shorter: the list gives way first: ' + JSON.stringify(f));
  for (const [w, h] of [
    [300, 240],
    [240, 160],
    [200, 120],
    [160, 90],
    [600, 900],
  ]) {
    f = await fit(w, h);
    assert.deepEqual(f.out, [], 'Nothing sticks out at ' + w + '×' + h);
  }
  await shot('pip-panel-600x900');
  await js(`view.destroy();box.remove()`);
  assert.equal(
    await js(`mvCtx.media.stage.where()+':'+!!node('04 clip.webm').querySelector(':scope>video')`),
    'page:true',
    'Unmounting brings the picture back',
  );
  // 真实窗口：面板占满窗口、不溢出。
  await js('reader.focus()');
  await key('z', 'KeyZ', 90);
  await wait(() => js(`!!pq('.pip-screen video')`), 'clip in the window');
  assert.deepEqual(
    await js(
      `(()=>{const r=pq('.pip').getBoundingClientRect();return [Math.round(r.width)===W().innerWidth,Math.round(r.height)===W().innerHeight,D().scrollingElement.scrollHeight<=W().innerHeight,D().scrollingElement.scrollWidth<=W().innerWidth];})()`,
    ),
    [true, true, true, true],
  );

  // ---- 用户直接关掉窗口（pagehide）：画面回到页内，继续后台播放，不重新加载、时间连续。
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`track()==='02 song.wav'&&!elOf('02 song.wav').paused`), 'song');
  await js(`mvCtx.media.stage.take(pq('.pip-screen'))`);
  await wait(() => js(`!!pq('.pip-screen audio')`), 'song in the window');
  await js(`watchLoads('02 song.wav')`);
  t0 = await js(`elOf('02 song.wav').currentTime`);
  await js(`W().close()`);
  await wait(() => js(`!W()&&mvCtx.media.stage.where()==='page'`), 'closed by the user');
  await delay(400);
  assert.deepEqual(
    await js(
      `[node('02 song.wav').contains(elOf('02 song.wav')),elOf('02 song.wav').paused,elOf('02 song.wav').currentTime>${t0},loads,mvCtx.media.stage.container]`,
    ),
    [true, false, true, 0, null],
    'Back in the page, still playing',
  );
  await showBar();
  await wait(() => js(`${H('pip')}.getAttribute('aria-pressed')==='false'`), 'entry released after closing');

  // ---- 另一个 MangaView 窗口再开画中画：浏览器关掉这个窗口的，这里收回画面、继续后台播放。
  await key('z', 'KeyZ', 90);
  await wait(() => js(`!!pq('.pip-screen audio')`), 'open again');
  const other = await cdp('Target.createTarget', { url: origin });
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const ws2 = new WebSocket(list.find((t) => t.id === other.targetId).webSocketDebuggerUrl);
  await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
  let id2 = 0;
  const pend2 = new Map();
  ws2.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pend2.has(m.id)) {
      pend2.get(m.id)(m.result);
      pend2.delete(m.id);
    }
  };
  const js2 = (expression) =>
    new Promise((resolve) => {
      pend2.set(++id2, (r) => resolve(r?.result?.value));
      ws2.send(
        JSON.stringify({
          id: id2,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
        }),
      );
    });
  for (let i = 0; i < 100 && !(await js2(`!!document.querySelector('#reader')&&document.readyState==='complete'`)); i++)
    await delay(100);
  assert.equal(
    await js2(`documentPictureInPicture.requestWindow({width:300,height:200}).then(()=>'ok',e=>e.name)`),
    'ok',
  );
  await wait(() => js(`!W()&&mvCtx.media.stage.where()==='page'`), 'the first window lost its picture-in-picture');
  await delay(300);
  assert.deepEqual(
    await js(`[node('02 song.wav').contains(elOf('02 song.wav')),elOf('02 song.wav').paused,loads]`),
    [true, false, 0],
    'Taken back, still playing',
  );
  ws2.close();
  await cdp('Target.closeTarget', { targetId: other.targetId });

  // ---- 主窗口刷新：画中画窗口随之关闭。
  await key('z', 'KeyZ', 90);
  await wait(isOpen, 'open before reload');
  await cdp('Page.reload');
  await wait(() => js(`!!window.mvCtx&&bookTitle.textContent==='Alpha'`), 'reloaded');
  assert.equal(await js('!!documentPictureInPicture.window'), false, 'Reloading closes it');

  // ---- 不支持的浏览器：不显示任何入口，Z 无作用，其余照常。
  await js(`sessionStorage.noPip='1'`);
  await cdp('Page.reload');
  await wait(() => js(`!!window.mvCtx&&bookTitle.textContent==='Alpha'`), 'reloaded without the API');
  assert.equal(await js('mvCtx.pip.supported'), false);
  await js(MEDIA_FIXTURES);
  await js(
    `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');`,
  );
  await showBar();
  assert.deepEqual(
    await js(`[...document.querySelectorAll('#filebar .fb-head-tools [data-head]')].map(b=>b.dataset.head)`),
    ['locate'],
  );
  assert.equal(await js(`document.querySelectorAll('#reader .mv-x[data-control="pip"]').length`), 0, 'No card button');
  await js('reader.focus()');
  await key('z', 'KeyZ', 90);
  await delay(200);
  assert.equal(await js('!!mvCtx.pip.window()'), false);
  await js(`delete sessionStorage.noPip`);

  assert.deepEqual(errors, []);
  console.log(
    'PASS: picture-in-picture: entries (file bar, audio card, Z; image only opens; again closes; hidden without the API), moving the picture without reload or pause, the placeholder both ways, clicks in the reader, list play / locate / remove (the last one stops), no stop or shuffle, scope / types synced with prefs (the old book value reads as the list), keys in the window, virtual list, layout at any size, closing by the user, by another window and by reloading',
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
