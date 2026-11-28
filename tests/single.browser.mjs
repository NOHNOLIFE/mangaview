// 单文件模式：每页占满一屏、按窗口完整显示；进入 / 退出停在同一页；各种翻页方式；书签、缩略图联动；媒体页；窗口调整；位置记忆。
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
if (!binary) throw Error('Usage: node tests/single.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-single-'));
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
  const key = async (key, code, vk, opts = {}) => {
    const text = key.length === 1 ? key : undefined;
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text, ...opts });
    if (!opts.hold) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  };
  const up = (key, code, vk) => cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  const KEYS = {
    d: ['d', 'KeyD', 68],
    a: ['a', 'KeyA', 65],
    s: ['s', 'KeyS', 83],
    w: ['w', 'KeyW', 87],
    right: ['ArrowRight', 'ArrowRight', 39],
    left: ['ArrowLeft', 'ArrowLeft', 37],
    down: ['ArrowDown', 'ArrowDown', 40],
    up: ['ArrowUp', 'ArrowUp', 38],
    pgdn: ['PageDown', 'PageDown', 34],
    pgup: ['PageUp', 'PageUp', 33],
    home: ['Home', 'Home', 36],
    end: ['End', 'End', 35],
    f: ['f', 'KeyF', 70],
    v: ['v', 'KeyV', 86],
  };
  const press = (k, opts) => key(...KEYS[k], opts);
  const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, ...extra });
  const click = async (x, y) => {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
  };
  const wheel = (x, y, deltaY) => mouse('mouseWheel', x, y, { deltaX: 0, deltaY });
  // 按住拖动：steps 步、每步约 16ms；pause 为松手前停住的毫秒数（停住则没有惯性）。
  async function drag(x, y, dy, { steps = 10, pause = 0 } = {}) {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x, y + (dy * i) / steps, { button: 'left', buttons: 1 });
      await delay(16);
    }
    if (pause) await delay(pause);
    await mouse('mouseReleased', x, y + dy, { button: 'left', buttons: 0, clickCount: 1 });
  }
  const B = (id) => `document.querySelector('#controlbar [data-id="${id}"]')`;
  const records = () => js(`import('./src/core/store.mjs').then(({library})=>library('getAll'))`);
  const record = async (title) => (await records()).find((b) => b.title === title);

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const size = (width, height) =>
    cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(800, 900);
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','true');`, // 自动播放默认关闭，这里测开启时的行为
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  // probe：视窗中心所在的页、它在视窗里的上沿与高度、中心处的页内位置；drawn：图片（object-fit）实际画出的区域；frame：等一帧。
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    window.probe=()=>{const r=reader.getBoundingClientRect(),cy=r.top+reader.clientHeight/2;
      for(const n of reader.querySelectorAll('.page')){const b=n.getBoundingClientRect();if(b.top<=cy&&b.bottom>cy)return {name:n.dataset.name,top:b.top-r.top,h:b.height,H:reader.clientHeight,f:(cy-b.top)/b.height,st:reader.scrollTop};}return null;};
    window.box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    window.drawn=e=>{const r=e.getBoundingClientRect(),nw=e.naturalWidth||e.videoWidth,nh=e.naturalHeight||e.videoHeight;let s=Math.min(r.width/nw,r.height/nh);
      if(getComputedStyle(e).objectFit==='scale-down')s=Math.min(1,s);const w=nw*s,h=nh*s,left=r.left+(r.width-w)/2,top=r.top+(r.height-h)/2;return {left,top,right:left+w,bottom:top+h,width:w,height:h};};
    window.view=()=>box(reader);
    window.dirOf=name=>navigator.storage.getDirectory().then(r=>r.getDirectoryHandle(name));`;
  await js(helpers);
  // 添加文件夹：点添加后若出现添加对话框，点它的默认确认按钮（添加为多个作品）；没有对话框时直接导入。
  async function addFolder(name, button) {
    await js(
      `(async()=>{const d=await dirOf(${JSON.stringify(name)});window.showDirectoryPicker=async()=>d;document.querySelector(${JSON.stringify(button)}).click();})()`,
    );
    await wait(async () => {
      if (await js('!!window.addDialog?.open')) {
        await js(`(document.getElementById('addMany')||addDialog.querySelector('[autofocus]')).click()`);
        return false;
      }
      return js(`bookTitle.textContent===${JSON.stringify(name)}`);
    });
  }
  // 两本书：Single（普通页、长条漫的长图、横图、小图、视频、音频、再几页普通页）、Other（切书用）。
  await js(`(async()=>{const root=await navigator.storage.getDirectory();
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/><circle cx="50%" cy="50%" r="'+Math.min(w,h)/3+'" fill="white" opacity=".35"/></svg>'],{type:'image/svg+xml'});
    const other=await root.getDirectoryHandle('Other',{create:true});
    for(const n of ['0','1'])await mvMedia.write(other,n+'.svg',svg(600,900,'gray'));
    const dir=await root.getDirectoryHandle('Single',{create:true});
    await mvMedia.write(dir,'00.svg',svg(600,900,'teal'));
    await mvMedia.write(dir,'01 tall.svg',svg(600,6000,'olive'));
    await mvMedia.write(dir,'02 wide.svg',svg(1600,400,'navy'));
    await mvMedia.write(dir,'03 small.svg',svg(200,150,'maroon'));
    await mvMedia.write(dir,'04 clip.webm',await mvMedia.webm({seconds:1.5,width:320,height:180}));
    await mvMedia.write(dir,'05 song.wav',mvMedia.wav({seconds:6}));
    for(let i=6;i<12;i++)await mvMedia.write(dir,String(i).padStart(2,'0')+'.svg',svg(600,900,'hsl('+i*40+',50%,40%)'));})()`);
  await addFolder('Other', '#empty [data-act="folder"]');
  await addFolder('Single', '#bar [data-act="folder"]');
  const NAMES = ['00.svg', '01 tall.svg', '02 wide.svg', '03 small.svg', '04 clip.webm', '05 song.wav'].concat(
    [6, 7, 8, 9, 10, 11].map((i) => String(i).padStart(2, '0') + '.svg'),
  );
  assert.deepEqual(
    (await record('Single')).pages.map((p) => p.name),
    NAMES,
  );
  await js('reader.focus()');

  // ---- 长条模式下把长图放到视窗中心（f=0.3），等尺寸读到、位置稳定。
  await js(`window.toSpot=async(name,f)=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=600;await frame();continue;}
    const want=n.offsetTop+n.offsetHeight*f-reader.clientHeight/2;if(n.querySelector('img')&&Math.abs(reader.scrollTop-want)<1&&i>3)return true;reader.scrollTop=want;await frame();}return false;}`);
  assert.ok(await js(`toSpot('01 tall.svg',.3)`));
  await delay(300);
  const p0 = await js('probe()');
  assert.equal(p0.name, '01 tall.svg');
  assert.ok(p0.h > p0.H * 2, 'The tall page is taller than the view in the strip');

  // ---- 进入单文件模式：停在同一页，槽 = 视窗，图片整张在视窗内（长图按高度完整显示）。
  const aligned = async () =>
    wait(async () => {
      const p = await js('frame().then(probe)');
      return p && Math.abs(p.top) < 1 && Math.abs(p.h - p.H) < 1 && p.name;
    });
  const inside = (r, v, what) =>
    assert.ok(
      r.left >= v.left - 0.5 && r.top >= v.top - 0.5 && r.right <= v.right + 0.5 && r.bottom <= v.bottom + 0.5,
      what + ' is inside the view ' + JSON.stringify([r, v]),
    );
  const fits = async (name, what) => {
    await wait(() => js(`!!node(${JSON.stringify(name)})?.querySelector('img')?.complete`));
    const [r, v] = await js(`[drawn(node(${JSON.stringify(name)}).querySelector('img')),view()]`);
    inside(r, v, what);
    assert.ok(
      Math.abs(r.width - v.width) < 1 || Math.abs(r.height - v.height) < 1,
      what + ' fills the view in one direction ' + JSON.stringify([r, v]),
    );
    assert.ok(
      Math.abs(r.left + r.width / 2 - (v.left + v.width / 2)) < 1 &&
        Math.abs(r.top + r.height / 2 - (v.top + v.height / 2)) < 1,
      what + ' is centred ' + JSON.stringify([r, v]),
    );
    return r;
  };
  await js(`${B('single')}.click()`);
  assert.equal(await js(`${B('single')}.getAttribute('aria-pressed')`), 'true');
  assert.ok(await js(`reader.classList.contains('single-file')`));
  assert.equal(await aligned(), '01 tall.svg', 'Entering keeps the page at the centre');
  await wait(() => js(`node('01 tall.svg').querySelector('img')?.complete`));
  const tall = await fits('01 tall.svg', 'Tall strip page');
  assert.ok(Math.abs(tall.height - (await js('reader.clientHeight'))) < 1, 'Tall page fits by height');
  assert.ok(
    await js(
      `[...reader.querySelectorAll('.page')].every(n=>Math.abs(n.getBoundingClientRect().height-reader.clientHeight)<1)`,
    ),
    'Every slot is one view high',
  );
  await shot('single-tall');
  // 退出：回到原来的位置（页内位置不变）。
  await js(`${B('single')}.click()`);
  await wait(() => js(`!reader.classList.contains('single-file')`));
  {
    const p = await js('frame().then(probe)');
    assert.equal(p.name, '01 tall.svg');
    assert.ok(Math.abs(p.f - p0.f) * p.h <= 1, 'Leaving returns to the same spot ' + JSON.stringify([p0, p]));
  }
  await js(`${B('single')}.click()`);
  assert.equal(await aligned(), '01 tall.svg');

  // ---- 翻页：A / D / ← / →、W / S / ↑ / ↓、Page Up / Page Down（不切书）、点击左右半屏。
  const turns = [
    ['d', '02 wide.svg'],
    ['a', '01 tall.svg'],
    ['right', '02 wide.svg'],
    ['left', '01 tall.svg'],
    ['s', '02 wide.svg'],
    ['w', '01 tall.svg'],
    ['down', '02 wide.svg'],
    ['up', '01 tall.svg'],
    ['pgdn', '02 wide.svg'],
    ['pgup', '01 tall.svg'],
  ];
  for (const [k, want] of turns) {
    await press(k);
    assert.equal(await aligned(), want, k + ' turns one page');
  }
  assert.equal(await js('bookTitle.textContent'), 'Single', 'Page Up / Page Down stay in the book');
  const v0 = await js('view()'),
    cy = v0.top + v0.height / 2;
  await click(v0.left + v0.width * 0.75, cy);
  assert.equal(await aligned(), '02 wide.svg', 'Right half: next file');
  await wait(() => js(`node('02 wide.svg').querySelector('img')?.complete`));
  const wide = await fits('02 wide.svg', 'Wide page');
  assert.ok(Math.abs(wide.width - v0.width) < 1, 'Wide page fits by width');
  await shot('single-wide');
  await click(v0.left + v0.width * 0.25, cy);
  assert.equal(await aligned(), '01 tall.svg', 'Left half: previous file');
  // 滚轮：一格一页；快速连续转动不会一次翻过多页。
  await wheel(v0.left + v0.width / 2, cy, 100);
  assert.equal(await aligned(), '02 wide.svg', 'One wheel notch: next file');
  await delay(400);
  await wheel(v0.left + v0.width / 2, cy, -100);
  assert.equal(await aligned(), '01 tall.svg', 'One wheel notch up: previous file');
  await delay(400);
  const idx = () => js('probe()').then((p) => NAMES.indexOf(p.name));
  for (let i = 0; i < 8; i++) {
    await wheel(v0.left + v0.width / 2, cy, 100);
    await delay(15);
  }
  await aligned();
  const spun = (await idx()) - 1;
  assert.ok(spun >= 1 && spun <= 2, 'A fast spin of the wheel turns at most a couple of pages: ' + spun);
  await delay(400);
  // 触控板式的连续小位移：一次滑动只翻一页。
  const before = await idx();
  for (let i = 0; i < 20; i++) {
    await wheel(v0.left + v0.width / 2, cy, 12);
    await delay(10);
  }
  await aligned();
  assert.equal((await idx()) - before, 1, 'One touchpad swipe turns one page');
  await delay(400);

  // ---- 首尾：与书首 / 书尾一致（Home / End 到首尾页；在首页往前、末页往后不动，不切书）。
  await press('home');
  assert.equal(await aligned(), '00.svg');
  await press('a');
  await delay(200);
  assert.equal(await aligned(), '00.svg', 'Nothing before the first page');
  await press('end');
  assert.equal(await aligned(), '11.svg');
  await press('d');
  await delay(200);
  assert.equal(await aligned(), '11.svg', 'Nothing after the last page');
  assert.equal(await js('bookTitle.textContent'), 'Single');
  assert.equal(await js(`controlbar.hidden||${B('toEnd')}.disabled`), true);

  // ---- 引擎接口 ctx.single：index / go / next / prev（next / prev 返回是否翻了页）。
  assert.deepEqual(
    await js(
      `import('./src/reader/single.mjs').then(async m=>{const out=[m.index()];out.push(m.flip(1));out.push(m.go(3),m.index());await frame();out.push(probe().name,m.flip(-1),m.index());return out;})`,
    ),
    [11, false, true, 3, '03 small.svg', true, 2],
  );
  await press('d');
  assert.equal(await aligned(), '03 small.svg');

  // ---- 宽度缩放设置：适应宽度时小图放大到窗口；关闭后按原尺寸（不放大）居中。
  await wait(() => js(`node('03 small.svg').querySelector('img')?.complete`));
  const small = await fits('03 small.svg', 'Small image, fit');
  assert.ok(small.width > 700, 'Fit enlarges the small image ' + JSON.stringify(small));
  await js(`document.querySelector('#bar [data-act="fit"]').click()`);
  assert.equal(await aligned(), '03 small.svg', 'Toggling fit keeps the page');
  {
    const [r, v] = await js(`[drawn(node('03 small.svg').querySelector('img')),view()]`);
    assert.ok(Math.abs(r.width - 200) < 1 && Math.abs(r.height - 150) < 1, 'Natural size ' + JSON.stringify(r));
    inside(r, v, 'Natural-size image');
  }
  await js(`document.querySelector('#bar [data-act="fit"]').click()`);
  assert.equal(await aligned(), '03 small.svg');

  // ---- 媒体：视频在槽内按窗口完整显示、自动播放并成为选中媒体；音频是居中的卡片；只有当前页的媒体持有源。
  await press('d');
  assert.equal(await aligned(), '04 clip.webm');
  await wait(() => js(`el('04 clip.webm')?.readyState>=1`));
  {
    const [n, r, v] = await js(`[box(node('04 clip.webm')),drawn(el('04 clip.webm')),view()]`);
    assert.ok(
      Math.abs(n.top - v.top) < 1 && Math.abs(n.height - v.height) < 1 && Math.abs(n.width - v.width) < 1,
      'Video slot is the view',
    );
    inside(r, v, 'Video picture');
    assert.ok(Math.abs(r.width - v.width) < 1, 'Video fills the width ' + JSON.stringify(r));
  }
  await wait(() => js(`!el('04 clip.webm').paused`), 'video autoplays');
  await wait(() => js(`node('04 clip.webm').classList.contains('selected')`), 'autoplayed video is selected');
  assert.equal(await js(`!el('05 song.wav')?.currentSrc`), true, 'The next media holds no source');
  await shot('single-video');
  await press('d');
  assert.equal(await aligned(), '05 song.wav');
  {
    const [c, v] = await js(`[box(node('05 song.wav').querySelector('.mv-card')),view()]`);
    assert.ok(Math.abs(c.height - 160) < 1, 'Audio card keeps its height ' + JSON.stringify(c));
    assert.ok(Math.abs(c.top + c.height / 2 - (v.top + v.height / 2)) < 1, 'Audio card is centred vertically');
    assert.ok(c.width > v.width - 40 && c.left >= v.left, 'Audio card spans the view');
  }
  await wait(
    () => js(`!node('04 clip.webm')?.classList.contains('selected')`),
    'turned-away video is no longer selected',
  );
  assert.equal(await js(`!el('04 clip.webm')||el('04 clip.webm').paused`), true, 'The video stops when turned away');
  await shot('single-audio');

  // ---- 缩略图栏：点缩略图跳到那一页；视窗标记正好框住当前页；侧栏开合、窗口调整仍停在当前页。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`document.body.classList.contains('docked')`));
  assert.equal(await aligned(), '05 song.wav', 'Docking the panel keeps the page');
  await wait(() => js(`!!document.querySelector('#preview .page[title="08.svg"]')`));
  {
    const [x, y] = await js(
      `(async()=>{const n=document.querySelector('#preview .page[title="08.svg"]');preview.dispatchEvent(new WheelEvent('wheel'));preview.scrollTop=n.offsetTop-20;await frame();await frame();const r=n.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height*.8];})()`,
    );
    await click(x, y);
  }
  assert.equal(await aligned(), '08.svg', 'Clicking a thumbnail opens its page');
  assert.equal(
    await js(`!!document.querySelector('#preview .viewport-marker')`),
    false,
    'No viewport area on the strip',
  );
  await fits('08.svg', 'Page beside the docked panel');
  await shot('single-docked');
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`!document.body.classList.contains('docked')`));
  assert.equal(await aligned(), '08.svg', 'Undocking keeps the page');
  for (const [w, h] of [
    [600, 700],
    [1000, 600],
    [800, 900],
  ]) {
    await size(w, h);
    await delay(350);
    assert.equal(await aligned(), '08.svg', 'Resizing keeps the page ' + [w, h]);
    await fits('08.svg', 'Page after resizing to ' + [w, h]);
  }
  // 全屏缩略图：选一页跳过去。
  await press('v');
  await wait(() => js(`!!document.querySelector('.ov-item[data-i="2"]')`));
  await js(`document.querySelector('.ov-item[data-i="2"]').click()`);
  assert.equal(await aligned(), '02 wide.svg', 'Full-screen thumbnails open the page');
  await wait(() => js(`!document.querySelector('dialog[open]')`));
  await js('reader.focus()');

  // ---- 拖动：没过半屏松手回到本页，过半屏到下一页；带惯性时停下后吸附到整页。
  await press('end');
  await press('home');
  for (let i = 0; i < 6; i++) await press('d');
  assert.equal(await aligned(), '06.svg');
  const v1 = await js('view()'),
    mx = v1.left + v1.width * 0.5,
    my = v1.top + v1.height * 0.8;
  await drag(mx, my, -300, { pause: 150 });
  assert.ok(Math.abs((await js('probe()')).top) > 100, 'Dragging moves the page with the pointer');
  assert.equal(await aligned(), '06.svg', 'A short drag snaps back');
  await drag(mx, my, -600, { pause: 150 });
  assert.equal(await aligned(), '07.svg', 'Dragging past half a view snaps to the next page');
  await drag(mx, my, -400, { steps: 6 });
  await delay(60);
  const gliding = await js('reader.scrollTop');
  const landed = await aligned();
  assert.ok(NAMES.indexOf(landed) >= NAMES.indexOf('07.svg'), 'Glides forward');
  assert.ok(
    (await js('reader.scrollTop')) % (await js('reader.clientHeight')) === 0 && gliding > 0,
    'The glide ends on a whole page',
  );

  // ---- 书签：在长图上添加书签，记录的是长图在长条里的位置；F 跳回该页；退出单文件模式后跳转同样正确。
  await press('home');
  await press('d');
  assert.equal(await aligned(), '01 tall.svg');
  await press('f', { hold: true });
  await delay(750);
  await up(...KEYS.f);
  const mark = await wait(async () => (await record('Single')).bookmarks.find((b) => b.name === '01 tall.svg'));
  assert.ok(mark.f > 0 && mark.f < 1, 'Bookmark has an in-page position');
  await press('end');
  await press('f');
  assert.equal(await aligned(), '01 tall.svg', 'F jumps to the bookmarked page');
  await js(`${B('single')}.click()`);
  await wait(() => js(`!reader.classList.contains('single-file')`));
  {
    const p = await js('frame().then(probe)');
    assert.equal(p.name, '01 tall.svg');
    assert.ok(Math.abs(p.f - mark.f) * p.h <= 1, 'Leaving lands on the bookmark ' + JSON.stringify([mark, p]));
  }
  // 长条模式下从别处跳到这个书签也落在同一处。
  await js('reader.scrollTop=reader.scrollHeight');
  await delay(200);
  await press('f');
  await delay(200);
  {
    const p = await js('frame().then(probe)');
    assert.equal(p.name, '01 tall.svg');
    assert.ok(Math.abs(p.f - mark.f) * p.h <= 1, 'Bookmark added in single mode works in the strip');
  }
  // 退出时停在别的页：长图的上沿对齐视窗顶部，普通页居中。
  await js(`${B('single')}.click()`);
  assert.equal(await aligned(), '01 tall.svg');
  await press('home');
  await press('d');
  await press('d');
  await press('a');
  await press('a');
  await press('d');
  assert.equal(await aligned(), '01 tall.svg');
  await press('d');
  await press('d');
  await press('d');
  await press('d');
  await press('d');
  await press('d');
  await press('d');
  assert.equal(await aligned(), '08.svg');
  await js(`${B('single')}.click()`);
  await wait(() => js(`!reader.classList.contains('single-file')`));
  {
    const p = await js('frame().then(probe)');
    assert.equal(p.name, '08.svg');
    assert.ok(p.h > p.H && Math.abs(p.top) < 1, 'A page taller than the view starts at its top ' + JSON.stringify(p));
  }
  await js(`${B('single')}.click()`);
  assert.equal(await aligned(), '08.svg');
  await js(`import('./src/reader/single.mjs').then(m=>m.go(2))`);
  assert.equal(await aligned(), '02 wide.svg');
  await js(`${B('single')}.click()`);
  await wait(() => js(`!reader.classList.contains('single-file')`));
  {
    const p = await js('frame().then(probe)');
    assert.equal(p.name, '02 wide.svg');
    assert.ok(
      p.h < p.H && Math.abs(p.f - 0.5) * p.h <= 1,
      'A page shorter than the view is centred ' + JSON.stringify(p),
    );
  }
  await js(`${B('single')}.click()`);
  assert.equal(await aligned(), '02 wide.svg');
  await js(`import('./src/reader/single.mjs').then(m=>m.go(1))`);
  assert.equal(await aligned(), '01 tall.svg');
  await js(`${B('single')}.click()`);
  await wait(() => js(`!reader.classList.contains('single-file')`));
  {
    const p = await js('frame().then(probe)');
    assert.equal(p.name, '01 tall.svg');
    assert.ok(Math.abs(p.top) < 1, 'A tall page starts at the top of the view after leaving ' + JSON.stringify(p));
  }
  await js(`${B('single')}.click()`);
  assert.equal(await aligned(), '01 tall.svg');

  // ---- 位置记忆：刷新后仍是单文件模式、停在同一页；切书再回来也停在这一页。
  for (let i = 0; i < 6; i++) await press('d');
  assert.equal(await aligned(), '07.svg');
  await delay(600);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Single'`));
  await js(helpers);
  assert.ok(await js(`reader.classList.contains('single-file')`), 'Single mode is remembered');
  assert.equal(await aligned(), '07.svg', 'Reload keeps the page');
  await js('reader.focus()');
  await press('s', { modifiers: 8 });
  await wait(() => js(`bookTitle.textContent==='Other'`));
  assert.equal(await aligned(), '0.svg');
  await press('w', { modifiers: 8 });
  await wait(() => js(`bookTitle.textContent==='Single'`));
  assert.equal(await aligned(), '07.svg', 'Switching books keeps the page');
  assert.match(await js('bookMeta.textContent'), /^8 \/ 12/, 'Page number');
  // 别的窗口切换单文件模式：跟随，仍停在同一页。
  const storage = (v) =>
    js(
      `(()=>{const key='mv2:singleFile',v=${JSON.stringify(JSON.stringify(v))};localStorage.setItem(key,v);dispatchEvent(new StorageEvent('storage',{key,newValue:v,storageArea:localStorage}));})()`,
    );
  await storage(false);
  await wait(() => js(`!reader.classList.contains('single-file')`));
  assert.equal((await js('frame().then(probe)')).name, '07.svg', 'Synced from another window: same page');
  await storage(true);
  assert.equal(await aligned(), '07.svg');

  assert.deepEqual(errors, []);
  console.log(
    'PASS: single file: entering / leaving keeps the page, whole-page display (tall, wide, small, fit), keys / clicks / wheel / drag turn pages, first / last page, engine interface, media pages, thumbnails and docking, resizing, bookmarks across modes, remembered position',
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
