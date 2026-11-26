// 全屏缩略图端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/overview.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-overview-'));
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
  // 本测试固定侧栏状态：书架书签常驻、缩略图栏不常驻（默认值由其他测试覆盖）。
  await js(`localStorage.setItem('mv2:shelfmarks','true');localStorage.setItem('mv2:preview','false')`);
  await cdp('Page.reload');
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 统计读取原图的次数（getFile 只在读图或校验文件信息时调用；目录列表不调用）。
  await js(
    `(()=>{const g=FileSystemFileHandle.prototype.getFile;window.reads=[];FileSystemFileHandle.prototype.getFile=function(){reads.push(this.name);return g.call(this);};})()`,
  );
  // 一本 40 张的书：两种比例交替，第 10 张是超长条。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Long',{create:true});
    for(let i=0;i<40;i++){const [w,h]=i===9?[400,4000]:i%2?[600,1000]:[600,900];const out=await (await dir.getFileHandle(String(i).padStart(2,'0')+'.svg',{create:true})).createWritable();
      await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="hsl('+i*9+',60%,45%)"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(() => js(`bookTitle.textContent==='Long'`));
  const W = await js('innerWidth');
  const move = (x, y = 150) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const click = async (x, y) => {
    await move(x, y);
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const center = (sel) =>
    js(
      `(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width};})()`,
    );
  const keys = {
    d: ['KeyD', 68],
    s: ['KeyS', 83],
    w: ['KeyW', 87],
    a: ['KeyA', 65],
    v: ['KeyV', 86],
    ']': ['BracketRight', 221],
    ArrowRight: ['ArrowRight', 39],
    ArrowLeft: ['ArrowLeft', 37],
    ArrowDown: ['ArrowDown', 40],
    ArrowUp: ['ArrowUp', 38],
    Home: ['Home', 36],
    End: ['End', 35],
    Enter: ['Enter', 13],
    ' ': ['Space', 32],
    Escape: ['Escape', 27],
    g: ['KeyG', 71],
    c: ['KeyC', 67],
    '[': ['BracketLeft', 219],
    PageDown: ['PageDown', 34],
    b: ['KeyB', 66],
  };
  const press = async (k) => {
    const [code, vk] = keys[k],
      text = k.length === 1 ? k : k === 'Enter' ? '\r' : undefined,
      modifiers = 0;
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      modifiers,
      ...(text ? { text } : {}),
    });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const isOpen = () => js('overview.open&&!overview.classList.contains("closing")'),
    closed = () => js('!overview.open');
  const sel = () =>
    js(
      `(()=>{const n=document.querySelector('.ov-item.sel');return n&&{i:+n.dataset.i,x:parseFloat(n.style.left),y:parseFloat(n.style.top)};})()`,
    );
  const pos = () => js('document.querySelector(".ov-pos").textContent');
  const panelHidden = () => js('document.getElementById("panel").hidden');
  // 鼠标从阅读区移入右上角不再打开全屏缩略图：右缘照常弹出缩略图栏。右缘热区 32px：距右缘 40px 不触发，30px 触发。
  await move(400);
  await move(W - 2);
  await delay(500);
  assert.equal(await js('overview.open'), false, 'Corner gesture is gone');
  await wait(async () => !(await panelHidden()));
  await move(400, 500);
  await wait(panelHidden);
  await move(W - 40, 500);
  await delay(400);
  assert.equal(await panelHidden(), true, '40px from the edge does not trigger');
  await move(W - 30, 500);
  await delay(60);
  assert.equal(await panelHidden(), true, 'Edge needs a short dwell');
  await wait(async () => !(await panelHidden()));
  // 缩略图栏顶部：打开全屏缩略图的按钮（内侧，靠阅读区）、标题和页数；点击打开并收起浮动的窄条。
  // 头部就是一个占满整行的块状按钮（图标 + 文字 + 页数），点击区域大。
  assert.equal(await js('document.querySelector("#panel .pv-head").textContent'), 'Full screen40');
  const pvBtn = await center('#panel .pv-head .side-open'),
    pvBox = await js(
      '(r=>({left:r.left,top:r.top,width:r.width}))(document.getElementById("panel").getBoundingClientRect())',
    );
  assert.ok(
    pvBtn.y < pvBox.top + 52 && pvBtn.w >= pvBox.width - 32,
    'Block button fills the head row: ' + JSON.stringify([pvBtn, pvBox]),
  );
  assert.ok(
    (await js('document.querySelector("#panel .side-open").getBoundingClientRect().height')) >= 34,
    'Tall enough to hit easily',
  );
  assert.equal(await js('document.querySelector("#panel .side-open").title'), 'Full-screen thumbnails (V)');
  await shot('strip-head');
  await click(pvBtn.x, pvBtn.y);
  await wait(isOpen);
  await wait(panelHidden);
  assert.equal(await pos(), 'Page 1 / 40');
  assert.equal((await sel()).i, 0);
  // 规整网格：等宽等高，按行对齐，多列，不重叠；超长条页的格子不比别的高，只显示顶部。滚动条加宽。
  const boxes = await js(
    `[...document.querySelectorAll('.ov-item')].map(n=>[+n.dataset.i,parseFloat(n.style.left),parseFloat(n.style.top),parseFloat(n.style.width),parseFloat(n.style.height)]).sort((a,b)=>a[0]-b[0])`,
  );
  const cols = new Set(boxes.map((b) => b[1])).size;
  assert.ok(cols >= 4, 'Several columns: ' + cols);
  assert.equal(new Set(boxes.map((b) => b[3])).size, 1, 'Equal widths');
  assert.equal(new Set(boxes.map((b) => b[4])).size, 1, 'Equal heights');
  for (const b of boxes) {
    assert.equal(b[2], boxes[b[0] - (b[0] % cols)][2], 'Rows are aligned');
    assert.equal(b[1], boxes[b[0] % cols][1], 'Columns are aligned');
  }
  assert.equal(
    await js('(s=>s.offsetWidth-s.clientWidth)(document.querySelector(".ov-scroll"))'),
    20,
    'Wide scrollbar',
  );
  await wait(() => js('document.querySelectorAll(".ov-item :is(canvas,img)").length>=12'));
  await wait(() => js(`document.querySelector('.ov-item[data-i="9"]').classList.contains('tall')`));
  assert.equal(await js(`document.querySelector('.ov-item[data-i="8"]').classList.contains('tall')`), false);
  // 先把整本书滚一遍，让每页都生成过一次缩略图（之后测缓存）。
  for (let k = 0; k < 8; k++) {
    await js('(s=>s.scrollTop=s.clientHeight*' + k + '/2)(document.querySelector(".ov-scroll"))');
    await delay(60);
    await wait(() => js('[...document.querySelectorAll(".ov-item")].every(n=>n.querySelector(".ov-img>*"))'));
  }
  // 键盘：A/D、←/→ 按页序；W/S、↑/↓ 按网格行（同一列）移动。
  await press('d');
  await press('ArrowRight');
  assert.equal((await sel()).i, 2);
  assert.equal(await pos(), 'Page 3 / 40');
  // 当前阅读页：与选中同一描边，不缩小。
  await delay(250);
  assert.deepEqual(
    await js(
      `(()=>{const h=getComputedStyle(document.querySelector('.ov-item.here')),s=getComputedStyle(document.querySelector('.ov-item.sel'));return [document.querySelector('.ov-item.here').dataset.i,h.boxShadow===s.boxShadow,h.transform];})()`,
    ),
    ['0', true, 'none'],
    'Reading page is outlined like the selection',
  );
  const a = await sel();
  await press('s');
  const b = await sel();
  assert.equal(b.x, a.x);
  assert.equal(b.i, a.i + cols, 'S moves one row down');
  await press('ArrowDown');
  const c = await sel();
  assert.equal(c.i, a.i + 2 * cols);
  await press('w');
  await press('ArrowUp');
  assert.deepEqual(await sel(), a);
  await press('a');
  await press('ArrowLeft');
  assert.equal((await sel()).i, 0);
  await press('End');
  await wait(async () => (await sel())?.i === 39);
  await delay(300);
  assert.ok(
    await js(
      '(s=>{const n=document.querySelector(".ov-item.sel").getBoundingClientRect(),r=s.getBoundingClientRect();return n.top>=r.top&&n.bottom<=r.bottom;})(document.querySelector(".ov-scroll"))',
    ),
    'Selection scrolled into view',
  );
  await press('ArrowDown');
  assert.equal((await sel()).i, 39, 'Nothing below the last row');
  await press('Home');
  await press('PageDown');
  const pd = await wait(sel);
  assert.ok(pd.i > 0 && pd.i % cols === 0, 'Page Down stays in the column');
  // 选中样式：缩小（不放大遮挡邻居）加描边；鼠标移到哪格就选中哪格，同一时间只有一格选中。
  await press('Home');
  await delay(250);
  const scale = () =>
    js(`(m=>m==='none'?1:new DOMMatrix(m).a)(getComputedStyle(document.querySelector('.ov-item.sel')).transform)`);
  assert.ok((await scale()) < 1, 'Selected tile shrinks');
  const t5 = await center('.ov-item[data-i="5"]');
  await move(t5.x, t5.y);
  await wait(async () => (await sel())?.i === 5);
  assert.equal(await js('document.querySelectorAll(".ov-item.sel").length'), 1);
  assert.equal(await pos(), 'Page 6 / 40');
  await press('d');
  assert.equal((await sel()).i, 6, 'Keyboard continues from the hovered tile');
  await move(t5.x, t5.y);
  assert.equal((await sel()).i, 6, 'A stationary pointer does not steal the selection');
  // 瀑布流：标题行的按钮切换（图标、提示随模式变化），按页面比例逐列排布，长条封顶 3 倍列宽；键盘、悬停、缩小式选中照常。
  const lay = () =>
    js(
      '(b=>[b.title,b.getAttribute("aria-label"),b.querySelector("use").getAttribute("href")])(document.querySelector("#overview .ov-layout"))',
    );
  assert.deepEqual(await lay(), [
    'Layout: grid (click for masonry)',
    'Layout: grid (click for masonry)',
    '#i-overview',
  ]);
  const lb = await center('#overview .ov-layout');
  await click(lb.x, lb.y);
  assert.deepEqual(await lay(), ['Layout: masonry (click for grid)', 'Layout: masonry (click for grid)', '#i-masonry']);
  assert.equal(await js('document.activeElement.classList.contains("ov-scroll")'), true, 'Focus returns to the list');
  assert.equal(await js(`localStorage.getItem('mv2:ovLayout')`), '"masonry"');
  await delay(200);
  await shot('overview-masonry');
  const mbox = await js(
    `[...document.querySelectorAll('.ov-item')].map(n=>[+n.dataset.i,parseFloat(n.style.left),parseFloat(n.style.top),parseFloat(n.style.width),parseFloat(n.style.height)])`,
  );
  assert.ok(new Set(mbox.map((b) => b[4])).size > 1, 'Heights follow the pages');
  for (const [i, p] of mbox.entries())
    for (const q of mbox.slice(i + 1))
      assert.ok(
        p[1] + p[3] <= q[1] || q[1] + q[3] <= p[1] || p[2] + p[4] <= q[2] || q[2] + q[4] <= p[2],
        'Tiles do not overlap',
      );
  await press('Home');
  for (let i = 0; i < 9; i++) await press('d');
  const m9 = await wait(sel);
  assert.equal(m9.i, 9);
  assert.ok(
    await js(
      '(n=>n.offsetHeight<=n.offsetWidth*3+1&&n.classList.contains("tall"))(document.querySelector(\'.ov-item[data-i="9"]\'))',
    ),
    'Long strips are capped',
  );
  await press('s');
  const m10 = await wait(sel);
  assert.equal(m10.x, m9.x);
  assert.ok(m10.y > m9.y, 'S stays in the column');
  await press('w');
  assert.equal((await sel()).i, 9);
  await delay(250);
  assert.ok((await scale()) < 1, 'Masonry selection shrinks');
  const vis = await js(
    `(s=>{const r=s.getBoundingClientRect();const n=[...document.querySelectorAll('.ov-item:not(.sel)')].find(n=>{const b=n.getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom;});const b=n.getBoundingClientRect();return {i:+n.dataset.i,x:b.x+b.width/2,y:b.y+b.height/2};})(document.querySelector('.ov-scroll'))`,
  );
  await move(vis.x, vis.y);
  await wait(async () => (await sel())?.i === vis.i);
  await press('Escape');
  await wait(closed);
  await press('v');
  await wait(isOpen);
  assert.equal((await lay())[2], '#i-masonry', 'Layout is remembered');
  await click(lb.x, lb.y);
  assert.equal((await lay())[2], '#i-overview');
  assert.equal(await js(`localStorage.getItem('mv2:ovLayout')`), '"grid"');
  // Enter 跳到该页顶部并关闭。
  await press('Home');
  for (let i = 0; i < 9; i++) await press('d');
  await wait(async () => (await sel())?.i === 9);
  await press('Enter');
  await wait(closed);
  const at = (n) =>
    js(`Math.abs(parseFloat(document.querySelector('#reader .page[data-n="${n}"]').style.top)-reader.scrollTop)<2`);
  await wait(() => at(10));
  // 缓存：等正文读完，再打开全屏缩略图——缩略图立即显示（缓存命中是 <img>），不再读任何原图。
  await move(400, 500);
  await delay(600);
  await js('reads.length=0');
  await js('reader.focus()');
  await press('v');
  await wait(isOpen);
  assert.equal((await sel()).i, 9, 'Opens at the current page');
  assert.equal(
    await js(
      '[...document.querySelectorAll(".ov-item")].filter(n=>!n.querySelector(".ov-img>img")).map(n=>n.dataset.i).join()',
    ),
    '',
    'Cached thumbnails show at once',
  );
  await delay(500);
  assert.deepEqual(await js('reads'), [], 'Reopening reads no images');
  // 点击缩略图跳转并关闭。
  const box = await center('.ov-item[data-i="11"]');
  await click(box.x, box.y);
  await wait(closed);
  await wait(() => at(12));
  // V / ] 打开、关闭；Esc 关闭；空格选择。
  await move(400);
  await js('reader.focus()');
  await press('v');
  await wait(isOpen);
  await press('v');
  await wait(closed);
  await press(']');
  await wait(isOpen);
  await press('Escape');
  await wait(closed);
  await press(']');
  await wait(isOpen);
  await press('d');
  await press(' ');
  await wait(closed);
  await wait(() => at(13));
  // 全屏书架书签：先在两本书里加书签（长按 F）。
  const holdG = async () => {
    await js('reader.focus()');
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'f',
      code: 'KeyF',
      windowsVirtualKeyCode: 70,
      text: 'f',
    });
    await delay(750);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 });
  };
  const count = () => js('document.querySelectorAll("#shelfmarks .bm-item").length');
  assert.equal(
    await js('document.querySelector("#shelfmarks .side-open").disabled'),
    true,
    'No bookmarks: button disabled',
  );
  await move(400);
  await js('reader.scrollTop=3000');
  await delay(100);
  await holdG();
  await wait(async () => (await count()) === 1);
  await js('reader.scrollTop=9000');
  await delay(100);
  await holdG();
  await wait(async () => (await count()) === 2);
  assert.equal(await js('document.querySelector("#shelfmarks .side-open").disabled'), false);
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Short',{create:true});
    for(let i=0;i<4;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="navy"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#bar [data-act="folder"]').click();})()`);
  await wait(() => js(`bookTitle.textContent==='Short'`));
  await js('reader.scrollTop=500');
  await delay(100);
  await holdG();
  await wait(async () => (await count()) === 3);
  // 切书后回来：缓存仍在，全屏缩略图不再读图。
  await js(`document.querySelector('#endbar [data-act="next"]').click()`);
  await wait(() => js(`bookTitle.textContent==='Long'`));
  await js('reader.scrollTop=9000');
  await delay(800);
  await js('reads.length=0');
  await js('reader.focus()');
  await press('v');
  await wait(isOpen);
  await delay(400);
  assert.equal(
    await js('[...document.querySelectorAll(".ov-item")].every(n=>n.querySelector(".ov-img>img"))'),
    true,
    'Cache survives switching books',
  );
  assert.deepEqual(await js('reads'), [], 'No reads after switching back');
  await press('Escape');
  await wait(closed);
  // 文件改动：窗口重新获得焦点后，显示时校验文件信息（只读元数据），变了的页重新生成。
  await js(
    `navigator.storage.getDirectory().then(r=>r.getDirectoryHandle('Long')).then(d=>d.getFileHandle('12.svg')).then(h=>h.createWritable()).then(async o=>{await o.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="white"/><circle cx="300" cy="450" r="200" fill="red"/></svg>');await o.close();})`,
  );
  await delay(50);
  await js('reads.length=0;window.dispatchEvent(new Event("focus"))');
  await delay(100);
  await js('reader.focus()');
  await press('v');
  await wait(isOpen);
  await wait(() => js(`!!document.querySelector('.ov-item[data-i="12"] .ov-img>canvas')`));
  assert.ok(
    await js(
      `(c=>{const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return p[0]>200&&p[1]<80;})(document.querySelector('.ov-item[data-i="12"] canvas'))`,
    ),
    'Changed page regenerated',
  );
  assert.equal(
    await js(`!!document.querySelector('.ov-item[data-i="11"] .ov-img>img')`),
    true,
    'Unchanged pages stay cached',
  );
  await press('Escape');
  await wait(closed);
  // 书架书签列表顶部的按钮（内侧上角，与缩略图栏镜像）：专注模式下内容隐藏时不可点，悬停显示后才能点。
  await js(`document.querySelector('#endbar [data-act="next"]').click()`);
  await wait(() => js(`bookTitle.textContent==='Short'`));
  const smOpen = () => js('shelfOverview.open&&!shelfOverview.classList.contains("closing")'),
    mClosed = () => js('!shelfOverview.open');
  const smBtn = await center('#shelfmarks .side-open'),
    dockW = await js('document.getElementById("shelfmarks").getBoundingClientRect().width');
  assert.ok(smBtn.w >= dockW - 32 && smBtn.y < 52, 'Left block button fills the head row');
  assert.equal(await js('document.querySelector("#shelfmarks .sm-head").textContent'), 'Full screen3');
  await move(400, 300);
  await delay(500);
  assert.equal(
    await js(`getComputedStyle(document.querySelector('#shelfmarks .side-open')).visibility`),
    'hidden',
    'Hidden button cannot be clicked',
  );
  await move(smBtn.x, smBtn.y);
  await wait(() => js(`getComputedStyle(document.querySelector('#shelfmarks .side-open')).visibility==='visible'`));
  await click(smBtn.x, smBtn.y);
  await wait(smOpen);
  // 按书分组（书架顺序：最后添加的 Short 在前），当前书高亮，选中屏幕中心附近的书签。
  const msel = () => js('(n=>n&&+n.dataset.k)(document.querySelector("#shelfOverview .ov-mark.sel"))');
  assert.equal(
    await js('[...document.querySelectorAll("#shelfOverview .ov-sec-head strong")].map(n=>n.textContent).join()'),
    'Short,Long',
  );
  assert.equal(await js('document.querySelector("#shelfOverview .ov-sec.current strong").textContent'), 'Short');
  assert.equal(await msel(), 0);
  await press('Escape');
  await wait(mClosed);
  await js(`document.querySelector('#endbar [data-act="next"]').click()`);
  await wait(() => js(`bookTitle.textContent==='Long'`));
  await js('reader.scrollTop=9000');
  await delay(100);
  await move(400, 300);
  await js('reader.focus()');
  await press('c');
  await wait(smOpen);
  assert.equal(await msel(), 2);
  assert.equal(await js('document.querySelector("#shelfOverview .ov-pos").textContent'), 'Bookmark 3 / 3 · Long');
  await shot('shelf-overview');
  // 选中项缩小动画结束后（getBoundingClientRect 含 transform），W / ↑ 仍越过同一行去上一行。
  await delay(250);
  await press('w');
  assert.equal(await msel(), 0, "W skips the shrunken selection's own row");
  await press('s');
  assert.equal(await msel(), 1);
  await press('d');
  assert.equal(await msel(), 2);
  await delay(250);
  await press('ArrowUp');
  assert.equal(await msel(), 0, 'ArrowUp too');
  await press('s');
  await press('d');
  assert.equal(await msel(), 2);
  await press('a');
  assert.equal(await msel(), 1);
  await press('w');
  assert.equal(await msel(), 0, 'W goes to the row above');
  await press('s');
  assert.equal(await msel(), 1);
  await press('ArrowLeft');
  assert.equal(await msel(), 0);
  // 鼠标悬停同样移动选中（与键盘同一样式）。
  const m2 = await center('#shelfOverview .ov-mark[data-k="2"]');
  await move(m2.x, m2.y);
  await wait(async () => (await msel()) === 2);
  assert.equal(await js('document.querySelectorAll("#shelfOverview .ov-mark.sel").length'), 1);
  await delay(250);
  assert.ok(
    await js(`new DOMMatrix(getComputedStyle(document.querySelector('#shelfOverview .ov-mark.sel')).transform).a<1`),
    'Bookmark selection shrinks too',
  );
  await press('ArrowLeft');
  await press('ArrowLeft');
  assert.equal(await msel(), 0);
  // 全屏书架书签也能切换瀑布流（与全屏缩略图共用偏好），键盘照常。
  const sl = await center('#shelfOverview .ov-layout');
  await click(sl.x, sl.y);
  assert.equal(await js('document.querySelector("#shelfOverview .ov-marks").classList.contains("masonry")'), true);
  assert.equal(await js('getComputedStyle(document.querySelector("#shelfOverview .ov-mark")).position'), 'absolute');
  await delay(200);
  await shot('shelf-masonry');
  await press('d');
  assert.equal(await msel(), 1);
  await delay(250);
  await press('w');
  assert.equal(await msel(), 0);
  await press('s');
  assert.equal(await msel(), 1);
  await press('a');
  assert.equal(await msel(), 0);
  await click(sl.x, sl.y);
  assert.equal(await js('document.querySelector("#shelfOverview .ov-marks").classList.contains("masonry")'), false);
  // Enter 跨书跳转并关闭；[ 再打开时选中刚跳到的书签；V 切到全屏缩略图，C 切回。
  await press('Enter');
  await wait(mClosed);
  await wait(() => js(`bookTitle.textContent==='Short'`));
  await press('[');
  await wait(smOpen);
  assert.equal(await msel(), 0);
  await press('v');
  await wait(isOpen);
  assert.equal(await js('shelfOverview.open'), false, 'V switches to thumbnails');
  await press('c');
  await wait(smOpen);
  assert.equal(await js('overview.open'), false, 'C switches back');
  await press('[');
  await wait(mClosed);
  // 鼠标移入左上角不再打开。
  const lx = (await center('#shelfmarks')).x;
  await move(400);
  await move(lx, 100);
  await delay(400);
  assert.equal(await js('shelfOverview.open'), false, 'Left corner gesture is gone');
  // 常驻的缩略图栏（专注模式）：按钮同样在悬停显示后可点。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js('document.body.classList.contains("docked")&&document.body.classList.contains("focus-mode")'));
  await move(400, 300);
  await delay(500);
  assert.equal(await js(`getComputedStyle(document.querySelector('#panel .side-open')).visibility`), 'hidden');
  const pb = await center('#panel .side-open');
  await move(pb.x, pb.y);
  await wait(() => js(`getComputedStyle(document.querySelector('#panel .side-open')).visibility==='visible'`));
  await shot('docked-heads');
  // 两个侧栏的头部行等高、按钮在内侧上角且边距相同（左右镜像）。
  const heads =
    await js(`(()=>{const q=s=>document.querySelector(s).getBoundingClientRect(),a=q('#shelfmarks .sm-head'),b=q('#panel .pv-head'),d=q('#shelfmarks'),p=q('#panel'),x=q('#shelfmarks .side-open'),y=q('#panel .side-open');
    return {ha:a.height,hb:b.height,ta:a.top,tb:b.top,ia:d.right-x.right,ib:y.left-p.left,oa:x.left-d.left,ob:p.right-y.right,ya:x.top,yb:y.top,xa:x.height,xb:y.height};})()`);
  assert.ok(
    Math.abs(heads.ha - heads.hb) < 1 &&
      Math.abs(heads.ta - heads.tb) < 1 &&
      Math.abs(heads.ia - heads.ib) < 1.5 &&
      Math.abs(heads.oa - heads.ob) < 1.5 &&
      Math.abs(heads.ya - heads.yb) < 1 &&
      heads.xa === heads.xb,
    'Sidebar heads mirror each other ' + JSON.stringify(heads),
  );
  // 顶缘触发区避开正在显示的侧栏：停在侧栏顶部按钮的上半部不弹工具栏，阅读区上方照常弹出。
  const sb = await center('#shelfmarks .side-open');
  for (const [x, y] of [
    [pb.x, pb.y - 10],
    [sb.x, sb.y - 10],
  ]) {
    await move(x, y);
    await delay(400);
    assert.equal(await js('document.getElementById("bar").hidden'), true, 'Sidebar heads are not part of the top edge');
  }
  await move(400, 8);
  await wait(() => js('!document.getElementById("bar").hidden'));
  await move(400, 300);
  await wait(() => js('document.getElementById("bar").hidden'));
  await move(pb.x, pb.y);
  await wait(() => js(`getComputedStyle(document.querySelector('#panel .side-open')).visibility==='visible'`));
  await click(pb.x, pb.y);
  await wait(isOpen);
  await delay(300);
  await shot('overview');
  await press('Escape');
  await wait(closed);
  assert.equal(await js('document.body.classList.contains("docked")'), true, 'Docked strip stays');
  // 两个侧栏的最小宽度一致（160px）：保存的过小宽度在读取时也被夹住。
  await js(`localStorage.setItem('mv2:width','60');localStorage.setItem('mv2:shelfmarksWidth','60')`);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Short'`));
  assert.deepEqual(
    await js('[document.getElementById("panel").offsetWidth,document.getElementById("shelfmarks").offsetWidth]'),
    [160, 160],
  );
  // 旧版的两个开关已不存在。
  assert.equal(await js(`localStorage.getItem('mv2:overview')??localStorage.getItem('mv2:smOverview')`), null);
  // 全屏界面标题行的书架按钮 / B：书架盖在上层，全屏界面不关闭；书架里切书，全屏缩略图跟着换书；关闭书架回到全屏界面，焦点回到列表。
  const ovTop = (id) =>
    js(
      `(()=>{const r=shelf.getBoundingClientRect(),el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return shelf.contains(el)&&document.getElementById('${id}').open;})()`,
    );
  await js('reader.focus()');
  await press('v');
  await wait(isOpen);
  assert.equal(await js('document.querySelector("#overview .ov-title").textContent'), 'Short');
  assert.equal(await js('document.querySelector("#overview .ov-shelf").title'), 'Bookshelf (B)');
  const ob = await center('#overview .ov-shelf');
  await click(ob.x, ob.y);
  await wait(() => js('shelf.open'));
  await delay(200);
  assert.equal(await ovTop('overview'), true, 'Shelf covers the open thumbnails');
  await js(
    `[...document.querySelectorAll('#shelf .book')].find(n=>n.textContent.includes('Long')).querySelector('.pick').click()`,
  );
  await wait(() => js('!shelf.open'));
  await wait(() => js(`bookTitle.textContent==='Long'`));
  assert.equal(await isOpen(), true, 'Thumbnails stay open after picking a book');
  await wait(() =>
    js(
      'document.querySelector("#overview .ov-title").textContent==="Long"&&document.querySelector("#overview .ov-pos").textContent.endsWith("/ 40")',
    ),
  );
  await wait(() => js('document.activeElement===document.querySelector("#overview .ov-scroll")'));
  await press('d');
  assert.equal(
    await js('!!document.querySelector("#overview .ov-item.sel")'),
    true,
    'Keyboard still drives the thumbnails',
  );
  await press('b');
  await wait(() => js('shelf.open'));
  await delay(200);
  await press('b');
  await wait(() => js('!shelf.open'));
  assert.equal(await isOpen(), true, 'B toggles the shelf over the thumbnails');
  await press('Escape');
  await wait(closed);
  await press('c');
  await wait(smOpen);
  const before = await msel();
  const sb2 = await center('#shelfOverview .ov-shelf');
  await click(sb2.x, sb2.y);
  await wait(() => js('shelf.open'));
  await delay(200);
  assert.equal(await ovTop('shelfOverview'), true, 'Shelf covers the open shelf bookmarks');
  await press('Escape');
  await wait(() => js('!shelf.open'));
  await delay(100);
  assert.equal(await js('shelfOverview.open'), true, 'Shelf bookmarks stay open');
  assert.equal(await msel(), before, 'Selection kept');
  await wait(() => js('document.activeElement===document.querySelector("#shelfOverview .ov-scroll")'));
  await press('Escape');
  await wait(mClosed);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: full-width block buttons in mirrored sidebar heads open full-screen thumbnails / shelf bookmarks (floating, docked, focus mode), corner gestures removed, wider edge zone, regular grid, long strips capped, grid keyboard navigation, hover selection shared with keyboard, shrinking selection, grid / masonry toggle (both views, remembered), thumbnail cache across reopen and book switches, revalidation after focus, C / V / [ / ] keys, equal minimum widths',
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
