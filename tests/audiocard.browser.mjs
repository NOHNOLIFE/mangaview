// 音频播放面板的卡片：纯色底，右侧方形小图是书的封面（没有封面时为按文件名配色的浅色占位图），封面更换后跟着变；
// 缩略图栏、书签面板里的音频用同一张图；书签面板顶部按钮与「设置为封面」；不论有无封面，未选中的卡片连同小图压暗、选中的不压暗也不描边。独立临时配置 + OPFS 测试数据，音频由 tests/media-fixtures.mjs 现场生成。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/audiocard.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-audiocard-'));
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
  const click = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x, y });
  };
  const tap = async (sel) => {
    const [x, y] = await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
    );
    await click(x, y);
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','false');`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  // 页面里的工具：卡片与音频的图（art）的状态、位置，以及颜色的亮度。
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.card=name=>node(name)?.querySelector('.mv-card');
    window.art=name=>card(name)?.querySelector(':scope>.mv-art');
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    const nums=s=>(s.match(/[\\d.]+/g)||[]).map(Number);
    window.lum=([r,g,b])=>{const f=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
    window.box=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    window.artLook=el=>{const s=getComputedStyle(el),note=el.querySelector(':scope>.mv-note'),stops=[...s.backgroundImage.matchAll(/rgba?\\(([^)]*)\\)/g)].map(m=>lum(nums(m[1])));
      return {cover:el.classList.contains('has-cover'),url:el.style.getPropertyValue('--cover'),image:s.backgroundImage,light:stops.length?Math.min(...stops):null,
        note:note?getComputedStyle(note).display:null,hue:el.style.getPropertyValue('--art-h'),filter:s.filter,opacity:s.opacity,
        icons:[...el.children].filter(c=>c.matches('svg.i')).length};};
    window.look=name=>{const k=card(name),s=getComputedStyle(k),n=node(name);
      return {playing:n.classList.contains('playing'),selected:n.classList.contains('selected'),dim:s.filter,big:getComputedStyle(n.querySelector('.mv-big')).opacity,art:artLook(art(name)),
        image:s.backgroundImage,color:s.backgroundColor,border:s.borderTopColor,ring:s.boxShadow,eq:getComputedStyle(k.querySelector('.mv-eq')).display,
        play:getComputedStyle(k.querySelector('.mv-play')).backgroundColor,fill:getComputedStyle(k.querySelector('.mv-fill')).backgroundColor};};
    window.parts=name=>{const k=card(name);return {node:box(node(name)),card:box(k),art:box(art(name)),head:box(k.querySelector('.mv-head')),
      subs:box(k.querySelector('.mv-subs')),shell:box(k.querySelector('.mv-shell')),border:parseFloat(getComputedStyle(k).borderTopWidth)};};
    window.coverPixel=async id=>{const {getThumb}=await import('./src/reader/thumbs.mjs'),th=await getThumb(id+':custom'),bmp=await createImageBitmap(await (await fetch(th.url)).blob());
      const c=new OffscreenCanvas(1,1),g=c.getContext('2d');g.drawImage(bmp,bmp.width/2,bmp.height/2,1,1,0,0,1,1);return [...g.getImageData(0,0,1,1).data.slice(0,3)];};`;
  await js(helpers);
  const store = `import('./src/core/store.mjs')`;
  const record = (title) =>
    js(`${store}.then(async({library})=>(await library('getAll')).find(b=>b.title===${JSON.stringify(title)}))`);
  const songs = ['02 a.wav', '03 b.wav', '04 c.wav'];
  const lookAll = async () =>
    Object.fromEntries(await Promise.all(songs.map(async (n) => [n, await js(`look(${JSON.stringify(n)})`)])));
  const accent = 'rgb(255, 122, 89)';
  const near = (a, b, d = 1) => Math.abs(a - b) <= d;
  // 选中（播放中）的卡片：不压暗、没有大播放键、不描边，播放中只多了音柱和强调色的进度条；未选中的两张压暗（连同小图）并显示大播放键。
  // 卡片底色、边框不因播放或选中改变；播放键只换图标。
  async function playOne() {
    await js(`toPage('03 b.wav')`);
    await tap('#reader .page[data-name="03 b.wav"] .mv-play');
    await wait(() => js(`node('03 b.wav').classList.contains('playing')`), 'playing');
    await delay(400); // 等过渡结束
    const all = await lookAll(),
      on = all['03 b.wav'];
    assert.deepEqual(
      [on.playing, on.selected, on.dim, on.big, on.eq, on.fill, on.image, on.ring],
      [true, true, 'none', '0', 'flex', accent, 'none', 'none'],
      JSON.stringify(on),
    );
    assert.notEqual(on.play, accent, 'The play button only changes its icon');
    for (const n of ['02 a.wav', '04 c.wav']) {
      const o = all[n];
      assert.deepEqual(
        [o.playing, o.selected, o.dim, o.big, o.eq, o.ring, o.image],
        [false, false, 'brightness(0.55)', '1', 'none', 'none', 'none'],
        n,
      );
      assert.notEqual(o.fill, accent);
      assert.equal(o.border, on.border, 'No accent border');
      assert.equal(o.color, on.color, 'Same background');
    }
    return all;
  }
  async function stop() {
    await tap('#reader .page[data-name="03 b.wav"] .mv-play');
    await wait(() => js(`!node('03 b.wav').classList.contains('playing')`), 'stopped');
  }
  // 卡片排版：纯色底；右侧方形小图与「文件名行 + 字幕区」等高；壳占满整行；卡片高度、3 行字幕区不变。
  async function layout(name) {
    const p = await js(`parts(${JSON.stringify(name)})`),
      pad = 14 + p.border;
    assert.ok(near(p.card.height, p.node.height - 16), 'Card height unchanged: ' + JSON.stringify(p));
    assert.ok(near(p.subs.height, 66), 'Three subtitle lines');
    assert.ok(near(p.art.width, p.art.height) && near(p.art.width, 94), 'Square picture: ' + JSON.stringify(p.art));
    assert.ok(near(p.art.right, p.card.right - pad), 'Picture on the right');
    assert.ok(
      near(p.art.top, p.head.top) && near(p.art.bottom, p.subs.bottom),
      'As tall as the name row and subtitles',
    );
    assert.ok(p.head.right <= p.art.left - 8 && p.subs.right <= p.art.left - 8, 'Text keeps clear of the picture');
    assert.ok(near(p.shell.left, p.head.left) && near(p.shell.right, p.card.right - pad), 'Controls span the card');
    assert.ok(p.shell.top >= p.art.bottom, 'Controls below the picture');
  }
  const menuAt = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp('Input.dispatchMouseEvent', { type, button: 'right', clickCount: 1, x, y });
    await wait(() => js(`!document.querySelector('.bm-panel').hidden`), 'panel');
    await delay(250); // 等弹出动画（缩放）结束
  };
  const closePanel = async () => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(() => js(`document.querySelector('.bm-panel').hidden`), 'panel closed');
  };

  // ---- 有封面的书：第一张图是白色，三段音频并排，第五张图（红色）供设封面，然后是一段视频（之后再有一张图，视频才能滚到视窗中央）。
  const svg = (c) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="${c}"/></svg>`;
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Album',{create:true});
    await mvMedia.write(dir,'01.svg',new Blob([${JSON.stringify(svg('#fff'))}],{type:'image/svg+xml'}));
    for(const n of ${JSON.stringify(songs)})await mvMedia.write(dir,n,mvMedia.wav({seconds:6}));
    await mvMedia.write(dir,'05.svg',new Blob([${JSON.stringify(svg('#c33'))}],{type:'image/svg+xml'}));
    await mvMedia.write(dir,'06 v.webm',await mvMedia.webm({seconds:1.5,width:320,height:180}));
    await mvMedia.write(dir,'07.svg',new Blob([${JSON.stringify(svg('#fff'))}],{type:'image/svg+xml'}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();
    await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Album'`), 'album');
  // 默认封面在后台生成：已经显示的卡片在封面生成后换上小图（'cover' 事件）。
  await js(`toPage('03 b.wav')`);
  await wait(() => js(`art('03 b.wav')?.classList.contains('has-cover')`), 'default cover');
  const album = await record('Album');
  // 书签：第五张图（供「设置封面」选用，缩略图按测试图生成），以及 03 b.wav 里 2 秒处的音频书签。
  await js(`${store}.then(async({library,thumbs})=>{const b=(await library('getAll')).find(b=>b.title==='Album');
    b.bookmarks=[{id:'m1',name:'05.svg',f:.5,at:1},{id:'m2',name:'03 b.wav',t:2,at:2,label:'03 b-Bookmark1'}];await library('put',b);
    const {makeThumb}=await import('./src/reader/thumbs.mjs'),dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Album');
    const th=await makeThumb(await (await dir.getFileHandle('05.svg')).getFile(),{width:240});await thumbs('put',{blob:th.blob,w:th.w,h:th.h},${JSON.stringify(album.id)}+':bm:m1');})`);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Album'&&!!document.querySelector('#reader .page')`), 'reloaded');
  await js(MEDIA_FIXTURES);
  await js(helpers);
  await js(`toPage('03 b.wav')`);
  await wait(() => js(`${JSON.stringify(songs)}.every(n=>art(n)?.classList.contains('has-cover'))`), 'covers');
  const before = await lookAll();
  for (const [n, o] of Object.entries(before)) {
    assert.match(o.art.url, /^url\("blob:/, n);
    assert.match(o.art.image, /^url\("blob:/, 'The cover itself, not dimmed: ' + o.art.image);
    assert.deepEqual([o.art.note, o.image], ['none', 'none'], 'No note over a cover; plain card: ' + n);
  }
  await layout('03 b.wav');
  await playOne();
  await shot('audiocard-cover');
  await stop();

  // 缩略图栏里的音频与音频书签同一种样子：整块是封面，没有大图标和遮罩；小音乐图标 + 时长在右下（名称条之上），文件名在最下的名称条上。
  const stripTile = `document.querySelector('#preview .page[data-name="03 b.wav"] .mv-tile.audio')`;
  await js(`document.querySelector('[data-act="preview"]').click()`); // 固定显示缩略图栏
  await wait(() => js(`${stripTile}?.classList.contains('has-cover')`), 'strip tile cover');
  const strip =
    await js(`(t=>({look:artLook(t),tile:box(t),badge:box(t.querySelector('.mv-badge')),badgeIcon:t.querySelector('.mv-badge use').getAttribute('href'),
    name:box(t.querySelector('.mid-name')),nameText:t.querySelector('.mid-name').textContent}))(${stripTile})`);
  assert.match(strip.look.image, /^url\("blob:/, 'Strip tile shows the cover: ' + strip.look.image);
  assert.deepEqual(
    [strip.look.icons, strip.look.note, strip.badgeIcon, strip.nameText],
    [0, 'none', '#i-music', '03 b.wav'],
  );
  assert.ok(
    near(strip.badge.right, strip.tile.right - 4) && near(strip.badge.bottom, strip.name.top - 4),
    'Type and duration at the bottom right, above the name: ' + JSON.stringify(strip),
  );
  assert.ok(near(strip.name.bottom, strip.tile.bottom) && strip.name.top > strip.badge.bottom, 'Name at the bottom');
  // 截图：指针移到缩略图栏上（专注模式下侧栏悬停才显示内容）。
  await js(`${stripTile}.scrollIntoView({block:'center'})`);
  const st = await js(`box(${stripTile})`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: st.left + st.width / 2, y: st.top + st.height / 2 });
  await delay(700);
  await shot('audiocard-strip');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 450 });

  // 书签面板里的音频书签：显示封面，不压暗、没有大图标；右下角仍是小音乐图标 + 时间。
  await menuAt(400, 300);
  const audioMark = `document.querySelector('.bm-panel .bm-item[data-id="m2"] .bm-thumb')`;
  await wait(
    () => js(`${audioMark}?.querySelector('.bm-ph.audio')?.classList.contains('has-cover')`),
    'audio bookmark cover',
  );
  const mark =
    await js(`(t=>({look:artLook(t.querySelector('.bm-ph')),thumb:box(t),badge:box(t.querySelector('.bm-type')),
    icon:t.querySelector('.bm-type use').getAttribute('href'),time:t.querySelector('.bm-type span').textContent}))(${audioMark})`);
  assert.match(mark.look.image, /^url\("blob:/);
  assert.deepEqual([mark.look.icons, mark.look.note, mark.look.filter, mark.look.opacity], [0, 'none', 'none', '1']);
  assert.deepEqual([mark.icon, mark.time], ['#i-music', '0:02']);
  assert.ok(
    near(mark.badge.right, mark.thumb.right - 4, 2) && mark.badge.bottom <= mark.thumb.bottom,
    'Badge bottom right',
  );
  // 面板顶部：「添加书签」「添加区段书签」两个等大的图标按钮在一行，右边是小的「设置为封面」；「添加书签」正好在鼠标下。
  const top = await js(
    `[...document.querySelectorAll('.bm-top button')].map(b=>({...box(b),text:b.textContent,label:b.getAttribute('aria-label'),disabled:b.disabled}))`,
  );
  assert.deepEqual(
    top.map((b) => [b.text, b.label]),
    [
      ['', 'Add bookmark'],
      ['', 'Add section bookmark'],
      ['', 'Set as cover'],
    ],
  );
  const [addB, secB, coverB] = top;
  assert.ok(
    near(addB.left + addB.width / 2, 400) && near(addB.top + addB.height / 2, 300),
    'Add bookmark under the cursor',
  );
  assert.ok(
    near(addB.width, secB.width) && near(addB.height, secB.height) && near(addB.top, secB.top),
    'Same size, one row',
  );
  assert.ok(addB.height >= 36 && addB.height <= 44, 'Medium buttons: ' + addB.height);
  assert.ok(
    coverB.width < addB.width && coverB.height < addB.height && coverB.left > secB.right,
    'Small cover button beside',
  );
  // 视窗中心是音频：没有画面可作封面，按钮禁用。
  assert.equal(coverB.disabled, true, 'No cover from audio');
  await shot('audiocard-panel');
  await closePanel();

  // 换封面（书架卡片「更多」→「设置封面」）：已显示的卡片小图跟着换，不必重建。
  await js(`window.__art=art('03 b.wav');0`);
  await js(`barTitle.click()`);
  await wait(() => js('shelf.open'), 'shelf');
  await wait(() => js(`!!document.querySelector('#books .book .actions .more')`), 'more button');
  await js(
    `document.querySelector('#books .book .actions .more').click();[...cardMenu.querySelectorAll('[role=menuitem]')].find(x=>x.textContent==='Set cover').click()`,
  );
  await wait(
    () => js(`document.querySelector('.cover-pick')?.open&&!!document.querySelector('.cover-pick .cp-item')`),
    'picker',
  );
  // 音频书签不能选作封面：只列出图片书签。
  assert.equal(await js(`document.querySelectorAll('.cover-pick .cp-item').length`), 1);
  await js(`document.querySelector('.cover-pick .cp-item').click()`);
  await wait(async () => !!(await record('Album')).customCover, 'custom cover saved');
  const customUrl = () =>
    js(
      `import('./src/reader/thumbs.mjs').then(async({getThumb})=>(await getThumb(${JSON.stringify(album.id + ':custom')})).url)`,
    );
  const custom = await customUrl();
  await wait(
    async () => (await js(`art('03 b.wav').style.getPropertyValue('--cover')`)).includes(custom),
    'art follows',
  );
  assert.equal(await js(`window.__art===art('03 b.wav')`), true, 'The same picture, updated in place');
  for (const n of songs)
    assert.ok((await js(`art(${JSON.stringify(n)}).style.getPropertyValue('--cover')`)).includes(custom), n);
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));

  // 「设置为封面」（书签面板的小按钮）：不用书签，直接以当前画面作封面，完成后提示。图片：视窗中心处按封面比例截取。
  const setHere = async () => {
    const was = (await record('Album')).customCover.at;
    await menuAt(400, 300);
    assert.equal(await js(`document.querySelector('.bm-cover').disabled`), false);
    await tap('.bm-cover');
    await wait(async () => (await record('Album')).customCover.at !== was, 'cover set from the view');
    await wait(() => js(`document.querySelector('.bm-panel').hidden`), 'panel closes');
    await wait(() => js(`document.getElementById('notice').textContent==='Cover set'`), 'notice');
    return (await record('Album')).customCover;
  };
  await js(`toPage('05.svg')`);
  let cc = await setHere();
  assert.equal(cc.bm, null, 'Not from a bookmark');
  assert.ok(near(cc.r, 1.42, 0.01), 'Cover proportions: ' + cc.r);
  const red = await js(`coverPixel(${JSON.stringify(album.id)})`);
  assert.ok(red[0] > 150 && red[1] < 90 && red[2] < 90, 'Taken from the page in the middle: ' + red);
  const fromImage = await customUrl();
  assert.notEqual(fromImage, custom);
  // 视频：取它的当前帧（画面比例是视频的，不按封面比例裁切）。
  await js(`toPage('06 v.webm')`);
  cc = await setHere();
  assert.ok(near(cc.r, 180 / 320, 0.02), 'Video frame: ' + cc.r);
  const fromVideo = await customUrl();
  assert.notEqual(fromVideo, fromImage);
  // 音频的图随 'cover' 事件更新。
  await js(`toPage('03 b.wav')`);
  await wait(
    async () => (await js(`art('03 b.wav').style.getPropertyValue('--cover')`)).includes(fromVideo),
    'follows',
  );

  // ---- 没有封面的书（只有音频，文字封面）：浅色占位图（按文件名配色，同名同色），播放中照样一眼可辨。
  const albumHue = await js(`art('02 a.wav').style.getPropertyValue('--art-h')`);
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Tunes',{create:true});
    for(const n of ${JSON.stringify(songs)})await mvMedia.write(dir,n,mvMedia.wav({seconds:6}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#bar [data-act="folder"]').click();
    await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Tunes'`), 'tunes');
  await wait(async () => !!(await record('Tunes'))?.fp?.text, 'text cover');
  await js(`toPage('03 b.wav')`);
  await delay(300);
  const plain = await lookAll();
  for (const [n, o] of Object.entries(plain)) {
    assert.deepEqual([o.art.cover, o.art.note, o.image], [false, 'block', 'none'], n);
    assert.match(o.art.image, /^linear-gradient\(/, n);
    assert.ok(o.art.light > 0.4, 'A light placeholder: ' + o.art.light);
  }
  assert.equal(new Set(Object.values(plain).map((o) => o.art.hue)).size, 3, 'Each file its own colour');
  assert.equal(plain['02 a.wav'].art.hue, albumHue, 'Same file name, same colour');
  await layout('03 b.wav');
  const plainStrip = await js(`artLook(${stripTile})`);
  assert.deepEqual([plainStrip.cover, plainStrip.note, plainStrip.icons], [false, 'block', 0]);
  assert.equal(plainStrip.hue, plain['03 b.wav'].art.hue, 'The strip tile uses the same placeholder');
  await playOne();
  await shot('audiocard-plain');
  {
    await js(`${stripTile}.scrollIntoView({block:'center'})`);
    const st = await js(`box(${stripTile})`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: st.left + st.width / 2, y: st.top + st.height / 2 });
    await delay(700);
    await shot('audiocard-plain-strip');
  }
  // 全屏缩略图里的音频：同一张占位图，小音乐图标在右下（名称条之上），文件名在最下。
  await js('reader.focus()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
  const ovTile = 'document.querySelector(\'#overview .ov-item[data-i="1"] .mv-tile.audio\')';
  await wait(() => js(`overview.open&&!!${ovTile}`), 'full-screen thumbnails');
  await delay(300);
  const ov = await js(
    `(t=>({look:artLook(t),tile:box(t),badge:box(t.querySelector('.mv-badge')),name:box(t.querySelector('.mid-name'))}))(${ovTile})`,
  );
  assert.deepEqual(
    [ov.look.cover, ov.look.note, ov.look.icons, ov.look.hue],
    [false, 'block', 0, plain['03 b.wav'].art.hue],
  );
  assert.ok(
    near(ov.badge.right, ov.tile.right - 4) &&
      near(ov.badge.bottom, ov.name.top - 4) &&
      near(ov.name.bottom, ov.tile.bottom),
    JSON.stringify(ov),
  );
  // 当前页的页码在文件名条上方，不盖住文件名。
  const ovN = await js(`box(document.querySelector('#overview .ov-item.here > .ov-n'))`),
    ovName = await js(`box(document.querySelector('#overview .ov-item.here .mid-name'))`);
  assert.ok(ovN.bottom <= ovName.top + 0.5, 'Page number above the name: ' + JSON.stringify([ovN, ovName]));
  await shot('audiocard-overview');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(() => js('!overview.open'), 'overview closed');
  // 播放中从书签面板添加书签（当前播放时间）：音频书签同样是占位图。
  await menuAt(400, 300);
  await tap('.bm-add');
  await wait(() => js(`!!document.querySelector('.bm-panel .bm-item .bm-ph.audio')`), 'audio bookmark');
  const plainMark = await js(`artLook(document.querySelector('.bm-panel .bm-item .bm-ph.audio'))`);
  assert.deepEqual(
    [plainMark.cover, plainMark.note, plainMark.icons, plainMark.hue],
    [false, 'block', 0, plain['03 b.wav'].art.hue],
  );
  assert.match(plainMark.image, /^linear-gradient\(/);
  await shot('audiocard-plain-panel');
  await closePanel();
  await stop();

  assert.deepEqual(errors, []);
  console.log(
    'PASS: audio card on a plain background with the cover (or a light per-file placeholder) as a square picture on the right; strip tiles and audio bookmarks show the same picture without an icon or dimming; the bookmark panel top has two icon buttons and a small set-as-cover button; set as cover takes the picture in the middle (image crop, video frame, disabled on audio); pictures follow cover changes in place; the selected card is not dimmed and has no outline, unselected cards are dimmed with their pictures and show a big play button',
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
