import { extend } from '../core/lang.mjs';
import { pbfFile, hasPbf } from '../core/sources.mjs';
// PotPlayer 书签（.pbf）导入（docs/requirements-media.zh-CN.md 第 11 节）。
// - 配对只看文件名（model.mjs pairPbf），在导入、刷新列目录时顺带完成（sources.mjs），记在页上（page.pbf）；.pbf 本身不是页。
// - 内容在后台空闲时串行读取：随现有的文件夹检查进行（ctx.pbf.check，app.mjs 的导入与 sync），不新增检查时机；当前书优先，
//   其余的书每一项先 await ctx.disk.turn()（多个窗口时只由一个窗口读盘）。只比较 .pbf 的大小和修改时间，有变化才读内容并合并。
//   打开一本书时只补读它从未读过的 .pbf。
// - 合并只增不删（mergePbf）：新条目加入普通书签列表（带名称 label、来源 from:'pbf'），与已有书签相差不到 1 秒的视为同一个，名称变了的更新名称；
//   已处理过的条目记在 page.pbf.done，在应用内删掉的不会被加回。书签 id 由页名和时间决定，多个窗口同时导入同一个 .pbf 也不会重复。
// - 导入时不截图：视频书签的缩略图由书签列表懒生成（bookmarks.mjs paint），音频书签用占位样式。
extend({
  pbfAdded: [
    'Added {n} bookmarks from PotPlayer',
    '已从 PotPlayer 书签导入 {n} 个书签',
    'PotPlayer のしおりから {n} 件追加しました',
    'PotPlayer 책갈피에서 {n}개를 추가했습니다',
  ],
});
const NEAR = 1,
  READ = 20000; // NEAR：与已有书签相差不到这么多秒的视为同一个；READ：读取一个 .pbf 的时限（毫秒）

// 文本解码：PotPlayer 写的是带 BOM 的 UTF-16LE；也认 UTF-8 / UTF-16BE 的 BOM，没有 BOM 时按字节特征猜。
export function decodePbf(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf),
    dec = (enc, from) => new TextDecoder(enc).decode(a.subarray(from));
  if (a[0] === 0xff && a[1] === 0xfe) return dec('utf-16le', 2);
  if (a[0] === 0xfe && a[1] === 0xff) return dec('utf-16be', 2);
  if (a[0] === 0xef && a[1] === 0xbb && a[2] === 0xbf) return dec('utf-8', 3);
  const n = Math.min(a.length, 512);
  let zeros = 0;
  for (let i = 1; i < n; i += 2) if (a[i] === 0) zeros++;
  return dec(zeros > n / 4 ? 'utf-16le' : 'utf-8', 0);
}
// [Bookmark] 小节下每行一条：「序号=毫秒*名称*内嵌图片的十六进制」，图片段可为空。第一个 * 之前是时间，最后一个 * 之后是图片，中间是名称（可含 *）。
// 只取时间和名称：[{ms,name}]。格式不符的行跳过，整个文件无法解析时为空列表，不报错。
export function parsePbf(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  let inside = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inside = line.slice(1, -1).trim().toLowerCase() === 'bookmark';
      continue;
    }
    const m = inside && /^\d+\s*=(.*)$/.exec(line);
    if (!m) continue;
    const v = m[1],
      a = v.indexOf('*'),
      b = v.lastIndexOf('*');
    if (a < 0 || b === a) continue;
    const ms = v.slice(0, a).trim();
    if (!/^\d+$/.test(ms) || !Number.isSafeInteger(+ms) || !/^[0-9a-f]*$/i.test(v.slice(b + 1).trim())) continue;
    out.push({ ms: +ms, name: v.slice(a + 1, b).trim() });
  }
  return out;
}
// 书签 id 由页名和毫秒决定：同一个条目在哪个窗口导入都是同一个 id，多窗口合并（merge.mjs 按 id）不会重复。
export function pbfId(name, ms) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return 'pbf-' + (h >>> 0).toString(36) + '-' + ms;
}
// 把一个 .pbf 的条目合并进书签列表（只增不删）。marks：书的全部书签；name：配对媒体的页名；done：之前处理过的条目（毫秒）。
// 同一个媒体里与已有书签（含区段书签的终点）相差不到 NEAR 秒的视为同一个，不重复添加；对上的书签来自 .pbf 时名称跟着更新（原地修改），
// 没有名称的书签补上名称；同一个 .pbf 里几条都对上同一个书签时只按第一条（按 id 对上的优先）。没对上、但以前处理过的条目是在应用内删掉的，不再加回。
// 返回 {added 新书签, renamed 改了名称的书签, done}。
export function mergePbf(marks, name, entries, done = [], now = Date.now()) {
  const was = new Set(done),
    seen = new Set(done),
    added = [],
    renamed = new Set(),
    claimed = new Set(),
    mine = marks.filter((m) => m && m.name === name && Number.isFinite(m.t));
  const ids = new Set(mine.map((m) => m.id)),
    list = [...entries].sort((x, y) => ids.has(pbfId(name, y.ms)) - ids.has(pbfId(name, x.ms)) || x.ms - y.ms);
  for (const e of list) {
    const t = e.ms / 1000,
      id = pbfId(name, e.ms),
      all = [...mine, ...added],
      label = e.name || undefined;
    seen.add(e.ms);
    const hit =
      all.find((m) => m.id === id) ??
      all.filter((m) => Math.abs(m.t - t) < NEAR).sort((x, y) => Math.abs(x.t - t) - Math.abs(y.t - t))[0];
    if (hit) {
      if (claimed.has(hit)) continue;
      claimed.add(hit);
      if (hit.from === 'pbf' ? hit.label !== label : !hit.label && label) {
        if (label) hit.label = label;
        else delete hit.label;
        renamed.add(hit);
      }
      continue;
    }
    if (was.has(e.ms) || mine.some((m) => Number.isFinite(m.end?.t) && Math.abs(m.end.t - t) < NEAR)) continue;
    const m = { id, name, t, at: now, ...(label && { label }), from: 'pbf' };
    added.push(m);
    claimed.add(m);
  }
  return { added, renamed: [...renamed], done: [...seen] };
}

export function install(ctx) {
  const todo = new Map();
  let running = false,
    wake = () => {};
  const idle = () =>
    new Promise((r) =>
      window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 60),
    );
  const limit = (p, ms) => {
    let tm;
    return Promise.race([
      p,
      new Promise((_, no) => {
        tm = setTimeout(() => no(new DOMException('', 'TimeoutError')), ms);
      }),
    ]).finally(() => clearTimeout(tm));
  };
  const turn = () => ctx.disk?.turn() ?? Promise.resolve();
  const sorted = (book, list) =>
    ctx.marks ? ctx.marks.list({ pages: book.pages, bookmarks: list }).map((x) => x.bm) : list;
  // 一本书：逐个比较 .pbf 的大小和修改时间，有变化才读内容并合并；fresh：只读从未读过的。
  async function one(book, fresh) {
    let added = 0,
      changed = false,
      dirty = false;
    for (const page of book.pages.filter((p) => hasPbf(p) && !(fresh && p.pbf?.size != null))) {
      if (book !== ctx.current) await turn();
      await idle();
      if (!ctx.books.has(book.id) || !book.pages.includes(page) || !hasPbf(page) || ctx.expired?.(book)) continue;
      let file, entries;
      try {
        file = await pbfFile(book, page);
        if (!file) continue;
        const was = page.pbf ?? {};
        if (was.size === file.size && was.mtime === file.lastModified) continue;
        entries = parsePbf(decodePbf(await limit(file.arrayBuffer(), READ)));
      } catch (e) {
        if (e?.name === 'TimeoutError') break;
        continue;
      } // 读不到（被占用、已删除）下次检查再试；卡住的文件夹整本跳过
      if (!ctx.books.has(book.id)) return;
      const r = mergePbf(book.bookmarks, page.name, entries, page.pbf?.done);
      if (r.added.length) {
        book.bookmarks = sorted(book, [...book.bookmarks, ...r.added]);
        added += r.added.length;
      }
      if (r.added.length || r.renamed.length) changed = true;
      page.pbf = { ...page.pbf, size: file.size, mtime: file.lastModified, done: r.done };
      dirty = true;
    }
    if (dirty) await ctx.persist(book);
    if (changed) {
      ctx.marks?.changed?.(book);
      if (added && book === ctx.current) ctx.notice(null, ctx.fmt('pbfAdded', { n: added }));
    }
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (todo.size) {
        const cur = ctx.current,
          book = todo.has(cur) ? cur : todo.keys().next().value;
        // 其余的书等轮到本窗口读盘；期间当前书有了待读的就先读它。
        if (
          book !== cur &&
          (await Promise.race([
            turn().then(() => false),
            new Promise((r) => {
              wake = () => r(true);
            }),
          ]))
        )
          continue;
        const fresh = todo.get(book);
        todo.delete(book);
        try {
          await one(book, fresh);
        } catch (e) {
          console.warn(e);
        }
      }
    } finally {
      running = false;
    }
  }
  // 检查这些书的 .pbf（文件夹检查、导入之后）；fresh：只读从未读过的。
  function check(list, fresh = false) {
    let any = false;
    for (const b of list ?? [])
      if (b?.pages?.some(hasPbf)) {
        todo.set(b, (todo.get(b) ?? true) && fresh);
        any = true;
      }
    if (!any) return;
    if (todo.has(ctx.current)) wake();
    pump();
  }
  ctx.pbf = { check };
  ctx.on('select', (book) => {
    if (book) check([book], true);
  });
}
