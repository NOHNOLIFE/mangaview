// 顶栏名称区按钮、全屏界面标题行、缩略图栏（媒体格子的大小、音频格子的样子、不画视窗区域、点媒体定位）、文件详情框、书签列表里的区段书签小图。
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
if (!binary) throw Error('Usage: node tests/filecard.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-filecard-'));
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
// 自动播放由应用自己的规则（有过用户操作才自动播放）判断，这里关掉浏览器的出声拦截，结果才确定。
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
async function wait(check, what = '') {
  let last;
  for (let i = 0; i < 160; i++) {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await delay(60);
  }
  throw Error('Timed out: ' + what + ' ' + check + '; last: ' + last);
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
  const KEYS = {
    v: ['KeyV', 86, 'v'],
    c: ['KeyC', 67, 'c'],
    t: ['KeyT', 84, 't'],
    Escape: ['Escape', 27, ''],
    ArrowLeft: ['ArrowLeft', 37, ''],
    ArrowRight: ['ArrowRight', 39, ''],
  };
  const tap = async (name) => {
    const [code, vk, text] = KEYS[name];
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: name,
      code,
      windowsVirtualKeyCode: vk,
      ...(text ? { text } : {}),
    });
    await delay(30);
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk });
  };
  const move = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const click = async (x, y, button = 'left') => {
    await move(x, y);
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button, clickCount: 1, x, y });
  };
  const rect = (expr) =>
    js(
      '(()=>{const r=(' +
        expr +
        ').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,x:r.left+r.width/2,y:r.top+r.height/2};})()',
    );
  const apart = (a, b) =>
    a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
  const inside = (a) =>
    js('innerWidth').then((w) =>
      js('innerHeight').then((h) => a.left >= 0 && a.top >= 0 && a.right <= w && a.bottom <= h),
    );
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: "Object.defineProperty(navigator,'languages',{value:['en-US']});",
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  await js("localStorage.setItem('mv2:autoplay','false');localStorage.setItem('mv2:shelfmarks','false')");
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Cards',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(dir,'01.svg',svg(600,900,'teal'));
    await mvMedia.write(dir,'02 clip.webm',await mvMedia.webm({seconds:1.5,width:320,height:180}));
    await mvMedia.write(dir,'03 song.wav',mvMedia.wav({seconds:12}));
    await mvMedia.write(dir,'04.svg',svg(600,900,'purple'));
    await mvMedia.write(dir,'05 tail.wav',mvMedia.wav({seconds:6}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js("bookTitle.textContent==='Cards'"), 'book opened');
  // 书签直接写进记录后重新载入：03 song.wav 上一个普通书签（2 秒）和一个区段（5–9 秒），图片上一个跨页区段（01.svg → 04.svg），03 上次播到 4 秒。
  await js(
    "import('./src/core/store.mjs').then(async({library})=>{const b=(await library('getAll')).find(b=>b.title==='Cards');" +
      "b.bookmarks=[{id:'i3',name:'01.svg',f:.5,at:1,end:{name:'04.svg',f:.5,at:2}},{id:'a1',name:'03 song.wav',t:2,at:3,label:'song-A'},{id:'b2',name:'03 song.wav',t:5,at:4,label:'song-B',end:{name:'03 song.wav',t:9,at:5}}];" +
      "b.mediaPos=[{id:'03 song.wav',t:4}];await library('put',b);})",
  );
  await cdp('Page.reload');
  await wait(
    () => js("bookTitle.textContent==='Cards'&&!!document.querySelector('#reader [data-name=\"01.svg\"] img')"),
    'reloaded',
  );
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.rail=name=>preview.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.centred=name=>{const n=node(name);return !!n&&Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;};
    window.card=()=>document.querySelector('.fc:popover-open');`);

  // ==== 1. 顶栏：名称区是一个大的按钮（书架图标、文字不可选中、完整书名在提示里），工具栏里没有「书架」按钮 ====
  assert.equal(await js('document.querySelector(\'#bar [data-act="shelf"]\')'), null, 'No shelf button in the toolbar');
  await tap('t');
  await wait(() => js('!bar.hidden&&getComputedStyle(barTitle).display==="flex"'));
  await js('Promise.all(barTitle.getAnimations().map(a=>a.finished)).then(()=>true)');
  const title = await js(
    "(()=>{const s=getComputedStyle(barTitle),i=barTitle.querySelector(':scope>svg use');return {icon:i?.getAttribute('href'),us:s.userSelect,inner:getComputedStyle(bookTitle).userSelect,tip:barTitle.title,cursor:s.cursor}})()",
  );
  assert.deepEqual(title, { icon: '#i-library', us: 'none', inner: 'none', tip: 'Cards', cursor: 'pointer' });
  const tb = await rect('barTitle'),
    bar0 = await rect('bar');
  assert.ok(
    tb.height >= 40 && tb.width >= 359 && tb.top >= bar0.bottom,
    'A big block button under the toolbar: ' + JSON.stringify(tb),
  );
  await shot('filecard-title');
  await click(tb.x, tb.y);
  await wait(() => js('shelf.open'), 'clicking the name area opens the shelf');
  await js('shelf.close()');
  await js('reader.focus()');
  await tap('Escape');
  await wait(() => js('bar.hidden'));

  // ==== 2. 全屏界面的标题行：布局切换、橙色加宽的书架按钮、关闭依次在右侧，没有按键说明 ====
  await tap('v');
  await wait(() => js("overview.open&&!overview.classList.contains('closing')"));
  const headRow = await js(
    "(()=>{const h=document.querySelector('#overview .ov-head'),kids=[...h.children];return {hint:!!h.querySelector('.ov-hint'),tail:kids.slice(-3).map(k=>k.classList.contains('ov-layout')?'layout':k.classList.contains('ov-shelf')?'shelf':k.querySelector('use')?.getAttribute('href')),text:h.textContent.includes('WASD')}})()",
  );
  assert.deepEqual(headRow, { hint: false, tail: ['layout', 'shelf', '#i-close'], text: false });
  const shelfBtn = await js(
    "(()=>{const b=document.querySelector('#overview .ov-shelf'),l=document.querySelector('#overview .ov-layout'),s=getComputedStyle(b);return {w:b.getBoundingClientRect().width,lw:l.getBoundingClientRect().width,bg:s.backgroundColor,right:l.getBoundingClientRect().right<=b.getBoundingClientRect().left}})()",
  );
  assert.ok(
    shelfBtn.w >= shelfBtn.lw + 16 && shelfBtn.right,
    'Shelf button is wider and right of the layout switch: ' + JSON.stringify(shelfBtn),
  );
  assert.equal(shelfBtn.bg, 'rgb(255, 122, 89)', 'Shelf button is orange');
  const cell = await js(
    "(()=>{const n=document.querySelector('#overview .ov-item');return n.offsetHeight/n.offsetWidth})()",
  );
  await shot('filecard-overview-head');
  await tap('Escape');
  await wait(() => js('!overview.open'));

  // ==== 3. 缩略图栏：不画视窗区域；视频、音频与全屏缩略图的格子同一比例；音频与音频书签同一种样子；媒体没有 title ====
  await js('document.querySelector(\'#bar [data-act="preview"]\').click()');
  await wait(() => js("document.body.classList.contains('docked')&&!!rail('05 tail.wav')"), 'strip pinned');
  await delay(300);
  assert.equal(await js("!!preview.querySelector('.viewport-marker')"), false, 'No viewport area in the strip');
  const ratios = await js(
    "Promise.all([import('./src/core/model.mjs'),import('./src/reader/session.mjs')]).then(([m,s])=>{const r=m.cellRatio(s.current.pages);return {r,media:['02 clip.webm','03 song.wav','05 tail.wav'].map(n=>{const e=rail(n);return Math.abs(e.offsetHeight-e.offsetWidth*r)<1.5})}})",
  );
  assert.deepEqual(ratios.media, [true, true, true], 'Media tiles use the full-screen cell ratio ' + ratios.r);
  assert.ok(Math.abs(cell - ratios.r) < 0.02, 'Same as the full-screen grid cells: ' + cell + ' / ' + ratios.r);
  const audio = await js(
    "(()=>{const p=rail('03 song.wav'),t=p.querySelector('.mv-tile.audio'),b=t.querySelector(':scope>.bm-type'),n=t.querySelector(':scope>.bm-name'),k=preview.querySelector('.pv-mk[data-name=\"03 song.wav\"] .mk'),r=x=>x.getBoundingClientRect();" +
      "return {art:t.classList.contains('mv-art'),named:t.classList.contains('named'),name:n?.textContent,music:b?.querySelector('use')?.getAttribute('href'),badgeRight:Math.round(r(t).right-r(b).right),badgeAbove:r(b).bottom<=r(n).top+.5,nameBottom:Math.round(r(t).bottom-r(n).bottom),mk:k?Math.round(r(t).right-r(k).right)<=4&&r(k).top-r(t).top<=4:false,title:p.title,imgTitle:rail('01.svg').title,buttons:t.querySelectorAll('button').length}})()",
  );
  assert.deepEqual(audio, {
    art: true,
    named: true,
    name: '03 song.wav',
    music: '#i-music',
    badgeRight: 4,
    badgeAbove: true,
    nameBottom: 0,
    mk: true,
    title: '',
    imgTitle: '01.svg',
    buttons: 0,
  });
  await shot('filecard-strip');

  // ==== 4. 点缩略图：视频、音频直接把该文件放到阅读区中央（不选中、不播放）；图片仍按点击处的位移定位 ====
  let r = await rect("rail('02 clip.webm')");
  await click(r.x, r.top + 4);
  await wait(() => js("centred('02 clip.webm')"), 'video centred');
  await delay(400);
  assert.equal(await js("centred('02 clip.webm')"), true);
  assert.equal(
    await js(
      "!reader.querySelector('.page.media.selected')&&[...reader.querySelectorAll('video,audio')].every(e=>e.paused)",
    ),
    true,
    'Not selected, not played',
  );
  r = await rect("rail('04.svg')");
  await click(r.x, r.top + r.height * 0.25);
  await wait(
    () =>
      js(
        "(n=>!!n&&Math.abs((reader.scrollTop+reader.clientHeight/2-n.offsetTop)/n.offsetHeight-.25)<.03)(node('04.svg'))",
      ),
    'image by offset',
  );
  // 03 song.wav 读到时长（滚到它、挂上源），之后的详情框里有时长；05 tail.wav 从没进过视窗，时长未知。
  r = await rect("rail('03 song.wav')");
  await click(r.x, r.y);
  await wait(
    () => js("centred('03 song.wav')&&node('03 song.wav').querySelector('audio')?.readyState>=1"),
    'audio loaded',
  );
  assert.equal(await js("[...reader.querySelectorAll('video,audio')].every(e=>e.paused)"), true);

  // ==== 5. 文件详情框：缩略图栏里悬停视频、音频即弹出，不挡住格子、在窗口内；移开即消失；时长未知时只显示已知的部分 ====
  // 点击时（按下）详情框收起；移开再指回来又弹出。
  await move(300, 450);
  r = await rect("rail('03 song.wav')");
  await move(r.x, r.y);
  await wait(() => js('!!card()'), 'card on hover');
  const fc = await js(
    "(()=>{const c=card();return {name:c.querySelector('.fc-name').textContent,meta:c.querySelector('.fc-meta').textContent,bar:!c.querySelector('.mv-bar').hidden,marks:[...c.querySelectorAll('.mv-mk')].map(m=>m.classList[1]).join(),pin:c.querySelector('.fc-pin').hidden,note:c.querySelector('.fc-mark').hidden,inert:c.inert,pe:getComputedStyle(c).pointerEvents}})()",
  );
  assert.deepEqual(fc, {
    name: '03 song.wav',
    meta: 'Audio · 0:04 / 0:12',
    bar: true,
    marks: 'mark,start,end',
    pin: true,
    note: true,
    inert: true,
    pe: 'none',
  });
  const c1 = await rect('card()');
  assert.ok(apart(c1, r) && (await inside(c1)), 'Beside the tile, inside the window');
  assert.ok(Math.abs(c1.right + 8 - r.left) < 1.5, 'Strip is at the right edge: the card goes to its left');
  // 进度条上的滑块在上次播放的位置（4 / 12）。
  const knob = await js(
    "(()=>{const c=card(),b=c.querySelector('.mv-bar').getBoundingClientRect(),k=c.querySelector('.mv-knob').getBoundingClientRect();return (k.left+k.width/2-b.left)/b.width})()",
  );
  assert.ok(Math.abs(knob - 4 / 12) < 0.02, 'Knob at the last position: ' + knob);
  await shot('filecard-strip-card');
  await move(300, 450);
  await wait(() => js('!card()'), 'gone when the pointer leaves');
  r = await rect("rail('05 tail.wav')");
  await move(r.x, Math.min(r.y, r.top + 20)); // 可能只露出上沿
  await wait(() => js('!!card()'));
  assert.ok(await inside(await rect('card()')), 'Kept inside the window');
  assert.deepEqual(
    await js(
      "(()=>{const c=card();return [c.querySelector('.fc-name').textContent,c.querySelector('.fc-meta').textContent,c.querySelector('.mv-bar').hidden]})()",
    ),
    ['05 tail.wav', 'Audio', true],
    'Unknown duration: the file is not read, only what is known shows',
  );
  assert.equal(
    await js(
      "[...reader.querySelectorAll('.page')].some(n=>n.dataset.name==='05 tail.wav'&&n.querySelector('audio')?.src)",
    ),
    false,
  );
  r = await rect("rail('01.svg')");
  await move(r.x, r.y);
  await wait(() => js('!card()'), 'images show no card');

  // ==== 6. 书签面板：起点和区段书签各占一格、按位置排序，视频、音频书签悬停显示详情框，当前书签另有指针 ====
  await js('reader.scrollTop=0');
  await delay(150);
  await click(300, 400, 'right');
  await wait(() => js("!document.querySelector('.bm-panel').hidden"));
  assert.deepEqual(
    await js(
      "[...document.querySelectorAll('.bm-panel .bm-item')].map(e=>e.dataset.id+('end' in e.dataset?':end':'')+(e.matches('.sec-start,.sec-end')?'+':''))",
    ),
    ['i3+', 'a1', 'b2+', 'b2:end+', 'i3:end+'],
    'Start and section bookmark as separate items in position order; bookmarks inside a section between them',
  );
  assert.deepEqual(
    await js(
      "(()=>{const [i,s]=document.querySelectorAll('.bm-panel .bm-item[data-id=\"i3\"]'),a=s.getBoundingClientRect(),b=i.getBoundingClientRect();return {start:!!i.querySelector('.bm-mk.start'),end:!!s.querySelector('.bm-mk.end'),del:s.querySelector('.bm-del').getAttribute('aria-label'),same:Math.abs(a.width-b.width)<0.5&&Math.abs(a.height-b.height)<0.5,label:s.getAttribute('aria-label')}})()",
    ),
    { start: true, end: true, del: 'Delete section bookmark', same: true, label: 'Section bookmark · Page 4' },
  );
  const pinAt = () =>
    js(
      "(()=>{const c=card(),b=c.querySelector('.mv-bar').getBoundingClientRect(),p=c.querySelector('.fc-pin').getBoundingClientRect();return (p.left+p.width/2-b.left)/b.width})()",
    );
  const noteOf = () => js("card().querySelector('.fc-mark').textContent");
  const hotOf = () =>
    js("[...card().querySelectorAll('.mv-marks > .hot')].map(e=>e.classList[0]+'.'+e.classList[1]).join()");
  r = await rect('document.querySelector(\'.bm-panel .bm-item[data-id="a1"]\')');
  await move(r.x, r.y);
  await wait(() => js('!!card()'), 'card on a media bookmark');
  assert.equal(await noteOf(), 'Bookmark 0:02 · song-A');
  assert.ok(Math.abs((await pinAt()) - 2 / 12) < 0.02, 'Pointer at the bookmark time');
  assert.equal(await hotOf(), 'mv-mk.mark');
  assert.equal(
    await js("card().querySelector('.fc-meta').textContent"),
    'Audio · 0:04 / 0:12',
    'Same file details as the file',
  );
  const c2 = await rect('card()');
  assert.ok(apart(c2, r) && (await inside(c2)), 'Does not cover the bookmark');
  assert.equal(
    await js('document.querySelector(\'.bm-panel .bm-item[data-id="a1"]\').title'),
    '',
    'No tooltip on media bookmarks',
  );
  await shot('filecard-panel');
  r = await rect('document.querySelector(\'.bm-panel .bm-item[data-id="b2"]:not([data-end]) .bm-thumb\')');
  await move(r.right - 6, r.top + 10);
  await wait(async () => (await noteOf()) === 'Bookmark 0:05 · song-B');
  assert.ok(Math.abs((await pinAt()) - 5 / 12) < 0.02);
  assert.equal(await hotOf(), 'mv-span.hot,mv-mk.start,mv-mk.end', 'The bar highlights this section');
  // 悬停起点：起点和区段书签两项一起以区段配色高亮（描边有过渡，等它到位）。
  await wait(
    () =>
      js(
        "[...document.querySelectorAll('.bm-panel .bm-item[data-id=\"b2\"] > .bm-thumb')].every(e=>getComputedStyle(e).boxShadow.startsWith('rgb(90, 180, 255) 0px 0px 0px 2px'))",
      ),
    'both items highlighted in the section colour',
  );
  r = await rect('document.querySelector(\'.bm-panel .bm-item[data-id="b2"][data-end] .bm-thumb\')');
  await move(r.right - 6, r.top + 10);
  await wait(
    async () => (await noteOf()) === 'Section bookmark 0:09 · song-B',
    'the section bookmark item shows the section end',
  );
  assert.ok(Math.abs((await pinAt()) - 9 / 12) < 0.02);
  r = await rect('document.querySelector(\'.bm-panel .bm-item[data-id="i3"] .bm-thumb\')');
  await move(r.right - 6, r.top + 10);
  await wait(() => js('!card()'), 'image bookmarks show no card');
  // 点区段书签那一项：跳到区段书签。
  r = await rect('document.querySelector(\'.bm-panel .bm-item[data-id="i3"][data-end] .bm-thumb\')');
  await click(r.x, r.y + 4);
  await wait(
    () =>
      js(
        "document.querySelector('.bm-panel').hidden&&(n=>Math.abs((reader.scrollTop+reader.clientHeight/2-n.offsetTop)/n.offsetHeight-.5)<.02)(node('04.svg'))",
      ),
    'jumped to the section end',
  );

  // ==== 7. 全屏书签：起点和区段书签各是一项，方向键以项为单位；详情框在对话框之上 ====
  await js('reader.focus()');
  await tap('c');
  await wait(() => js("shelfOverview.open&&!shelfOverview.classList.contains('closing')"));
  await delay(200);
  assert.deepEqual(
    await js(
      "[...document.querySelectorAll('#shelfOverview .ov-mark')].map(e=>e.dataset.id+('end' in e.dataset?':end':'')+(e.querySelector('.bm-del')?'/del':''))",
    ),
    ['i3', 'a1', 'b2', 'b2:end', 'i3:end'],
  );
  r = await rect('document.querySelector(\'#shelfOverview .ov-mark[data-id="a1"]\')');
  await move(r.x + 1, r.y + 1);
  await move(r.x, r.y);
  await wait(
    () => js("!!card()&&document.querySelector('#shelfOverview .ov-mark.sel')?.dataset.id==='a1'"),
    'card over the full-screen view',
  );
  assert.equal(await noteOf(), 'Bookmark 0:02 · song-A');
  assert.ok(apart(await rect('card()'), r));
  await shot('filecard-shelfmarks');
  await tap('ArrowRight');
  await wait(
    () => js("document.querySelector('#shelfOverview .ov-mark.sel')?.dataset.id==='b2'"),
    'arrow keys move item by item',
  );
  await wait(async () => (await noteOf()) === 'Bookmark 0:05 · song-B', 'keyboard selection shows the card');
  await tap('ArrowRight');
  await wait(
    async () => (await noteOf()) === 'Section bookmark 0:09 · song-B',
    'the section bookmark is an item of its own',
  );
  await tap('ArrowLeft');
  await tap('ArrowLeft');
  await tap('ArrowLeft');
  await wait(() => js("document.querySelector('#shelfOverview .ov-mark.sel')?.dataset.id==='i3'&&!card()"));
  await tap('Escape');
  await wait(() => js('!shelfOverview.open&&!card()'));

  // ==== 8. 全屏缩略图：键盘选中视频、音频弹出详情框；点它跳到阅读区中央 ====
  await js('reader.focus()');
  await tap('v');
  await wait(() => js("overview.open&&!overview.classList.contains('closing')"));
  await delay(200);
  const sel = () => js("document.querySelector('#overview .ov-item.sel')?.dataset.i");
  for (let k = 0; k < 5 && (await sel()) !== '2'; k++) await tap((await sel()) > '2' ? 'ArrowLeft' : 'ArrowRight');
  await wait(
    async () => (await sel()) === '2' && (await js("card()?.querySelector('.fc-name').textContent")) === '03 song.wav',
    'keyboard selection on audio',
  );
  assert.equal(await js('document.querySelector(\'#overview .ov-item[data-i="2"]\').title'), '');
  r = await rect('document.querySelector(\'#overview .ov-item[data-i="1"]\')');
  await click(r.x, r.y);
  await wait(() => js("!overview.open&&centred('02 clip.webm')&&!card()"), 'video centred from full-screen thumbnails');
  assert.equal(await js("!reader.querySelector('.page.media.selected')"), true);

  assert.deepEqual(errors, []);
  console.log(
    'PASS: name area is one big button (shelf icon, no selection, full title tooltip), no shelf button in the toolbar, full-screen title row (layout, wide orange shelf button, close; no key hints), strip without the viewport area, media tiles at the full-screen cell ratio, audio tiles like audio bookmarks, clicking media thumbnails centres the file without selecting or playing, image thumbnails by offset, file details card (strip, bookmark panel, full-screen bookmarks and thumbnails; name, type, progress, marks, pointer for the bookmark; beside the item, above dialogs, gone on leave; unknown duration not read), start and section bookmark as separate items in position order in bookmark lists with their own delete buttons',
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
