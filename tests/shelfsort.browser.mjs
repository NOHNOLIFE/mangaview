// 书籍排序、书名编辑、B 快捷键端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from './chrome.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/shelfsort.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-shelfsort-'));
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
  // 先按 C、A、B 的顺序写入图片（文件夹时间 C < A < B），再按 A、B、C 的顺序添加（添加时间 A < B < C）。
  const write = (name) =>
    js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('${name}',{create:true});
    for(let i=0;i<3;i++){const out=await (await dir.getFileHandle(i+'.svg',{create:true})).createWritable();await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>');await out.close();}})()`);
  for (const n of ['Book C', 'Book A', 'Book B']) {
    await write(n);
    await delay(60);
  }
  for (const [i, n] of ['Book A', 'Book B', 'Book C'].entries()) {
    await js(
      `(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('${n}');window.showDirectoryPicker=async()=>dir;document.querySelector('${i ? '#bar' : '#empty'} [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
    );
    await wait(() => js(`bookTitle.textContent==='${n}'`));
    await delay(30);
  }
  const codes = { b: ['KeyB', 66, 'b'] };
  const press = async (k) => {
    const [code, vk, text] = codes[k];
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  // B 打开书架；焦点不在输入框时再按 B 关闭。
  await js('reader.focus()');
  await press('b');
  await wait(() => js('shelf.open'));
  await js(`document.querySelector('#views [data-view="shelf"]').focus()`);
  await press('b');
  await wait(() => js('!shelf.open'));
  await press('b');
  await wait(() => js('shelf.open'));
  // 打开时焦点落在当前书（最后添加的 Book C）的卡片上，而不是搜索框；/ 聚焦搜索框。
  assert.equal(await js(`document.activeElement.closest('.book')?.querySelector('.name').textContent`), 'Book C');
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: '/',
    code: 'Slash',
    windowsVirtualKeyCode: 191,
    text: '/',
  });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
  assert.equal(await js('document.activeElement.id'), 'query');
  assert.equal(await js('query.value'), '');
  await press('b');
  await delay(150);
  assert.equal(await js('shelf.open&&query.value'), 'b', 'Typing B in the search box does not close the shelf');
  await js(`query.value='';query.dispatchEvent(new Event('input',{bubbles:true}))`);
  // 卡片按瀑布流绝对定位，DOM 顺序不等于列表顺序；用卡片上的序号还原顺序。
  const order = () =>
    js(
      `[...document.querySelectorAll('#books .book')].map(b=>[+b.dataset.i,b.querySelector('.name').textContent]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join()`,
    );
  const sortBy = (v) => js(`sortBtn.click();sortPop.querySelector('[data-sort="${v}"]').click()`);
  assert.equal(await js('sortBtn.dataset.sort'), 'addedNew', 'Default: newest added first');
  assert.equal(await order(), 'Book C,Book B,Book A');
  await sortBy('addedOld');
  assert.equal(await order(), 'Book A,Book B,Book C');
  await sortBy('nameDesc');
  assert.equal(await order(), 'Book C,Book B,Book A');
  await sortBy('nameAsc');
  assert.equal(await order(), 'Book A,Book B,Book C');
  await sortBy('folderNew');
  await wait(async () => (await order()) === 'Book B,Book A,Book C');
  assert.ok(
    await js(
      `import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).every(b=>Number.isFinite(b.folderTime)))`,
    ),
    'Folder times are stored',
  );
  await sortBy('folderOld');
  assert.equal(await order(), 'Book C,Book A,Book B');
  // 设置持久保存；上一本 / 下一本按同一顺序（当前是最后添加的 Book C，folderOld 下它排第一）。
  await js('shelf.close()');
  await js('reader.focus()');
  await js(`document.querySelector('#controlbar [data-act="next"]').click()`);
  await wait(() => js(`bookTitle.textContent==='Book A'`));
  await js(`document.querySelector('#controlbar [data-act="next"]').click()`);
  await wait(() => js(`bookTitle.textContent==='Book B'`));
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Book B'`));
  await js(`barTitle.click()`);
  await wait(() => js('shelf.open'));
  assert.equal(await js('sortBtn.dataset.sort'), 'folderOld');
  assert.equal(await order(), 'Book C,Book A,Book B');
  // 编辑书名：显示名改变并参与排序和搜索，文件夹名不变；留空恢复。
  await sortBy('nameAsc');
  const card = (n) =>
    `[...document.querySelectorAll('#books .book')].find(b=>b.querySelector('.name').textContent==='${n}')`;
  await js(
    `${card('Book A')}.querySelector('.actions .more').click();[...cardMenu.querySelectorAll('[role=menuitem]')].find(x=>x.textContent==='Edit title').click()`,
  );
  await wait(() => js('renameBook.open'));
  assert.equal(await js('renameInput.value'), 'Book A');
  assert.equal(await js('renameHint.textContent'), 'Original name: Book A. Leave empty to restore it.');
  await js(`renameInput.value='  Zeta  ';renameForm.requestSubmit()`);
  await wait(() => js('!renameBook.open'));
  await wait(async () => (await order()) === 'Book B,Book C,Zeta');
  const rec = await js(
    `import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.name==='Zeta'))`,
  );
  assert.equal(rec.title, 'Book A');
  await js(`query.value='book a';query.dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(await order(), 'Zeta', 'Search still matches the folder name');
  await js(`query.value='';query.dispatchEvent(new Event('input',{bubbles:true}))`);
  await js(`${card('Book B')}.querySelector('.pick').click()`);
  await wait(() => js('!shelf.open'));
  await js(`barTitle.click()`);
  await wait(() => js('shelf.open'));
  await js(
    `${card('Zeta')}.querySelector('.actions .more').click();[...cardMenu.querySelectorAll('[role=menuitem]')].find(x=>x.textContent==='Edit title').click()`,
  );
  await wait(() => js('renameBook.open'));
  await js(`renameInput.value='';renameForm.requestSubmit()`);
  await wait(async () => (await order()) === 'Book A,Book B,Book C');
  assert.equal(
    await js(
      `import('./src/core/store.mjs').then(async({library})=>'name' in (await library('getAll')).find(b=>b.title==='Book A'))`,
    ),
    false,
  );
  await shot('shelf-sort');
  // Shift+S / Shift+↓ 下一本、Shift+W / Shift+↑ 上一本（按书架排序：名称正序 A、B、C）：按下切换一次，按住（自动重复）不连续切换。
  await js('shelf.close()');
  await wait(() => js(`bookTitle.textContent==='Book B'`));
  await js('reader.focus()');
  const keys = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, d: 68, a: 65, s: 83, w: 87 };
  const code = (k) => (k.length > 1 ? k : 'Key' + k.toUpperCase());
  const down = (k, shift = false, repeat = false) =>
    cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k.length === 1 && shift ? k.toUpperCase() : k,
      code: code(k),
      windowsVirtualKeyCode: keys[k],
      modifiers: shift ? 8 : 0,
      autoRepeat: repeat,
      ...(k.length === 1 ? { text: shift ? k.toUpperCase() : k } : {}),
    });
  const up = (k, shift = false) =>
    cdp('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: k.length === 1 && shift ? k.toUpperCase() : k,
      code: code(k),
      windowsVirtualKeyCode: keys[k],
      modifiers: shift ? 8 : 0,
    });
  const shiftPress = async (k) => {
    await down(k, true);
    for (let i = 0; i < 4; i++) {
      await delay(40);
      await down(k, true, true);
    }
    await up(k, true);
    await delay(150);
  };
  const is = async (n) => {
    await wait(() => js(`bookTitle.textContent==='${n}'`));
    await delay(200);
    assert.equal(await js('bookTitle.textContent'), n, 'One book per press');
  };
  await js('reader.scrollTop=0');
  await shiftPress('s');
  await is('Book C');
  await shiftPress('w');
  await is('Book B');
  await shiftPress('ArrowDown');
  await is('Book C');
  await shiftPress('ArrowUp');
  await is('Book B');
  await shiftPress('ArrowUp');
  await is('Book A');
  assert.equal(await js('reader.scrollTop'), 0, 'Shift+W / ↑ does not scroll');
  await shiftPress('s');
  await is('Book B');
  // 长按 A / D / ← / → 不再切书，也不翻屏（长按暂无功能）；短按只翻一屏。
  for (const k of ['ArrowRight', 'ArrowLeft', 'd', 'a']) {
    await js('reader.scrollTop=200');
    await down(k);
    await delay(700);
    await up(k);
    await delay(150);
    assert.equal(await js('bookTitle.textContent'), 'Book B', k + ' hold does not change books');
    assert.equal(await js('reader.scrollTop'), 200, k + ' hold does not turn the page');
  }
  await js('reader.scrollTop=0');
  await down('d');
  await delay(60);
  await up('d');
  await wait(() => js('reader.scrollTop>0'));
  assert.equal(await js('reader.scrollTop'), await js('Math.max(1,reader.clientHeight-64)'), 'Tap turns one screen');
  assert.equal(await js('bookTitle.textContent'), 'Book B');
  await delay(100);
  assert.equal(await js('document.querySelector(".hold").hidden'), true, 'No ring for page keys');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: B shortcut, shelf sort (added / folder time / name, both directions), persistence, prev/next order, rename and restore, Shift+W / S / ↑ / ↓ change books once per press, holding A / D / arrows does not change books',
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
