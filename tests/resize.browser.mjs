// 阅读区尺寸变化时正文不跳（窗口缩放、侧栏停靠与调宽）：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from './chrome.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/resize.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-resize-'));
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
const chrome = launch(binary, profile);
let ws,
  id = 0;
const pending = new Map(),
  errors = [];
async function wait(check) {
  let last;
  for (let i = 0; i < 150; i++) {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await delay(50);
  }
  throw Error('Timed out: ' + check + '; last: ' + last);
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
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});`,
  });

  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 一本 60 页、宽高比各不相同的书。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Long',{create:true});
    for(let i=0;i<60;i++){const w=500+(i*137)%700,h=400+(i*251)%1600,out=await (await dir.getFileHandle(String(i).padStart(2,'0')+'.svg',{create:true})).createWritable();
      await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="hsl('+i*37+',50%,40%)"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Long'`));
  // 视窗中心所在的页、该页在视窗里的上沿，以及中心处的相对位置。
  await js(`window.probe=()=>{const r=reader.getBoundingClientRect(),cy=r.top+reader.clientHeight/2;
    for(const n of reader.querySelectorAll('.page')){const b=n.getBoundingClientRect();if(b.top<=cy&&b.bottom>cy)return {n:+n.dataset.n,top:b.top-r.top,h:b.height,f:(cy-b.top)/b.height,st:reader.scrollTop,end:reader.scrollHeight-reader.scrollTop-reader.clientHeight};}return null;};
    window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));`);
  const size = async (width, height) => {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    return js('frame().then(probe)');
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await js('frame()');
    await delay(400);
  };
  const same = (a, b, what) => {
    assert.equal(b.n, a.n, what + ': same page (' + JSON.stringify([a, b]) + ')');
    assert.ok(Math.abs(b.f - a.f) * b.h <= 1, what + ': same point within 1px (' + JSON.stringify([a, b]) + ')');
  };
  // 一次连续缩放：每步之间只等一帧（模拟拖动窗口边框），锚点页始终不变，上沿单调移动（缩小时下移、放大时上移），回到原尺寸时回到原位置。
  async function sweep(from, to, what) {
    const list = [];
    const n = Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) / 8);
    for (const [a, b] of [
      [from, to],
      [to, from],
    ])
      for (let i = 1; i <= n; i++)
        list.push(await size(Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n)));
    return list;
  }
  await size(900, 800);
  await settle();
  await js('reader.scrollTop=reader.scrollHeight*.37');
  await settle();
  for (const [to, what] of [
    [[480, 800], 'width'],
    [[900, 420], 'height'],
    [[520, 500], 'width and height'],
    [[1400, 1000], 'larger'],
  ]) {
    const p0 = await js('probe()');
    const list = await sweep([900, 800], to, what);
    const half = list.length / 2;
    for (const [i, p] of list.entries()) {
      assert.equal(p.n, p0.n, what + ': anchor page stays at the centre (step ' + i + ': ' + JSON.stringify(p) + ')');
      // 中心点不动：相对位置不变（误差 1px 内）。
      assert.ok(
        Math.abs(p.f - p0.f) * p.h <= 1,
        what + ': centre point kept at step ' + i + ' ' + JSON.stringify([p0, p]),
      );
    }
    // 锚点页在视窗里的位置单调变化，不来回跳（容差 1px）。
    for (const part of [list.slice(0, half), list.slice(half)]) {
      const d = part.slice(1).map((p, i) => p.top - part[i].top);
      assert.ok(
        d.every((x) => x >= -1) || d.every((x) => x <= 1),
        what + ': anchor page moves monotonically ' + JSON.stringify(part.map((p) => Math.round(p.top))),
      );
    }
    same(p0, list.at(-1), what + ' A→B→A');
    await settle();
    same(p0, await js('probe()'), what + ' after settling');
  }
  // 书首、书尾：缩放过程中和停下后都仍在书首 / 书尾。
  await js('reader.scrollTop=0');
  await settle();
  for (const p of await sweep([900, 800], [520, 560], 'start')) assert.equal(p.st, 0, 'Stays at the start');
  await js('reader.scrollTop=reader.scrollHeight');
  await settle();
  for (const p of await sweep([900, 800], [520, 560], 'end'))
    assert.ok(p.end <= 1, 'Stays at the end ' + JSON.stringify(p));
  // 侧栏停靠、调宽：阅读区变窄 / 变宽，中心处的内容不动。
  await js('reader.scrollTop=reader.scrollHeight*.61');
  await settle();
  let p0 = await js('probe()');
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`document.body.classList.contains('docked')`));
  await js('frame()');
  const docked = await js('probe()');
  same(p0, docked, 'dock');
  assert.ok(await js('reader.clientWidth<850'), 'Docked panel narrows the reader');
  await settle();
  same(p0, await js('probe()'), 'dock settled');
  const grip = (k) =>
    cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k,
      code: k,
      windowsVirtualKeyCode: k === 'ArrowLeft' ? 37 : 39,
    });
  await js('grip.focus()');
  const widths = [];
  for (let i = 0; i < 8; i++) {
    await grip('ArrowLeft');
    widths.push(await js('frame().then(probe)'));
  }
  for (let i = 0; i < 8; i++) {
    await grip('ArrowRight');
    widths.push(await js('frame().then(probe)'));
  }
  for (const p of widths) {
    assert.equal(p.n, p0.n, 'Panel resize keeps the anchor page');
    assert.ok(Math.abs(p.f - p0.f) * p.h <= 1, 'Panel resize keeps the centre point ' + JSON.stringify([p0, p]));
  }
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`!document.body.classList.contains('docked')`));
  await js('frame()');
  same(p0, await js('probe()'), 'undock');
  // 缩放停下后照常滚动：用户滚动不被锚点拉回。
  await js('reader.scrollTop+=700');
  await settle();
  const moved = await js('probe()');
  await size(700, 800);
  same(moved, await js('probe()'), 'after scrolling');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: centre point kept within 1px during continuous width / height changes and back, start / end kept, docking and resizing the side panel, scrolling after a resize',
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
