// 用独立临时配置和 OPFS 测试数据，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-browser-'));
const mime = {
  mjs: 'text/javascript',
  js: 'text/javascript',
  html: 'text/html',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  css: 'text/css',
};
let updated = false;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!/^(?:[\w-]+\/)*[\w.-]+$/.test(path)) throw Error();
    let data = await readFile(new URL('../' + path, import.meta.url));
    if (updated && path === 'sw.js')
      data = data.toString().replace(/(cacheName\s*=\s*prefix\s*\+\s*)'[^']+'/, "$1'browser-test-update'");
    if (updated && path === 'index.html')
      data = data.toString().replace('</head>', '<meta name="test-build" content="new"></head>');
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
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['fr-CA','ko-KR']});`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  assert.equal(await js('document.documentElement.lang'), 'ko');
  assert.equal(await js('document.querySelector("h1").textContent'), '만화 열기');
  await wait(() => js('!!navigator.serviceWorker.controller'));
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Test book',{create:true});
    for(let i=64;i>=0;i--){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="'+(i===0?12000:900)+'"><rect width="100%" height="100%" fill="green"/></svg>');await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===12000`));
  assert.ok(await js(`document.querySelectorAll('#reader .page').length<10`));
  const rect = () => js(`[reader.clientWidth,reader.clientHeight,reader.scrollHeight,reader.scrollTop]`);
  await js('reader.scrollTop=700');
  await delay(120);
  const before = await rect();
  await js('tab.click()');
  assert.deepEqual(await rect(), before);
  await js('tab.click()');
  assert.deepEqual(await rect(), before);
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`!!document.querySelector('#preview [title="0.svg"] :is(canvas,img)')`));
  assert.ok(
    await js('reader.getBoundingClientRect().right<=panel.getBoundingClientRect().left+1'),
    'Pinned preview docks beside the page instead of covering it',
  );
  await delay(120);
  const docked = await js('reader.scrollTop');
  await js(`preview.dispatchEvent(new WheelEvent('wheel'));preview.scrollTop=preview.scrollHeight;`);
  await wait(() => js(`!!document.querySelector('#preview [title="64.svg"] :is(canvas,img)')`));
  assert.equal(await js('reader.scrollTop'), docked);
  await js('preview.scrollTop=0');
  await wait(() => js(`!!document.querySelector('#preview [title="0.svg"] :is(canvas,img)')`));
  const coords = await js(
    `(()=>{const p=document.querySelector('#preview [title="0.svg"]');preview.scrollTop=p.offsetHeight*.7-preview.clientHeight/2;const r=preview.getBoundingClientRect();return [r.left+20,r.top+p.offsetHeight*.7-preview.scrollTop];})()`,
  );
  for (const type of ['mousePressed', 'mouseReleased'])
    await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x: coords[0], y: coords[1] });
  const frac = () =>
    js(`(reader.scrollTop+reader.clientHeight/2)/document.querySelector('#reader [data-name="0.svg"]').offsetHeight`);
  await wait(async () => Math.abs((await frac()) - 0.7) < 0.002);
  await js(`barTitle.click()`);
  await wait(() => js(`shelf.open&&document.querySelector('.pick').textContent.includes('65')`));
  await js('shelf.close()');
  await delay(1000);
  await cdp('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await cdp('Page.navigate', { url: 'about:blank' });
  await wait(() => js(`location.href==='about:blank'`));
  await cdp('Page.navigate', { url: origin });
  await wait(() => js(`document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===12000`));
  assert.ok(Math.abs((await frac()) - 0.7) < 0.002, 'Offline reload restores position within long image');
  await cdp('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  const tap = async (y, x = 300) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x, y });
  };
  const height = await js('innerHeight');
  // 底缘弹出总控栏：左区有上一本 / 到顶部 / 到底部 / 下一本（图标按钮，名称在 aria-label）。滚到书尾、回到书首；点击正文右半屏后一屏。
  const rr = JSON.parse(await js('JSON.stringify(reader.getBoundingClientRect())')),
    move = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const endBtn = async (act) => {
    if (await js('controlbar.hidden')) {
      await move(rr.left + rr.width / 2, height / 2);
      await move(rr.left + rr.width / 2, height - 4);
      await wait(() => js('!controlbar.hidden'));
    }
    // 窄的阅读区里到顶部 / 到底部收在左区的「⋯」弹出层里：先打开它。
    if (await js(`!!controlbar.querySelector('.cb-more-pop [data-act="${act}"]')`)) {
      const [mx, my] = await js(
        `(()=>{const r=controlbar.querySelector('[data-id="moreLeft"]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
      );
      await tap(my, mx);
      await wait(() => js(`controlbar.querySelector('.cb-more-pop').matches(':popover-open')`));
    }
    const [x, y] = await js(
      `(()=>{const r=controlbar.querySelector('[data-act="${act}"]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
    await tap(y, x);
  };
  await move(rr.left + rr.width / 2, height - 4);
  await wait(() => js('!controlbar.hidden'));
  assert.deepEqual(
    await js(
      `['prev','toStart','toEnd','next'].map(a=>controlbar.querySelector('[data-act="'+a+'"]').getAttribute('aria-label'))`,
    ),
    ['이전 책', '맨 위로', '맨 아래로', '다음 책'],
  );
  await endBtn('toEnd');
  await wait(() => js('reader.scrollHeight-reader.scrollTop-reader.clientHeight<=1'));
  await endBtn('toStart');
  await wait(() => js('reader.scrollTop===0'));
  await move(rr.left + rr.width / 2, height / 2);
  await wait(() => js('controlbar.hidden'));
  await tap(height / 2, rr.left + rr.width * 0.75);
  await wait(() => js('reader.scrollTop>0'));
  // 取消常驻后，鼠标贴近右缘临时弹出缩略图栏，移开即收起。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  assert.equal(await js('panel.hidden'), true);
  const width = await js('innerWidth');
  // 右缘中上部照旧弹出窄条（全屏缩略图只在右下角触发，见 overview.browser.mjs）。
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 2, y: height / 2 });
  await wait(() => js('!panel.hidden&&!document.body.classList.contains("docked")'));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: height / 2 });
  await wait(() => js('panel.hidden'));
  const record = () =>
    js(
      `import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.id===JSON.parse(localStorage.getItem('mv2:last')))).then(b=>({id:b.id,override:b.sortOverride,mode:b.sortMode,pages:b.pages.map(p=>[p.name,p.lastModified])}))`,
    );
  const order = async () => (await record()).pages.map((p) => p[0]);
  async function setSort(mode, scope = 'folder') {
    await js(`document.querySelector('#bar [data-act="sort"]').click()`);
    await wait(() => js('sortOptions.open'));
    await js(
      `sortScope.value='${scope}';sortScope.dispatchEvent(new Event('change'));sortOptions.querySelector('[data-mode="${mode}"]').click()`,
    );
    await wait(() => js('!sortOptions.open'));
  }
  async function choose(mode) {
    await setSort(mode);
    return wait(async () => {
      const b = await record();
      return b.mode === mode && b;
    });
  }
  const names = Array.from({ length: 65 }, (_, i) => i + '.svg');
  // 排序项与书架排序同一写法（正序 / 反序：从旧到新 / A→Z 为正序）；「跟随默认排序」下显示默认项的名称。
  await js(`document.querySelector('#bar [data-act="sort"]').click()`);
  await wait(() => js('sortOptions.open'));
  assert.deepEqual(
    await js(
      `['nameAsc','nameDesc','timeAsc','timeDesc'].map(m=>sortOptions.querySelector('[data-mode="'+m+'"]').textContent)`,
    ),
    ['파일명 · 오름차순', '파일명 · 내림차순', '수정일 · 오름차순', '수정일 · 내림차순'],
  );
  assert.equal(await js('defaultSortName.textContent'), '파일명 · 오름차순');
  await js('sortOptions.close()');
  await wait(() => js('!sortOptions.open'));
  assert.deepEqual(
    (await choose('nameDesc')).pages.map((p) => p[0]),
    [...names].reverse(),
  );
  assert.deepEqual(
    (await choose('nameAsc')).pages.map((p) => p[0]),
    names,
  );
  const timed = (await choose('timeAsc')).pages;
  assert.ok(timed.every((p, i) => Number.isFinite(p[1]) && (!i || p[1] >= timed[i - 1][1])));
  const newest = [...timed].sort((a, b) => b[1] - a[1] || parseInt(a[0]) - parseInt(b[0]));
  assert.deepEqual((await choose('timeDesc')).pages, newest);
  const firstMix = (await choose('shuffle')).pages.map((p) => p[0]);
  await choose('shuffle');
  const mixed = await wait(async () => {
    const list = await order();
    return list.some((n, i) => n !== firstMix[i]) && list;
  });
  assert.deepEqual([...mixed].sort(), [...names].sort());
  updated = true;
  await js(`navigator.serviceWorker.ready.then(reg=>reg.update()).then(()=>true)`);
  await wait(() => js(`navigator.serviceWorker.ready.then(reg=>!!reg.waiting)`));
  assert.equal(await js(`document.querySelector('[name="test-build"]')`), null);
  // 真正关闭旧窗口；单纯导航到 about:blank 可能把旧页面保存在后退缓存里。
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  await cdp('Target.closeTarget', { targetId: target.id });
  const tabs = async () => await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  await wait(async () => !(await tabs()).some((t) => t.id === target.id));
  await attach((await tabs()).find((t) => t.id === targetId));
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: origin });
  await wait(() =>
    js(`document.querySelector('[name="test-build"]')?.content==='new' && bookTitle.textContent==='Test book'`),
  );
  assert.deepEqual(await order(), mixed);
  const original = (await record()).id;
  await setSort('nameDesc', 'global');
  assert.deepEqual(await order(), mixed, '修改默认不影响已有独立乱序');
  await js(`(async()=>{const root=await navigator.storage.getDirectory();
    const other=await (await root.getDirectoryHandle('other',{create:true})).getDirectoryHandle('Test book',{create:true});
    for(const name of ['10','1','2']){const w=await (await other.getFileHandle(name+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="6" height="9"/>');await w.close();}
    window.showDirectoryPicker=async()=>other;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  const second = await wait(async () => {
    const b = await record();
    return b.id !== original && b.mode === 'nameDesc' && b;
  });
  const reversed = ['10.svg', '2.svg', '1.svg'];
  assert.equal(second.override, null);
  assert.deepEqual(await order(), reversed);
  await setSort('nameDesc'); // 与当前默认值相等也能显式独立。
  await wait(async () => (await record()).override === 'nameDesc');
  await setSort('nameAsc', 'global');
  assert.deepEqual(await order(), reversed);
  await js(`document.querySelector('#controlbar [data-act="next"]').click()`);
  await wait(async () => (await record()).id === original);
  await js(
    `(async()=>{document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
  );
  await wait(async () => (await record()).id === second.id);
  assert.equal((await record()).override, 'nameDesc');
  assert.deepEqual(await order(), reversed);
  await setSort('default');
  await wait(async () => {
    const b = await record();
    return b.override === null && b.mode === 'nameAsc';
  });
  assert.deepEqual(await order(), [...reversed].reverse());
  await setSort('shuffle', 'global');
  await wait(async () => (await record()).mode === 'shuffle');
  const defaultMix = await order();
  await cdp('Page.navigate', { url: 'about:blank' });
  await wait(() => js(`location.href==='about:blank'`));
  await cdp('Page.navigate', { url: origin });
  await wait(() => js(`bookTitle.textContent==='Test book'`));
  assert.equal((await record()).override, null);
  assert.deepEqual(await order(), defaultMix);
  await js(`document.querySelector('#controlbar [data-act="next"]').click()`);
  await wait(async () => (await record()).id === original);
  assert.equal((await record()).override, 'shuffle');
  assert.deepEqual(await order(), mixed);
  await setSort('nameDesc', 'global');
  await js(`document.querySelector('#controlbar [data-act="next"]').click()`);
  await wait(async () => {
    const b = await record();
    return b.id === second.id && b.mode === 'nameDesc';
  });
  assert.deepEqual(await order(), reversed);
  // 刷新：新增图片并入当前书；文件夹删除后不删记录，而是归入过期书籍，手动删除才清除。
  await js(`(async()=>{const d=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('other')).getDirectoryHandle('Test book');
    const w=await (await d.getFileHandle('0.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="6" height="9"/>');await w.close();})()`);
  await js(`document.querySelector('#bar [data-act="refresh"]').click()`);
  await wait(async () => (await order()).length === 4);
  assert.deepEqual(await order(), ['10.svg', '2.svg', '1.svg', '0.svg']);
  await wait(() => js(`!document.querySelector('#bar [data-act="refresh"]').disabled`));
  await js(`window.confirm=()=>true;navigator.storage.getDirectory().then(r=>r.removeEntry('other',{recursive:true}))`);
  await js(`document.querySelector('#bar [data-act="refresh"]').click()`);
  await wait(() => js(`!document.querySelector('#bar [data-act="refresh"]').disabled`));
  assert.equal(
    await js(`import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).length)`),
    2,
    'Missing folders keep their records',
  );
  await js(`barTitle.click()`);
  await wait(() => js(`!document.querySelector('[data-view="expired"]').hidden`));
  await js(`document.querySelector('[data-view="expired"]').click()`);
  await wait(() => js(`document.querySelectorAll('#books .book.expired').length===1`));
  await js(`[...document.querySelectorAll('#bulkActions button')].at(-1).click()`);
  await wait(() => js(`import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).length===1)`));
  await js('shelf.close()');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: locale, import, virtual strip, floating toolbar geometry, long-image navigation, shelf, offline cold start, shuffle persistence, non-disruptive update, folder refresh',
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
