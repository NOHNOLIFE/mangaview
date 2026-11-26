// 过期书与候选文件夹的匹配。浏览器拿不到磁盘绝对路径，文件夹又常以 001.jpg 这类通用文件名编号，
// 所以以“文件夹名 + 封面（首张图）内容摘要”为主要依据，文件名重合度只在缺少封面摘要时辅助判断。
import { natural, kindOf } from './model.mjs';
export const norm = (s) => (s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// 封面固定取文件名自然顺序的第一张，与当前排序（包括乱序）无关，保证换机后仍能对上。
export const coverName = (names) => names.reduce((a, b) => (a == null || natural(b, a) < 0 ? b : a), null);
export function overlap(a, b) {
  const A = new Set(a);
  let n = 0;
  for (const x of new Set(b)) if (A.has(x)) n++;
  return n / Math.max(1, A.size + new Set(b).size - n);
}
// 媒体文件（视频、音频）不做全文件哈希，按「文件名 + 精确大小」比较：pages 为记录里的页（{name,size}，大小由后台读取元数据记下），
// sizes 为候选文件夹里媒体文件的 Map(文件名 → 大小)。只比较记录里已知大小的媒体文件，同名不同大小不算重合；没有可比较的为 null。
export const isMedia = (name) => {
  const k = kindOf(name);
  return k === 'video' || k === 'audio';
};
export function mediaOverlap(pages, sizes) {
  if (!sizes?.size) return null;
  const mine = (pages || []).filter((p) => Number.isFinite(p?.size) && isMedia(p.name));
  if (!mine.length) return null;
  let n = 0;
  for (const p of mine) if (sizes.get(p.name) === p.size) n++;
  return n / Math.max(1, mine.length + sizes.size - n);
}
// level 2：可自动恢复；1：需要用户确认；0：不匹配。cand：{title,names,hash?,sizes?}
// 含媒体的书：文件夹改名或首个文件对不上时，媒体的「文件名 + 大小」重合度较高（≥ 0.6，首个文件本身可能就是变了的那个）也列出来由用户确认；
// 名称相同、没有封面摘要可比时，文件名重合之外还要求媒体的大小对得上（同名不同大小不自动匹配）。
export function grade(book, cand) {
  const same = norm(book.title) === norm(cand.title),
    mine = book.fp?.cover?.hash;
  const cover = mine && cand.hash ? mine === cand.hash : null;
  const files =
    same && cover === null
      ? overlap(
          book.pages.map((p) => p.name),
          cand.names,
        )
      : 0;
  const media = mediaOverlap(book.pages, cand.sizes);
  const level = same && (cover || (files >= 0.9 && (media ?? 1) >= 0.9)) ? 2 : cover || same || media >= 0.6 ? 1 : 0;
  return {
    level,
    same,
    cover,
    files,
    media,
    score: level * 10 + (cover ? 4 : 0) + (same ? 2 : 0) + files + (media ?? 0) * 2,
  };
}
// 分配：按匹配强度从高到低，每个待恢复的源（p.source，旧调用为整本书）最多用一次。
// 一个文件夹只能作为一本单文件夹书的源，但可以同时是任意多本合并作品（p.merged）中的一卷，每本最多一卷。
export function assign(pairs) {
  const slots = new Set(),
    singles = new Set(),
    used = new Map(),
    out = [];
  for (const p of [...pairs].sort((x, y) => y.score - x.score)) {
    const slot = p.source ?? p.book;
    if (!p.level || slots.has(slot)) continue;
    if (p.merged) {
      const mine = used.get(p.book) ?? new Set();
      if (mine.has(p.cand)) continue;
      used.set(p.book, mine.add(p.cand));
    } else {
      if (singles.has(p.cand)) continue;
      singles.add(p.cand);
    }
    slots.add(slot);
    out.push(p);
  }
  return out;
}
// 标签配色：按名称散列出固定色相，同名标签在任何地方颜色一致。
export function hue(tag) {
  let h = 0;
  for (const ch of norm(tag)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}
