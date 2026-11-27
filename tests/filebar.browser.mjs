// 文件栏与选中媒体：文件栏一行（文件名、播放与进度、按钮位）、当前文件（选中的媒体，否则视窗中心所在的页）、三种文件布局一致、
// 各宽度下一行不溢出（窄时收进「⋯」）、选中 / 未选中的外观、字幕菜单、书签标记、设置为封面、视频全屏、只在显示时更新。
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
if (!binary) throw Error('Usage: node tests/filebar.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-filebar-'));
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
    '--window-size=1280,900',
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
  const size = (width, height = 900) =>
    cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(1280);
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','false');`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    window.toPage=async(name,f=0.5)=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight*f-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight*f-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.box=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    window.fb=()=>{const f=document.getElementById('filebar'),q=s=>f.querySelector(s),vis=e=>!!e&&e.isConnected&&getComputedStyle(e).visibility!=='hidden'&&!!e.offsetParent;
      const slots=Object.fromEntries([...f.querySelectorAll('[data-slot]')].map(b=>[b.dataset.slot,{shown:vis(b)&&f.contains(b),inRow:!!b.closest('.fb-tools')&&!b.closest('.fb-more-pop'),disabled:b.disabled,label:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed'),box:box(b)}]));
      return {name:q('.fb-name').textContent,title:q('.fb-name .mid-name')?.title??null,mid:vis(q('.fb-play')),play:q('.fb-play').getAttribute('aria-label'),playOff:q('.fb-play').disabled,
        time:q('.fb-time').textContent,fill:getComputedStyle(q('.mv-fill')).backgroundColor,marks:q('.mv-bar').querySelectorAll('.mv-mk').length,
        slots,more:vis(q('.fb-more')),row:box(f),bar:box(q('.mv-bar')),nameBox:box(q('.fb-name')),playBox:box(q('.fb-play')),timeBox:box(q('.fb-time')),
        scroll:[f.scrollWidth,f.clientWidth],zones:box(controlbar.querySelector('.cb-zones'))};};
    window.look=name=>{const n=node(name),v=n.querySelector('video'),c=n.querySelector('.mv-card'),big=n.querySelector('.mv-big'),a=c?.querySelector('.mv-art');
      return {selected:n.classList.contains('selected'),playing:n.classList.contains('playing'),dim:getComputedStyle(v??c).filter,
        art:a?getComputedStyle(a).filter:null,big:big?getComputedStyle(big).opacity:null,bigShown:big?getComputedStyle(big).display!=='none':false,
        after:getComputedStyle(n,'::after').content,outline:getComputedStyle(n).outlineStyle,ring:c?getComputedStyle(c).boxShadow:null,
        border:c?getComputedStyle(c).borderTopColor:null,shell:!!n.querySelector('.mv-shell')&&!c,title:!!n.querySelector('.mv-title'),
        controls:n.querySelectorAll(':scope>.mv-shell,:scope>.mv-title,:scope>.mv-pop').length};};`);
  // 一本混排的书：图片、视频（两个字幕）、音频、播不了的媒体、图片。文件名很长，验证中间省略与悬停提示。
  const LONG = '02 a rather long video file name for the file bar.webm';
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Bar',{create:true});
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/></svg>'],{type:'image/svg+xml'});
    await mvMedia.write(dir,'01.svg',svg(600,900,'teal'));
    await mvMedia.write(dir,${JSON.stringify(LONG)},await mvMedia.webm({seconds:4,width:320,height:180}));
    const srt='1\\n00:00:00,000 --> 00:00:09,000\\nHello\\n';
    await mvMedia.write(dir,'02 a rather long video file name for the file bar.srt',new Blob([srt]));
    await mvMedia.write(dir,'02 a rather long video file name for the file bar.zh.srt',new Blob([srt.replace('Hello','Ni hao')]));
    await mvMedia.write(dir,'03 song.wav',mvMedia.wav({seconds:9}));
    await mvMedia.write(dir,'04 broken.mp4',new Blob([new Uint8Array(4096).fill(7)]));
    await mvMedia.write(dir,'05.svg',svg(600,900,'purple'));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`!!document.querySelector('#reader .page[data-name="01.svg"]')`), 'book opened');
  const showBar = async (on = true) => {
    await wait(() => js(`!controlbar.classList.contains('leaving')`), 'fade finished');
    if ((await js('!controlbar.hidden')) !== on) await key('t', 'KeyT', 84);
    await wait(
      () =>
        js(`!controlbar.hidden===${on}&&!controlbar.classList.contains('leaving')&&!controlbar.getAnimations().length`),
      'control bar ' + on,
    );
    await js('frame()');
  };

  // ---- 文件栏在总控栏里三区那一行的上方、同宽，随总控栏显示 / 收起。
  await js(`toPage('01.svg')`);
  await showBar();
  let s = await js('fb()');
  assert.equal(await js('filebar.hidden'), false);
  assert.ok(
    s.row.bottom <= s.zones.top + 1 && Math.abs(s.row.width - s.zones.width) < 1,
    'File bar above the three zones, same width',
  );
  // 图片：文件名，中区留空，右侧只有添加书签、添加区段书签、设置为封面（字幕、全屏留空位）。
  assert.equal(s.name, '01.svg');
  assert.equal(s.mid, false, 'No playback controls for an image');
  assert.deepEqual(
    Object.entries(s.slots).map(([k, v]) => [k, v.shown]),
    [
      ['subs', false],
      ['bookmark', true],
      ['section', true],
      ['cover', true],
      ['full', false],
    ],
  );
  assert.deepEqual(
    [s.slots.bookmark.label, s.slots.section.label, s.slots.cover.label],
    ['Add bookmark', 'Add section bookmark', 'Set as cover'],
  );
  const imageSlots = Object.fromEntries(Object.entries(s.slots).map(([k, v]) => [k, v.box]));
  const imageMid = { play: s.playBox, bar: s.bar, name: s.nameBox };
  await shot('filebar-image');

  // ---- 视窗中心换成视频：文件名只显示末段、中间省略，完整路径在提示里；按钮全有；按钮位置与图片时相同。
  await js(`toPage(${JSON.stringify(LONG)})`);
  await wait(() => js(`fb().name===${JSON.stringify(LONG)}`), 'file bar follows the centre page');
  await wait(() => js(`fb().time.endsWith('0:04')`), 'duration');
  s = await js('fb()');
  assert.equal(s.title, LONG);
  assert.ok(s.nameBox.width < 200 && s.nameBox.width > 100, 'Name column about 24 characters wide: ' + s.nameBox.width);
  assert.ok(
    await js(`(()=>{const n=filebar.querySelector('.fb-name .mid-name>span');return n.scrollWidth>n.clientWidth;})()`),
    'Long name is cut in the middle',
  );
  assert.equal(await js(`filebar.querySelector('.fb-name .mid-name').textContent`), LONG, 'Full text kept for copying');
  assert.equal(s.mid, true);
  assert.deepEqual(
    Object.values(s.slots).map((v) => v.shown),
    [true, true, true, true, true],
  );
  for (const k of Object.keys(imageSlots))
    assert.deepEqual(s.slots[k].box, imageSlots[k], k + ' does not move between file types');
  assert.deepEqual([s.playBox, s.nameBox], [imageMid.play, imageMid.name], 'Play button and name keep their places');
  assert.equal(s.play, 'Play');
  assert.match(s.time, /^0:00 \/ 0:04$/);
  // 视频画面内没有浮动控件：只有画面、字幕容器和大播放键。
  await delay(300);
  let v = await js(`look(${JSON.stringify(LONG)})`);
  assert.deepEqual([v.shell, v.title, v.controls], [false, false, 0], 'No controls inside the video picture');
  assert.deepEqual(
    await js(`[...node(${JSON.stringify(LONG)}).children].map(c=>c.className||c.tagName.toLowerCase())`),
    ['video', 'mv-subs', 'mv-big', 'mv-fail'],
  );
  // 未选中：压暗 + 大播放键；没有强调色外框。
  assert.deepEqual([v.selected, v.dim, v.big, v.after], [false, 'brightness(0.55)', '1', 'none']);
  await shot('filebar-video');

  // ---- 文件栏的播放键：等同媒体自己的播放键，选中并播放；选中后不压暗、没有大播放键、没有描边。
  await tap('#filebar .fb-play');
  await wait(() => js(`look(${JSON.stringify(LONG)}).playing`), 'plays from the file bar');
  await delay(300); // 过渡结束
  v = await js(`look(${JSON.stringify(LONG)})`);
  assert.deepEqual([v.selected, v.dim, v.big, v.after, v.outline], [true, 'none', '0', 'none', 'none']);
  await wait(() => js(`fb().play==='Pause'`), 'pause icon');
  const playingFill = (await js('fb()')).fill;
  await wait(() => js(`!fb().time.startsWith('0:00 ')`), 'time moves');
  await tap('#filebar .fb-play');
  await wait(() => js(`!look(${JSON.stringify(LONG)}).playing`), 'paused');
  await delay(300); // 过渡结束
  v = await js(`look(${JSON.stringify(LONG)})`);
  assert.deepEqual([v.selected, v.dim, v.big], [true, 'none', '0'], 'Paused media stays selected, not dimmed');
  s = await js('fb()');
  assert.equal(s.play, 'Play');
  assert.notEqual(s.fill, playingFill, 'Progress colour differs between playing and paused');

  // ---- 当前文件是选中的媒体：视窗中心移到下一张图片（视频中线仍在视窗内）时文件栏仍是它；添加书签加在它的当前时间。
  await js(`(()=>{const n=node(${JSON.stringify(LONG)});reader.scrollTop=n.offsetTop+n.offsetHeight/2-40;})()`);
  await js('frame().then(frame)');
  assert.equal(await js(`fb().name`), LONG, 'Selected media stays the current file');
  assert.equal(
    await js(`import('./src/reader/session.mjs').then(s=>s.view.position().i)`),
    2,
    'Centre page is the audio below',
  );
  await tap('#filebar [data-slot="bookmark"]');
  await wait(() => js(`fb().marks===1`), 'bookmark mark on the file bar progress');
  assert.deepEqual(
    await js(`import('./src/reader/session.mjs').then(s=>s.current.bookmarks.map(b=>[b.name,typeof b.t]))`),
    [[LONG, 'number']],
    'Bookmark added to the selected video',
  );
  // 长按 D 快进同样作用于选中的视频，不是视窗中心的音频。
  const t0 = await js(`el(${JSON.stringify(LONG)}).currentTime`);
  await key('d', 'KeyD', 68, { hold: true });
  await delay(900);
  await up('d', 'KeyD', 68);
  assert.ok(
    (await js(`el(${JSON.stringify(LONG)}).currentTime`)) >= Math.min(3.9, t0 + 1),
    'Hold D seeks the selected video',
  );
  assert.equal(await js(`el('03 song.wav')?.currentTime??0`), 0, 'The centre audio is untouched');
  assert.equal(await js(`fb().name`), LONG);
  // 中线离开视窗即取消选中，文件栏回到视窗中心所在的页。
  await js(`toPage('03 song.wav',0.95)`);
  await wait(() => js(`!look(${JSON.stringify(LONG)}).selected`), 'deselected when the midline leaves');
  await wait(() => js(`fb().name==='03 song.wav'`), 'file bar follows the centre page again');

  // ---- 音频：字幕、添加书签、添加区段书签（封面、全屏留空位）；卡片自己的控件保留并与文件栏同步；未选中时卡片连同小图压暗。
  s = await js('fb()');
  assert.deepEqual(
    Object.values(s.slots).map((x) => x.shown),
    [true, true, true, false, false],
  );
  for (const k of Object.keys(imageSlots))
    assert.deepEqual(s.slots[k].box, imageSlots[k], k + ' does not move for audio');
  await delay(300);
  let a = await js(`look('03 song.wav')`);
  assert.deepEqual(
    [a.selected, a.dim, a.big, a.bigShown],
    [false, 'brightness(0.55)', '1', true],
    'Unselected card dimmed (with its art)',
  );
  assert.deepEqual(
    await js(
      `[...node('03 song.wav').querySelectorAll('.mv-card .mv-play,.mv-card .mv-bar,.mv-card .mv-time,.mv-card [data-control]')].map(e=>e.dataset.control||e.className.split(' ').at(-1))`,
    ).then((x) => x.length >= 6),
    true,
    'Card keeps its own controls',
  );
  await tap('#filebar .fb-play');
  await wait(() => js(`look('03 song.wav').playing`), 'audio plays from the file bar');
  await delay(300); // 过渡结束
  a = await js(`look('03 song.wav')`);
  assert.deepEqual(
    [a.selected, a.dim, a.big, a.ring],
    [true, 'none', '0', 'none'],
    'Selected card: no dimming, no ring',
  );
  assert.equal(
    await js(`node('03 song.wav').querySelector('.mv-card .mv-play').getAttribute('aria-label')`),
    'Pause',
    'Card play button in sync',
  );
  assert.equal(
    await js(`getComputedStyle(node('03 song.wav').querySelector('.mv-eq')).display`),
    'flex',
    'Equaliser while playing',
  );
  await shot('filebar-audio');
  await tap('#reader .page[data-name="03 song.wav"] .mv-card .mv-play');
  await wait(() => js(`fb().play==='Play'`), 'file bar follows the card');
  assert.equal(await js(`getComputedStyle(node('03 song.wav').querySelector('.mv-eq')).display`), 'none');
  assert.equal(await js(`look('03 song.wav').selected`), true);

  // ---- 播放不了的媒体：没有大播放键，文件栏的播放键变灰。
  await js(`toPage('04 broken.mp4',0.9)`); // 音频（选中）的中线离开视窗
  await wait(() => js(`node('04 broken.mp4').classList.contains('mv-failed')`), 'broken media fails');
  await wait(() => js(`fb().name==='04 broken.mp4'`), 'file bar on the broken media');
  assert.equal((await js(`look('04 broken.mp4')`)).bigShown, false, 'No big play button on an unplayable media');
  s = await js('fb()');
  assert.deepEqual([s.playOff, s.slots.bookmark.disabled, s.slots.full.disabled], [true, true, true]);

  // ---- 字幕按钮在文件栏：有两个字幕时弹出菜单（按文件栏的按钮定位），再点一次收起。
  await js(`toPage(${JSON.stringify(LONG)})`);
  await wait(() => js(`fb().name===${JSON.stringify(LONG)}&&!fb().slots.subs.disabled`), 'subtitle button enabled');
  assert.equal(await js(`filebar.querySelector('[data-slot="subs"]').getAttribute('aria-haspopup')`), 'menu');
  await tap('#filebar [data-slot="subs"]');
  await wait(
    () =>
      js(
        `document.querySelector('.mv-subs-pop').matches(':popover-open')&&filebar.querySelector('[data-slot="subs"]').getAttribute('aria-expanded')==='true'`,
      ),
    'subtitle menu',
  );
  const menu = await js(
    `(()=>{const m=document.querySelector('.mv-subs-pop'),r=m.getBoundingClientRect(),b=filebar.querySelector('[data-slot="subs"]').getBoundingClientRect();return {items:m.querySelectorAll('button').length,above:r.bottom<=b.top,expanded:filebar.querySelector('[data-slot="subs"]').getAttribute('aria-expanded')};})()`,
  );
  assert.deepEqual(menu, { items: 3, above: true, expanded: 'true' });
  await tap('#filebar [data-slot="subs"]');
  await wait(
    () => js(`!document.querySelector('.mv-subs-pop').matches(':popover-open')`),
    'menu closes on a second click',
  );

  // ---- 设置为封面：图片取视窗中心处。
  await js(`toPage('05.svg')`);
  await wait(() => js(`fb().name==='05.svg'`));
  await tap('#filebar [data-slot="cover"]');
  await wait(
    () => js(`import('./src/reader/session.mjs').then(s=>!!s.current.customCover)`),
    'cover set from the file bar',
  );

  // ---- 单击 F 跳到书签：该媒体成为选中媒体（自动播放关闭时停在书签处），文件栏随之换成它。
  await key('f', 'KeyF', 70);
  await wait(
    () => js(`look(${JSON.stringify(LONG)}).selected&&fb().name===${JSON.stringify(LONG)}`),
    'bookmark jump selects the media',
  );
  assert.equal(await js(`el(${JSON.stringify(LONG)}).paused`), true);

  // ---- 视频全屏：页面全屏、视频铺满窗口，底缘弹出文件栏 + 总控栏；退出回到原来的阅读位置。
  await js(`toPage(${JSON.stringify(LONG)})`);
  await wait(() => js(`fb().name===${JSON.stringify(LONG)}`));
  const top0 = await js('reader.scrollTop');
  // 无头浏览器不允许真正进入全屏：替换成立即生效的模拟（只验证请求全屏的对象与页面的反应）。
  await js(`(()=>{let fs=null;Object.defineProperty(Document.prototype,'fullscreenElement',{get:()=>fs,configurable:true});
    const change=()=>document.dispatchEvent(new Event('fullscreenchange'));
    Element.prototype.requestFullscreen=function(){fs=this;window.fsCalls=(window.fsCalls||0)+1;setTimeout(change);return Promise.resolve();};
    Document.prototype.exitFullscreen=function(){fs=null;setTimeout(change);return Promise.resolve();};})()`);
  await tap('#filebar [data-slot="full"]');
  await wait(
    () =>
      js(
        `document.fullscreenElement===document.documentElement&&node(${JSON.stringify(LONG)}).classList.contains('mv-full')`,
      ),
    'fullscreen',
  );
  await js('frame().then(frame)');
  const full =
    await js(`(()=>{const n=node(${JSON.stringify(LONG)}),r=n.getBoundingClientRect(),v=n.querySelector('video').getBoundingClientRect(),c=controlbar.getBoundingClientRect();
    const hit=document.elementFromPoint(c.left+c.width/2,c.top+10),under=document.elementFromPoint(innerWidth/2,innerHeight-4);
    return {r:[r.left,r.top,r.width,r.height],win:[innerWidth,innerHeight],video:v.width,bar:controlbar.contains(hit),under:n.contains(under),selected:n.classList.contains('selected'),label:filebar.querySelector('[data-slot="full"]').getAttribute('aria-label')};})()`);
  assert.deepEqual(full.r, [0, 0, full.win[0], full.win[1]], 'Video fills the window');
  assert.equal(full.bar, true, 'File bar and control bar above the video');
  assert.equal(full.under, true, 'Nothing of the other pages shows over the video');
  assert.equal(full.selected, true, 'The fullscreen video is the selected media');
  assert.equal(full.label, 'Exit fullscreen');
  await shot('filebar-fullscreen');
  await tap('#filebar [data-slot="full"]');
  await wait(
    () => js(`!document.fullscreenElement&&!node(${JSON.stringify(LONG)}).classList.contains('mv-full')`),
    'leaves fullscreen',
  );
  await wait(() => js(`Math.abs(reader.scrollTop-${top0})<1`), 'back at the same reading position');

  // ---- 各宽度下一行、不溢出：先缩短文件名，再缩短进度条，最后收进「⋯」。
  const widths = [1280, 900, 700, 560, 420, 360];
  let lastName = Infinity;
  for (const w of widths) {
    await size(w);
    await wait(() => js(`innerWidth===${w}`));
    await js('frame().then(frame)');
    s = await js('fb()');
    const items = await js(
      `[...filebar.querySelectorAll('.fb-name,.fb-play,.mv-bar,.fb-time,.fb-tools>button')].filter(e=>getComputedStyle(e).visibility!=='hidden'&&e.offsetParent).map(e=>box(e))`,
    );
    assert.ok(s.scroll[0] <= s.scroll[1], w + ': no horizontal overflow');
    for (const it of items) {
      assert.ok(it.left >= s.row.left - 0.5 && it.right <= s.row.right + 0.5, w + ': inside the file bar');
      assert.ok(Math.abs(it.top + it.height / 2 - (s.playBox.top + s.playBox.height / 2)) < 2, w + ': one row');
    }
    assert.ok(s.row.height <= 48, w + ': one row high (' + s.row.height + ')');
    assert.ok(s.nameBox.width >= 55 && s.bar.width >= 55, w + ': name and progress keep a minimum width');
    assert.ok(s.nameBox.width <= lastName + 0.5, w + ': name shrinks first');
    lastName = s.nameBox.width;
    const inRow = Object.entries(s.slots)
      .filter(([, x]) => x.inRow)
      .map(([k]) => k);
    assert.ok(inRow.includes('bookmark'), w + ': add bookmark stays in the row');
    if (w >= 700) assert.equal(s.more, false, w + ': everything fits');
    if (w <= 420) assert.equal(s.more, true, w + ': secondary buttons in the ⋯ popover');
    await shot('filebar-' + w);
  }
  // 窄时「⋯」弹出层里是收起的按钮。
  await tap('#filebar .fb-more');
  await wait(() => js(`filebar.querySelector('.fb-more-pop').matches(':popover-open')`), 'more popover');
  assert.deepEqual(
    await js(
      `[...filebar.querySelectorAll('.fb-more-pop>button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>b.dataset.slot)`,
    ),
    ['subs', 'section', 'cover', 'full'],
  );
  await shot('filebar-more');
  await key('Escape', 'Escape', 27);
  await size(1280);

  // ---- 不显示时不更新：收起后时间不再跟着走，显示时立即取当前值。
  await showBar();
  await tap('#filebar .fb-play');
  await wait(() => js(`look(${JSON.stringify(LONG)}).playing`));
  await showBar(false);
  const frozen = await js(`filebar.querySelector('.fb-time').textContent`);
  await delay(1200);
  assert.equal(await js(`filebar.querySelector('.fb-time').textContent`), frozen, 'No updates while hidden');
  await showBar();
  assert.notEqual(await js(`filebar.querySelector('.fb-time').textContent`), frozen, 'Updated when shown');
  await js(`el(${JSON.stringify(LONG)}).pause()`);

  assert.deepEqual(errors, []);
  console.log(
    'PASS: file bar above the control bar zones, name (last segment, middle cut, full path in tooltip), play / progress / time, fixed slots that do not move between image / video / audio, current file = selected media else the centre page, bookmark from the file bar and hold D on the selected media, bookmark jump selects, selection and dimming (no outline, unselected dimmed with big play, audio art dimmed), unplayable media without big play, subtitle menu from the file bar, set as cover, video fullscreen with the bars above and back to the reading position, one row without overflow at 1280 / 900 / 700 / 560 / 420 / 360px with the ⋯ popover, no updates while hidden',
  );
} finally {
  if (errors.length) console.error('Page errors:', errors);
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }));
    ws.close();
  }
  server.close();
  for (let i = 0; i < 30 && chrome.exitCode === null; i++) await delay(100);
  if (chrome.exitCode === null) chrome.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
