// 书架的「添加」对话框与卡片的操作按钮 / 「更多」菜单端到端测试：独立临时配置 + OPFS 测试数据，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/add.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-add-'));
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
    '--window-size=900,900',
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
  // 等列表变成 n 行；超时时带上当时的状态。
  const rowsN = (n) =>
    wait(async () => (await js('rows()')).length === n).catch(async (e) => {
      throw Error(e.message + ' state: ' + (await js('JSON.stringify([rows(),addDialog.open,notice.textContent])')));
    });
  const shot = async (name) => {
    if (!process.env.MV_SHOTS) return;
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.MV_SHOTS, name + '.png'), Buffer.from(data, 'base64'));
  };
  const keys = {
    down: ['ArrowDown', 40],
    up: ['ArrowUp', 38],
    home: ['Home', 36],
    end: ['End', 35],
    esc: ['Escape', 27],
    enter: ['Enter', 13],
  };
  const press = async (k) => {
    const [key, code] = keys[k];
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
    if (k === 'enter') await cdp('Input.dispatchKeyEvent', { type: 'char', key, text: '\r' });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    await delay(60);
  };
  const click = async (expr) => {
    const [x, y] = await js(
      `(()=>{const r=(${expr}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await delay(80);
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['zh-CN']});if(!localStorage.getItem('mv2:shelfSort'))localStorage.setItem('mv2:shelfSort','"nameAsc"');`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 测试数据：每个文件夹若干张 SVG；f 里另有字幕和 .pbf 之外的散落文件。
  await js(`(async()=>{
    window.mk=async(path,n,color='teal',ext='svg')=>{let d=await navigator.storage.getDirectory();for(const part of path.split('/'))d=await d.getDirectoryHandle(part,{create:true});
      for(let i=1;i<=n;i++){const w=await (await d.getFileHandle(i+'.'+ext,{create:true})).createWritable();await w.write('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="'+(400+i)+'"><rect width="100%" height="100%" fill="'+color+'"/></svg>');await w.close();}};
    window.put=async(path,text)=>{const parts=path.split('/'),name=parts.pop();let d=await navigator.storage.getDirectory();for(const part of parts)d=await d.getDirectoryHandle(part,{create:true});const w=await (await d.getFileHandle(name,{create:true})).createWritable();await w.write(text);await w.close();};
    window.dirOf=async path=>{let d=await navigator.storage.getDirectory();for(const part of path.split('/'))d=await d.getDirectoryHandle(part);return d;};
    window.fh=async path=>{const parts=path.split('/'),name=parts.pop();return (await dirOf(parts.join('/'))).getFileHandle(name);};
    window.rm=async path=>{const parts=path.split('/'),name=parts.pop();const d=parts.length?await dirOf(parts.join('/')):await navigator.storage.getDirectory();await d.removeEntry(name,{recursive:true});};
    window.records=()=>import('./src/core/store.mjs').then(({library})=>library('getAll'));
    window.byTitle=async t=>(await records()).find(b=>b.title===t);
    window.loose=async()=>(await records()).find(b=>!b.sources?.length);
    window.opened=()=>new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});
    window.rows=()=>[...addList.querySelectorAll('.add-item')].map(li=>li.querySelector('.add-type').classList[1]+':'+li.querySelector('.add-name').textContent);
    window.queue=[];DataTransferItem.prototype.getAsFileSystemHandle=function(){return Promise.resolve(window.queue.shift()??null);};
    window.dragTo=(el,type,n=1)=>{const dt=new DataTransfer();for(let i=0;i<n;i++)dt.items.add(new File([],'x'+i));el.dispatchEvent(new DragEvent(type,{dataTransfer:dt,bubbles:true,cancelable:true}));};
    await mk('A',2,'red');await mk('B',2,'blue');await mk('S/V1',2,'green');await mk('S/V2',1,'olive');
    await mk('S2/P',2,'gray');await mk('S2/Q',2,'pink');await mk('S3a/M',1,'navy');await mk('S3b/N',1,'gold');
    await mk('L',1,'purple');await mk('L/sub',1,'orange');await mk('f',2,'brown');
    await put('f/x.srt','1\\n00:00:01,000 --> 00:00:02,000\\nhi\\n');
  })()`);

  // 1. 入口与叫法：「添加」「添加到散图图集」；原「导入为单个作品」按钮已取消。
  assert.deepEqual(
    await js(
      `[...new Set([...document.querySelectorAll('[data-act="folder"]')].map(b=>b.textContent.trim()||b.title))]`,
    ),
    ['添加'],
  );
  assert.deepEqual(
    await js(
      `[...new Set([...document.querySelectorAll('[data-act="files"]')].map(b=>b.textContent.trim()||b.title))]`,
    ),
    ['添加到散图图集'],
  );
  assert.equal(await js(`document.querySelectorAll('[data-act="merge"]').length`), 0);
  assert.ok((await js('fileInput.accept')).includes('.srt,.vtt,.ass,.ssa,.lrc'), 'Subtitle files can be picked');
  // 2. 取消系统选择框且列表为空：不弹出对话框。
  await js(
    `window.showDirectoryPicker=async()=>{throw new DOMException('','AbortError');};document.querySelector('#empty [data-act="folder"]').click()`,
  );
  await delay(250);
  assert.equal(await js('addDialog.open'), false, 'Cancelled picker shows no dialog');
  assert.equal(await js('notice.textContent'), '', 'Cancelling is not an error');
  // 3. 「添加」：先选一个文件夹，进入对话框；默认焦点在「添加为多个作品」。
  await js(
    `(async()=>{const d=await dirOf('A');window.showDirectoryPicker=async()=>d;document.querySelector('#empty [data-act="folder"]').click();await opened();})()`,
  );
  assert.deepEqual(await js('rows()'), ['folder:A']);
  assert.equal(await js('addTitle.textContent'), '添加');
  assert.equal(await js('document.activeElement.id'), 'addMany');
  assert.deepEqual(
    await js(
      `['addMany','addOne','addLoose'].map(id=>{const b=document.getElementById(id);return id+':'+(b.hidden?'hidden':b.disabled?'off':'on');})`,
    ),
    ['addMany:on', 'addOne:on', 'addLoose:hidden'],
  );
  // 主次：主按钮更大、在右侧；两个确认按钮都在对话框内。
  const lay = await js(
    `(()=>{const r=id=>document.getElementById(id).getBoundingClientRect().toJSON(),d=addDialog.getBoundingClientRect().toJSON();return {many:r('addMany'),one:r('addOne'),d,folder:r('addFolder'),files:r('addFiles')};})()`,
  );
  assert.ok(
    lay.many.height > lay.one.height && lay.many.left > lay.one.right,
    'Primary button is larger and last: ' + JSON.stringify(lay),
  );
  for (const k of ['many', 'one', 'folder', 'files'])
    assert.ok(
      lay[k].left >= lay.d.left && lay[k].right <= lay.d.right && lay[k].bottom <= lay.d.bottom,
      k + ' inside the dialog',
    );
  // 4. 继续追加：同一个文件夹（新句柄）不重复，已有的那一行闪一下；文件可多选，字幕也能选入。
  await js(`(async()=>{const d=await dirOf('A');window.showDirectoryPicker=async()=>d;addFolder.click();})()`);
  await wait(() => js(`addList.querySelector('.add-item.dup')!==null`));
  assert.deepEqual(await js('rows()'), ['folder:A']);
  await js(`(async()=>{const d=await dirOf('B');window.showDirectoryPicker=async()=>d;addFolder.click();})()`);
  await rowsN(2);
  await js(
    `(async()=>{const l=[await fh('f/1.svg'),await fh('f/x.srt'),await fh('f/2.svg')];window.showOpenFilePicker=async()=>l;addFiles.click();})()`,
  );
  await rowsN(5);
  await js(`(async()=>{const l=[await fh('f/1.svg')];window.showOpenFilePicker=async()=>l;addFiles.click();})()`);
  await delay(200);
  assert.deepEqual(await js('rows()'), ['folder:A', 'folder:B', 'image:1.svg', 'file:x.srt', 'image:2.svg']);
  // 逐项移除：焦点落到下一行的移除按钮。
  await js(`addList.querySelectorAll('.add-x')[4].focus()`);
  await press('enter');
  assert.deepEqual(await js('rows()'), ['folder:A', 'folder:B', 'image:1.svg', 'file:x.srt']);
  assert.equal(await js(`document.activeElement===addList.querySelectorAll('.add-x')[3]`), true);
  // 5. 拖放到对话框：一次拖入多个文件夹和文件，追加进列表、去重；窗口的拖入覆盖层不出现。
  await js(`dragTo(addList,'dragenter',2)`);
  assert.equal(await js(`addDialog.classList.contains('over')`), true);
  assert.equal(await js('dropOverlay.hidden'), true, 'The window drop overlay stays hidden');
  await js(`dragTo(addList,'dragover',2)`);
  await shot('add-drag');
  await js(`(async()=>{window.queue=[await dirOf('S'),await dirOf('B')];dragTo(addList,'drop',2);})()`);
  await rowsN(5);
  assert.deepEqual(await js('rows()'), ['folder:A', 'folder:B', 'image:1.svg', 'file:x.srt', 'folder:S']);
  assert.equal(await js(`addDialog.classList.contains('over')||!dropOverlay.hidden`), false);
  assert.equal(await js('records().then(r=>r.length)'), 0, 'Nothing is scanned before confirming');
  await shot('add-dialog');
  // 6. 添加为多个作品：文件夹各自成书（S 下的各卷各成一本），零散文件进散图图集；字幕不是页。
  await js('addMany.click()');
  await wait(async () => (await js('records()')).length === 5);
  assert.equal(await js('addDialog.open'), false);
  assert.deepEqual((await js('records()')).map((b) => b.title ?? '(loose)').sort(), ['(loose)', 'A', 'B', 'V1', 'V2']);
  assert.deepEqual(
    (await js('loose()')).pages.map((p) => p.name),
    ['1.svg'],
  );
  // 7. 添加为单个作品（书架页）：一个根文件夹用其名；多个根文件夹取文件名顺序第一个。
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);
  await wait(() => js('shelf.open'));
  await js(
    `(async()=>{const d=await dirOf('S2');window.showDirectoryPicker=async()=>d;document.querySelector('#shelf [data-act="folder"]').click();await opened();addOne.click();})()`,
  );
  await wait(async () => (await js(`byTitle('S2')`))?.sources?.length === 2);
  await wait(() => js(`notice.textContent.includes('已合成一本：S2（2 个文件夹）')`));
  await js(
    `(async()=>{const b=await dirOf('S3b'),a=await dirOf('S3a');window.showDirectoryPicker=async()=>b;document.querySelector('#shelf [data-act="folder"]').click();await opened();window.showDirectoryPicker=async()=>a;addFolder.click();})()`,
  );
  await rowsN(2);
  await js('addOne.click()');
  await wait(async () => (await js(`byTitle('S3a')`))?.sources?.length === 2).catch(async (e) => {
    throw Error(
      e.message +
        ' state: ' +
        (await js(
          'records().then(r=>JSON.stringify([r.map(b=>b.title+":"+(b.sources||[]).map(s=>s.key)),addDialog.open,notice.textContent,rows()]))',
        )),
    );
  });
  assert.deepEqual(
    (await js(`byTitle('S3a')`)).sources.map((s) => s.key),
    ['S3a/M', 'S3b/N'],
  );
  // 只有文件时「添加为单个作品」不可用（占位不动）；Esc 只关闭对话框，什么也不添加。
  const count0 = (await js('records()')).length;
  await js(
    `(async()=>{const d=await dirOf('A');window.showDirectoryPicker=async()=>d;document.querySelector('#shelf [data-act="folder"]').click();await opened();const l=[await fh('f/2.svg')];window.showOpenFilePicker=async()=>l;addFiles.click();})()`,
  );
  await rowsN(2);
  await wait(() => js('!addDialog.getAnimations({subtree:true}).length'));
  const oneAt = await js(`(()=>{const r=addOne.getBoundingClientRect();return [r.left,r.top,r.width].join()})()`);
  await js(`addList.querySelector('.add-x').click()`);
  assert.deepEqual(await js('rows()'), ['image:2.svg']);
  assert.equal(await js('addOne.disabled+"|"+addMany.disabled'), 'true|false');
  assert.equal(
    await js(`(()=>{const r=addOne.getBoundingClientRect();return [r.left,r.top,r.width].join()})()`),
    oneAt,
  );
  await js(`addList.querySelector('.add-x').click()`);
  assert.equal(
    await js('addMany.disabled+"|"+addEmpty.hidden'),
    'true|false',
    'Empty list: nothing to confirm, drop hint shown',
  );
  await press('esc');
  await wait(() => js('!addDialog.open'));
  assert.equal(await js('shelf.open'), true, 'Esc closes only the add dialog');
  assert.equal((await js('records()')).length, count0);
  // 关闭后马上再打开：上一次的 close 事件（异步派发）晚到时不能清空新打开的列表。
  await js(
    `(async()=>{const a=await dirOf('A'),b=await dirOf('B');window.showDirectoryPicker=async()=>a;document.querySelector('#shelf [data-act="folder"]').click();await opened();window.showDirectoryPicker=async()=>b;addDialog.querySelector('[data-close]').click();document.querySelector('#shelf [data-act="folder"]').click();})()`,
  );
  await delay(300);
  assert.deepEqual(await js('[addDialog.open,rows(),addMany.disabled]'), [true, ['folder:B'], false]);
  // 用关闭按钮关（脚本连开的对话框没有用户激活，Esc 会被浏览器按组一起关掉，与真实操作不同）。
  await js(`addDialog.querySelector('[data-close]').click()`);
  await wait(() => js('!addDialog.open&&shelf.open'));
  // 8. 添加到散图图集：先选文件，可追加文件夹；只有「添加到散图图集」一个确认按钮，文件夹里（含子文件夹）的文件全部并入图集。
  await js(
    `(async()=>{const l=[await fh('f/2.svg')];window.showOpenFilePicker=async()=>l;document.querySelector('#shelf [data-act="files"]').click();await opened();})()`,
  );
  assert.equal(await js('addTitle.textContent'), '添加到散图图集');
  assert.equal(await js('document.activeElement.id'), 'addLoose');
  assert.deepEqual(await js(`['addMany','addOne','addLoose'].map(id=>document.getElementById(id).hidden)`), [
    true,
    true,
    false,
  ]);
  await js(`(async()=>{const d=await dirOf('L');window.showDirectoryPicker=async()=>d;addFolder.click();})()`);
  await rowsN(2);
  await shot('add-loose');
  await js('addLoose.click()');
  await wait(async () => (await js('loose()')).pages.length === 4);
  assert.deepEqual((await js('loose()')).pages.map((p) => p.name).sort(), ['1.svg', '2.svg', 'L/1.svg', 'L/sub/1.svg']);
  assert.equal((await js('records()')).length, count0, 'No book made for the folder');
  // 9. 回退（没有 File System Access API）：每次 <input> 选择追加进列表，重复的不再加；取消且列表为空时不弹出。
  await js('window.showDirectoryPicker=null;window.showOpenFilePicker=null');
  await js(`document.querySelector('#shelf [data-act="folder"]').click()`);
  await delay(50);
  await js(`folderInput.dispatchEvent(new Event('cancel'))`);
  await delay(150);
  assert.equal(await js('addDialog.open'), false);
  await js(
    `window.mkFiles=paths=>paths.map(p=>{const f=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"/>'],p.split('/').pop(),{type:'image/svg+xml',lastModified:1});Object.defineProperty(f,'webkitRelativePath',{value:p.includes('/')?p:''});return f;})`,
  );
  await js(
    `(async()=>{document.querySelector('#shelf [data-act="folder"]').click();await new Promise(r=>setTimeout(r,50));folderInput.onchange({target:{files:mkFiles(['FB/1.svg','FB/2.svg'])}});await opened();})()`,
  );
  assert.deepEqual(await js('rows()'), ['folder:FB']);
  await js(
    `(async()=>{addFiles.click();await new Promise(r=>setTimeout(r,50));fileInput.onchange({target:{files:mkFiles(['solo.svg'])}});})()`,
  );
  await rowsN(2);
  await js(
    `(async()=>{addFolder.click();await new Promise(r=>setTimeout(r,50));folderInput.onchange({target:{files:mkFiles(['FB/1.svg','FB/2.svg'])}});})()`,
  );
  await delay(200);
  assert.deepEqual(await js('rows()'), ['folder:FB', 'image:solo.svg']);
  await js('addMany.click()');
  await wait(async () => (await js(`byTitle('FB')`))?.pages?.length === 2);
  await wait(async () => (await js('loose()')).pages.some((p) => p.name === 'solo.svg'));

  // 10. 卡片上的操作按钮：固定四个位置；「更多」菜单可用方向键、回车、Esc，关闭后焦点回到「更多」。
  await js(`document.querySelector('[data-view="all"]').click()`);
  const card = (t) =>
    `[...document.querySelectorAll('#books .book')].find(b=>b.querySelector('.pick').getAttribute('aria-label')==='${t}')`;
  await wait(() => js(`!!${card('A')}`));
  await js(
    `${card('A')}.querySelector('.pick').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',screenX:1,screenY:2}))`,
  );
  await wait(() => js(`${card('A')}.classList.contains('active')`));
  const icons = (t) =>
    js(
      `[...${card(t)}.querySelectorAll('.actions>*')].map(x=>x.querySelector('use')?.getAttribute('href')??x.className)`,
    );
  // 按钮相对卡片的位置（到右边缘的距离 / top / width），各状态都一样。
  const slots = (t) =>
    js(
      `(()=>{const c=${card(t)}.getBoundingClientRect();return [...${card(t)}.querySelectorAll('.actions>*')].map(x=>{const r=x.getBoundingClientRect();return [Math.round(c.right-r.left),Math.round(r.top-c.top),Math.round(r.width)].join();});})()`,
    );
  const inside = (t) =>
    js(
      `(()=>{const c=${card(t)}.getBoundingClientRect(),l=[...${card(t)}.querySelectorAll('.actions>*')].map(x=>x.getBoundingClientRect());return l.every(r=>r.left>=c.left-.5&&r.right<=c.right+.5&&r.top===l[0].top);})()`,
    );
  assert.deepEqual(await icons('A'), ['#i-tag', '#i-archive', '#i-trash', '#i-more']);
  assert.ok(await inside('A'), 'Four buttons in one row inside the card');
  const normal = await slots('A');
  assert.equal(await js(`${card('A')}.querySelector('.more').getAttribute('aria-haspopup')`), 'menu');
  const menuIcons = () =>
    js(`[...cardMenu.querySelectorAll('[role=menuitem]')].map(x=>x.querySelector('use').getAttribute('href'))`);
  await js(`${card('A')}.querySelector('.more').focus()`);
  await press('enter');
  await wait(() => js(`cardMenu.matches(':popover-open')`));
  assert.deepEqual(await menuIcons(), ['#i-pencil', '#i-cover', '#i-copy']);
  assert.deepEqual(await js(`[...cardMenu.querySelectorAll('[role=menuitem]')].map(x=>x.textContent)`), [
    '编辑书名',
    '设置封面',
    '复制书名',
  ]);
  assert.equal(
    await js(`document.activeElement===cardMenu.querySelector('[role=menuitem]')`),
    true,
    'Focus moves into the menu',
  );
  assert.equal(await js(`${card('A')}.querySelector('.more').getAttribute('aria-expanded')`), 'true');
  // 菜单在「更多」按钮下方、右对齐，不超出窗口。
  assert.ok(
    await js(
      `(()=>{const m=cardMenu.getBoundingClientRect(),b=${card('A')}.querySelector('.more').getBoundingClientRect();return m.top>=b.bottom&&Math.abs(m.right-b.right)<1&&m.left>=0&&m.bottom<=innerHeight;})()`,
    ),
  );
  await shot('card-menu');
  const focused = () => js(`document.activeElement.textContent`);
  await press('down');
  assert.equal(await focused(), '设置封面');
  await press('up');
  await press('up');
  assert.equal(await focused(), '复制书名', 'Arrow keys wrap');
  await press('home');
  assert.equal(await focused(), '编辑书名');
  await press('end');
  assert.equal(await focused(), '复制书名');
  await press('esc');
  await wait(() => js(`!cardMenu.matches(':popover-open')`));
  assert.equal(await js('shelf.open'), true, 'Esc closes only the menu');
  assert.equal(await js(`document.activeElement===${card('A')}.querySelector('.more')`), true, 'Focus returns to More');
  assert.equal(await js(`${card('A')}.querySelector('.more').getAttribute('aria-expanded')`), 'false');
  // 回车选菜单项：打开编辑书名；关闭后焦点回到「更多」。
  await press('enter');
  await wait(() => js(`cardMenu.matches(':popover-open')`));
  await press('enter');
  await wait(() => js('renameBook.open'));
  assert.equal(await js(`cardMenu.matches(':popover-open')`), false);
  await press('esc');
  await wait(() => js('!renameBook.open'));
  assert.equal(await js('shelf.open'), true);
  assert.equal(await js(`document.activeElement===${card('A')}.querySelector('.more')`), true);
  // 鼠标：再点一次「更多」即关闭。
  await click(`${card('A')}.querySelector('.more')`);
  await wait(() => js(`cardMenu.matches(':popover-open')`));
  await click(`${card('A')}.querySelector('.more')`);
  await delay(150);
  assert.equal(await js(`cardMenu.matches(':popover-open')`), false, 'Clicking More again closes the menu');
  // 卡片增量更新（内容变了、按钮状态没变）时菜单不闪：按钮不重建，菜单保持打开。
  await click(`${card('A')}.querySelector('.more')`);
  await wait(() => js(`cardMenu.matches(':popover-open')`));
  await js(`${card('A')}.querySelector('.more').__keep=1;cardMenu.firstChild.__keep=1`);
  await js(`import('./src/core/books.mjs').then(({books})=>{[...books.values()].find(b=>b.title==='A').tags=['zz'];})`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 880, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(() => js(`!!${card('A')}.querySelector('.veil .tags')`));
  assert.equal(
    await js(
      `cardMenu.matches(':popover-open')&&${card('A')}.querySelector('.more').__keep===1&&cardMenu.firstChild.__keep===1&&${card('A')}.classList.contains('menu-open')`,
    ),
    true,
    'The menu survives an incremental card update',
  );
  await press('esc');
  await cdp('Emulation.clearDeviceMetricsOverride');
  // 11. 源文件夹找不到（合并作品缺一卷）：「恢复」顶替「编辑标签」，编辑标签进菜单；按钮位置不变。
  await js(`rm('S2/Q')`);
  await js(`rm('A')`);
  await wait(() => js(`!document.querySelector('#shelf [data-act="refresh"]').disabled`));
  await js(`document.querySelector('#shelf [data-act="refresh"]').click()`);
  await delay(100);
  await wait(() => js(`!document.querySelector('#shelf [data-act="refresh"]').disabled`));
  await wait(() => js(`!!${card('S2')}?.querySelector('.part')`));
  await js(
    `${card('S2')}.querySelector('.pick').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',screenX:3,screenY:4}))`,
  );
  await wait(() => js(`${card('S2')}.classList.contains('active')`));
  assert.deepEqual(await icons('S2'), ['#i-link', '#i-archive', '#i-trash', '#i-more']);
  assert.deepEqual(await slots('S2'), normal, 'Same positions as a normal book');
  await js(`${card('S2')}.querySelector('.more').click()`);
  assert.deepEqual(await menuIcons(), ['#i-tag', '#i-pencil', '#i-cover', '#i-copy']);
  await shot('card-lost');
  await js(`cardMenu.querySelector('[role=menuitem]').click()`);
  await wait(() => js('tagEditor.open'));
  await js('tagEditor.close()');
  // 12. 已失效的书：恢复、（空位）、删除、更多（编辑书名、设置封面）；位置与其他状态相同。
  await js(`document.querySelector('[data-view="expired"]').click()`);
  await wait(() => js(`!!${card('A')}`));
  await js(
    `${card('A')}.querySelector('.pick').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',screenX:5,screenY:6}))`,
  );
  await wait(() => js(`${card('A')}.classList.contains('active')`));
  assert.deepEqual(await icons('A'), ['#i-link', 'slot', '#i-trash', '#i-more']);
  assert.deepEqual(await slots('A'), normal, 'Same positions as a normal book');
  await js(`${card('A')}.querySelector('.more').click()`);
  assert.deepEqual(await menuIcons(), ['#i-pencil', '#i-cover']);
  await press('esc');
  // 13. 瀑布流与紧凑布局（约 360px 宽）：四个按钮仍在卡片内一行排开。
  await js(`document.querySelector('[data-view="all"]').click()`);
  await js('layoutBtn.click()');
  await wait(() => js(`layoutBtn.dataset.mode==='masonry'`));
  await delay(450);
  await js(
    `${card('B')}.querySelector('.pick').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',screenX:7,screenY:8}))`,
  );
  await wait(() => js(`${card('B')}.classList.contains('active')`));
  assert.ok(await inside('B'), 'Masonry: buttons inside the card');
  assert.deepEqual(await slots('B'), normal);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 760, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  await js(
    `${card('B')}.querySelector('.pick').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',screenX:9,screenY:10}))`,
  );
  await wait(() => js(`${card('B')}.classList.contains('active')`));
  assert.ok(await inside('B'), 'Compact: buttons inside the card');
  await js(`${card('B')}.querySelector('.more').click()`);
  assert.ok(
    await js(
      `(()=>{const m=cardMenu.getBoundingClientRect();return m.left>=0&&m.right<=innerWidth&&m.bottom<=innerHeight;})()`,
    ),
    'Menu stays inside a narrow window',
  );
  await shot('card-compact');
  await press('esc');
  // 窄窗口里的添加对话框：不溢出。
  await js(
    `(async()=>{const d=await dirOf('B');window.showDirectoryPicker=async()=>d;window.showOpenFilePicker=null;document.querySelector('#shelf [data-act="folder"]').click();await opened();})()`,
  );
  assert.ok(
    await js(
      `[...addDialog.querySelectorAll('button')].filter(b=>!b.hidden).every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})`,
    ),
    'Add dialog fits a narrow window',
  );
  await shot('add-narrow');
  await press('esc');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: add dialog (folder / file pickers, cancel, de-duplication, removal, drop, separate books, one book, loose images, fallback inputs, subtitles accepted), card buttons in fixed positions for normal / missing-volume / expired books, More menu (keyboard, Esc, click again, survives incremental updates), grid / masonry / compact',
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
