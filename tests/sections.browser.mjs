// 区段书签、缩略图上的书签标记、全屏界面搜索、自定义封面的端到端测试：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/sections.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-sections-'));
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
  // 缩略图栏常驻（正文让出宽度），书架书签不常驻。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});try{if(!localStorage.getItem('mv2:preview'))localStorage.setItem('mv2:preview','true');localStorage.setItem('mv2:shelfmarks','false');localStorage.setItem('mv2:focusMode','false');}catch{}`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  // 30 张 800×1120 的图（未加载时也不会因测量而移位），最后一张是 800×4000 的长条（测试封面按书签位置截取）。
  const svg = (i, h) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="' +
    h +
    '"><rect width="100%" height="100%" fill="hsl(' +
    i * 47 +
    ',55%,38%)"/><text x="400" y="600" font-size="260" text-anchor="middle" fill="white" font-family="sans-serif">' +
    i +
    '</text></svg>';
  const pics = Array.from({ length: 30 }, (_, i) => [i + '.svg', svg(i, i === 29 ? 4000 : 1120)]);
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Sections',{create:true});
    for(const [name,body] of ${JSON.stringify(pics)}){const out=await (await dir.getFileHandle(name,{create:true})).createWritable();await out.write(body);await out.close();}
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`document.querySelector('#reader [data-name="0.svg"] img')?.naturalHeight===1120`));
  await js('reader.focus()');
  const H = await js('reader.clientHeight'),
    W = await js('reader.clientWidth'),
    ph = W * 1.4;
  const goto = (n, f) => js(`reader.scrollTop=${n * ph + f * ph - H / 2}`);
  const center = () =>
    js(
      `(()=>{const c=(reader.scrollTop+reader.clientHeight/2)/${ph};return [Math.floor(c),+(c-Math.floor(c)).toFixed(3)];})()`,
    );
  const store = `import('./src/core/store.mjs')`;
  const record = (title = 'Sections') =>
    js(`${store}.then(async({library})=>(await library('getAll')).find(b=>b.title===${JSON.stringify(title)}))`);
  const thumbKeys = () => js(`${store}.then(({thumbs})=>thumbs('getAllKeys'))`);
  const marks = async () =>
    (await record()).bookmarks.map((b) => [
      b.name,
      +b.f.toFixed(3),
      ...(b.end ? [[b.end.name, +b.end.f.toFixed(3)]] : []),
    ]);
  const text = () => js(`document.getElementById('notice').textContent`);
  const said = async (msg) => {
    await wait(async () => (await text()) === msg);
    await js('notice.textContent=""');
  };
  const codes = {
    f: ['KeyF', 70, 'f'],
    F: ['KeyF', 70, 'F'],
    v: ['KeyV', 86, 'v'],
    c: ['KeyC', 67, 'c'],
    '/': ['Slash', 191, '/'],
    Enter: ['Enter', 13, '\r'],
    Escape: ['Escape', 27, ''],
    ArrowRight: ['ArrowRight', 39, ''],
    ArrowDown: ['ArrowDown', 40, ''],
  };
  async function key(name, type, mods = 0) {
    const [code, vk, t] = codes[name];
    await cdp('Input.dispatchKeyEvent', {
      type,
      key: name,
      code,
      windowsVirtualKeyCode: vk,
      modifiers: mods,
      ...(type === 'keyDown' && t && !(mods & 2) ? { text: t } : {}),
    });
  }
  const tap = async (name, mods = 0) => {
    await key(name, 'keyDown', mods);
    await delay(40);
    await key(name, 'keyUp', mods);
  };
  // 长按 F 添加书签；长按 Shift+F 添加区段书签（进度环文字不同）。
  async function hold(sec = false) {
    const name = sec ? 'F' : 'f',
      mods = sec ? 8 : 0;
    await key(name, 'keyDown', mods);
    await delay(320);
    assert.equal(
      await js('document.querySelector(".hold .hold-text").textContent'),
      sec ? 'Keep holding to add a section bookmark' : 'Keep holding to add a bookmark',
    );
    // 进度环与图标：区段书签用区段配色，普通书签用强调色。
    assert.deepEqual(
      await js(
        'Array.from(document.querySelectorAll(".hold .hold-dial .i, .hold .hold-ring .fill"),e=>getComputedStyle(e)[e.matches(".i")?"color":"stroke"])',
      ),
      sec ? ['rgb(90, 180, 255)', 'rgb(90, 180, 255)'] : ['rgb(255, 122, 89)', 'rgb(255, 122, 89)'],
    );
    await delay(380);
    await key(name, 'keyUp', mods);
  }
  const mouse = (type, x, y, button = 'none', mods = 0) =>
    cdp('Input.dispatchMouseEvent', { type, x, y, button, clickCount: button === 'none' ? 0 : 1, modifiers: mods });
  const click = async (x, y) => {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 'left');
    await mouse('mouseReleased', x, y, 'left');
  };
  const rect = (sel) =>
    js(
      `(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};})()`,
    );
  async function menu(x, y) {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, 'right');
    await mouse('mouseReleased', x, y, 'right');
    await wait(() => js('!document.querySelector(".bm-panel").hidden'));
    await delay(200);
  }
  const closeMenu = async () => {
    await tap('Escape');
    await wait(() => js('document.querySelector(".bm-panel").hidden'));
  };

  // ==== 1. 区段书签的添加规则 ====
  // 前面没有书签：提示，不添加。
  await goto(3, 0.5);
  await hold(true);
  await said('No bookmark before this point to pair with — add a bookmark first');
  assert.deepEqual((await record()).bookmarks, []);
  // 以前面最近的普通书签为起点新建区段；区段书签有自己的缩略图。
  await goto(2, 0.5);
  await hold();
  await said('Bookmark added');
  await goto(4, 0.5);
  await hold(true);
  await said('Section bookmark added');
  assert.deepEqual(await marks(), [['2.svg', 0.5, ['4.svg', 0.5]]]);
  const id1 = (await record()).bookmarks[0].id,
    book = await record();
  await wait(async () => (await thumbKeys()).includes(book.id + ':bm:' + id1 + ':end'));
  assert.ok(await js('document.querySelector(".hold").classList.contains("done")'), 'Completion state is shown');
  // 前面最近的是区段：延长终点；当前位置在区段内：终点更新到这里（可缩短）。
  await goto(6, 0.5);
  await hold(true);
  await said('Section end updated');
  assert.deepEqual(await marks(), [['2.svg', 0.5, ['6.svg', 0.5]]]);
  await goto(3, 0.5);
  await hold(true);
  await said('Section end updated');
  assert.deepEqual(await marks(), [['2.svg', 0.5, ['3.svg', 0.5]]]);
  // 区段内可以照常添加普通书签，它不参与配对：之后在区段后面添加区段书签，延长的仍是这个区段。
  await goto(3, 0.2);
  await hold();
  await said('Bookmark added');
  await goto(5, 0.5);
  await hold(true);
  await said('Section end updated');
  assert.deepEqual(await marks(), [
    ['2.svg', 0.5, ['5.svg', 0.5]],
    ['3.svg', 0.2],
  ]);
  // 区段之后的普通书签：以它为起点新建第二个区段；第二个区段内再按：更新它的终点；离起点不到半屏：按“这里已有书签”处理。
  await goto(8, 0.5);
  await hold();
  await said('Bookmark added');
  await goto(10, 0.5);
  await hold(true);
  await said('Section bookmark added');
  await goto(9, 0.5);
  await hold(true);
  await said('Section end updated');
  await goto(8, 0.6);
  await hold(true);
  await said('There is already a bookmark here');
  assert.deepEqual(await marks(), [
    ['2.svg', 0.5, ['5.svg', 0.5]],
    ['3.svg', 0.2],
    ['8.svg', 0.5, ['9.svg', 0.5]],
  ]);
  // 同一页两个普通书签（角标带数量）。
  await goto(20, 0.1);
  await hold();
  await said('Bookmark added');
  await goto(20, 0.8);
  await hold();
  await said('Bookmark added');

  // ==== 2. 书签面板：「添加区段书签」按钮、成组显示、点哪张跳哪里、悬停一起高亮 ====
  await goto(12, 0.5);
  await menu(300, 400);
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.bm-top button')].map(b=>[b.textContent,b.getAttribute('aria-label'),b.title])`,
    ),
    [
      ['', 'Add bookmark', 'Add bookmark (Hold F / Enter)'],
      ['', 'Add section bookmark', 'Add section bookmark (Hold Shift+F / Shift+Enter)'],
      ['', 'Set as cover', 'Set as cover'],
    ],
  );
  // 区段按钮用区段配色（--sec），不是强调色。
  assert.equal(await js(`getComputedStyle(document.querySelector('.bm-sec')).color`), 'rgb(90, 180, 255)');
  const sec = await rect('.bm-sec');
  await click(sec.x, sec.y);
  await said('Section end updated');
  assert.deepEqual((await marks())[2], ['8.svg', 0.5, ['12.svg', 0.5]]);
  await wait(() => js(`document.querySelectorAll('.bm-item').length===7`));
  // 区段书签不计入书签数量；起点和终点是前后紧挨的两项。
  assert.equal(await js(`document.querySelector('.bm-head .count').textContent`), '5');
  assert.deepEqual(await js(`[...document.querySelectorAll('.bm-item')].map(e=>e.getAttribute('aria-label'))`), [
    'Page 3 · Section start',
    'Section bookmark · Page 6',
    'Page 4',
    'Page 9 · Section start',
    'Section bookmark · Page 13',
    'Page 21',
    'Page 21',
  ]);
  await wait(() =>
    js(`[...document.querySelectorAll('.bm-item.sec-end img')].every(i=>i.complete&&i.naturalWidth===240)`),
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.bm-item.sec-start .bm-mk.start use[href="#i-bm-start"]').length+document.querySelectorAll('.bm-item.sec-end .bm-mk.end use[href="#i-bm-end"]').length`,
    ),
    4,
    'Paired marks on both items',
  );
  // 悬停起点：它的终点一起高亮（区段配色）。
  let p = await rect('.bm-item:nth-child(4) .bm-thumb');
  await mouse('mouseMoved', p.x, p.y - 20);
  await delay(250);
  assert.match(
    await js(`getComputedStyle(document.querySelector('.bm-item:nth-child(5) .bm-thumb')).boxShadow`),
    /rgb\(90, 180, 255\) 0px 0px 0px 2px/,
    'Hovering the start highlights its section end',
  );
  assert.doesNotMatch(
    await js(`getComputedStyle(document.querySelector('.bm-item:nth-child(2) .bm-thumb')).boxShadow`),
    /0px 0px 0px 2px/,
  );
  await shot('sections-panel');
  // 点终点：跳到区段书签的位置并关闭面板。
  p = await rect('.bm-item:nth-child(2) .bm-thumb');
  await click(p.x, p.y);
  await wait(() => js('document.querySelector(".bm-panel").hidden'));
  assert.deepEqual(await center(), [5, 0.5]);
  // 区段书签不是 F / Enter 的停靠点：从这里往后是 3.svg 之后的 8.svg。
  await tap('f');
  await wait(async () => (await center())[0] === 8);
  assert.equal(await text(), 'Bookmark 3 / 5');

  // ==== 3. 缩略图栏：角标 + 页内位置的细标记，只更新受影响的那一格 ====
  const bar = () =>
    js(
      `[...document.querySelectorAll('#preview .pv-mk')].map(e=>[e.dataset.name,[...e.querySelectorAll('.tick')].map(t=>t.classList[1]+'@'+Math.round(parseFloat(t.style.top))+'%'),e.querySelector('.mk b')?.textContent??''])`,
    );
  const tickSet = async () => Object.fromEntries((await bar()).map(([n, t, c]) => [n, t.join() + (c ? '#' + c : '')]));
  assert.deepEqual(await tickSet(), {
    '2.svg': 'start@50%',
    '3.svg': 'mark@20%',
    '5.svg': 'end@50%',
    '8.svg': 'start@50%',
    '12.svg': 'end@50%',
    '20.svg': 'mark@10%,mark@80%#2',
  });
  // 角标只有一个书签图标：有区段书签（起点或终点）的页为区段配色，普通书签为强调色。
  assert.deepEqual(
    await js(
      `['2.svg','5.svg','3.svg','20.svg'].map(n=>{const m=document.querySelector('#preview .pv-mk[data-name="'+n+'"] .mk');return [m.querySelectorAll('svg').length,m.querySelector('use').getAttribute('href'),getComputedStyle(m.querySelector('svg')).color];})`,
    ),
    [
      [1, '#i-bookmark', 'rgb(90, 180, 255)'],
      [1, '#i-bookmark', 'rgb(90, 180, 255)'],
      [1, '#i-bookmark', 'rgb(255, 122, 89)'],
      [1, '#i-bookmark', 'rgb(255, 122, 89)'],
    ],
  );
  // 标记层与缩略图同一位置：叠在该页之上，细标记按页内位置。
  await goto(8, 0.5);
  await delay(300);
  const pg = await rect('#preview .page[data-name="8.svg"]'),
    mk = await rect('#preview .pv-mk[data-name="8.svg"]'),
    tk = await rect('#preview .pv-mk[data-name="8.svg"] .tick'),
    bd = await rect('#preview .pv-mk[data-name="8.svg"] .mk');
  assert.ok(
    Math.abs(pg.top - mk.top) < 1 && Math.abs(pg.height - mk.height) < 1,
    'Mark layer lines up with the page thumbnail',
  );
  assert.ok(Math.abs(tk.top + 1.5 - (pg.top + pg.height * 0.5)) < 1.5, 'Tick at the in-page position');
  assert.ok(
    bd.right <= pg.right + 0.5 && bd.top >= pg.top && bd.right > pg.right - 8,
    'Badge sits in the top-right corner',
  );
  // 添加书签只重建那一页的标记，其余页的节点不动。
  await js(`window.__keep=document.querySelector('#preview .pv-mk[data-name="8.svg"] .mk')`);
  await goto(14, 0.5);
  await hold();
  await said('Bookmark added');
  await wait(() => js(`!!document.querySelector('#preview .pv-mk[data-name="14.svg"]')`));
  assert.equal(await js('window.__keep.isConnected'), true, 'Other pages keep their marks');
  // 指针所在的页有起点或区段书签时，同一对的两个细标记一起高亮。
  await goto(2, 0.5);
  await delay(300);
  const m2 = await rect('#preview .pv-mk[data-name="2.svg"]');
  await mouse('mouseMoved', m2.x, m2.y);
  await wait(() => js(`document.querySelectorAll('#preview .tick.hot').length===2`));
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('#preview .tick.hot')].map(t=>t.closest('.pv-mk').dataset.name+':'+t.classList[1])`,
    ),
    ['2.svg:start', '5.svg:end'],
  );
  await shot('sections-bar');
  await mouse('mouseMoved', 300, 400);
  await wait(() => js(`document.querySelectorAll('#preview .tick.hot').length===0`));
  await js('reader.focus()');

  // ==== 4. 全屏缩略图：角标、区段范围、搜索框 ====
  const sheetOpen = (id) =>
    js(`document.getElementById('${id}').open&&!document.getElementById('${id}').classList.contains('closing')`);
  await goto(12, 0.5);
  await tap('v');
  await wait(() => sheetOpen('overview'));
  await delay(250);
  const ov = (i) => `#overview .ov-item[data-i="${i}"]`;
  assert.deepEqual(
    await js(
      `[2,3,5,8,12,14,20,1].map(i=>{const m=document.querySelector('${ov('X')}'.replace('X',i)+' .mk');return m?[...m.querySelectorAll('use')].map(u=>u.getAttribute('href').slice(3)+(u.parentNode.classList.contains('sec')?':sec':'')).join('+')+(m.querySelector('b')?'#'+m.querySelector('b').textContent:''):'';})`,
    ),
    ['bookmark:sec', 'bookmark', 'bookmark:sec', 'bookmark:sec', 'bookmark:sec', 'bookmark', 'bookmark#2', ''],
  );
  // 角标是叠加层：有角标的格子与相邻格子同样大小、同一行对齐。
  const [c1, c2] = await Promise.all([rect(ov(1)), rect(ov(2))]);
  assert.deepEqual([c2.width, c2.height, c2.top], [c1.width, c1.height, c1.top]);
  // 悬停带起点或区段书签的页：标出区段覆盖的页；区段内其他页、无关的页不标。
  const spanOf = () =>
    js(
      `[...document.querySelectorAll('#overview .ov-item.in-sec')].map(n=>+n.dataset.i).sort((a,b)=>a-b).join()+'|'+[...document.querySelectorAll('#overview .sec-a,#overview .sec-b')].map(n=>+n.dataset.i).sort((a,b)=>a-b).join()`,
    );
  const hover = async (i) => {
    const r = await rect(ov(i));
    await mouse('mouseMoved', r.x + 1, r.y + 1);
    await mouse('mouseMoved', r.x, r.y);
    await delay(80);
  };
  await js(`document.querySelector('#overview .ov-scroll').scrollTop=0`);
  await delay(150);
  await hover(4);
  assert.equal(await spanOf(), '|');
  await hover(5);
  assert.equal(await spanOf(), '2,3,4,5|2,5');
  await hover(7);
  assert.equal(await spanOf(), '|');
  await hover(8);
  assert.equal(await spanOf(), '8,9,10,11,12|8,12');
  await shot('sections-overview');
  // 键盘选中同样标出（悬停与键盘是同一个选中）。
  await hover(1);
  await tap('ArrowRight');
  assert.equal(await js(`document.querySelector('#overview .ov-item.sel').dataset.i`), '2');
  assert.equal(await spanOf(), '2,3,4,5|2,5');
  // 打开时焦点在列表上；/ 聚焦搜索框，输入即过滤（文件名），键盘只在结果内移动。
  assert.equal(await js(`document.activeElement.classList.contains('ov-scroll')`), true);
  await tap('/');
  assert.equal(await js(`document.activeElement.matches('#overview .ov-find input')`), true);
  assert.equal(await js(`document.querySelector('#overview .ov-find input').placeholder`), 'Search file names');
  const titles = () => js(`[...document.querySelectorAll('#overview .ov-item')].map(n=>n.title).sort().join()`);
  await cdp('Input.insertText', { text: '1' });
  await wait(
    async () =>
      (await titles()) === '1.svg,10.svg,11.svg,12.svg,13.svg,14.svg,15.svg,16.svg,17.svg,18.svg,19.svg,21.svg',
  );
  assert.equal(
    await js(`document.querySelector('#overview .ov-item.sel').title`),
    '1.svg',
    'Selection moves to the first result',
  );
  await tap('Enter');
  assert.equal(await js(`document.activeElement.classList.contains('ov-scroll')`), true, 'Enter returns to the list');
  await tap('ArrowRight');
  assert.equal(
    await js(`document.querySelector('#overview .ov-item.sel').title`),
    '10.svg',
    'Keyboard moves within the results',
  );
  // 搜索框内 Esc：先清空并回到列表（界面不关闭），列表复原、选中回到当前页；再按一次才关闭。
  await tap('/');
  await tap('Escape');
  await delay(100);
  assert.equal(await sheetOpen('overview'), true);
  assert.equal(await js(`document.querySelector('#overview .ov-find input').value`), '');
  assert.equal(await js(`document.activeElement.classList.contains('ov-scroll')`), true);
  await wait(async () => (await titles()).split(',').length > 12);
  assert.equal(await js(`document.querySelector('#overview .ov-item.sel').dataset.i`), '12');
  // 没有结果：提示并给出一键清除；Ctrl+F 也聚焦搜索框。
  await tap('f', 2);
  assert.equal(
    await js(`document.activeElement.matches('#overview .ov-find input')`),
    true,
    'Ctrl+F focuses the search box',
  );
  await cdp('Input.insertText', { text: 'zzz' });
  await wait(() => js(`!document.querySelector('#overview .ov-none').hidden`));
  assert.equal(await js(`document.querySelector('#overview .ov-none').textContent`), 'No matching itemsClear search');
  assert.equal(await js(`document.querySelectorAll('#overview .ov-item').length`), 0);
  await shot('sections-overview-none');
  const clr = await rect('#overview .ov-none button');
  await click(clr.x, clr.y);
  await wait(() =>
    js(
      `document.querySelector('#overview .ov-none').hidden&&document.querySelectorAll('#overview .ov-item').length>12`,
    ),
  );
  assert.equal(await js(`document.querySelector('#overview .ov-item.sel').dataset.i`), '12');
  // 搜索词只在本次打开期间有效：关闭后再打开即清空。
  await tap('/');
  await cdp('Input.insertText', { text: '2' });
  await tap('Enter');
  await tap('Escape');
  await wait(async () => !(await js(`document.getElementById('overview').open`)));
  await tap('v');
  await wait(() => sheetOpen('overview'));
  assert.equal(await js(`document.querySelector('#overview .ov-find input').value`), '');
  await tap('Escape');
  await wait(async () => !(await js(`document.getElementById('overview').open`)));
  // 各种窗口宽度下，两个全屏界面的标题行（含搜索框）都不溢出。
  for (const width of [360, 500, 800]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await delay(150);
    for (const [k, id] of [
      ['v', 'overview'],
      ['c', 'shelfOverview'],
    ]) {
      await tap(k);
      await wait(() => sheetOpen(id));
      await delay(200);
      assert.ok(
        await js(
          `[...document.querySelectorAll('#${id} .ov-head > *')].every(e=>{const r=e.getBoundingClientRect();return !r.width||r.left>=-.5&&r.right<=innerWidth+.5;})`,
        ),
        id + ' title row fits at ' + width,
      );
      assert.ok(
        await js(`document.querySelector('#${id} .ov-find').getBoundingClientRect().width>=100`),
        id + ' search box usable at ' + width,
      );
      if (width === 360) await shot(id + '-narrow');
      await tap('Escape');
      await wait(async () => !(await js(`document.getElementById('${id}').open`)));
    }
  }
  await cdp('Emulation.clearDeviceMetricsOverride');
  await delay(150);
  await js('reader.focus()');

  // ==== 5. 全屏书架书签：成组显示、搜索（作品名 / 文件名）、点区段书签小图跳过去 ====
  await tap('c');
  await wait(() => sheetOpen('shelfOverview'));
  await delay(200);
  const sm = () => js(`[...document.querySelectorAll('#shelfOverview .ov-mark')].map(n=>n.getAttribute('aria-label'))`);
  assert.deepEqual(await sm(), [
    'Sections · Page 3 · Section start',
    'Sections · Section bookmark · Page 6',
    'Sections · Page 4',
    'Sections · Page 9 · Section start',
    'Sections · Section bookmark · Page 13',
    'Sections · Page 15',
    'Sections · Page 21',
    'Sections · Page 21',
  ]);
  assert.equal(
    await js(`document.querySelector('#shelfOverview .ov-find input').placeholder`),
    'Search titles, file names',
  );
  await tap('/');
  await cdp('Input.insertText', { text: '12.svg' });
  await wait(async () => (await sm()).length === 2);
  assert.deepEqual(
    await sm(),
    ['Sections · Page 9 · Section start', 'Sections · Section bookmark · Page 13'],
    'The section bookmark file name matches too',
  );
  await js(
    `(()=>{const q=document.querySelector('#shelfOverview .ov-find input');q.value='sections';q.dispatchEvent(new Event('input'));})()`,
  );
  await wait(async () => (await sm()).length === 8);
  await js(
    `(()=>{const q=document.querySelector('#shelfOverview .ov-find input');q.value='nothing here';q.dispatchEvent(new Event('input'));})()`,
  );
  await wait(() => js(`!document.querySelector('#shelfOverview .ov-none').hidden`));
  assert.equal((await sm()).length, 0);
  await tap('Escape');
  await tap('Escape');
  await wait(async () => !(await js(`document.getElementById('shelfOverview').open`)));
  await tap('c');
  await wait(() => sheetOpen('shelfOverview'));
  await delay(200);
  p = await js(
    `(()=>{const r=document.querySelectorAll('#shelfOverview .ov-mark.sec-end')[1].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
  );
  await click(p.x, p.y);
  await wait(async () => !(await js(`document.getElementById('shelfOverview').open`)));
  assert.deepEqual(await center(), [12, 0.5], 'Clicking the section end jumps to it');
  await js('reader.focus()');

  // ==== 6. 删除：删区段书签，起点变回普通书签；删起点，区段书签一并删除 ====
  const keysOf = async () => {
    const b = await record(),
      k = await thumbKeys();
    return b.bookmarks.map((m) => [
      m.name,
      k.includes(b.id + ':bm:' + m.id),
      k.includes(b.id + ':bm:' + m.id + ':end'),
    ]);
  };
  await menu(300, 400);
  p = await rect('.bm-item:nth-child(5) .bm-thumb');
  await mouse('mouseMoved', p.x, p.y);
  await wait(() => js(`getComputedStyle(document.querySelector('.bm-item:nth-child(5) .bm-del')).opacity==='1'`));
  p = await rect('.bm-item:nth-child(5) .bm-del');
  await click(p.x, p.y);
  await wait(async () => !(await record()).bookmarks.find((m) => m.name === '8.svg').end);
  assert.deepEqual(await keysOf(), [
    ['2.svg', true, true],
    ['3.svg', true, false],
    ['8.svg', true, false],
    ['14.svg', true, false],
    ['20.svg', true, false],
    ['20.svg', true, false],
  ]);
  assert.equal(await js('document.querySelector(".bm-panel").hidden'), false);
  assert.equal(await js(`document.querySelectorAll('.bm-item.sec-start').length`), 1);
  p = await rect('.bm-item:nth-child(1) .bm-thumb');
  await mouse('mouseMoved', p.x, p.y - 20);
  p = await rect('.bm-item:nth-child(1) .bm-del');
  await click(p.x, p.y);
  await wait(async () => (await record()).bookmarks.length === 5);
  assert.deepEqual(await keysOf(), [
    ['3.svg', true, false],
    ['8.svg', true, false],
    ['14.svg', true, false],
    ['20.svg', true, false],
    ['20.svg', true, false],
  ]);
  assert.ok(!(await thumbKeys()).some((k) => k.includes(id1)), 'Both thumbnails of the deleted pair are gone');
  await closeMenu();
  await wait(async () => !JSON.stringify(await tickSet()).match(/start|end/));

  // ==== 7. 页序改变使区段书签排到起点前：区段暂不生效（不画标记、小图变灰），数据保留；排回来后恢复 ====
  await goto(10, 0.5);
  await hold(true);
  await said('Section bookmark added');
  assert.deepEqual((await marks())[1], ['8.svg', 0.5, ['10.svg', 0.5]]);
  const sortBy = async (mode) => {
    await js(`document.querySelector('#bar [data-act="sort"]').click()`);
    await wait(() => js('sortOptions.open'));
    await js(
      `sortScope.value='folder';sortScope.dispatchEvent(new Event('change'));sortOptions.querySelector('[data-mode="${mode}"]').click()`,
    );
    await wait(async () => (await record()).sortMode === mode);
    await js('reader.focus()');
    await delay(200);
  };
  await sortBy('nameDesc');
  await wait(async () => (await tickSet())['8.svg'] === 'mark@50%');
  assert.equal((await tickSet())['10.svg'], undefined);
  await menu(300, 400);
  assert.equal(await js(`document.querySelectorAll('.bm-item.sec-end.off').length`), 1);
  await closeMenu();
  assert.deepEqual((await marks())[1], ['8.svg', 0.5, ['10.svg', 0.5]], 'Data is kept');
  await sortBy('nameAsc');
  await wait(async () => (await tickSet())['8.svg'] === 'start@50%' && (await tickSet())['10.svg'] === 'end@50%');

  // ==== 8. 自定义封面 ====
  // 长条页上加一个书签：封面按卡片比例（高:宽 1.42）以书签位置为中心截取。
  await js(`reader.scrollTop=${29 * ph}+reader.clientWidth*5*.6-reader.clientHeight/2`);
  await wait(() => js(`document.querySelector('#reader [data-name="29.svg"] img')?.naturalHeight===4000`));
  await js(`reader.scrollTop=${29 * ph}+reader.clientWidth*5*.6-reader.clientHeight/2`);
  await delay(200);
  await hold();
  await said('Bookmark added');
  // 另一本没有书签的书。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Plain',{create:true});
    for(const [name,body] of ${JSON.stringify(pics.slice(0, 3))}){const out=await (await dir.getFileHandle(name,{create:true})).createWritable();await out.write(body);await out.close();}
    window.showDirectoryPicker=async()=>dir;const b=document.createElement('button');b.dataset.act='folder';document.body.append(b);b.click();b.remove();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(async () => !!(await record('Plain')));
  const sections = await record(),
    fp = JSON.stringify(sections.fp);
  await js(`document.querySelector('[data-act="shelf"]').click()`);
  await wait(() => js('shelf.open'));
  const card = (t) =>
    `[...document.querySelectorAll('#books .book')].find(b=>b.querySelector('.pick').getAttribute('aria-label')==='${t}')`;
  await wait(() =>
    js(
      `!!${card('Sections')}?.querySelector('.cover img')?.complete&&!!${card('Plain')}?.querySelector('.cover img')?.complete`,
    ),
  );
  await wait(async () => !!(await record()).fp?.thumb);
  await js(
    `window.__plain=${card('Plain')}.querySelector('.cover img');window.__old=${card('Sections')}.querySelector('.cover img').src`,
  );
  // 卡片的操作按钮多了「设置封面」，按钮换行也不溢出卡片。
  const coverBtn = (t) =>
    js(
      `${card(t)}.querySelector('.actions .more').click();[...cardMenu.querySelectorAll('[role=menuitem]')].find(x=>x.textContent==='Set cover').click()`,
    );
  const over = await js(
    `(()=>{const el=${card('Sections')},r=el.getBoundingClientRect();return [...el.querySelectorAll('.actions button')].every(b=>{const q=b.getBoundingClientRect();return q.left>=r.left-.5&&q.right<=r.right+.5;});})()`,
  );
  assert.ok(over, 'Card actions stay inside the card');
  // 没有书签的书：提示先添加书签，不提供其他来源。
  await coverBtn('Plain');
  await wait(() => js(`document.querySelector('.cover-pick')?.open`));
  assert.equal(
    await js(`document.querySelector('.cover-pick .cp-hint').textContent`),
    'This book has no bookmarks yet. Add a bookmark first, then pick it here.',
  );
  assert.equal(await js(`document.querySelectorAll('.cover-pick .cp-item').length`), 0);
  assert.equal(await js(`document.querySelector('.cover-pick .cp-foot button').disabled`), true);
  await tap('Escape');
  await wait(() => js(`!document.querySelector('.cover-pick').open`));
  assert.equal(await js('shelf.open'), true, 'Esc closes only the picker');
  // 列出本书全部书签的缩略图，点选即设为封面。
  await coverBtn('Sections');
  await wait(() => js(`document.querySelector('.cover-pick')?.open`));
  assert.deepEqual(
    await js(`[...document.querySelectorAll('.cover-pick .cp-item')].map(b=>b.getAttribute('aria-label'))`),
    ['Page 4', 'Page 9', 'Page 15', 'Page 21', 'Page 21', 'Page 30'],
  );
  assert.equal(
    await js(`document.querySelector('.cover-pick .cp-foot button').disabled`),
    true,
    'Nothing to reset yet',
  );
  await shot('cover-pick');
  await js(`[...document.querySelectorAll('.cover-pick .cp-item')].at(-1).click()`);
  await wait(async () => !!(await record()).customCover);
  await said('Cover set');
  const custom = await js(
    `${store}.then(async({thumbs})=>{const t=await thumbs('get',${JSON.stringify(sections.id + ':custom')});return t&&[t.blob.type,t.w,t.h];})`,
  );
  assert.deepEqual(custom, ['image/webp', 320, 454], 'Cropped around the bookmark at the cover ratio');
  assert.equal(JSON.stringify((await record()).fp), fp, 'The custom cover does not touch the recognition fingerprint');
  // 只更新这一张卡片：它的封面换成新图，其他卡片的封面节点不动。
  await wait(() =>
    js(
      `${card('Sections')}.querySelector('.cover img')?.src!==window.__old&&!!${card('Sections')}.querySelector('.cover img')?.complete`,
    ),
  );
  assert.equal(await js('window.__plain.isConnected'), true, 'Other cards are left alone');
  // 删除那个书签后封面不变。
  await js(`${store}.then(()=>0)`);
  await js(`shelf.close()`);
  await wait(() => js('!shelf.open'));
  await js(`document.querySelector('[data-act="shelf"]').click()`);
  await wait(() => js('shelf.open'));
  await js(
    `[...document.querySelectorAll('#books .book .pick')].find(p=>p.getAttribute('aria-label')==='Sections').click()`,
  );
  await wait(() => js('!shelf.open'));
  await js('reader.focus()');
  await menu(300, 400);
  p = await rect('.bm-item:last-child .bm-thumb');
  await mouse('mouseMoved', p.x, p.y);
  p = await rect('.bm-item:last-child .bm-del');
  await click(p.x, p.y);
  await wait(async () => (await record()).bookmarks.length === 5);
  await closeMenu();
  assert.ok(
    (await record()).customCover && (await thumbKeys()).includes(sections.id + ':custom'),
    'Deleting the bookmark keeps the custom cover',
  );
  // 重置封面：恢复默认封面，自定义封面的小图删除，同样只更新这一张卡片。
  await js(`document.querySelector('[data-act="shelf"]').click()`);
  await wait(() => js('shelf.open'));
  await wait(() =>
    js(
      `!!${card('Sections')}?.querySelector('.cover img')?.complete&&!!${card('Plain')}?.querySelector('.cover img')?.complete`,
    ),
  );
  await js(
    `window.__plain=${card('Plain')}.querySelector('.cover img');window.__old=${card('Sections')}.querySelector('.cover img').src`,
  );
  await coverBtn('Sections');
  await wait(() => js(`document.querySelector('.cover-pick')?.open`));
  assert.equal(await js(`document.querySelector('.cover-pick .cp-foot button').textContent`), 'Reset cover');
  await js(`document.querySelector('.cover-pick .cp-foot button').click()`);
  await wait(async () => !(await record()).customCover);
  await said('Cover reset to the default');
  assert.ok(!(await thumbKeys()).includes(sections.id + ':custom'));
  await wait(() =>
    js(
      `${card('Sections')}.querySelector('.cover img')?.src!==window.__old&&!!${card('Sections')}.querySelector('.cover img')?.complete`,
    ),
  );
  assert.equal(await js('window.__plain.isConnected'), true, 'Other cards are left alone');
  assert.equal(JSON.stringify((await record()).fp), fp, 'Fingerprint unchanged');
  await shot('cover-reset');
  // 再设一次（备份测试用）。
  await coverBtn('Sections');
  await wait(() => js(`document.querySelector('.cover-pick')?.open`));
  await js(`document.querySelector('.cover-pick .cp-item').click()`);
  await wait(async () => !!(await record()).customCover);
  await said('Cover set');
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));

  // ==== 9. 备份：区段书签与自定义封面随书目和缩略图导出，替换导入后恢复 ====
  await js(`document.querySelector('[data-act="settings"]').click()`);
  await wait(() => js('document.getElementById("settings").open'));
  await js(
    `window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async b=>{window.saved=b;},close:async()=>{window.savedDone=true;}})});settings.querySelector('[data-id=bakExport] button').click()`,
  );
  const data = JSON.parse(await wait(() => js('window.savedDone&&window.saved.text()')));
  const sb = data.books.find((b) => b.title === 'Sections'),
    endMark = sb.bookmarks.find((m) => m.end);
  assert.deepEqual([endMark.name, endMark.end.name], ['8.svg', '10.svg']);
  assert.ok(sb.customCover?.bm);
  const dkeys = data.thumbs.map((x) => x.key);
  assert.ok(
    dkeys.includes(sb.id + ':custom') && dkeys.includes(sb.id + ':bm:' + endMark.id + ':end'),
    'Custom cover and section bookmark thumbnails are exported',
  );
  await js(`settings.close()`);
  await js(
    `window.showOpenFilePicker=async()=>[{getFile:async()=>new File([window.saved],'backup.json',{type:'application/json'})}];document.querySelector('[data-act="settings"]').click()`,
  );
  await wait(() => js('document.getElementById("settings").open'));
  await js(`settings.querySelector('[data-id=bakImport] button').click()`);
  await wait(() => js(`document.querySelector('dialog.bak-ask')?.open`));
  await js(`window.before=1;document.querySelector('.bak-ask .bak-actions .danger').click()`);
  await js(`document.querySelector('.bak-ask .bak-actions .danger').click()`);
  await wait(() => js('!window.before&&document.readyState==="complete"'));
  await wait(async () => {
    const b = await record();
    return b && b.customCover && b.bookmarks.some((m) => m.end?.name === '10.svg');
  });
  const back = await thumbKeys();
  assert.ok(
    back.includes(sb.id + ':custom') && back.includes(sb.id + ':bm:' + endMark.id + ':end'),
    'Thumbnails restored',
  );

  assert.deepEqual(errors, []);
  console.log(
    'PASS: section bookmarks (hold Shift+F / panel button, pairing rules: new / extend / inside / too close / nothing before, normal bookmarks inside sections, start and end as two adjacent items with paired marks, jump to either end, delete rules, inactive after re-sorting), thumbnail strip badges and in-page ticks (only the changed page redrawn, pair highlight), full-screen thumbnail badges and section ranges, full-screen search (/, Ctrl+F, Esc clears first, no-match hint with clear, results-only navigation, cleared on close), shelf bookmark search by title / file name, custom cover (bookmark picker, reset, crop at bookmark, no fingerprint change, one card updated, survives bookmark deletion, no-bookmark hint), backup export / replace import',
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
