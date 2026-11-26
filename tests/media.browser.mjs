// 视频、音频（媒体基础）：识别与不支持提示、布局与高度封顶、播放器壳、当前媒体、自动播放、统一音量、媒体按键、不重复探测、占位缩略图。
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
if (!binary) throw Error('Usage: node tests/media.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-media-'));
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
  // 一本混排的书：图片、两段视频（横 / 竖）、一段音频、一个扩展名受支持但内容播不了的文件；另有两种浏览器播不了的格式和一个非内容文件。
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Mixed',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(dir,'01.svg',svg(600,900,'teal'));
    await mvMedia.write(dir,'02 clip.webm',await mvMedia.webm({seconds:1.5,width:320,height:180}));
    await mvMedia.write(dir,'03 tall.webm',await mvMedia.webm({seconds:1.2,width:240,height:480}));
    await mvMedia.write(dir,'04 song.wav',mvMedia.wav({seconds:9}));
    await mvMedia.write(dir,'05 broken.mp4',new Blob([new Uint8Array(4096).fill(7)]));
    await mvMedia.write(dir,'06.svg',svg(600,900,'purple'));
    for(const n of ['x.avi','y.wma','notes.txt'])await mvMedia.write(dir,n,new Blob(['x']));
    const songs=await root.getDirectoryHandle('Songs',{create:true});await mvMedia.write(songs,'only.wav',mvMedia.wav({seconds:2}));
    const long=await root.getDirectoryHandle('Long',{create:true});await mvMedia.write(long,'00.svg',svg(600,900,'#355'));
    await mvMedia.write(long,'01 long.webm',await mvMedia.webm({seconds:6,width:320,height:180}));await mvMedia.write(long,'02.svg',svg(600,900,'#553'));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Mixed'`));
  // 3.1 / 3.2：浏览器播不了的媒体文件不建记录，导入结果里说明数量并列出扩展名；非内容文件不提示。
  const note = await wait(
    () => js(`notice.textContent.includes('unsupported')&&notice.textContent`),
    'unsupported notice',
  );
  assert.match(note, /^2 media files in unsupported formats were not imported \(\.avi \.wma\)$/, note);
  const record = () =>
    js(`import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.title==='Mixed'))`);
  assert.deepEqual(
    (await record()).pages.map((p) => p.name),
    ['01.svg', '02 clip.webm', '03 tall.webm', '04 song.wav', '05 broken.mp4', '06.svg'],
    'Images and media sort together by file name',
  );
  assert.equal(await js(`bookMeta.textContent`), '1 / 6 · 0%');

  // 3.3 布局：视频宽度跟随阅读区、高度按帧比例；竖视频高于视窗时等比缩小到正好一屏并居中；尺寸读到后记入书目记录。
  assert.ok(await js(`toPage('02 clip.webm')`));
  await wait(() => js(`el('02 clip.webm')?.readyState>=1`), 'clip metadata');
  const clip = await js(
    `(()=>{const n=node('02 clip.webm'),r=n.getBoundingClientRect(),v=el('02 clip.webm');return {w:r.width,h:r.height,controls:v.controls,tag:v.tagName,shell:!!n.querySelector('.mv-shell .mv-bar .mv-marks')}})()`,
  );
  assert.deepEqual(
    clip,
    { w: 800, h: 450, controls: false, tag: 'VIDEO', shell: true },
    'Wide video: full width, height by frame ratio, own shell instead of native controls',
  );
  {
    const [x, y] = await center('#reader .page[data-name="02 clip.webm"]');
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await delay(300);
    assert.equal(
      await js(`getComputedStyle(node('02 clip.webm').querySelector('.mv-shell')).opacity`),
      '1',
      'Hovering a video shows its shell',
    );
    await shot('media-video');
  }
  assert.ok(
    !(await js('srcLog')).includes('03 tall.webm') ||
      (await js(
        `(()=>{const n=node('03 tall.webm');if(!n)return true;const r=n.getBoundingClientRect(),R=reader.getBoundingClientRect();return r.top<R.bottom&&r.bottom>R.top;})()`,
      )),
    'Media outside the viewport gets no source',
  );
  assert.ok(await js(`toPage('03 tall.webm')`));
  await wait(
    () => js(`el('03 tall.webm')?.readyState>=1&&node('03 tall.webm').offsetHeight===reader.clientHeight`),
    'tall video capped',
  );
  assert.ok(await js(`toPage('03 tall.webm')`));
  const tall = await js(
    `(()=>{const n=node('03 tall.webm'),r=n.getBoundingClientRect(),R=reader.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),left:Math.round(r.left-R.left),top:Math.round(r.top-R.top)};})()`,
  );
  assert.deepEqual(tall, { w: 450, h: 900, left: 175, top: 0 }, 'Tall video shrinks to exactly one screen, centred');
  await wait(async () => {
    const p = (await record()).pages;
    const c = p.find((x) => x.name === '02 clip.webm'),
      t = p.find((x) => x.name === '03 tall.webm');
    return c.w === 320 && c.h === 180 && Math.abs(c.d - 1.5) < 0.1 && t.w === 240 && t.h === 480;
  }, 'frame size and duration saved');
  // 9.2 封顶值只在窗口尺寸停止变化约 200ms 后才重算：拖动中占位高度不变，画面按当前视窗临时等比缩小；停下后按新高度重排，中心处的内容不动。
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false });
  const during = await js(
    `frame().then(()=>{const n=node('03 tall.webm');return [n.offsetHeight,Math.round(el('03 tall.webm').getBoundingClientRect().height)];})`,
  );
  assert.deepEqual(
    during,
    [900, 700],
    'While resizing, the slot keeps its height and the picture shrinks to the viewport',
  );
  await wait(() => js(`node('03 tall.webm').offsetHeight===700`), 'cap recomputed after resizing stops');
  assert.ok(
    await js(
      `(()=>{const n=node('03 tall.webm'),r=n.getBoundingClientRect(),R=reader.getBoundingClientRect();return Math.abs(r.top+r.height/2-(R.top+reader.clientHeight/2))<=1;})()`,
    ),
    'The capped video stays centred after the re-layout',
  );
  await wide();
  await wait(() => js(`node('03 tall.webm').offsetHeight===900`));
  // 离开视窗的媒体释放源。
  assert.equal(
    await js(`node('02 clip.webm')?el('02 clip.webm').hasAttribute('src'):false`),
    false,
    'Media scrolled out of view releases its source',
  );

  // 音频：固定高度的卡片，横向占满阅读区（两侧留边距）、不设最大宽度；类型图标 + 文件名 + 3 行字幕区 + 壳。
  assert.ok(await js(`toPage('04 song.wav')`));
  await wait(() => js(`el('04 song.wav')?.readyState>=1`), 'audio metadata');
  const bar = await js(
    `(()=>{const n=node('04 song.wav'),r=n.querySelector('.mv-card').getBoundingClientRect(),R=reader.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(n.getBoundingClientRect().height),left:Math.round(r.left-R.left),name:n.querySelector('.mv-head').textContent,time:n.querySelector('.mv-time').textContent};})()`,
  );
  assert.deepEqual(bar, { w: 776, h: 170, left: 12, name: '04 song.wav', time: '0:00 / 0:09' });
  await shot('media-audio');

  // 3.4 壳：播放 / 暂停；点击进度条定位；时间显示不推动其他控件。
  const where = () =>
    js(
      `[...node('04 song.wav').querySelectorAll('.mv-shell>*:not([hidden]):not(.mv-pop)')].map(x=>{const r=x.getBoundingClientRect();return [x.className,Math.round(r.left),Math.round(r.width)];})`,
    );
  const before = await where();
  await tap('#reader .page[data-name="04 song.wav"] .mv-play');
  await wait(() => js(`!el('04 song.wav').paused&&el('04 song.wav').currentTime>.3`), 'audio plays');
  assert.deepEqual(await where(), before, 'Playing (time changing, icon switching) moves no control');
  const [bx, by, bw] = await js(
    `(()=>{const r=node('04 song.wav').querySelector('.mv-bar').getBoundingClientRect();return [r.left,r.top+r.height/2,r.width];})()`,
  );
  await click(bx + bw * 0.5, by);
  await wait(() => js(`Math.abs(el('04 song.wav').currentTime-4.5)<.6`), 'seek by clicking the bar');
  // 点击媒体区域（壳以外）播放 / 暂停，不翻屏。
  let top = await js('reader.scrollTop');
  await tap('#reader .page[data-name="04 song.wav"] .mv-head');
  await wait(() => js(`el('04 song.wav').paused`), 'tap pauses');
  assert.equal(await js('reader.scrollTop'), top, 'Clicking media does not turn the screen');

  // 12：空格 = 总控栏的大播放键：播放 / 暂停当前媒体（中线离视窗中心最近的，暂停的也算），不再滚动；Shift+空格同样不滚动。
  await key(' ', 'Space', 32);
  await wait(() => js(`!el('04 song.wav').paused`), 'space plays');
  await key(' ', 'Space', 32);
  await wait(() => js(`el('04 song.wav').paused`), 'space pauses');
  await key(' ', 'Space', 32, { modifiers: 8 });
  await wait(() => js(`!el('04 song.wav').paused`), 'shift+space toggles too');
  await key(' ', 'Space', 32);
  await wait(() => js(`el('04 song.wav').paused`));
  assert.equal(await js('reader.scrollTop'), top, 'Space no longer scrolls');

  // 3.8 / 12：Q / E、; / ' 每次 5%，短暂显示音量提示；全应用一套音量，持久化；静音作用于所有媒体。
  await key('q', 'KeyQ', 81);
  await key('q', 'KeyQ', 81);
  await key(';', 'Semicolon', 186);
  assert.equal(await js(`el('04 song.wav').volume`), 0.85);
  assert.equal(
    await js(`!document.querySelector('.mv-hud').hidden&&document.querySelector('.mv-hud').textContent`),
    '85%',
  );
  await key('e', 'KeyE', 69);
  await key("'", 'Quote', 222);
  assert.equal(await js(`el('04 song.wav').volume`), 0.95);
  await wait(() => js(`localStorage.getItem('mv2:volume')==='0.95'`), 'volume saved');
  // 静音在总控栏：点音量图标即静音。
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 450 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 897 });
  await wait(() => js('!controlbar.hidden'), 'control bar');
  await tap('#controlbar [data-id="volume"]');
  assert.equal(
    await js(
      `el('04 song.wav').muted&&document.querySelector('#controlbar [data-id="volume"]').getAttribute('aria-pressed')`,
    ),
    'true',
  );
  await wait(() => js(`localStorage.getItem('mv2:muted')==='true'`), 'muted saved');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 300 });
  await wait(() => js('controlbar.hidden'), 'control bar hides');
  // 别的窗口改了音量 / 静音：即时应用（设置类偏好，storage 事件）。
  await js(
    `dispatchEvent(new StorageEvent('storage',{key:'mv2:volume',newValue:'0.3',storageArea:localStorage}));dispatchEvent(new StorageEvent('storage',{key:'mv2:muted',newValue:'false',storageArea:localStorage}))`,
  );
  assert.deepEqual(await js(`[el('04 song.wav').volume,el('04 song.wav').muted]`), [0.3, false]);

  // 12：长按 D / A 快进 / 快退当前媒体（暂停中的也可以），期间显示累计偏移与目标时间；松开即停，不翻屏。
  await js(`el('04 song.wav').currentTime=0`);
  top = await js('reader.scrollTop');
  await key('d', 'KeyD', 68, { hold: true });
  await delay(1000);
  const fwd = await js(`[el('04 song.wav').currentTime,document.querySelector('.mv-hud').textContent]`);
  await up('d', 'KeyD', 68);
  assert.ok(fwd[0] >= 3.9 && fwd[0] <= 6.1, 'Holding D jumps 2 s about every 250 ms ' + fwd);
  assert.match(fwd[1], /^\+0:0\d → 0:0\d$/);
  await delay(400);
  const stopped = await js(`el('04 song.wav').currentTime`);
  await delay(400);
  assert.equal(await js(`el('04 song.wav').currentTime`), stopped, 'Releasing stops seeking');
  assert.equal(await js('reader.scrollTop'), top, 'A long press does not turn the screen');
  await key('a', 'KeyA', 65, { hold: true });
  await delay(700);
  await up('a', 'KeyA', 65);
  assert.ok((await js(`el('04 song.wav').currentTime`)) < stopped, 'Holding A rewinds');
  // 单击 D 仍是翻屏。
  await key('d', 'KeyD', 68);
  await wait(async () => (await js('reader.scrollTop')) > top, 'tap D turns the screen');

  // 3.2：扩展名受支持但播不了：该页显示占位和「重试」，记下文件的大小和修改时间；其他页不受影响。
  assert.ok(await js(`toPage('05 broken.mp4')`));
  await wait(() => js(`!node('05 broken.mp4').querySelector('.mv-fail').hidden`), 'unplayable placeholder');
  assert.equal(
    await js(`node('05 broken.mp4').querySelector('.mv-fail strong').textContent`),
    "The browser can't play this file",
  );
  assert.ok(await js(`!!node('05 broken.mp4').querySelector('.mv-fail .mv-retry')`));
  await wait(
    async () => /^\d+:4096$/.test((await record()).pages.find((p) => p.name === '05 broken.mp4').bad ?? ''),
    'failure saved with size and time',
  );
  await shot('media-broken');

  // 缩略图栏、全屏缩略图：媒体是带类型图标的固定占位，音频不读文件（视频的真实画面见 mediathumbs.browser.mjs）。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(
    () => js(`!!document.querySelector('#preview .page[data-name="04 song.wav"] .mv-tile.audio')`),
    'strip placeholder',
  );
  assert.equal(
    await js(
      `document.querySelector('#preview .page[data-name="04 song.wav"]').querySelector('img,canvas,audio,video')`,
    ),
    null,
  );
  await key('v', 'KeyV', 86);
  await wait(
    () => js(`[...document.querySelectorAll('.ov-item')].some(x=>x.querySelector('.mv-tile.video'))`),
    'overview placeholder',
  );
  assert.ok(
    await js(
      `[...document.querySelectorAll('.ov-item')].filter(x=>x.querySelector('.mv-tile.audio')).every(x=>!x.querySelector('img,canvas')&&!x.classList.contains('failed'))`,
    ),
  );
  await shot('media-overview');
  await key('Escape', 'Escape', 27);
  await wait(() => js(`!document.querySelector('dialog[open]')`));
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);

  // 窄宽度：次要控件（添加书签等登记的按钮）收进「更多」弹出层，不换行、不溢出。
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
  assert.ok(await js(`toPage('04 song.wav')`));
  await wait(() => js(`!node('04 song.wav').querySelector('.mv-more').hidden`), 'more button when narrow');
  const narrow = await js(
    `(()=>{const s=node('04 song.wav').querySelector('.mv-shell'),r=s.getBoundingClientRect();return {inPop:!!s.querySelector('.mv-pop [data-control="bookmark"]'),fits:s.scrollWidth<=s.clientWidth,inside:[...s.children].filter(x=>!x.hidden&&!x.matches('.mv-pop')).every(x=>{const b=x.getBoundingClientRect();return b.left>=r.left-.5&&b.right<=r.right+.5;})};})()`,
  );
  assert.deepEqual(narrow, { inPop: true, fits: true, inside: true });
  await tap('#reader .page[data-name="04 song.wav"] .mv-more');
  await wait(() => js(`node('04 song.wav').querySelector('.mv-pop').matches(':popover-open')`), 'popover opens');
  await shot('media-narrow');
  await key('Escape', 'Escape', 27);
  await wide();
  await wait(
    () =>
      js(
        `node('04 song.wav')&&node('04 song.wav').querySelector('.mv-more').hidden&&!!node('04 song.wav').querySelector('.mv-shell>[data-control="bookmark"]')`,
      ),
    'controls back inline',
  );

  // 全屏：整个播放器（画面 + 壳）全屏，快捷键照常可用。
  assert.ok(await js(`toPage('02 clip.webm')`));
  await wait(() => js(`el('02 clip.webm')?.readyState>=1`));
  // 全屏的是整个播放器（画面 + 壳）。无头浏览器不允许真正进入全屏，这里只验证按钮请求全屏的对象。
  await js(
    `Element.prototype.requestFullscreen=function(){window.fsTarget=this.dataset.name;return Promise.resolve();}`,
  );
  await tap('#reader .page[data-name="02 clip.webm"] .mv-full');
  assert.equal(
    await js('window.fsTarget'),
    '02 clip.webm',
    'The fullscreen button puts the whole player (video + shell) in fullscreen',
  );
  await js(`el('02 clip.webm').pause()`);

  // 3.6 自动播放：重新打开后没有用户操作时不自动播放；有过操作后，滚动停稳就播放离视窗中心最近的视频，音频不会；中线离开视窗即暂停；手动暂停的不再自动播放。
  await cdp('Page.navigate', { url: 'about:blank' });
  await wait(() => js(`location.href==='about:blank'`));
  await cdp('Page.navigate', { url: origin });
  await wait(() => js(`bookTitle.textContent==='Mixed'`));
  await js(helpers);
  await js(`reader.scrollTop=0`);
  await delay(200);
  assert.ok(await js(`toPage('04 song.wav')`));
  await delay(700);
  assert.equal(await js(`el('04 song.wav').paused`), true, 'No autoplay before any user action after opening');
  const [rx, ry] = await center('#reader');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rx, y: ry, deltaX: 0, deltaY: 30 });
  await delay(900);
  assert.equal(await js(`el('04 song.wav').paused`), true, 'Audio does not start when scrolling stops');
  await js(`el('04 song.wav').play()`);
  await wait(() => js(`!el('04 song.wav').paused`));
  await js(`reader.scrollTop+=reader.clientHeight*.7`);
  await wait(() => js(`!node('04 song.wav')||el('04 song.wav').paused`), 'leaving the view pauses');
  // 手动暂停后，在视窗内小幅滚动不会重新开始（自动播放只对视频生效，用一段较长的视频，播不完）。
  await js(
    `(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('Long');window.showDirectoryPicker=async()=>d;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
  );
  await wait(() => js(`bookTitle.textContent==='Long'`), 'long video book');
  assert.ok(await js(`toPage('01 long.webm')`));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rx, y: ry, deltaX: 0, deltaY: 5 });
  await wait(() => js(`!!el('01 long.webm')&&!el('01 long.webm').paused`), 'the long video autoplays');
  await js(`node('01 long.webm').querySelector('.mv-play').click()`);
  await wait(() => js(`el('01 long.webm').paused`), 'paused by its own play button');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rx, y: ry, deltaX: 0, deltaY: -20 });
  await delay(900);
  assert.equal(
    await js(`el('01 long.webm').paused`),
    true,
    'A media paused by the user is not restarted while it stays in view',
  );
  await js(
    `import('./src/reader/session.mjs').then(async s=>{const {books}=await import('./src/core/books.mjs');s.select([...books.values()].find(b=>b.title==='Mixed'));})`,
  );
  await wait(() => js(`bookTitle.textContent==='Mixed'`), 'back to Mixed');
  // 一个窗口同时只有一个媒体在播放；关掉「自动播放」后滚动不再自动开始。
  assert.ok(await js(`toPage('03 tall.webm')`));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rx, y: ry, deltaX: 0, deltaY: 5 });
  await wait(() => js(`!el('03 tall.webm').paused||el('03 tall.webm').ended`), 'autoplay video');
  assert.equal(
    await js(`[...reader.querySelectorAll('video,audio')].filter(m=>!m.paused).length`),
    1,
    'Only one media plays in a window',
  );
  await js(`document.querySelector('#bar [data-act="settings"]').click()`);
  await wait(() => js(`!!document.querySelector('#settings [data-id="autoplay"] [role=switch]')`));
  assert.equal(
    await js(`document.querySelector('#settings [data-id="autoplay"] .set-label').textContent`),
    'Autoplay media',
  );
  await js(`document.querySelector('#settings [data-id="autoplay"] [role=switch]').click()`);
  await wait(() => js(`localStorage.getItem('mv2:autoplay')==='false'`));
  await js(`document.querySelector('#settings').close()`);
  for (const m of await js(`[...reader.querySelectorAll('video,audio')].map(m=>m.closest('.page').dataset.name)`))
    await js(`el(${JSON.stringify(m)})?.pause()`);
  assert.ok(await js(`toPage('04 song.wav')`));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rx, y: ry, deltaX: 0, deltaY: 5 });
  await delay(800);
  assert.equal(
    await js(`[...reader.querySelectorAll('video,audio')].filter(m=>!m.paused).length`),
    0,
    'Autoplay off: scrolling does not start playback',
  );

  // 3.2 不重复探测：重新打开后，已知播不了且文件没变的不再挂源探测，直接显示占位；点「重试」才重新探测。
  await js(`srcLog.length=0`);
  assert.ok(await js(`toPage('05 broken.mp4')`));
  await wait(() => js(`!node('05 broken.mp4').querySelector('.mv-fail').hidden`), 'placeholder from the saved result');
  assert.equal((await js('srcLog')).includes('05 broken.mp4'), false, 'A known-bad file is not probed again');
  await tap('#reader .page[data-name="05 broken.mp4"] .mv-retry');
  await wait(
    async () =>
      (await js('srcLog')).includes('05 broken.mp4') &&
      (await js(`!node('05 broken.mp4').querySelector('.mv-fail').hidden`)),
    'retry probes again',
  );

  // 只有视频或音频的文件夹也成书；全书只有音频时，书架封面是用作品名生成的文字封面。
  await js(
    `(async()=>{const songs=await (await navigator.storage.getDirectory()).getDirectoryHandle('Songs');window.showDirectoryPicker=async()=>songs;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`,
  );
  await wait(() => js(`bookTitle.textContent==='Songs'`));
  await js(`document.querySelector('#bar [data-act="shelf"]').click()`);
  await wait(
    () => js(`document.querySelector('#books .book.current .text-cover')?.textContent==='Songs'`),
    'audio-only book text cover',
  );
  await shot('media-shelf');
  assert.deepEqual(errors, []);
  console.log(
    "PASS: media recognised by extension, unsupported formats reported on import, mixed sorting, video width / ratio / one-screen cap, audio bar, sources only for visible media, shell (play, seek, time, more popover, fullscreen), mute in the control bar, click / Space / Q E ; ' / long-press A D, autoplay rules, one player per window, unplayable placeholder probed once, media placeholders in thumbnails and covers",
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
