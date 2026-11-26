// 多窗口端到端测试：同一个临时浏览器配置里开两个（以上）页面，每个页面是一个 CDP target。只用 OPFS 里自动生成的测试图片。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/windows.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-windows-'));
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
async function wait(check, tries = 150) {
  let last;
  for (let i = 0; i < tries; i++) {
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
const sockets = [];
let port;
// 一个页面（CDP target）：cdp / js / 按键 / 鼠标。
async function connect(target, name) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const pending = new Map(),
    errors = [];
  let id = 0;
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(Error(m.error.message));
      else p.resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(name + ': ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const cdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails)
      throw Error(name + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const codes = { f: ['KeyF', 70, 'f'], b: ['KeyB', 66, 'b'], Delete: ['Delete', 46, ''] };
  const key = async (k, type) => {
    const [code, vk, text] = codes[k];
    await cdp('Input.dispatchKeyEvent', {
      type,
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      ...(type === 'keyDown' && text ? { text } : {}),
    });
  };
  const press = async (k, ms = 40) => {
    await key(k, 'keyDown');
    await delay(ms);
    await key(k, 'keyUp');
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});window.confirm=()=>true;`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('!!document.querySelector("#bookTitle")&&document.readyState==="complete"'));
  const shot = async (file) => {
    if (!process.env.MV_SHOTS) return;
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.MV_SHOTS, file + '.png'), Buffer.from(data, 'base64'));
  };
  return { cdp, js, press, key, shot, errors, id: target.id, ws };
}
async function open(name) {
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  return connect(target, name);
}
// 等应用装好（书目载入、模块安装完）：书名或欢迎页已显示。
const booted = (p) =>
  wait(() =>
    p.js(
      'document.querySelector("#empty").hidden===false||document.querySelector("#bookTitle").textContent!=="MangaView"',
    ),
  );
const raw = (p, body) =>
  p.js(`new Promise((ok,no)=>{const r=indexedDB.open('mangaview-reader-v2');r.onsuccess=()=>{const db=r.result,tx=db.transaction('books','readwrite'),os=tx.objectStore('books');let out;
  (async()=>{${body}})().then(v=>{out=v;},no);tx.oncomplete=()=>{db.close();ok(out);};tx.onabort=()=>no(tx.error);};r.onerror=()=>no(r.error);})`);
const records = (p) =>
  p.js(
    `import('./src/core/store.mjs').then(({library})=>library('getAll')).then(l=>l.map(b=>({id:b.id,title:b.title,name:b.name??null,place:b.place,tags:b.tags,marks:(b.bookmarks||[]).length,future:b.future??null})))`,
  );
const record = async (p, title) => (await records(p)).find((b) => b.title === title);
// 在 OPFS 里生成一个文件夹（与默认尺寸 800×1120 相同的图），并让文件夹选择器返回它。
const folder = (p, name, n, prefix = '') =>
  p.js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('${name}',{create:true});
  for(let i=0;i<${n};i++){const out=await (await dir.getFileHandle('${prefix}'+i+'.svg',{create:true})).createWritable();
    await out.write('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1120"><rect width="100%" height="100%" fill="hsl('+i*47+',55%,38%)"/></svg>');await out.close();}
  window.showDirectoryPicker=async()=>dir;})()`);
const act = (p, name) =>
  p.js(
    `(async()=>{const b=document.createElement('button');b.dataset.act='${name}';document.body.append(b);b.click();b.remove();if('${name}'==='folder'){await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();}})()`,
  );
const title = (p) => p.js('document.querySelector("#bookTitle").textContent');
const notice = (p) => p.js('document.getElementById("notice").textContent');
const panelMarks = async (p) => {
  await p.js(`document.querySelector('.bm-panel').hidden||document.querySelector('.bm-panel').hidden`);
  return p.js(`document.querySelectorAll('.bm-panel .bm-item').length`);
};
const goto = (p, n, f = 0.5) =>
  p.js(`reader.scrollTop=${n}*reader.clientWidth*1.4+${f}*reader.clientWidth*1.4-reader.clientHeight/2`);
const hold = async (p) => {
  await p.key('f', 'keyDown');
  await delay(750);
  await p.key('f', 'keyUp');
};
let A, B, C;
try {
  port = await wait(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const first = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page');
  A = await connect(first, 'A');
  await wait(() => A.js('document.querySelector("#empty")?.hidden===false'));
  for (const name of ['Alpha', 'Beta', 'Omega']) {
    await folder(A, name, 24);
    await act(A, 'folder');
    await wait(async () => (await title(A)) === name);
  }
  await wait(() => A.js(`document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===1120`));
  B = await open('B');
  await booted(B);
  assert.equal(await title(B), 'Omega', 'The new window opens the book read last');
  await wait(() => B.js(`document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===1120`));
  assert.deepEqual(await A.js('[document.visibilityState,document.visibilityState]'), ['visible', 'visible']);

  // ---- 验收：两个窗口打开同一本书，几乎同时各加一个书签，两边最终都显示两个（不互相覆盖）。
  await goto(A, 3);
  await goto(B, 10);
  await delay(200);
  await Promise.all([hold(A), hold(B)]);
  await wait(async () => (await record(A, 'Omega')).marks === 2);
  for (const p of [A, B]) {
    await act(p, 'bookmarks');
    await wait(async () => (await p.js(`document.querySelectorAll('.bm-panel:not([hidden]) .bm-item').length`)) === 2);
    await act(p, 'bookmarks');
  }
  assert.equal(await A.js(`document.querySelectorAll('.bm-panel .bm-item').length`), 2);

  // ---- 写入以存储中的最新记录为基础：别的写入者加的标签和本程序不认识的字段，在本窗口保存时保留下来。
  await raw(
    A,
    `const all=await new Promise(r=>{const q=os.getAll();q.onsuccess=()=>r(q.result);});const b=all.find(x=>x.title==='Omega');b.tags=[...b.tags,'raw'];b.future={x:1};os.put(b);`,
  );
  await goto(B, 16);
  await delay(100);
  await hold(B);
  await wait(async () => (await record(A, 'Omega')).marks === 3);
  const omega = await record(A, 'Omega');
  assert.deepEqual(
    [omega.tags, omega.future],
    [['raw'], { x: 1 }],
    "Unknown fields and other writers' changes survive a save",
  );
  // 另一个窗口随之跟进：书签面板显示 3 个。
  await act(A, 'bookmarks');
  await wait(async () => (await A.js(`document.querySelectorAll('.bm-panel:not([hidden]) .bm-item').length`)) === 3);
  await act(A, 'bookmarks');

  // ---- 书名、所在列表：A 改动后 B 的书架在 1 秒内只更新受影响的卡片。
  await act(B, 'shelf');
  await wait(() => B.js('shelf.open&&document.querySelectorAll("#books .book").length===3'));
  const alphaId = (await record(A, 'Alpha')).id;
  const keep = await B.js(
    `(()=>{const el=document.querySelector('#books .book[data-id="${(await record(A, 'Beta')).id}"]');el.dataset.keep='1';return true;})()`,
  );
  await act(A, 'shelf');
  await wait(() => A.js('shelf.open&&document.querySelectorAll("#books .book").length===3'));
  await A.js(
    `document.querySelector('#books .book[data-id="${alphaId}"] .more').click();cardMenu.querySelector('use[href="#i-pencil"]').closest('button').click()`,
  );
  await wait(() => A.js('renameBook.open'));
  await A.js(`renameInput.value='Alpha renamed';renameForm.requestSubmit()`);
  let t0 = Date.now();
  await wait(() =>
    B.js(`document.querySelector('#books .book[data-id="${alphaId}"] .name')?.textContent==='Alpha renamed'`),
  );
  assert.ok(Date.now() - t0 < 1000, 'Rename shows in the other window within a second: ' + (Date.now() - t0) + 'ms');
  assert.equal(
    await B.js(`document.querySelector('#books .book[data-keep="1"]')?.dataset.keep`),
    '1',
    'Unaffected cards are kept',
  );
  await A.js(
    `document.querySelector('#books .book[data-id="${alphaId}"] use[href="#i-archive"]').closest('button').click()`,
  );
  t0 = Date.now();
  await wait(() =>
    B.js(
      `!document.querySelector('#books .book[data-id="${alphaId}"]')&&document.querySelectorAll("#books .book").length===2`,
    ),
  );
  assert.ok(Date.now() - t0 < 1000, 'Moving to the library shows in the other window within a second');
  await A.js('shelf.close()');
  await B.js('shelf.close()');

  // ---- 设置类偏好即时同步（专注模式、语言），布局类偏好各窗口独立（常驻缩略图栏）。
  assert.equal(await B.js('document.body.classList.contains("focus-mode")'), true);
  await act(A, 'settings');
  await wait(() => A.js('document.getElementById("settings").open'));
  await A.js(`document.querySelector('#settings [data-id="focusMode"] .set-switch').click()`);
  await wait(() => B.js('!document.body.classList.contains("focus-mode")'));
  await A.js(
    `(()=>{const s=document.querySelector('#settings [data-id="lang"] select');s.value='ja';s.dispatchEvent(new Event('change'));})()`,
  );
  await wait(() => B.js('document.documentElement.lang==="ja"'));
  await A.js(
    `(()=>{const s=document.querySelector('#settings [data-id="lang"] select');s.value='';s.dispatchEvent(new Event('change'));})()`,
  );
  await wait(() => B.js('document.documentElement.lang==="en"'));
  await A.js('document.getElementById("settings").close()');
  await A.js(`document.querySelector('#bar [data-act="preview"]').click()`);
  assert.equal(await A.js('document.body.classList.contains("docked")'), true);
  await delay(300);
  assert.equal(await B.js('document.body.classList.contains("docked")'), false, 'Layout preferences stay per window');
  assert.equal(await B.js('localStorage.getItem("mv2:preview")'), 'true', 'The last written layout is used next time');
  await A.js(`document.querySelector('#bar [data-act="preview"]').click()`);
  // 搜索预设是数据：别的窗口新增的预设随即读入，本窗口之后保存预设时不会覆盖掉它。
  await A.js(
    `localStorage.setItem('mv2:shelfPresets',JSON.stringify([{id:'p1',name:'From A',f:{q:'x',min:'',max:'',tags:[],marked:false}}]))`,
  );
  await act(B, 'shelf');
  await wait(() => B.js('shelf.open'));
  await B.js(`document.getElementById('presetBtn').click()`);
  await wait(() =>
    B.js(`[...document.querySelectorAll('#presetPop .pp-row strong')].map(e=>e.textContent).join()==='From A'`),
  );
  await B.js(`document.getElementById('presetPop').hidePopover();shelf.close()`);

  // ---- 删除：A 删除两个窗口正在读的书，B 提示并切到下一本，记录不会被 B 写回。
  const omegaId = omega.id;
  await A.js('reader.focus()');
  await A.press('Delete');
  await wait(async () => !(await records(A)).some((b) => b.id === omegaId));
  await wait(async () => (await title(B)) === 'Beta');
  assert.equal(await notice(B), 'This book was removed in another window');
  await goto(B, 6);
  await delay(1200);
  assert.ok(!(await records(B)).some((b) => b.id === omegaId), 'A deleted record is not written back');
  // 别的写入者删掉了记录而 B 还不知道：B 之后的保存发现记录已不存在，不写回并切走。
  const betaId = (await record(A, 'Beta')).id;
  await raw(A, `os.delete('${betaId}');`);
  await goto(B, 8);
  await delay(100);
  await hold(B);
  await wait(async () => (await title(B)) === 'Alpha renamed');
  assert.equal(await notice(B), 'This book was removed in another window');
  await delay(500);
  assert.ok(!(await records(B)).some((b) => b.id === betaId), 'A save does not resurrect a deleted record');

  // ---- 后台磁盘任务只由一个窗口执行：B 导入的书由 A（锁的持有者）生成封面，B 不读盘，封面同步到 B。
  const reads = (p) =>
    p.js(
      `(()=>{const o=FileSystemFileHandle.prototype.getFile;window.__reads=[];FileSystemFileHandle.prototype.getFile=function(){window.__reads.push(this.name);return o.call(this);};})()`,
    );
  await reads(A);
  await reads(B);
  await act(B, 'shelf');
  await wait(() => B.js('shelf.open'));
  await folder(B, 'Gamma', 6, 'g');
  await act(B, 'folder');
  const gammaId = await wait(async () => (await record(B, 'Gamma'))?.id);
  await wait(() => B.js(`!!document.querySelector('#books .book[data-id="${gammaId}"] .cover img')`));
  assert.ok((await A.js('window.__reads')).includes('g0.svg'), 'The lock holder generates the cover');
  assert.deepEqual(
    (await B.js('window.__reads')).filter((n) => n.startsWith('g')),
    [],
    'Other windows do not read the disk for it',
  );
  // 持有者关闭后由 B 接手：B 再导入的书，封面由 B 自己生成。
  await fetch('http://127.0.0.1:' + port + '/json/close/' + A.id);
  await folder(B, 'Delta', 6, 'd');
  await act(B, 'folder');
  const deltaId = await wait(async () => (await record(B, 'Delta'))?.id);
  await wait(() => B.js(`!!document.querySelector('#books .book[data-id="${deltaId}"] .cover img')`));
  assert.ok((await B.js('window.__reads')).includes('d0.svg'), 'After the holder closes another window takes over');
  await B.js('shelf.close()');

  // ---- 全局操作：B 还原默认设置、清空数据，C 自动重新载入并提示原因；清空后不被 C 写回。
  C = await open('C');
  await booted(C);
  await C.js('window.__before=1');
  await act(B, 'settings');
  await wait(() => B.js('document.getElementById("settings").open'));
  await B.js(`document.querySelector('#settings .set-foot button').click()`);
  await wait(() => C.js('window.__before===undefined&&document.readyState==="complete"'));
  await booted(C);
  await wait(async () => (await notice(C)) === 'Settings were restored to defaults in another window; reloaded');
  assert.equal(
    await C.js('document.body.classList.contains("focus-mode")'),
    true,
    'Reset settings apply in the other window',
  );
  await booted(B);
  await C.js('window.__before=1');
  await act(B, 'clear');
  await wait(() => C.js('window.__before===undefined&&document.readyState==="complete"'));
  await wait(() => C.js('document.querySelector("#empty").hidden===false'));
  await wait(async () => (await notice(C)) === 'All data was cleared in another window; reloaded');
  await delay(500);
  assert.deepEqual(await records(C), [], 'Nothing is written back after clearing');

  // ---- 存储结构升级：新版本打开数据库时，旧窗口让出连接（不阻塞）并提示重新载入。
  const upgraded = await C.js(
    `new Promise(ok=>{const r=indexedDB.open('mangaview-reader-v2',3);r.onblocked=()=>ok('blocked');r.onsuccess=()=>{r.result.close();ok('ok');};r.onerror=()=>ok('error');setTimeout(()=>ok('timeout'),5000);})`,
  );
  assert.equal(upgraded, 'ok', 'Old windows give up their connection');
  for (const p of [B, C])
    await wait(() =>
      p.js(
        `document.getElementById('dbUpgraded')?.matches(':popover-open')&&document.getElementById('dbUpgraded').textContent.includes('Reload')`,
      ),
    );
  await B.shot('db-upgraded');

  const errors = [A, B, C].flatMap((p) => p.errors);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: two windows add a bookmark each and both show two, saves merge over the latest record and keep unknown fields, rename / move reflected within a second, settings sync while layout stays per window, deletions switch away and are never written back, background disk work runs in one window and is taken over, global operations reload other windows, database upgrade yields',
  );
} finally {
  for (const ws of sockets)
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
      break;
    }
  for (const ws of sockets)
    try {
      ws.close();
    } catch {}
  server.close();
  for (let i = 0; i < 30 && chrome.exitCode === null; i++) await delay(100);
  if (chrome.exitCode === null) chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
