// 阅读列表与删除当前书（reader/session.mjs、core/reading.mjs）：上一本 / 下一本、书架书签按书架页当前页签 + 筛选 + 排序；删除当前书（本窗口、批量、别的窗口）后切到列表里的下一本 / 上一本，列表空了回到书架页；
// 藏书很多（2000 本、300 本有书签）时书架书签列表与全屏书架书签的耗时。独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/readinglist.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-readinglist-'));
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
    '--window-size=1100,760',
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
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});if(localStorage.getItem('mv2:shelfmarks')===null){localStorage.setItem('mv2:shelfmarks','true');localStorage.setItem('mv2:shelfSort','"nameAsc"');}`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 六本书 A–F（各 2 页），按名称正序；D、E 在书库；A、D 各有一个书签；另有一本过期书 X（没有文件夹）。
  await js(`(async()=>{const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('lib',{create:true});
    for(const n of 'ABCDEF'){const d=await root.getDirectoryHandle(n,{create:true});
      for(let j=0;j<2;j++){const w=await (await d.getFileHandle(j+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="hsl('+(n.charCodeAt(0)*37+j*40)+',50%,40%)"/></svg>');await w.close();}}
    window.showDirectoryPicker=async()=>root;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  const records = () => js(`import('./src/core/store.mjs').then(({library})=>library('getAll'))`);
  await wait(async () => (await records()).length === 6);
  await js(`(async()=>{const {library}=await import('./src/core/store.mjs');const all=await library('getAll');
    for(const b of all){if('DE'.includes(b.title))b.place='library';if('AD'.includes(b.title))b.bookmarks=[{id:'m'+b.title,name:'0.svg',f:.5,at:1}];await library('put',b);}
    await library('put',{id:'x-expired',title:'X',place:'shelf',added:1,pages:[{name:'0.svg'}],sources:[{key:'',title:'X'}],tags:[],bookmarks:[]});
    localStorage.setItem('mv2:last',JSON.stringify(all.find(b=>b.title==='A').id));})()`);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='A'&&!!document.querySelector('#shelfmarks .sm-list .bm-item')`));
  await js(
    `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));window.S=()=>import('./src/reader/session.mjs');`,
  );
  const current = () => js('bookTitle.textContent');
  const list = () => js('S().then(s=>s.readingList().map(b=>b.title).join(""))');
  const dock = () =>
    js(
      `import('./src/core/books.mjs').then(m=>[...document.querySelectorAll('#shelfmarks .sm-book')].map(s=>m.books.get(s.dataset.book).title).join(''))`,
    );
  const next = async (d = 1) => {
    await js(`document.querySelector('#controlbar [data-act="${d > 0 ? 'next' : 'prev'}"]').click()`);
    await js('frame()');
  };
  const tab = async (view) => {
    await js(`document.querySelector('#bar [data-act="shelf"]').click()`);
    await wait(() => js('shelf.open'));
    await js(`document.querySelector('#views [data-view="${view}"]').click()`);
    await wait(() =>
      js(`document.querySelector('#views [data-view="${view}"]').getAttribute('aria-selected')==='true'`),
    );
    await js('shelf.close()');
    await wait(() => js('!shelf.open'));
  };
  // 1. 书架页签（默认）：阅读列表是书架上的书，过期书不在其中；上一本 / 下一本首尾循环；书架书签只有书架上的书。
  assert.equal(await list(), 'ABCF');
  assert.equal(await dock(), 'A');
  await next();
  assert.equal(await current(), 'B');
  await next(-1);
  await next(-1);
  assert.equal(await current(), 'F', 'Wraps around to the last book');
  await next();
  assert.equal(await current(), 'A');
  // 2. 书库页签：列表换成书库；当前书 A 不在其中，从它按排序应在的位置走到最近的一本；书架书签、全屏书架书签也跟着换。
  await tab('library');
  assert.equal(await list(), 'DE');
  await wait(async () => (await dock()) === 'D');
  await js('reader.focus()');
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'c',
    code: 'KeyC',
    windowsVirtualKeyCode: 67,
    text: 'c',
  });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
  await wait(() => js('shelfOverview.open'));
  assert.deepEqual(await js(`[...shelfOverview.querySelectorAll('.ov-sec-head strong')].map(e=>e.textContent)`), ['D']);
  await js('shelfOverview.close()');
  await wait(() => js('!shelfOverview.open'));
  await next();
  assert.equal(await current(), 'D');
  await next();
  await next();
  assert.equal(await current(), 'D');
  // 3. 全部页签：书架 + 书库（不含过期书）；选中过期书籍页签时沿用之前的列表。
  await tab('all');
  assert.equal(await list(), 'ABCDEF');
  await wait(async () => (await dock()) === 'AD');
  await tab('expired');
  assert.equal(await list(), 'ABCDEF', 'The expired tab keeps the previous list');
  await tab('all');
  // 4. 删除当前书（Delete）：切到列表里原顺序的下一本；没有下一本则上一本。
  await js('window.confirm=()=>true');
  const del = async () => {
    await js('reader.focus()');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  };
  await js(`S().then(s=>s.select(s.readingList().find(b=>b.title==='C')))`);
  await wait(async () => (await current()) === 'C');
  await del();
  await wait(async () => (await current()) === 'D');
  assert.equal(await list(), 'ABDEF');
  await js(`S().then(s=>s.select(s.readingList().find(b=>b.title==='F')))`);
  await wait(async () => (await current()) === 'F');
  await del();
  await wait(async () => (await current()) === 'E');
  assert.equal(await js('shelf.open'), false);
  // 卡片上的删除按钮同样：书架页里删除当前书 D，切到 E（A、B、D、E 中 D 的下一本）。
  await js(`S().then(s=>s.select(s.readingList().find(b=>b.title==='D')))`);
  await wait(async () => (await current()) === 'D');
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);
  await wait(() => js('shelf.open'));
  await js(`(async()=>{const id=(await S()).current.id;const card=document.querySelector('#books .book[data-id="'+id+'"]');card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    const b=[...card.querySelectorAll('button')].find(x=>/^(Delete|Remove)/.test(x.getAttribute('aria-label')||x.title||''));b.click();})()`);
  await wait(async () => (await current()) === 'E');
  // 5. 批量：书库页签下清空书库（当前书 E 在其中）：列表空了，回到书架页，当前没有书。
  await js(`document.querySelector('#views [data-view="library"]').click()`);
  await wait(() => js(`document.querySelector('#views [data-view="library"]').getAttribute('aria-selected')==='true'`));
  await js(`[...bulkActions.querySelectorAll('button')].find(b=>b.textContent.startsWith('Clear library')).click()`);
  await wait(async () => (await records()).length === 3);
  await wait(async () => (await current()) === 'MangaView');
  assert.equal(await js('shelf.open'), true, 'Back to the shelf page');
  await js(`document.querySelector('#views [data-view="shelf"]').click()`);
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));
  // 6. 别的窗口删除了当前书（core/books.mjs 的 vanish）：同样切到列表里的下一本 / 上一本；列表空了回到书架页。
  const vanish = (t) =>
    js(`(async()=>{const {library}=await import('./src/core/store.mjs');const id=(await library('getAll')).find(b=>b.title==='${t}').id;
      await library('delete',id);await (await import('./src/core/books.mjs')).pull([id]);})()`);
  await next();
  assert.equal(await current(), 'A');
  await vanish('A');
  await wait(async () => (await current()) === 'B');
  await wait(() => js(`notice.textContent==='This book was removed in another window'`));
  await vanish('B');
  await wait(async () => (await current()) === 'MangaView' && (await js('shelf.open')));
  assert.equal(await js('document.querySelector("#empty").hidden'), false);
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));

  // 7. 藏书很多：2000 本（全部页签），其中 300 本各有 3 个书签（带缩略图）。书架书签列表、全屏书架书签的耗时。
  await js(`(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('Z',{create:true});
    for(let j=0;j<3;j++){const w=await (await d.getFileHandle(j+'.svg',{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>');await w.close();}
    window.showDirectoryPicker=async()=>d;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(async () => (await current()) === 'Z');
  await js(`(async()=>{const {library,thumbs}=await import('./src/core/store.mjs');const z=(await library('getAll')).find(b=>b.title==='Z');
    const c=new OffscreenCanvas(240,340),g=c.getContext('2d');g.fillStyle='#596';g.fillRect(0,0,240,340);const blob=await c.convertToBlob({type:'image/webp'});
    const recs=[];for(let i=0;i<2000;i++){const id='bulk'+String(i).padStart(4,'0'),name='N'+String(i).padStart(4,'0');
      const b={...structuredClone(z),id,title:name,name:null,added:i,place:i%2?'library':'shelf',sources:z.sources.map(s=>({...s,title:name})),bookmarks:[]};
      if(i%20<3)for(let k=0;k<3;k++){b.bookmarks.push({id:id+'m'+k,name:z.pages[k].name,f:.5,at:k});await thumbs('put',{blob,w:240,h:340},id+':bm:'+id+'m'+k);}
      recs.push(library('put',b));}
    await Promise.all(recs);localStorage.setItem('mv2:shelfView','"all"');localStorage.setItem('mv2:last',JSON.stringify('bulk1000'));})()`);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='N1000'&&document.querySelectorAll('#shelfmarks .sm-book').length>0`));
  await js(
    `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));window.S=()=>import('./src/reader/session.mjs');`,
  );
  await delay(800);
  assert.equal(await js('S().then(s=>s.readingList().length)'), 2001); // 加上 Z 本身
  await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
  const cost = await js(`(async()=>{const b=document.querySelector('#bar [data-act="shelfmarks"]'),out={};
    b.click();await frame();
    let t=performance.now();b.click();await frame();out.dock=Math.round(performance.now()-t);
    out.groups=document.querySelectorAll('#shelfmarks .sm-book').length;out.items=document.querySelectorAll('#shelfmarks .bm-item').length;
    const list=document.querySelector('#shelfmarks .sm-list'),gaps=[];let last=performance.now();
    for(let i=0;i<80;i++){list.scrollTop+=300;await new Promise(r=>requestAnimationFrame(r));const now=performance.now();gaps.push(now-last);last=now;}
    out.scrollMax=Math.round(Math.max(...gaps));out.scrollLong=gaps.filter(g=>g>50).length;
    t=performance.now();reader.focus();reader.dispatchEvent(new KeyboardEvent('keydown',{key:'c',code:'KeyC',bubbles:true}));await frame();await frame();out.overview=Math.round(performance.now()-t);
    out.open=shelfOverview.open;out.sections=shelfOverview.querySelectorAll('.ov-sec').length;
    const sc=shelfOverview.querySelector('.ov-scroll')||shelfOverview.querySelector('[class*=scroll]');const g2=[];last=performance.now();
    for(let i=0;i<80;i++){sc.scrollTop+=300;await new Promise(r=>requestAnimationFrame(r));const now=performance.now();g2.push(now-last);last=now;}
    out.ovScrollMax=Math.round(Math.max(...g2));out.ovScrollLong=g2.filter(g=>g>50).length;shelfOverview.close();return out;})()`);
  await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log('2000 books / 300 with bookmarks (CPU 4x slower):', JSON.stringify(cost));
  // 改动前（每个分组都排版、绘制）在同样条件下约为：书架书签 1300–1700ms、滚动 17–30 个长帧，全屏书架书签 1200–1500ms。
  assert.equal(cost.groups, 300);
  assert.equal(cost.open, true);
  assert.equal(cost.sections, 300);
  assert.ok(cost.dock < 1000, 'Shelf bookmarks render quickly with many books: ' + cost.dock);
  assert.ok(cost.overview < 1100, 'Full-screen shelf bookmarks open quickly with many books: ' + cost.overview);
  assert.ok(
    cost.scrollLong <= 8 && cost.ovScrollLong <= 8,
    'Scrolling stays smooth: ' + [cost.scrollLong, cost.ovScrollLong],
  );

  assert.deepEqual(errors, []);
  console.log(
    'PASS: the reading list follows the shelf tab (expired keeps the previous one), filters and sort for previous / next book and shelf bookmarks; deleting the current book (Delete, card button, clearing, another window) moves to the next / previous one or back to the shelf; shelf bookmarks stay quick with 2000 books',
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
