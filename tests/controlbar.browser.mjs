// 总控栏与单个文件的播放面板，以及 ctx.transport：布局与位置稳定、禁用规则、窄窗口、
// 速率 / 音量小面板、偏好的持久化与跨窗口同步、播放速率、空格与运行状态、上一个 / 下一个媒体、面板的状态样式与字幕容器。
// 独立临时配置 + OPFS 测试数据；音频、视频由 tests/media-fixtures.mjs 现场生成，不使用任何真实文件。
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
if (!binary) throw Error('Usage: node tests/controlbar.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-controlbar-'));
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
  const key = async (key, code, vk, opts = {}) => {
    const text = key.length === 1 ? key : undefined;
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text, ...opts });
    if (!opts.hold) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  };
  const up = (key, code, vk) => cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  const click = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x, y });
  };
  const center = async (sel) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
  const tap = async (sel) => {
    const [x, y] = await center(sel);
    await click(x, y);
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const wide = () =>
    cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  await wide();
  // 记录每次给媒体元素挂源（探测）的是哪一页：验证「播不了的文件不重复探测」「只有可见的媒体持有源」。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});
    window.srcLog=[];const d=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
    Object.defineProperty(HTMLMediaElement.prototype,'src',{get(){return d.get.call(this);},set(v){window.srcLog.push(this.closest('.page')?.dataset.name);d.set.call(this,v);},configurable:true});`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    // 把某页滚到视窗中央（尺寸读到后会重排，重复到稳定为止）。
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};`;
  await js(helpers);
  // 一本混排的书：图片、三段音频（并排检查状态是否一眼可辨）、一段视频；另有只有图片的书、子文件夹里有音频的书（文件名只显示最末一段）。
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Deck',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(dir,'01.svg',svg(600,900,'teal'));
    for(const n of ['02 a.wav','03 b.wav','04 c.wav'])await mvMedia.write(dir,n,mvMedia.wav({seconds:6}));
    await mvMedia.write(dir,'05 clip.webm',await mvMedia.webm({seconds:1.5,width:320,height:180}));
    await mvMedia.write(dir,'06.svg',svg(600,900,'purple'));
    const nest=await (await root.getDirectoryHandle('Nest',{create:true})).getDirectoryHandle('x',{create:true});await mvMedia.write(nest,'07 deep.wav',mvMedia.wav({seconds:3}));await mvMedia.write(await (await root.getDirectoryHandle('Nest')).getDirectoryHandle('y',{create:true}),'08.svg',svg(600,900,'#543'));
    const pics=await root.getDirectoryHandle('Pics',{create:true});for(let i=0;i<4;i++)await mvMedia.write(pics,i+'.svg',svg(600,900,'#345'));
    await mvMedia.write(await root.getDirectoryHandle('Tunes',{create:true}),'t.wav',mvMedia.wav({seconds:2}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Deck'`), 'book');
  await js('reader.focus()');
  // 滚动停稳后的自动播放由 media.browser.mjs 覆盖，这里关掉，结果才确定。
  await js(`localStorage.setItem('mv2:autoplay','false')`);
  const H = () => js('innerHeight'),
    W = () => js('innerWidth');
  const move = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const wheel = async (sel, deltaY) => {
    const [x, y] = await center(sel);
    await move(x, y);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  };
  const openBar = async () => {
    if (await js('!controlbar.hidden&&!controlbar.classList.contains("leaving")')) return;
    await move((await W()) / 2, (await H()) / 2);
    await move((await W()) / 2, (await H()) - 3);
    await wait(() => js('!controlbar.hidden'), 'control bar');
    await delay(250); // 等弹出动画结束
  };
  const closeBar = async () => {
    await move((await W()) / 2, 200);
    await wait(() => js('controlbar.hidden'), 'control bar hidden');
  };
  const B = (id) => `document.querySelector('#controlbar [data-id="${id}"]')`;
  const pop = (id) => `document.querySelector('.dial-pop[data-for="${id}"]')`;
  const isOpen = (id) => js(`${pop(id)}.matches(':popover-open')`);
  const pressed = (id) => js(`${B(id)}.getAttribute('aria-pressed')`);
  const disabled = (ids) =>
    js(`${JSON.stringify(ids)}.filter(id=>document.querySelector('#controlbar [data-id="'+id+'"]').disabled)`);
  // 右区除字幕外只对媒体有意义（书里没有媒体时禁用，不随播放模式禁用；字幕按文件栏显示的文件变灰，见下）；
  // 中区的播放模式、只播区段、单文件、循环任何模式、有无媒体都可用。
  const RIGHT = ['mediaPrev', 'mediaNext', 'playRate', 'volume'],
    MEDIA_ONLY = RIGHT;
  const label = (id) => js(`${B(id)}.title`);
  // 栏里每个可见控件与分隔线的位置和尺寸（不含弹出层里的）。
  const rects = () =>
    js(
      `JSON.stringify([...controlbar.querySelectorAll('.cb-btn,.cb-sep')].filter(e=>!e.closest('.cb-pop')&&!e.closest('#filebar')&&!e.hidden).map(e=>{const r=e.getBoundingClientRect();return [e.dataset.id||e.className,Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(' ');}))`,
    );
  const playing = () =>
    js(`[...reader.querySelectorAll('video,audio')].filter(m=>!m.paused).map(m=>m.closest('.page').dataset.name)`);
  const centred = (name) =>
    js(
      `(()=>{const n=node(${JSON.stringify(name)});return !!n&&Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;})()`,
    );
  const text = (id) => js(`${B(id)}.textContent`);

  // ---- 布局。三区默认一行（约 44px，上方另有文件栏两行），三区并排：左 5、中 5、右 5（末尾是字幕），组之间是分隔线；中区（自动滚动大按钮）正中，阅读区底部居中；默认混合模式。
  // 总控栏下面不再有状态文字行（书名与进度在顶部名称区，当前媒体的文件名与时间在文件栏）。
  await js(
    `window.cbEvents=[];import('./src/core/events.mjs').then(m=>{(m.listeners.controlbar??=[]).push(v=>cbEvents.push(v));return true;})`,
  );
  assert.ok(await js(`toPage('03 b.wav')`));
  await wait(() => js(`el('03 b.wav')?.readyState>=1&&el('02 a.wav')?.readyState>=1`), 'audio loaded');
  await openBar();
  assert.deepEqual(await js('cbEvents'), [true], "Showing dispatches 'controlbar' (true)");
  const geo =
    await js(`(()=>{const b=controlbar.getBoundingClientRect(),z=[...controlbar.querySelectorAll('.cb-zone')].map(e=>e.getBoundingClientRect()),p=document.querySelector('#controlbar [data-id="play"]').getBoundingClientRect(),R=reader.getBoundingClientRect();
    return {h:b.height,zh:controlbar.querySelector('.cb-zones').getBoundingClientRect().height,bottom:innerHeight-b.bottom,centre:Math.abs(b.left+b.width/2-(R.left+R.width/2)),order:z[0].right<=z[1].left&&z[1].right<=z[2].left,row:new Set(z.map(r=>Math.round(r.top))).size,play:Math.abs(p.left+p.width/2-(b.left+b.width/2)),compact:controlbar.classList.contains('compact'),fits:controlbar.scrollWidth<=controlbar.clientWidth};})()`);
  assert.ok(geo.zh >= 40 && geo.zh <= 48, 'One row of zones: ' + geo.zh);
  assert.ok(geo.h >= 118 && geo.h <= 140, 'File bar (two rows) + one row, about 130px high: ' + geo.h);
  // 大按钮正中（左右两区按钮数相同）。
  assert.ok(
    geo.bottom >= 8 && geo.centre <= 1 && geo.order && geo.row === 1 && geo.play <= 1 && !geo.compact && geo.fits,
    JSON.stringify(geo),
  );
  assert.deepEqual(
    await js(
      `[...controlbar.querySelectorAll('.cb-zone')].map(z=>[...z.children].filter(e=>!e.matches('.cb-pop')).map(e=>e.dataset.id||(e.matches('.cb-sep')?'|':e.className)))`,
    ),
    [
      ['prevBook', 'toStart', 'toEnd', 'nextBook', '|', 'scrollRate'],
      ['mode', 'sections', 'play', 'single', 'loop'],
      ['mediaPrev', 'mediaNext', '|', 'playRate', 'volume', 'subs'],
    ],
    'Left 5, middle 5, right 5',
  );
  // 大按钮叫「自动滚动」，图标表达自动滚动；运行中换成暂停图标（见下）。
  assert.deepEqual(
    [await js(`${B('play')}.querySelector('use').getAttribute('href')`), await label('play')],
    ['#i-autoscroll', 'Auto-scroll'],
  );
  assert.equal(
    await js('controlbar.querySelectorAll(".cb-info,.cb-pos,.cb-now,.cb-modes").length'),
    0,
    'No status lines',
  );
  assert.equal(await js(`${B('mode-mixed')}.getAttribute('aria-checked')`), 'true', 'Mixed by default');
  // 字幕按钮作用于文件栏显示的文件：这段音频没有字幕，变灰。
  assert.deepEqual(
    [await js(`${B('subs')}.disabled`), await js(`${B('subs')}.title`), await js(`${B('subs')}.dataset.control`)],
    [true, 'No subtitles', 'subs'],
  );
  assert.equal(await js(`${B('mode')}.querySelector('use').getAttribute('href')`), '#i-mode-mixed', 'Mode icon');
  assert.equal(
    await js(
      `[...controlbar.querySelectorAll('.cb-btn')].filter(b=>!b.closest('.cb-pop')).every(b=>!b.textContent.trim()||b.matches('.cb-rate'))`,
    ),
    true,
    'Icons only, except the rate numbers',
  );
  // 速率按钮与其他图标按钮同宽，只显示一位小数（不带「×」，提示里带）。
  assert.deepEqual(
    await js(
      `['scrollRate','playRate','volume','mediaNext'].map(id=>Math.round(${B('scrollRate')}.ownerDocument.querySelector('#controlbar [data-id="'+id+'"]').getBoundingClientRect().width))`,
    ),
    [36, 36, 36, 36],
    'Rate buttons as wide as the others',
  );
  assert.deepEqual(
    [await text('scrollRate'), await text('playRate'), await label('scrollRate')],
    ['1.0', '1.0', 'Scroll speed 1.0×'],
  );
  assert.equal(
    await js(`[...controlbar.querySelectorAll('.cb-btn')].every(b=>b.getAttribute('aria-label')&&b.title)`),
    true,
    'Every button has a tooltip and a name',
  );
  // 文件栏的行容器：在三区那一行的上方、同宽（内容见 filebar.browser.mjs）；hidden 时不占高度，三区那一行不动。
  const fileRow = () =>
    js(
      `(()=>{const f=filebar.getBoundingClientRect(),z=controlbar.querySelector('.cb-zones').getBoundingClientRect(),b=controlbar.getBoundingClientRect();return {inBar:filebar.parentElement===controlbar&&filebar.nextElementSibling===controlbar.querySelector('.cb-zones'),hidden:filebar.hidden,h:Math.round(f.height),above:f.bottom<=z.top,same:Math.abs(f.left-z.left)<=1&&Math.abs(f.width-z.width)<=1,bar:Math.round(b.height),zones:[Math.round(z.left),Math.round(z.width),Math.round(innerHeight-z.bottom)].join()};})()`,
    );
  const f0 = await fileRow();
  assert.ok(
    f0.inBar && !f0.hidden && f0.above && f0.same && f0.h >= 30,
    'File bar row above, same width: ' + JSON.stringify(f0),
  );
  await shot('controlbar-filebar');
  await js(`filebar.hidden=true`);
  const f1 = await fileRow();
  assert.ok(f1.h === 0 && f1.bar < f0.bar - 30, 'A hidden file bar row takes no height: ' + JSON.stringify(f1));
  assert.equal(f1.zones, f0.zones, 'The three zones stay put');
  await js(`filebar.hidden=false`);
  assert.equal((await fileRow()).bar, f0.bar);
  await shot('controlbar-800');
  await closeBar();
  assert.deepEqual(await js('cbEvents'), [true, false], "Hiding dispatches 'controlbar' (false)");
  assert.equal(await js('controlbar.contains(filebar)'), true, 'The file bar row hides with the control bar');
  await openBar();

  // ---- 播放模式：二级按钮。悬停在上方弹出漫画、混合、影音三项（当前一项选中），点一项切换；点击按钮轮换，方向键逐个切换。
  {
    const mp = `document.querySelector('.mode-pop[data-for="mode"]')`,
      modeOpen = () => js(`${mp}.matches(':popover-open')`);
    const [x, y] = await center('#controlbar [data-id="mode"]');
    await move(x, y);
    await wait(modeOpen, 'mode pop opens');
    assert.deepEqual(
      await js(
        `(()=>{const p=${mp}.getBoundingClientRect(),b=${B('mode')}.getBoundingClientRect();return {above:p.bottom<=b.top,inside:p.left>=0&&p.right<=innerWidth,items:[...${mp}.children].map(e=>e.dataset.id+':'+e.getAttribute('aria-checked'))};})()`,
      ),
      { above: true, inside: true, items: ['mode-comic:false', 'mode-mixed:true', 'mode-media:false'] },
    );
    await shot('controlbar-mode');
    await tap('#controlbar [data-id="mode-media"]');
    assert.equal(await js(`${B('mode')}.querySelector('use').getAttribute('href')`), '#i-mode-media');
    assert.match(await label('mode'), /Media$/, 'The tooltip names the current mode');
    await js(`${B('mode')}.click()`);
    assert.equal(await js(`${B('mode-comic')}.getAttribute('aria-checked')`), 'true', 'Click: media → comic');
    await js(`${B('mode')}.click()`);
    assert.equal(await js(`${B('mode-mixed')}.getAttribute('aria-checked')`), 'true', 'Click: comic → mixed');
    await move(x, y - 300);
    await wait(async () => !(await modeOpen()), 'mode pop closes');
    await key('Shift', 'ShiftLeft', 16);
    await js(`${B('mode')}.focus()`);
    await wait(modeOpen, 'keyboard focus opens the mode pop');
    await key('ArrowLeft', 'ArrowLeft', 37);
    assert.equal(await js(`${B('mode-comic')}.getAttribute('aria-checked')`), 'true', 'Arrow left: previous mode');
    await key('ArrowRight', 'ArrowRight', 39);
    assert.equal(await js(`${B('mode-mixed')}.getAttribute('aria-checked')`), 'true');
    await key('Escape', 'Escape', 27);
    await wait(async () => !(await modeOpen()), 'Esc closes');
    await js('reader.focus()');
  }
  await openBar();

  // ---- 位置稳定。切换模式、数字位数变化、按钮禁用，所有控件的位置和尺寸不变；右区不随模式禁用，影音模式下滚动速率禁用。
  const base = await rects();
  await js(`${B('mode-comic')}.click()`);
  assert.deepEqual(
    await disabled([...RIGHT, 'scrollRate', 'mode', 'sections', 'play', 'single', 'loop']),
    [],
    'Comic: the right zone stays available',
  );
  assert.equal(await rects(), base, 'Comic mode moves nothing');
  await js(`${B('mode-media')}.click()`);
  assert.deepEqual(await disabled([...RIGHT, 'scrollRate', 'play', 'loop']), ['scrollRate'], 'Media: scroll speed');
  assert.equal(await rects(), base, 'Media mode moves nothing');
  await js(`${B('mode-mixed')}.click()`);
  assert.deepEqual(await disabled([...RIGHT, 'scrollRate', 'play', 'loop']), [], 'Mixed: nothing');
  // 循环：一个三态按钮（单文件 / 本书〔默认〕/ 跨书），点击轮换，每态一个图标，提示写明当前态；没有"不循环"。
  const loopState = () =>
    js(`[${B('loop')}.querySelector('use').getAttribute('href'),${B('loop')}.title,${B('loop')}.dataset.loop]`);
  assert.deepEqual(await loopState(), ['#i-loop-book', 'Loop: this book', 'book'], 'Default: this book');
  const loops = [];
  for (let k = 0; k < 3; k++) {
    await js(`${B('loop')}.click()`);
    loops.push(await loopState());
    assert.equal(await rects(), base, 'Switching the loop moves nothing');
  }
  assert.deepEqual(
    loops,
    [
      ['#i-loop-books', 'Loop: across books', 'books'],
      ['#i-loop-file', 'Loop: single file', 'file'],
      ['#i-loop-book', 'Loop: this book', 'book'],
    ],
    'Three states, one icon each',
  );
  assert.equal(await js(`localStorage.getItem('mv2:loopMode')`), '"book"', 'Saved');
  // 滑杆按 0.1 一档：任意位置都落在 0.1 档上，显示一位小数即真实值。
  assert.equal(await js(`${pop('scrollRate')}.querySelector('input').step`), '0.1');
  for (const [v, shown] of [
    [0.2, '0.2'],
    [1.3, '1.3'],
    [4, '4.0'],
  ]) {
    await js(
      `(()=>{const r=${pop('scrollRate')}.querySelector('input');r.value='${v}';r.dispatchEvent(new Event('input'));})()`,
    );
    assert.equal(await text('scrollRate'), shown);
    assert.equal(await rects(), base, 'Rate ' + v + ' moves nothing');
  }
  await js(`${B('scrollRate')}.click()`);
  assert.equal(await text('scrollRate'), '1.0', 'Clicking the number resets to 1.0');
  await js('reader.scrollTop=0');
  await wait(() => js(`${B('toStart')}.disabled`), 'at the start');
  assert.equal(await rects(), base, 'Disabled buttons keep their place');
  assert.ok(await js(`toPage('03 b.wav')`));

  // ---- 速率、音量的小面板：悬停弹出在按钮上方，经过空隙、移到面板上不收起，移开收起；同一时间只有一个；滚轮直接调整。
  await openBar();
  {
    const [x, y] = await center('#controlbar [data-id="scrollRate"]');
    await move(x, y);
    await wait(() => isOpen('scrollRate'), 'hover opens');
    const p = await js(
      `(()=>{const p=${pop('scrollRate')}.getBoundingClientRect(),b=${B('scrollRate')}.getBoundingClientRect();return {above:p.bottom<=b.top,inside:p.left>=0&&p.right<=innerWidth&&p.top>=0,presets:[...${pop('scrollRate')}.querySelectorAll('.dial-preset')].map(b=>b.textContent),slider:!!${pop('scrollRate')}.querySelector('input[type=range]')};})()`,
    );
    assert.deepEqual(p, { above: true, inside: true, presets: ['0.5×', '1.0×', '1.5×', '2.0×', '3.0×'], slider: true });
    assert.equal(
      await js(
        `(()=>{const p=${pop('scrollRate')}.getBoundingClientRect(),b=${B('scrollRate')}.getBoundingClientRect();return Math.abs(p.left+p.width/2-(b.left+b.width/2))<1&&b.top-p.bottom<=10;})()`,
      ),
      true,
      'Right above the button, centred',
    );
    const [px, py] = await center('.dial-pop[data-for="scrollRate"] .dial-presets');
    await move(x, y - 26); // 经过按钮与面板之间的空隙
    await move(px, py);
    await delay(400);
    assert.equal(await isOpen('scrollRate'), true, 'Stays open over the panel');
    await shot('controlbar-dial');
    const [vx, vy] = await center('#controlbar [data-id="volume"]');
    await move(vx, vy);
    await wait(() => isOpen('volume'), 'volume panel');
    assert.equal(await isOpen('scrollRate'), false, 'One panel at a time');
    assert.equal(await js(`!!${pop('volume')}.querySelector('.dial-mute')`), true, 'Volume panel has mute');
    await move(vx, vy - 300);
    await wait(async () => !(await isOpen('volume')), 'leaving closes');
  }
  await openBar();
  await wheel('#controlbar [data-id="scrollRate"]', -100);
  assert.equal(await text('scrollRate'), '1.1', 'Wheel up: 0.1 faster');
  await wheel('#controlbar [data-id="scrollRate"]', 100);
  await wheel('#controlbar [data-id="scrollRate"]', 100);
  assert.equal(await text('scrollRate'), '0.9');
  await wait(() => js(`localStorage.getItem('mv2:scrollRate')==='0.9'`), 'scroll rate saved');
  await wheel('#controlbar [data-id="volume"]', 100);
  assert.equal(await js(`el('03 b.wav').volume`), 0.95, 'Wheel down on the volume: 5% lower');
  await js(`${B('volume')}.click()`);
  assert.deepEqual(
    await js(
      `[el('03 b.wav').muted,${B('volume')}.getAttribute('aria-pressed'),${B('volume')}.querySelector('use').getAttribute('href')]`,
    ),
    [true, 'true', '#i-volume-x'],
    'Clicking the icon mutes',
  );
  await js(`${B('volume')}.click()`);
  assert.equal(await js(`el('03 b.wav').muted`), false);
  // 键盘聚焦同样弹出；方向键逐档调整（不滚动正文），Esc 收起。
  await key('Shift', 'ShiftLeft', 16);
  await js(`${B('playRate')}.focus()`);
  await wait(() => isOpen('playRate'), 'keyboard focus opens');
  await key('ArrowUp', 'ArrowUp', 38);
  assert.equal(await text('playRate'), '1.1', 'Arrow up: 0.1 faster');
  const top0 = await js('reader.scrollTop');
  await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await text('playRate'), '1.0');
  assert.equal(await js('reader.scrollTop'), top0, 'Arrow keys on the button do not scroll');
  await key('Escape', 'Escape', 27);
  await wait(async () => !(await isOpen('playRate')), 'Esc closes');
  await js('reader.focus()');

  // ---- 播放速率作用于所有媒体（含之后才加载的），变速不变调。
  await openBar();
  {
    const [x, y] = await center('#controlbar [data-id="playRate"]');
    await move(x, y);
    await wait(() => isOpen('playRate'));
    await tap('.dial-pop[data-for="playRate"] .dial-preset[data-value="1.5"]');
  }
  assert.equal(await text('playRate'), '1.5');
  assert.deepEqual(
    await js(`[...new Set([...reader.querySelectorAll('video,audio')].map(m=>m.playbackRate+','+m.preservesPitch))]`),
    ['1.5,true'],
  );
  assert.ok(await js(`toPage('05 clip.webm')`));
  await wait(
    () => js(`el('05 clip.webm')?.readyState>=1&&el('05 clip.webm').playbackRate===1.5`),
    'a media loaded later gets the rate',
  );
  assert.ok(await js(`toPage('03 b.wav')`));
  await wait(() => js(`el('03 b.wav')?.readyState>=1&&el('03 b.wav').playbackRate===1.5`));

  // ---- 偏好：全部登记为设置类（「还原默认设置」重置），持久化，别的窗口改动即时生效。
  assert.equal(
    await js(
      `import('./src/core/prefs.mjs').then(m=>['playMode','scrollRate','playRate','singleFile','loopMode','sectionsOnly'].every(k=>m.prefs.has(k))&&!m.prefs.has('crossBook'))`,
    ),
    true,
  );
  const storage = (k, v) =>
    js(
      `(()=>{const key='mv2:${k}',v=${JSON.stringify(JSON.stringify(v))};if(v==='null')localStorage.removeItem(key);else localStorage.setItem(key,v);dispatchEvent(new StorageEvent('storage',{key,newValue:v==='null'?null:v,storageArea:localStorage}));})()`,
    );
  await storage('playMode', 'media');
  await storage('scrollRate', 2);
  await storage('loopMode', 'file');
  await storage('singleFile', true);
  await storage('sectionsOnly', true);
  await storage('playRate', 0.75); // 旧版本的档位：读入时取整到 0.1
  const state = () =>
    js(
      `[${B('mode-media')}.getAttribute('aria-checked'),${B('scrollRate')}.textContent,${B('loop')}.dataset.loop,${B('single')}.getAttribute('aria-pressed'),${B('sections')}.getAttribute('aria-pressed'),${B('playRate')}.textContent,el('03 b.wav').playbackRate]`,
    );
  assert.deepEqual(await state(), ['true', '2.0', 'file', 'true', 'true', '0.8', 0.8], 'Synced from another window');
  // 旧偏好：开着「跨书」的读作跨书循环；旧的跨书、循环、播放顺序键读入后删除，不报错。
  await js(
    `localStorage.removeItem('mv2:loopMode');localStorage.setItem('mv2:crossBook','true');localStorage.setItem('mv2:playLoop','true');localStorage.setItem('mv2:playOrder','"shuffle"')`,
  );
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Deck'`), 'reloaded');
  await js(MEDIA_FIXTURES);
  await js(helpers);
  assert.ok(await js(`toPage('03 b.wav')`));
  await wait(() => js(`el('03 b.wav')?.readyState>=1`));
  assert.deepEqual(
    await state(),
    ['true', '2.0', 'books', 'true', 'true', '0.8', 0.8],
    'Remembered after reloading; the old cross-book switch reads as the cross-book loop',
  );
  assert.deepEqual(
    await js(`['loopMode','crossBook','playLoop','playOrder'].map(k=>localStorage.getItem('mv2:'+k))`),
    ['"books"', null, null, null],
    'Old keys replaced',
  );
  for (const k of ['playMode', 'scrollRate', 'loopMode', 'singleFile', 'sectionsOnly', 'playRate'])
    await storage(k, null);
  assert.deepEqual(await state(), ['false', '1.0', 'book', 'false', 'false', '1.0', 1], 'Back to the defaults');
  await js('reader.focus()');

  // ---- Shift+空格 = 自动滚动；影音模式下运行状态与它播放的媒体一致（漫画、混合模式的自动滚动见 transport.browser.mjs）。
  // 空格：运行中即停止；否则文件栏显示的是媒体就只播放 / 暂停它（后台播放，见 background.browser.mjs）。
  const running = () => pressed('play');
  const stopTrack = () => js(`document.querySelector('#filebar [data-head="stop"]').click()`);
  await js(`${B('mode-media')}.click()`);
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(async () => (await playing()).join() === '03 b.wav', 'Shift+Space starts with the media in view');
  assert.equal(await running(), 'true');
  assert.deepEqual(
    [await js(`${B('play')}.querySelector('use').getAttribute('href')`), await label('play')],
    ['#i-pause', 'Stop auto-scroll'],
    'Running: a pause icon',
  );
  const top1 = await js('reader.scrollTop');
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length, 'Space stops auto-scroll and pauses its media');
  await wait(async () => (await running()) === 'false', 'not running');
  assert.equal(await js('reader.scrollTop'), top1, 'Space does not scroll');
  // 单个媒体自己的播放键：后台播放它（成为当前曲目，不在视窗中央的也是），不启动自动滚动。
  await tap('#reader .page[data-name="02 a.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '02 a.wav', 'own play button');
  assert.deepEqual(
    await js(`[...reader.querySelectorAll('.page.media.selected')].map(n=>n.dataset.name)`),
    ['02 a.wav'],
    'It becomes the current track',
  );
  assert.equal(await running(), 'false', 'Its own play button does not start auto-scroll');
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length, 'space pauses the file bar media');
  await key(' ', 'Space', 32);
  await wait(async () => (await playing()).join() === '02 a.wav', 'and plays it again');
  assert.equal(await running(), 'false');
  await stopTrack();
  await wait(async () => !(await playing()).length, 'stopped');
  // 影音模式的自动滚动：播完按页序切到下一个（滚到居中）；本书循环（默认）：最后一个播完回到第一个，一直运行到手动停止。
  assert.ok(await js(`toPage('02 a.wav')`));
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(async () => (await playing()).join() === '02 a.wav', 'auto-scroll from the media in view');
  await js(`el('02 a.wav').currentTime=5.7`);
  await wait(
    async () => (await playing()).join() === '03 b.wav' && (await centred('03 b.wav')),
    'next media in list order',
  );
  assert.equal(await running(), 'true', 'Still running while moving on');
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length);
  assert.ok(await js(`toPage('05 clip.webm')`));
  await wait(() => js(`el('05 clip.webm')?.readyState>=1`));
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(async () => (await playing()).join() === '05 clip.webm');
  await js(`el('05 clip.webm').currentTime=1.2`);
  await wait(
    async () => (await playing()).join() === '02 a.wav' && (await centred('02 a.wav')),
    'book loop: back to the first media',
  );
  assert.equal(await running(), 'true');
  await key(' ', 'Space', 32);
  await wait(async () => (await running()) === 'false', 'stops by hand');
  assert.deepEqual(await playing(), []);
  // 视窗里没有媒体：取其后最近的媒体，滚到居中再播放。
  await stopTrack();
  await js('reader.scrollTop=0');
  await delay(200);
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(
    async () => (await playing()).join() === '02 a.wav' && (await centred('02 a.wav')),
    'the next media after the view',
  );
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length);
  await stopTrack();
  await js(`${B('mode-mixed')}.click()`);

  // ---- 单个文件的播放面板。选中的不压暗、不描边；播放中进度条为强调色并显示音柱，播放键只换图标；未选中的压暗。
  assert.ok(await js(`toPage('03 b.wav')`));
  await tap('#reader .page[data-name="03 b.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '03 b.wav');
  await delay(400);
  const look = await js(
    `(()=>{const s=n=>{const p=node(n),c=getComputedStyle;return {playing:p.classList.contains('playing'),current:p.classList.contains('selected'),dim:c(p.querySelector('.mv-card')).filter,play:c(p.querySelector('.mv-play')).backgroundColor,fill:c(p.querySelector('.mv-fill')).backgroundColor,card:c(p.querySelector('.mv-card')).backgroundColor,ring:c(p.querySelector('.mv-card')).boxShadow,eq:c(p.querySelector('.mv-eq')).display};};return {a:s('02 a.wav'),b:s('03 b.wav'),c:s('04 c.wav')};})()`,
  );
  const accent = 'rgb(255, 122, 89)';
  assert.deepEqual(
    [look.b.playing, look.b.current, look.b.dim, look.b.fill, look.b.eq, look.b.ring],
    [true, true, 'none', accent, 'flex', 'none'],
    JSON.stringify(look.b),
  );
  assert.notEqual(look.b.play, accent, 'The play button only changes its icon');
  for (const o of [look.a, look.c]) {
    assert.deepEqual([o.playing, o.current, o.eq, o.dim], [false, false, 'none', 'brightness(0.55)']);
    assert.notEqual(o.fill, accent);
    assert.equal(o.card, look.b.card, 'Same card background');
    assert.equal(o.ring, 'none');
  }
  await openBar();
  await shot('controlbar-panels');
  await closeBar();
  // 减少动态效果时音柱静止。
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await js(`getComputedStyle(node('03 b.wav').querySelector('.mv-eq i')).animationName`), 'none');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length);
  // 字幕容器：音频卡片里始终占位 3 行（有无字幕高度不变），视频叠在画面底部（画面内没有控件）；都不朗读（aria-live="off"）。
  // 容器里只有字幕模块放的一行 .mv-cue（没有字幕时隐藏）；这里直接往它里面写字来检查排版。
  const card = () => js(`Math.round(node('03 b.wav').querySelector('.mv-card').getBoundingClientRect().height)`);
  const h0 = await card();
  assert.deepEqual(
    await js(
      `(()=>{const s=node('03 b.wav').querySelector('.mv-card>.mv-subs');return [s.getAttribute('aria-live'),[...s.children].map(c=>c.className+':'+c.hidden).join(),s.textContent,Math.round(s.getBoundingClientRect().height)];})()`,
    ),
    ['off', 'mv-bars:false,mv-cue:true', '', 60],
  );
  const cueText = (name, text) =>
    js(
      `(()=>{const c=node('${name}').querySelector('.mv-subs>.mv-cue');c.textContent=${JSON.stringify(text)};c.hidden=!c.textContent;})()`,
    );
  await cueText('03 b.wav', 'one\ntwo\nthree');
  assert.equal(await card(), h0, 'Three lines of subtitles do not change the card height');
  await cueText('03 b.wav', '');
  assert.ok(await js(`toPage('05 clip.webm')`));
  await wait(() => js(`el('05 clip.webm')?.readyState>=1`));
  await cueText('05 clip.webm', 'subtitle');
  // 视窗中心所在的未选中视频：普通的压暗程度（等过渡结束）。
  await wait(
    () => js(`getComputedStyle(node('05 clip.webm').querySelector('video')).filter==='brightness(0.55)'`),
    'centre video dimmed as usual',
  );
  assert.deepEqual(
    await js(
      `(()=>{const n=node('05 clip.webm'),s=n.querySelector('.mv-subs'),r=s.getBoundingClientRect(),v=n.getBoundingClientRect();return [s.parentNode===n,s.getAttribute('aria-live'),r.bottom<=v.bottom,r.top>=v.top,!n.querySelector('.mv-shell'),getComputedStyle(n.querySelector('video')).filter];})()`,
    ),
    [true, 'off', true, true, true, 'brightness(0.55)'],
    'Video subtitles sit over the picture, no controls in it; an unselected video is dimmed',
  );
  await cueText('05 clip.webm', '');
  assert.equal(
    await js(`getComputedStyle(node('05 clip.webm').querySelector('.mv-big')).opacity`),
    '1',
    'Big play button while not selected',
  );
  assert.ok(await js(`toPage('04 c.wav')`));
  // 面板只有按钮、进度条、文件名不参与拖动；空白处按住拖动滚动正文，也不播放。
  assert.deepEqual(
    await js(
      `(()=>{const n=node('04 c.wav');return [n.querySelector('.mv-shell').hasAttribute('data-nodrag'),n.querySelector('.mv-card').hasAttribute('data-nodrag'),[...n.querySelectorAll('.mv-play,.mv-bar,.mv-head .mid-name,[data-control]')].every(e=>e.hasAttribute('data-nodrag'))];})()`,
    ),
    [false, false, true],
  );
  {
    const [x, y] = await js(
      `(()=>{const r=node('04 c.wav').querySelector('.mv-subs').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
    const before = await js('reader.scrollTop');
    await move(x, y);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
    for (let k = 1; k <= 5; k++)
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x, y: y - k * 20 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y: y - 100 });
    assert.ok((await js('reader.scrollTop')) >= before + 90, 'Dragging the blank part of the panel scrolls');
    assert.deepEqual(await playing(), []);
  }

  // ---- 上一个 / 下一个媒体：没有当前曲目时按页序找（两端相接），滚到居中，只定位、不选中；自动滚动运行中切过去接着播放；
  // 有当前曲目时在播放列表里切换（不滚动，保持播放）。
  await stopTrack();
  await js(`${B('mode-media')}.click()`);
  assert.ok(await js(`toPage('02 a.wav')`));
  await openBar();
  assert.deepEqual(await disabled(['mediaPrev', 'mediaNext']), [], 'Both ends wrap around');
  await js(`${B('mediaNext')}.click()`);
  await wait(() => centred('03 b.wav'), 'next media centred');
  assert.deepEqual(await playing(), [], 'Not running: only moves');
  assert.equal(await js(`!!reader.querySelector('.page.media.selected')`), false, 'Not selected either');
  await js(`${B('mediaPrev')}.click()`);
  await wait(() => centred('02 a.wav'), 'previous media centred');
  await js(`${B('mediaPrev')}.click()`);
  await wait(() => centred('05 clip.webm'), 'previous before the first: the last media');
  await js(`${B('mediaNext')}.click()`);
  await wait(() => centred('02 a.wav'), 'next after the last: the first media');
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(async () => (await playing()).join() === '02 a.wav');
  await js(`${B('mediaNext')}.click()`);
  await wait(async () => {
    const p = await playing();
    return p.join() === '03 b.wav' && (await centred('03 b.wav'));
  }, 'running: plays the next one');
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length);
  await stopTrack();
  // 有当前曲目：在播放列表里切换，不滚动。
  assert.ok(await js(`toPage('02 a.wav')`));
  await tap('#reader .page[data-name="02 a.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '02 a.wav');
  const top2 = await js('reader.scrollTop');
  await js(`${B('mediaNext')}.click()`);
  await wait(async () => (await playing()).join() === '03 b.wav', 'the next item of the play list');
  assert.equal(await js('reader.scrollTop'), top2, 'Switching within the play list does not scroll');
  await stopTrack();

  // ---- 任何模式下单个媒体的播放键都是后台播放：播完按播放列表接续（本书循环），与播放模式无关。
  await js(`${B('mode-comic')}.click()`);
  assert.ok(await js(`toPage('04 c.wav')`));
  await tap('#reader .page[data-name="04 c.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '04 c.wav');
  await js(`el('04 c.wav').currentTime=5.7`);
  await wait(
    () => js(`el('04 c.wav').paused&&[...document.querySelectorAll('video,audio')].filter(m=>!m.paused).length===1`),
    'comic mode: the play list goes on with the next file',
  );
  assert.equal(await running(), 'false', 'Without auto-scroll');
  await stopTrack();
  await js(`${B('mode-mixed')}.click()`);

  // ---- 窄窗口：一行 → 左、右区各自把次要按钮收进本区末尾的「⋯」（仍一行；左区留上一本 / 下一本，右区留下一个媒体 / 音量）→ 两行
  // （中区一行，左、右区并排一行）。任何宽度都不超过两行、不横向溢出，控件都在栏内。
  const layoutAt = () =>
    js(`(()=>{const b=controlbar.getBoundingClientRect(),items=[...controlbar.querySelectorAll('.cb-btn,.cb-sep')].filter(e=>!e.closest('.cb-pop')&&!e.closest('#filebar')),z=[...controlbar.querySelectorAll('.cb-zone')].map(e=>Math.round(e.getBoundingClientRect().top)),ids=s=>[...controlbar.querySelector(s).children].filter(e=>!e.matches('.cb-pop')).map(e=>e.dataset.id||'|'),pop=id=>[...(document.querySelector('#controlbar [data-id="'+id+'"]')?.popoverTargetElement?.children??[])].filter(e=>e.matches('.cb-btn')).map(e=>e.dataset.id);
      return {inWindow:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,fits:controlbar.scrollWidth<=controlbar.clientWidth&&controlbar.querySelector('.cb-zones').scrollWidth<=controlbar.querySelector('.cb-zones').clientWidth,inside:items.every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-.5&&r.right<=b.right+.5&&r.top>=b.top-.5&&r.bottom<=b.bottom+.5;}),
        tier:controlbar.classList.contains('stacked')?'stacked':controlbar.classList.contains('compact')?'compact':'row',rows:new Set(z).size,midOnTop:z[1]<z[0]&&z[0]===z[2],h:Math.round(controlbar.querySelector('.cb-zones').getBoundingClientRect().height),
        left:ids('.cb-left'),right:ids('.cb-right'),moreL:pop('moreLeft'),moreR:pop('moreRight')};})()`);
  const FULL = {
      left: ['prevBook', 'toStart', 'toEnd', 'nextBook', '|', 'scrollRate'],
      right: ['mediaPrev', 'mediaNext', '|', 'playRate', 'volume', 'subs'],
      moreL: [],
      moreR: [],
    },
    COMPACT = {
      left: ['prevBook', 'nextBook', 'moreLeft'],
      right: ['mediaNext', 'volume', 'moreRight'],
      moreL: ['toStart', 'toEnd', 'scrollRate'],
      moreR: ['mediaPrev', 'playRate', 'subs'],
    };
  for (const [w, tier] of [
    [1280, 'row'],
    [900, 'row'],
    [700, 'row'],
    [560, 'compact'],
    [480, 'compact'],
    [420, 'stacked'],
    [360, 'stacked'],
  ]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await wait(async () => (await W()) === w);
    await closeBar().catch(() => {});
    await openBar();
    const f = await layoutAt();
    const one = tier !== 'stacked';
    assert.deepEqual(
      [f.inWindow, f.fits, f.inside, f.tier, f.rows, f.left, f.right, f.moreL, f.moreR],
      [true, true, true, tier, one ? 1 : 2, ...Object.values(tier === 'row' ? FULL : COMPACT)],
      w + 'px: ' + JSON.stringify(f),
    );
    assert.ok(
      one ? f.h <= 48 : f.midOnTop && f.h <= 96,
      w + 'px rows (the zones, without the file bar row): ' + JSON.stringify(f),
    );
    await shot('controlbar-' + w);
    if (tier === 'row') continue;
    // 「⋯」悬停即展开（不用点），紧贴在按钮正上方（与播放模式、速率的小面板同一种定位），移开收起。
    const more = `document.querySelector('#controlbar [data-id="moreRight"]').popoverTargetElement`;
    const [mx, my] = await center('#controlbar [data-id="moreRight"]');
    await move(mx, my);
    await wait(() => js(`${more}.matches(':popover-open')`), 'more opens on hover');
    const at = await js(
      `(()=>{const r=${more}.getBoundingClientRect(),b=document.querySelector('#controlbar [data-id="moreRight"]').getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0,gap:Math.round(b.top-r.bottom),centre:Math.round(Math.abs(r.left+r.width/2-(b.left+b.width/2))),edge:r.right>=innerWidth-5,over:r.left<=b.left&&r.right>=b.right};})()`,
    );
    // 按钮居中，靠窗口边缘时夹在窗口内（仍盖住按钮的正上方）。
    assert.ok(
      at.inside && at.gap >= 4 && at.gap <= 10 && at.over && (at.centre <= 1 || at.edge),
      w + 'px: the ⋯ pop-up sits right above its button: ' + JSON.stringify(at),
    );
    await shot('controlbar-' + w + '-more');
    await move(mx, my - 300);
    await wait(async () => !(await js(`${more}.matches(':popover-open')`)), w + 'px: leaving closes the ⋯ pop-up');
    await tap('#controlbar [data-id="moreRight"]');
    await wait(() => js(`${more}.matches(':popover-open')`), 'clicking also opens it');
    await key('Escape', 'Escape', 27);
    await wait(async () => !(await js(`${more}.matches(':popover-open')`)), 'Esc closes it');
  }
  // 「⋯」里的速率按钮照常使用：悬停弹出小面板（在「⋯」上方），点档位不收起「⋯」。
  await cdp('Emulation.setDeviceMetricsOverride', { width: 560, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait(async () => (await W()) === 560);
  await closeBar().catch(() => {});
  await openBar();
  {
    await tap('#controlbar [data-id="moreLeft"]');
    const more = `document.querySelector('#controlbar [data-id="moreLeft"]').popoverTargetElement`;
    await wait(() => js(`${more}.matches(':popover-open')`), 'left ⋯ opens');
    const [x, y] = await center('#controlbar [data-id="scrollRate"]');
    await move(x, y);
    await wait(() => isOpen('scrollRate'), 'rate panel from the ⋯ pop-up');
    assert.equal(
      await js(`${pop('scrollRate')}.getBoundingClientRect().bottom<=${more}.getBoundingClientRect().top`),
      true,
      'The rate panel sits above the ⋯ pop-up',
    );
    await shot('controlbar-more-dial');
    const [px, py] = await center('.dial-pop[data-for="scrollRate"] .dial-preset[data-value="1.5"]');
    await move(x, y - 30);
    await click(px, py);
    assert.equal(await text('scrollRate'), '1.5');
    assert.equal(await js(`${more}.matches(':popover-open')`), true, 'Choosing a preset keeps the ⋯ pop-up open');
    await js(`${B('scrollRate')}.click()`);
    assert.equal(await text('scrollRate'), '1.0');
    await key('Escape', 'Escape', 27);
    await wait(
      async () => !(await js(`${more}.matches(':popover-open')`)) && !(await isOpen('scrollRate')),
      'Esc closes both',
    );
  }
  await wide();
  await closeBar().catch(() => {});

  // ---- 只有图片的书：右区（字幕除外）全部禁用，影音模式下大按钮也禁用、空格没有效果；混合模式下空格开始滚动。循环仍可切换。
  await js(
    `(async()=>{const root=await navigator.storage.getDirectory(),pics=await root.getDirectoryHandle('Pics');window.showDirectoryPicker=async()=>pics;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
  );
  await wait(() => js(`bookTitle.textContent==='Pics'`), 'image book');
  await js('reader.focus();reader.scrollTop=300');
  await openBar();
  assert.deepEqual(
    await disabled([...RIGHT, 'play', 'loop']),
    MEDIA_ONLY,
    'No media: the whole right zone is disabled',
  );
  assert.deepEqual(
    [await js(`${B('subs')}.disabled`), await label('subs')],
    [true, 'Subtitles'],
    'Subtitles greyed out on an image',
  );
  await js(`${B('mode-comic')}.click()`);
  assert.deepEqual(await disabled(['loop', 'play']), [], 'Comic mode without media: loop and auto-scroll work');
  await js(`${B('loop')}.click()`);
  assert.equal(await js(`${B('loop')}.dataset.loop`), 'books', 'Loop switches in a book of images');
  await js(`${B('loop')}.click()`);
  await js(`${B('loop')}.click()`);
  assert.equal(await js(`${B('loop')}.dataset.loop`), 'book');
  await js(`${B('mode-mixed')}.click()`);
  await js(`${B('mode-media')}.click()`);
  assert.deepEqual(await disabled(['play']), ['play'], 'No media in media mode: the big button too');
  assert.equal(await label('play'), 'Auto-scroll · no videos or audio in this book', 'The tooltip says why');
  await js('reader.focus()');
  await key(' ', 'Space', 32);
  await delay(300);
  assert.equal(await js('reader.scrollTop'), 300, 'Media mode: Space does nothing in a book of images');
  assert.equal(await running(), 'false');
  await js(`${B('mode-mixed')}.click()`);
  await js('reader.focus()');
  await key(' ', 'Space', 32);
  await wait(
    async () => (await running()) === 'true' && (await js('reader.scrollTop')) > 302,
    'Mixed mode: Space scrolls',
  );
  await key(' ', 'Space', 32);
  await wait(async () => (await running()) === 'false');
  // 只有音频的书：漫画模式只滚图片，大按钮禁用并在提示里写明；空格提示、不开始。混合模式照常可用。
  await js(
    `(async()=>{const root=await navigator.storage.getDirectory(),tunes=await root.getDirectoryHandle('Tunes');window.showDirectoryPicker=async()=>tunes;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
  );
  await wait(() => js(`bookTitle.textContent==='Tunes'`), 'audio book');
  await openBar();
  await js(`${B('mode-comic')}.click()`);
  assert.deepEqual(
    await disabled(['play', 'playRate', 'volume']),
    ['play'],
    'Comic mode without images: the big button',
  );
  assert.equal(await label('play'), 'Auto-scroll · no images in this book');
  await js('reader.focus()');
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(
    () => js(`document.getElementById('notice').textContent==='This book has no images to scroll in Comic mode'`),
    'Shift+Space: hint',
  );
  assert.equal(await running(), 'false');
  await js(`${B('mode-mixed')}.click()`);
  assert.deepEqual(await disabled(['play']), [], 'Mixed mode: available');
  // 文件名只显示最末一段（不带路径和扩展名），完整路径在悬停提示：添加为单个作品时页名带卷的路径。
  await js(
    `(async()=>{const root=await navigator.storage.getDirectory(),nest=await root.getDirectoryHandle('Nest');window.showDirectoryPicker=async()=>nest;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addOne.click();})()`,
  );
  await wait(() => js(`bookTitle.textContent==='Nest'`), 'merged book');
  const deep = await js(`reader.querySelector('.page.media').dataset.name`);
  assert.match(deep, /\/07 deep\.wav$/);
  assert.deepEqual(
    await js(
      `(()=>{const n=reader.querySelector('.page.media .mv-head .mid-name');return [n.textContent,n.title];})()`,
    ),
    ['07 deep', deep],
  );
  await js('reader.focus()');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: control bar layout (one row, left 5 / middle 5 / right 5 with subtitles, rate buttons as wide as icons, auto-scroll button centred, icons with tooltips, no status lines), file bar row (above, same width, no height when hidden, shows and hides with the bar, controlbar event), play mode button (hover pop-up, click cycles, arrow keys), stable positions (modes, number widths, disabled buttons), disabling (right zone only without media, scroll speed in media mode, auto-scroll without images in comic mode / without media in media mode, with the reason in the tooltip), three-state loop button (icons, tooltips, saved, old cross-book preference), narrow windows (1280 / 900 / 700 one row, 560 / 480 ⋯ pop-ups, 420 / 360 two rows, ⋯ pop-ups right above on hover, rate panel inside ⋯), rate / volume panels (hover, gap, focus, one at a time, wheel, arrow keys, Esc, click to reset / mute), playback speed for all media incl. later ones, synced and remembered preferences, Space and own play buttons drive auto-scroll, running follows playback, book loop in media mode, next media after the view, previous / next media (page order, wrapping), comic mode plays one file, panel states (selected not dimmed and no outline, unselected dimmed, playing accent progress, equaliser, reduced motion), subtitle containers, last path segment as the file name, blank panel areas drag-scroll',
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
