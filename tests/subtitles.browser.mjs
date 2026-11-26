// 外挂字幕的端到端测试（docs/requirements-2.4.zh-CN.md 6.1）：匹配、随时间显示、开关、多字幕选择、音频、散图图集、刷新后新增字幕、不重复读文件、备份。
// 独立临时配置 + OPFS 测试数据；视频、音频由 tests/media-fixtures.mjs 现场生成，字幕在测试页里现场构造（含一份 GBK 编码的），不使用任何真实文件。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MEDIA_FIXTURES } from './media-fixtures.mjs';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/subtitles.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-subs-'));
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  // 记下读取了哪些字幕文件的内容（arrayBuffer）和元数据（getFile）：验证一个字幕文件只读一次内容。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});
    window.subReads=[];window.subStats=[];const isSub=n=>/\\.(srt|vtt|ass|ssa|lrc)$/i.test(n||'');
    const ab=Blob.prototype.arrayBuffer;Blob.prototype.arrayBuffer=function(){if(isSub(this.name))subReads.push(this.name);return ab.call(this);};
    const gf=FileSystemFileHandle.prototype.getFile;FileSystemFileHandle.prototype.getFile=function(){if(isSub(this.name))subStats.push(this.name);return gf.call(this);};`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  const helpers = `window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.el=name=>node(name)?.querySelector('video,audio');
    window.cue=name=>{const c=node(name)?.querySelector('.mv-subs .mv-cue');return c&&!c.hidden?c.textContent:null;};
    window.btn=name=>node(name)?.querySelector('[data-control="subs"]');
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.seekTo=async(name,t)=>{const v=el(name);v.currentTime=t;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));await frame();};
    window.text=s=>new Blob([s]);
    window.folder=()=>navigator.storage.getDirectory().then(r=>r.getDirectoryHandle('Subs',{create:true}));`;
  await js(helpers);
  const record = (title = 'Subs') =>
    js(
      `import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>b.title===${JSON.stringify(title)}))`,
    );
  const atlas = () =>
    js(`import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>!b.sources?.length))`);
  const subsOf = (rec) => Object.fromEntries(rec.pages.map((p) => [p.name, (p.subs ?? []).map((e) => e.file)]));

  // 一本书：视频配两个字幕（UTF-8 的 .srt 和 GBK 编码的 .zh.srt），音频配 .lrc，另一段音频没有字幕，一张图；另有一个对不上的字幕。
  await js(`(async()=>{const dir=await folder();
    await mvMedia.write(dir,'01 clip.webm',await mvMedia.webm({seconds:3,width:320,height:180}));
    await mvMedia.write(dir,'01 clip.srt',text('1\\r\\n00:00:00,000 --> 00:00:01,200\\r\\n<i>First</i> line\\r\\n\\r\\n2\\r\\n00:00:01,200 --> 00:00:02,400\\r\\nSecond\\r\\n{\\\\an8}line two\\r\\n\\r\\n3\\r\\n00:00:02,400 --> 00:00:03,000\\r\\nL1\\r\\nL2\\r\\nL3\\r\\nL4\\r\\nL5\\r\\n'));
    const head=new TextEncoder().encode('1\\r\\n00:00:00,000 --> 00:00:03,000\\r\\n'),gbk=new Uint8Array([0xC4,0xE3,0xBA,0xC3,0xCA,0xC0,0xBD,0xE7]);
    await mvMedia.write(dir,'01 clip.zh.srt',new Blob([head,gbk,new TextEncoder().encode('\\r\\n')]));
    await mvMedia.write(dir,'02 song.wav',mvMedia.wav({seconds:6}));
    await mvMedia.write(dir,'02 song.lrc',text('[ti:Song]\\n[00:00.00]Lyric one\\n[00:02.00][00:04.00]Lyric two\\n'));
    await mvMedia.write(dir,'03 bare.wav',mvMedia.wav({seconds:2}));
    await mvMedia.write(dir,'04.svg',new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="100%" height="100%" fill="teal"/></svg>'],{type:'image/svg+xml'}));
    await mvMedia.write(dir,'05 tall.svg',new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="2400"><rect width="100%" height="100%" fill="purple"/></svg>'],{type:'image/svg+xml'}));
    await mvMedia.write(dir,'lonely.srt',text('1\\n00:00:00,000 --> 00:00:01,000\\nx\\n'));
    localStorage.setItem('mv2:autoplay','false');
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`bookTitle.textContent==='Subs'`), 'book opened');
  await js('reader.focus()');

  // ---- 匹配：扫描时记下配上的字幕文件名；字幕不算页、不计数、不提示，导入时不读字幕文件。
  let rec = await wait(record, 'record');
  assert.deepEqual(subsOf(rec), {
    '01 clip.webm': ['01 clip.srt', '01 clip.zh.srt'],
    '02 song.wav': ['02 song.lrc'],
    '03 bare.wav': [],
    '04.svg': [],
    '05 tall.svg': [],
  });
  assert.match(await js('bookMeta.textContent'), /^\d \/ 5 · /, 'Subtitles are not pages');
  // 字幕文件只在媒体挂上源（进入视窗）、要显示字幕时才读，每个只读一次；没配上的、没选中的不读。
  const reads = async () => {
    const r = await js('subReads');
    assert.equal(new Set(r).size, r.length, 'Each subtitle file is read at most once: ' + r);
    return r.slice().sort();
  };
  assert.ok(
    (await reads()).every((n) => ['01 clip.srt', '02 song.lrc'].includes(n)),
    'Only shown subtitles are read',
  );

  // ---- 显示：视频叠在画面底部，随时间变化；样式标签去掉；最多 3 行。
  assert.ok(await js(`toPage('01 clip.webm')`));
  await wait(() => js(`el('01 clip.webm')?.readyState>=1`), 'clip metadata');
  await wait(() => js(`cue('01 clip.webm')==='First line'`), 'first cue at 0 s');
  assert.ok((await reads()).includes('01 clip.srt'), 'The default is the exactly named one');
  assert.deepEqual(
    await js(
      `(()=>{const b=btn('01 clip.webm');return [!!b,b.disabled,b.getAttribute('aria-pressed'),b.getAttribute('aria-haspopup'),b.getAttribute('aria-label')];})()`,
    ),
    [true, false, 'true', 'menu', 'Subtitles'],
  );
  await js(`seekTo('01 clip.webm',1.5)`);
  assert.equal(await js(`cue('01 clip.webm')`), 'Second\nline two');
  const box =
    await js(`(()=>{const n=node('01 clip.webm'),v=el('01 clip.webm').getBoundingClientRect(),c=n.querySelector('.mv-cue').getBoundingClientRect(),s=getComputedStyle(n.querySelector('.mv-cue'));
    return {v:[v.left,v.top,v.right,v.bottom],c:[c.left,c.top,c.right,c.bottom],color:s.color,bg:s.backgroundColor,lh:parseFloat(s.lineHeight),inside:n.contains(n.querySelector('.mv-cue'))};})()`);
  assert.ok(box.inside, 'The subtitle is inside the player node (shown in fullscreen too)');
  assert.ok(
    box.c[0] >= box.v[0] && box.c[2] <= box.v[2] && box.c[3] <= box.v[3],
    'Within the picture: ' + JSON.stringify(box),
  );
  assert.ok(box.c[1] > (box.v[1] + box.v[3]) / 2, 'In the lower half of the picture');
  assert.ok(Math.abs((box.c[0] + box.c[2]) / 2 - (box.v[0] + box.v[2]) / 2) < 2, 'Centred');
  assert.equal(box.color, 'rgb(255, 255, 255)');
  // 叠在画面底部、控件上方：不遮挡进度条（壳淡出时也照此占位）；只用面板提供的容器，不另建。
  assert.ok(
    await js(
      `(()=>{const n=node('01 clip.webm'),c=n.querySelector('.mv-cue').getBoundingClientRect(),b=n.querySelector('.mv-bar').getBoundingClientRect();return c.bottom<=b.top&&n.querySelector('.mv-cue').parentNode===n.querySelector(':scope>.mv-subs');})()`,
    ),
    'Above the progress bar, in the panel container',
  );
  assert.equal(await js(`document.querySelectorAll('.mv-subs-own').length`), 0, 'No fallback container');
  assert.match(box.bg, /^rgba\(0, 0, 0, 0\.\d+\)$/);
  await shot('subs-video');
  await js(`seekTo('01 clip.webm',2.6)`);
  assert.equal(await js(`cue('01 clip.webm')`), 'L1\nL2\nL3\nL4\nL5');
  const clamp = await js(
    `(()=>{const c=node('01 clip.webm').querySelector('.mv-cue'),s=getComputedStyle(c);return [c.getBoundingClientRect().height,parseFloat(s.lineHeight),parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)];})()`,
  );
  assert.ok(Math.abs(clamp[0] - clamp[1] * 3 - clamp[2]) < 1.5, 'At most 3 lines: ' + clamp);
  // 播放中随时间更新（requestVideoFrameCallback / timeupdate）。
  await js(`seekTo('01 clip.webm',0)`);
  assert.equal(await js(`cue('01 clip.webm')`), 'First line');
  await js(`el('01 clip.webm').play()`);
  await wait(() => js(`cue('01 clip.webm')==='Second\\nline two'`), 'cue follows playback');
  await js(`el('01 clip.webm').pause()`);

  // ---- 多个字幕：按钮弹出菜单（关闭 + 各个字幕），选中的记在书目记录里；GBK 编码的也能读出。
  await tap('#reader .page[data-name="01 clip.webm"] [data-control="subs"]');
  await wait(() => js(`document.querySelector('.mv-subs-pop')?.matches(':popover-open')`), 'menu open');
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.mv-subs-pop .sp-item')].map(b=>[b.textContent,b.getAttribute('aria-checked')])`,
    ),
    [
      ['Off', 'false'],
      ['01 clip.srt', 'true'],
      ['01 clip.zh.srt', 'false'],
    ],
  );
  assert.ok(await js(`document.querySelector('.mv-subs-pop').classList.contains('menu-pop')`));
  const pop = await js(
    `(()=>{const m=document.querySelector('.mv-subs-pop').getBoundingClientRect(),b=btn('01 clip.webm').getBoundingClientRect();return [m.bottom<=b.top+1,m.left>=0,m.right<=innerWidth];})()`,
  );
  assert.deepEqual(pop, [true, true, true], 'The menu opens above the button, inside the window');
  await shot('subs-menu');
  // 再点一次按钮即收起。
  await tap('#reader .page[data-name="01 clip.webm"] [data-control="subs"]');
  await wait(() => js(`!document.querySelector('.mv-subs-pop').matches(':popover-open')`), 'menu closed by the button');
  await delay(150);
  assert.equal(await js(`document.querySelector('.mv-subs-pop').matches(':popover-open')`), false);
  await tap('#reader .page[data-name="01 clip.webm"] [data-control="subs"]');
  await wait(() => js(`document.querySelector('.mv-subs-pop').matches(':popover-open')`), 'menu open again');
  await js(`[...document.querySelectorAll('.mv-subs-pop .sp-item')].find(b=>b.textContent==='01 clip.zh.srt').click()`);
  await wait(() => js(`cue('01 clip.webm')==='你好世界'`), 'GBK subtitle decoded');
  assert.ok((await reads()).includes('01 clip.zh.srt'));
  await wait(async () => (await record()).subPick?.[0]?.f === '01 clip.zh.srt', 'choice saved');
  assert.deepEqual((await record()).subPick, [{ id: '01 clip.webm', f: '01 clip.zh.srt' }]);
  // 关闭：全局记住，所有媒体都不显示。
  await tap('#reader .page[data-name="01 clip.webm"] [data-control="subs"]');
  await wait(() => js(`document.querySelector('.mv-subs-pop').matches(':popover-open')`), 'menu');
  await js(`[...document.querySelectorAll('.mv-subs-pop .sp-item')].find(b=>b.textContent==='Off').click()`);
  await wait(() => js(`cue('01 clip.webm')===null&&btn('01 clip.webm').getAttribute('aria-pressed')==='false'`), 'off');
  assert.equal(await js(`localStorage.getItem('mv2:subs')`), 'false');
  // 不重复读：选回之前的字幕、离开视窗再回来，都只核对元数据。
  await tap('#reader .page[data-name="01 clip.webm"] [data-control="subs"]');
  await wait(() => js(`document.querySelector('.mv-subs-pop').matches(':popover-open')`), 'menu');
  await js(`[...document.querySelectorAll('.mv-subs-pop .sp-item')].find(b=>b.textContent==='01 clip.srt').click()`);
  await js(`seekTo('01 clip.webm',0.5)`);
  await wait(() => js(`cue('01 clip.webm')==='First line'`), 'back to the first subtitle');
  assert.equal(await js(`localStorage.getItem('mv2:subs')`), 'true');
  await reads(); // 缓存命中：不再读

  // ---- 音频：显示在卡片里；只有一个字幕时按钮直接开 / 关；没有字幕的媒体按钮禁用。
  assert.ok(await js(`toPage('02 song.wav')`));
  await wait(() => js(`el('02 song.wav')?.readyState>=1`), 'song loaded');
  await wait(() => js(`cue('02 song.wav')==='Lyric one'`), 'lyric');
  await js(`seekTo('02 song.wav',2.5)`);
  assert.equal(await js(`cue('02 song.wav')`), 'Lyric two');
  const card = await js(
    `(()=>{const n=node('02 song.wav'),k=n.querySelector('.mv-card').getBoundingClientRect(),c=n.querySelector('.mv-cue').getBoundingClientRect();return [c.left>=k.left,c.right<=k.right,c.top>=k.top,c.bottom<=k.bottom,c.height>0];})()`,
  );
  assert.deepEqual(card, [true, true, true, true, true], 'Inside the audio card');
  // 音频卡片的字幕区固定 3 行高：超过 3 行的省略，字幕不超出字幕区，卡片高度不变。
  const audioBox = () =>
    js(
      `(()=>{const n=node('02 song.wav'),s=n.querySelector('.mv-card>.mv-subs').getBoundingClientRect(),c=n.querySelector('.mv-cue'),r=c.getBoundingClientRect();return {card:n.querySelector('.mv-card').getBoundingClientRect().height,inside:r.top>=s.top-.5&&r.bottom<=s.bottom+.5,lines:Math.round(r.height/parseFloat(getComputedStyle(c).lineHeight)),own:c.parentNode.classList.contains('mv-subs')};})()`,
    );
  const oneLine = await audioBox();
  assert.deepEqual([oneLine.inside, oneLine.lines, oneLine.own], [true, 1, true], JSON.stringify(oneLine));
  await js(`node('02 song.wav').querySelector('.mv-cue').textContent='L1\\nL2\\nL3\\nL4\\nL5'`);
  const fiveLines = await audioBox();
  assert.deepEqual(
    [fiveLines.card, fiveLines.inside, fiveLines.lines],
    [oneLine.card, true, 3],
    'At most 3 lines in the audio card',
  );
  await js(`seekTo('02 song.wav',2.5)`);
  assert.equal(await js(`cue('02 song.wav')`), 'Lyric two');
  await shot('subs-audio');
  assert.equal(await js(`btn('02 song.wav').hasAttribute('aria-haspopup')`), false);
  await tap('#reader .page[data-name="02 song.wav"] [data-control="subs"]');
  await wait(() => js(`cue('02 song.wav')===null&&localStorage.getItem('mv2:subs')==='false'`), 'toggled off');
  assert.equal((await audioBox()).card, oneLine.card, 'The card keeps its height without subtitles');
  assert.equal(
    await js(`document.querySelector('.mv-subs-pop').matches(':popover-open')`),
    false,
    'No menu for one subtitle',
  );
  await tap('#reader .page[data-name="02 song.wav"] [data-control="subs"]');
  await wait(() => js(`cue('02 song.wav')==='Lyric two'`), 'toggled on');
  assert.ok(await js(`toPage('03 bare.wav')`));
  await wait(() => js(`!!btn('03 bare.wav')`), 'bare player');
  assert.deepEqual(await js(`[btn('03 bare.wav').disabled,btn('03 bare.wav').getAttribute('aria-label')]`), [
    true,
    'No subtitles',
  ]);
  // 回到视频：缓存命中，只核对元数据，不读内容；按媒体记住的选择仍在。
  const stats = await js('subStats.length');
  await js('reader.scrollTop=reader.scrollHeight');
  await wait(() => js(`!el('01 clip.webm')||el('01 clip.webm').readyState===0`), 'clip unloaded');
  assert.ok(await js(`toPage('01 clip.webm')`));
  await wait(() => js(`el('01 clip.webm')?.readyState>=1`), 'clip again');
  await wait(() => js(`cue('01 clip.webm')==='First line'`), 'cue again');
  assert.ok((await js('subStats.length')) > stats, 'Metadata checked again');
  assert.deepEqual(await reads(), ['01 clip.srt', '01 clip.zh.srt', '02 song.lrc'], 'Each subtitle read once');

  // ---- 刷新：新增、删除字幕随文件夹检查（切回窗口）更新到记录，按钮随之启用 / 禁用。
  await js(
    `(async()=>{const dir=await folder();await mvMedia.write(dir,'03 bare.vtt',text('WEBVTT\\n\\n00:00.000 --> 00:02.000 align:start\\nBare <b>now</b>\\n'));await dir.removeEntry('02 song.lrc');})()`,
  );
  await delay(1600); // 切回窗口的检查有 1.5 秒的间隔
  await js(`dispatchEvent(new Event('focus'))`);
  await wait(async () => {
    const s = subsOf(await record());
    return s['03 bare.wav'][0] === '03 bare.vtt' && !s['02 song.wav'].length;
  }, 'refreshed record').catch(async (e) => {
    throw Error(e.message + ' / ' + JSON.stringify({ subs: subsOf(await record()), errors }));
  });
  assert.ok(await js(`toPage('03 bare.wav')`));
  await wait(() => js(`btn('03 bare.wav')?.disabled===false`), 'button enabled after refresh');
  await wait(() => js(`cue('03 bare.wav')==='Bare now'`), 'new subtitle shown');
  assert.equal(await js(`btn('02 song.wav')?.disabled??true`), true, 'Removed subtitle disables the button');

  // ---- 散图图集：与媒体一起选入的字幕按主文件名配对并保存句柄；之后单独加入的字幕也配上已有的媒体。
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Loose',{create:true});
    await mvMedia.write(dir,'tune.wav',mvMedia.wav({seconds:4}));
    await mvMedia.write(dir,'tune.srt',text('1\\n00:00:00,000 --> 00:00:04,000\\nLoose line\\n'));
    await mvMedia.write(dir,'tune.en.lrc',text('[00:00.00]Later lyric\\n'));
    window.showOpenFilePicker=async()=>[await dir.getFileHandle('tune.wav'),await dir.getFileHandle('tune.srt')];
    document.querySelector('#bar [data-act="files"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addLoose.click();})()`);
  await wait(async () => (await atlas())?.pages?.length === 1, 'atlas created');
  let a = await atlas();
  assert.deepEqual(subsOf(a), { 'tune.wav': ['tune.srt'] });
  assert.ok(
    await js(
      `import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>!b.sources?.length).pages[0].subs[0].handle instanceof FileSystemFileHandle)`,
    ),
    'The handle is stored with the page',
  );
  await wait(() => js(`bookTitle.textContent!=='Subs'`), 'atlas opened');
  await wait(() => js(`toPage('tune.wav')`), 'tune');
  await wait(() => js(`cue('tune.wav')==='Loose line'`), 'loose subtitle shown');
  await js(`(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('Loose');
    window.showOpenFilePicker=async()=>[await dir.getFileHandle('tune.en.lrc')];document.querySelector('#bar [data-act="files"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addLoose.click();})()`);
  await wait(async () => subsOf(await atlas())['tune.wav'].length === 2, 'later subtitle joined');
  a = await atlas();
  assert.equal(a.pages.length, 1, 'A subtitle alone adds no page');
  assert.deepEqual(subsOf(a), { 'tune.wav': ['tune.en.lrc', 'tune.srt'] });
  await wait(() => js(`btn('tune.wav')?.getAttribute('aria-haspopup')==='menu'`), 'menu after adding');

  // ---- 备份：页记录里的字幕信息（文件名、选择）随导出 / 导入，句柄不进备份。
  const backup =
    await js(`(async()=>{const {library}=await import('./src/core/store.mjs'),m=await import('./src/panels/backup.mjs');
    const books=new Map((await library('getAll')).map(b=>[b.id,b]));
    const out=await m.build({flush(){},books,thumbs:async()=>[]});const parsed=await m.parse(new File([out.blob],'b.json'));
    const json=JSON.parse(await out.blob.text());
    const pick=list=>list.map(b=>[b.title,b.pages.map(p=>[p.name,p.subs??null]),b.subPick??null]).sort((x,y)=>String(x[0]).localeCompare(String(y[0])));
    return {exported:pick(json.books),imported:pick(parsed.books)};})()`);
  const want = [
    [null, [['tune.wav', [{ file: 'tune.en.lrc' }, { file: 'tune.srt' }]]], null],
    [
      'Subs',
      [
        ['01 clip.webm', [{ file: '01 clip.srt' }, { file: '01 clip.zh.srt' }]],
        ['02 song.wav', null],
        ['03 bare.wav', [{ file: '03 bare.vtt' }]],
        ['04.svg', null],
        ['05 tall.svg', null],
      ],
      [{ id: '01 clip.webm', f: '01 clip.srt' }],
    ],
  ];
  assert.deepEqual(backup.exported, want);
  assert.deepEqual(backup.imported, want);

  // ---- 添加对话框与拖放：字幕都走同一套导入。文件夹里同名的字幕；「添加」对话框里用「＋文件」与媒体一起选入的散图字幕；
  // 之后单独加入图集的字幕（拖进「添加到散图图集」对话框的，以及直接拖到窗口的）。
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('More',{create:true}),side=await root.getDirectoryHandle('Side',{create:true});
    await mvMedia.write(dir,'m.wav',mvMedia.wav({seconds:2}));
    await mvMedia.write(dir,'m.srt',text('1\\n00:00:00,000 --> 00:00:02,000\\nMore\\n'));
    await mvMedia.write(side,'solo.wav',mvMedia.wav({seconds:2}));
    for(const n of ['solo.srt','solo.en.vtt','solo.ass','tune.zh.srt'])await mvMedia.write(side,n,text('1\\n00:00:00,000 --> 00:00:02,000\\n'+n+'\\n'));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#bar [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});
    window.showOpenFilePicker=async()=>[await side.getFileHandle('solo.wav'),await side.getFileHandle('solo.srt')];addFiles.click();
    await new Promise(r=>{const w=()=>addList.children.length===3?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(async () => (await record('More'))?.pages?.length === 1, 'folder book from the dialog');
  assert.deepEqual(subsOf(await record('More')), { 'm.wav': ['m.srt'] }, 'Subtitle in a folder added from the dialog');
  await wait(async () => !!subsOf(await atlas())['solo.wav'], 'loose media from the dialog');
  assert.deepEqual(subsOf(await atlas())['solo.wav'], ['solo.srt'], 'Picked together with its media');
  await js(`(async()=>{const side=await (await navigator.storage.getDirectory()).getDirectoryHandle('Side');
    DataTransferItem.prototype.getAsFileSystemHandle=function(){return Promise.resolve(window.queue.shift()??null);};
    window.showOpenFilePicker=async()=>[await side.getFileHandle('solo.en.vtt')];document.querySelector('#bar [data-act="files"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});
    window.queue=[await side.getFileHandle('tune.zh.srt')];const dt=new DataTransfer();dt.items.add(new File([],'x'));
    addList.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
    await new Promise(r=>{const w=()=>addList.children.length===2?r():setTimeout(w,10);w();});addLoose.click();})()`);
  await wait(async () => subsOf(await atlas())['solo.wav'].length === 2, 'subtitle picked later');
  await wait(async () => subsOf(await atlas())['tune.wav'].length === 3, 'subtitle dropped into the dialog later');
  await js(`(async()=>{const side=await (await navigator.storage.getDirectory()).getDirectoryHandle('Side');
    window.queue=[await side.getFileHandle('solo.ass')];const dt=new DataTransfer();dt.items.add(new File([],'x'));
    document.body.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);
  await wait(async () => subsOf(await atlas())['solo.wav'].length === 3, 'subtitle dropped on the window later');
  a = await atlas();
  assert.deepEqual(subsOf(a), {
    'tune.wav': ['tune.en.lrc', 'tune.srt', 'tune.zh.srt'],
    'solo.wav': ['solo.ass', 'solo.en.vtt', 'solo.srt'],
  });
  assert.ok(
    await js(
      `import('./src/core/store.mjs').then(async({library})=>(await library('getAll')).find(b=>!b.sources?.length).pages.every(p=>p.subs.every(e=>e.handle instanceof FileSystemFileHandle)))`,
    ),
    'Handles kept for the loose subtitles',
  );

  assert.deepEqual(errors, []);
  console.log(
    'PASS: subtitle matching on scan (not pages, nothing read), video overlay at the bottom following time (seek, playback), tags stripped, 3-line limit, menu for several subtitles (choice saved per media, GBK decoded), global on/off, audio card, disabled without subtitles, read once and cached across unload, refresh adds/removes subtitles, loose atlas pairing with stored handles and subtitles added later, backup export/import, subtitles through the add dialog (folder, files with media, added later) and drops',
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
