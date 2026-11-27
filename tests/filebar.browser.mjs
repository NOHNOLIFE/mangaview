// 文件栏与选中媒体：文件栏两行（标题行：不带扩展名的文件名与标题行按钮区；播放行：播放与进度、时间与快退 / 快进、三个固定的按钮位）、
// 当前文件（选中的媒体，否则视窗中心所在的页）、三种文件的按钮排布（直接显示书签与区段，其余收进悬停展开的「⋯」）、各宽度下不溢出、
// 选中 / 未选中的外观（未选中视频的压暗、视窗中心与悬停的视频）、阶梯音柱、总控栏的字幕按钮、书签标记、设置为封面、视频全屏（居中、不混入其他页）、只在显示时更新。
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
    window.fb=()=>{const f=document.getElementById('filebar'),q=s=>f.querySelector(s),vis=e=>!!e&&e.isConnected&&getComputedStyle(e).visibility!=='hidden'&&!!e.offsetParent,tools=q('.fb-tools');
      const slots=Object.fromEntries([...f.querySelectorAll('[data-slot]')].map(b=>[b.dataset.slot,{inRow:!!b.closest('.fb-tools'),inMore:!!b.closest('.fb-more-pop'),disabled:b.disabled,label:b.getAttribute('aria-label'),pressed:b.getAttribute('aria-pressed'),box:box(b)}]));
      return {name:q('.fb-name').textContent,title:q('.fb-name .mid-name')?.title??null,mid:vis(q('.fb-play')),play:q('.fb-play').getAttribute('aria-label'),playOff:q('.fb-play').disabled,
        time:q('.fb-time .mv-clock').textContent,fill:getComputedStyle(q('.mv-fill')).backgroundColor,marks:q('.mv-bar').querySelectorAll('.mv-mk').length,
        places:[...tools.children].map(c=>c.dataset.slot??(c.matches('.fb-more')?'more':null)),placeBoxes:[...tools.children].map(c=>box(c)),
        slots,more:vis(q('.fb-more')),row:box(f),head:box(q('.fb-head')),line:box(q('.fb-line')),bar:box(q('.mv-bar')),nameBox:box(q('.fb-name')),playBox:box(q('.fb-play')),timeBox:box(q('.fb-time')),
        scroll:[f.scrollWidth,f.clientWidth],zones:box(controlbar.querySelector('.cb-zones'))};};
    window.dimOf=name=>getComputedStyle(node(name).querySelector('video')).filter;
    window.look=name=>{const n=node(name),v=n.querySelector('video'),c=n.querySelector('.mv-card'),big=n.querySelector('.mv-big'),a=c?.querySelector('.mv-art');
      return {selected:n.classList.contains('selected'),playing:n.classList.contains('playing'),dim:getComputedStyle(v??c).filter,
        art:a?getComputedStyle(a).filter:null,big:big?getComputedStyle(big).opacity:null,bigShown:big?getComputedStyle(big).display!=='none':false,
        after:getComputedStyle(n,'::after').content,outline:getComputedStyle(n).outlineStyle,ring:c?getComputedStyle(c).boxShadow:null,
        border:c?getComputedStyle(c).borderTopColor:null,shell:!!n.querySelector('.mv-shell')&&!c,title:!!n.querySelector('.mv-title'),
        controls:n.querySelectorAll(':scope>.mv-shell,:scope>.mv-title,:scope>.mv-pop').length};};`);
  // 一本混排的书：图片、视频（两个字幕）、音频、播不了的媒体、图片、竖的视频、图片。文件名很长，验证中间省略与悬停提示。
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
    await mvMedia.write(dir,'06 tall.webm',await mvMedia.webm({seconds:2,width:180,height:320}));
    await mvMedia.write(dir,'07.svg',svg(600,900,'#345'));
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

  const STEM = '02 a rather long video file name for the file bar';
  const C = (sel) => `document.querySelector('#controlbar [data-id="${sel}"]')`;
  const hover = async (sel) => {
    const [x, y] = await center(sel);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  };
  const away = () => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 120 });
  // 指针进过总控栏后移开，总控栏随之收起：等它收起再按 T 显示（按 T 打开的不随指针收起）。
  const reshow = async () => {
    await wait(() => js('controlbar.hidden'), 'control bar hides after the pointer leaves');
    await showBar();
  };

  // ---- 文件栏在总控栏里三区那一行的上方、同宽，随总控栏显示 / 收起；两行：标题行在上，播放行在下。
  await js(`toPage('01.svg')`);
  await showBar();
  let s = await js('fb()');
  assert.equal(await js('filebar.hidden'), false);
  assert.ok(
    s.row.bottom <= s.zones.top + 1 && Math.abs(s.row.width - s.zones.width) < 1,
    'File bar above the three zones, same width',
  );
  assert.ok(s.head.bottom <= s.line.top + 0.5, 'Title row above the playback row');
  assert.ok(s.nameBox.bottom <= s.line.top + 0.5 && s.playBox.top >= s.head.bottom - 0.5, 'Name on top, play below');
  // 图片：文件名不带扩展名（完整路径在提示），播放行留空，三个按钮位：添加书签、添加区段书签、设置为封面。
  assert.deepEqual([s.name, s.title], ['01', '01.svg']);
  assert.equal(s.mid, false, 'No playback controls for an image');
  assert.deepEqual(s.places, ['bookmark', 'section', 'cover']);
  assert.deepEqual(
    [s.slots.bookmark.label, s.slots.section.label, s.slots.cover.label],
    ['Add bookmark', 'Add section bookmark', 'Set as cover'],
  );
  assert.equal(
    await js(`!!filebar.querySelector('[data-slot="subs"],[data-control="subs"]')`),
    false,
    'No subtitles button here',
  );
  // 添加区段书签用普通颜色（与添加书签相同），不用区段蓝。
  assert.equal(
    await js(`getComputedStyle(filebar.querySelector('[data-slot="section"] .i')).color`),
    await js(`getComputedStyle(filebar.querySelector('[data-slot="bookmark"] .i')).color`),
  );
  const places = s.placeBoxes,
    imageMid = { play: s.playBox, name: s.nameBox };
  await shot('filebar-image');

  // ---- 视窗中心换成视频：文件名只显示末段、不带扩展名，完整路径在提示里；按钮位：书签、区段、「⋯」（设置为封面、全屏），位置与图片时相同。
  await js(`toPage(${JSON.stringify(LONG)})`);
  await wait(() => js(`fb().name===${JSON.stringify(STEM)}`), 'file bar follows the centre page');
  await wait(() => js(`fb().time.endsWith('0:04')`), 'duration');
  s = await js('fb()');
  assert.equal(s.title, LONG);
  assert.equal(await js(`filebar.querySelector('.fb-name .mid-name').textContent`), STEM, 'Full name kept for copying');
  assert.equal(
    await js(`filebar.querySelector('.fb-name .mid-name').innerText.replace(/\\n/g,'')`),
    STEM,
    'Spaces kept where the name is split',
  );
  assert.equal(s.mid, true);
  assert.deepEqual(s.places, ['bookmark', 'section', 'more']);
  assert.deepEqual(s.placeBoxes, places, 'The three places do not move between file types');
  assert.deepEqual([s.playBox, s.nameBox], [imageMid.play, imageMid.name], 'Play button and name keep their places');
  assert.ok(s.bar.width > s.row.width * 0.5, 'The progress bar takes most of the row: ' + s.bar.width);
  assert.equal(s.play, 'Play');
  assert.match(s.time, /^0:00 \/ 0:04$/);
  // 「⋯」悬停即展开，在按钮正上方；里面是设置为封面、全屏。
  await hover('#filebar .fb-more');
  await wait(() => js(`filebar.querySelector('.fb-more-pop').matches(':popover-open')`), 'hover opens ⋯');
  assert.deepEqual(
    await js(
      `(()=>{const p=filebar.querySelector('.fb-more-pop'),r=p.getBoundingClientRect(),b=filebar.querySelector('.fb-more').getBoundingClientRect();return {items:[...p.children].map(c=>c.dataset.slot),above:r.bottom<=b.top&&b.top-r.bottom<=10,over:r.left<=b.left+b.width/2&&r.right>=b.left+b.width/2};})()`,
    ),
    { items: ['cover', 'full'], above: true, over: true },
  );
  await shot('filebar-more');
  await away();
  await wait(() => js(`!filebar.querySelector('.fb-more-pop').matches(':popover-open')`), 'leaving closes ⋯');
  await reshow(); // 指针离开后总控栏随之收起：重新显示
  // 视频画面内没有浮动控件：只有画面、字幕容器和大播放键。
  await delay(300);
  let v = await js(`look(${JSON.stringify(LONG)})`);
  assert.deepEqual([v.shell, v.title, v.controls], [false, false, 0], 'No controls inside the video picture');
  assert.deepEqual(
    await js(`[...node(${JSON.stringify(LONG)}).children].map(c=>c.className||c.tagName.toLowerCase())`),
    ['video', 'mv-subs', 'mv-big', 'mv-fail'],
  );
  // 未选中：压暗 + 大播放键；视窗中心所在的视频是普通的压暗程度。没有强调色外框。
  await wait(() => js(`dimOf(${JSON.stringify(LONG)})==='brightness(0.55)'`), 'centre video: usual dimming');
  v = await js(`look(${JSON.stringify(LONG)})`);
  assert.deepEqual([v.selected, v.big, v.after], [false, '1', 'none']);
  assert.equal(
    await js(`node(${JSON.stringify(LONG)}).classList.contains('mv-center')`),
    true,
    'Marked as the centre video',
  );
  await shot('filebar-video');

  // ---- 字幕按钮在总控栏右区，作用于文件栏显示的媒体：两个字幕时弹出菜单（按总控栏的按钮定位），再点一次收起。
  await wait(() => js(`!${C('subs')}.disabled`), 'subtitle button enabled for the video');
  assert.equal(await js(`${C('subs')}.getAttribute('aria-haspopup')`), 'menu');
  assert.equal(await js(`${C('subs')}.getAttribute('aria-pressed')`), 'true', 'Subtitles on');
  await tap('#controlbar [data-id="subs"]');
  await wait(
    () =>
      js(
        `document.querySelector('.mv-subs-pop').matches(':popover-open')&&${C('subs')}.getAttribute('aria-expanded')==='true'`,
      ),
    'subtitle menu',
  );
  assert.deepEqual(
    await js(
      `(()=>{const m=document.querySelector('.mv-subs-pop'),r=m.getBoundingClientRect(),b=${C('subs')}.getBoundingClientRect();return {items:m.querySelectorAll('button').length,above:r.bottom<=b.top};})()`,
    ),
    { items: 3, above: true },
  );
  await tap('#controlbar [data-id="subs"]');
  await wait(
    () => js(`!document.querySelector('.mv-subs-pop').matches(':popover-open')`),
    'menu closes on a second click',
  );

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
  assert.equal(await js(`fb().name`), STEM, 'Selected media stays the current file');
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
  assert.equal(await js(`fb().name`), STEM);
  // 中线离开视窗：仍是当前曲目（后台播放），文件栏仍显示它；「停止」后取消，文件栏回到视窗中心所在的页。
  await js(`toPage('03 song.wav',0.95)`);
  await delay(300);
  assert.deepEqual(
    await js(`[fb().name,look(${JSON.stringify(LONG)}).selected]`),
    [STEM, true],
    'The track stays selected and in the file bar when its midline leaves',
  );
  await js(`filebar.querySelector('[data-head="stop"]').click()`);
  await wait(() => js(`!look(${JSON.stringify(LONG)}).selected`), 'deselected by Stop');
  await wait(() => js(`fb().name==='03 song'`), 'file bar follows the centre page again');
  // 不在视窗中心的未选中视频压得更暗；悬停时恢复到普通的压暗程度。
  await js(`toPage('03 song.wav')`);
  await wait(() => js(`dimOf(${JSON.stringify(LONG)})==='brightness(0.22)'`), 'off-centre video: darker');
  assert.equal(await js(`node(${JSON.stringify(LONG)}).classList.contains('mv-center')`), false);
  {
    const [x, y] = await js(
      `(()=>{const r=node(${JSON.stringify(LONG)}).getBoundingClientRect();const t=Math.max(r.top,0),b=Math.min(r.bottom,innerHeight);return [r.left+r.width/2,(t+b)/2];})()`,
    );
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await wait(() => js(`dimOf(${JSON.stringify(LONG)})==='brightness(0.55)'`), 'hovered video: usual dimming');
    await shot('filebar-dim-hover');
    await hover('#reader .page[data-name="03 song.wav"]');
    await wait(() => js(`dimOf(${JSON.stringify(LONG)})==='brightness(0.22)'`), 'darker again');
  }
  await reshow();

  // ---- 音频：书签、区段（第三个位留空），位置不变；卡片自己的控件保留并与文件栏同步；卡片上没有字幕按钮；未选中时卡片连同小图压暗（不变）。
  s = await js('fb()');
  assert.deepEqual(s.places, ['bookmark', 'section', null]);
  assert.deepEqual(s.placeBoxes, places, 'The places do not move for audio');
  assert.equal(s.name, '03 song');
  assert.equal(await js(`${C('subs')}.disabled`), true, 'No subtitles for this audio');
  await delay(300);
  let a = await js(`look('03 song.wav')`);
  assert.deepEqual(
    [a.selected, a.dim, a.big, a.bigShown],
    [false, 'brightness(0.55)', '1', true],
    'Unselected card dimmed (with its art)',
  );
  assert.deepEqual(
    await js(`[...node('03 song.wav').querySelectorAll('.mv-card [data-control]')].map(e=>e.dataset.control)`),
    ['bookmark', 'section'],
    'Card buttons: bookmark and section only',
  );
  assert.equal(await js(`node('03 song.wav').querySelector('.mv-head .mid-name').textContent`), '03 song');
  assert.equal(
    await js(`getComputedStyle(node('03 song.wav').querySelector('[data-control="section"] .i')).color`),
    await js(`getComputedStyle(node('03 song.wav').querySelector('[data-control="bookmark"] .i')).color`),
    'Card section button in the normal colour',
  );
  assert.equal(
    await js(`getComputedStyle(node('03 song.wav').querySelector('.mv-bars')).display`),
    'none',
    'No bars while unselected',
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
  // 没有字幕的音频：选中且播放中，字幕区显示阶梯音柱（跳动）；暂停时静止；减少动态效果时静止。
  const bars = () =>
    js(
      `(()=>{const b=node('03 song.wav').querySelector('.mv-bars'),s=node('03 song.wav').querySelector('.mv-subs').getBoundingClientRect(),r=b.getBoundingClientRect(),i=getComputedStyle(b.querySelector('i'));return {shown:getComputedStyle(b).display,anim:i.animationName,inside:r.top>=s.top-.5&&r.bottom<=s.bottom+.5&&r.height>30,n:b.children.length};})()`,
    );
  assert.deepEqual(await bars(), { shown: 'flex', anim: 'mv-bars', inside: true, n: 24 });
  await shot('filebar-audio');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal((await bars()).anim, 'none', 'Reduced motion: still');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  await tap('#reader .page[data-name="03 song.wav"] .mv-card .mv-play');
  await wait(() => js(`fb().play==='Play'`), 'file bar follows the card');
  assert.equal(await js(`getComputedStyle(node('03 song.wav').querySelector('.mv-eq')).display`), 'none');
  assert.equal(await js(`look('03 song.wav').selected`), true);
  assert.deepEqual(await bars(), { shown: 'flex', anim: 'none', inside: true, n: 24 }, 'Paused: still bars');

  // ---- 时间处：悬停原位换成快退 / 快进（宽度不变）；点按一次 2 秒，长按按长按 A / D 的步长递增，显示同样的提示浮层。
  {
    const audio = `el('03 song.wav')`;
    await reshow(); // 指针在卡片上：总控栏收起，重新显示
    await js(`${audio}.currentTime=1`);
    await wait(() => js(`fb().time.startsWith('0:01')`), 'at 0:01');
    const before = await js(`box(filebar.querySelector('.fb-time'))`);
    assert.equal(await js(`getComputedStyle(filebar.querySelector('.fb-time .mv-steps')).opacity`), '0');
    await hover('#filebar .fb-time');
    await wait(
      () =>
        js(
          `getComputedStyle(filebar.querySelector('.fb-time .mv-steps')).opacity==='1'&&getComputedStyle(filebar.querySelector('.fb-time .mv-clock')).visibility==='hidden'`,
        ),
      'buttons replace the time on hover',
    );
    assert.deepEqual(await js(`box(filebar.querySelector('.fb-time'))`), before, 'Same box');
    assert.deepEqual(
      await js(
        `[...filebar.querySelectorAll('.fb-time .mv-step')].map(b=>{const r=b.getBoundingClientRect(),t=filebar.querySelector('.fb-time').getBoundingClientRect();return [b.getAttribute('aria-label'),r.left>=t.left-.5&&r.right<=t.right+.5];})`,
      ),
      [
        ['Rewind', true],
        ['Fast-forward', true],
      ],
    );
    await shot('filebar-time-buttons');
    await tap('#filebar .fb-time .mv-step[data-d="1"]');
    await wait(() => js(`Math.abs(${audio}.currentTime-3)<0.05`), 'a click: +2 s');
    assert.match(
      await js(`document.querySelector('.mv-hud .mv-hud-text').textContent`),
      /^\+0:02 → 0:03$/,
      'Same hint',
    );
    await tap('#filebar .fb-time .mv-step[data-d="-1"]');
    await wait(() => js(`Math.abs(${audio}.currentTime-1)<0.05`), 'a click: −2 s');
    // 长按：按下立即走 2 秒，之后每 250 毫秒再走一步（与长按 A / D 一致）。
    const [x, y] = await center('#filebar .fb-time .mv-step[data-d="1"]');
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
    await delay(620);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
    const held = await js(`${audio}.currentTime`);
    assert.ok(held >= 6.9 && held <= 9, 'Holding keeps seeking: ' + held);
    assert.equal(await js(`!document.querySelector('.mv-hud').hidden`), true, 'Hint while holding');
    await wait(() => js(`document.querySelector('.mv-hud').hidden`), 'hint hides after release');
    // 键盘：聚焦按钮同样换出按钮；不带指针的点击（键盘激活、click()）每次 2 秒。
    await away();
    await reshow();
    await js(`${audio}.currentTime=1`);
    await key('Shift', 'ShiftLeft', 16);
    await js(`filebar.querySelector('.fb-time .mv-step[data-d="1"]').focus()`);
    assert.equal(
      await js(`getComputedStyle(filebar.querySelector('.fb-time .mv-steps')).opacity`),
      '1',
      'Focus shows them too',
    );
    await js(`filebar.querySelector('.fb-time .mv-step[data-d="1"]').click()`);
    await wait(() => js(`Math.abs(${audio}.currentTime-3)<0.05`), 'keyboard click: +2 s');
    await js('reader.focus()');
  }

  // ---- 播放不了的媒体：没有大播放键，文件栏的播放键变灰。
  // 当前曲目离开视窗后仍在文件栏：先停止它，文件栏才回到视窗中心的文件。
  await js(`document.querySelector('#filebar [data-head="stop"]').click()`);
  await js(`toPage('04 broken.mp4',0.9)`);
  await wait(() => js(`node('04 broken.mp4').classList.contains('mv-failed')`), 'broken media fails');
  await wait(() => js(`fb().name==='04 broken'`), 'file bar on the broken media');
  assert.equal((await js(`look('04 broken.mp4')`)).bigShown, false, 'No big play button on an unplayable media');
  s = await js('fb()');
  assert.deepEqual([s.playOff, s.slots.bookmark.disabled, s.slots.full.disabled], [true, true, true]);

  // ---- 设置为封面：图片取视窗中心处。
  await js(`toPage('05.svg')`);
  await wait(() => js(`fb().name==='05'`));
  await tap('#filebar [data-slot="cover"]');
  await wait(
    () => js(`import('./src/reader/session.mjs').then(s=>!!s.current.customCover)`),
    'cover set from the file bar',
  );

  // ---- 单击 F 跳到书签：该媒体成为选中媒体（自动播放关闭时停在书签处），文件栏随之换成它。
  await key('f', 'KeyF', 70);
  await wait(
    () => js(`look(${JSON.stringify(LONG)}).selected&&fb().name===${JSON.stringify(STEM)}`),
    'bookmark jump selects the media',
  );
  assert.equal(await js(`el(${JSON.stringify(LONG)}).paused`), true);

  // ---- 视频全屏：页面全屏、视频铺满窗口，底缘弹出文件栏 + 总控栏；退出回到原来的阅读位置。
  // 无头浏览器不允许真正进入全屏：替换成立即生效的模拟（只验证请求全屏的对象与页面的反应）。
  await js(`(()=>{let fs=null;Object.defineProperty(Document.prototype,'fullscreenElement',{get:()=>fs,configurable:true});
    const change=()=>document.dispatchEvent(new Event('fullscreenchange'));
    Element.prototype.requestFullscreen=function(){fs=this;window.fsCalls=(window.fsCalls||0)+1;setTimeout(change);return Promise.resolve();};
    Document.prototype.exitFullscreen=function(){fs=null;setTimeout(change);return Promise.resolve();};})()`);
  // 全屏的画面：铺满窗口、画面居中，窗口里任何一处都是这个视频（不混入其他页），只有工具栏、文件栏与总控栏（按 T 显示的）在上层。
  const fullView = (name) =>
    js(`(()=>{const n=node(${JSON.stringify(name)}),r=n.getBoundingClientRect(),v=n.querySelector('video').getBoundingClientRect(),c=controlbar.getBoundingClientRect();
    const hit=document.elementFromPoint(c.left+c.width/2,c.top+10),pts=[];for(const fx of [0.01,0.25,0.5,0.75,0.99])for(const fy of [0.01,0.5,0.99])pts.push([fx*innerWidth,fy*innerHeight]);
    const bad=pts.filter(([x,y])=>{const e=document.elementFromPoint(x,y);return !(n.contains(e)||controlbar.contains(e)||!!e?.closest('#toolbar'));}),ok=pts.length-bad.length,miss=bad.map(([x,y])=>{const e=document.elementFromPoint(x,y);return Math.round(x)+','+Math.round(y)+':'+(e?.id||e?.className||e?.tagName);});
    return {r:[r.left,r.top,r.width,r.height],win:[innerWidth,innerHeight],centre:[Math.round(v.left+v.width/2),Math.round(v.top+v.height/2)],bar:controlbar.contains(hit),covered:ok+'/'+pts.length,miss,selected:n.classList.contains('selected'),label:filebar.querySelector('[data-slot="full"]').getAttribute('aria-label')};})()`);
  const enterFull = async (name) => {
    await js(`document.querySelector('#filebar [data-head="stop"]').click()`); // 上一个全屏的视频仍是当前曲目，文件栏显示它：先停止
    await js(`toPage(${JSON.stringify(name)})`);
    await wait(
      () =>
        js(
          `fb().name===${JSON.stringify(name.replace(/\.[^.]+$/, ''))}&&!!el(${JSON.stringify(name)})&&el(${JSON.stringify(name)}).readyState>=1`,
        ),
      'video ready: ' + name,
    );
    const top = await js('reader.scrollTop');
    await hover('#filebar .fb-more');
    await wait(() => js(`filebar.querySelector('.fb-more-pop').matches(':popover-open')`), '⋯ for fullscreen');
    await tap('#filebar [data-slot="full"]');
    await wait(
      () =>
        js(
          `document.fullscreenElement===document.documentElement&&node(${JSON.stringify(name)}).classList.contains('mv-full')`,
        ),
      'fullscreen ' + name,
    );
    await js('frame().then(frame)');
    return top;
  };
  const leaveFull = async (name, top) => {
    await hover('#filebar .fb-more');
    await wait(() => js(`filebar.querySelector('.fb-more-pop').matches(':popover-open')`), '⋯ to leave');
    await tap('#filebar [data-slot="full"]');
    await wait(
      () => js(`!document.fullscreenElement&&!node(${JSON.stringify(name)}).classList.contains('mv-full')`),
      'leaves fullscreen',
    );
    await wait(() => js(`Math.abs(reader.scrollTop-${top})<1`), 'back at the same reading position');
  };
  let top0 = await enterFull(LONG);
  let full = await fullView(LONG);
  assert.deepEqual(full.r, [0, 0, full.win[0], full.win[1]], 'Video fills the window');
  assert.deepEqual(full.centre, [full.win[0] / 2, full.win[1] / 2], 'Picture centred');
  assert.equal(full.covered, '15/15', 'Nothing of the other pages shows: ' + JSON.stringify(full));
  assert.equal(full.bar, true, 'File bar and control bar above the video');
  assert.equal(full.selected, true, 'The fullscreen video is the selected media');
  assert.equal(full.label, 'Exit fullscreen');
  await shot('filebar-fullscreen');
  await leaveFull(LONG, top0);
  // 竖的视频（正文里有宽度上限）、缩略图栏常驻（阅读区变窄）时同样居中铺满，旁边的页和其他视频不出现在画面里。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`document.body.classList.contains('docked')`), 'thumbnails docked');
  top0 = await enterFull('06 tall.webm');
  full = await fullView('06 tall.webm');
  assert.deepEqual(full.r, [0, 0, full.win[0], full.win[1]], 'Tall video fills the window: ' + JSON.stringify(full));
  assert.deepEqual(full.centre, [full.win[0] / 2, full.win[1] / 2], 'Tall picture centred: ' + JSON.stringify(full));
  assert.equal(full.covered, '15/15', 'Nothing beside the tall video: ' + JSON.stringify(full));
  await shot('filebar-fullscreen-tall');
  await leaveFull('06 tall.webm', top0);
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`!document.body.classList.contains('docked')`), 'thumbnails undocked');

  // ---- 各宽度下不溢出：标题行先缩短文件名（中间省略），播放行由进度条让出宽度；三个按钮位始终都在。
  await js(`document.querySelector('#filebar [data-head="stop"]').click()`);
  await js(`toPage(${JSON.stringify(LONG)})`);
  await wait(() => js(`fb().name===${JSON.stringify(STEM)}`));
  const widths = [1280, 900, 700, 560, 420, 360];
  for (const w of widths) {
    await size(w);
    await wait(() => js(`innerWidth===${w}`));
    await js('frame().then(frame)');
    s = await js('fb()');
    const items = await js(
      `[...filebar.querySelectorAll('.fb-name,.fb-play,.mv-bar,.fb-time,.fb-tools>*')].filter(e=>getComputedStyle(e).visibility!=='hidden'&&e.offsetParent).map(e=>box(e))`,
    );
    assert.ok(s.scroll[0] <= s.scroll[1], w + ': no horizontal overflow');
    for (const it of items)
      assert.ok(it.left >= s.row.left - 0.5 && it.right <= s.row.right + 0.5, w + ': inside the file bar');
    assert.ok(s.row.height <= 76, w + ': two rows high (' + s.row.height + ')');
    assert.ok(s.bar.width >= 40, w + ': progress keeps a minimum width');
    assert.deepEqual(s.places, ['bookmark', 'section', 'more'], w + ': the three places');
    // 放不下时文件名中间省略（结尾保留），不推动其他元素。
    assert.ok(
      await js(
        `(()=>{const n=filebar.querySelector('.fb-name .mid-name'),h=n.firstElementChild;return n.getBoundingClientRect().right<=filebar.querySelector('.fb-name').getBoundingClientRect().right+.5&&(h.scrollWidth<=h.clientWidth||n.lastChild.textContent.length>0);})()`,
      ),
      w + ': name inside its row',
    );
    await shot('filebar-' + w);
  }
  await size(1280);

  // ---- 标题行右端的按钮区（ctx.fileBar.addHead）：「定位」「停止」（按 order 排列，同时可用或禁用）；与文件名同在一行。
  await showBar();
  assert.deepEqual(
    await js(
      `(()=>{const h=filebar.querySelector('.fb-head-tools'),r=h.getBoundingClientRect(),n=filebar.querySelector('.fb-name').getBoundingClientRect();return [h.parentElement.matches('.fb-head'),h.previousElementSibling.matches('.fb-name'),[...h.children].map(b=>b.dataset.head+':'+b.getAttribute('aria-label')),h.children[0].disabled===h.children[1].disabled,Math.abs((r.top+r.bottom)/2-(n.top+n.bottom)/2)<2,r.right<=filebar.getBoundingClientRect().right];})()`,
    ),
    [true, true, ['locate:Locate', 'stop:Stop'], true, true, true],
  );

  // ---- 不显示时不更新：收起后时间不再跟着走，显示时立即取当前值。
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
    'PASS: file bar above the control bar zones in two rows (title without extension, full path in tooltip; playback row with a wide progress bar), three fixed places (image: bookmark / section / cover; video: bookmark / section / ⋯ with cover and fullscreen on hover; audio: bookmark / section), section button in the normal colour, subtitles button in the control bar for the shown media, current file = selected media else the centre page, bookmark from the file bar and hold D on the selected media, dimming (off-centre videos darker, centre / hovered videos as before, selected not dimmed), stepped bars for audio without subtitles (playing / paused / reduced motion), rewind / fast-forward on the time (click 2 s, hold like A / D, keyboard), unplayable media, set as cover, bookmark jump selects, video fullscreen centred and covering the window (also a tall video with docked thumbnails) and back to the reading position, no overflow at 1280–360px, no updates while hidden',
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
