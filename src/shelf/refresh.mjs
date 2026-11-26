// 刷新：按源（文件夹）列目录更新书（sync）；全部刷新（refreshAll：启动时的自动检查与手动刷新）；切回窗口时检查当前书。
import { timed, listDir, applyNames, settle, down } from '../core/sources.mjs';
import { fmt } from '../core/locale.mjs';
import { emit } from '../core/events.mjs';
import { books, persist } from '../core/books.mjs';
import { expired, probeAll } from '../core/status.mjs';
import { notice, safe } from '../ui/dom.mjs';
import { current, here } from '../reader/session.mjs';
import { arrange } from '../reader/sort.mjs';
import { sameDir } from './relink.mjs';
let ctx;
// 刷新：以源（文件夹）为单位，只列目录、不读图；同一个文件夹被多本书引用时只列一次，结果同步到所有引用它的书。
// 浏览器无法区分“文件夹已删除”和“移动硬盘未连接”，所以找不到的源只做标记：全部源都找不到的书归入「过期书籍」，
// 部分找不到的书照常可读，缺失那几卷的页暂时不显示。记录、标签和书签都保留，用户手动删除才清除。
async function sync(list, ask) {
  await probeAll(list);
  const byTitle = new Map(),
    units = [];
  for (const b of list)
    for (const s of b.sources) {
      if (!s.dir) continue;
      const group = byTitle.get(s.title) ?? [];
      byTitle.set(s.title, group);
      let u = group.find((u) => u.dir === s.dir);
      if (!u)
        for (const x of group)
          if (await sameDir(x.dir, s.dir)) {
            u = x;
            break;
          }
      if (!u) {
        u = { dir: s.dir, refs: [] };
        group.push(u);
        units.push(u);
      }
      u.refs.push({ book: b, source: s });
    }
  // 合并作品先向当初选的文件夹请求一次授权，其下各卷随之可读，不必逐卷弹窗。
  if (ask && current?.roots && list.includes(current))
    for (const r of current.roots)
      if (
        r.queryPermission &&
        (await timed(r, () => r.queryPermission({ mode: 'read' })).catch(() => null)) === 'prompt'
      )
        await r.requestPermission({ mode: 'read' }).catch(() => {});
  for (const u of units) u.result = await listDir(u.dir, ask && u.refs.some((r) => r.book === current));
  const per = new Map();
  for (const u of units)
    for (const r of u.refs) {
      if (!per.has(r.book)) per.set(r.book, []);
      per.get(r.book).push([r.source, u.result]);
    }
  const out = { updated: 0, gone: 0, partial: 0, denied: 0, added: 0, removed: 0 };
  for (const [book, results] of per) {
    if (!books.has(book.id)) continue;
    const before = book === current ? here() : null;
    let changed = false,
      added = 0,
      removed = 0,
      denied = false,
      subs = false;
    for (const [s, r] of results) {
      if (!book.sources.includes(s)) continue; // 列目录期间这一卷已被移除或重建
      if (r === 'denied') denied = true;
      else if (r === 'gone') {
        if (!s.missing) {
          s.missing = true;
          changed = true;
        }
      } else {
        if (s.missing) {
          delete s.missing;
          changed = true;
        }
        const d = applyNames(book, s, r);
        added += d.added;
        removed += d.removed;
        subs ||= d.subs;
      }
    }
    if (added || removed) delete book.folderTime; // 文件夹时间待重新计算
    if (settle(book) || added || removed) {
      await arrange(book, false, before);
      changed = true;
    } else if (subs) {
      await persist(book); // 只有字幕增减：页表不变，不重排
      changed = true;
    }
    if (denied) out.denied++;
    if (expired(book)) out.gone++;
    else if (book.sources.length > 1 && book.sources.some((s) => down(book, s))) out.partial++;
    if (changed && !expired(book)) out.updated++;
    out.added += added;
    out.removed += removed;
  }
  ctx.pbf?.check(list); // 配对的 PotPlayer 书签随文件夹检查一起看大小和修改时间，有变化才读（pbf.mjs）
  return out;
}
let refreshing = null;
function busy(on) {
  for (const el of document.querySelectorAll('[data-act="refresh"]')) {
    el.classList.toggle('busy', on);
    el.disabled = on;
  }
}
export function refreshAll(manual) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    busy(true);
    if (manual) notice('refreshing');
    // 当前书先查（只列它的几个文件夹），结果立即生效；其余的书等浏览器空闲后再串行列目录，不与首屏读图抢硬盘。
    const r = { updated: 0, gone: 0, partial: 0, denied: 0, added: 0, removed: 0 },
      sum = (x) => {
        for (const k in r) r[k] += x[k];
      };
    const first = current && books.has(current.id) ? current : null;
    if (first) sum(await sync([first], manual));
    // 其余的书：多个窗口同时开着时，只由持有后台磁盘任务的窗口检查一次（windows.mjs）；手动刷新照常检查全部。
    if (manual || (await (ctx.disk?.check() ?? true))) {
      if (!manual)
        await new Promise((ok) =>
          window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 2000 }) : setTimeout(ok, 300),
        );
      sum(
        await sync(
          [...books.values()].filter((b) => b !== first),
          manual,
        ),
      );
      ctx.disk?.done();
    }
    ctx.redrawShelf();
    emit('books');
    const parts = [];
    if (r.updated) parts.push(fmt('updatedN', { n: r.updated }));
    if (r.gone) parts.push(fmt('expiredN', { n: r.gone }));
    if (r.partial) parts.push(fmt('partialN', { n: r.partial }));
    if (r.denied && manual) parts.push(fmt('deniedN', { n: r.denied }));
    if (parts.length) notice(null, parts.join(' · '));
    else if (manual) notice('refreshDone');
  })().finally(() => {
    refreshing = null;
    busy(false);
  });
  return refreshing;
}
export function install(c) {
  ctx = c;
  // 切回窗口时只检查当前书：在资源管理器里增删图片后回来即可看到变化。
  let focusCheck = 0;
  window.addEventListener(
    'focus',
    safe(async () => {
      const book = current;
      if (!book?.sources.some((s) => s.dir) || refreshing || Date.now() - focusCheck < 1500) return;
      focusCheck = Date.now();
      const r = await sync([book], false);
      if (r.gone) {
        notice(null, fmt('expiredN', { n: 1 }));
        ctx.redrawShelf();
      } else if ((r.added || r.removed) && book === current)
        notice(null, fmt('pagesChanged', { a: r.added, r: r.removed }));
      else if (r.updated) {
        ctx.redrawShelf();
        emit('books');
      }
    }),
  );
}
