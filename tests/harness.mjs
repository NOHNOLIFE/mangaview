// 浏览器测试的共用骨架（新测试用它，不再复制启动代码）：临时配置目录、本地静态服务器、静音的无头浏览器（tests/chrome.mjs）、
// CDP 连接与常用工具，结束时检查页面没有抛出异常并清理。只用测试自己生成的临时数据（开发约定第 0 节）。
// 用法（tests/smoke.browser.mjs 是最小的例子）：
//   import assert from 'node:assert/strict';
//   import { browserTest } from './harness.mjs';
//   await browserTest({ name: 'myfeature', media: true }, async ({ js, wait, tap, shot }) => {
//     await wait(() => js('...'), 'what we wait for');
//     assert.equal(await js('...'), 1);
//     return 'one line saying what was covered';   // 打印为 "PASS: …"
//   });
// 选项：name（临时目录前缀）；size（窗口 '宽,高'，默认 800,900）；autoplay（关掉浏览器的自动播放拦截，媒体测试用）；
//   media（注入 tests/media-fixtures.mjs 的 mvMedia 与 mvCtx）；lang（navigator.languages，默认 zh-CN）；
//   open（是否自动打开应用首页，默认 true）；serve(path, data) → data（改写服务器返回的文件，如模拟新版本）。
// 传给测试体的工具：origin、cdp(method, params)、js(表达式)（awaitPromise，返回值）、wait(check, 说明)（轮询到真值，约 10 秒超时）、
//   delay(ms)、shot(name)（设了环境变量 MV_SHOTS=目录 时截图存进去）、click(x, y)、tap(选择器)（真实鼠标点击元素中心）、
//   move(x, y)、key(键, {code, shift})、errors（页面抛出的异常，结束时必须为空）。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launch } from './chrome.mjs';
import { MEDIA_FIXTURES, CTX_HOOK } from './media-fixtures.mjs';

const MIME = {
  mjs: 'text/javascript',
  js: 'text/javascript',
  html: 'text/html',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  css: 'text/css',
};

export async function browserTest(
  { name = 'test', size = '800,900', autoplay = false, media = false, lang = 'zh-CN', open = true, serve = null } = {},
  body,
) {
  const binary = process.argv[2];
  if (!binary) throw Error('Usage: node tests/<name>.browser.mjs <chrome-or-edge-executable>');
  const profile = await mkdtemp(join(process.env.MV_TEST_TEMP || tmpdir(), 'mv-' + name + '-'));
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
      if (!/^(?:[\w-]+\/)*[\w.-]+$/.test(path)) throw Error();
      let data = await readFile(new URL('../' + path, import.meta.url));
      if (serve) data = (await serve(path, data)) ?? data;
      res.writeHead(200, { 'Content-Type': MIME[path.split('.').pop()], 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port + '/';
  const chrome = launch(binary, profile, { size, autoplay });
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
    const port = await wait(
      async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
      'browser start',
    );
    const target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(
      (t) => t.type === 'page',
    );
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
    const shot = async (file) => {
      if (!process.env.MV_SHOTS) return;
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.MV_SHOTS, file + '.png'), Buffer.from(data, 'base64'));
    };
    const move = (x, y) => cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    const click = async (x, y) => {
      await move(x, y);
      for (const type of ['mousePressed', 'mouseReleased'])
        await cdp('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x, y });
    };
    const tap = async (sel) => {
      const [x, y] = await js(
        `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`,
      );
      await click(x, y);
    };
    const key = async (k, { code = k.length === 1 ? 'Key' + k.toUpperCase() : k, shift = false } = {}) => {
      const p = { key: k, code, modifiers: shift ? 8 : 0 };
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...p, text: k.length === 1 ? k : undefined });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    };
    await cdp('Runtime.enable');
    await cdp('Page.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(navigator,'languages',{value:[${JSON.stringify(lang)}]});`,
    });
    if (media) {
      await cdp('Page.addScriptToEvaluateOnNewDocument', { source: CTX_HOOK });
      await cdp('Page.addScriptToEvaluateOnNewDocument', { source: MEDIA_FIXTURES });
    }
    if (open) {
      await cdp('Page.navigate', { url: origin });
      await wait(() => js('document.readyState==="complete"&&!!document.querySelector("#reader")'), 'the app loads');
    }
    const said = await body({ origin, cdp, js, wait, delay, shot, move, click, tap, key, errors });
    assert.deepEqual(errors, [], 'No uncaught errors in the page');
    console.log('PASS: ' + (said || name));
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
}
