// 恢复的配对：扫描所选文件夹得到候选，与待恢复的槽（过期书的源、暂时找不到的卷）按名称、封面摘要、媒体文件大小配对，
// 并把配对接回原记录；普通「添加文件夹」时的自动接回（ctx.autoMatch）。不含界面，流程与对话框见 restore.mjs。
import { fileOf } from '../core/model.mjs';
import { scan, allPages, keyOf, isLoose } from '../core/sources.mjs';
import { norm, coverName, grade, assign, overlap, isMedia as mediaName } from '../core/match.mjs';
import { digest } from './util.mjs';

export function install(ctx) {
  const { books } = ctx;
  async function candidates(dir, progress) {
    const out = [];
    for await (const g of scan(dir)) {
      out.push({ ...g, names: g.pages.map((p) => p.name) });
      progress?.(out.length);
    }
    return out;
  }
  const coverFile = async (c) => (await c.dir.getFileHandle(coverName(c.names))).getFile();
  async function candHash(c) {
    if (c.hash === undefined)
      try {
        const f = await coverFile(c);
        c.size = f.size;
        c.hash = await digest(f);
      } catch {
        c.hash = null;
      }
    return c.hash;
  }
  async function candSize(c) {
    if (c.size === undefined)
      try {
        c.size = (await coverFile(c)).size;
      } catch {
        c.size = null;
      }
    return c.size;
  }
  // 候选文件夹里媒体文件的大小（只读文件元数据），供按「文件名 + 大小」比较；只在记录里有已知大小的媒体文件时才读。
  async function candSizes(c) {
    if (c.sizes === undefined) {
      const m = new Map();
      for (const n of c.names)
        if (mediaName(n))
          try {
            m.set(n, (await (await c.dir.getFileHandle(n)).getFile()).size);
          } catch {}
      c.sizes = m;
    }
    return c.sizes;
  }
  const sized = (t) => t.pages.some((p) => Number.isFinite(p.size) && mediaName(p.name));
  // 槽：{book,source,merged,t}，t 是供 grade 比较的 {title,pages,fp}。
  // want(title)：只要名称相符的槽（普通导入时用，避免为大量无关的书构造比较对象）；all：不论是否缺失（定位原文件）。
  function slotsOf(b, want, all = false) {
    const ex = all || ctx.expired(b);
    // 散图图集没有源，不按文件夹匹配：它的恢复是按相对目录 + 文件名逐页找回（restoreOne → ctx.relocate）。
    if (isLoose(b)) return [];
    return b.sources
      .filter((s) => (ex || ctx.isDown(b, s)) && (!want || want(s.key ? s.title : b.title)))
      .map((s) =>
        s.key
          ? {
              book: b,
              source: s,
              merged: true,
              t: {
                title: s.title,
                pages: allPages(b)
                  .filter((p) => keyOf(p) === s.key)
                  .map((p) => ({ name: fileOf(p), size: p.size })),
                fp: s.fp && { cover: s.fp },
              },
            }
          : { book: b, source: s, merged: false, t: b },
      );
  }
  const allSlots = () => [...books.values()].flatMap((b) => slotsOf(b));
  async function pairs(slots, cands) {
    const byName = new Map();
    for (const c of cands) {
      const k = norm(c.title);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c);
    }
    const out = [];
    for (const x of slots) {
      const t = x.t,
        named = byName.get(norm(t.title)) || [],
        fp = t.fp?.cover,
        pair = (c, g) => ({ book: x.book, source: x.source, merged: x.merged, cand: c, ...g }),
        media = sized(t),
        seen = new Set(named);
      for (const c of named) {
        if (fp?.hash) await candHash(c);
        if (media) await candSizes(c);
        out.push(pair(c, grade(t, c)));
      }
      if (named.some((c) => fp?.hash && c.hash === fp.hash)) continue;
      if (fp?.hash)
        for (const c of cands) {
          if (seen.has(c) || Math.abs(c.names.length - t.pages.length) > Math.max(2, t.pages.length * 0.1)) continue;
          if ((await candSize(c)) !== fp.size) continue;
          await candHash(c);
          if (media) await candSizes(c);
          const g = grade(t, c);
          if (g.level) {
            seen.add(c);
            out.push(pair(c, g));
          }
        }
      // 含媒体的书：文件夹改名且首个文件对不上时，按媒体的「文件名 + 大小」重合度找（先按文件名粗筛，再读候选的媒体文件大小）。
      if (media) {
        const mine = t.pages.filter((p) => mediaName(p.name)).map((p) => p.name);
        for (const c of cands) {
          if (seen.has(c) || overlap(mine, c.names.filter(mediaName)) < 0.5) continue;
          await candSizes(c);
          if (fp?.hash) await candHash(c);
          const g = grade(t, c);
          if (g.level) {
            seen.add(c);
            out.push(pair(c, g));
          }
        }
      }
    }
    return out;
  }
  // 把配对按书分组接回，每本书只排序保存一次。返回恢复的书数。
  async function apply(list) {
    const per = new Map();
    for (const p of list) {
      if (!per.has(p.book)) per.set(p.book, []);
      per.get(p.book).push({ cand: p.cand, source: p.source });
    }
    for (const [b, links] of per) if (books.has(b.id)) await ctx.relinkAll(b, links);
    return per.size;
  }
  // 普通“添加文件夹”时：同名且封面摘要一致的过期书或缺失的卷直接接回原记录，避免产生重复条目。返回可自动接回的配对。
  ctx.autoMatch = async (group) => {
    const k = norm(group.title),
      slots = [...books.values()].flatMap((b) => slotsOf(b, (x) => norm(x) === k));
    if (!slots.length) return [];
    const c = { ...group, names: group.pages.map((p) => p.name) },
      ps = [];
    for (const x of slots) {
      if (x.t.fp?.cover?.hash) await candHash(c);
      else if (sized(x.t)) await candSizes(c);
      ps.push({ book: x.book, source: x.source, merged: x.merged, cand: c, ...grade(x.t, c) });
    }
    return assign(ps).filter((p) => p.level === 2);
  };
  return { candidates, coverFile, candHash, candSizes, sized, slotsOf, allSlots, pairs, apply };
}
