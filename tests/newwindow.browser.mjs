// 新窗口播放端到端：同一个临时浏览器配置里，原窗口按 Z、/ 或壳上的按钮打开新窗口。用浏览器级 CDP 连接自动附加到每个新窗口，
// 在它载入前注入记录用的脚本。只用 OPFS 里现场生成的测试图片、视频、音频（tests/media-fixtures.mjs），不使用任何真实文件。
// 浏览器是否拦截新窗口里的出声播放取决于环境（无头模式下通常放行），测试里按 Chrome 的默认规则模拟：页面没有过用户操作时，不静音的 play() 以 NotAllowedError 拒绝。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
import { popoutSize } from '../src/core/playlist.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/newwindow.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-newwindow-'));
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
async function wait(check, what = '', tries = 160) {
  let last;
  for (let i = 0; i < tries; i++) {
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
// 注入每个窗口：英文界面；记录列目录（验证新窗口不做启动时的全量检查）。切回窗口时检查当前书是另一项功能，这里不让窗口的 focus 事件干扰计数。
const HOOKS = `Object.defineProperty(navigator,'languages',{value:['en-US']});
  window.lists=[];for(const k of ['values','entries','keys']){const o=FileSystemDirectoryHandle.prototype[k];FileSystemDirectoryHandle.prototype[k]=function(...a){window.lists.push(this.name);return o.apply(this,a);};}
  {const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(!this.muted&&!navigator.userActivation.hasBeenActive)return Promise.reject(new DOMException('Blocked','NotAllowedError'));return play.call(this);};}
  {const add=window.addEventListener;window.addEventListener=function(type,...a){if(type==='focus')return;return add.call(this,type,...a);};}`;
const HELPERS = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
  window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
  window.el=name=>node(name)?.querySelector('video,audio');
  window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
    const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
    reader.scrollTop=want;await frame();}return false;};
  window.centred=name=>{const n=node(name);return !!n&&Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;};`;
let ws,
  id = 0;
const pending = new Map(),
  errors = [],
  pages = new Map(),
  popups = [];
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
// 一个窗口（flatten 模式下的一个会话）：cdp / js / 按键 / 鼠标。
function page(sessionId, info) {
  const cdp = (method, params = {}) => send(method, params, sessionId);
  const js = async (expression) => {
    const r = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const keys = { z: ['KeyZ', 90, 'z'], '/': ['Slash', 191, '/'], b: ['KeyB', 66, 'b'], v: ['KeyV', 86, 'v'] };
  const press = async (k) => {
    const [code, vk, text] = keys[k];
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
    await delay(30);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
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
  const shot = async (file) => {
    if (!process.env.MV_SHOTS) return;
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.MV_SHOTS, file + '.png'), Buffer.from(data, 'base64'));
  };
  return {
    sessionId,
    targetId: info.targetId,
    opener: info.openerId ?? null,
    cdp,
    js,
    press,
    click,
    tap,
    shot,
    ready: null,
  };
}
async function attached({ sessionId, targetInfo, waitingForDebugger }) {
  if (targetInfo.type !== 'page') {
    if (waitingForDebugger) await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    return;
  }
  const p = page(sessionId, targetInfo);
  pages.set(sessionId, p);
  p.ready = (async () => {
    await p.cdp('Runtime.enable');
    await p.cdp('Page.enable');
    await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: HOOKS });
    if (waitingForDebugger) await p.cdp('Runtime.runIfWaitingForDebugger');
  })();
  await p.ready;
  if (p.opener) popups.push(p);
}
const byTarget = (targetId) => wait(() => [...pages.values()].find((p) => p.targetId === targetId), 'target attached');
const booted = (p) =>
  wait(
    () =>
      p.js(
        'document.readyState==="complete"&&!!document.querySelector("#bookTitle")&&document.querySelector("#bookTitle").textContent!=="MangaView"',
      ),
    'booted',
  );
const close = (p) => send('Target.closeTarget', { targetId: p.targetId });
try {
  const port = await wait(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const { webSocketDebuggerUrl } = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(Error(m.error.message));
      else p.resolve(m.result);
      return;
    }
    if (m.method === 'Target.attachedToTarget') attached(m.params).catch((e) => errors.push(String(e)));
    else if (m.method === 'Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const A = await wait(() => [...pages.values()].find((p) => !p.opener), 'first window');
  await A.ready;
  await A.cdp('Page.navigate', { url: origin });
  await wait(() => A.js('document.querySelector("#empty")?.hidden===false'), 'welcome');
  await A.js(MEDIA_FIXTURES);
  await A.js(HELPERS);
  // 自动播放不插手（新窗口播放不看这个设置）。
  await A.js(`localStorage.setItem('mv2:autoplay','false')`);
  const svg = (c, w = 600, h = 900) =>
    `new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${c}"/></svg>'],{type:'image/svg+xml'})`;
  await A.js(`(async()=>{const root=await navigator.storage.getDirectory();
    const other=await root.getDirectoryHandle('Other',{create:true});for(const i of [1,2,3])await mvMedia.write(other,i+'.svg',${svg('teal')});
    const clips=await root.getDirectoryHandle('Clips',{create:true});
    await mvMedia.write(clips,'01.svg',${svg('orange')});await mvMedia.write(clips,'02 clip.webm',await mvMedia.webm({seconds:3,width:320,height:180}));
    await mvMedia.write(clips,'03 song.wav',mvMedia.wav({seconds:14}));await mvMedia.write(clips,'04.svg',${svg('navy')});
    window.showDirectoryPicker=async()=>other;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => A.js(`bookTitle.textContent==='Other'`), 'import Other');
  await A.js(
    `(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('Clips');window.showDirectoryPicker=async()=>d;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
  );
  await wait(() => A.js(`bookTitle.textContent==='Clips'`), 'import Clips');
  await A.js('reader.focus()');
  // 无头模式不按 window.open 的尺寸参数开窗，这里记下传给它的参数来检查窗口大小。
  const recordOpens = () =>
    A.js('window.open=function(...a){window.opens.push(a.slice(1).join("|"));return window.realOpen.apply(this,a);}');
  await A.js('window.realOpen=window.open;window.opens=[]');
  await recordOpens();

  // 对照：普通方式打开的新窗口启动时检查当前书的文件夹（列目录）。
  const { targetId: plain } = await send('Target.createTarget', { url: 'about:blank' });
  const B = await byTarget(plain);
  await B.ready;
  await B.cdp('Page.navigate', { url: origin });
  await booted(B);
  await wait(async () => (await B.js('window.lists')).includes('Clips'), 'a normal window checks its book at startup');
  await close(B);
  await wait(
    async () => !(await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).some((t) => t.id === plain),
    'B closed',
  );

  // ---- Z：新窗口定位到同一本书的同一个媒体，从当前时间继续；原窗口的它暂停。新窗口里没有用户操作，出声播放被拦下：提示，停在该处等待点击。
  assert.ok(await A.js(`toPage('03 song.wav')`));
  await A.tap('#reader .page[data-name="03 song.wav"] .mv-play');
  await wait(() => A.js(`!el('03 song.wav').paused&&el('03 song.wav').currentTime>1.5`), 'playing in A');
  await A.js('reader.focus()');
  await A.press('z');
  const P = await wait(() => popups[0], 'new window opened');
  const tA = await wait(() => A.js(`el('03 song.wav').paused&&el('03 song.wav').currentTime`), 'paused in A');
  await booted(P);
  await P.js(HELPERS);
  assert.equal(await P.js('bookTitle.textContent'), 'Clips', 'Same book');
  assert.equal(await P.js('location.search'), '', 'The address is tidied up');
  await wait(() => P.js(`el('03 song.wav')?.readyState>=1&&centred('03 song.wav')`), 'the media is in view');
  await wait(
    () =>
      P.js(`document.getElementById('notice').textContent==='The browser blocked playback with sound — click to play'`),
    'blocked-sound notice',
  );
  assert.equal(await P.js(`el('03 song.wav').paused`), true, 'Waits for a click');
  await wait(() => P.js(`Math.abs(el('03 song.wav').currentTime-${tA})<.1`), 'Stops at the time it continued from');
  const sz = popoutSize('audio', {}, await A.js('({availWidth:screen.availWidth,availHeight:screen.availHeight})'));
  assert.deepEqual(
    await A.js('window.opens'),
    ['_blank|popup,width=' + sz.width + ',height=' + sz.height],
    'Opens as a smaller window: ' + JSON.stringify(sz),
  );
  await P.shot('newwindow-blocked');
  await P.tap('#reader .page[data-name="03 song.wav"] .mv-play');
  await wait(
    () => P.js(`!el('03 song.wav').paused&&el('03 song.wav').currentTime>${tA}`),
    'plays after the click, from where it left off',
  );
  assert.equal(await P.js(`document.getElementById('notice').textContent`), '', 'The hint goes away once playing');
  // 新窗口不做启动时的全量检查（连当前书也不列目录）。
  await delay(1500);
  assert.deepEqual(await P.js('window.lists'), [], 'No startup check in the new window');
  assert.equal(await A.js(`el('03 song.wav').paused`), true, 'Stays paused in the original window');
  await close(P);

  // ---- 总控栏上的按钮；静音时浏览器允许自动播放：新窗口直接接着播。
  const openBar = async (W) => {
    const h = await W.js('innerHeight');
    await W.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: h / 2 });
    await W.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: h - 3 });
    await wait(() => W.js('!controlbar.hidden'), 'control bar');
    await delay(250);
  };
  await openBar(A);
  await A.tap('#controlbar [data-id="volume"]');
  await wait(() => A.js(`localStorage.getItem('mv2:muted')==='true'`), 'muted');
  assert.ok(await A.js(`toPage('02 clip.webm')`));
  await A.tap('#reader .page[data-name="02 clip.webm"] .mv-play');
  await wait(() => A.js(`!el('02 clip.webm').paused&&el('02 clip.webm').currentTime>.6`), 'video playing in A');
  assert.equal(
    await A.js(`!node('02 clip.webm').querySelector('[data-control="popout"]')`),
    true,
    'The button is on the control bar, not on the panel',
  );
  assert.equal(
    await A.js(`document.querySelector('#controlbar [data-id="popout"]').getAttribute('aria-label')`),
    'Play in a new window',
  );
  await openBar(A);
  await A.tap('#controlbar [data-id="popout"]');
  const Q = await wait(() => popups[1], 'second new window');
  const tV = await wait(() => A.js(`el('02 clip.webm').paused&&el('02 clip.webm').currentTime`), 'video paused in A');
  await booted(Q);
  await Q.js(HELPERS);
  await wait(
    () => Q.js(`!!el('02 clip.webm')&&!el('02 clip.webm').paused&&el('02 clip.webm').currentTime>=${tV - 0.05}`),
    'plays on in the new window by itself',
  );
  assert.ok(await Q.js(`centred('02 clip.webm')`));
  await openBar(Q);
  assert.deepEqual(
    await Q.js(`[!controlbar.hidden,controlbar.contains(filebar),!!controlbar.querySelector('[data-id="play"]')]`),
    [true, true, true],
    'The new window has the control bar too (with the file bar row)',
  );
  const vs = popoutSize(
    'video',
    { w: 320, h: 180 },
    await A.js('({availWidth:screen.availWidth,availHeight:screen.availHeight})'),
  );
  assert.equal(
    (await A.js('window.opens'))[1],
    '_blank|popup,width=' + vs.width + ',height=' + vs.height,
    'Video window follows the frame ratio: ' + JSON.stringify(vs),
  );
  await Q.shot('newwindow-video');
  await close(Q);
  await openBar(A);
  await A.tap('#controlbar [data-id="volume"]');
  await wait(() => A.js(`localStorage.getItem('mv2:muted')==='false'`), 'unmuted');

  // ---- 浏览器拦截弹窗：提示，原窗口照常播放。
  await A.js('window.open=()=>null');
  assert.ok(await A.js(`toPage('03 song.wav')`));
  await A.tap('#reader .page[data-name="03 song.wav"] .mv-play');
  await wait(() => A.js(`!el('03 song.wav').paused`), 'playing again');
  await A.js('reader.focus()');
  await A.press('z');
  await wait(
    () =>
      A.js(
        `document.getElementById('notice').textContent==='The browser blocked the new window — allow pop-ups for this site and try again'`,
      ),
    'pop-up blocked notice',
  );
  await delay(300);
  assert.equal(await A.js(`el('03 song.wav').paused`), false, 'Keeps playing when the window was blocked');
  await recordOpens();
  await A.tap('#reader .page[data-name="03 song.wav"] .mv-play');
  await wait(() => A.js(`el('03 song.wav').paused`));

  // ---- 没有当前媒体时无功能。
  await A.js('reader.scrollTop=0');
  await delay(200);
  await A.js('reader.focus()');
  await A.press('z');
  await delay(800);
  assert.equal(popups.length, 2, 'No current media: nothing opens');

  // ---- / 在书架页和全屏界面里仍是聚焦搜索框，不打开新窗口。
  await A.press('b');
  await wait(() => A.js('shelf.open'), 'shelf');
  await A.press('/');
  await wait(() => A.js(`document.activeElement?.id==='query'`), '/ focuses the shelf search');
  await A.js('shelf.close()');
  await A.js('reader.focus()');
  await A.press('v');
  await wait(() => A.js(`document.getElementById('overview').open`), 'overview');
  await delay(300);
  await A.press('/');
  await wait(
    () => A.js(`document.activeElement?.tagName==='INPUT'&&!!document.activeElement.closest('#overview')`),
    '/ focuses the full-screen search',
  );
  await A.js(`document.getElementById('overview').close()`);
  await delay(500);
  assert.equal(popups.length, 2, '/ in the shelf and full-screen views opens no window');
  // 阅读时 / 与 Z 相同：作用于当前媒体（暂停中的也算）。
  assert.ok(await A.js(`toPage('03 song.wav')`));
  await A.js('reader.focus()');
  await A.press('/');
  const R = await wait(() => popups[2], '/ opens a new window');
  await booted(R);
  await wait(
    () => R.js(`!!document.querySelector('#reader .page[data-name="03 song.wav"] audio')`),
    'same media in the third window',
  );
  await close(R);

  assert.deepEqual(errors, []);
  console.log(
    'PASS: Z, / and the control bar button open a smaller window on the same media continuing from the current time while the original pauses; blocked sound waits for a click with a hint; blocked pop-ups keep playing with a hint; no startup check in the new window; no current media does nothing; / still searches in the shelf and full-screen views',
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
