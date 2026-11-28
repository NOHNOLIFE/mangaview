// 画中画窗口（media/pip.mjs、media/pipview.mjs）：无头 Chrome 支持文档画中画，直接测真实窗口（打开要用户手势：真实的点击、按键，
// 或带 userGesture 的调用）；窗口里的按键用合成事件派发到画中画窗口；布局另把面板装进主文档里的普通容器，按不同尺寸断言。
// 框架同 tests/background.browser.mjs；独立临时配置 + OPFS 测试数据，音频、视频由 tests/media-fixtures.mjs 现场生成，不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from './chrome.mjs';
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
const chrome = launch(binary, profile, { autoplay: true });
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

  // ---- 入口：文件栏标题行的「画中画」（标题行右端只有它）；显示的是图片时只打开窗口（没有曲目时是一句说明），再按关闭。
  await js(`openBook('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha');
  assert.ok(await js(`toPage('01.svg')`));
  await showBar();
  assert.deepEqual(
    await js(`[...document.querySelectorAll('#filebar .fb-head-tools [data-head]')].map(b=>b.dataset.head)`),
    ['pip'],
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
  assert.equal(await js(`D().title===document.title`), true, 'Without a track the window title is the app name');
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
  assert.equal(await js(`D().title`), '02 song', 'The window title is the track name');
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
  await wait(() => js(`D().title==='04 clip'`), 'the window title follows the track');
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
  // 悬停显示文件详情框（建在画中画窗口的文档里），不设 title。列表完全显示（.revealed）之前不弹；
  // 淡入结束时指针仍在该项上，这时补弹（不需要再移动指针）。
  await delay(300);
  assert.deepEqual(
    await js(`[pq('.pip-side').classList.contains('revealed'),!!D().querySelector('.fc:popover-open')]`),
    [false, false],
    'No file card before the list is fully shown',
  );
  await js(
    `pq('.pip').dispatchEvent(new (W().PointerEvent)('pointermove',{bubbles:true,pointerType:'mouse',clientX:W().innerWidth-2,clientY:40}))`,
  );
  await wait(() => js(`pq('.pip-side').classList.contains('revealed')`), 'the list is fully shown');
  await wait(() => js(`!!D().querySelector('.fc:popover-open')`), 'file card in the window');
  assert.deepEqual(
    await js(
      `[D().querySelector('.fc .fc-name').textContent,rowOf('02 song.wav').title,!!document.querySelector('.fc:popover-open')]`,
    ),
    ['02 song.wav', '', false],
  );
  await js(`pq('.pip').dispatchEvent(new (W().PointerEvent)('pointerleave',{pointerType:'mouse'}))`);
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
  // 标题行的文件名（按钮，与文件栏同一表现）：点击即定位到当前曲目；完整路径在 title；没有单独的「定位」按钮。
  assert.deepEqual(
    await js(
      `(()=>{const b=pq('.pip-name > .name-btn'),s=W().getComputedStyle(b);return [b.tagName,b.title,s.cursor,s.userSelect,b.textContent,!!pq('[data-id="locate"]:not(.pip-ib)')];})()`,
    ),
    ['BUTTON', '05 b.wav', 'pointer', 'none', '05 b', false],
    'The name is a locate button',
  );
  await js(`pq('.pip-name > .name-btn').click()`);
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
    await js(
      `[...['prev','next','play'].map(id=>pq('[data-id="'+id+'"]').disabled),!!pq('.pip-name .name-btn'),D().title===document.title]`,
    ),
    [true, true, true, false, true],
    'Track buttons disabled without a track; no name, the app name as the title',
  );
  assert.equal(await isOpen(), true, 'Stopping does not close the window');
  assert.equal(await js(`!!pq('[data-id="stop"]')||!!pq('[data-id="shuffle"]')`), false, 'No stop or shuffle button');

  // ---- 循环范围、过滤：与偏好同步（本窗口、主窗口的接口、别的窗口改了偏好；旧值「本书」读作列表）。过滤的音频、视频、只含书签在「过滤」的弹出层里，
  // 有任何过滤生效时「过滤」显示为按下。
  const look = () =>
    js(
      `[(()=>{const b=pq('.pip-tools [data-id="scope"]');return b.dataset.scope+':'+b.querySelector('use').getAttribute('href')+':'+b.getAttribute('aria-label');})(),
        ...['audio','video','marked'].map(id=>pq('.pip-pop [data-id="'+id+'"]').getAttribute('aria-pressed')),pq('.pip-tools [data-id="filter"]').getAttribute('aria-pressed')]`,
    );
  assert.deepEqual(await look(), ['list:#i-loop-book:Loop: play list', 'false', 'false', 'false', 'false']);
  await js(`pq('.pip-tools [data-id="scope"]').click()`);
  await js(`pq('.pip-pop [data-id="audio"]').click()`);
  assert.deepEqual(await look(), ['books:#i-loop-books:Loop: across books', 'true', 'false', 'false', 'true']);
  assert.deepEqual(await js(`['playScope','playTypes'].map(k=>localStorage.getItem('mv2:'+k))`), [
    '"books"',
    '["audio"]',
  ]);
  await js(`mvCtx.media.queue.setScope('file');mvCtx.media.queue.setTypes([])`);
  await wait(
    async () => (await look()).join() === 'file:#i-loop-file:Loop: single file,false,false,false,false',
    'follows the API',
  );
  // 别的窗口写入偏好（storage 事件）。
  await js(
    `(()=>{const e=(k,v)=>{localStorage.setItem('mv2:'+k,v);window.dispatchEvent(new StorageEvent('storage',{key:'mv2:'+k,newValue:v,storageArea:localStorage}));};e('playTypes','["video"]');e('playScope','"book"');e('playMarked','true');})()`,
  );
  await wait(
    async () => (await look()).join() === 'list:#i-loop-book:Loop: play list,false,true,true,true',
    'follows other windows',
  );
  await js(`mvCtx.media.queue.setTypes([]);mvCtx.media.queue.setMarked(false)`);
  await wait(async () => (await look()).at(-1) === 'false', 'no filter');
  // 「过滤」悬停即在正上方弹出二级按钮（建在画中画窗口的文档里）；点二级按钮不收起；移开收起。
  const filterBtn = `pq('.pip-tools [data-id="filter"]')`;
  await js(`${filterBtn}.dispatchEvent(new (W().PointerEvent)('pointerenter',{pointerType:'mouse'}))`);
  await wait(() => js(`!!D().querySelector('.pip-pop:popover-open')`), 'the filter pop opens on hover');
  assert.deepEqual(
    await js(
      `(()=>{const p=pq('.pip-pop').getBoundingClientRect(),b=${filterBtn}.getBoundingClientRect();return [p.bottom<=b.top,[...pq('.pip-pop').children].map(x=>x.getAttribute('aria-label')+':'+x.querySelector('use').getAttribute('href'))];})()`,
    ),
    [true, ['Type: audio:#i-music', 'Type: video:#i-film', 'Only files with bookmarks:#i-bookmark']],
    'Above the button: audio, video, only with bookmarks',
  );
  await js(`pq('.pip-pop [data-id="marked"]').click()`);
  await shotPip('pip-window-filter');
  assert.deepEqual(
    await js(
      `[mvCtx.media.queue.marked,${filterBtn}.getAttribute('aria-pressed'),!!D().querySelector('.pip-pop:popover-open'),localStorage.getItem('mv2:playMarked')]`,
    ),
    [true, 'true', true, 'true'],
    'Only with bookmarks: the filter shows pressed, the pop stays',
  );
  await js(`pq('.pip-pop [data-id="marked"]').click()`);
  assert.equal(await js(`${filterBtn}.getAttribute('aria-pressed')`), 'false');
  await js(`${filterBtn}.dispatchEvent(new (W().PointerEvent)('pointerleave',{pointerType:'mouse'}))`);
  await wait(() => js(`!D().querySelector('.pip-pop:popover-open')`), 'the pop closes when the pointer leaves');
  // 只播放书签区段：与总控栏的开关是同一个偏好，图标、说明一致，两边同步。
  const cbSections = `document.querySelector('#controlbar [data-id="sections"]')`;
  const pipSections = `pq('.pip-tools [data-id="sections"]')`;
  assert.deepEqual(
    await js(
      `[${pipSections}.querySelector('use').getAttribute('href')===${cbSections}.querySelector('use').getAttribute('href'),${pipSections}.getAttribute('aria-label'),${cbSections}.getAttribute('aria-label'),${pipSections}.getAttribute('aria-pressed')]`,
    ),
    [true, 'Play bookmark sections only', 'Play bookmark sections only', 'false'],
  );
  await js(`${pipSections}.click()`);
  await wait(
    () => js(`mvCtx.transport.sectionsOnly&&${pipSections}.getAttribute('aria-pressed')==='true'`),
    'sections only from the window',
  );
  await showBar();
  await wait(() => js(`${cbSections}.getAttribute('aria-pressed')==='true'`), 'the control bar follows');
  await js(`mvCtx.transport.setSectionsOnly(false)`);
  await wait(() => js(`${pipSections}.getAttribute('aria-pressed')==='false'`), 'the window follows the control bar');

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
  assert.deepEqual(
    await js(
      `[pq('.pip-stage>.mv-hud').hidden,pq('.pip-stage>.mv-hud .mv-hud-bar').hidden,document.querySelector('body>.mv-hud').hidden]`,
    ),
    [false, false, true],
    'Volume hint with its bar in the window, not in the main window',
  );
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

  // ---- 列表项：书签标记位（缩略图的书签角标同一画法：书签图标，多于一个带数量，有区段书签时区段配色；没有书签留空位）、跨多本书时的书名小标题（也占一行）、被过滤的项弱化、当前曲目高亮。
  await js(
    `(async()=>{const {books}=await import('./src/core/books.mjs');const b=[...books.values()].find(b=>b.title==='Alpha');window.oldMarks=b.bookmarks;
      b.bookmarks=[{id:'pm1',name:'05 b.wav',t:0.5,at:1,label:'x'},{id:'pm3',name:'05 b.wav',t:1.5,at:4,label:'w'},{id:'pm2',name:'02 song.wav',t:0.2,at:2,label:'y',end:{name:'02 song.wav',t:1,at:3,label:'z'}}];
      (await import('./src/core/events.mjs')).emit('marks',b);})()`,
  );
  await wait(() => js(`rowOf('05 b.wav')?.querySelector('.pip-mk').dataset.marks==='mark:2'`), 'bookmark marks');
  const mk = () =>
    js(
      `['02 song.wav','04 clip.webm','05 b.wav'].map(n=>{const m=rowOf(n).querySelector('.pip-mk'),k=m.querySelector('.mk'),x=rowOf(n).querySelector('.mid-name').getBoundingClientRect();
        return [k?[...k.querySelectorAll('svg')].map(s=>s.querySelector('use').getAttribute('href')+(s.classList.contains('sec')?':sec':'')).join()+(k.querySelector('b')?'#'+k.querySelector('b').textContent:''):'',
          k?W().getComputedStyle(k.querySelector('svg')).color:'',Math.round(x.left-rowOf(n).getBoundingClientRect().left),k?W().getComputedStyle(k).backgroundColor:''];})`,
    );
  const marks = await mk();
  assert.deepEqual(
    marks.map((m) => m[0]),
    ['#i-bookmark:sec', '', '#i-bookmark#2'],
    'The thumbnail badge: a section in the section colour, a count above one, an empty slot without bookmarks',
  );
  assert.equal(marks[0][1], 'rgb(90, 180, 255)', 'Sections in the section colour');
  assert.notEqual(marks[2][1], marks[0][1]);
  assert.equal(marks[2][3], 'rgba(10, 10, 12, 0.85)', 'The badge style (bookmarks.css) in the window');
  assert.equal(new Set(marks.map((m) => m[2])).size, 1, 'Names line up with or without a mark');
  assert.equal(
    await js(
      `rowOf('05 b.wav').querySelector('.mk').outerHTML===document.querySelector('#preview .pv-mk[data-name="05 b.wav"] .mk')?.outerHTML`,
    ),
    true,
    'The same badge as on the thumbnail',
  );
  const over = (n) =>
    js(`rowOf('${n}').dispatchEvent(new (W().PointerEvent)('pointerover',{bubbles:true,pointerType:'mouse'}))`);
  // 「定位」「移除」叠在行的右端：文件名占满到行尾（不为按钮让出宽度），两个按钮紧挨、底色接近不透明。
  await over('05 b.wav');
  assert.deepEqual(
    await js(
      `(()=>{const r=rowOf('05 b.wav'),R=r.getBoundingClientRect(),n=r.querySelector('.mid-name').getBoundingClientRect(),a=r.querySelector('.pip-acts'),l=a.querySelector('[data-id="locate"]').getBoundingClientRect(),x=a.querySelector('[data-id="remove"]').getBoundingClientRect();
        return [Math.round(R.right-n.right)<=6,W().getComputedStyle(a).position,W().getComputedStyle(a).visibility,Math.round(x.left-l.right),Math.round(l.width),Math.round(R.right-x.right)<=4,W().getComputedStyle(a).backgroundImage.includes('gradient')];})()`,
    ),
    [true, 'absolute', 'visible', 0, 24, true, true],
    'Row buttons float over the right end of the row',
  );
  // 跨书：追加 Beta（不播放、不改当前曲目），每本书的项前一行书名小标题。
  const pos = (sel) => `Math.round(new (W().DOMMatrix)(W().getComputedStyle(${sel}).transform).m42/32)`;
  assert.equal(
    await js(
      `(async()=>{const {books}=await import('./src/core/books.mjs');return mvCtx.media.queue.addBook([...books.values()].find(b=>b.title==='Beta'));})()`,
    ),
    1,
  );
  await wait(() => js(`D().querySelectorAll('.pip-group').length===2`), 'book headings');
  assert.deepEqual(
    await js(
      `[[...D().querySelectorAll('.pip-group')].map(g=>${pos('g')}+':'+g.textContent),['02 song.wav','04 clip.webm','05 b.wav','02 tune.wav'].map(n=>${pos('rowOf(n)')}),rows().length,track()]`,
    ),
    [['0:Alpha', '4:Beta'], [1, 2, 3, 5], 4, '04 clip.webm'],
    'A heading row before each book',
  );
  // 被过滤的项弱化（仍可点），非当前项用正文颜色，当前曲目是强调色。
  const color = (n) => `W().getComputedStyle(rowOf('${n}')).color`;
  const plain = await js(color('05 b.wav'));
  await js(`mvCtx.media.queue.setTypes(['video'])`);
  await wait(() => js(`rowOf('05 b.wav').classList.contains('filtered')`), 'filtered');
  assert.deepEqual(
    await js(`[${color('05 b.wav')},${color('04 clip.webm')},rowOf('04 clip.webm').classList.contains('current')]`),
    ['rgb(109, 110, 120)', 'rgb(255, 154, 127)', true],
  );
  assert.equal(plain, 'rgb(237, 237, 240)', 'Other rows read clearly');
  await js(`mvCtx.media.queue.setTypes([])`);
  // 详情框带缩略图（只有画中画的列表）：音频是它的图，视频是缩略图栏的同一张画面（没有就在空闲时生成）。
  await js(`mvCtx.media.queue.playing()&&mvCtx.media.queue.toggle()`);
  await wait(() => js(`!mvCtx.media.queue.playing()`), 'paused');
  await over('05 b.wav');
  await wait(() => js(`!!D().querySelector('.fc:popover-open .fc-thumb > .mv-art')`), 'audio art in the card');
  await over('04 clip.webm');
  await wait(
    () => js(`!!D().querySelector('.fc:popover-open .fc-thumb > img.fc-frame')?.complete`),
    'video frame in the card',
  );
  assert.equal(await js(`D().querySelector('.fc:popover-open .fc-name').textContent`), '04 clip.webm');
  await shotPip('pip-window-card');
  assert.equal(await js(`!!document.querySelector('.fc .fc-thumb')`), false, 'Other file cards have no picture');
  await js(
    `D().querySelector('.pip-list').dispatchEvent(new (W().PointerEvent)('pointerleave',{pointerType:'mouse'}))`,
  );

  // ---- 收藏列表：标题行的按钮打开菜单；「保存当前列表」就地输入名称（默认名），已收藏的列表点击即载入并播放，可就地改名、删除。
  const favBtn = `pq('.pip-tools [data-id="fav"]')`,
    menuOpen = `!!D().querySelector('.pip-menu:popover-open')`;
  assert.deepEqual(
    await js(`[...D().querySelectorAll('.pip-head [data-id]')].map(b=>b.dataset.id+':'+b.getAttribute('aria-label'))`),
    ['pin:Pin the controls and the play list'],
    'Title row: the name, then only the pin',
  );
  await js(`${favBtn}.click()`);
  await wait(() => js(menuOpen), 'favorites menu');
  assert.deepEqual(
    await js(
      `(()=>{const m=pq('.pip-menu'),r=m.getBoundingClientRect();return [pq('.pip-menu-add').textContent,pq('.pip-menu-add').disabled,pq('.pip-menu-empty')?.textContent,r.left>=0&&r.top>=0&&r.right<=W().innerWidth&&r.bottom<=W().innerHeight];})()`,
    ),
    ['Save the current list', false, 'No saved lists yet', true],
  );
  await js(`pq('.pip-menu-add').click()`);
  await wait(() => js(`D().activeElement===pq('.pip-menu-name input')`), 'name input');
  assert.equal(await js(`pq('.pip-menu-name input').value`), 'Alpha and more (2 books)', 'Default name');
  await js(`pq('.pip-menu-name input').value='Mix';pq('.pip-menu-name').requestSubmit()`);
  await wait(() => js(`D().querySelectorAll('.pip-menu-row').length===1`), 'saved');
  await shotPip('pip-window-menu');
  assert.deepEqual(
    await js(
      `[pq('.pip-menu-row strong').textContent,pq('.pip-menu-row small').textContent,JSON.stringify(mvCtx.media.queue.favorites.list().map(f=>[f.name,f.count]))]`,
    ),
    ['Mix', '4 files', '[["Mix",4]]'],
  );
  // 载入：列表换成收藏的内容，从第一项开始播放，菜单收起。
  await js(`rowOf('05 b.wav').querySelector('[data-id="remove"]').click()`);
  await wait(() => js(`rows().length===3`), 'removed');
  await js(`pq('.pip-menu-load').click()`);
  await wait(
    () => js(`track()==='02 song.wav'&&mvCtx.media.queue.playing()&&rows().length===4&&!(${menuOpen})`),
    'loading plays the saved list',
  );
  // 改名（就地编辑）、删除。
  await js(`${favBtn}.click()`);
  await wait(() => js(menuOpen), 'menu again');
  await js(`pq('.pip-menu-row [aria-label="Rename"]').click()`);
  await wait(() => js(`pq('.pip-menu-name input')?.value==='Mix'`), 'rename in place');
  await js(`pq('.pip-menu-name input').value='Mix 2';pq('.pip-menu-name').requestSubmit()`);
  await wait(() => js(`pq('.pip-menu-row strong')?.textContent==='Mix 2'`), 'renamed');
  assert.equal(await js(`mvCtx.media.queue.favorites.list()[0].name`), 'Mix 2');
  await js(`pq('.pip-menu-row [aria-label="Delete"]').click()`);
  await wait(() => js(`!pq('.pip-menu-row')&&!!pq('.pip-menu-empty')`), 'deleted');
  assert.equal(await js(`mvCtx.media.queue.favorites.list().length`), 0);
  await js(`${favBtn}.click()`);
  await wait(() => js(`!(${menuOpen})`), 'the button closes the menu');

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

  // ---- 布局：装进普通容器（无头模式下画中画窗口的大小不受控制）。自上而下：内容区、标题行、操作面板；播放列表在右侧，默认收起。
  await js(`mvCtx.pip.close()`);
  await js(`openBook('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha again');
  assert.ok(await js(`toPage('04 clip.webm')`));
  await tap('#reader .page[data-name="04 clip.webm"]');
  await wait(() => js(`track()==='04 clip.webm'&&!elOf('04 clip.webm').paused`), 'clip');
  await js(
    `window.box=document.createElement('div');box.style.cssText='position:fixed;left:8px;top:8px;width:480px;height:480px;z-index:50;outline:1px solid red';document.body.append(box);window.view=mvCtx.pip.mount(box);mvCtx.media.stage.take(view.screen);`,
  );
  await js('view.ready.then(frame).then(frame)');
  const bq = (s) => `box.querySelector('${s}')`;
  const geo = () =>
    js(`(async()=>{await frame();await frame();const R=s=>{const r=box.querySelector(s).getBoundingClientRect();return [r.left-8,r.top-8,r.width,r.height].map(Math.round);};
      const st=s=>getComputedStyle(box.querySelector(s));
      return {stage:R('.pip-stage'),head:R('.pip-head'),line:R('.pip-line'),tools:R('.pip-tools'),dock:R('.pip-dock'),side:R('.pip-side'),
        sideOn:st('.pip-side').visibility==='visible',dockOn:st('.pip-dock').visibility==='visible',sideDocked:st('.pip-side').position!=='absolute'};})()`);
  let g = await geo();
  // 默认不固定：功能栏、列表都收起，内容区占满。
  assert.deepEqual(
    [g.stage, g.dockOn, g.sideOn, g.dock[1] + g.dock[3]],
    [[0, 0, 480, 480], false, false, 480],
    'Unpinned by default: the content fills the panel ' + JSON.stringify(g),
  );
  assert.deepEqual(await js(`[...${bq('.pip-tools')}.children].map(b=>b.dataset.id)`), [
    'prev',
    'next',
    'scope',
    'sections',
    'filter',
    'fav',
  ]);
  assert.equal(
    await js(`!!${bq('.pip-dock [data-id="locate"]')}||!!${bq('[data-id="list"]')}||!!${bq('[data-id="dock"]')}`),
    false,
  );
  // 指针移到下部：功能栏浮出（停留后淡入）。
  const move = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8 + x, y: 8 + y });
  await move(100, 470);
  await wait(async () => (await geo()).dockOn, 'the controls pop up at the bottom');
  // 三行共用同一个左右内边距：播放键、「上一个」与左边对齐；时间、「收藏列表」、「固定」与右边对齐；文件名在行的正中；
  // 「固定」比按钮行的按钮小一号，离上缘、右缘都是内边距。
  const align = () =>
    js(`(()=>{const R=s=>box.querySelector(s).getBoundingClientRect(),d=R('.pip-dock'),h=R('.pip-head'),n=R('.pip-name .name-btn'),p=R('.pip-pin'),pl=R('.pip-play'),pv=R('.pip-tools [data-id="prev"]'),fv=R('.pip-tools [data-id="fav"]'),fl=R('.pip-tools [data-id="filter"]'),tm=R('.pip-time'),sc=R('.pip-tools [data-id="sections"]');
      const r=Math.round;return {left:[pl.left-d.left,pv.left-d.left].map(r),right:[d.right-tm.right,d.right-fv.right,d.right-p.right].map(r),pinTop:r(p.top-d.top),pin:[r(p.width),r(p.height)],btn:[r(pl.width),r(pv.width),r(fv.width)],
        nameMid:Math.abs((n.left+n.right)/2-(h.left+h.right)/2)<1.5,gapRight:r(fv.left-fl.right),groups:fl.left-sc.right>40,bottom:r(d.bottom-fv.bottom)};})()`);
  let a = await align();
  assert.deepEqual(
    a,
    {
      left: [8, 8],
      right: [8, 8, 8],
      pinTop: 8,
      pin: [24, 24],
      btn: [32, 32, 32],
      nameMid: true,
      gapRight: 2,
      groups: true,
      bottom: 8,
    },
    'One padding for the three rows',
  );
  await shot('pip-panel-dock-peek');
  // 功能栏的高度范围内靠近右缘不弹出列表（功能栏最右的按钮点得到）；在上部靠近右缘才弹出。
  await move(470, 470);
  await delay(500);
  g = await geo();
  assert.deepEqual([g.dockOn, g.sideOn], [true, false], 'The right edge next to the controls does not open the list');
  await move(470, 200);
  await wait(async () => (await geo()).sideOn, 'the list floats out at the right edge');
  g = await geo();
  assert.deepEqual(
    [g.stage[2], g.side[0] + g.side[2], g.side[2], g.side[3], g.sideDocked],
    [480, 480, 220, 480, false],
  );
  // 「已完全显示」（.revealed）在淡入结束之后才成立。
  await wait(() => js(`${bq('.pip-side')}.classList.contains('revealed')`), 'revealed after the fade');
  await shot('pip-panel-list-peek');
  // 列表已浮出时，指针在列表上移动（包括功能栏的高度范围内）不收起。
  await move(360, 470);
  await delay(500);
  assert.ok((await geo()).sideOn, 'Stays while the pointer is on it');
  await move(100, 200);
  await wait(async () => !(await geo()).sideOn, 'folds away when the pointer leaves');
  assert.equal(await js(`${bq('.pip-side')}.classList.contains('revealed')`), false, 'Not revealed once it folds');
  // 「固定」：功能栏停靠在内容区下方、列表停靠在右侧（固定宽度），一起切换；状态记住。普通容器里不调整窗口大小。
  await js(
    `window.__resized=0;window.resizeBy=(()=>{const f=window.resizeBy;return (...a)=>{__resized++;return f.apply(window,a);};})()`,
  );
  await js(`${bq('.pip-pin')}.click()`);
  await wait(async () => (await geo()).sideDocked, 'pinned');
  g = await geo();
  assert.deepEqual(
    [
      g.sideOn,
      g.dockOn,
      g.side[2],
      g.side[0] + g.side[2],
      g.side[3],
      g.stage[2] + g.side[2],
      g.dock[2] === g.stage[2],
      g.head[1] === g.stage[3],
      g.line[1] === g.head[1] + g.head[3],
      g.tools[1] === g.line[1] + g.line[3],
      g.dock[1] + g.dock[3],
    ],
    [true, true, 220, 480, 480, 480, true, true, true, true, 480],
    'Pinned: the controls under the content, the list docked on the right ' + JSON.stringify(g),
  );
  assert.deepEqual(
    await js(
      `[${bq('.pip-pin')}.getAttribute('aria-pressed'),localStorage.getItem('mv2:pipPin'),__resized,${bq('.pip-side')}.classList.contains('revealed')]`,
    ),
    ['true', 'true', 0, true],
  );
  a = await align();
  assert.deepEqual([a.left, a.right, a.pinTop, a.nameMid], [[8, 8], [8, 8, 8], 8, true], 'Pinned rows line up too');
  await shot('pip-panel-pinned');
  // 取消固定：两者一起收起，内容区占满；指针在功能栏上时功能栏保持浮出，移开淡出。
  await move(100, 100);
  await js(`${bq('.pip-pin')}.click()`);
  await move(100, 110);
  await wait(async () => !(await geo()).dockOn, 'unpinned: the controls fade out');
  g = await geo();
  assert.deepEqual(
    [
      g.stage[3],
      g.stage[2],
      g.sideOn,
      await js(`[${bq('.pip-pin')}.getAttribute('aria-pressed'),localStorage.getItem('mv2:pipPin')].join()`),
    ],
    [480, 480, false, 'false,false'],
    'The content fills the panel',
  );
  await move(100, 470);
  await wait(async () => (await geo()).dockOn, 'up again');
  g = await geo();
  assert.deepEqual([g.dock[1] + g.dock[3], g.dock[1] > g.stage[1], g.stage[3]], [480, true, 480], 'Over the content');
  assert.equal(
    await js(`getComputedStyle(box.querySelector('.pip')).getPropertyValue('--dock-h')`),
    g.dock[3] + 'px',
    'Subtitles make room for the floating controls',
  );
  await move(100, 420);
  await delay(100);
  assert.ok((await geo()).dockOn, 'Stays while the pointer is on it');
  await move(100, 100);
  await wait(async () => !(await geo()).dockOn, 'fades out when the pointer leaves');
  // 快速划过不弹出（停留延迟）。
  await move(100, 470);
  await move(100, 100);
  await delay(300);
  assert.equal((await geo()).dockOn, false, 'Passing over quickly does not pop it up');
  await move(100, 470);
  await wait(async () => (await geo()).dockOn, 'up once more');
  await js(`${bq('.pip-pin')}.click()`);
  g = await geo();
  assert.deepEqual([g.dockOn, g.dock[1] === g.stage[3], g.sideDocked], [true, true, true], 'Pinned again');

  // ---- 内容区上横向拖动即快进 / 快退当前曲目（与主窗口同一套换算），提示显示在面板自己的浮层里。
  await js(`(()=>{const q=mvCtx.media.queue;q.play(q.items().find(i=>i.page.name==='04 clip.webm'));})()`);
  await wait(() => js(`track()==='04 clip.webm'&&mvCtx.media.queue.playing()`), 'the clip is the track');
  await js(`mvCtx.media.queue.toggle()`);
  await wait(() => js(`elOf('04 clip.webm').paused`), 'paused');
  await js(`elOf('04 clip.webm').currentTime=1`);
  await wait(() => js(`Math.abs(elOf('04 clip.webm').currentTime-1)<0.05`), 'at 1 s');
  await cdp('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    x: 8 + 100,
    y: 8 + 150,
  });
  for (let x = 100; x <= 180; x += 20)
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: 8 + x, y: 8 + 151 });
  await wait(() => js(`!${bq('.pip-stage>.mv-hud')}.hidden`), 'hint in the panel');
  assert.deepEqual(
    await js(`[${bq('.pip-stage>.mv-hud')}.textContent,document.querySelector('body>.mv-hud').hidden]`),
    ['+0:01 → 0:02', true],
    'The hint shows in the panel, not in the main window',
  );
  await cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    x: 8 + 180,
    y: 8 + 151,
  });
  await wait(() => js(`Math.abs(elOf('04 clip.webm').currentTime-2)<0.3`), 'dragging seeks');
  assert.equal(await js(`elOf('04 clip.webm').paused`), true, 'Dragging does not count as a click');
  await js(`mvCtx.media.queue.toggle()`);

  // ---- 不溢出：各种尺寸（固定 / 不固定的列表）；很窄时固定的列表也不停靠，很矮时依次收起按钮行、标题行。
  const fit = (w, h) =>
    js(`(async()=>{box.style.width='${w}px';box.style.height='${h}px';await frame();await frame();const b=box.getBoundingClientRect(),out=[];
      for(const el of box.querySelectorAll('*')){const r=el.getBoundingClientRect();if(!r.width&&!r.height)continue;if(el.closest('.pip-rows')&&!el.closest('.pip-list'))continue;
        const clip=el.closest('.pip-list');const c=clip&&el!==clip?clip.getBoundingClientRect():b;
        if(r.left<c.left-0.5||r.right>c.right+0.5||(!clip||el===clip)&&(r.top<c.top-0.5||r.bottom>c.bottom+0.5))out.push(el.className.baseVal??el.className);}
      const st=s=>getComputedStyle(box.querySelector(s));
      return {out:[...new Set(out)],docked:st('.pip-side').position!=='absolute',tools:st('.pip-tools').display!=='none',head:st('.pip-head').display!=='none'};})()`);
  for (const pinned of [false, true]) {
    if ((await js(`${bq('.pip-pin')}.getAttribute('aria-pressed')`)) !== String(pinned))
      await js(`${bq('.pip-pin')}.click()`);
    for (const [w, h] of [
      [480, 480],
      [420, 300],
      [300, 240],
      [240, 160],
      [200, 120],
      [160, 90],
      [600, 900],
    ]) {
      const f = await fit(w, h);
      assert.deepEqual(f.out, [], 'Nothing sticks out at ' + w + '×' + h + (pinned ? ' with the list pinned' : ''));
      assert.equal(f.docked, pinned && w >= 420, 'Docked list at ' + w);
      assert.deepEqual([f.tools, f.head], [h > 200, h > 140], 'Rows fold away at ' + w + '×' + h);
    }
  }
  await shot('pip-panel-600x900');
  await js(`${bq('.pip-pin')}.click()`);
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
  // 真实窗口里切换「固定」：在点击的手势里调用窗口的 resizeBy（宽加列表宽〔列表会停靠时〕、高加功能栏高，取消时减回），
  // 等窗口的 resize（或超时）再切换布局；被拒绝时照常切换、不报错。无头模式下窗口大小不受控，这里只断言调用与退回路径。
  const pipJs = async (expression) => {
    const t = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(
      (x) => x.type === 'page' && x.url === 'about:blank',
    );
    const w = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => w.addEventListener('open', r, { once: true }));
    const out = await new Promise((r) => {
      w.onmessage = ({ data }) => r(JSON.parse(data).result?.result?.value);
      w.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, userGesture: true, returnByValue: true, awaitPromise: true },
        }),
      );
    });
    w.close();
    return out;
  };
  await js(
    `window.__rz=[];(()=>{const w=W(),f=w.resizeBy;w.resizeBy=function(dw,dh){__rz.push([dw,dh,w.innerWidth,pq('.pip-dock').offsetHeight,navigator.userActivation&&w.navigator.userActivation.isActive]);return f.call(this,dw,dh);};})()`,
  );
  await pipJs(`document.querySelector('.pip-pin').click()`);
  await wait(() => js(`pq('.pip').classList.contains('pinned')`), 'pinned in the real window');
  let rz = await js('__rz');
  assert.equal(rz.length, 1, 'resizeBy once');
  assert.deepEqual(
    rz[0].slice(0, 2),
    [rz[0][2] + 220 >= 420 ? 220 : 0, rz[0][3]],
    'Grows by the list and the controls',
  );
  assert.equal(rz[0][4], true, 'Called within the click (user activation)');
  await pipJs(`document.querySelector('.pip-pin').click()`);
  await wait(() => js(`!pq('.pip').classList.contains('pinned')`), 'unpinned in the real window');
  rz = await js('__rz');
  assert.deepEqual(rz[1].slice(0, 2), [rz[1][2] >= 420 ? -220 : 0, -rz[1][3]], 'Shrinks back');
  // 浏览器拒绝调整：照常切换布局（内容区让出空间），不报错。
  await js(`W().resizeBy=()=>{throw new (W().DOMException)('no','NotAllowedError');}`);
  await js(`pq('.pip-pin').click()`);
  await wait(() => js(`pq('.pip').classList.contains('pinned')`), 'pinned without resizing');
  await js(`pq('.pip-pin').click()`);
  await wait(() => js(`!pq('.pip').classList.contains('pinned')`), 'unpinned without resizing');
  await js(`delete W().resizeBy`);

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

  // ---- 书架：含视频、音频的书的卡片上直接有「添加到播放列表」：追加整本书（不替换、不播放），提示追加了多少项（都已在列表里时也提示）。
  await addBook('Pics', `await mvMedia.write(d,'01.svg',svg(600,900,'#456'));`, '#bar [data-act="folder"]');
  await wait(() => js(`bookTitle.textContent==='Pics'`), 'Pics');
  await js(`openBook('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha for the shelf');
  assert.ok(await js(`toPage('02 song.wav')`));
  await tap('#reader .page[data-name="02 song.wav"] .mv-head');
  await wait(() => js(`track()==='02 song.wav'`), 'song for the shelf');
  await key('b', 'KeyB', 66);
  await wait(() => js('shelf.open'), 'shelf');
  await js(
    `window.cardOf=t=>[...document.querySelectorAll('#books .book')].find(c=>c.querySelector('.name')?.textContent===t)`,
  );
  const cardOf = (t) => `cardOf('${t}')`;
  await wait(() => js(`!!${cardOf('Beta')}&&!!${cardOf('Pics')}`), 'cards');
  assert.deepEqual(
    await js(`['Alpha','Beta','Many','Pics'].map(t=>!!cardOf(t).querySelector('.actions .queue-add'))`),
    [true, true, true, false],
    'Only books with video or audio',
  );
  assert.deepEqual(
    await js(
      `(()=>{const c=${cardOf('Beta')},b=c.querySelector('.queue-add'),more=c.querySelector('.actions .more');return [b.getAttribute('aria-label'),b.closest('[role=menu],#cardMenu')===null,Math.round(b.getBoundingClientRect().right)===Math.round(more.getBoundingClientRect().right),b.getBoundingClientRect().top>=more.getBoundingClientRect().bottom];})()`,
    ),
    ['Add to the play list', true, true, true],
    'On the card itself, below the four buttons',
  );
  const before = await js(`mvCtx.media.queue.items().map(i=>i.page.name).join()`);
  await js(`${cardOf('Beta')}.querySelector('.queue-add').click()`);
  await wait(() => js(`notice.textContent==='Added 1 files to the play list'`), 'added');
  assert.deepEqual(
    await js(`[mvCtx.media.queue.items().map(i=>i.page.name).join(),track(),shelf.open]`),
    [before + ',02 tune.wav', '02 song.wav', true],
    'Appended; nothing else changes',
  );
  await js(`${cardOf('Beta')}.querySelector('.queue-add').click()`);
  await wait(() => js(`notice.textContent==='All of them are already in the play list'`), 'already there');
  await key('Escape', 'Escape', 27);
  await wait(() => js('!shelf.open'), 'shelf closed');

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
    [],
  );
  assert.equal(await js(`document.querySelectorAll('#reader .mv-x[data-control="pip"]').length`), 0, 'No card button');
  await key('b', 'KeyB', 66);
  await wait(() => js('shelf.open&&document.querySelectorAll("#books .book").length>0'), 'shelf without the API');
  assert.equal(await js(`document.querySelectorAll('#books .queue-add').length`), 0, 'No add-to-list button');
  await key('Escape', 'Escape', 27);
  await js('reader.focus()');
  await key('z', 'KeyZ', 90);
  await delay(200);
  assert.equal(await js('!!mvCtx.pip.window()'), false);
  await js(`delete sessionStorage.noPip`);

  assert.deepEqual(errors, []);
  console.log(
    'PASS: picture-in-picture: entries (file bar, audio card, Z; image only opens; again closes; hidden without the API), moving the picture without reload or pause, the placeholder both ways, clicks in the reader, list play / locate / remove (the last one stops), no stop or shuffle, scope / filters synced with prefs (the old book value reads as the list) with the filter pop, sections-only shared with the control bar, keys in the window, bookmark marks, book headings, dimmed filtered rows, file card with a thumbnail, saved lists (save with the default name, load, rename, delete), virtual list, layout (title row and controls, pinned / floating controls and list), sideways drag seeking in the panel, nothing sticks out at any size, the add-to-list button on shelf cards, closing by the user, by another window and by reloading',
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
