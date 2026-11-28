// 统一的测试入口（无依赖）：
//   node tests/run.mjs                                  只跑核心测试（tests/core/*.test.mjs）
//   node tests/run.mjs "<浏览器路径>" [名称…] [--jobs=N]  先跑核心测试，再并行跑浏览器测试（tests/browser.mjs 与 tests/*.browser.mjs），
//                                                       给了名称时只跑文件名包含其中任一名称的浏览器测试
// 并行：同时最多 N 个浏览器测试（默认 4，也可用环境变量 MV_JOBS；--jobs=1 即串行）。每个测试用自己的临时配置、端口，互不相干；
// 各文件的输出攒到它结束时一次打印，不互相穿插。量性能的测试（SOLO）在其余都跑完之后单独跑；失败的最后逐个单独重跑一次
// （排除并行时偶发的时序超时）。
// 最后列出通过 / 失败清单、最慢的几个文件和总用时，有失败时退出码为 1。测试里的浏览器一律静音启动（tests/chrome.mjs）。
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2),
  flags = argv.filter((a) => a.startsWith('--')),
  [browser, ...filters] = argv.filter((a) => !a.startsWith('--'));
const jobsArg = flags.find((a) => a.startsWith('--jobs='))?.slice(7) ?? process.env.MV_JOBS,
  JOBS = Math.max(1, Math.floor(Number(jobsArg)) || 4);
if (
  browser &&
  !(await stat(browser).then(
    (s) => s.isFile(),
    () => false,
  ))
) {
  console.error(
    'Browser not found: ' +
      browser +
      '\nUsage: node tests/run.mjs ["<chrome-or-edge-executable>" [name...] [--jobs=N]]',
  );
  process.exit(2);
}
const LIMIT = 10 * 60 * 1000; // 单个测试文件的时限
// 最慢的几个文件排在最前面开跑（否则按字母序排在末尾的慢文件会单独拖长总用时）；按结尾「Slowest」一行的结果维护。
const SLOW = ['transport', 'dragscroll', 'help', 'sections'];
const SOLO = ['readinglist'];
const rank = (f) => {
  const i = SLOW.indexOf(f.replace('.browser.mjs', ''));
  return i < 0 ? SLOW.length : i;
};
const secs = (ms) => (ms / 1000).toFixed(1) + ' s';
// 跑一个测试进程：输出攒起来，结束时连同用时一次打印。→ {ok, ms}
function run(args, label, brief = false) {
  return new Promise((resolve) => {
    const t0 = Date.now(),
      out = [];
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => out.push(d));
    let done = false;
    const finish = (ok, note = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ms = Date.now() - t0;
      console.log('\n=== ' + label + ' — ' + (ok ? 'ok' : 'FAILED') + ', ' + secs(ms) + ' ===');
      let text = Buffer.concat(out).toString().trimEnd();
      // 核心测试通过时只留统计行（逐条的 ✔ 很长）；失败时原样打印。
      if (brief && ok)
        text = text
          .split('\n')
          .filter((l) => /^ℹ (tests|pass|fail) /.test(l))
          .join('\n');
      if (text) console.log(text);
      if (note) console.error(note);
      resolve({ ok, ms });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false, label + ': timed out after ' + LIMIT / 1000 + ' s');
    }, LIMIT);
    child.on('exit', (code) => finish(code === 0));
    child.on('error', (e) => finish(false, String(e)));
  });
}
const started = Date.now(),
  passed = [],
  failed = [],
  times = [];
((await run(['--test', 'tests/core/*.test.mjs'], 'core', true)).ok ? passed : failed).push('core');
if (browser) {
  const files = (await readdir(new URL('./', import.meta.url)))
    .filter((f) => f === 'browser.mjs' || f.endsWith('.browser.mjs'))
    .sort()
    .filter((f) => !filters.length || filters.some((n) => f.includes(n)))
    .sort((a, b) => rank(a) - rank(b));
  console.log('\nBrowser tests: ' + files.length + ' file(s), ' + Math.min(JOBS, files.length || 1) + ' at a time');
  // SOLO 里的文件量的是性能（帧时间），并行时会被别的浏览器拖慢：其余都跑完之后单独跑。
  const queue = files.filter((f) => !SOLO.includes(f.replace('.browser.mjs', ''))),
    alone = files.filter((f) => !queue.includes(f)),
    again = [];
  const one = async (f) => {
    const r = await run(['tests/' + f, browser], f);
    times.push([f, r.ms]);
    if (r.ok) passed.push(f);
    else again.push(f);
  };
  await Promise.all(
    Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
      for (let f; (f = queue.shift());) await one(f);
    }),
  );
  for (const f of alone) await one(f);
  for (const f of again) {
    const r = await run(['tests/' + f, browser], f + ' (retry, alone)');
    (r.ok ? passed : failed).push(f);
  }
  if (again.length) console.log('\nRetried: ' + again.join(', '));
}
console.log('\nPassed (' + passed.length + '): ' + (passed.sort().join(', ') || '-'));
console.log('Failed (' + failed.length + '): ' + (failed.sort().join(', ') || '-'));
if (times.length > 1)
  console.log(
    'Slowest: ' +
      times
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([f, ms]) => f.replace('.browser.mjs', '') + ' ' + secs(ms))
        .join(', '),
  );
console.log('Total: ' + secs(Date.now() - started));
if (!browser)
  console.log('Browser tests skipped: node tests/run.mjs "<chrome-or-edge-executable>" [name...] [--jobs=N]');
process.exit(failed.length ? 1 : 0);
