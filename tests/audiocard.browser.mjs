// 音频播放面板的卡片：书有封面时以压暗的封面作背景（封面上文字的对比度、封面更换后跟着变）、
// 没有封面时为原样式，以及不论有无封面，播放中的卡片都一眼可辨。独立临时配置 + OPFS 测试数据，音频由 tests/media-fixtures.mjs 现场生成。
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
  // 页面里的工具：卡片的状态，以及按「背后是白色」的最坏情况算封面上文字的对比度（压暗层叠在白色上，再与文字颜色比）。
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.card=name=>node(name)?.querySelector('.mv-card');
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    const nums=s=>(s.match(/[\\d.]+/g)||[]).map(Number);
    const lum=([r,g,b])=>{const f=c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
    window.look=name=>{const k=card(name),s=getComputedStyle(k),n=node(name),m=/linear-gradient\\(rgba\\(([^)]*)\\)/.exec(s.backgroundImage);
      let contrast=null,dim=null;
      if(m){const [r,g,b,a]=nums(m[1]);dim=a;const bg=lum([r,g,b].map(c=>a*c+(1-a)*255));
        contrast=Math.min(...[k.querySelector('.mv-head .mid-name'),k.querySelector('.mv-time')].map(e=>{const L=lum(nums(getComputedStyle(e).color));return (Math.max(L,bg)+.05)/(Math.min(L,bg)+.05);}));}
      return {playing:n.classList.contains('playing'),current:n.classList.contains('current'),cover:k.classList.contains('has-cover'),url:k.style.getPropertyValue('--cover'),
        image:s.backgroundImage,color:s.backgroundColor,border:s.borderTopColor,ring:s.boxShadow,eq:getComputedStyle(k.querySelector('.mv-eq')).display,
        play:getComputedStyle(k.querySelector('.mv-play')).backgroundColor,fill:getComputedStyle(k.querySelector('.mv-fill')).backgroundColor,dim,contrast};};`;
  await js(helpers);
  const store = `import('./src/core/store.mjs')`;
  const record = (title) =>
    js(`${store}.then(async({library})=>(await library('getAll')).find(b=>b.title===${JSON.stringify(title)}))`);
  const songs = ['02 a.wav', '03 b.wav', '04 c.wav'];
  const lookAll = async () =>
    Object.fromEntries(await Promise.all(songs.map(async (n) => [n, await js(`look(${JSON.stringify(n)})`)])));
  const accent = 'rgb(255, 122, 89)';
  // 播放中的卡片一眼可辨：强调色外框（当前媒体）与描边、提亮（底色 / 压暗更少）、音柱、强调色的播放键和进度条；其余两张为中性。
  async function playOne(withCover) {
    await js(`toPage('03 b.wav')`);
    await tap('#reader .page[data-name="03 b.wav"] .mv-play');
    await wait(() => js(`node('03 b.wav').classList.contains('playing')`), 'playing');
    await delay(400); // 等过渡结束
    const all = await lookAll(),
      on = all['03 b.wav'];
    assert.deepEqual(
      [on.playing, on.current, on.cover, on.eq, on.play, on.fill],
      [true, true, withCover, 'flex', accent, accent],
      JSON.stringify(on),
    );
    assert.match(on.ring, /255, 122, 89/, 'Current media: accent outline');
    for (const n of ['02 a.wav', '04 c.wav']) {
      const o = all[n];
      assert.deepEqual([o.playing, o.current, o.cover, o.eq, o.ring], [false, false, withCover, 'none', 'none'], n);
      assert.notEqual(o.play, accent);
      assert.notEqual(o.fill, accent);
      assert.notEqual(o.border, on.border, 'The playing card has an accent border');
      assert.notEqual(o.color, on.color, 'The playing card is brighter');
      if (withCover) assert.ok(on.dim < o.dim, 'With a cover the playing card is dimmed less: ' + [on.dim, o.dim]);
    }
    return all;
  }
  async function stop() {
    await tap('#reader .page[data-name="03 b.wav"] .mv-play');
    await wait(() => js(`!node('03 b.wav').classList.contains('playing')`), 'stopped');
  }

  // ---- 有封面的书：第一张图是白色（封面为白色，即对比度的最坏情况），三段音频并排，最后一张图另作自定义封面。
  const svg = (c) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="${c}"/></svg>`;
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Album',{create:true});
    await mvMedia.write(dir,'01.svg',new Blob([${JSON.stringify(svg('#fff'))}],{type:'image/svg+xml'}));
    for(const n of ${JSON.stringify(songs)})await mvMedia.write(dir,n,mvMedia.wav({seconds:6}));
    await mvMedia.write(dir,'05.svg',new Blob([${JSON.stringify(svg('#c33'))}],{type:'image/svg+xml'}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();
    await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Album'`), 'album');
  // 默认封面在后台生成：已经显示的卡片在封面生成后换上背景（'cover' 事件）。
  await js(`toPage('03 b.wav')`);
  await wait(() => js(`card('03 b.wav')?.classList.contains('has-cover')`), 'default cover');
  const album = await record('Album');
  // 一个书签（第二张图），供「设置封面」选用；缩略图按测试图生成（正常添加时截取）。
  await js(`${store}.then(async({library,thumbs})=>{const b=(await library('getAll')).find(b=>b.title==='Album');
    b.bookmarks=[{id:'m1',name:'05.svg',f:.5,at:1}];await library('put',b);
    const {makeThumb}=await import('./src/reader/thumbs.mjs'),dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Album');
    const th=await makeThumb(await (await dir.getFileHandle('05.svg')).getFile(),{width:240});await thumbs('put',{blob:th.blob,w:th.w,h:th.h},${JSON.stringify(album.id)}+':bm:m1');})`);
  await cdp('Page.reload');
  await wait(() => js(`bookTitle.textContent==='Album'&&!!document.querySelector('#reader .page')`), 'reloaded');
  await js(MEDIA_FIXTURES);
  await js(helpers);
  await js(`toPage('03 b.wav')`);
  await wait(() => js(`${JSON.stringify(songs)}.every(n=>card(n)?.classList.contains('has-cover'))`), 'covers');
  const before = await lookAll();
  for (const [n, o] of Object.entries(before)) {
    assert.match(o.url, /^url\("blob:/, n);
    assert.match(o.image, /^linear-gradient\(rgba\(12, 12, 15, 0\.\d+\)/, 'Dimmed: ' + o.image);
    assert.ok(o.contrast >= 4.5, 'Text contrast over a white cover: ' + o.contrast);
  }
  const lit = await playOne(true);
  assert.ok(lit['03 b.wav'].contrast >= 4.5, 'Playing card text contrast: ' + lit['03 b.wav'].contrast);
  await shot('audiocard-cover');
  await stop();
  // 换封面（书架卡片「更多」→「设置封面」）：已显示的卡片跟着换，不必重建。
  await js(`window.__card=card('03 b.wav');0`);
  await js(`document.querySelector('[data-act="shelf"]').click()`);
  await wait(() => js('shelf.open'), 'shelf');
  await wait(() => js(`!!document.querySelector('#books .book .actions .more')`), 'more button');
  await js(
    `document.querySelector('#books .book .actions .more').click();[...cardMenu.querySelectorAll('[role=menuitem]')].find(x=>x.textContent==='Set cover').click()`,
  );
  await wait(
    () => js(`document.querySelector('.cover-pick')?.open&&!!document.querySelector('.cover-pick .cp-item')`),
    'picker',
  );
  await js(`document.querySelector('.cover-pick .cp-item').click()`);
  await wait(async () => !!(await record('Album')).customCover, 'custom cover saved');
  const custom = await js(
    `import('./src/reader/thumbs.mjs').then(async({getThumb})=>(await getThumb(${JSON.stringify(album.id + ':custom')})).url)`,
  );
  await wait(
    async () => (await js(`card('03 b.wav').style.getPropertyValue('--cover')`)).includes(custom),
    'card follows the new cover',
  );
  assert.equal(await js(`window.__card===card('03 b.wav')`), true, 'The same card, updated in place');
  for (const n of songs)
    assert.ok((await js(`card(${JSON.stringify(n)}).style.getPropertyValue('--cover')`)).includes(custom), n);
  await js('shelf.close()');
  await wait(() => js('!shelf.open'));

  // ---- 没有封面的书（只有音频，文字封面）：原样式（中性底色，无背景图），播放中照样一眼可辨。
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Tunes',{create:true});
    for(const n of ${JSON.stringify(songs)})await mvMedia.write(dir,n,mvMedia.wav({seconds:6}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#bar [data-act="folder"]').click();
    await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Tunes'`), 'tunes');
  await wait(async () => !!(await record('Tunes'))?.fp?.text, 'text cover');
  await js(`toPage('03 b.wav')`);
  await delay(300);
  const plain = await lookAll();
  for (const [n, o] of Object.entries(plain)) assert.deepEqual([o.cover, o.image], [false, 'none'], n);
  await playOne(false);
  await shot('audiocard-plain');
  await stop();

  assert.deepEqual(errors, []);
  console.log(
    'PASS: audio card with the book cover as a dimmed background (text contrast at least 4.5:1 over a white cover), follows a cover change in place, original style without a cover; the playing card stands out with and without a cover (outline, border, brighter, equaliser, accent controls)',
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
