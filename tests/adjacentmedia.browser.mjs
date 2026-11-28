// 混合模式的相邻媒体（core/engine.mjs 的 chained、reader/engine.mjs）：播完的媒体后面紧挨着也是媒体时直接定位到它居中播放，不匀速滚动；
// 图片与媒体之间照常滚动。独立临时配置 + OPFS 测试数据；音频、视频由 tests/media-fixtures.mjs 在测试页里现场生成，不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from './chrome.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/adjacentmedia.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-adjacent-'));
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
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','false');`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  // 书 Pair：图、音频、视频（紧挨着）、高图、音频。
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),d=await root.getDirectoryHandle('Pair',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(d,'01.svg',svg(600,300,'teal'));await mvMedia.write(d,'02 a.wav',mvMedia.wav({seconds:1}));
    await mvMedia.write(d,'03 v.webm',await mvMedia.webm({seconds:1,width:320,height:180}));
    await mvMedia.write(d,'04.svg',svg(600,1400,'#534'));await mvMedia.write(d,'05 c.wav',mvMedia.wav({seconds:1}));
    window.showDirectoryPicker=async()=>d;document.querySelector('#empty [data-act="folder"]').click();
    await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Pair'`), 'imported');
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.mid=name=>{const n=node(name);return n.offsetTop+n.offsetHeight/2;};
    window.record=()=>{window.rec=[];window.recOn=true;const f=()=>{rec.push(reader.scrollTop+reader.clientHeight/2);if(recOn)requestAnimationFrame(f);};requestAnimationFrame(f);};`);
  const B = (id) => `document.querySelector('#controlbar [data-id="${id}"]')`;
  const running = async () => (await js(`${B('play')}.getAttribute('aria-pressed')`)) === 'true';
  const playing = () =>
    js(`[...reader.querySelectorAll('video,audio')].filter(m=>!m.paused).map(m=>m.closest('.page').dataset.name)`);
  await js(
    `localStorage.setItem('mv2:scrollRate','4');dispatchEvent(new StorageEvent('storage',{key:'mv2:scrollRate',newValue:'4',storageArea:localStorage}))`,
  );
  await js(`${B('mode-mixed')}.click()`);
  await js('reader.scrollTop=0;reader.focus()');
  await js('frame()');
  await js('record()');
  await key(' ', 'Space', 32, { modifiers: 8 }); // Shift+空格：自动滚动（单按空格会后台播放视窗中心的音频）
  await wait(async () => (await playing()).join() === '02 a.wav', 'plays the audio');
  await wait(async () => (await playing()).join() === '03 v.webm', 'then the video right after it');
  const [a, v] = await js(`[mid('02 a.wav'),mid('03 v.webm')]`);
  await wait(async () => (await playing()).join() === '05 c.wav', 'then the audio after the image');
  const c = await js(`mid('05 c.wav')`);
  await wait(async () => (await playing()).join() === '02 a.wav', 'book loop: back to the first audio');
  await key(' ', 'Space', 32); // 运行中空格即停止
  await wait(async () => !(await running()), 'stopped by hand');
  const centres = await js('recOn=false,rec'),
    lo = await js('reader.clientHeight/2'),
    hi = await js('reader.scrollHeight-reader.clientHeight/2'),
    clamp = (x) => Math.min(hi, Math.max(lo, x));
  // 音频 → 紧挨着的视频：中线直接从音频跳到视频，中间没有经过的位置。
  const between = (p, q) => centres.filter((x) => x > clamp(p) + 2 && x < clamp(q) - 2);
  assert.ok(clamp(v) - clamp(a) > 20, 'The two media are apart: ' + [a, v]);
  assert.deepEqual(between(a, v), [], 'Jumps straight to the next media');
  assert.ok(
    centres.some((x) => Math.abs(x - clamp(v)) < 2),
    'Lands with the video centred',
  );
  // 视频 → 图片 → 音频：照常匀速滚动过去。
  assert.ok(between(v, c).length > 5, 'Scrolls past the image as usual');
  assert.deepEqual(errors, []);
  console.log('PASS: mixed mode jumps straight between adjacent media, scrolls between images and media');
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
