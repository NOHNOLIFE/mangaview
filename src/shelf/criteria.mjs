// 筛选条件的纯逻辑：条件的归一化与比较，书的标签、书签数、页数、页类型（不碰 DOM，可在 Node 里测试）。
import { pageKind } from '../core/model.mjs';
import { norm } from '../core/match.mjs';

// 筛选条件：{q 关键词, min/max 页数（字符串，空为不限）, tags 选中的标签, marked 只看有书签的书, kinds 页的类型（含有任一所选类型的页即匹配，空为不限）}。
// 旧数据或损坏的数据归一化为空条件。
export const KINDS = ['image', 'video', 'audio'],
  KIND_LABEL = { image: 'kindImage', video: 'kindVideo', audio: 'kindAudio' };
export const EMPTY = { q: '', min: '', max: '', tags: [], marked: false, kinds: [] };
export function clean(f) {
  if (!f || typeof f !== 'object') f = {};
  const num = (v) => (v !== '' && v != null && Number.isFinite(+v) && +v >= 0 ? String(Math.floor(+v)) : ''),
    seen = new Set(),
    tags = [];
  for (const x of Array.isArray(f.tags) ? f.tags : [])
    if (typeof x === 'string' && x.trim() && !seen.has(norm(x))) {
      seen.add(norm(x));
      tags.push(x.trim());
    }
  const kinds = Array.isArray(f.kinds) ? KINDS.filter((k) => f.kinds.includes(k)) : [];
  return { q: typeof f.q === 'string' ? f.q : '', min: num(f.min), max: num(f.max), tags, marked: !!f.marked, kinds };
}
export const same = (a, b) => {
  const k = (f) => JSON.stringify([f.q.trim(), f.min, f.max, f.tags.map(norm).sort(), f.marked, f.kinds]);
  return k(a) === k(b);
};
export const tagsOf = (b) => (Array.isArray(b.tags) ? b.tags : []),
  marksOf = (b) => (Array.isArray(b.bookmarks) ? b.bookmarks.length : 0),
  pagesOf = (b) => b.pages?.length ?? 0;
// 书中含有的页类型（'image' | 'video' | 'audio'，只按扩展名），按页表缓存：类型筛选和封面上的类型角标用。
const kindCache = new WeakMap();
export const kindsOf = (b) => {
  const pages = b.pages || [];
  let c = kindCache.get(b);
  if (!c || c.pages !== pages || c.n !== pages.length) {
    c = { pages, n: pages.length, set: new Set(pages.map(pageKind)) };
    kindCache.set(b, c);
  }
  return c.set;
};
