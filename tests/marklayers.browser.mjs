// 区段嵌套与交叉在媒体上的表现：进度条上按嵌套深度分层画区段、挤在一起时指向最近的标记、只播区段按并集；媒体的「选择起点」与最近书签。
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
if (!binary) throw Error('Usage: node tests/marklayers.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-marklayers-'));
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});try{localStorage.setItem('mv2:preview','false');localStorage.setItem('mv2:autoplay','false');}catch{}`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};`;
  await js(helpers);
  const A = '02 long.wav';
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Layers',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(dir,'01.svg',svg(600,900,'teal'));
    await mvMedia.write(dir,'02 long.wav',mvMedia.wav({seconds:60}));
    await mvMedia.write(dir,'03.svg',svg(600,900,'purple'));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Layers'`), 'book opened');
  const store = `import('./src/core/store.mjs')`;
  const record = () => js(`${store}.then(async({library})=>(await library('getAll')).find(b=>b.title==='Layers'))`);
  // 02 long.wav（60 秒）里：A 5–50 包含 B 10–20，B 包含 C 12–15；D 40–55 与 A 交叉；E 30.5、F 31 两个挤在一起的普通书签；G 45。
  const sec = (id, t, e) => ({ id, name: A, t, at: 1, label: id, ...(e ? { end: { name: A, t: e, at: 2 } } : {}) });
  const marks = [
    sec('A', 5, 50),
    sec('B', 10, 20),
    sec('C', 12, 15),
    sec('D', 40, 55),
    sec('E', 30.5),
    sec('F', 31),
    sec('G', 45),
  ];
  await js(
    `${store}.then(async({library})=>{const b=(await library('getAll')).find(b=>b.title==='Layers');b.bookmarks=${JSON.stringify(marks)};await library('put',b);})`,
  );
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Layers'`), 'reloaded');
  await js(MEDIA_FIXTURES);
  await js(helpers);
  await js('reader.focus()');
  await js(`toPage(${JSON.stringify(A)})`);
  await wait(() => js(`el(${JSON.stringify(A)})?.readyState>=1`), 'loaded');
  await wait(() => js(`node(${JSON.stringify(A)}).querySelectorAll('.mv-marks .mv-mk').length===11`), 'marks drawn');
  const N = JSON.stringify(A);
  const box = (sel) =>
    js(
      `(()=>{const r=node(${N}).querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};})()`,
    );
  const now = () => js(`el(${N}).currentTime`);
  const hotSet = () =>
    js(
      `[...node(${N}).querySelectorAll('.mv-marks .hot')].map(e=>e.classList[0]+(e.dataset.sec?':'+e.dataset.sec:'')+(e.classList.contains('mark')?':'+e.dataset.t:'')).sort().join()`,
    );
  const tipText = () => js(`document.querySelector('.mv-tip:popover-open')?.textContent??''`);

  // ==== 1. 分层：嵌套的在里面（顶线更低），交叉的错开一层，最多三层；都在进度条范围内 ====
  const bar = await box('.mv-bar');
  const roof = (id) => box(`.mv-span[data-sec="${id}"]`),
    leg = (id, kind) => box(`.mv-mk.${kind}[data-sec="${id}"]`);
  const [rA, rB, rC, rD] = await Promise.all(['A', 'B', 'C', 'D'].map(roof));
  assert.ok(rA.top < rB.top - 2 && rB.top < rC.top - 2, 'Nested sections sit lower, one layer per level');
  assert.equal(Math.round(rD.top), Math.round(rB.top), 'The crossing section is one layer down');
  for (const r of [rA, rB, rC, rD]) assert.ok(r.top >= bar.top && r.bottom <= bar.bottom, 'Inside the seek bar');
  const track = await box('.mv-track');
  for (const id of ['A', 'C']) {
    const s = await leg(id, 'start'),
      e = await leg(id, 'end'),
      r = await roof(id);
    assert.ok(Math.abs(s.top - r.top) < 1 && Math.abs(e.top - r.top) < 1, 'Brackets hang from their top line');
    assert.ok(s.bottom >= track.top && s.bottom <= track.bottom + 1, 'and reach down to the track');
    assert.ok(
      Math.abs(s.left + 1 - r.left) < 1.5 && Math.abs(e.right - 1 - r.right) < 1.5,
      'The brackets frame the section',
    );
  }
  // 截图自查可读性（放大两倍，只截进度条附近）。
  if (process.env.MV_SHOTS) {
    const { data } = await cdp('Page.captureScreenshot', {
      format: 'png',
      clip: { x: bar.left - 10, y: bar.top - 30, width: bar.width + 20, height: bar.height + 40, scale: 2 },
    });
    await writeFile(join(process.env.MV_SHOTS, 'marklayers-bar.png'), Buffer.from(data, 'base64'));
  }

  // ==== 2. 指向：挤在一起时取离指针最近的；区段只高亮这一对并提示两端时间；点击跳到该标记的时间 ====
  const xAt = (t) => bar.left + (t / 60) * bar.width;
  const move = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const cy = track.y;
  assert.ok(xAt(31) - xAt(30.5) < 6, 'E and F are crowded');
  await move(xAt(30.5) + 0.5, cy);
  await wait(async () => (await hotSet()) === 'mv-mk:30.5', 'nearest of the two');
  assert.equal(await tipText(), '0:30 · E');
  await move(xAt(31) - 0.5, cy);
  await wait(async () => (await hotSet()) === 'mv-mk:31');
  assert.equal(await tipText(), '0:31 · F');
  // C 的起点与 B 的起点相距很近：指向 C 那一竖，只有 C 这一对高亮（不带 B、A）。
  const c0 = await leg('C', 'start');
  await move(xAt(12) + 0.5, c0.y);
  await wait(async () => (await hotSet()) === 'mv-mk:C,mv-mk:C,mv-span:C', 'only the pair of C');
  assert.equal(await tipText(), 'Section start 0:12 – 0:15 · C');
  await shot('marklayers-hover');
  // 点击跳到该标记的时间（点的位置不必正好在标记上）。
  await cdp('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: xAt(12) + 1,
    y: c0.y,
    button: 'left',
    clickCount: 1,
  });
  await cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: xAt(12) + 1,
    y: c0.y,
    button: 'left',
    clickCount: 1,
  });
  await wait(async () => Math.abs((await now()) - 12) < 0.05, 'click seeks to the mark');
  // 离标记远的地方照常是进度条的点击定位。
  await move(xAt(36), cy);
  await wait(async () => (await hotSet()) === '', 'nothing near');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: xAt(36), y: cy, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xAt(36), y: cy, button: 'left', clickCount: 1 });
  await wait(async () => Math.abs((await now()) - 36) < 0.6, 'plain seek elsewhere');
  await move(400, 200);
  await wait(async () => (await hotSet()) === '' && (await tipText()) === '');
  // 键盘聚焦标记：同样只高亮这一对并提示。
  await js(`node(${N}).querySelector('.mv-mk.end[data-sec="D"]').focus()`);
  await wait(async () => (await hotSet()) === 'mv-mk:D,mv-mk:D,mv-span:D');
  assert.match(await tipText(), /^Section bookmark 0:55 · Section start 0:40/);
  await js('reader.focus()');

  // ==== 3. 只播放书签区段：按所有区段的并集播放（5–55 一段），嵌套、交叉的终点不跳转 ====
  await js(`document.querySelector('#controlbar [data-id="sections"]').click()`);
  await wait(() => js(`node(${N}).classList.contains('sec-only')`));
  assert.deepEqual(
    await js(
      `[...node(${N}).querySelectorAll('.mv-dim')].map(d=>[Math.round(parseFloat(d.style.left)),Math.round(parseFloat(d.style.width))])`,
    ),
    [
      [0, 8],
      [92, 8],
    ],
    'Only outside the union is dimmed',
  );
  await shot('marklayers-only');
  const seekTo = (s) =>
    js(`new Promise(r=>{const e=el(${N});e.addEventListener('seeked',()=>r(true),{once:true});e.currentTime=${s};})`);
  await seekTo(0);
  await js(`node(${N}).querySelector('.mv-play').click()`);
  await wait(async () => {
    const t = await now();
    return t >= 5 && t < 6;
  }, 'starts at the union start');
  await seekTo(19.7);
  await wait(async () => (await now()) > 20.4, 'plays through the end of the nested section');
  assert.ok((await now()) < 22, 'without jumping: ' + (await now()));
  await seekTo(49.7);
  await wait(async () => (await now()) > 50.4, 'plays through the end of the crossing section');
  assert.ok((await now()) < 52);
  await js(`el(${N}).pause()`);
  await js(`document.querySelector('#controlbar [data-id="sections"]').click()`);
  await wait(() => js(`!node(${N}).classList.contains('sec-only')`));

  // ==== 4. 媒体的「选择起点」：只列这个文件里当前时间之前的书签；终点取触发那一刻，媒体不因对话框暂停 ====
  await seekTo(35);
  await js(`el(${N}).play()`);
  await wait(async () => !(await js(`el(${N}).paused`)));
  await js(`node(${N}).querySelector('[data-control="section"]').click()`);
  const t0 = await now();
  await wait(() => js(`!!document.querySelector('.start-pick')?.open`), 'start picker');
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.start-pick .stp-item')].map(b=>b.getAttribute('aria-label').replace(/ · Already.*/,' (moves)'))`,
    ),
    [
      'Page 2 · 0:05 · A (moves)',
      'Page 2 · 0:10 · B (moves)',
      'Page 2 · 0:12 · C (moves)',
      'Page 2 · 0:30 · E',
      'Page 2 · 0:31 · F',
    ],
  );
  assert.equal(await js(`document.querySelector('.start-pick .stp-sub').textContent`), A, 'The file name is shown');
  await delay(1200);
  assert.equal(await js(`el(${N}).paused`), false, 'Still playing behind the dialog');
  assert.ok((await now()) > t0 + 1);
  await js(`document.querySelector('.start-pick .stp-ok').click()`);
  await wait(async () => (await record()).bookmarks.find((m) => m.id === 'F')?.end);
  const endT = (await record()).bookmarks.find((m) => m.id === 'F').end.t;
  assert.ok(Math.abs(endT - t0) < 0.35, 'The end is where it was triggered: ' + endT + ' vs ' + t0);
  await js(`el(${N}).pause()`);
  // 最近书签（书签面板）：视窗中心是这个音频，按它的当前时间算。
  await seekTo(33);
  await js(
    `reader.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`,
  );
  await wait(() => js(`!document.querySelector('.bm-panel').hidden`));
  const active = () =>
    js(`[...document.querySelectorAll('.bm-panel .bm-item.active')].map(e=>e.getAttribute('aria-label')).join('|')`);
  await wait(async () => (await active()) === 'Page 2 · 0:31 · F · Section start');
  await seekTo(44);
  await delay(250);
  await js(`reader.dispatchEvent(new Event('scroll'))`);
  await wait(async () => (await active()) === 'Page 2 · 0:40 · D · Section start', 'by playback time');

  assert.deepEqual(errors, []);
  console.log(
    'PASS: seek bar sections drawn in layers by nesting (nested lower, crossing one layer down, inside the bar, brackets hanging from the top line), nearest mark under a crowded pointer, only the pointed pair highlighted with both times, click seeks to the mark and elsewhere seeks normally, keyboard focus, sections-only plays the union and dims outside it, media start picker (this file before now, file name, playback keeps going, end taken when triggered), nearest bookmark by playback time',
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
