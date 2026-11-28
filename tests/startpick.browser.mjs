// 最近书签（书签面板、书架书签、全屏书架书签的选中项）与「选择起点」对话框的端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from './chrome.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/startpick.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-startpick-'));
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
  // 缩略图栏、书架书签都不常驻（书架书签在下面打开）。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});try{localStorage.setItem('mv2:preview','false');localStorage.setItem('mv2:focusMode','false');}catch{}`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 两本 10 页的书 Alpha、Beta（800×1120 的图，书架按名称排序）。
  async function book(name, first) {
    await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('${name}',{create:true});
      for(let i=0;i<10;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();
        await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120"><rect width="100%" height="100%" fill="hsl('+i*47+',55%,38%)"/><text x="400" y="600" font-size="260" text-anchor="middle" fill="white" font-family="sans-serif">'+i+'</text></svg>');await out.close();}
      window.showDirectoryPicker=async()=>dir;document.querySelector('${first ? '#empty' : '#bar'} [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
    await wait(() =>
      js(
        `bookTitle.textContent==='${name}'&&document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===1120`,
      ),
    );
    await js('reader.focus()');
  }
  await book('Alpha', true);
  await book('Beta', false);
  await js(`barTitle.click()`);
  await wait(() => js('shelf.open'));
  await js(`sortBtn.click();sortPop.querySelector('[data-sort="nameAsc"]').click();shelf.close()`);
  const store = `import('./src/core/store.mjs')`;
  // 直接写入书签记录（没有缩略图，格子显示空白占位），重新载入。
  const setMarks = (title, marks) =>
    js(
      `${store}.then(async({library})=>{const b=(await library('getAll')).find(b=>b.title===${JSON.stringify(title)});b.bookmarks=${JSON.stringify(marks)};await library('put',b);})`,
    );
  const record = (title) =>
    js(`${store}.then(async({library})=>(await library('getAll')).find(b=>b.title===${JSON.stringify(title)}))`);
  const reload = async (title) => {
    await js(`localStorage.setItem('mv2:last',JSON.stringify(${JSON.stringify((await record(title)).id)}))`);
    await cdp('Page.reload');
    await wait(() =>
      js(
        `bookTitle.textContent==='${title}'&&document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===1120`,
      ),
    );
    await js('reader.focus()');
  };
  const ph = () => js('reader.clientWidth*1.4'),
    H = () => js('reader.clientHeight');
  const goto = async (n, f) => {
    await js(`reader.scrollTop=${(n + f) * (await ph()) - (await H()) / 2}`);
    await delay(250); // 当前标记节流 200ms 更新
  };
  const text = () => js(`document.getElementById('notice').textContent`);
  const said = async (msg) => {
    await wait(async () => (await text()) === msg);
    await js('notice.textContent=""');
  };
  const codes = {
    f: ['KeyF', 70, 'f'],
    F: ['KeyF', 70, 'F'],
    c: ['KeyC', 67, 'c'],
    Enter: ['Enter', 13, '\r'],
    Escape: ['Escape', 27, ''],
    ArrowLeft: ['ArrowLeft', 37, ''],
    ArrowUp: ['ArrowUp', 38, ''],
    ArrowDown: ['ArrowDown', 40, ''],
    End: ['End', 35, ''],
    Home: ['Home', 36, ''],
  };
  async function key(name, type, mods = 0, extra = {}) {
    const [code, vk, t] = codes[name];
    await cdp('Input.dispatchKeyEvent', {
      type,
      key: name,
      code,
      windowsVirtualKeyCode: vk,
      modifiers: mods,
      ...(type === 'keyDown' && t ? { text: t } : {}),
      ...extra,
    });
  }
  const tap = async (name, mods = 0) => {
    await key(name, 'keyDown', mods);
    await delay(40);
    await key(name, 'keyUp', mods);
  };
  const hold = async (sec = false) => {
    await key(sec ? 'F' : 'f', 'keyDown', sec ? 8 : 0);
    await delay(700);
    await key(sec ? 'F' : 'f', 'keyUp', sec ? 8 : 0);
  };
  const mouse = (type, x, y, button = 'none') =>
    cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount: button === 'none' ? 0 : 1 });
  const rect = (sel) =>
    js(
      `(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};})()`,
    );

  // ==== 1. 最近书签：阅读位置之前最近的一项；区段的起点、终点各算一项，只高亮这一项 ====
  // Alpha：2.svg 0.5；区段 4.svg 0.5 → 7.svg 0.5；区段内 5.svg 0.5。Beta：3.svg 0.5。
  const bm = (id, name, f, end) => ({
    id,
    name,
    f,
    at: 1,
    ...(end ? { end: { name: end[0], f: end[1], at: 2 } } : {}),
  });
  await setMarks('Alpha', [bm('a1', '2.svg', 0.5), bm('s', '4.svg', 0.5, ['7.svg', 0.5]), bm('a3', '5.svg', 0.5)]);
  await setMarks('Beta', [bm('b1', '3.svg', 0.5)]);
  await reload('Alpha');
  const panelOpen = async () => {
    await js(
      `reader.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`,
    );
    await wait(() => js(`!document.querySelector('.bm-panel').hidden`));
  };
  const panelActive = () =>
    js(`[...document.querySelectorAll('.bm-panel .bm-item.active')].map(e=>e.getAttribute('aria-label')).join('|')`);
  await goto(6, 0.5);
  await panelOpen();
  // 起点和区段书签各是一项，按位置排序：区段内的普通书签夹在两者之间。
  assert.deepEqual(
    await js(`[...document.querySelectorAll('.bm-panel .bm-item')].map(e=>e.getAttribute('aria-label'))`),
    ['Page 3', 'Page 5 · Section start', 'Page 6', 'Section bookmark · Page 8'],
  );
  assert.equal(await panelActive(), 'Page 6', 'The ordinary bookmark inside the section is nearer than its start');
  await goto(8, 0.2);
  await wait(async () => (await panelActive()) === 'Section bookmark · Page 8');
  await goto(4, 0.7);
  await wait(async () => (await panelActive()) === 'Page 5 · Section start');
  await goto(5, 0.5);
  await wait(async () => (await panelActive()) === 'Page 6', 'Exactly at a bookmark counts as before');
  await goto(5, 0.45);
  await wait(async () => (await panelActive()) === 'Page 5 · Section start', 'A bookmark just after does not count');
  await goto(1, 0.5);
  await wait(async () => (await panelActive()) === '', 'Nothing before: nothing marked');
  await tap('Escape');
  await wait(() => js(`document.querySelector('.bm-panel').hidden`));
  // 书架书签（常驻）：Beta 里还没到它的第一个书签时，最近的是前面 Alpha 的最后一项（区段书签），高亮并滚到它。
  await js(`localStorage.setItem('mv2:shelfmarks','true')`);
  await reload('Beta');
  await wait(() => js(`!document.getElementById('shelfmarks').hidden`));
  const dockActive = () =>
    js(
      `(()=>{const a=[...document.querySelectorAll('#shelfmarks .bm-item.active')];return a.map(e=>e.closest('.sm-book').getAttribute('aria-label')+' · '+e.getAttribute('aria-label')).join('|');})()`,
    );
  await goto(1, 0.5);
  // 最近的是区段书签：只高亮区段书签那一项。
  await wait(async () => (await dockActive()) === 'Alpha · Alpha · Section bookmark · Page 8');
  await goto(3, 0.6);
  await wait(async () => (await dockActive()) === 'Beta · Beta · Page 4');
  await goto(1, 0.5);
  await wait(async () => (await dockActive()) === 'Alpha · Alpha · Section bookmark · Page 8');
  // 全屏书架书签打开时选中同一项（在前面那本书的一组里，区段书签那一项）。
  await tap('c');
  await wait(() => js(`document.getElementById('shelfOverview').open`));
  await delay(250);
  assert.equal(
    await js(
      `(()=>{const n=document.querySelector('#shelfOverview .ov-mark.sel');return n.getAttribute('aria-label')+('end' in n.dataset?' [end]':'');})()`,
    ),
    'Alpha · Section bookmark · Page 8 [end]',
  );
  await tap('c');
  await wait(async () => !(await js(`document.getElementById('shelfOverview').open`)));
  await js(`localStorage.setItem('mv2:shelfmarks','false')`);

  // ==== 2. 「选择起点」：几百个候选也流畅，只为可见的格子画缩略图；按住拖动滚动；自动重复的回车不算 ====
  // Alpha 的 10 页上每页 30 个书签，共 300 个。
  const many = [];
  for (let i = 0; i < 10; i++)
    for (let k = 0; k < 30; k++) many.push(bm('m' + i + '-' + k, i + '.svg', (k + 0.5) / 30));
  await setMarks('Alpha', many);
  await reload('Alpha');
  await goto(9, 0.99);
  await hold(true);
  await wait(() => js(`!!document.querySelector('.start-pick')?.open`));
  const state = () =>
    js(`(()=>{const g=document.querySelector('.start-pick .stp-grid'),s=g.querySelector('.stp-item.sel');return {n:g.children.length,sel:+s.dataset.k,top:g.scrollTop,
      shown:(()=>{const a=g.getBoundingClientRect(),b=s.getBoundingClientRect();return b.top>=a.top-1&&b.bottom<=a.bottom+1;})(),
      painted:g.querySelectorAll('.stp-item .bm-thumb.empty,.stp-item .bm-thumb img[src]').length};})()`);
  // 书尾滚不到 9.99：按实际的视窗中线算出它之前的书签数。
  const c = (await js('(reader.scrollTop+reader.clientHeight/2)/(reader.clientWidth*1.4)')) - 9,
    want = 270 + Array.from({ length: 30 }, (_, k) => (k + 0.5) / 30).filter((f) => f < c).length;
  let st = await state();
  assert.equal(st.n, want, 'Every bookmark before the reading position');
  assert.equal(st.sel, want - 1, 'The nearest one is selected');
  assert.equal(st.shown, true, 'and scrolled into view');
  await wait(async () => (await state()).painted > 0);
  await delay(300);
  st = await state();
  assert.ok(st.painted < 120, 'Only the visible tiles (and a screen around them) are painted: ' + st.painted);
  // 布局：对话框在窗口内，格子大小一致，底部一行在对话框里。
  const [dlg, grid, foot, ok, a, b] = await Promise.all(
    [
      '.start-pick',
      '.start-pick .stp-grid',
      '.start-pick .stp-foot',
      '.start-pick .stp-ok',
      '.start-pick .stp-item:nth-child(1)',
      '.start-pick .stp-item:nth-child(2)',
    ].map(rect),
  );
  assert.ok(
    dlg.top >= 0 && dlg.bottom <= (await js('innerHeight')) && dlg.left >= 0 && dlg.right <= (await js('innerWidth')),
  );
  assert.ok(grid.bottom <= foot.top + 0.5 && foot.bottom <= dlg.bottom + 0.5 && ok.right <= dlg.right);
  assert.deepEqual([Math.round(a.width), Math.round(a.height)], [Math.round(b.width), Math.round(b.height)]);
  await shot('start-pick-many');
  // 按住拖动滚动列表；拖动的这一下不改选。
  const before = await state();
  const g0 = await rect('.start-pick .stp-grid');
  await mouse('mouseMoved', g0.x, g0.top + 60);
  await mouse('mousePressed', g0.x, g0.top + 60, 'left');
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', g0.x, g0.top + 60 + k * 30, 'left');
  await mouse('mouseReleased', g0.x, g0.top + 300, 'left');
  await delay(400);
  st = await state();
  assert.ok(st.top < before.top - 150, 'Dragging scrolls the list: ' + before.top + ' → ' + st.top);
  assert.equal(st.sel, want - 1, 'A drag is not a click');
  // 方向键改选：上一行、Home。自动重复的回车（长按 Shift+Enter 时回车还按着）不确认。
  await tap('ArrowUp');
  const cols = want - 1 - (await state()).sel;
  assert.ok(cols >= 2, 'Up moves one row: ' + cols);
  await tap('Home');
  assert.equal((await state()).sel, 0);
  assert.equal((await state()).shown, true);
  await key('Enter', 'keyDown', 0, { autoRepeat: true });
  await key('Enter', 'keyUp');
  await delay(200);
  assert.equal(await js(`document.querySelector('.start-pick').open`), true, 'A repeated Enter does nothing');
  await tap('Enter');
  await said('Section bookmark added');
  assert.deepEqual((await record('Alpha')).bookmarks.find((m) => m.end)?.id, 'm0-0');
  // 窄窗口：对话框和底部一行不溢出。
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: false });
  await delay(200);
  await goto(9, 0.99);
  await hold(true);
  await wait(() => js(`!!document.querySelector('.start-pick')?.open`));
  await delay(250);
  assert.ok(
    await js(
      `[...document.querySelectorAll('.start-pick, .start-pick .stp-foot > *, .start-pick header > *')].every(e=>{const r=e.getBoundingClientRect();return r.left>=-.5&&r.right<=innerWidth+.5;})`,
    ),
    'Nothing overflows at 360px',
  );
  await shot('start-pick-narrow');
  await tap('Escape');
  await wait(() => js(`!document.querySelector('.start-pick').open`));
  await cdp('Emulation.clearDeviceMetricsOverride');

  assert.deepEqual(errors, []);
  console.log(
    'PASS: nearest bookmark before the reading position (panel: this book only, start and section bookmark as separate items in position order, exactly-here counts, nothing before marks nothing; shelf bookmarks fall back to the last item of the previous book and scroll to it; full-screen shelf bookmarks open on it), start picker with 300 candidates (nearest selected and shown, lazy thumbnails, drag scrolling without selecting, arrows / Home, repeated Enter ignored, layout at 800 and 360 wide)',
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
