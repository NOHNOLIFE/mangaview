import { extend } from '../core/lang.mjs';
import { pbfFile, hasPbf } from '../core/sources.mjs';
import { nameOf, stem, fileStem, autoName, nextNumber } from './names.mjs';
// PotPlayer 书签（.pbf）导入。
// - 配对只看文件名（model.mjs pairPbf），在导入、刷新列目录时顺带完成（sources.mjs），记在页上（page.pbf）；.pbf 本身不是页。
// - 内容在后台空闲时串行读取：随现有的文件夹检查进行（ctx.pbf.check，shelf/import.mjs 的导入与 shelf/refresh.mjs 的检查），不新增检查时机；当前书优先，
//   其余的书每一项先 await ctx.disk.turn()（多个窗口时只由一个窗口读盘）。只比较 .pbf 的大小和修改时间，有变化才读内容并合并。
//   打开一本书时只补读它从未读过的 .pbf。
// - 合并只增不删（mergePbf）：新条目加入普通书签列表（名称 label 为「<文件名>-<pbf 里的名称>」、原名 pbfName、来源 from:'pbf'），
//   与已有书签相差不到 1 秒的视为同一个，.pbf 里改了名称的跟着改（用户手动改过名称的除外）；
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
// 把一个 .pbf 的条目合并进书签列表（只增不删）。marks：书的全部书签；name：配对媒体的页名；done：之前处理过的条目（毫秒）；
// file / word：命名用的 <文件名>（不含路径和扩展名）与「书签」一词（names.mjs）。
// 同一个媒体里与已有书签（含区段书签的终点）相差不到 NEAR 秒的视为同一个，不重复添加；同一个 .pbf 里几条都对上同一个书签时只按第一条（按 id 对上的优先）。
// 名称：新书签为「<文件名>-<pbf 里的名称>」，.pbf 没给名称的按应用内规则编号；.pbf 里的原名另存为 pbfName。
// 对上的书签来自 .pbf 时跟随 .pbf 改名（比较 pbfName；2.3.0 导入的只有 label，即原名），用户手动改过名称的（named）只更新 pbfName；
// 应用内添加、还没有 .pbf 名称的书签补上名称。没对上、但以前处理过的条目是在应用内删掉的，不再加回。
// 返回 {added 新书签, renamed 改了名称的书签, done}。
export function mergePbf(
  marks,
  name,
  entries,
  done = [],
  now = Date.now(),
  { file = stem(name), word = 'Bookmark' } = {},
) {
  const was = new Set(done),
    seen = new Set(done),
    added = [],
    renamed = new Set(),
    claimed = new Set(),
    mine = marks.filter((m) => m && m.name === name && Number.isFinite(m.t));
  const ids = new Set(mine.map((m) => m.id)),
    list = [...entries].sort((x, y) => ids.has(pbfId(name, y.ms)) - ids.has(pbfId(name, x.ms)) || x.ms - y.ms);
  const label = (pbfName, self) =>
    pbfName
      ? file + '-' + pbfName
      : autoName(
          file,
          word,
          nextNumber(
            [...mine, ...added].filter((m) => m !== self),
            name,
            file,
          ),
        );
  for (const e of list) {
    const t = e.ms / 1000,
      id = pbfId(name, e.ms),
      all = [...mine, ...added],
      pbfName = e.name || '';
    seen.add(e.ms);
    const hit =
      all.find((m) => m.id === id) ??
      all.filter((m) => Math.abs(m.t - t) < NEAR).sort((x, y) => Math.abs(x.t - t) - Math.abs(y.t - t))[0];
    if (hit) {
      if (claimed.has(hit)) continue;
      claimed.add(hit);
      if (hit.from === 'pbf') {
        const legacy = typeof hit.pbfName !== 'string',
          old = legacy ? nameOf(hit) : hit.pbfName;
        if (!legacy && old === pbfName && nameOf(hit)) continue;
        hit.pbfName = pbfName;
        if (!hit.named && (legacy || old !== pbfName || !nameOf(hit))) hit.label = label(pbfName, hit);
        renamed.add(hit);
      } else if (!hit.named && typeof hit.pbfName !== 'string' && pbfName) {
        hit.pbfName = pbfName;
        hit.label = label(pbfName);
        renamed.add(hit);
      }
      continue;
    }
    if (was.has(e.ms) || mine.some((m) => Number.isFinite(m.end?.t) && Math.abs(m.end.t - t) < NEAR)) continue;
    const m = { id, name, t, at: now, label: label(pbfName), pbfName, from: 'pbf' };
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
      ctx.marks?.ensure?.(book); // 旧书签先补上名称（编号接着它们）
      const r = mergePbf(book.bookmarks, page.name, entries, page.pbf?.done, Date.now(), {
        file: fileStem(book, page.name),
        word: ctx.t('bmWord'),
      });
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
