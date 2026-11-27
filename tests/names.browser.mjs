// 长名称的显示（书架卡片、工具栏书名、全屏界面标题、通知、读不出的页）：独立临时配置 + OPFS 测试图，不读取用户的书库或浏览器配置。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const binary = process.argv[2];
if (!binary) throw Error('Usage: node tests/names.browser.mjs <chrome-or-edge-executable>');
const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-names-'));
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
const chrome = spawn(
  binary,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--disable-background-networking',
    '--window-size=800,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let ws,
  id = 0;
const pending = new Map(),
  errors = [];
async function wait(check) {
  let last;
  for (let i = 0; i < 150; i++) {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await delay(50);
  }
  throw Error('Timed out: ' + check + '; last: ' + last);
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
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator,'languages',{value:['en-US']});`,
  });
  await cdp('Page.navigate', { url: origin });
  await wait(() => js('document.querySelector("#empty")?.hidden===false'));
  const LONG = '很长的作品名称 A very long work title '.repeat(5).trim(),
    FILE = 'Very long series name that goes on and on and on - Episode 012.png';
  await js(`(async()=>{const root=await navigator.storage.getDirectory();
    const svg=c=>'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="'+c+'"/></svg>';
    const put=async(dir,name,data)=>{const w=await (await dir.getFileHandle(name,{create:true})).createWritable();await w.write(data);await w.close();};
    for(const [n,c] of [['Short','teal'],[${JSON.stringify(LONG)},'navy']]){const d=await root.getDirectoryHandle(n,{create:true});for(let i=0;i<3;i++)await put(d,i+'.svg',svg(c));}
    await put(await root.getDirectoryHandle(${JSON.stringify(LONG)}),${JSON.stringify(FILE)},'not an image');
    const m=await root.getDirectoryHandle('M '+${JSON.stringify(LONG)},{create:true});for(const v of ['V1','V2'])await put(await m.getDirectoryHandle(v,{create:true}),'1.svg',svg('olive'));
    window.add=async(name,sel)=>{const d=await root.getDirectoryHandle(name);window.showDirectoryPicker=async()=>d;document.querySelector(sel).click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addMany.click();};})()`);
  await js(`add('Short','#empty [data-act="folder"]')`);
  await wait(() => js(`bookTitle.textContent==='Short'`));
  await js(`add(${JSON.stringify(LONG)},'#bar [data-act="folder"]')`);
  await wait(() => js(`bookTitle.textContent===${JSON.stringify(LONG)}`));
  const rect = (sel) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join()})()`,
    );
  const lines = (sel) =>
    js(
      `(()=>{const e=document.querySelector(${JSON.stringify(sel)}),s=getComputedStyle(e);return Math.round(e.clientHeight/parseFloat(s.lineHeight))})()`,
    );
  // 读不出的页：文件名单行、中间省略，结尾（集数、扩展名）完整；完整文件名在提示里。
  await js(`reader.scrollTop=reader.scrollHeight`);
  // 正文里放得下时完整显示；窄的缩略图栏里开头省略。
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`document.body.classList.contains('docked')`));
  for (const [failed, cut] of [
    ['#reader .page.failed', false],
    ['#preview .page.failed', true],
  ]) {
    await wait(() => js(`!!document.querySelector('${failed} .mid-name')`));
    const f = await js(
      `(()=>{const n=document.querySelector('${failed}'),m=n.querySelector('.mid-name'),h=m.firstElementChild;return {title:n.title,tail:m.lastChild.textContent,text:m.textContent,cut:h.scrollWidth>h.clientWidth,one:m.getBoundingClientRect().height<parseFloat(getComputedStyle(m).lineHeight)*1.5||m.getBoundingClientRect().height<24,inside:m.getBoundingClientRect().width<=n.getBoundingClientRect().width}})()`,
    );
    assert.equal(f.title, FILE);
    assert.equal(f.text, FILE);
    assert.equal(f.tail, 'sode 012.png');
    assert.equal(f.cut, cut, failed + ': head ellipsized only when narrow');
    assert.ok(f.one && f.inside, failed + ': one line inside the page');
  }
  await shot('names-failed');
  await js(`document.querySelector('#bar [data-act="preview"]').click()`);
  await wait(() => js(`!document.body.classList.contains('docked')`));
  // 工具栏书名：单行、末尾省略，完整书名在提示里，可悬停；名称区整块是按钮，文字不可选中；工具栏按钮位置与短书名时相同。
  const tbLefts = () =>
    js(
      `[...bar.querySelectorAll('.tb')].filter(b=>!b.hidden).map(b=>Math.round(b.getBoundingClientRect().left)).join()`,
    );
  await js('reader.focus()');
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 't',
    code: 'KeyT',
    windowsVirtualKeyCode: 84,
    text: 't',
  });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84 });
  await wait(() => js('!bar.hidden'));
  await delay(300);
  const tb = await js(
    `(()=>{const t=bookTitle,s=getComputedStyle(t),r=barTitle.getBoundingClientRect();return {title:t.title,tip:barTitle.title,cut:t.scrollWidth>t.clientWidth,one:t.clientHeight<parseFloat(s.lineHeight)*1.5,pe:s.pointerEvents,us:s.userSelect,inside:r.left>=0&&r.right<=innerWidth}})()`,
  );
  assert.deepEqual(tb, { title: LONG, tip: LONG, cut: true, one: true, pe: 'auto', us: 'none', inside: true });
  const longLefts = await tbLefts();
  await shot('names-toolbar');
  await js(`document.querySelector('#controlbar [data-act="prev"]').click()`);
  await wait(() => js(`bookTitle.textContent==='Short'`));
  await delay(300);
  assert.equal(await tbLefts(), longLefts, 'Toolbar buttons do not move with the title length');
  // 全屏缩略图标题：单行省略，完整书名在提示里；标题行的按钮位置与短书名时相同。
  const ov = async () => {
    await js('reader.focus()');
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      text: 'v',
    });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 });
    await wait(() => js('document.querySelector("dialog.overview[open]")!==null'));
    await delay(250);
    return js(
      `(()=>{const d=document.querySelector('dialog.overview[open]'),h=d.querySelector('.ov-head'),t=d.querySelector('.ov-title');return {title:t.title,cut:t.scrollWidth>t.clientWidth,fits:h.scrollWidth<=h.clientWidth,btns:[...h.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return Math.round(r.left)+'/'+Math.round(r.width)}).join()+' '+Math.round(d.querySelector('.ov-pos').getBoundingClientRect().width),dbg:[...h.children].map(b=>b.className+':'+Math.round(b.getBoundingClientRect().left)+'/'+Math.round(b.getBoundingClientRect().width)).join(' ')+' hw'+h.clientWidth+' sw'+h.scrollWidth}})()`,
    );
  };
  const closeOv = async () => {
    await js(`document.querySelector('dialog.overview[open]').close()`);
    await delay(100);
  };
  const so = await ov();
  await closeOv();
  await js(`document.querySelector('#controlbar [data-act="next"]').click()`);
  await wait(() => js(`bookTitle.textContent===${JSON.stringify(LONG)}`));
  const lo = await ov();
  await shot('names-overview');
  await closeOv();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: false });
  const narrow = await ov();
  await closeOv();
  await cdp('Emulation.clearDeviceMetricsOverride');
  await delay(200);
  assert.ok(narrow.fits, 'Overview header fits at 360px');
  assert.equal(lo.title, LONG);
  assert.ok(lo.cut && lo.fits, 'Overview title is ellipsized inside the header');
  assert.equal(lo.btns, so.btns, 'Hint, position and buttons keep their place and size ' + so.dbg + ' || ' + lo.dbg);
  // 书架卡片：书名最多两行、末尾省略，完整书名在提示里；卡片尺寸与短书名相同。
  await js(`barTitle.click()`);
  await wait(() => js('shelf.open'));
  const card = (n) =>
    `[...document.querySelectorAll('#books .book')].find(b=>b.querySelector('.name').textContent===${JSON.stringify(n)})`;
  await wait(() => js(`!!(${card(LONG)})&&!!(${card('Short')})`));
  const c =
    await js(`(()=>{const l=${card(LONG)},s=${card('Short')},n=l.querySelector('.name'),st=getComputedStyle(n),a=l.getBoundingClientRect(),b=s.getBoundingClientRect();
    return {title:n.title,lines:Math.round(n.clientHeight/parseFloat(st.lineHeight)),cut:n.scrollHeight>n.clientHeight+1,same:Math.round(a.width)===Math.round(b.width)&&Math.round(a.height)===Math.round(b.height)}})()`);
  assert.deepEqual(c, { title: LONG, lines: 2, cut: true, same: true });
  await shot('names-shelf');
  // 通知：书名按字符截短（末尾省略），通知保持简短。
  await js(
    `(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('M '+${JSON.stringify(LONG)});window.showDirectoryPicker=async()=>d;document.querySelector('#shelf [data-act="folder"]').click();await new Promise(r=>{const w=()=>addDialog.open?r():setTimeout(w,10);w();});addOne.click();})()`,
  );
  const { clipEnd } = await import('../src/core/model.mjs');
  await wait(() => js(`notice.textContent.includes(${JSON.stringify(clipEnd('M ' + LONG))})`));
  assert.ok(
    await js(
      `notice.getBoundingClientRect().height<=parseFloat(getComputedStyle(notice).lineHeight||'20')*2+24||notice.getBoundingClientRect().height<=64`,
    ),
    'Notice stays within two lines',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: long names: middle-ellipsized file names with intact endings, one-line toolbar title with tooltip (a button, not selectable) and stable buttons, overview title, two-line shelf card titles with tooltips and stable card size, clipped names in notices',
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
