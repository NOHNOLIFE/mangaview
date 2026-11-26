// 导入：把扫描到的文件夹建成书或并入引用它的书（add），添加为单个作品（addMerged），导入结果的提示。
// 选择入口见 pick.mjs、添加对话框见 add.mjs、拖放见 drop.mjs；把源接到文件夹上的做法见 relink.mjs。
import { natural, clipEnd } from '../core/model.mjs';
import { mergeKeys, isLoose } from '../core/sources.mjs';
import { t, fmt, title } from '../core/locale.mjs';
import { emit } from '../core/events.mjs';
import { books, persist } from '../core/books.mjs';
import { normalize } from '../core/normalize.mjs';
import { $, shelf, notice } from '../ui/dom.mjs';
import { current, select } from '../reader/session.mjs';
import { toolsState } from '../reader/shell.mjs';
import { sameDir, relink, relinkAll, findMerged, rebuild } from './relink.mjs';
let ctx;
// 不对未打开的书读取原图；目录本身的只读句柄可跨启动保存。
// 同一个文件夹（句柄相同）对应同一本单文件夹书；同名但位置不同的文件夹是不同的书。
// 同一个文件夹还可以是任意多本合并作品中的一卷：导入它时，这些书里的这一卷也按最新内容更新。
// 找不到时再看过期书或缺失的卷：文件夹名和封面摘要都一致时接回原记录，标签、书签和进度随之恢复。
// 句柄卡住（见 sources.mjs timed）时按不同处理：卡住的旧源随之算作缺失，可被新文件夹接回。
async function refsTo(dir, title) {
  const out = [];
  for (const b of books.values())
    for (const s of b.sources) if (s.title === title && (await sameDir(s.dir, dir))) out.push({ book: b, source: s });
  return out;
}
// later：合并作品中的卷先记下，整批导入完后每本书只排序保存一次（一次导入很多卷时不反复写整本书的记录）。
async function addGroup(group, place = 'shelf', later = null) {
  let book;
  const vol = (b, s) => {
    if (!later) return relink(b, group, s);
    if (!later.has(b)) later.set(b, []);
    later.get(b).push({ cand: group, source: s });
  };
  if (group.dir) {
    for (const r of await refsTo(group.dir, group.title))
      if (r.source.key) await vol(r.book, r.source);
      else book = r.book;
    // 过期书或合并作品中缺失的卷：同名同封面的接回（一个文件夹只接回一本单文件夹书，但可同时接回多本合并作品中的卷）。
    for (const p of (await ctx.autoMatch?.(group)) ?? [])
      if (p.merged) await vol(p.book, p.source);
      else book ??= p.book;
  }
  // 散图（title 为 null）一律加入唯一的散图图集，没有时新建。
  if (!group.title && !(book = [...books.values()].find(isLoose))) {
    book = normalize({ id: crypto.randomUUID(), sortOverride: null, title: null, pages: [], place });
    books.set(book.id, book);
  }
  if (book) {
    book.place = place;
    await relink(book, group);
  } else {
    book = normalize({ id: crypto.randomUUID(), sortOverride: null, ...group, place });
    books.set(book.id, book);
    await persist(book);
  }
  return book;
}
// 书架页正显示「书库」时导入到书库，其他情况导入到书架。书架页开着时不切换正在读的书，只提示导入结果。
export const importPlace = () => (shelf.open && ctx.shelfView?.() === 'library' ? 'library' : 'shelf');
// odd：导入时跳过的、浏览器播不了的媒体文件（sources.mjs skipped），在导入结果里说明数量和扩展名；刷新不提示。
export const oddText = (odd) =>
  odd?.n
    ? fmt('unsupportedN', {
        n: odd.n,
        exts: [...odd.exts]
          .sort()
          .map((x) => '.' + x)
          .join(' '),
      })
    : '';
function imported(list, place, odd) {
  const bad = oddText(odd);
  if (!list.length) {
    notice(null, [t('noImages'), bad].filter(Boolean).join(' · '), bad ? 8000 : undefined);
    return;
  }
  if ($('notice').textContent === t('scanning')) $('notice').textContent = '';
  if (shelf.open && current)
    notice(
      null,
      [fmt(place === 'library' ? 'addedLibraryN' : 'addedShelfN', { n: list.length }), bad].filter(Boolean).join(' · '),
      bad ? 8000 : undefined,
    );
  else if (bad) notice(null, bad, 8000);
  ctx.pbf?.check(list); // 后台读取配对的 PotPlayer 书签（pbf.mjs）
  ctx.redrawShelf();
  emit('books');
}
export async function add(groups, place = importPlace(), odd = null) {
  const list = [],
    quiet = shelf.open && !!current,
    later = new Map();
  notice('scanning');
  for await (const group of groups) {
    const book = await addGroup(group, place, later);
    if (!list.includes(book)) list.push(book);
    if (list.length === 1 && !quiet && current !== book) select(book);
  }
  for (const [b, links] of later) if (books.has(b.id)) await relinkAll(b, links);
  imported(list, place, odd);
  return list;
}
// 添加为单个作品：所选的一个或多个文件夹（含其下所有带图片的子文件夹）合成一本书，每个文件夹是一个源。
// 同一组所选文件夹（或同一组源）再次导入时更新已有的那本；只有一个带图片的文件夹时按普通导入处理。散图仍单独导入。
// 作品名用所选（拖入）的根文件夹名，多个时取按文件名顺序的第一个。只有一个带图片的文件夹且它在根文件夹之下时，
// 书仍以它为源（识别、恢复照旧），根文件夹名作为显示名（name），搜索原文件夹名仍能找到；书名已编辑过的不覆盖。
export async function addMerged(roots, groups, place = importPlace(), odd = null) {
  const folders = [],
    loose = [];
  notice('scanning');
  for await (const g of groups) {
    (g.path ? folders : loose).push(g);
    if (folders.length % 50 === 0 && folders.length) notice(null, fmt('scanningN', { n: folders.length }), 120000);
  }
  if (folders.length < 2) {
    const list = await add(folders.concat(loose), place, odd),
      root = folders[0]?.path?.split('/')[0],
      book = folders.length ? list[0] : null;
    if (book && root && root !== folders[0].title && !book.name) {
      book.name = root;
      await persist(book);
      ctx.redrawShelf();
      toolsState();
      emit('books');
    }
    return;
  }
  const order = mergeKeys(folders);
  // 先按普通导入的规则更新引用这些文件夹的书、接回缺失的卷（单文件夹书与合并作品可以共用一个源）；每本书只排序保存一次。
  const links = new Map(),
    push = (b, cand, source) => {
      if (!links.has(b)) links.set(b, []);
      links.get(b).push({ cand, source });
    };
  for (const { group } of order) {
    if (!group.dir) continue;
    for (const r of await refsTo(group.dir, group.title)) push(r.book, group, r.source);
    for (const p of (await ctx.autoMatch?.(group)) ?? []) push(p.book, group, p.source);
  }
  for (const [b, list] of links) await relinkAll(b, list);
  let book = await findMerged(roots, folders);
  if (book) {
    book.place = place;
    if (roots?.length) book.roots = roots;
    await rebuild(book, order);
  } else {
    const names = roots?.length ? roots.map((r) => r.name) : [...new Set(folders.map((g) => g.path.split('/')[0]))];
    const first = names.sort(natural)[0];
    const pages = order.flatMap(({ group, key }) =>
      group.pages.map((p) => {
        p.src = key;
        p.name = key + '/' + p.name;
        return p;
      }),
    ); // 保持页对象本身（回退模式下与本次会话的 File 绑定）
    book = normalize({
      id: crypto.randomUUID(),
      sortOverride: null,
      title: first,
      ...(names.length === 1 && { path: names[0] }),
      ...(roots?.length && { roots }),
      place,
      sources: order.map(({ group, key }) => ({
        key,
        title: group.title,
        ...(group.path && { path: group.path }),
        ...(group.dir && { dir: group.dir }),
      })),
      pages,
    });
    books.set(book.id, book);
    await persist(book);
  }
  const list = [book];
  for (const g of loose) list.push(await addGroup(g, place));
  if (!(shelf.open && current) && current !== book) select(book);
  imported(list, place);
  notice(
    null,
    [fmt('mergedDone', { name: clipEnd(title(book)), n: book.sources.length }), oddText(odd)]
      .filter(Boolean)
      .join(' · '),
    odd?.n ? 8000 : undefined,
  );
}
export function install(c) {
  ctx = c;
}
