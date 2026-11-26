// 顶部工具栏与底部操作栏：边缘悬停弹出、离开收起、设置项、换行布局与阅读键位。框架同 tests/browser.mjs。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/toolbar.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-toolbar-'));
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
    let data = await readFile(new URL('../' + path, import.meta.url));
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
  id = 0,
  cdp;
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
    await delay(75);
  }
  throw Error('Timed out: ' + check + '; last: ' + last);
}
try {
  const port = await wait(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page');
  async function attach(page) {
    ws = new WebSocket(page.webSocketDebuggerUrl);
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
  }
  await attach(target);
  cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(`localStorage.setItem('mv2:shelfmarks','false')`);
  await cdp('Page.reload');
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Toolbar book',{create:true});
    for(let i=0;i<12;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();})()`);
  await wait(() =>
    js(`bookTitle.textContent==='Toolbar book'&&!!document.querySelector('#reader [data-name="0.svg"] img')`),
  );
  const height = await js('innerHeight'),
    width = await js('innerWidth'),
    move = (x, y = height / 2) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const geometry = () => js('JSON.stringify([reader.getBoundingClientRect(),reader.clientWidth,reader.scrollTop])');
  const box = (sel) =>
    js(
      `(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,x:r.left+r.width/2,y:r.top+r.height/2};})()`,
    );
  const shot = async (name) => {
    if (process.env.MV_SHOTS)
      await writeFile(
        join(process.env.MV_SHOTS, name + '.png'),
        Buffer.from((await cdp('Page.captureScreenshot')).data, 'base64'),
      );
  };
  const settle = (sel) =>
    js(`Promise.all(document.querySelector('${sel}').getAnimations().map(a=>a.finished)).then(()=>true)`);
  // 顶缘悬停约 120ms 弹出；面板浮在正文上，不改变阅读区几何。
  await js('reader.scrollTop=400');
  await delay(100);
  const before = await geometry();
  assert.equal(await js('bar.hidden'), true);
  await move(400, 400);
  await move(400, 2);
  await delay(40);
  assert.equal(await js('bar.hidden'), true, 'Edge needs a short dwell');
  await wait(() =>
    js(
      '!bar.hidden&&document.getElementById("toolbar").classList.contains("open")&&tab.getAttribute("aria-expanded")==="true"',
    ),
  );
  await settle('#bar');
  await settle('#barTitle');
  assert.equal(await geometry(), before, 'Panel overlays the reader without resizing it');
  // 顶部居中的一行图标；书名行在其下方居中；收起文字但有悬停提示。
  const panel = await box('#bar'),
    view = await box('#reader');
  assert.equal(panel.top, 8);
  assert.ok(Math.abs(panel.x - view.x) <= 1, 'Toolbar is centred');
  assert.ok(panel.height <= 60, 'One row: ' + panel.height);
  assert.equal(
    await js(
      `new Set([...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).map(b=>Math.round(b.getBoundingClientRect().top))).size`,
    ),
    1,
  );
  assert.deepEqual(
    await js(`['bookmarks','shelfmarks','settings'].map(a=>document.querySelector('#bar [data-act="'+a+'"]').hidden)`),
    [false, false, false],
  );
  assert.equal(
    await js(
      `[...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).every(b=>{const s=b.querySelector('span');return s.textContent.trim()&&b.title===s.textContent&&s.getBoundingClientRect().width<=1;})`,
    ),
    true,
  );
  for (const id of ['bookTitle', 'bookMeta', 'barProgress'])
    assert.ok(await js(`!bar.contains(${id})&&barTitle.contains(${id})`));
  const heading = await box('#barTitle');
  assert.ok(
    heading.top >= panel.bottom && Math.abs(heading.x - view.x) <= 1 && heading.height < 50,
    'Title row under the toolbar',
  );
  // 点击工具栏不穿透到阅读区（点击正文会翻屏）。
  const scrolled = await js('reader.scrollTop'),
    sep = await box('#bar .sep');
  for (const type of ['mousePressed', 'mouseReleased'])
    await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x: sep.x, y: sep.y });
  await delay(150);
  assert.equal(await js('reader.scrollTop'), scrolled, 'Click on the panel does not reach the reader');
  // 离开约 450ms 后淡出收起。
  const left = Date.now();
  await move(600, 600);
  await delay(200);
  assert.equal(await js('bar.hidden'), false, 'Stays open briefly after leaving');
  await wait(() => js('bar.classList.contains("leaving")'));
  await wait(() => js('bar.hidden'));
  assert.ok(Date.now() - left >= 400);
  assert.equal(await js('getComputedStyle(barTitle).display'), 'none');
  // 弹出后指针不经过面板直接移走也会收起。
  await move(5, 2);
  await wait(() => js('!bar.hidden'));
  await move(5, 500);
  await wait(() => js('bar.hidden'));
  // 拖动中不触发；有对话框时不触发。
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 2, buttons: 1, button: 'left' });
  await delay(300);
  assert.equal(await js('bar.hidden'), true, 'No popup while dragging');
  await move(400, 500);
  await js('help.showModal()');
  await move(400, 2);
  await delay(300);
  assert.equal(await js('bar.hidden'), true, 'No popup over a dialog');
  await js('help.close()');
  await move(400, 500);
  // Esc 收起，T 切换。
  const vk = { Escape: 27, Enter: 13, t: 84 };
  const key = async (k, code) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp('Input.dispatchKeyEvent', {
        type,
        key: k,
        code,
        windowsVirtualKeyCode: vk[k],
        text: type === 'keyDown' ? (k.length === 1 ? k : k === 'Enter' ? '\r' : undefined) : undefined,
      });
  };
  await js('reader.focus()');
  await key('t', 'KeyT');
  await wait(() => js('!bar.hidden'));
  await key('Escape', 'Escape');
  await wait(() => js('bar.hidden'));
  // 左上角不再有常驻的菜单按钮：平时透明且不接收鼠标，悬停该处不弹出。
  assert.deepEqual(await js(`[getComputedStyle(tab).opacity,getComputedStyle(tab).pointerEvents]`), ['0', 'none']);
  const tabBox = await box('#tab');
  await move(tabBox.x, tabBox.y + 30);
  await move(tabBox.x, tabBox.y + 20);
  await delay(300);
  assert.equal(await js('bar.hidden'), true, 'No hover target in the top-left corner');
  // 关闭 edgeTop 后顶缘不再弹出；键盘仍可用：Tab 聚焦到菜单按钮时显示，回车打开工具栏并把焦点移到第一个按钮。
  await js(`localStorage.setItem('mv2:edgeTop','false')`);
  await move(400, 2);
  await delay(400);
  assert.equal(await js('bar.hidden'), true, 'edgeTop off disables the edge popup');
  await move(400, 500);
  await js('reader.focus()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await wait(() => js('document.activeElement===tab&&getComputedStyle(tab).opacity==="1"'));
  await key('Enter', 'Enter');
  await wait(() => js('!bar.hidden&&document.activeElement===bar.querySelector(".tb")'));
  await key('Escape', 'Escape');
  await wait(() => js('bar.hidden'));
  await js(`localStorage.removeItem('mv2:edgeTop')`);

  // 底缘操作栏：贴近底缘稍停弹出；固定为 上一本 / 回到书首 / 位置 / 滚到书尾 / 下一本，到首尾时不再变成切书按钮；离开后收起。
  const [prev, toTop, toEnd, next, endbarName] = await js(
    `import('./src/core/lang.mjs').then(m=>['prev','toTop','toEnd','next','endbar'].map(k=>m.translate(k,document.documentElement.lang)))`,
  );
  const labels = () =>
    js(`[...endbar.querySelectorAll('.eb')].map(b=>[b.dataset.act,b.textContent,b.title,b.disabled])`);
  const press = async (act) => {
    const b = await box(`#endbar [data-act="${act}"]`);
    await move(b.x, b.y);
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x: b.x, y: b.y });
  };
  assert.equal(await js('endbar.getAttribute("aria-label")'), endbarName);
  await js('reader.scrollTop=1500');
  await move(400, height - 3);
  await delay(40);
  assert.equal(await js('endbar.hidden'), true, 'Bottom edge needs a short dwell');
  await wait(() => js('!endbar.hidden'));
  await settle('#endbar');
  // 只有一本书：上一本 / 下一本变灰。
  assert.deepEqual(await labels(), [
    ['prev', prev, prev, true],
    ['toStart', toTop, toTop, false],
    ['toEnd', toEnd, toEnd, false],
    ['next', next, next, true],
  ]);
  assert.match(await js('endPos.textContent'), /^\d+ \/ 12$/, 'Position shows read / total only, no percentage');
  const lefts = () => js(`[...endbar.children].map(e=>e.getBoundingClientRect().left)`),
    mid = await lefts();
  assert.deepEqual(
    await js(`[...endbar.children].map(e=>e.dataset.act||e.id)`),
    ['prev', 'toStart', 'endPos', 'toEnd', 'next'],
    'Order: prev, start, position, end, next',
  );
  assert.equal(await js('endbar.classList.contains("compact")'), false, 'Labels fit at 800px');
  await shot('endbar-800');
  const end = await box('#endbar');
  assert.ok(Math.abs(end.x - view.x) <= 1 && end.bottom <= height - 10, 'Centred at the bottom');
  await press('toEnd');
  await wait(() => js('reader.scrollHeight-reader.scrollTop-reader.clientHeight<=1'));
  await wait(async () => (await labels())[2][3] === true);
  assert.equal((await labels())[2][1], toEnd, 'Still “jump to end” at the end');
  assert.equal(await js('endPos.textContent'), '12 / 12', 'At the end: n / n');
  await delay(250);
  const atEndLefts = await lefts(); // 等按下的缩放过渡结束assert.deepEqual(atEndLefts,mid,'Buttons keep their place at the end');assert.equal(await js('bookTitle.textContent'),'Toolbar book');
  await press('toStart');
  await wait(() => js('reader.scrollTop===0'));
  await wait(async () => (await labels())[1][3] === true);
  assert.equal(await js('endPos.textContent'), '1 / 12');
  await delay(250);
  assert.deepEqual(await lefts(), atEndLefts, 'Start and end: the five buttons keep the same left positions');
  assert.equal(await js('document.activeElement===reader'), true, 'Buttons hand focus back to the reader');
  await move(400, 400);
  await wait(() => js('endbar.hidden'));
  // 点击正文只翻屏：上 / 下 15% 不再跳首尾。
  for (const y of [20, height - 20]) {
    const top = await js('reader.scrollTop=600');
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x: 600, y });
    await delay(100);
    assert.equal(
      await js('reader.scrollTop'),
      600 + (await js('Math.max(1,reader.clientHeight-64)')),
      'Right half pages forward at y=' + y,
    );
    await move(400, 400);
    await wait(() => js('endbar.hidden&&bar.hidden'));
  }
  await js(`localStorage.setItem('mv2:edgeBottom','false')`);
  await move(400, height - 3);
  await delay(400);
  assert.equal(await js('endbar.hidden'), true, 'edgeBottom off disables the bottom bar');
  // 旧版的单列 / 双列设置被清除；面板避开窗口控件覆盖区（--top），窄窗口时换行，内容不超出面板和窗口。
  await js(`localStorage.setItem('mv2:toolbarColumns','2');localStorage.removeItem('mv2:edgeBottom')`);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Toolbar book'&&localStorage.getItem('mv2:toolbarColumns')===null`));
  await js('tab.click()');
  await wait(() => js('!bar.hidden'));
  await js(`document.documentElement.style.setProperty('--top','40px')`);
  await settle('#bar');
  assert.equal((await box('#bar')).top, 48);
  assert.equal((await box('#tab')).top, 48);
  // 每个可见按钮都在面板内、面板和书名行都在窗口内；行首 / 行尾的分隔线隐藏。
  const fits = (w) =>
    js(`(()=>{const b=bar.getBoundingClientRect(),t=barTitle.getBoundingClientRect(),items=[...bar.children].filter(e=>!e.hidden&&e.matches('.tb'));
    const inside=items.every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom;});
    const seps=[...bar.querySelectorAll('.sep')].every(s=>{let a=s.previousElementSibling,n=s.nextElementSibling;while(a?.hidden)a=a.previousElementSibling;while(n?.hidden)n=n.nextElementSibling;return (a.offsetTop===n.offsetTop)!==s.classList.contains('edge')&&(getComputedStyle(s).visibility==='hidden')===s.classList.contains('edge');});
    return {inside,seps,rows:new Set(items.map(e=>e.offsetTop)).size,bar:b.left>=0&&b.right<=${w},title:t.left>=0&&t.right<=${w}&&t.top>=b.bottom,overflow:bar.scrollWidth<=bar.clientWidth&&barTitle.scrollWidth<=barTitle.clientWidth+1};})()`);
  for (const w of [500, 360]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 500, deviceScaleFactor: 1, mobile: false });
    await wait(() => js(`innerWidth===${w}`));
    await delay(100);
    const f = await fits(w);
    await shot('toolbar-' + w);
    assert.ok(
      f.inside && f.seps && f.bar && f.title && f.overflow,
      'Toolbar fits at ' + w + 'px: ' + JSON.stringify(f),
    );
    assert.ok(f.rows > 1, 'Wraps at ' + w + 'px');
  }
  // 窄窗口下操作栏只显示图标（文字视觉隐藏，仍是按钮的名称），不超出窗口。
  await js(`document.documentElement.style.removeProperty('--top')`);
  await move(180, 250);
  await move(180, 497);
  await wait(() => js('!endbar.hidden'));
  await settle('#endbar');
  await shot('endbar-360');
  const narrow = await box('#endbar');
  assert.ok(narrow.left >= 0 && narrow.right <= 360, 'Action bar fits at 360px: ' + JSON.stringify(narrow));
  assert.equal(
    await js(
      `endbar.classList.contains('compact')&&[...endbar.querySelectorAll('.eb')].every(b=>b.title&&b.textContent===b.title&&b.querySelector('span').getBoundingClientRect().width<=1)`,
    ),
    true,
  );
  await cdp('Emulation.clearDeviceMetricsOverride');
  await wait(async () => (await js('innerWidth')) === width);
  await move(400, 300);
  await wait(() => js('endbar.hidden'));

  // 四边的边缘触发区同为 32px（app.mjs 的 ctx.atEdge）：距边缘 31px 内触发，32px 外不触发。
  await key('Escape', 'Escape');
  await wait(() => js('bar.hidden&&endbar.hidden'));
  const zone = async (x, y, shown, yes) => {
    await move(width / 2, height / 2);
    await delay(50);
    await move(x, y);
    await delay(500);
    assert.equal(await js(shown), yes, `Edge at (${x},${y}) → ${yes}`);
    if (yes) {
      await key('Escape', 'Escape');
      await move(width / 2, height / 2);
      await wait(() =>
        js(
          'bar.hidden&&endbar.hidden&&document.getElementById("shelfmarks").hidden&&document.getElementById("panel").hidden',
        ),
      );
    }
  };
  for (const [x, y, shown, yes] of [
    [400, 32, '!bar.hidden', false],
    [400, 31, '!bar.hidden', true],
    [400, height - 33, '!endbar.hidden', false],
    [400, height - 32, '!endbar.hidden', true],
    [32, 400, '!document.getElementById("shelfmarks").hidden', false],
    [31, 400, '!document.getElementById("shelfmarks").hidden', true],
    [width - 33, 400, '!document.getElementById("panel").hidden', false],
    [width - 32, 400, '!document.getElementById("panel").hidden', true],
  ])
    await zone(x, y, shown, yes);
  // 键位：S / ↓ 向下、W / ↑ 向上按住滚动；D / → 后一屏、A / ← 前一屏；G 不再绑定；F 跳书签（没有书签时提示）。
  await key('Escape', 'Escape');
  await wait(() => js('bar.hidden'));
  await js('reader.focus()');
  const codes = {
    s: ['KeyS', 83],
    w: ['KeyW', 87],
    d: ['KeyD', 68],
    a: ['KeyA', 65],
    g: ['KeyG', 71],
    f: ['KeyF', 70],
    ArrowDown: ['ArrowDown', 40],
    ArrowUp: ['ArrowUp', 38],
    ArrowRight: ['ArrowRight', 39],
    ArrowLeft: ['ArrowLeft', 37],
  };
  const down = (k) =>
    cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k,
      code: codes[k][0],
      windowsVirtualKeyCode: codes[k][1],
      ...(k.length === 1 ? { text: k } : {}),
    });
  const up = (k) =>
    cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: codes[k][0], windowsVirtualKeyCode: codes[k][1] });
  const step = await js('Math.max(1,reader.clientHeight-64)');
  for (const [k, d] of [
    ['s', 1],
    ['ArrowDown', 1],
    ['w', -1],
    ['ArrowUp', -1],
  ]) {
    const top = await js('reader.scrollTop=2000');
    await down(k);
    await delay(250);
    await up(k);
    await delay(50);
    const now = await js('reader.scrollTop');
    assert.ok(
      d > 0 ? now > top + 20 : now < top - 20,
      k + ' scrolls ' + (d > 0 ? 'down' : 'up') + ': ' + top + ' → ' + now,
    );
  }
  for (const [k, d] of [
    ['d', 1],
    ['ArrowRight', 1],
    ['a', -1],
    ['ArrowLeft', -1],
  ]) {
    await js('reader.scrollTop=2000');
    await down(k);
    await delay(60);
    await up(k);
    await wait(async () => (await js('reader.scrollTop')) === 2000 + d * step);
  }
  await js('notice.textContent=""');
  await js('reader.scrollTop=2000');
  await down('g');
  await delay(60);
  await up('g');
  await delay(150);
  assert.equal(await js('reader.scrollTop'), 2000, 'G does nothing');
  assert.equal(await js('notice.textContent'), '');
  await down('f');
  await delay(60);
  await up('f');
  await wait(() =>
    js(
      `import('./src/core/lang.mjs').then(m=>notice.textContent===m.translate('bmNone',document.documentElement.lang))`,
    ),
  );
  assert.equal(await js('reader.scrollTop'), 2000, 'F no longer turns the page');
  // 按钮等交互控件里的文字不可选中（避免快速点击时误选文字）；输入框照常可选。
  assert.deepEqual(
    await js(
      `['#endbar .eb','#bar .tb','#views [role=tab]','#empty button','.set-switch,#filterToggle'].map(s=>getComputedStyle(document.querySelector(s)).userSelect)`,
    ),
    ['none', 'none', 'none', 'none', 'none'],
  );
  assert.equal(await js(`getComputedStyle(query).userSelect`), 'text');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: same 32px edge zone on all four sides, position shows read / total with stable button positions, no text selection in buttons, top edge popup, centred icon row with tooltips, title row, leave to fade out, no corner menu button, keyboard access, edgeTop off, bottom action bar, click pages only, WCO-safe top, wrapping in narrow windows, Esc / T, WASD / arrow keys',
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
