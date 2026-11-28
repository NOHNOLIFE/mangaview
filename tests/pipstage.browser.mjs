// 画中画面板的内容区与主窗口的画面是同一套交互（src/media/surface.mjs）、同一个提示浮层（src/media/hud.mjs）：
// 单击播放 / 暂停（按钮、占位的「在画中画显示」除外，拖动之后不算），横向拖动定位，竖向拖动什么也不做；
// 面板里的操作（内容区拖动、窗口里的按键、时间处的快退 / 快进）提示都显示在面板里，样式与主窗口的相同、随内容区缩放；
// 音频没有字幕时的音柱横向铺满、带与字幕相同的深色底（页内音频卡片的不变）；字幕加大、离底部 max(28px, 12%)，浮出的功能栏盖住时让到它上面。
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
if (!binary) throw Error('Usage: node tests/pipstage.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-pipstage-'));
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // 测试里经 ctx 调用接口：ctx 不暴露到全局，这里在它被赋上 fileBar 时记下（只在测试页里）。
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});localStorage.setItem('mv2:autoplay','false');
    Object.defineProperty(Object.prototype,'fileBar',{configurable:true,set(v){Object.defineProperty(this,'fileBar',{value:v,writable:true,configurable:true,enumerable:true});window.mvCtx=this;}});`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  await js(MEDIA_FIXTURES);
  // 一本书：视频（8 秒，配一条从头到尾的字幕）、音频（9 秒，没有字幕）、图片。
  const CLIP = '01 clip.webm',
    SONG = '02 song.wav';
  await js(`(async()=>{const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('Stage',{create:true});
    await mvMedia.write(dir,'01 clip.webm',await mvMedia.webm({seconds:8,width:640,height:360}));
    await mvMedia.write(dir,'01 clip.srt',new Blob(['1\\n00:00:00,000 --> 00:00:30,000\\nHello there\\n'],{type:'text/plain'}));
    await mvMedia.write(dir,'02 song.wav',mvMedia.wav({seconds:9}));
    await mvMedia.write(dir,'03.svg',new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="teal"/></svg>'],{type:'image/svg+xml'}));
    window.showDirectoryPicker=async()=>dir;document.querySelector('#empty [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();})()`);
  await wait(() => js(`!!document.querySelector('#reader .page[data-name="01 clip.webm"]')`), 'book opened');
  await js(`window.frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
    window.node=name=>reader.querySelector('.page[data-name="'+CSS.escape(name)+'"]');
    window.P=name=>mvCtx.player.list().find(p=>p.page.name===name)??null;
    window.elOf=name=>P(name)?.el??null;
    window.track=()=>mvCtx.media.queue.track()?.page.name??null;
    window.toPage=async name=>{let from=0;for(let i=0;i<300;i++){const n=node(name);if(!n){reader.scrollTop=from;from+=300;await frame();continue;}
      const want=n.offsetTop+n.offsetHeight/2-reader.clientHeight/2;if(Math.abs(reader.scrollTop-Math.max(0,Math.min(want,reader.scrollHeight-reader.clientHeight)))<1&&i>2){await frame();if(Math.abs(n.offsetTop+n.offsetHeight/2-reader.clientHeight/2-want)<1)return true;}
      reader.scrollTop=want;await frame();}return false;};
    window.W=()=>mvCtx.pip.window();window.D=()=>W()?.document??null;
    window.pq=s=>D()?.querySelector(s)??null;
    window.pkey=(key,code,type='keydown')=>D().body.dispatchEvent(new (W().KeyboardEvent)(type,{key,code,bubbles:true,cancelable:true}));
    window.mainHud=()=>document.querySelector('body>.mv-hud');
    window.hudOf=root=>{const h=root.querySelector('.pip-stage>.mv-hud');return h&&!h.hidden?h.querySelector('.mv-hud-text').textContent:null;};`);
  const mouse = (type, x, y) =>
    cdp('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    });
  const at = (name, t) => wait(() => js(`Math.abs(elOf('${name}').currentTime-${t})<0.05`), name + ' at ' + t);
  const paused = (name) => js(`elOf('${name}').paused`);

  // ---- 面板装进普通容器（无头模式下画中画窗口的大小不受控制，布局与真实鼠标在这里断言），当前曲目是视频，暂停在 1 秒。
  assert.ok(await js(`toPage('${CLIP}')`));
  await tap(`#reader .page[data-name="${CLIP}"]`);
  await wait(() => js(`track()==='${CLIP}'&&!elOf('${CLIP}').paused`), 'clip plays');
  await js(`mvCtx.media.queue.toggle()`);
  await wait(() => paused(CLIP), 'paused');
  await js(
    `window.box=document.createElement('div');box.style.cssText='position:fixed;left:8px;top:8px;width:480px;height:480px;z-index:50';document.body.append(box);window.view=mvCtx.pip.mount(box);mvCtx.media.stage.take(view.screen);`,
  );
  await js('view.ready.then(frame).then(frame)');
  await js(`elOf('${CLIP}').currentTime=1`);
  await at(CLIP, 1);
  const top = await js('reader.scrollTop');
  const B = (x, y) => [8 + x, 8 + y]; // 容器内坐标 → 页面坐标
  const dockShown = () => js(`getComputedStyle(box.querySelector('.pip-dock')).visibility==='visible'`);

  // ---- 字幕：字号随内容区宽度（6cqw，约为原来的 1.2 倍），离内容区底部 max(28px, 12%)；浮出的功能栏盖住时让到它上面。
  await wait(() => js(`!!box.querySelector('.mv-screen .mv-cue:not([hidden])')`), 'subtitle shown');
  const subs = () =>
    js(`(async()=>{await frame();const s=box.querySelector('.pip-stage').getBoundingClientRect(),c=box.querySelector('.mv-screen .mv-cue'),r=c.getBoundingClientRect(),d=box.querySelector('.pip-dock').getBoundingClientRect();
      return {gap:s.bottom-r.bottom,want:Math.max(28,s.height*0.12),font:parseFloat(getComputedStyle(c).fontSize),width:s.width,dockTop:d.top,bottom:r.bottom,text:c.textContent};})()`);
  let s = await subs();
  assert.equal(s.text, 'Hello there');
  assert.ok(Math.abs(s.gap - s.want) < 1, 'Subtitles sit max(28px, 12%) above the bottom ' + JSON.stringify(s));
  assert.ok(Math.abs(s.font - s.width * 0.06) < 0.5 && s.font > 26, 'Larger subtitles ' + JSON.stringify(s));
  await shot('pipstage-subtitles');
  await mouse('mouseMoved', ...B(100, 470));
  await wait(dockShown, 'controls float out');
  await delay(300); // 字幕上移的过渡
  s = await subs();
  assert.ok(s.bottom <= s.dockTop - 11, 'Subtitles make room for the floating controls ' + JSON.stringify(s));
  await mouse('mouseMoved', ...B(100, 100));
  await wait(async () => !(await dockShown()), 'controls fade out');

  // ---- 单击内容区：播放 / 暂停当前曲目（与主窗口点画面一样），主窗口不滚动、不翻屏。
  await click(...B(240, 200));
  await wait(async () => !(await paused(CLIP)), 'a click plays');
  await click(...B(240, 200));
  await wait(() => paused(CLIP), 'a click pauses');
  assert.deepEqual([await js('reader.scrollTop'), await js('track()')], [top, CLIP], 'Nothing else happens');
  await js(`elOf('${CLIP}').currentTime=1`);
  await at(CLIP, 1);

  // ---- 横向拖动：提示显示在面板里（不在主窗口），与主窗口的提示同一个样子（只按内容区缩放），在内容区中上部；松手定位，不算点击。
  await mouse('mousePressed', ...B(100, 150));
  for (let x = 100; x <= 180; x += 20) {
    await mouse('mouseMoved', ...B(x, 151));
    await js('frame()');
  }
  assert.deepEqual([await js('hudOf(box)'), await js('mainHud().hidden')], ['+0:01 → 0:02', true], 'Hint in the panel');
  const look = (sel) =>
    js(`(()=>{const h=${sel},c=getComputedStyle(h),i=getComputedStyle(h.querySelector('.i')),f=parseFloat(c.fontSize),px=v=>Math.round(parseFloat(v)/f*100)/100;
      return {border:c.borderTopWidth+' '+c.borderTopStyle+' '+c.borderTopColor,bg:c.backgroundColor,shadow:c.boxShadow,weight:c.fontWeight,radius:px(c.borderTopLeftRadius),
        pad:[px(c.paddingTop),px(c.paddingLeft)],gap:px(c.columnGap),icon:[px(i.width),i.color],bar:px(getComputedStyle(h.querySelector('.mv-hud-bar')).width)};})()`);
  const pipHud = `box.querySelector('.pip-stage>.mv-hud')`;
  const mainLook = await look('mainHud()');
  assert.deepEqual(await look(pipHud), mainLook, 'The same hint as in the main window');
  const place = () =>
    js(`(()=>{const s=box.querySelector('.pip-stage').getBoundingClientRect(),h=box.querySelector('.pip-stage>.mv-hud'),r=h.getBoundingClientRect();
      return {mid:Math.abs((r.left+r.right)/2-(s.left+s.right)/2)<1,top:Math.round((r.top-s.top)/s.height*100),inside:r.left>=s.left&&r.right<=s.right&&r.top>=s.top&&r.bottom<=s.bottom,font:parseFloat(getComputedStyle(h).fontSize)};})()`);
  assert.deepEqual(
    await place(),
    { mid: true, top: 18, inside: true, font: 14 },
    'Upper middle of the content, full size',
  );
  await shot('pipstage-hud');
  await mouse('mouseReleased', ...B(180, 151));
  await at(CLIP, 2);
  await delay(300);
  assert.equal(await paused(CLIP), true, 'Dragging is not a click');
  await wait(() => js('hudOf(box)===null'), 'the hint hides after release');

  // ---- 竖向拖动：什么也不做（不定位、不滚动主窗口、不算点击、没有提示）。
  await mouse('mousePressed', ...B(240, 100));
  for (let y = 120; y <= 300; y += 30) await mouse('mouseMoved', ...B(242, y));
  assert.equal(await js('hudOf(box)'), null);
  await mouse('mouseReleased', ...B(242, 300));
  await delay(300);
  assert.deepEqual(
    [await js(`elOf('${CLIP}').currentTime`), await paused(CLIP), await js('reader.scrollTop')],
    [2, true, top],
    'A vertical drag does nothing',
  );

  // ---- 内容区变小：提示随之缩小（同样的比例），不出内容区；Esc 取消。
  await js(`box.style.width='260px';box.style.height='300px'`);
  await js('frame().then(frame)');
  await mouse('mousePressed', ...B(60, 100));
  for (let x = 60; x <= 140; x += 20) await mouse('mouseMoved', ...B(x, 101));
  await wait(() => js('hudOf(box)!==null'), 'hint in the small panel');
  assert.deepEqual(await place(), { mid: true, top: 18, inside: true, font: 11 }, 'Scaled down with the content');
  assert.deepEqual(await look(pipHud), mainLook, 'Same proportions');
  await shot('pipstage-hud-small');
  await key('Escape', 'Escape', 27);
  await mouse('mouseReleased', ...B(140, 101));
  await delay(300);
  assert.equal(await js(`elOf('${CLIP}').currentTime`), 2, 'Esc cancels');
  await js(`box.style.width='480px';box.style.height='480px'`);
  await js('frame().then(frame)');

  // ---- 时间处的快退 / 快进（键盘点按一次 2 秒）：提示同样在面板里。
  await js(`box.querySelector('.pip-time .mv-step[data-d="1"]').click()`);
  assert.deepEqual(
    [await js('hudOf(box)'), await js('mainHud().hidden')],
    ['+0:02 → 0:04', true],
    'Time buttons hint in the panel',
  );
  await at(CLIP, 4);

  // ---- 音频：没有字幕时的音柱横向铺满内容区（左右各留 10px）、带与字幕相同的深色圆角底；单击整个内容区（图上）播放 / 暂停。
  await js(`(()=>{const q=mvCtx.media.queue;q.play(q.items().find(i=>i.page.name==='${SONG}'));})()`);
  await wait(
    () => js(`track()==='${SONG}'&&!!box.querySelector('.pip-screen audio')&&!elOf('${SONG}').paused`),
    'song in the panel',
  );
  await js(`mvCtx.media.queue.toggle()`);
  await wait(() => paused(SONG), 'song paused');
  await wait(() => js(`box.querySelector('.pip-stage').classList.contains('nosubs')`), 'no subtitles');
  const bars =
    await js(`(()=>{const s=box.querySelector('.pip-stage').getBoundingClientRect(),b=box.querySelector('.mv-screen .mv-bars'),r=b.getBoundingClientRect(),c=getComputedStyle(b);
    const probe=document.body.appendChild(Object.assign(document.createElement('div'),{className:'mv-cue'})),cue=getComputedStyle(probe),bg=cue.backgroundColor,rad=cue.borderTopLeftRadius;probe.remove();
    const i=[...b.children].map(x=>x.getBoundingClientRect()),R=Math.round;
    return {shown:c.display,left:R(r.left-s.left),right:R(s.right-r.right),gap:Math.abs(s.bottom-r.bottom-Math.max(28,s.height*0.12))<1,bg:c.backgroundColor===bg,radius:c.borderTopLeftRadius===rad,
      n:i.length,first:R(i[0].left-r.left),last:R(r.right-i.at(-1).right),even:Math.abs(i[0].width-i.at(-1).width)<0.5&&i[0].width>8};})()`);
  assert.deepEqual(
    bars,
    { shown: 'flex', left: 10, right: 10, gap: true, bg: true, radius: true, n: 24, first: 10, last: 10, even: true },
    'Bars across the content on a dark background',
  );
  await shot('pipstage-bars');
  await click(...B(240, 120));
  await wait(async () => !(await paused(SONG)), 'a click on the art plays');
  await click(...B(240, 120));
  await wait(() => paused(SONG), 'and pauses');

  // ---- 画面收回页内：页内音频卡片的音柱不变（窄柱、没有底色）；占位上的「在画中画显示」只把画面收进来、不播放，占位的其余地方单击播放 / 暂停。
  assert.ok(await js(`toPage('${SONG}')`));
  await js(`mvCtx.media.stage.back()`);
  await wait(
    () => js(`!box.querySelector('.pip-idle').hidden&&!!node('${SONG}').querySelector('.mv-card .mv-bars')`),
    'back in the page',
  );
  assert.deepEqual(
    await js(
      `(()=>{const b=node('${SONG}').querySelector('.mv-bars'),c=getComputedStyle(b);return [c.display,c.backgroundColor,Math.round(b.querySelector('i').getBoundingClientRect().width)];})()`,
    ),
    ['flex', 'rgba(0, 0, 0, 0)', 6],
    'The audio card keeps its bars',
  );
  const show = await js(
    `(()=>{const r=box.querySelector('.pip-show').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
  );
  await click(...show);
  await wait(() => js(`mvCtx.media.stage.where()==='out'&&!!box.querySelector('.pip-screen audio')`), 'shown here');
  await delay(200);
  assert.equal(await paused(SONG), true, 'The button only moves the picture');
  await js(`mvCtx.media.stage.back()`);
  await wait(() => js(`!box.querySelector('.pip-idle').hidden`), 'placeholder');
  await click(...B(240, 40));
  await wait(async () => !(await paused(SONG)), 'a click on the placeholder plays');
  await js(`mvCtx.media.queue.toggle()`);
  await wait(() => paused(SONG), 'paused again');
  await js(`view.destroy();box.remove()`);

  // ---- 真实的画中画窗口：窗口里的按键（← →、Q / E）、时间处的按钮、单击内容区；提示都显示在窗口里，不在主窗口。
  const pipTarget = async () => {
    const t = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(
      (x) => x.type === 'page' && x.url === 'about:blank',
    );
    const w = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => w.addEventListener('open', r, { once: true }));
    let n = 0;
    const back = new Map();
    w.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id && back.has(m.id)) {
        back.get(m.id)(m.result);
        back.delete(m.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((r) => {
        back.set(++n, r);
        w.send(JSON.stringify({ id: n, method, params }));
      });
    return { send, close: () => w.close() };
  };
  await js('reader.focus()');
  await key('z', 'KeyZ', 90);
  await wait(() => js(`!!pq('.pip-screen audio')&&!elOf('${SONG}').paused`), 'song in the window');
  await js(`mvCtx.media.queue.toggle()`);
  await wait(() => paused(SONG), 'paused in the window');
  await js(`elOf('${SONG}').currentTime=1`);
  await at(SONG, 1);
  await js(`pkey('ArrowRight','ArrowRight');pkey('ArrowRight','ArrowRight','keyup')`);
  assert.deepEqual(
    [await js('hudOf(D())'), await js('mainHud().hidden')],
    ['+0:02 → 0:03', true],
    '→ hint in the window',
  );
  await at(SONG, 3);
  const vol = await js('mvCtx.media.volume');
  await js(`pkey('q','KeyQ')`);
  assert.deepEqual(
    await js(
      `[hudOf(D()),pq('.pip-stage>.mv-hud .mv-hud-bar').hidden,pq('.pip-stage>.mv-hud .mv-hud-bar').style.getPropertyValue('--v'),mainHud().hidden]`,
    ),
    [Math.round((vol - 0.05) * 100) + '%', false, String(Math.round((vol - 0.05) * 100) / 100), true],
    'Q: the volume hint with its bar in the window',
  );
  await js(`pkey('e','KeyE')`);
  await js(`pq('.pip-time .mv-step[data-d="-1"]').click()`);
  assert.deepEqual(
    [await js('hudOf(D())'), await js('mainHud().hidden')],
    ['−0:02 → 0:01', true],
    'Time buttons in the window',
  );
  await at(SONG, 1);
  // 真实鼠标在窗口里单击内容区：播放，再单击暂停。
  const pip = await pipTarget();
  const mid = await js(
    `(()=>{const r=pq('.pip-stage').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height*0.3];})()`,
  );
  const pclick = async ([x, y]) => {
    await pip.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'])
      await pip.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1,
      });
  };
  await pclick(mid);
  await wait(async () => !(await paused(SONG)), 'a click in the window plays');
  if (process.env.MV_SHOTS) {
    await js(`pkey('ArrowRight','ArrowRight');pkey('ArrowRight','ArrowRight','keyup')`);
    const { data } = await pip.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(process.env.MV_SHOTS, 'pipstage-window.png'), Buffer.from(data, 'base64'));
  }
  await pclick(mid);
  await wait(() => paused(SONG), 'and pauses');
  // 拖动：横向定位，提示在窗口里；拖动之后不算点击。
  await pip.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: mid[0] - 60,
    y: mid[1],
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let dx = -40; dx <= 40; dx += 20)
    await pip.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: mid[0] + dx,
      y: mid[1] + 1,
      button: 'left',
      buttons: 1,
    });
  await wait(() => js('hudOf(D())?.startsWith("+")'), 'drag hint in the window');
  assert.equal(await js('mainHud().hidden'), true);
  await pip.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: mid[0] + 40,
    y: mid[1] + 1,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await wait(() => js(`elOf('${SONG}').currentTime>1.5`), 'dragging seeks in the window');
  await delay(300);
  assert.equal(await paused(SONG), true, 'Dragging in the window is not a click');
  pip.close();
  await js(`mvCtx.pip.close()`);

  assert.deepEqual(errors, []);
  console.log(
    'PASS: picture-in-picture content area: click plays / pauses (not the show-here button, not after a drag; the placeholder too), sideways drag seeks, vertical drag does nothing, the same hint as the main window (upper middle, scaled with the content) for drags, keys (arrows, Q / E with the volume bar) and the time buttons, never in the main window; bars across the content on a dark background for audio without subtitles (the audio card keeps its own); larger subtitles max(28px, 12%) above the bottom, above the floating controls',
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
