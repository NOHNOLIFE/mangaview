// 自动滚动：漫画模式只滚图片、混合模式的滚动与停下播放、暂停与继续、书末的循环（本书 / 跨书 / 单文件）、
// 只播区段、手动操作不打断运行、低速不卡住、未运行时的自动播放规则与翻屏对齐视频、影音模式的跨书。
// 独立临时配置 + OPFS 测试数据；视频、音频由 tests/media-fixtures.mjs 在测试页里现场生成，不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from './chrome.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES, CTX_HOOK } from './media-fixtures.mjs';
import { imageRuns } from '../src/core/engine.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/transport.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-transport-'));
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
const chrome = launch(binary, profile, { autoplay: true });
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
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});${CTX_HOOK}`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    window.mid=name=>{const n=node(name);return n.offsetTop+n.offsetHeight/2;};
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    // 记录每一帧的 scrollTop（rec.on 为真时）。
    window.record=()=>{window.rec=[];window.recOn=true;const f=()=>{rec.push(reader.scrollTop);if(recOn)requestAnimationFrame(f);};requestAnimationFrame(f);};
    window.sample=ms=>new Promise(r=>{const out=[],t0=performance.now();const f=t=>{out.push([t,reader.scrollTop]);t-t0<ms?requestAnimationFrame(f):r(out);};requestAnimationFrame(f);});
    window.session=()=>import('./src/reader/session.mjs');
    window.openBook=async title=>{const s=await session(),{books}=await import('./src/core/books.mjs');s.select([...books.values()].find(b=>b.title===title));};
    window.listTitles=async()=>{const s=await session();return s.readingList(s.current).map(b=>b.title);};`;
  await js(helpers);
  // 书：Strip（8 张矮图）、Tail（3 张矮图）、Mix（图、音频、高图、视频、高图）、Next（一段音频）。
  await js(`(async()=>{const root=await navigator.storage.getDirectory();
    const svg=(w,h,c)=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="'+c+'"/><circle cx="50%" cy="50%" r="20%" fill="#fff"/></svg>'],{type:'image/svg+xml'});
    const strip=await root.getDirectoryHandle('Strip',{create:true});for(let i=0;i<8;i++)await mvMedia.write(strip,'0'+i+'.svg',svg(600,300,'hsl('+i*40+',50%,40%)'));
    const tail=await root.getDirectoryHandle('Tail',{create:true});for(let i=0;i<3;i++)await mvMedia.write(tail,'0'+i+'.svg',svg(600,300,'#455'));
    const mix=await root.getDirectoryHandle('Mix',{create:true});
    await mvMedia.write(mix,'01.svg',svg(600,300,'teal'));await mvMedia.write(mix,'02 a.wav',mvMedia.wav({seconds:2}));
    await mvMedia.write(mix,'03.svg',svg(600,900,'#534'));await mvMedia.write(mix,'04 v.webm',await mvMedia.webm({seconds:1.5,width:320,height:180}));
    await mvMedia.write(mix,'05.svg',svg(600,900,'#345'));
    const nx=await root.getDirectoryHandle('Next',{create:true});await mvMedia.write(nx,'01 n.wav',mvMedia.wav({seconds:1}));})()`);
  // 添加文件夹：点「添加」后若出现添加对话框（确认后才导入），点它的默认确认按钮；两种流程都能过。
  const addFolder = async (name) => {
    await js(
      `(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle(${JSON.stringify(name)});window.showDirectoryPicker=async()=>d;
      const b=[...document.querySelectorAll('#empty [data-act="folder"],#bar [data-act="folder"],#shelf [data-act="folder"]')].find(b=>b.offsetParent)||document.querySelector('#bar [data-act="folder"]')||document.querySelector('#shelf [data-act="folder"]');b.click();})()`,
    );
    await wait(
      () =>
        js(
          `(()=>{const d=document.getElementById('addDialog');if(d?.open){(d.querySelector('#addMany')||d.querySelector('button[autofocus]'))?.click();return false;}return bookTitle.textContent===${JSON.stringify(name)};})()`,
        ),
      'added ' + name,
    );
  };
  for (const name of ['Strip', 'Tail', 'Mix', 'Next']) await addFolder(name);
  await js(`localStorage.setItem('mv2:autoplay','false')`); // 自动播放的规则在后面单独检查
  const storage = (k, v) =>
    js(
      `(()=>{const key='mv2:${k}',v=${JSON.stringify(JSON.stringify(v))};if(v==='null')localStorage.removeItem(key);else localStorage.setItem(key,v);dispatchEvent(new StorageEvent('storage',{key,newValue:v==='null'?null:v,storageArea:localStorage}));})()`,
    );
  const B = (id) => `document.querySelector('#controlbar [data-id="${id}"]')`;
  const running = async () => (await js(`${B('play')}.getAttribute('aria-pressed')`)) === 'true';
  // Shift+空格 = 总控栏的「自动滚动」；不带 Shift 的空格在文件栏是媒体时只播放 / 暂停它（见 background.browser.mjs）。
  const space = () => key(' ', 'Space', 32, { modifiers: 8 });
  const top = () => js('reader.scrollTop');
  const maxTop = () => js('reader.scrollHeight-reader.clientHeight');
  const H = () => js('reader.clientHeight');
  const mode = (m) => js(`${B('mode-' + m)}.click()`);
  const open = async (title) => {
    await js(`openBook(${JSON.stringify(title)})`);
    await wait(() => js(`bookTitle.textContent===${JSON.stringify(title)}`), 'opened ' + title);
    await js('reader.focus()');
  };
  const playing = () =>
    js(`[...reader.querySelectorAll('video,audio')].filter(m=>!m.paused).map(m=>m.closest('.page').dataset.name)`);
  const centred = (name) =>
    js(
      `!!node(${JSON.stringify(name)})&&Math.abs(mid(${JSON.stringify(name)})-reader.scrollTop-reader.clientHeight/2)<2`,
    );
  const text = () => js(`document.getElementById('notice').textContent`);
  const stopped = async () => {
    if (await running()) await space();
    await wait(async () => !(await running()), 'stopped');
  };
  const [rx, ry] = await center('#reader');
  const wheel = (deltaY) => cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rx, y: ry, deltaX: 0, deltaY });

  // ---- 漫画模式。按下播放匀速向下滚动：1.0× = 每秒视窗高度的 10%；低速下也在走、不倒退、每帧不跳；运行状态与大播放键一致。
  await open('Strip');
  await mode('comic');
  await js('reader.scrollTop=0');
  await space();
  await wait(running, 'comic runs');
  const rate = (s) => (s.at(-1)[1] - s[0][1]) / ((s.at(-1)[0] - s[0][0]) / 1000);
  {
    const h = await H(),
      s = await js('sample(1200)');
    assert.ok(
      s.every((x, k) => !k || x[1] >= s[k - 1][1]),
      'Scrolls down only',
    );
    const v = rate(s);
    assert.ok(v > h * 0.1 * 0.6 && v < h * 0.1 * 1.4, '1.0× ≈ 10% of the view per second: ' + v + ' / ' + h);
    await storage('scrollRate', 0.25);
    const slow = await js('sample(2000)'),
      vs = rate(slow),
      steps = slow.slice(1).map((x, k) => x[1] - slow[k][1]);
    assert.ok(vs > h * 0.025 * 0.5 && vs < h * 0.025 * 1.5, '0.25× keeps moving: ' + vs);
    assert.ok(Math.min(...steps) >= 0 && Math.max(...steps) <= 1, 'Low speed: whole pixels, never backwards: ' + steps);
  }
  // 暂停：停在原处；继续：从原处接着走。
  await space();
  await wait(async () => !(await running()), 'paused');
  const t0 = await top();
  await delay(500);
  assert.equal(await top(), t0, 'Paused: stays put');
  await storage('scrollRate', 1);
  await space();
  await wait(async () => (await running()) && (await top()) > t0, 'resumes from where it was');
  assert.ok((await top()) - t0 < 60, 'No jump on resume');
  // 运行中手动滚动、翻屏不停止运行，从新位置继续。
  await wheel(240);
  await delay(400);
  assert.equal(await running(), true, 'Wheel does not stop the run');
  let t1 = await top();
  await wait(async () => (await top()) > t1 + 5, 'continues after the wheel');
  await key('d', 'KeyD', 68);
  await delay(100);
  t1 = await top();
  assert.equal(await running(), true, 'Turning a screen does not stop the run');
  await wait(async () => (await top()) > t1 + 5, 'continues after turning');
  await key('w', 'KeyW', 87, { hold: true }); // 按住 W 往回滚（与自动滚动共用推进逻辑），松开后接着往下
  await delay(400);
  await up('w', 'KeyW', 87);
  t1 = await top();
  assert.equal(await running(), true, 'Holding W does not stop the run');
  await wait(async () => (await top()) > t1 + 5, 'continues after holding W');
  // 窗口宽度变化：正文重排，视窗中央的内容不跳，运行继续。
  {
    const anchor = () =>
      js(
        'session().then(s=>{const a=s.view.anchor(),b=s.current;return a?b.pages.findIndex(p=>p.name===a.name)+a.f:0;})',
      );
    const a0 = await anchor();
    await cdp('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(400);
    const a1 = await anchor();
    assert.ok(a1 >= a0 - 0.02 && a1 - a0 < 0.5, 'Centre content stays through a resize: ' + a0 + ' → ' + a1);
    assert.equal(await running(), true);
    await wide();
    await delay(300);
  }
  // 书末：本书循环（默认）回到书首继续，不停止。
  await js('record()');
  await storage('scrollRate', 4);
  await wait(async () => (await top()) < 200, 'book loop: back to the start');
  {
    const m = await maxTop();
    assert.ok(
      (await js('recOn=false,rec')).some((t) => Math.abs(t - m) <= 1),
      'Reached the end first',
    );
  }
  assert.equal(await running(), true, 'Keeps running');
  await stopped();

  // ---- 跨书循环：到书末进入阅读列表的下一本，从书首继续；最后一本之后回到第一本。漫画模式跳过没有图片的书（Next 只有音频）。
  await storage('loopMode', 'books');
  {
    const list = await js('listTitles()');
    assert.ok(list.length === 4 && list.at(-2) !== 'Next', 'Reading list: ' + list);
    await open(list.at(-2));
    await mode('comic');
    await js('reader.scrollTop=reader.scrollHeight');
    await space();
    await wait(() => js(`bookTitle.textContent===${JSON.stringify(list.at(-1))}`), 'next book');
    assert.equal(await running(), true, 'Keeps running in the next book');
    assert.ok((await top()) < 300, 'From the top of the next book');
    await stopped();
    // 最后一本之后回到第一本（漫画模式下第一本有图片的书）。
    const last = list.at(-1),
      first = list.find((t) => t !== 'Next');
    assert.notEqual(last, 'Next');
    await open(last);
    await mode('comic');
    await js('reader.scrollTop=reader.scrollHeight');
    await js(
      `window.titles=[];new MutationObserver(()=>titles.push(bookTitle.textContent)).observe(bookTitle,{childList:true,characterData:true,subtree:true})`,
    );
    await space();
    await wait(() => js(`titles.includes(${JSON.stringify(first)})`), 'loop: the first book');
    assert.equal(await running(), true);
    assert.equal(await js(`titles.includes('Next')`), false, 'Comic mode skips a book without images');
    await stopped();
  }
  await storage('loopMode', null);
  // 本书循环：到书末回到书首，不进入别的书。
  await open('Tail');
  await js('reader.scrollTop=reader.scrollHeight');
  await js('record()');
  await space();
  await wait(async () => (await top()) < 50, 'book loop: back to the start of the same book');
  assert.equal(await js('bookTitle.textContent'), 'Tail');
  await stopped();
  await js('recOn=false');
  // 运行中用户切书：在新书里（从它的阅读位置）照常运行。
  await js('reader.scrollTop=0');
  await delay(400); // 阅读位置去抖保存
  await storage('scrollRate', 1);
  await open('Strip');
  await js('reader.scrollTop=0');
  await space();
  await wait(running);
  await js(`openBook('Tail')`);
  await wait(() => js(`bookTitle.textContent==='Tail'`));
  await delay(500);
  assert.equal(await running(), true, 'Switching books keeps the run going');
  await stopped();
  // 混合模式下纯图片的书：空格同样开始滚动；影音模式下没有媒体则没有效果。
  await open('Strip');
  await mode('mixed');
  await js('reader.scrollTop=0');
  await space();
  await wait(async () => (await running()) && (await top()) > 5, 'mixed mode scrolls a book of images');
  await stopped();
  await mode('media');
  t1 = await top();
  await space();
  await delay(400);
  assert.deepEqual([await running(), await top()], [false, t1], 'Media mode without media: nothing');
  await mode('mixed');

  // ---- 漫画模式只滚图片：视频、音频页不进入画面。连续的图片是一段，段尾到达视窗底即跳到下一段的开头；比视窗还短的段（Mix 的 01.svg）
  // 在原处停留相应的时间；不碰任何媒体。到书末按本书循环回到第一段。
  await open('Mix');
  await mode('comic');
  await storage('scrollRate', 4);
  await js('reader.scrollTop=0');
  await delay(200);
  {
    // 先把整本排好（图片尺寸读到后会重排），再按最终的版面算出图片段。
    for (const n of ['05.svg', '01.svg']) assert.ok(await js(`toPage('${n}')`));
    await js('reader.scrollTop=0');
    await delay(200);
    const [starts, h, sh] = await js(
      `session().then(s=>[s.view.panes[0].starts,reader.clientHeight,reader.scrollHeight])`,
    );
    const media = [1, 3]; // 02 a.wav、04 v.webm
    const runs = imageRuns({
      starts,
      image: (i) => !media.includes(i),
      H: h,
      lo: h / 2,
      hi: Math.max(h / 2, sh - h / 2),
    });
    assert.equal(runs.length, 3, 'Three runs of images: ' + JSON.stringify(runs));
    assert.ok(runs[0].hold > 0, 'The short first image is a hold: ' + JSON.stringify(runs[0]));
    await js('record()');
    await space();
    await wait(async () => {
      const r = await js('rec');
      const i = r.findIndex((t) => t + h / 2 > runs[2].b - 3);
      return i >= 0 && r.slice(i).some((t) => t < 5);
    }, 'comic: through the runs to the end, then back to the start');
    await stopped();
    const centres = await js('recOn=false,rec.map(t=>t+reader.clientHeight/2)');
    assert.equal(
      JSON.stringify(await js(`session().then(s=>s.view.panes[0].starts)`)),
      JSON.stringify(starts),
      'Layout unchanged while running',
    );
    const on = (c) => runs.some((s) => c >= s.a - 2 && c <= s.b + 2);
    assert.deepEqual(
      centres.filter((c) => !on(c)),
      [],
      'Only positions inside runs of images (media never scrolled into view): ' + JSON.stringify(runs),
    );
    assert.ok(centres.filter((c) => Math.abs(c - runs[0].a) <= 2).length > 10, 'Holds on the short image for a while');
    assert.ok(centres.some((c) => Math.abs(c - runs[1].a) <= 2) && centres.some((c) => Math.abs(c - runs[1].b) <= 6));
    assert.ok(
      centres.some((c) => Math.abs(c - runs[2].b) <= 6),
      'The last image to its end',
    );
    assert.deepEqual(await playing(), [], 'Comic mode plays nothing');
    assert.equal(
      await js(`[...reader.querySelectorAll('video,audio')].every(m=>m.currentTime===0)`),
      true,
      'No media touched',
    );
  }
  await storage('scrollRate', 1);
  await mode('mixed');

  // ---- 混合模式：匀速滚动，媒体到视窗中央停住播放，播完接着滚；暂停 = 暂停正在播放的媒体，继续从原处接着；书末按本书循环回到开头。
  await open('Mix');
  await storage('scrollRate', 4);
  await js('reader.scrollTop=0');
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav' && (await centred('02 a.wav')), 'stops at the audio');
  assert.equal(await running(), true);
  t1 = await top();
  await delay(300);
  assert.equal(await top(), t1, 'Does not scroll while the media plays');
  await shot('transport-mixed');
  await space();
  await wait(async () => !(await playing()).length && !(await running()), 'pause pauses the media');
  const at = await js(`el('02 a.wav').currentTime`);
  await delay(300);
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav' && (await running()), 'resumes the same media');
  assert.ok((await js(`el('02 a.wav').currentTime`)) >= at - 0.05, 'From where it was paused');
  await wait(async () => (await playing()).join() === '04 v.webm' && (await centred('04 v.webm')), 'next: the video');
  await wait(
    async () => (await playing()).join() === '02 a.wav' && (await centred('02 a.wav')),
    'book loop: back to the first media',
  );
  assert.equal(await running(), true);
  await stopped();
  // 单文件循环：停下来播的媒体播完重新播放，不往下滚。
  await storage('loopMode', 'file');
  await js('reader.scrollTop=0');
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav', 'file loop: plays the audio');
  t1 = await top();
  await js(`el('02 a.wav').currentTime=el('02 a.wav').duration-0.2`);
  await wait(
    async () => (await playing()).join() === '02 a.wav' && (await js(`el('02 a.wav').currentTime`)) < 1,
    'file loop: the same media again',
  );
  assert.equal(await top(), t1, 'Does not scroll on');
  await stopped();
  await storage('loopMode', null);
  // 正在播放的媒体被用户滚出视窗：停播，从新位置接着滚（下一个停靠点是视频）。
  await js('reader.scrollTop=0');
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav', 'plays the audio');
  await js('reader.scrollTop+=reader.clientHeight*0.8');
  t1 = await top();
  await wait(
    async () => (await js(`!el('02 a.wav')||el('02 a.wav').paused`)) && (await top()) > t1 + 20,
    'moves on from the new place',
  );
  assert.equal(await running(), true);
  await wait(async () => (await playing()).join() === '04 v.webm', 'then plays the video');
  await stopped();
  // 单个媒体自己的播放键：后台播放（成为当前曲目，不在视窗中央的也是），不启动自动滚动；播完按播放列表接着播下一个，不滚动。
  assert.ok(await js(`toPage('02 a.wav')`));
  await wait(() => js(`el('02 a.wav')?.readyState>=1`));
  await js('reader.scrollTop-=120'); // 不在视窗中央的也是
  await tap('#reader .page[data-name="02 a.wav"] .mv-play');
  await wait(async () => (await playing()).join() === '02 a.wav', 'own play button plays');
  assert.equal(await running(), false, 'Its own play button does not start auto-scroll');
  t1 = await top();
  await js(`el('02 a.wav').currentTime=el('02 a.wav').duration-0.2`);
  await wait(
    () => js(`el('02 a.wav').paused&&[...document.querySelectorAll('video,audio')].some(m=>!m.paused)`),
    'the play list moves on after it ends (also right after it last ended)',
  );
  assert.deepEqual([await running(), await top()], [false, t1], 'Without auto-scroll or scrolling');
  await js(`mvClearQueue()`);
  await wait(() => js(`![...document.querySelectorAll('video,audio')].some(m=>!m.paused)`), 'stopped');

  // ---- 只播区段：滚动只经过图片区段，到区段终点直接跳到下一个区段起点；整个处在图片区段之内的媒体整段播放，其余没有区段的媒体跳过。
  // 区段：01.svg 中部 → 03.svg 30%（盖住 02 a.wav），05.svg 20% → 80%；视频 04 没有区段，也不在图片区段内。
  await js(
    `(async()=>{const s=await session(),b=s.current;b.bookmarks=[{id:'s1',name:'01.svg',f:0.5,at:1,end:{name:'03.svg',f:0.3,at:2}},{id:'s2',name:'05.svg',f:0.2,at:3,end:{name:'05.svg',f:0.8,at:4}}];(await import('./src/core/events.mjs')).emit('marks',b);})()`,
  );
  await storage('sectionsOnly', true);
  await js('reader.scrollTop=0');
  const gap = await js(
    `session().then(m=>{const s=m.view.panes[0].starts;return [s[2]+(s[3]-s[2])*0.3,s[4]+(s[5]-s[4])*0.2];})`,
  );
  await js(
    `window.vplayed=false;reader.addEventListener('play',e=>{if(e.target.closest('.page')?.dataset.name==='04 v.webm')vplayed=true;},true)`,
  );
  await js('record()');
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav', 'covered audio plays');
  await wait(
    async () => (await js('rec.map(t=>t+reader.clientHeight/2)')).some((c) => Math.abs(c - gap[1]) < 3),
    'reaches the next section',
  );
  await delay(300);
  await stopped();
  const centres = await js('recOn=false,rec.map(t=>t+reader.clientHeight/2)');
  assert.ok(
    centres.some((c) => Math.abs(c - gap[1]) < 3),
    'Lands on the start of the next section: ' + gap,
  );
  assert.ok(!centres.some((c) => c > gap[0] + 3 && c < gap[1] - 3), 'Jumps over the gap between sections: ' + gap);
  assert.equal(await js('vplayed'), false, 'The video without a section is skipped');
  // 影音模式同样：整个在图片区段内的音频整段播放，没有区段的视频跳过。
  await mode('media');
  await js('reader.scrollTop=0;vplayed=false');
  await delay(200);
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav', 'media mode: covered audio');
  await js(`el('02 a.wav').currentTime=el('02 a.wav').duration-0.2`);
  await wait(
    async () => (await playing()).join() === '02 a.wav' && (await js(`el('02 a.wav').currentTime`)) < 1,
    'media mode: the video is skipped, the book loop plays the audio again',
  );
  assert.equal(await js('vplayed'), false, 'Media mode: the video without a section is skipped');
  await stopped();
  await mode('mixed');
  // 整本书没有任何区段：提示并不启动。
  await open('Tail');
  await space();
  await wait(async () => (await text()) === 'This book has no bookmark sections', 'no sections: hint');
  assert.equal(await running(), false);
  await storage('sectionsOnly', false);
  await open('Mix');
  await js(
    `(async()=>{const s=await session(),b=s.current;b.bookmarks=[];(await import('./src/core/events.mjs')).emit('marks',b);})()`,
  );

  // ---- 影音模式跨书循环：本书的媒体播完后进入下一本有媒体的书（最后一本之后回到第一本）。
  await mode('media');
  await storage('loopMode', 'books');
  assert.ok(await js(`toPage('04 v.webm')`));
  await wait(() => js(`el('04 v.webm')?.readyState>=1`));
  await space();
  await wait(async () => (await playing()).join() === '04 v.webm');
  await js(`el('04 v.webm').currentTime=el('04 v.webm').duration-0.2`);
  await wait(
    async () => (await js('bookTitle.textContent')) === 'Next' && (await playing()).join() === '01 n.wav',
    'next book with media plays',
  );
  await stopped();
  await storage('loopMode', null);
  // 影音模式运行中用户切书：在新书里接着播放（从阅读位置往后的媒体）。
  await open('Mix');
  assert.ok(await js(`toPage('02 a.wav')`));
  await wait(() => js(`el('02 a.wav')?.readyState>=1`));
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav');
  await js(`openBook('Next')`);
  await wait(
    async () => (await js('bookTitle.textContent')) === 'Next' && (await playing()).join() === '01 n.wav',
    'plays on in the book switched to',
  );
  assert.equal(await running(), true);
  await stopped();
  await mode('mixed');

  // ---- 未运行时的自动播放：混合、影音模式下只有视频在滚动停稳时自动播放，音频不会；漫画模式下都不自动播放。
  await open('Mix');
  await js(`localStorage.setItem('mv2:autoplay','true')`);
  assert.ok(await js(`toPage('02 a.wav')`));
  await wheel(4);
  await delay(900);
  assert.deepEqual(await playing(), [], 'Audio does not autoplay');
  assert.ok(await js(`toPage('04 v.webm')`));
  await wheel(4);
  await wait(async () => (await playing()).join() === '04 v.webm', 'video autoplays');
  await js(`el('04 v.webm').pause()`);
  await mode('comic');
  await js('reader.scrollTop=0');
  await delay(300);
  assert.ok(await js(`toPage('04 v.webm')`));
  await wheel(4);
  await delay(900);
  assert.deepEqual(await playing(), [], 'Comic mode: no autoplay');
  // 翻屏对齐：翻过去之后有视频进入播放范围，这一次直接落在视频居中处（一次滚动到位）；漫画模式、自动播放关闭时照常翻一屏。
  const turn = async () => {
    const [vm, h] = await js(`[mid('04 v.webm'),reader.clientHeight]`);
    const from = Math.round(vm - h - 100);
    await js(`reader.scrollTop=${from}`);
    await delay(150);
    await js('record()');
    await key('d', 'KeyD', 68);
    await delay(400);
    const seen = await js('recOn=false,rec');
    return { from, plain: from + h - 64, centre: Math.round(vm - h / 2), seen, now: await top() };
  };
  {
    const r = await turn();
    assert.equal(r.now, r.plain, 'Comic mode: a plain screen turn');
  }
  await mode('mixed');
  {
    const r = await turn();
    assert.ok(Math.abs(r.now - r.centre) <= 1, 'Lands with the video centred: ' + JSON.stringify([r.now, r.centre]));
    assert.ok(!r.seen.some((t) => Math.abs(t - r.plain) < 2), 'In one move, not a turn and a correction');
    await wait(async () => (await playing()).join() === '04 v.webm', 'and it autoplays');
    await js(`el('04 v.webm').pause()`);
  }
  await js(`localStorage.setItem('mv2:autoplay','false')`);
  {
    const r = await turn();
    assert.equal(r.now, r.plain, 'Autoplay off: a plain screen turn');
  }

  // ---- 单文件模式 × 运行：不连续滚动，按页推进。漫画模式按间隔换页（1.0× = 5 秒，间隔 = 5 秒 ÷ 滚动速率；4× 为 1.25 秒），
  // 混合模式图片按间隔、媒体播完再换页，影音模式只在媒体之间切换；只播区段时只经过区段内的页；手动翻页、暂停后都从当前页重新计时；
  // 运行中切换单文件模式不停止。
  await js(`import('./src/reader/single.mjs').then(m=>{window.S1=m;})`);
  await js(
    `window.trackPages=()=>{window.seenPages=[];window.trackOn=true;const f=()=>{const i=S1.index();if(seenPages.at(-1)!==i)seenPages.push(i);if(trackOn)requestAnimationFrame(f);};f();}`,
  );
  const pg = () => js('S1.index()');
  const onSlot = () =>
    js(
      'session().then(s=>{const i=s.view.position().i;return Math.abs(s.view.panes[0].starts[i]-reader.scrollTop)<1;})',
    );
  const goPage = async (i) => {
    await js(`S1.go(${i})`);
    await wait(async () => (await pg()) === i && (await onSlot()), 'page ' + i);
  };
  await storage('scrollRate', 4);
  await open('Strip');
  await mode('comic');
  await storage('singleFile', true);
  await wait(() => js(`reader.classList.contains('single-file')`), 'single file on');
  await goPage(0);
  {
    await space();
    await wait(running, 'single file: runs');
    const t0 = Date.now(),
      s = await js('sample(700)');
    assert.ok(
      s.every((x) => x[1] === s[0][1]),
      'Single file: no continuous scrolling',
    );
    await wait(async () => (await pg()) === 1, 'next page after the interval');
    const dt = Date.now() - t0;
    assert.ok(dt > 900 && dt < 2600, '4×: about 1.25 s a page: ' + dt);
    assert.ok(await onSlot(), 'Lands on a whole page');
    // 手动翻页不打断运行，从新的一页重新计时。
    await wait(async () => (await pg()) === 2, 'page 2');
    await delay(800);
    await key('d', 'KeyD', 68);
    await wait(async () => (await pg()) === 3, 'turned by hand');
    const t1 = Date.now();
    assert.equal(await running(), true, 'Turning by hand keeps the run going');
    await wait(async () => (await pg()) === 4, 'moves on after a manual turn');
    assert.ok(Date.now() - t1 > 900, 'The interval restarts on the new page: ' + (Date.now() - t1));
    // 暂停：停在这一页；继续：从这一页重新计时。
    await space();
    await wait(async () => !(await running()), 'paused');
    const p = await pg();
    await delay(1600);
    assert.equal(await pg(), p, 'Paused: stays on the page');
    await space();
    const t2 = Date.now();
    await wait(async () => (await pg()) === p + 1, 'resumes');
    assert.ok(Date.now() - t2 > 900, 'Resuming restarts the interval: ' + (Date.now() - t2));
    // 书末：本书循环回到第一页继续。
    await wait(async () => (await pg()) === 7, 'single file: the last page');
    await wait(async () => (await running()) && (await pg()) === 0, 'single file: loop back to the first page');
    await stopped();
    // 跨书循环：到书末进入阅读列表的下一本，从它的第一页接着按页推进。
    await storage('loopMode', 'books');
    const list = await js('listTitles()');
    await open(list.at(-2));
    const n = await js('session().then(s=>s.current.pages.length)');
    await goPage(n - 1);
    await space();
    await wait(
      async () => (await js('bookTitle.textContent')) === list.at(-1) && (await pg()) === 0,
      'single file: the next book from its first page',
    );
    assert.equal(await running(), true, 'Keeps running in the next book');
    await stopped();
    await storage('loopMode', null);
  }
  // 漫画模式下跳过视频、音频页（不显示、不播放），到书末回到第一页。
  await open('Mix');
  await goPage(0);
  await js('trackPages()');
  await space();
  await wait(async () => (await js('seenPages')).length >= 4, 'comic: through the images and back');
  await stopped();
  assert.deepEqual((await js('trackOn=false,seenPages')).slice(0, 4), [0, 2, 4, 0], 'Comic: only image pages');
  assert.equal(await js(`!el('02 a.wav')||el('02 a.wav').currentTime===0`), true, 'Comic: the audio does not play');
  // 漫画模式从媒体页开始：直接换到后面的图片页。
  await goPage(3);
  await js('trackPages()');
  await space();
  await wait(async () => (await pg()) === 4, 'comic: leaves the video page at once');
  assert.ok(
    (await js('seenPages')).length <= 2 && !(await playing()).length,
    'No interval on the video page, nothing played',
  );
  await stopped();
  await js('trackOn=false');
  // 混合模式：图片按间隔，媒体页停下播放、播完再换页；到书末按本书循环回到第一页。
  await mode('mixed');
  await goPage(0);
  await js('trackPages()');
  await space();
  await wait(async () => (await pg()) === 1 && (await playing()).join() === '02 a.wav', 'mixed: plays the audio page');
  await delay(1500);
  assert.equal(await pg(), 1, 'Stays on the media page while it plays');
  await js(`el('02 a.wav').currentTime=el('02 a.wav').duration-0.2`);
  await wait(async () => (await pg()) === 2, 'next page after the audio ends');
  await wait(async () => (await pg()) === 3 && (await playing()).join() === '04 v.webm', 'mixed: plays the video page');
  await wait(async () => (await js('seenPages')).length >= 6, 'mixed: loops back');
  await stopped();
  assert.deepEqual(
    (await js('trackOn=false,seenPages')).slice(0, 6),
    [0, 1, 2, 3, 4, 0],
    'Every page in order, then the first',
  );
  // 只播区段：只经过图片区段内的页（第 1–3 页的区段盖住音频，第 5 页的区段），没有区段的视频页不经过。
  await js(
    `(async()=>{const s=await session(),b=s.current;b.bookmarks=[{id:'s1',name:'01.svg',f:0.5,at:1,end:{name:'03.svg',f:0.3,at:2}},{id:'s2',name:'05.svg',f:0.2,at:3,end:{name:'05.svg',f:0.8,at:4}}];(await import('./src/core/events.mjs')).emit('marks',b);})()`,
  );
  await storage('sectionsOnly', true);
  await goPage(0);
  await js('trackPages()');
  await space();
  await wait(async () => (await playing()).join() === '02 a.wav', 'sections: the covered audio plays');
  await js(`el('02 a.wav').currentTime=el('02 a.wav').duration-0.2`);
  await wait(async () => (await js('seenPages')).length >= 5, 'sections: after the last section, back to the first');
  await stopped();
  assert.deepEqual((await js('trackOn=false,seenPages')).slice(0, 4), [0, 1, 2, 4], 'Only pages inside sections');
  assert.equal(
    await js(`!el('04 v.webm')||el('04 v.webm').currentTime===0`),
    true,
    'The video without a section is skipped',
  );
  await storage('sectionsOnly', false);
  await js(
    `(async()=>{const s=await session(),b=s.current;b.bookmarks=[];(await import('./src/core/events.mjs')).emit('marks',b);})()`,
  );
  // 影音模式：只在媒体之间切换，切到下一个媒体所在的页。
  await mode('media');
  await goPage(0);
  await js('trackPages()');
  await space();
  await wait(async () => (await pg()) === 1 && (await playing()).join() === '02 a.wav', 'media: the first media page');
  await js(`el('02 a.wav').currentTime=el('02 a.wav').duration-0.2`);
  await wait(async () => (await pg()) === 3 && (await playing()).join() === '04 v.webm', 'media: the next media page');
  assert.ok(await onSlot(), 'On the whole page');
  await js(`el('04 v.webm').currentTime=el('04 v.webm').duration-0.2`);
  await wait(
    async () => (await pg()) === 1 && (await playing()).join() === '02 a.wav',
    'media: after the last media, the first again',
  );
  await stopped();
  assert.deepEqual(await js('trackOn=false,seenPages'), [0, 1, 3, 1], 'Only media pages');
  await mode('comic');
  // 运行中进入、退出单文件模式不停止运行：进入后按页推进，退出后接着连续滚动。
  await open('Strip');
  await storage('singleFile', false);
  await wait(() => js(`!reader.classList.contains('single-file')`), 'single file off');
  await storage('scrollRate', 1);
  await js('reader.scrollTop=0');
  await space();
  await wait(async () => (await top()) > 5, 'strip runs');
  await js(`${B('single')}.click()`);
  await wait(() => js(`reader.classList.contains('single-file')`), 'single file on while running');
  await storage('scrollRate', 4);
  await delay(300);
  assert.equal(await running(), true, 'Entering single file mode keeps the run going');
  {
    const p = await pg(),
      s = await js('sample(500)');
    assert.ok(s.every((x) => x[1] === s[0][1]) && (await onSlot()), 'Now page by page');
    await wait(async () => (await pg()) === p + 1, 'turns pages while running');
  }
  await js(`${B('single')}.click()`);
  await wait(() => js(`!reader.classList.contains('single-file')`), 'single file off while running');
  {
    await storage('scrollRate', 1);
    const t3 = await top();
    assert.equal(await running(), true, 'Leaving single file mode keeps the run going');
    await wait(async () => (await top()) > t3 + 5, 'scrolls again');
  }
  await stopped();
  await mode('mixed');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: comic mode scrolls at 10% of the view per second at 1.0× (low speed keeps moving in whole pixels), pause / resume in place, wheel / turning / holding W / resizing keep the run going, book loop wraps at the end, cross-book loop moves to the next book and from the last to the first (comic mode skips books without images), switching books keeps running, Space in a book of images, comic mode scrolls only images (jumps over media, holds on a short image, touches no media), mixed mode stops and plays media at the centre and moves on, pause resumes the same media, book loop back to the first media, file loop replays the media, a media scrolled away lets the run continue, own play button, sections only (jump between image sections, covered media play, others skipped, no sections: hint), media mode book loop and across books, autoplay only for videos and not in comic mode, screen turns land on a video, single file mode runs page by page (interval, manual turns, pause, loop, across books, comic skips media pages / mixed / media, sections only, toggling while running)',
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
