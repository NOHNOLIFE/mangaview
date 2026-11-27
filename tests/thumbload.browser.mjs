// 缩略图的加载时机与占位（reader/view.mjs、reader/thumbworker.mjs）：解码在 Worker 里；高速滚动时不读新的缩略图，慢下来再读；
// 拖动、滑行中加载完成的缩略图不改变占位尺寸（不重排），停下后才补齐尺寸。独立临时配置 + 测试生成的 JPEG，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/thumbload.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-thumbload-'));
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
    '--window-size=1000,760',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
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
  const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, ...extra });
  const press = (x, y) => mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
  const release = (x, y) => mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
  const at = (sel, fx = 0.5, fy = 0.5) =>
    js(`(()=>{const r=(${sel}).getBoundingClientRect();return [r.left+r.width*${fx},r.top+r.height*${fy}];})()`);
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 160 张 JPEG，比例各不相同（读到之前尺寸未知，占位按默认比例）。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Thumbs',{create:true});
    for(let i=0;i<160;i++){const w=400,h=300+((i*97)%700),c=new OffscreenCanvas(w,h),g=c.getContext('2d');
      g.fillStyle='hsl('+(i*23%360)+',55%,45%)';g.fillRect(0,0,w,h);g.fillStyle='#fff';g.font='80px sans-serif';g.fillText(String(i),20,120);
      const b=await c.convertToBlob({type:'image/jpeg',quality:.8});const o=await (await dir.getFileHandle(String(i).padStart(3,'0')+'.jpg',{create:true})).createWritable();await o.write(b);await o.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Thumbs'`));
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.reads=[];window.hold=null;const gf=FileSystemFileHandle.prototype.getFile;FileSystemFileHandle.prototype.getFile=async function(){reads.push(this.name);if(hold)await hold.p;return gf.call(this)};
    window.slots=()=>[...preview.querySelectorAll('.page')].map(n=>[n.dataset.name,n.style.top,n.style.height,!!n.querySelector('canvas,img')]);`);
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`document.body.classList.contains('docked')&&!!preview.querySelector('.page canvas')`));
  // 1. 缩略图在 Worker 里解码：缩略图栏的图是画布，Worker 脚本已载入。
  assert.ok(
    await js(`performance.getEntriesByType('resource').some(e=>e.name.endsWith('/src/reader/thumbworker.mjs'))`),
    'Decoded in a worker',
  );
  const { FAST, SETTLE } = await js(`import('./src/reader/view.mjs').then(m=>({FAST:m.FAST,SETTLE:m.SETTLE}))`);
  assert.ok(FAST > 0 && SETTLE > 0);
  // 2. 高速滚动（远快于 FAST）时不发起新的缩略图读取；停下 SETTLE 毫秒后再读，可见的缩略图随之出现。
  await delay(600);
  await js('preview.dispatchEvent(new WheelEvent("wheel"))');
  // 第一帧还测不出速度（与真实的拖动、滑行一样，起步时慢）：从第三帧起计。
  const fastReads = await js(
    `(async()=>{for(let i=0;i<42;i++){if(i===2)reads.length=0;preview.scrollTop+=Math.round(${FAST}*16.7*4);await new Promise(r=>requestAnimationFrame(r));}return reads.length;})()`,
  );
  assert.equal(fastReads, 0, 'No thumbnail reads while scrolling fast');
  assert.ok(await js('preview.scrollTop>2000'));
  await wait(() => js('reads.length>0'));
  await wait(() =>
    js(
      `(()=>{const r=preview.getBoundingClientRect();return [...preview.querySelectorAll('.page')].filter(n=>{const b=n.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom;}).every(n=>n.querySelector('canvas,img'))})()`,
    ),
  );
  // 慢速滚动照常读取。
  await js('reads.length=0');
  await js(
    `(async()=>{for(let i=0;i<40;i++){preview.scrollTop+=4;await new Promise(r=>requestAnimationFrame(r));}})()`,
  );
  // 3. 按住拖动期间读到的缩略图：占位的位置和高度不变；松手停下后才按真实比例重排。
  await js('preview.scrollTop=0');
  await delay(600);
  const [px, py] = await at('preview', 0.5, 0.5);
  await mouse('mouseMoved', px, py);
  await press(px, py);
  for (let i = 1; i <= 4; i++) {
    await mouse('mouseMoved', px, py - i * 3, { button: 'left', buttons: 1 });
    await delay(16);
  }
  // 拖动中（按住不放）把还没读过的一段换进视窗：记下占位，再等它们读完。
  // 读文件先挂住（测试替身），记下占位后再放行，结果与读取快慢无关。
  await js('reads.length=0;{let go;window.hold={p:new Promise(r=>go=r)};hold.go=go;}');
  const before = await js(
    `(async()=>{preview.scrollTop=preview.scrollHeight-preview.clientHeight;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return JSON.stringify(slots());})()`,
  );
  await wait(() => js('reads.length>0'));
  await js('hold.go();hold=null');
  await wait(() => js(`slots().filter(s=>s[3]).length>=${JSON.parse(before).filter((s) => s[3]).length + 1}`));
  await delay(400);
  const held = JSON.parse(await js('JSON.stringify(slots())'));
  const was = new Map(JSON.parse(before).map((s) => [s[0], s]));
  const loaded = held.filter((s) => s[3] && was.has(s[0]) && !was.get(s[0])[3]);
  assert.ok(loaded.length > 0, 'Thumbnails load during a slow drag');
  for (const s of held)
    if (was.has(s[0]))
      assert.deepEqual(s.slice(1, 3), was.get(s[0]).slice(1, 3), 'Placeholder size kept while dragging: ' + s[0]);
  await release(px, py - 12);
  await delay(800);
  const after = new Map(JSON.parse(await js('JSON.stringify(slots())')).map((s) => [s[0], s]));
  assert.ok(
    loaded.some((s) => after.has(s[0]) && after.get(s[0])[2] !== s[2]),
    'Real sizes applied after the drag ends',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: thumbnails decoded in a worker, no reads while scrolling fast, fixed placeholders while dragging, real sizes after stopping',
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
