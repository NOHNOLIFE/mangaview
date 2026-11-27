// 拖动滚动与惯性（src/ui/dragscroll.mjs）：各类可滚动区域的拖动、惯性、打断、不误触点击，控件与可选文字不参与。独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/dragscroll.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-dragscroll-'));
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
    '--window-size=900,640',
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
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});if(localStorage.getItem('mv2:shelfmarks')===null)localStorage.setItem('mv2:shelfmarks','true');`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 40 本书：B01 有 40 页长图，其余 1~3 页；每本书两个书签（书架书签栏、书签面板都要能滚动）。
  await js(`(async()=>{const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('lib',{create:true});
    for(let i=1;i<=40;i++){const d=await root.getDirectoryHandle('B'+String(i).padStart(2,'0'),{create:true});
      for(let j=0;j<(i===1?40:1+i%3);j++){const w=await (await d.getFileHandle(String(j).padStart(2,'0')+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="hsl('+(i*37+j*11)+',50%,40%)"/></svg>');await w.close();}}
    window.showDirectoryPicker=async()=>root;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  const records = () => js(`import('./src/core/store.mjs').then(({library})=>library('getAll'))`);
  await wait(async () => (await records()).length === 40);
  await js(`(async()=>{const {library}=await import('./src/core/store.mjs');const all=await library('getAll');
    for(const b of all){b.bookmarks=(b.title==='B01'?[...Array(24).keys()]:[0,0]).map((k,n)=>({id:'m'+b.title+n,name:b.pages[Math.min(k,b.pages.length-1)].name,f:n?.8:.3,at:Date.now()}));await library('put',b);}
    localStorage.setItem('mv2:last',JSON.stringify(all.find(b=>b.title==='B01').id));})()`);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='B01'&&!!document.querySelector('#shelfmarks .sm-list .bm-item')`));
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.hits=[];document.addEventListener('click',e=>hits.push(e.target.closest('[class]')?.className||e.target.id||e.target.tagName),true);`);
  const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, ...extra });
  const press = (x, y) => mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
  const release = (x, y) => mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
  async function click(x, y) {
    await mouse('mouseMoved', x, y);
    await press(x, y);
    await release(x, y);
  }
  // 按住拖动：steps 步、每步约 16ms；pause 为松手前停住的毫秒数。
  async function drag(x, y, dx, dy, { steps = 8, pause = 0, up = true } = {}) {
    await mouse('mouseMoved', x, y);
    await press(x, y);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps, { button: 'left', buttons: 1 });
      await delay(16);
    }
    if (pause) await delay(pause);
    if (up) await release(x + dx, y + dy);
  }
  // 元素中心（或按比例的点）的视窗坐标。
  const at = (sel, fx = 0.5, fy = 0.5) =>
    js(`(()=>{const r=(${sel}).getBoundingClientRect();return [r.left+r.width*${fx},r.top+r.height*${fy}];})()`);
  const pos = (sel) => js(`(()=>{const e=${sel};return [e.scrollLeft,e.scrollTop];})()`);
  // 等滚动位置连续几帧不变。
  async function still(sel) {
    let last = null,
      same = 0;
    for (let i = 0; i < 400; i++) {
      await js('frame()');
      const p = JSON.stringify(await pos(sel));
      same = p === last ? same + 1 : 0;
      last = p;
      if (same >= 4) return JSON.parse(p);
    }
    throw Error('Never settled: ' + sel);
  }
  const clicks = async () => {
    const h = await js('hits.splice(0)');
    return h;
  };
  // 1. 正文：拖动滚动（按住拖动的距离 1:1），松手后惯性继续并最终停下；拖动后不触发点击翻屏。
  const [mx, my] = await at('reader', 0.75, 0.6);
  await js('reader.scrollTop=2000');
  const s0 = (await still('reader'))[1];
  await clicks();
  await drag(mx, my, 0, -240, { up: false });
  const held = (await pos('reader'))[1];
  assert.ok(Math.abs(held - s0 - 240) <= 1, 'Dragging follows the pointer 1:1: ' + [s0, held]);
  await release(mx, my - 240);
  await js('frame()');
  await delay(80);
  const gliding = (await pos('reader'))[1];
  assert.ok(gliding > held + 20, 'Keeps moving after release: ' + [held, gliding]);
  const rest = (await still('reader'))[1];
  assert.ok(rest > gliding + 50 && rest < held + 2000, 'Glides on and stops: ' + [held, gliding, rest]);
  assert.deepEqual(await clicks(), [], 'No click after a drag (no screen turn)');
  // 松手前停住：不带惯性。
  await drag(mx, my, 0, -200, { pause: 150 });
  const paused = (await pos('reader'))[1];
  await delay(150);
  assert.equal((await pos('reader'))[1], paused, 'No glide after pausing before release');
  assert.deepEqual(await clicks(), []);
  // 没有拖动：照常点击翻屏（右半屏后一屏）；几像素以内的抖动仍算点击。
  const step = await js('reader.clientHeight-64');
  await click(mx, my);
  assert.equal((await pos('reader'))[1], paused + step, 'A click still turns the screen');
  await drag(mx, my, 3, -3, { steps: 2 });
  assert.equal((await pos('reader'))[1], paused + 2 * step, 'A few pixels of jitter is still a click');
  await clicks();
  // 2. 打断：滚轮、按键、再次按下、程序性跳转都立即停住惯性；滑行中按下这一下不翻屏。
  const fling = async () => {
    await js('reader.scrollTop=3000');
    await still('reader');
    await drag(mx, my, 0, -300, { steps: 6 });
    await delay(50);
  };
  const stopsOn = async (what, act) => {
    await fling();
    await act();
    const a = (await pos('reader'))[1];
    await delay(200);
    const b = (await pos('reader'))[1];
    return [a, b];
  };
  let [a, b] = await stopsOn('wheel', () => mouse('mouseWheel', mx, my, { deltaX: 0, deltaY: 0 }));
  assert.equal(b, a, 'Wheel stops the glide');
  [a, b] = await stopsOn('key', () =>
    cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }),
  );
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  assert.equal(b, a, 'A key press stops the glide');
  await clicks();
  [a, b] = await stopsOn('press', () => click(mx, my));
  assert.equal(b, a, 'Pressing stops the glide');
  assert.deepEqual(await clicks(), [], 'The press that stops a fast glide does not turn the screen');
  // 程序性跳转（书签、媒体、缩略图栏）：停在跳转目标上，不被惯性带走（补齐尺寸的重排会改 scrollTop，按页内位置比较）。
  await stopsOn('jump', () => js(`import('./src/reader/session.mjs').then(({view})=>view.jump({i:30,f:.5}))`));
  await still('reader');
  assert.ok(
    await js(
      `(()=>{const p=reader.querySelector('[data-name="30.svg"]'),r=reader.getBoundingClientRect(),b=p.getBoundingClientRect();return Math.abs(b.top+b.height/2-(r.top+reader.clientHeight/2))<=1;})()`,
    ),
    'A programmatic jump stops the glide and keeps its target',
  );
  // 每帧至多写一次滚动位置：一帧里来了多次指针移动也只写一次。
  await js(`(()=>{const d=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');let n=0;window.writes=[];
    Object.defineProperty(reader,'scrollTop',{get(){return d.get.call(this)},set(v){n++;d.set.call(this,v)},configurable:true});
    window.countOn=true;const f=()=>{writes.push(n);n=0;if(countOn)requestAnimationFrame(f)};requestAnimationFrame(f);})()`);
  await js('reader.scrollTop=2000');
  await still('reader');
  await js('writes.length=0');
  await mouse('mouseMoved', mx, my);
  await press(mx, my);
  await mouse('mouseMoved', mx, my - 20, { button: 'left', buttons: 1 });
  // 同一帧里连着派发多次指针移动（高回报率鼠标）。
  for (let i = 1; i <= 6; i++) {
    await js(
      `(()=>{for(let k=1;k<=5;k++)reader.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:1,clientX:${mx},clientY:${my - 20}-${i * 30}-k*6}));})()`,
    );
    await js('frame()');
  }
  await release(mx, my - 230);
  await still('reader');
  const writes = await js('countOn=false,delete reader.scrollTop,writes');
  assert.ok(Math.max(...writes) <= 1 && writes.some((n) => n === 1), 'At most one scroll write per frame: ' + writes);
  // 滑行未停时同方向再甩：速度叠加，比单独一甩快；反方向只按新的一甩。
  const speedAfter = async () => {
    const a = (await pos('reader'))[1];
    await delay(100);
    return ((await pos('reader'))[1] - a) / 100;
  };
  await js('reader.scrollTop=3000');
  await still('reader');
  await drag(mx, my, 0, -300, { steps: 6 });
  const one = await speedAfter();
  await still('reader');
  await js('reader.scrollTop=3000');
  await still('reader');
  await drag(mx, my, 0, -300, { steps: 6 });
  await delay(40);
  await drag(mx, my, 0, -300, { steps: 6 });
  const two = await speedAfter();
  assert.ok(one > 0.5 && two > one * 1.3, 'A second fling in the same direction adds up: ' + [one, two]);
  await still('reader');
  await js('reader.scrollTop=6000');
  await still('reader');
  await drag(mx, my, 0, -300, { steps: 6 });
  await delay(40);
  await drag(mx, my - 300, 0, 300, { steps: 6 });
  const back = await speedAfter();
  assert.ok(back < 0 && -back < one * 1.3, 'Flinging back goes back at its own speed: ' + [one, back]);
  await still('reader');
  // 惯性到书尾停下。
  // 先到书尾等末尾几页载入完（补齐尺寸会改变总高度），再从书尾前 300px 拖动。
  await js('reader.scrollTop=reader.scrollHeight');
  await still('reader');
  await delay(500);
  await js('reader.scrollTop=reader.scrollHeight-reader.clientHeight-300');
  await still('reader');
  await drag(mx, my, 0, -300, { steps: 5 });
  await still('reader');
  assert.ok(await js('reader.scrollHeight-reader.scrollTop-reader.clientHeight<=1'), 'Glide stops at the end');
  // 3. 缩略图栏（常驻）：拖动滚动缩略图栏本身、不移动正文、不触发定位；单击照常定位（view.fromPreview）。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`document.body.classList.contains('docked')&&preview.scrollHeight>preview.clientHeight*2`));
  await js('reader.scrollTop=0');
  await still('reader');
  await still('preview');
  const [px, py] = await at('preview', 0.5, 0.7);
  await clicks();
  await drag(px, py, 0, -200);
  const nav = (await still('preview'))[1];
  assert.ok(nav > 200, 'Thumbnail strip scrolls with a glide: ' + nav);
  assert.equal((await pos('reader'))[1], 0, 'Dragging the strip does not move the page');
  assert.deepEqual(await clicks(), []);
  await click(px, py);
  await wait(() => js('reader.scrollTop>0'));
  assert.equal((await clicks()).length, 1);
  // 4. 书架书签栏：拖动书签缩略图滚动列表，不跳转。
  const dockList = `document.querySelector('#shelfmarks .sm-list')`;
  const top0 = await js('reader.scrollTop'),
    title0 = await js('bookTitle.textContent');
  const [dx, dy] = await at(`${dockList}.querySelectorAll('.bm-item')[3]`);
  const d0 = (await pos(dockList))[1];
  await drag(dx, dy, 0, -150);
  const d1 = (await still(dockList))[1];
  assert.ok(d1 > d0 + 150, 'Shelf bookmarks list scrolls with a glide: ' + [d0, d1]);
  assert.deepEqual(await clicks(), []);
  assert.equal(await js('reader.scrollTop'), top0, 'Dragging a bookmark does not jump');
  assert.equal(await js('bookTitle.textContent'), title0);
  // 5. 书签面板：拖动列表滚动，面板不关闭、不跳转；单击书签照常跳转。
  await js(`document.querySelector('#bar [data-act="bookmarks"]').click()`);
  await wait(() => js(`!document.querySelector('.bm-panel').hidden`));
  await clicks();
  const grid = `document.querySelector('.bm-panel .bm-grid')`;
  assert.ok(await js(`${grid}.scrollHeight>${grid}.clientHeight`), 'Bookmark panel list overflows');
  const [gx, gy] = await at(`${grid}.querySelectorAll('.bm-item')[4]`);
  await drag(gx, gy, 0, -120);
  const g1 = (await still(grid))[1];
  assert.ok(g1 > 120, 'Bookmark panel scrolls: ' + g1);
  assert.equal(await js(`document.querySelector('.bm-panel').hidden`), false, 'Panel stays open after a drag');
  assert.equal(await js('reader.scrollTop'), top0);
  assert.deepEqual(await clicks(), []);
  await click(...(await at(`${grid}.querySelectorAll('.bm-item')[10]`)));
  await wait(() => js(`document.querySelector('.bm-panel').hidden`));
  assert.notEqual(await js('reader.scrollTop'), top0, 'A click on a bookmark still jumps');
  await clicks();
  // 拖动过正文之后打开书签面板：点正文这一下只关闭面板，不翻屏（不沿用拖动留下的按下记录）。
  await drag(mx, my, 0, -100, { pause: 120 });
  await js(`document.querySelector('#bar [data-act="bookmarks"]').click()`);
  await wait(() => js(`!document.querySelector('.bm-panel').hidden`));
  const top1 = await js('reader.scrollTop');
  const [ex, ey] = await js(
    `(()=>{const r=reader.getBoundingClientRect(),p=document.querySelector('.bm-panel').getBoundingClientRect();return [r.left+Math.max(10,(p.left-r.left)/2),r.top+r.height*.6];})()`,
  );
  assert.ok(!(await js(`document.querySelector('.bm-panel').contains(document.elementFromPoint(${ex},${ey}))`)));
  await click(ex, ey);
  await wait(() => js(`document.querySelector('.bm-panel').hidden`));
  await delay(100);
  assert.equal(await js('reader.scrollTop'), top1, 'Closing the panel by clicking the page does not turn the screen');
  await clicks();
  const key = async (k, code, vk) => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: k });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  // 6. 全屏缩略图：拖动缩略图滚动（虚拟列表照常挂载新位置的缩略图），不跳转、不关闭；单击照常跳转并关闭。
  await js('reader.focus()');
  await key('v', 'KeyV', 86);
  await wait(() => js(`overview.open&&!!overview.querySelector('[role=option]')`));
  await delay(400);
  await clicks();
  const ov = `overview.querySelector('.ov-scroll')`;
  await js(`${ov}.scrollTop=0`);
  await still(ov);
  const topBefore = await js('reader.scrollTop');
  const [ox, oy] = await at(ov, 0.5, 0.8);
  await drag(ox, oy, 0, -260);
  const o1 = (await still(ov))[1];
  assert.ok(o1 > 260, 'Full-screen thumbnails scroll with a glide: ' + o1);
  assert.equal(await js('overview.open'), true, 'Overview stays open after a drag');
  assert.equal(await js('reader.scrollTop'), topBefore);
  assert.deepEqual(await clicks(), []);
  await wait(() =>
    js(
      `(()=>{const s=${ov}.getBoundingClientRect();return [...${ov}.querySelectorAll('[role=option]')].some(n=>{const r=n.getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom&&n.querySelector('canvas,img');});})()`,
    ),
  );
  await click(ox, oy);
  await wait(() => js('!overview.open'));
  assert.notEqual(await js('reader.scrollTop'), topBefore, 'A click on a thumbnail still jumps');
  await clicks();
  // 7. 书架：按在封面（按钮）上拖动照常滚动、不打开书；虚拟列表照常挂载；搜索框不参与。
  await key('b', 'KeyB', 66);
  await wait(() => js('shelf.open&&books.scrollHeight>books.clientHeight*2'));
  await delay(300);
  await js('books.scrollTop=0');
  await still('books');
  await clicks();
  const [bx, by] = await at(
    `[...document.querySelectorAll('#books .book .pick')].find(p=>{const r=p.getBoundingClientRect(),c=r.top+r.height/2;return c>books.getBoundingClientRect().top+10&&c<innerHeight-10;})`,
  );
  await drag(bx, by, 0, -250);
  const b1 = (await still('books'))[1];
  assert.ok(b1 > 250, 'Shelf scrolls when dragging a cover: ' + b1);
  assert.equal(await js('shelf.open'), true, 'No book opened by the drag');
  assert.deepEqual(await clicks(), []);
  // 虚拟列表：新位置上的卡片已挂载（与可见范围相交的卡片铺满一行以上）。
  assert.ok(
    await js(
      `(()=>{const h=books.getBoundingClientRect();return [...document.querySelectorAll('#books .book')].filter(c=>{const r=c.getBoundingClientRect();return r.bottom>h.top+h.height/2&&r.top<h.bottom;}).length>=3;})()`,
    ),
    'Cards are mounted at the new position',
  );
  const search = `shelf.querySelector('input[type=search],input')`;
  const [sx, sy] = await at(search);
  await drag(sx, sy, 0, -120);
  assert.equal((await still('books'))[1], b1, 'Dragging from the search box does not scroll');
  await clicks();
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));
  // 8. 设置、帮助：按在开关、选项按钮上拖动滚动，不切换开关。
  for (const [act, dialog] of [
    ['settings', 'settings'],
    ['help', 'help'],
  ]) {
    await js(`document.querySelector('#bar [data-act="${act}"]').click()`);
    await wait(() => js(`document.getElementById('${dialog}').open`));
    await delay(300);
    const box = `[...document.getElementById('${dialog}').querySelectorAll('*')].find(e=>/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)`;
    assert.ok(await js(`!!${box}`), dialog + ' has a scrolling area');
    const handle = `(${box}.querySelector('[role=switch]')||${box}.querySelector('button,[role=listitem]'))`;
    const state = () =>
      js(
        `[...document.querySelectorAll('#${dialog} [aria-checked],#${dialog} [aria-pressed]')].map(e=>e.getAttribute('aria-checked')??e.getAttribute('aria-pressed')).join()`,
      );
    const before = await state();
    await js(`${box}.scrollTop=0;${handle}.scrollIntoView({block:'nearest'})`);
    const [hx, hy] = await at(handle);
    const s0 = (await still(`(${box})`))[1];
    await clicks();
    await drag(hx, hy, 0, -(await js(`Math.min(150,${box}.scrollHeight-${box}.clientHeight-s0)`.replace('s0', s0))));
    const s1 = (await still(`(${box})`))[1];
    assert.ok(s1 > s0 + 20, dialog + ' scrolls: ' + [s0, s1]);
    assert.deepEqual(await clicks(), [], dialog + ': no click after a drag');
    assert.equal(await state(), before, dialog + ': switches unchanged');
    await js(`document.getElementById('${dialog}').close()`);
  }
  // 9. 通用规则（测试自建的滚动区域）：横向、纵向按容器实际可滚动的方向；按钮可拖动、拖动后不触发点击；
  // 输入框、滑杆、data-nodrag、原生可拖放（图片、链接）、调宽手柄、可编辑区、可选中的文字、滚动条本身都不参与。
  await js(`(()=>{const box=document.createElement('div');box.id='dsx';box.className='ds-box';
    box.style.cssText='position:fixed;left:300px;top:40px;width:340px;height:260px;overflow:auto;z-index:2147483647;background:#333;color:#fff';
    const P=(h,css)=>{const t=document.createElement('template');t.innerHTML=h;const e=t.content.firstElementChild;e.style.cssText='position:absolute;'+css;return e;};
    const inner=document.createElement('div');inner.style.cssText='position:relative;width:1000px;height:1400px';
    const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="red"/></svg>');
    inner.append(
      P('<p class="ds-text">Selectable text for copying</p>','left:10px;top:4px;margin:0;font-size:20px;line-height:30px'),
      P('<button class="ds-btn" type="button">Item</button>','left:10px;top:50px;width:120px;height:40px'),
      P('<input class="ds-input">','left:150px;top:50px;width:120px;height:30px'),
      P('<div class="ds-slider" role="slider" tabindex="0"></div>','left:10px;top:100px;width:120px;height:30px;background:#666'),
      P('<div class="ds-nodrag" data-nodrag></div>','left:150px;top:100px;width:120px;height:30px;background:#666'),
      P('<img class="ds-img" alt="">','left:10px;top:140px;width:60px;height:40px'),
      P('<a class="ds-link" href="#nowhere">link</a>','left:80px;top:140px;width:60px;height:40px;display:block;background:#666'),
      P('<div class="ds-grip"></div>','left:150px;top:140px;width:20px;height:40px;cursor:col-resize;background:#666'),
      P('<div class="ds-edit" contenteditable>edit me</div>','left:180px;top:140px;width:90px;height:40px;background:#666'),
    );
    inner.querySelector('img').src=svg;
    for(const e of inner.querySelectorAll('img,a'))e.addEventListener('dragstart',ev=>ev.preventDefault());
    box.append(inner);document.body.append(box);
    // 只能纵向滚动的列表里有一行只能横向滚动的条带。
    const list=document.createElement('div');list.id='dsy';list.className='ds-list';
    list.style.cssText='position:fixed;left:300px;top:320px;width:340px;height:200px;overflow-y:auto;overflow-x:hidden;z-index:2147483647;background:#333';
    list.innerHTML='<div class="ds-row" style="overflow-x:auto;overflow-y:hidden;height:80px"><div style="width:1200px;height:80px;background:linear-gradient(90deg,#444,#888)"></div></div><div style="height:900px"></div>';
    document.body.append(list);})()`);
  const sp = (sel) => pos(`document.querySelector('${sel}')`);
  const ds = `document.querySelector('#dsx')`;
  const reset = () => js(`${ds}.scrollLeft=0;${ds}.scrollTop=0;getSelection().removeAllRanges()`);
  await reset();
  // 空白处：两个方向都跟随，松手后惯性继续。
  await drag(560, 240, -120, -90);
  const both = await still(ds);
  assert.ok(both[0] > 120 && both[1] > 90, 'Both directions follow the pointer and glide: ' + both);
  await reset();
  await clicks();
  // 按钮（列表项）：拖动照常滚动，松手不触发点击；没有拖动时照常点击。
  const [ix, iy] = await at(`document.querySelector('.ds-btn')`);
  await drag(ix, iy, 0, -60, { pause: 120 });
  assert.deepEqual(await sp('#dsx'), [0, 60], 'A button can be dragged');
  assert.deepEqual(await clicks(), [], 'No click on the button after a drag');
  await reset();
  await click(ix, iy);
  assert.deepEqual(await clicks(), ['ds-btn'], 'A plain click on the button still works');
  for (const cls of ['ds-input', 'ds-slider', 'ds-nodrag', 'ds-img', 'ds-link', 'ds-grip', 'ds-edit']) {
    await reset();
    const [cx, cy] = await at(`document.querySelector('.${cls}')`);
    await drag(cx, cy, -50, -50, { pause: 80 });
    assert.deepEqual(await sp('#dsx'), [0, 0], cls + ' does not start a drag');
  }
  // 按在文字上：选中文字而不滚动；同一行文字右边的空白照常拖动。
  await reset();
  const [wx, wy] = await js(
    `(()=>{const g=document.createRange();g.selectNodeContents(document.querySelector('.ds-text').firstChild);const r=g.getClientRects()[0];return [r.left+3,r.top+r.height/2];})()`,
  );
  await drag(wx, wy, 120, 0, { pause: 80 });
  assert.deepEqual(await sp('#dsx'), [0, 0], 'Pressing on selectable text does not drag');
  assert.ok(await js('getSelection().toString().length>3'), 'Pressing on selectable text selects it');
  await reset();
  await drag(wx, wy + 30, 0, -50, { pause: 80 });
  assert.deepEqual(await sp('#dsx'), [0, 50], 'Blank space next to text drags');
  assert.equal(await js('getSelection().toString()'), '', 'Dragging does not select text');
  // 滚动条本身：照常是原生滚动条（往下拖滚动条，内容向下滚），不当作拖动内容。
  const bar = await js(`${ds}.offsetWidth-${ds}.clientWidth`);
  if (bar > 0) {
    await js(`${ds}.scrollTop=300`);
    const [rx, ry] = await js(
      `(()=>{const r=${ds}.getBoundingClientRect();return [r.right-${bar}/2,r.top+r.height/2];})()`,
    );
    await drag(rx, ry, 0, 40, { pause: 80 });
    assert.ok((await sp('#dsx'))[1] >= 300, 'Pressing the scrollbar is the native scrollbar');
  }
  // 嵌套：横向拖动滚动横向条带，纵向拖动滚动外层列表。
  const [hx, hy] = await at(`document.querySelector('.ds-row')`);
  await drag(hx, hy, -100, 0, { pause: 80 });
  assert.deepEqual(await sp('.ds-row'), [100, 0], 'Horizontal drag moves the horizontal strip');
  assert.deepEqual(await sp('#dsy'), [0, 0]);
  await drag(hx, hy, 0, -70, { pause: 80 });
  assert.deepEqual(await sp('#dsy'), [0, 70], 'Vertical drag on the strip moves the outer list');
  assert.deepEqual(await sp('.ds-row'), [100, 0]);
  // 只对鼠标：笔、触屏的按下拖动不走这套（用系统自带的滚动）。
  await reset();
  await js(`(()=>{const t=document.querySelector('#dsx > div'),o={pointerType:'pen',isPrimary:true,pointerId:7,bubbles:true,composed:true,button:0,buttons:1,clientX:560,clientY:240};
    t.dispatchEvent(new PointerEvent('pointerdown',o));for(let i=1;i<=5;i++)t.dispatchEvent(new PointerEvent('pointermove',{...o,button:-1,clientY:240-i*20}));
    t.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0,clientY:140}));})()`);
  assert.deepEqual(await sp('#dsx'), [0, 0], 'Pen presses are left to the system');
  // 拖动中截图自查：按下的按钮不保持按压缩放，没有选中文字。
  await drag(ix, iy, 0, -40, { up: false });
  await shot('dragscroll-midway');
  await release(ix, iy - 40);
  await js(`${ds}.remove();document.querySelector('#dsy').remove()`);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: drag scrolling with inertia in the page, thumbnail strip, shelf bookmarks, bookmark panel, full-screen thumbnails, shelf, settings and help; stops on wheel / key / press / jump; one scroll write per frame; same-direction flings add up; no clicks after a drag; controls, selectable text, native drag, grips and scrollbars excluded; nested horizontal / vertical',
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
