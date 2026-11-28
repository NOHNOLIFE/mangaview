// 主窗口的播放（media/shell.mjs、track.mjs、driver.mjs）：视频全屏跟随当前曲目（含别的书里的视频），文件栏对暂停的当前曲目的释放规则
// （空格、长按 D 随之作用于视窗中心的文件），画面在外部容器时页内占位的那一帧 / 缩略图与点击，显示位置跟随上一次的明确选择，字幕字号。
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
if (!binary) throw Error('Usage: node tests/playback.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-playback-'));
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
  // Alpha：图、视频、高图、视频、音频、很高的图、视频（排在最后，测试前段从不进入视窗）。Beta：图、视频。
  await addBook(
    'Alpha',
    `const v=await mvMedia.webm({seconds:6,width:320,height:180});
    await mvMedia.write(d,'01.svg',svg(600,900,'teal'));await mvMedia.write(d,'02 clip.webm',v);
    await mvMedia.write(d,'03.svg',svg(600,2000,'#345'));await mvMedia.write(d,'04 film.webm',v);
    await mvMedia.write(d,'05 song.wav',mvMedia.wav({seconds:12}));await mvMedia.write(d,'06.svg',svg(600,4000,'#543'));
    await mvMedia.write(d,'07 late.webm',v);window.clipBlob=v;`,
    '#empty [data-act="folder"]',
  );
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha');
  await addBook(
    'Beta',
    `await mvMedia.write(d,'01.svg',svg(600,900,'#355'));await mvMedia.write(d,'02 other.webm',window.clipBlob);`,
    '#bar [data-act="folder"]',
  );
  await wait(() => js(`bookTitle.textContent==='Beta'`), 'Beta');
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.P=name=>mvCtx.player.list().find(p=>p.page.name===name)??null;
    window.elOf=name=>P(name)?.el??null;
    window.on=()=>[...document.querySelectorAll('video,audio')].filter(m=>!m.paused);
    window.track=()=>mvCtx.media.queue.track()?.page.name??null;
    window.bookOf=async t=>{const {books}=await import('./src/core/books.mjs');return [...books.values()].find(b=>b.title===t);};
    window.open=async t=>{const s=await import('./src/reader/session.mjs');s.select(await bookOf(t));};
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.fsCalls=0;(()=>{let fs=null;Object.defineProperty(Document.prototype,'fullscreenElement',{get:()=>fs,configurable:true});
      const change=()=>document.dispatchEvent(new Event('fullscreenchange'));
      Element.prototype.requestFullscreen=function(){fs=this;fsCalls++;setTimeout(change);return Promise.resolve();};
      Document.prototype.exitFullscreen=function(){fs=null;setTimeout(change);return Promise.resolve();};})();
    window.full=()=>document.querySelector('.page.media.mv-full');
    window.covers=n=>{const r=n.getBoundingClientRect(),e=document.elementFromPoint(innerWidth/2,innerHeight/3);return n.contains(e)&&r.width>=innerWidth-1&&r.height>=innerHeight-1;};`);
  const B = (id) => `document.querySelector('#controlbar [data-id="${id}"]')`;
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
      `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+Math.min(r.height/2,200)];})()`,
    );
    await click(x, y);
  };
  const page = (name) => '#reader .page[data-name="' + name + '"]';
  const playing = (name) =>
    wait(() => js(`track()===${JSON.stringify(name)}&&!elOf(${JSON.stringify(name)}).paused`), name + ' plays');

  // ---- B1 全屏跟随当前曲目：下一项是视频时全屏画面换成它（不重新请求页面全屏），是音频时退出全屏。
  await js(`open('Alpha')`);
  await wait(() => js(`bookTitle.textContent==='Alpha'`), 'Alpha again');
  await js(`${B('mode-mixed')}.click()`);
  assert.ok(await js(`toPage('01.svg')`));
  const top0 = await js('reader.scrollTop');
  assert.ok(await js(`toPage('02 clip.webm')`));
  await tap(page('02 clip.webm'));
  await playing('02 clip.webm');
  await js(`toPage('01.svg')`);
  await js(`mvCtx.media.fullscreen(P('02 clip.webm'))`);
  await wait(() => js(`full()===node('02 clip.webm')&&covers(full())`), 'clip fullscreen');
  await js(`mvCtx.media.queue.next()`);
  await wait(
    () => js(`track()==='04 film.webm'&&full()?.dataset.name==='04 film.webm'&&covers(full())`),
    'fullscreen follows to the next video',
  );
  assert.deepEqual(
    await js(
      `[document.querySelectorAll('.page.media.mv-full').length,full().contains(elOf('04 film.webm')),document.body.classList.contains('mv-fullvideo'),fsCalls,!!document.fullscreenElement]`,
    ),
    [1, true, true, 1, true],
    'Only the new video is fullscreen; the page fullscreen was not requested again',
  );
  await js(`mvCtx.media.queue.next()`);
  await wait(
    () => js(`track()==='05 song.wav'&&!full()&&!document.body.classList.contains('mv-fullvideo')`),
    'audio: fullscreen ends',
  );
  await wait(() => js(`!document.fullscreenElement`), 'page fullscreen left');
  await wait(() => js(`Math.abs(reader.scrollTop-${top0})<2`), 'back at the reading position');
  // 别的书里的视频：临时挂到阅读区里铺满显示，主窗口不切书；点击它播放 / 暂停（不翻屏）；退出后回到停放处、继续播放。
  await js(`mvCtx.media.queue.play({book:mvCtx.current,page:mvCtx.current.pages[1]})`);
  await playing('02 clip.webm');
  await js(`mvCtx.media.fullscreen(P('02 clip.webm'))`);
  await wait(() => js(`full()===node('02 clip.webm')`), 'clip fullscreen again');
  await js(`(async()=>{const b=await bookOf('Beta');mvCtx.media.queue.play({book:b,page:b.pages[1]});})()`);
  await wait(
    () => js(`track()==='02 other.webm'&&!!full()&&full().contains(elOf('02 other.webm'))&&covers(full())`),
    'a video from another book fills the screen',
  );
  assert.deepEqual(
    await js(`[bookTitle.textContent,full().parentNode===reader,full().classList.contains('selected'),fsCalls]`),
    ['Alpha', true, true, 2],
    'Shown on top of the reader; the book is not switched',
  );
  await playing('02 other.webm');
  {
    const [x, y] = await js(`[innerWidth*0.7,innerHeight/3]`);
    const before = await js('reader.scrollTop');
    await click(x, y);
    await wait(() => js(`elOf('02 other.webm').paused`), 'a click on it pauses it');
    assert.deepEqual(await js(`[!!full(),reader.scrollTop]`), [true, before], 'Still fullscreen, no page turn');
    await click(x, y);
    await playing('02 other.webm');
  }
  await js(`mvCtx.media.fullscreen(P('02 other.webm'))`);
  await wait(() => js(`!full()&&!document.fullscreenElement`), 'left');
  assert.deepEqual(
    await js(
      `[elOf('02 other.webm').parentNode.id,!elOf('02 other.webm').paused,reader.querySelectorAll(':scope>.page').length,bookTitle.textContent]`,
    ),
    ['mv-park', true, 0, 'Alpha'],
    'Leaving: parked again, still playing, nothing left over in the reader',
  );

  // ---- B3 文件栏的释放规则：暂停的当前曲目滚出视窗时文件栏回到视窗中心所在的页，空格开始自动滚动；回到它所在处又显示它。
  assert.ok(await js(`toPage('05 song.wav')`));
  await tap(page('05 song.wav') + ' .mv-head');
  await playing('05 song.wav');
  await js(`toPage('01.svg')`);
  await showBar();
  await wait(async () => (await fbName()) === '05 song', 'a playing track stays in the file bar');
  await js('reader.focus()');
  await key(' ', 'Space', 32);
  await wait(() => js(`elOf('05 song.wav').paused`), 'Space pauses the track shown in the file bar');
  await wait(async () => (await fbName()) === '01', 'paused and away: the file bar shows the centre page');
  assert.equal(await js('track()'), '05 song.wav', 'The track is not cancelled');
  const t5 = await js(`elOf('05 song.wav').currentTime`);
  await key('d', 'KeyD', 68, { hold: true });
  await delay(900);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
  assert.equal(await js(`elOf('05 song.wav').currentTime`), t5, 'Hold D does not seek the paused track away');
  await js(`${B('mode-comic')}.click()`);
  await key(' ', 'Space', 32);
  await wait(running, 'Space starts auto-scroll now');
  await key(' ', 'Space', 32);
  await wait(async () => !(await running()), 'stopped');
  assert.equal(await js(`elOf('05 song.wav').paused`), true, 'The paused track stays paused');
  await js(`${B('mode-mixed')}.click()`);
  await js(`mvCtx.media.queue.toggle()`);
  await wait(
    async () => (await fbName()) === '05 song',
    'playing again (as from picture-in-picture): back in the file bar',
  );
  await js(`mvCtx.media.queue.toggle()`);
  await wait(async () => (await fbName()) === '01', 'paused again');
  assert.ok(await js(`toPage('05 song.wav')`));
  await wait(async () => (await fbName()) === '05 song', 'back where the paused track is: shown again');

  // ---- B5 画面在外部容器时的页内占位：搬走那一刻的一帧（压暗）；从未在页内显示过的用它的缩略图；点占位只收回、不翻屏。
  await js(
    `window.box=document.createElement('div');box.style.cssText='position:fixed;right:0;top:0;width:320px;height:200px;z-index:50;background:#222';document.body.append(box)`,
  );
  assert.ok(await js(`toPage('02 clip.webm')`));
  await tap(page('02 clip.webm'));
  await playing('02 clip.webm');
  await wait(() => js(`elOf('02 clip.webm').readyState>=2&&elOf('02 clip.webm').currentTime>0.3`), 'frames');
  await js(`mvCtx.media.stage.take(box)`);
  const still =
    await js(`(()=>{const a=node('02 clip.webm').querySelector(':scope>.mv-away'),c=a?.querySelector(':scope>canvas.mv-still');if(!c)return null;
    const px=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data,t=a.querySelector('.mv-away-text'),r=a.getBoundingClientRect(),q=node('02 clip.webm').getBoundingClientRect();
    return {w:c.width,lit:px[0]+px[1]+px[2]>60,filter:getComputedStyle(c).filter,text:t.textContent,bg:getComputedStyle(t).backgroundColor,cover:Math.round(r.width)===Math.round(q.width)&&Math.round(r.height)===Math.round(q.height)};})()`);
  assert.deepEqual(
    still,
    {
      w: 320,
      lit: true,
      filter: 'brightness(0.4)',
      text: 'Playing in picture-in-pictureClick to show it here',
      bg: 'rgba(0, 0, 0, 0.82)',
      cover: true,
    },
    'The placeholder shows the frame of that moment, dimmed, under the text',
  );
  await shot('playback-away-frame');
  // 播放列表切到一个从未显示过的视频（画面留在外部）：占位用它已有的缩略图。
  await js(`(async()=>{const b=mvCtx.current,{thumbs}=await import('./src/core/store.mjs');
    await thumbs('put',{blob:new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="orange"/></svg>'],{type:'image/svg+xml'}),w:320,h:180,src:'auto'},b.id+':vt:07 late.webm');
    mvCtx.media.queue.play({book:b,page:b.pages[6]});})()`);
  await wait(
    () => js(`track()==='07 late.webm'&&box.querySelector('.mv-screen video')===elOf('07 late.webm')`),
    'never-shown video in the container',
  );
  assert.ok(await js(`toPage('07 late.webm')`));
  await wait(
    () => js(`node('07 late.webm')?.querySelector(':scope>.mv-away>img.mv-still')?.complete`),
    'its thumbnail under the placeholder',
  );
  assert.equal(await js(`!!node('07 late.webm').querySelector('canvas')`), false);
  await shot('playback-away-thumb');
  // 点占位：只收回画面，不翻屏、不暂停。
  const top7 = await js('reader.scrollTop');
  await tap(page('07 late.webm') + ' .mv-away');
  await wait(
    () => js(`mvCtx.media.stage.where()==='page'&&node('07 late.webm').contains(elOf('07 late.webm'))`),
    'back in the page',
  );
  await delay(300);
  assert.deepEqual(
    await js(`[reader.scrollTop,elOf('07 late.webm').paused]`),
    [top7, false],
    'No page turn, not paused',
  );

  // ---- B5 显示位置跟随上一次的明确选择：选了外部后，新的曲目（点击、空格）直接进外部，页内不显示；
  // 自动滚动播放的仍在页内，且不改变那个选择；点占位收回后新的曲目在页内，直到再次 take。
  await js(`mvCtx.media.stage.take(box)`);
  assert.ok(await js(`toPage('04 film.webm')`));
  await tap(page('04 film.webm'));
  await playing('04 film.webm');
  assert.deepEqual(
    await js(
      `[mvCtx.media.stage.where(),box.querySelector('.mv-screen video')===elOf('04 film.webm'),!!node('04 film.webm').querySelector(':scope>.mv-away')]`,
    ),
    ['out', true, true],
    'Clicking a new file: straight into the container',
  );
  await key(' ', 'Space', 32);
  await wait(() => js(`elOf('04 film.webm').paused`), 'paused');
  assert.ok(await js(`toPage('05 song.wav')`));
  await key(' ', 'Space', 32); // 暂停的视频不在视窗里：空格作用于视窗中心的音频
  await playing('05 song.wav');
  assert.equal(
    await js(`box.querySelector('.mv-screen audio')===elOf('05 song.wav')`),
    true,
    'Space on a new file: into the container too',
  );
  await key(' ', 'Space', 32);
  await wait(() => js(`elOf('05 song.wav').paused`), 'paused');
  assert.ok(await js(`toPage('02 clip.webm')`));
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(
    () => js(`track()==='02 clip.webm'&&mvCtx.media.queue.track().by==='scroll'&&!elOf('02 clip.webm').paused`),
    'auto-scroll plays the clip',
  );
  assert.deepEqual(
    await js(`[mvCtx.media.stage.where(),node('02 clip.webm').contains(elOf('02 clip.webm'))]`),
    ['page', true],
    'Auto-scroll plays in the page',
  );
  await key(' ', 'Space', 32);
  await wait(async () => !(await running()), 'auto-scroll stopped');
  assert.ok(await js(`toPage('05 song.wav')`));
  await tap(page('05 song.wav') + ' .mv-head');
  await playing('05 song.wav');
  assert.equal(
    await js(`box.querySelector('.mv-screen audio')===elOf('05 song.wav')`),
    true,
    'Auto-scroll did not change the choice',
  );
  await tap(page('05 song.wav') + ' .mv-away');
  await wait(() => js(`mvCtx.media.stage.where()==='page'`), 'brought back');
  assert.ok(await js(`toPage('04 film.webm')`));
  await tap(page('04 film.webm'));
  await playing('04 film.webm');
  assert.deepEqual(
    await js(
      `[mvCtx.media.stage.where(),node('04 film.webm').contains(elOf('04 film.webm')),box.querySelectorAll('.mv-screen').length]`,
    ),
    ['page', true, 0],
    'After bringing it back: new tracks play in the page',
  );
  await js(`mvCtx.media.stage.drop();box.remove()`);

  // ---- B6 字幕字号：视频（含全屏）与音频卡片约大 15%–20%，音频卡片仍是正好 3 行。
  const sizes =
    await js(`(()=>{const n=node('04 film.webm'),v=n.querySelector('.mv-subs'),c=document.createElement('div');c.className='mv-cue';c.textContent='x';v.append(c);
    const fv=parseFloat(getComputedStyle(c).fontSize);n.classList.add('mv-full');const ff=parseFloat(getComputedStyle(c).fontSize);n.classList.remove('mv-full');c.remove();
    return {fv,ff,vw:innerWidth/100};})()`);
  const old = { fv: Math.min(28, Math.max(14, 2.4 * sizes.vw)), ff: Math.min(44, Math.max(18, 3 * sizes.vw)) };
  for (const k of ['fv', 'ff']) {
    const r = sizes[k] / old[k];
    assert.ok(r >= 1.14 && r <= 1.21, k + ': ' + sizes[k] + ' vs ' + old[k]);
  }
  assert.ok(await js(`toPage('05 song.wav')`));
  const card = await js(
    `(()=>{const s=node('05 song.wav').querySelector('.mv-card>.mv-subs'),cs=getComputedStyle(s);return [parseFloat(cs.fontSize),parseFloat(cs.lineHeight),Math.round(s.getBoundingClientRect().height)];})()`,
  );
  assert.ok(
    card[0] / 14 >= 1.15 && card[0] / 14 <= 1.2 && card[2] === 3 * card[1],
    'Audio card: ' + JSON.stringify(card),
  );

  assert.deepEqual(errors, []);
  console.log(
    'PASS: playback in the main window: fullscreen follows the current track (next video, audio leaves, a video from another book), the file bar lets go of a paused track that leaves the view (Space, hold D, back again), the placeholder with the frame of that moment / the thumbnail, the placeholder only brings the picture back, the display position follows the last explicit choice (click, Space, auto-scroll stays in the page), larger subtitles',
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
