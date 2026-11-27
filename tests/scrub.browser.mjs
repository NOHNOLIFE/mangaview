// 横向拖动快进 / 快退（src/media/scrub.mjs、src/core/scrub.mjs，经 src/ui/dragscroll.mjs 接入）：视频画面、音频卡片的字幕区上横向拖动，
// 松手定位、拖动中显示整秒的偏移与目标时间、不滚动不触发点击、Esc 取消、超出时长时截断；竖向拖动照常滚动；全屏的视频竖向拖动什么也不做。
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
if (!binary) throw Error('Usage: node tests/scrub.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-scrub-'));
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
    '--window-size=1280,900',
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
  const size = (width, height = 900) =>
    cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(1280);
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','false');`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    window.toPage=async(name,f=0.5)=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight*f-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight*f-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.box=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    window.look=name=>{const n=node(name),v=n.querySelector('video'),c=n.querySelector('.mv-card'),big=n.querySelector('.mv-big'),a=c?.querySelector('.mv-art');
      return {selected:n.classList.contains('selected'),playing:n.classList.contains('playing'),dim:getComputedStyle(v??c).filter,
        art:a?getComputedStyle(a).filter:null,big:big?getComputedStyle(big).opacity:null,bigShown:big?getComputedStyle(big).display!=='none':false,
        after:getComputedStyle(n,'::after').content,outline:getComputedStyle(n).outlineStyle,ring:c?getComputedStyle(c).boxShadow:null,
        border:c?getComputedStyle(c).borderTopColor:null,shell:!!n.querySelector('.mv-shell')&&!c,title:!!n.querySelector('.mv-title'),
        controls:n.querySelectorAll(':scope>.mv-shell,:scope>.mv-title,:scope>.mv-pop').length};};`);
  // 一本书：图片、视频（8 秒）、音频（9 秒，没有字幕）、图片。
  const CLIP = '02 clip.webm',
    SONG = '03 song.wav';
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Bar',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(dir,'01.svg',svg(600,900,'teal'));
    await mvMedia.write(dir,'02 clip.webm',await mvMedia.webm({seconds:8,width:640,height:360}));
    await mvMedia.write(dir,'03 song.wav',mvMedia.wav({seconds:9}));
    await mvMedia.write(dir,'04.svg',svg(600,900,'purple'));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`!!document.querySelector('#reader .page[data-name="01.svg"]')`), 'book opened');
  const showBar = async (on = true) => {
    await wait(() => js(`!controlbar.classList.contains('leaving')`), 'fade finished');
    if ((await js('!controlbar.hidden')) !== on) await key('t', 'KeyT', 84);
    await wait(
      () =>
        js(`!controlbar.hidden===${on}&&!controlbar.classList.contains('leaving')&&!controlbar.getAnimations().length`),
      'control bar ' + on,
    );
    await js('frame()');
  };

  const hud = () =>
    js(
      `(()=>{const h=document.querySelector('.mv-hud');return h&&!h.hidden?h.querySelector('.mv-hud-text').textContent:null;})()`,
    );
  const mouse = (type, x, y) =>
    cdp('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  // 按下 (x, y)，依次移到各偏移（每步一帧），记下每步的提示文字；release=false 时不松手。
  const drag = async (x, y, moves, release = true) => {
    await mouse('mousePressed', x, y);
    const texts = [];
    for (const [dx, dy] of moves) {
      await mouse('mouseMoved', x + dx, y + dy);
      await js('frame()');
      texts.push(await hud());
    }
    if (release) await mouse('mouseReleased', x + moves.at(-1)[0], y + moves.at(-1)[1]);
    return texts;
  };
  const path = (dx, dy = 0, n = 12) => Array.from({ length: n }, (_, i) => [(dx * (i + 1)) / n, (dy * (i + 1)) / n]);
  const mid = (name, sel = '') =>
    js(
      `(()=>{const n=node(${JSON.stringify(name)}),e=${sel ? `n.querySelector(${JSON.stringify(sel)})` : 'n'},r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,n.getBoundingClientRect().width];})()`,
    );
  const ready = (name) =>
    wait(
      () => js(`el(${JSON.stringify(name)})?.readyState>=1&&el(${JSON.stringify(name)}).duration>0`),
      name + ' metadata',
    );
  const at = (name, t) =>
    wait(() => js(`Math.abs(el(${JSON.stringify(name)}).currentTime-${t})<0.05`), name + ' at ' + t);
  const WHOLE = /^[+−]\d+:\d\d → \d+:\d\d$/;

  // ---- 视频画面上横向拖动：拖动中只显示提示（整秒），不定位、不滚动；松手定位；没有触发点击（不播放）。
  // 8 秒的视频：拖过整个画面宽度 ≈ 时长的 1/4、至少 30 秒、不超过时长 → 8 秒；拖 2.2 / 8 的宽度即 +2 秒。
  await js(`toPage(${JSON.stringify(CLIP)})`);
  await ready(CLIP);
  await js(`el(${JSON.stringify(CLIP)}).currentTime=1`);
  await at(CLIP, 1);
  let [x, y, w] = await mid(CLIP);
  const top = await js('reader.scrollTop');
  let texts = await drag(x, y, path((w * 2.2) / 8, 3), false);
  assert.ok(
    texts.filter(Boolean).every((s) => WHOLE.test(s)),
    'Whole seconds only: ' + JSON.stringify(texts),
  );
  assert.equal(texts.at(-1), '+0:02 → 0:03');
  assert.equal(new Set(texts.filter(Boolean)).size <= 3, true, 'Steps up second by second: ' + JSON.stringify(texts));
  assert.equal(await js(`el(${JSON.stringify(CLIP)}).currentTime`), 1, 'No seek while dragging');
  assert.equal(await js('reader.scrollTop'), top, 'No scrolling');
  await shot('scrub-video');
  await mouse('mouseReleased', x + (w * 2.2) / 8, y + 3);
  await at(CLIP, 3);
  await delay(400);
  assert.equal(await js(`el(${JSON.stringify(CLIP)}).paused`), true, 'No click: not played');
  assert.equal(await js('reader.scrollTop'), top, 'No fling');
  await wait(() => js(`document.querySelector('.mv-hud').hidden`), 'hint hides after release');
  // 向左：−2 秒。
  texts = await drag(x, y, path((-w * 2.2) / 8, -2));
  assert.equal(texts.at(-1), '−0:02 → 0:01');
  await at(CLIP, 1);

  // ---- 超出时长截断；Esc 取消（不定位，提示收起），松手也不定位、不播放。
  texts = await drag(x, y, path(w * 3, 0, 20), false);
  assert.equal(texts.at(-1), '+0:07 → 0:08', 'Clamped to the duration');
  await key('Escape', 'Escape', 27);
  await wait(() => js(`document.querySelector('.mv-hud').hidden`), 'Esc hides the hint');
  await mouse('mouseMoved', x + w * 3 - 20, y);
  assert.equal(await hud(), null, 'Cancelled: no hint any more');
  await mouse('mouseReleased', x + w * 3 - 20, y);
  await delay(400);
  assert.deepEqual(
    await js(`[el(${JSON.stringify(CLIP)}).currentTime,el(${JSON.stringify(CLIP)}).paused]`),
    [1, true],
    'Esc cancels',
  );
  assert.equal(await js('reader.scrollTop'), top);

  // ---- 竖向拖动视频照常滚动正文，不定位。
  await drag(x, y, path(4, -240));
  assert.ok((await js('reader.scrollTop')) > top + 150, 'Vertical drag scrolls');
  assert.equal(await js(`el(${JSON.stringify(CLIP)}).currentTime`), 1, 'No seek');
  assert.equal(await hud(), null);

  // ---- 音频卡片的字幕区（没有字幕时是空白区）：同样横向拖动定位；9 秒的音频：拖 3.2 / 9 个卡片宽即 +3 秒。
  await js(`toPage(${JSON.stringify(SONG)})`);
  await ready(SONG);
  await js(`el(${JSON.stringify(SONG)}).currentTime=1`);
  await at(SONG, 1);
  [x, y, w] = await mid(SONG, '.mv-subs');
  texts = await drag(x, y, path((w * 3.2) / 9, 2));
  assert.equal(texts.at(-1), '+0:03 → 0:04');
  await at(SONG, 4);
  await delay(300);
  assert.equal(await js(`el(${JSON.stringify(SONG)}).paused`), true, 'No click on the card');
  // 卡片的其他地方（文件名）不接手：横向拖动不定位。
  await wait(() => js(`document.querySelector('.mv-hud').hidden`), 'hint hides');
  const [hx, hy] = await mid(SONG, '.mv-head');
  texts = await drag(hx, hy, path(120, 0));
  assert.deepEqual(
    [texts.filter(Boolean).length, await js(`el(${JSON.stringify(SONG)}).currentTime`)],
    [0, 4],
    'Only the subtitle area seeks',
  );
  await js('getSelection().removeAllRanges()');

  // ---- 全屏的视频：横向拖动定位，竖向拖动什么也不做（不滚动背后的正文）。
  // 无头浏览器不允许真正进入全屏：替换成立即生效的模拟。
  await js(`(()=>{let fs=null;Object.defineProperty(Document.prototype,'fullscreenElement',{get:()=>fs,configurable:true});
    const change=()=>document.dispatchEvent(new Event('fullscreenchange'));
    Element.prototype.requestFullscreen=function(){fs=this;setTimeout(change);return Promise.resolve();};
    Document.prototype.exitFullscreen=function(){fs=null;setTimeout(change);return Promise.resolve();};})()`);
  await js(`toPage(${JSON.stringify(CLIP)})`);
  await ready(CLIP);
  await js(`el(${JSON.stringify(CLIP)}).currentTime=1`);
  await at(CLIP, 1);
  await showBar();
  {
    const [mx, my] = await center('#filebar .fb-more');
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my });
  }
  await wait(() => js(`filebar.querySelector('.fb-more-pop').matches(':popover-open')`), '⋯ opens');
  await tap('#filebar [data-slot="full"]');
  await wait(() => js(`node(${JSON.stringify(CLIP)}).classList.contains('mv-full')`), 'fullscreen');
  await js('frame().then(frame)');
  const fullTop = await js('reader.scrollTop');
  [x, y, w] = await mid(CLIP);
  y = Math.min(y, 300); // 避开底缘的文件栏与总控栏
  await drag(x, y, path(3, -260));
  await delay(300);
  assert.deepEqual(
    [await js('reader.scrollTop'), await js(`el(${JSON.stringify(CLIP)}).currentTime`), await hud()],
    [fullTop, 1, null],
    'Vertical drag in fullscreen does nothing',
  );
  texts = await drag(x, y, path((w * 1.2) / 8, 2));
  assert.equal(texts.at(-1), '+0:01 → 0:02');
  await at(CLIP, 2);
  assert.equal(await js('reader.scrollTop'), fullTop);
  assert.equal(await js(`node(${JSON.stringify(CLIP)}).classList.contains('mv-full')`), true, 'Still fullscreen');
  await shot('scrub-fullscreen');

  assert.deepEqual(errors, []);
  console.log(
    'PASS: horizontal drag seeks on the video picture and the audio card subtitle area (hint in whole seconds while dragging, seek on release, no scroll / click / fling, clamped to the duration, Esc cancels), vertical drag scrolls, other card areas do not seek, fullscreen: horizontal seeks and vertical does nothing',
  );
} finally {
  if (errors.length) console.error('Page errors:', errors);
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }));
    ws.close();
  }
  server.close();
  for (let i = 0; i < 30 && chrome.exitCode === null; i++) await delay(100);
  if (chrome.exitCode === null) chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
