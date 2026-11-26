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
  const RIGHT = ['mediaPrev', 'mediaNext', 'order', 'loop', 'playRate', 'volume', 'popout'],
    MEDIA_ONLY = RIGHT.filter((id) => id !== 'loop'); // 循环任何模式、有无媒体都可用
  const label = (id) => js(`${B(id)}.title`);
  // 栏里每个可见控件与页码的位置和尺寸（不含弹出层里的；右区第二行的文件名随当前媒体变化，靠右对齐，不推动别的元素）。
  const rects = () =>
    js(
      `JSON.stringify([...controlbar.querySelectorAll('.cb-btn,.cb-pos,.cb-modes')].filter(e=>!e.closest('.cb-pop')&&!e.hidden).map(e=>{const r=e.getBoundingClientRect();return [e.dataset.id||e.className,Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)].join(' ');}))`,
    );
  const playing = () =>
    js(`[...reader.querySelectorAll('video,audio')].filter(m=>!m.paused).map(m=>m.closest('.page').dataset.name)`);
  const centred = (name) =>
    js(
      `(()=>{const n=node(${JSON.stringify(name)});return !!n&&Math.abs(n.offsetTop+n.offsetHeight/2-reader.scrollTop-reader.clientHeight/2)<2;})()`,
    );
  const text = (id) => js(`${B(id)}.textContent`);

  // ---- 布局。三区并排，高度约 84px，中区居中，阅读区底部居中；默认混合模式。
  assert.ok(await js(`toPage('03 b.wav')`));
  await wait(() => js(`el('03 b.wav')?.readyState>=1&&el('02 a.wav')?.readyState>=1`), 'audio loaded');
  await openBar();
  const geo =
    await js(`(()=>{const b=controlbar.getBoundingClientRect(),z=[...controlbar.querySelectorAll('.cb-zone')].map(e=>e.getBoundingClientRect()),p=document.querySelector('#controlbar [data-id="play"]').getBoundingClientRect(),R=reader.getBoundingClientRect();
    return {h:b.height,bottom:innerHeight-b.bottom,centre:Math.abs(b.left+b.width/2-(R.left+R.width/2)),order:z[0].right<=z[1].left&&z[1].right<=z[2].left,play:Math.abs(p.left+p.width/2-(b.left+b.width/2)),compact:controlbar.classList.contains('compact'),fits:controlbar.scrollWidth<=controlbar.clientWidth};})()`);
  assert.ok(geo.h >= 78 && geo.h <= 92, 'About 84px high: ' + geo.h);
  assert.ok(
    geo.bottom >= 8 && geo.centre <= 1 && geo.order && geo.play <= 1 && !geo.compact && geo.fits,
    JSON.stringify(geo),
  );
  assert.equal(await js(`${B('mode-mixed')}.getAttribute('aria-checked')`), 'true', 'Mixed by default');
  assert.equal(
    await js(
      `[...controlbar.querySelectorAll('.cb-btn')].filter(b=>!b.closest('.cb-pop')).every(b=>!b.textContent.trim()||b.matches('.cb-rate'))`,
    ),
    true,
    'Icons only, except the rate numbers',
  );
  assert.equal(
    await js(`[...controlbar.querySelectorAll('.cb-btn')].every(b=>b.getAttribute('aria-label')&&b.title)`),
    true,
    'Every button has a tooltip and a name',
  );
  assert.equal(await js(`document.querySelector('#controlbar .cb-now .cb-name').textContent`), '03 b.wav');
  assert.match(await js(`controlbar.querySelector('.cb-pos').textContent`), /^\d+ \/ 6 · \d+%$/);
  await shot('controlbar-800');

  // ---- 位置稳定。切换模式、数字位数变化、按钮禁用，所有控件的位置和尺寸不变；与模式无关的控件变暗禁用。
  const base = await rects();
  await js(`${B('mode-comic')}.click()`);
  assert.deepEqual(
    await disabled([...RIGHT, 'scrollRate', 'sections', 'play', 'single']),
    MEDIA_ONLY,
    'Comic: the right zone except loop',
  );
  assert.equal(await label('loop'), 'Loop: the whole book', 'Comic: loop is the whole book');
  assert.equal(await rects(), base, 'Comic mode moves nothing');
  await js(`${B('mode-media')}.click()`);
  assert.deepEqual(await disabled([...RIGHT, 'scrollRate', 'play']), ['scrollRate'], 'Media: scroll speed');
  assert.equal(await label('loop'), 'Loop');
  assert.equal(await rects(), base, 'Media mode moves nothing');
  await js(`${B('mode-mixed')}.click()`);
  assert.deepEqual(await disabled([...RIGHT, 'scrollRate', 'play']), ['order'], 'Mixed: play order');
  assert.equal(await label('loop'), 'Loop: the whole book', 'Mixed: loop is the whole book');
  await js(`${B('crossBook')}.click()`);
  assert.equal(await label('loop'), 'Loop: the whole reading list', 'Mixed, across books: the whole reading list');
  await js(`${B('crossBook')}.click()`);
  assert.equal(await rects(), base);
  for (const [v, shown] of [
    [0.25, '0.25×'],
    [1.25, '1.25×'],
    [4, '4.0×'],
  ]) {
    await js(
      `(()=>{const r=${pop('scrollRate')}.querySelector('input');r.value='${v}';r.dispatchEvent(new Event('input'));})()`,
    );
    assert.equal(await text('scrollRate'), shown);
    assert.equal(await rects(), base, 'Rate ' + v + ' moves nothing');
  }
  await js(`${B('scrollRate')}.click()`);
  assert.equal(await text('scrollRate'), '1.0×', 'Clicking the number resets to 1.0×');
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
  assert.equal(await text('scrollRate'), '1.25×', 'Wheel up: one step faster');
  await wheel('#controlbar [data-id="scrollRate"]', 100);
  await wheel('#controlbar [data-id="scrollRate"]', 100);
  assert.equal(await text('scrollRate'), '0.75×');
  await wait(() => js(`localStorage.getItem('mv2:scrollRate')==='0.75'`), 'scroll rate saved');
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
  assert.equal(await text('playRate'), '1.25×', 'Arrow up: one step faster');
  const top0 = await js('reader.scrollTop');
  await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await text('playRate'), '1.0×');
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
  assert.equal(await text('playRate'), '1.5×');
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
      `import('./src/core/prefs.mjs').then(m=>['playMode','scrollRate','playRate','singleFile','crossBook','sectionsOnly'].every(k=>m.prefs.has(k)))`,
    ),
    true,
  );
  const storage = (k, v) =>
    js(
      `(()=>{const key='mv2:${k}',v=${JSON.stringify(JSON.stringify(v))};if(v==='null')localStorage.removeItem(key);else localStorage.setItem(key,v);dispatchEvent(new StorageEvent('storage',{key,newValue:v==='null'?null:v,storageArea:localStorage}));})()`,
    );
  await storage('playMode', 'media');
  await storage('scrollRate', 2);
  await storage('crossBook', true);
  await storage('singleFile', true);
  await storage('sectionsOnly', true);
  await storage('playRate', 0.75);
  const state = () =>
    js(
      `[${B('mode-media')}.getAttribute('aria-checked'),${B('scrollRate')}.textContent,${B('crossBook')}.getAttribute('aria-pressed'),${B('single')}.getAttribute('aria-pressed'),${B('sections')}.getAttribute('aria-pressed'),${B('playRate')}.textContent,el('03 b.wav').playbackRate]`,
    );
  assert.deepEqual(
    await state(),
    ['true', '2.0×', 'true', 'true', 'true', '0.75×', 0.75],
    'Synced from another window',
  );
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Deck'`), 'reloaded');
  await js(MEDIA_FIXTURES);
  await js(helpers);
  assert.ok(await js(`toPage('03 b.wav')`));
  await wait(() => js(`el('03 b.wav')?.readyState>=1`));
  assert.deepEqual(
    await state(),
    ['true', '2.0×', 'true', 'true', 'true', '0.75×', 0.75],
    'Remembered after reloading',
  );
  for (const k of ['playMode', 'scrollRate', 'crossBook', 'singleFile', 'sectionsOnly', 'playRate'])
    await storage(k, null);
  assert.deepEqual(await state(), ['false', '1.0×', 'false', 'false', 'false', '1.0×', 1], 'Back to the defaults');
  await js('reader.focus()');

  // ---- 空格 = 大播放键；影音模式下运行状态与实际播放一致（漫画、混合模式的运行见 transport.browser.mjs）。
  const running = () => pressed('play');
  await js(`${B('mode-media')}.click()`);
  await key(' ', 'Space', 32);
  await wait(async () => (await playing()).join() === '03 b.wav', 'space plays the current media');
  assert.equal(await running(), 'true');
  const top1 = await js('reader.scrollTop');
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length, 'space pauses');
  await wait(async () => (await running()) === 'false', 'not running');
  assert.equal(await js('reader.scrollTop'), top1, 'Space does not scroll');
  // 单个媒体自己的播放键：等同大播放键，并把它设为当前媒体（不在视窗中央的也是）。
  await tap('#reader .page[data-name="02 a.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '02 a.wav', 'own play button');
  assert.deepEqual(
    await js(`[...reader.querySelectorAll('.page.media.current')].map(n=>n.dataset.name)`),
    ['02 a.wav'],
    'It becomes the current media',
  );
  assert.equal(await running(), 'true');
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length, 'space pauses the chosen media');
  await key(' ', 'Space', 32);
  await wait(async () => (await playing()).join() === '02 a.wav', 'and plays it again');
  // 播完按「播放顺序 × 循环」切到下一个；列表播完、不再继续时运行停止。
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
  await key(' ', 'Space', 32);
  await wait(async () => (await playing()).join() === '05 clip.webm');
  await js(`el('05 clip.webm').currentTime=1.2`);
  await wait(async () => (await running()) === 'false', 'running stops after the last media');
  assert.deepEqual(await playing(), []);
  // 视窗里没有媒体：取其后最近的媒体，滚到居中再播放。
  await js('reader.scrollTop=0');
  await delay(200);
  await key(' ', 'Space', 32);
  await wait(
    async () => (await playing()).join() === '02 a.wav' && (await centred('02 a.wav')),
    'the next media after the view',
  );
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length);
  await js(`${B('mode-mixed')}.click()`);

  // ---- 单个文件的播放面板。状态一眼可辨：当前媒体外框；播放中播放键与进度条为强调色、卡片提亮并显示音柱。
  assert.ok(await js(`toPage('03 b.wav')`));
  await tap('#reader .page[data-name="03 b.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '03 b.wav');
  await delay(400);
  const look = await js(
    `(()=>{const s=n=>{const p=node(n),c=getComputedStyle;return {playing:p.classList.contains('playing'),current:p.classList.contains('current'),play:c(p.querySelector('.mv-play')).backgroundColor,fill:c(p.querySelector('.mv-fill')).backgroundColor,card:c(p.querySelector('.mv-card')).backgroundColor,ring:c(p.querySelector('.mv-card')).boxShadow,eq:c(p.querySelector('.mv-eq')).display};};return {a:s('02 a.wav'),b:s('03 b.wav'),c:s('04 c.wav')};})()`,
  );
  const accent = 'rgb(255, 122, 89)';
  assert.deepEqual(
    [look.b.playing, look.b.current, look.b.play, look.b.fill, look.b.eq],
    [true, true, accent, accent, 'flex'],
    JSON.stringify(look.b),
  );
  for (const o of [look.a, look.c]) {
    assert.deepEqual([o.playing, o.current, o.eq], [false, false, 'none']);
    assert.notEqual(o.play, accent);
    assert.notEqual(o.fill, accent);
    assert.notEqual(o.card, look.b.card, 'The playing card is brighter');
    assert.equal(o.ring, 'none');
  }
  assert.match(look.b.ring, /255, 122, 89/, 'Current media: accent outline');
  await openBar();
  await shot('controlbar-panels');
  await closeBar();
  // 减少动态效果时音柱静止。
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await js(`getComputedStyle(node('03 b.wav').querySelector('.mv-eq i')).animationName`), 'none');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length);
  // 字幕容器：音频卡片里始终占位 3 行（有无字幕高度不变），视频叠在画面底部、控件上方；都不朗读（aria-live="off"）。
  // 容器里只有字幕模块放的一行 .mv-cue（没有字幕时隐藏）；这里直接往它里面写字来检查排版。
  const card = () => js(`Math.round(node('03 b.wav').querySelector('.mv-card').getBoundingClientRect().height)`);
  const h0 = await card();
  assert.deepEqual(
    await js(
      `(()=>{const s=node('03 b.wav').querySelector('.mv-card>.mv-subs');return [s.getAttribute('aria-live'),[...s.children].map(c=>c.className+':'+c.hidden).join(),s.textContent,Math.round(s.getBoundingClientRect().height)];})()`,
    ),
    ['off', 'mv-cue:true', '', 60],
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
  assert.deepEqual(
    await js(
      `(()=>{const n=node('05 clip.webm'),s=n.querySelector('.mv-subs'),r=s.getBoundingClientRect(),sh=n.querySelector('.mv-shell').getBoundingClientRect(),v=n.getBoundingClientRect();return [s.parentNode===n,s.getAttribute('aria-live'),r.bottom<=sh.top,r.top>=v.top,getComputedStyle(n.querySelector('video')).filter];})()`,
    ),
    [true, 'off', true, true, 'brightness(0.55)'],
    'Video subtitles sit over the picture above the controls; a paused video is dimmed',
  );
  await cueText('05 clip.webm', '');
  assert.equal(
    await js(`getComputedStyle(node('05 clip.webm').querySelector('.mv-big')).opacity`),
    '1',
    'Big play button while paused',
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

  // ---- 上一个 / 下一个媒体按播放顺序找，滚到居中；未运行时只定位，运行中接着播放。
  await js(`${B('mode-media')}.click()`);
  assert.ok(await js(`toPage('02 a.wav')`));
  await openBar();
  assert.deepEqual(
    await disabled(['mediaPrev', 'mediaNext']),
    ['mediaPrev'],
    'No previous media before the first (loop off)',
  );
  await js(`${B('mediaNext')}.click()`);
  await wait(() => centred('03 b.wav'), 'next media centred');
  assert.deepEqual(await playing(), [], 'Not running: only moves');
  await wait(() => js(`node('03 b.wav').classList.contains('current')`));
  await js(`${B('mediaPrev')}.click()`);
  await wait(() => centred('02 a.wav'), 'previous media centred');
  await key(' ', 'Space', 32);
  await wait(async () => (await playing()).join() === '02 a.wav');
  await js(`${B('mediaNext')}.click()`);
  await wait(async () => {
    const p = await playing();
    return p.join() === '03 b.wav' && (await centred('03 b.wav'));
  }, 'running: plays the next one');
  // 随机：下一个是本轮没播过的，上一个回到刚才播过的那个。
  await js(`${B('order')}.click()`);
  assert.equal(await js(`${B('order')}.querySelector('use').getAttribute('href')`), '#i-order-shuffle');
  await js(`${B('mediaNext')}.click()`);
  const shuffled = await wait(async () => {
    const p = await playing();
    return p.length === 1 && p[0] !== '03 b.wav' && p[0];
  }, 'shuffle next');
  await js(`${B('mediaPrev')}.click()`);
  await wait(async () => (await playing()).join() === '03 b.wav', 'shuffle previous returns from ' + shuffled);
  await js(`${B('order')}.click()`);
  await js(`${B('order')}.click()`);
  assert.equal(await js(`localStorage.getItem('mv2:playOrder')`), '"list"');
  await key(' ', 'Space', 32);
  await wait(async () => !(await playing()).length);

  // ---- 漫画模式下单个媒体的播放键只播这一个文件，播完即停（不按播放顺序切换）。
  await js(`${B('mode-comic')}.click()`);
  assert.ok(await js(`toPage('04 c.wav')`));
  await tap('#reader .page[data-name="04 c.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '04 c.wav');
  await js(`el('04 c.wav').currentTime=5.7`);
  await wait(() => js(`el('04 c.wav').paused`), 'ended');
  await delay(1000);
  assert.deepEqual(await playing(), [], 'Comic mode: stops after this file');
  await js(`${B('mode-mixed')}.click()`);

  // ---- 窄窗口：次要按钮收进「⋯」，再窄时分行；约 360px 不溢出，控件都在栏内。
  for (const w of [560, 360]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await wait(async () => (await W()) === w);
    await closeBar().catch(() => {});
    await openBar();
    const f =
      await js(`(()=>{const b=controlbar.getBoundingClientRect(),items=[...controlbar.querySelectorAll('.cb-btn,.cb-info,.cb-modes')].filter(e=>!e.closest('.cb-pop')&&!e.hidden);
      return {inWindow:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,fits:controlbar.scrollWidth<=controlbar.clientWidth,inside:items.every(e=>{const r=e.getBoundingClientRect();return r.left>=b.left-.5&&r.right<=b.right+.5&&r.top>=b.top-.5&&r.bottom<=b.bottom+.5;}),compact:controlbar.classList.contains('compact'),
        moreL:[...document.querySelector('#controlbar [data-id="moreLeft"]').popoverTargetElement.children].map(e=>e.dataset.id),moreR:[...document.querySelector('#controlbar [data-id="moreRight"]').popoverTargetElement.children].map(e=>e.dataset.id)};})()`);
    assert.deepEqual(
      f,
      {
        inWindow: true,
        fits: true,
        inside: true,
        compact: true,
        moreL: ['toStart', 'toEnd'],
        moreR: ['order', 'loop', 'popout'],
      },
      w + 'px',
    );
    await tap('#controlbar [data-id="moreRight"]');
    const more = `document.querySelector('#controlbar [data-id="moreRight"]').popoverTargetElement`;
    await wait(() => js(`${more}.matches(':popover-open')`), 'more opens');
    assert.equal(
      await js(`(()=>{const r=${more}.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0;})()`),
      true,
    );
    await shot('controlbar-' + w);
    await key('Escape', 'Escape', 27);
  }
  await wide();
  await closeBar().catch(() => {});

  // ---- 只有图片的书：右区除循环外全部禁用，影音模式下大播放键也禁用、空格没有效果；混合模式下空格开始滚动。循环仍可切换（整本循环）。
  await js(
    `(async()=>{const root=await navigator.storage.getDirectory(),pics=await root.getDirectoryHandle('Pics');window.showDirectoryPicker=async()=>pics;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
  );
  await wait(() => js(`bookTitle.textContent==='Pics'`), 'image book');
  await js('reader.focus();reader.scrollTop=300');
  await openBar();
  assert.deepEqual(await disabled([...RIGHT, 'play']), MEDIA_ONLY, 'No media: the right zone except loop is disabled');
  await js(`${B('mode-comic')}.click()`);
  assert.deepEqual(await disabled(['loop']), [], 'Comic mode without media: loop still works');
  await js(`${B('loop')}.click()`);
  assert.equal(await pressed('loop'), 'true', 'Loop turns on in a book of images');
  await js(`${B('loop')}.click()`);
  assert.equal(await pressed('loop'), 'false');
  await js(`${B('mode-mixed')}.click()`);
  await js(`${B('mode-media')}.click()`);
  assert.deepEqual(await disabled(['play']), ['play'], 'No media in media mode: the big play button too');
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
  // 文件名只显示最末一段（不带路径），完整路径在悬停提示：添加为单个作品时页名带卷的路径。
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
    ['07 deep.wav', deep],
  );
  await js('reader.focus()');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: control bar layout (three zones, about 84px, centred, icons with tooltips), stable positions (modes, number widths, disabled buttons), mode-dependent disabling, narrow windows (⋯ pop-ups, rows, 360px), rate / volume panels (hover, gap, focus, one at a time, wheel, arrow keys, Esc, click to reset / mute), playback speed for all media incl. later ones, synced and remembered preferences, Space and own play buttons drive the transport, running follows playback, next media after the view, previous / next media (list, shuffle), comic mode plays one file, panel states (current outline, playing accent, brighter card, equaliser, reduced motion), subtitle containers, last path segment as the file name, blank panel areas drag-scroll',
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
