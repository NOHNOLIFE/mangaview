// 播放列表（后台播放的列表，ctx.media.queue）与收藏列表。规则在 core/playlist.mjs。
// - 列表：有序的项（书 + 文件，可以跨多本书），一个窗口一份，只在内存里（临时列表）。只收视频、音频，记为播不了的不显示、不接续。
// - 替换（列表换成某本书的全部可播放视频、音频，按页序）：以任何方式开始播放一个不在列表里的文件（ensure：driver.mjs 在阅读区点击、
//   文件栏的播放键、空格，order.mjs 书签跳转带起的播放，play 一个不在列表里的项）；跨书接续或切换进入一本不在列表里的书；载入收藏列表（换成收藏的内容）。
//   开始播放已在列表里的文件、切换循环范围、过滤、暂停 / 继续、列表内切换都不改列表；自动滚动、自动播放播放的媒体不读写列表。
// - 追加：addBook(书) 把这本书可播放的视频、音频按页序接到列表末尾，已在列表里的不重复；不播放、不改变当前曲目。
// - 移除：remove(项) 从列表删掉它；移除的是当前曲目时切到它后面最近的可接续项（后面没有时从头找；保持播放或暂停），
//   没有可接续项时停止播放并取消当前曲目（文件栏回到视窗中心所在的页）。
// - 过滤：类型（音频、视频，可多选，全不选即不限）与「只含书签」（文件上至少有一个书签）。被过滤的项留在列表里、标记为已过滤：
//   接续、上一个 / 下一个跳过它们，仍然可以直接点它播放、移除、定位。
// - 接续（proceed，order.mjs finished 对后台播放的当前曲目调用）：按循环范围（afterEnd）：单文件重播；列表播完末项回到第一项；
//   跨书在列表播完后取阅读列表（ctx.readingList，与上一本 / 下一本一致）里末项所在书的下一本有可接续媒体的书（最后一本之后回到第一本）：
//   它的项已在列表里时跳到列表里它的第一个可接续项，列表不变；否则列表换成那本书。开着「只播放书签区段」且书里有区段时
//   跳过没有区段的媒体（整个处在图片区段之内的除外；跨书时跳过没有区段的书，与自动滚动相同）。下一项从头（或第一个区段）播放，
//   画面留在原来的显示位置，主窗口不滚动、不跳转；下一项不在正文里时播放器不经正文建出、停放（track.mjs）。窗口转入后台时照常接续。
// - 上一个 / 下一个（step）：在列表里按顺序移动、跳过被过滤的项，保持播放或暂停，从头（或第一个区段）开始。在列表两端：单文件、列表范围首尾相接；
//   跨书范围进入阅读列表里首项所在书的上一本（它的最后一个可接续项）/ 末项所在书的下一本（第一个），已在列表里就不替换（同接续）。
//   当前曲目不在列表里（如自动滚动播放的）时先把列表换成它所在的书。
// - 设置类偏好（ctx.prefs.sync：跨窗口同步，「还原默认设置」重置）：循环范围 'playScope'（'file' 单文件 | 'list' 列表〔默认〕| 'books' 跨书，
//   都循环；旧值 'book' 读作列表）、类型 'playTypes'（'audio' / 'video' 的子集，空为不限，默认不限）、只含书签 'playMarked'（默认关）。
//   它们的按钮和列表本身在画中画窗口里；不支持画中画的浏览器按已保存的偏好（默认值）接续。
// - 收藏列表：存在 localStorage 的 'playlists'（用户数据：不随「还原默认设置」清除，随备份导出、导入时按 id 合并，见 panels/backup.mjs），
//   别的窗口改了经 'storage' 事件同步。每个收藏是 {id, name, items: [{book: 书的 id, page: 页名}]}，保存后不随临时列表变化，只能改名、删除。
//
// 接口 ctx.media.queue（列表界面只调用它）：
// - items() → [{book, page, kind, current, filtered, marks}]：列表的项，按列表顺序（播不了的不在其中）。book 所在的书、page 文件（页对象）、
//   kind 'video' | 'audio'、current 是当前曲目、filtered 被过滤、marks 书签情况：'none' 没有 | 'mark' 有书签 | 'section' 有区段书签。
// - track() → 当前曲目 {book, page, kind, playing, by}（by：'user' 后台播放 | 'scroll' 自动滚动 | 'auto' 自动播放）或 null；playing() → 是否在播放（含等着播放）。
// - play(item, {time?}?)：后台播放该项（item 为 {book, page}，可以是别的书里的；不跳转、不滚动；不在列表里时替换列表）。从 time 秒开始，
//   省略时从记住的位置开始；成为当前曲目，画面留在原来的显示位置。toggle()：当前曲目的播放 / 暂停。
// - step(d) / prev() / next()：上一个 / 下一个（见上）；canStep(d) 有没有可切换的项（跨书范围在列表一端时，阅读列表里有别的书即为真，不逐本查找）。
// - remove(item)：从列表移除（见上）。addBook(book) → 追加的项数（见上；都已在列表里时为 0）。
// - locate(item?)：主窗口跳到该项（默认当前曲目）所在的页并居中，必要时切书；不播放、不改变当前曲目。
// - scope / setScope(v)、types / setTypes(数组)、marked / setMarked(b)：读写偏好；filtering() 有没有过滤生效（类型或只含书签）。
// - favorites：收藏列表。list() → [{id, name, count}]（按保存顺序；count 为保存的项数）；defaultName() → 保存当前列表时的默认名
//   （第一项所在的书名，跨多本书时注明本数，与已有的重名时加序号；列表里没有可保存的项时为 ''）；
//   save(name?) 把当前列表里没有被过滤的项按当前顺序存成一个新收藏（name 为空时用默认名），返回 {id, name, count}，没有可保存的项时为 null；
//   load(id) 用收藏的内容替换列表并从第一个可接续项开始播放，找不到的书（已删除、过期）和文件跳过，一项都找不到时提示、不替换，返回是否载入；
//   rename(id, name)（name 为空时不改）、remove(id)：返回是否改了。
// 事件：ctx.emit('queue', key)：'list' 列表的内容或项的状态变了（替换、追加、移除、过滤变化、列表里的书的书签或页变化、书被删除）；
// 'scope' / 'types' / 'marked' 偏好变了（本窗口或别的窗口）；'favorites' 收藏列表变了（本窗口或别的窗口）。
// 当前曲目变了是 ctx.emit('media', 'track')，播放 / 暂停 'state'，当前曲目的时间 'time'（当前曲目即文件栏显示的文件），画面的显示位置 'display'。
import { extend } from '../core/lang.mjs';
import { pageKind } from '../core/model.mjs';
import {
  scopeOf,
  typesOf,
  markedOf,
  passes,
  filtering,
  markKind,
  mediaOf,
  append,
  afterEnd,
  stepTo,
  afterRemove,
  favoritesOf,
  defaultName,
} from '../core/playlist.mjs';
import { nextBook } from '../core/engine.mjs';

extend({
  qFavBooks: ['{s} and more ({n} books)', '{s} 等 {n} 本', '{s} ほか（{n} 冊）', '{s} 외 ({n}권)'],
  qFavGone: [
    'None of the files in this list can be found',
    '这个收藏列表里的文件都找不到了',
    'このリストのファイルはどれも見つかりません',
    '이 목록의 파일을 하나도 찾을 수 없습니다',
  ],
});
const FAVORITES = 'playlists';

export function install(ctx, S) {
  const { get, put, t, fmt } = ctx,
    { times, failedPages } = S;
  const start = (...a) => S.start(...a),
    sectionMap = (...a) => S.sectionMap(...a),
    rangesOf = (...a) => S.rangesOf(...a),
    selfSeek = (...a) => S.selfSeek(...a),
    savedPos = (...a) => S.savedPos(...a),
    on = (...a) => S.on(...a);
  const Q = { items: [] }; // 项 {book, name}（name 为页名），按列表顺序
  const emit = (key) => ctx.emit('queue', key);

  // ---- 偏好
  const FIELDS = {
    scope: ['playScope', scopeOf],
    types: ['playTypes', typesOf],
    marked: ['playMarked', markedOf],
  };
  const pref = {};
  for (const [field, [key, norm]] of Object.entries(FIELDS)) {
    pref[field] = norm(get(key, null));
    ctx.prefs.sync(key, (v) => setPref(field, v, false));
  }
  function setPref(field, value, local = true) {
    const [key, norm] = FIELDS[field],
      v = norm(value);
    if (JSON.stringify(pref[field]) === JSON.stringify(v)) return;
    pref[field] = v;
    if (local) put(key, v);
    emit(field);
    if (field !== 'scope') emit('list'); // 过滤变了：各项的「被过滤」随之变化，列表内容不变
  }
  const filter = () => ({ types: pref.types, marked: pref.marked });

  // ---- 项与页：项按页名指称（页对象会随刷新、别的窗口的改动换掉），页序号按书缓存，书的页变了（换了数组或原地重排）即重建。
  const slots = new WeakMap(); // 书 → {pages, n, at: Map(页名 → 页序号)}
  const index = (pages) => ({ pages, n: pages.length, at: new Map(pages.map((p, i) => [p.name, i])) });
  function indexOf(book, name) {
    const pages = book.pages;
    let s = slots.get(book);
    if (!s || s.pages !== pages || s.n !== pages.length) slots.set(book, (s = index(pages)));
    let i = s.at.get(name);
    if (i != null && pages[i]?.name !== name) {
      slots.set(book, (s = index(pages)));
      i = s.at.get(name);
    }
    return i ?? -1;
  }
  const pageOf = (e) => {
    const i = indexOf(e.book, e.name);
    return i < 0 ? null : e.book.pages[i];
  };
  const isAv = (page) => ['video', 'audio'].includes(pageKind(page));
  const playable = (page) => !!page && isAv(page) && !page.bad && !failedPages.has(page);
  const keyOf = (e) => e.book.id + '\n' + e.name;
  const at = (p, items = Q.items) => items.findIndex((e) => e.book === p.book && e.name === p.page.name);
  // 一本书的全部可播放视频、音频（按页序）。
  const entriesOf = (book) =>
    mediaOf(book.pages.map(pageKind), (i) => !playable(book.pages[i])).map((i) => ({ book, name: book.pages[i].name }));
  // 书签汇总（marks/list.mjs pageMarks：页序号 → {n, start, end, …}），一次调用里每本书只算一次。
  const marksOf = (book, cache) => {
    let m = cache.get(book);
    if (!m) cache.set(book, (m = ctx.marks?.pages?.(book) ?? new Map()));
    return m;
  };
  // 每项是否可接续：播得了、没有被过滤；chain 为真（播完接续、移除当前曲目）时另按只播区段的规则（sections.mjs sectionMap）。
  function oks(items = Q.items, chain = false) {
    const F = filter(),
      marks = new Map(),
      secs = new Map();
    return items.map((e) => {
      const i = indexOf(e.book, e.name),
        page = i < 0 ? null : e.book.pages[i];
      if (!playable(page)) return false;
      if (!passes(F, pageKind(page), F.marked ? (marksOf(e.book, marks).get(i)?.n ?? 0) : 0)) return false;
      if (!chain) return true;
      if (!secs.has(e.book)) secs.set(e.book, sectionMap(e.book));
      const w = secs.get(e.book);
      return !w || !!w.get(page.name)?.length || !!w.covered?.has(i);
    });
  }
  // 当前曲目在 items 里的位置；不在其中（播不了的不列入）时按页序放在它所在书的项之间（如 1.5：第 1、2 项之间）。
  function place(p, items = Q.items) {
    const k = at(p, items);
    if (k >= 0) return k;
    const i = indexOf(p.book, p.page.name),
      j = items.findIndex((e) => e.book === p.book && indexOf(e.book, e.name) > i);
    return (j < 0 ? items.length : j) - 0.5;
  }
  function replace(book) {
    Q.items = entriesOf(book);
    emit('list');
  }
  const ensure = (p) => at(p) >= 0 || replace(p.book);
  function addBook(book) {
    if (!book?.pages) return 0;
    const r = append(Q.items, entriesOf(book), keyOf);
    if (!r.added) return 0;
    Q.items = r.list;
    emit('list');
    return r.added;
  }
  // 从头（或第一个区段）开始的时间。
  function head(book, page) {
    const rs = sectionMap(book)?.get(page.name) ?? [];
    return rs.length ? rs[0].a : 0;
  }

  // ---- 播放某个文件（不跳转）：有播放器就用它，否则不经正文建一个（停放，track.mjs）。成为当前曲目，保持显示位置。
  function playAt(book, page, { time = null, play = true, hop = false } = {}) {
    if (!book || !page) return null;
    const kind = pageKind(page);
    if (kind !== 'video' && kind !== 'audio') return null;
    const p = S.find(book, page) ?? S.build(null, book, page, kind);
    if (p.state === 'failed') return null;
    if (time != null) {
      times.set(page, time);
      if (p.state === 'ready') selfSeek(p, time);
      else p.time = time;
    }
    p.by = 'user';
    p.hop = hop;
    p.done = false;
    S.select(p, 'switch', { stay: true });
    if (play) start(p);
    else if (S.track === p && p.state === 'ready' && !p.el.paused) S.pause(p);
    return p;
  }
  function go(k, play) {
    const e = Q.items[k],
      page = e && pageOf(e);
    return page ? playAt(e.book, page, { time: head(e.book, page), play, hop: play }) : null;
  }

  // ---- 播完之后（order.mjs finished，后台播放的当前曲目）
  function proceed(p) {
    if (p !== S.track) return;
    if (at(p) < 0) replace(p.book);
    const r = afterEnd({ scope: pref.scope, ok: oks(Q.items, true), cur: place(p) });
    if (r.type === 'replay') return restart(p);
    if (r.type === 'next') return go(r.next, true);
    if (r.type === 'onward') return cross(1, true, true);
  }
  function restart(p) {
    const rs = S.only ? rangesOf(p) : [],
      s = rs.length ? rs[0].a : 0;
    if (p.state === 'ready') selfSeek(p, s);
    else p.time = s;
    p.hop = true;
    start(p);
  }
  // 跨书（d 为 1 下一本、-1 上一本）：从列表末项 / 首项所在的书起，取阅读列表里下一本 / 上一本有可接续媒体的书（两端相接，可能回到它自己；
  // chain 为真且开着只播区段时跳过没有区段的书）。它的项已在列表里时切到列表里它的第一个 / 最后一个可接续项，列表不变；否则列表换成那本书。
  function crossPlan(d, chain) {
    const end = d > 0 ? Q.items.at(-1) : Q.items[0],
      from = end?.book ?? S.track?.book;
    if (!from) return null;
    const ok = oks(Q.items, chain),
      mine = new Map();
    Q.items.forEach((e, k) => {
      if (!mine.has(e.book)) mine.set(e.book, []);
      mine.get(e.book).push(k);
    });
    const list = ctx.readingList(),
      order = d > 0 ? list : [...list].reverse();
    const fine = (b) =>
      (!chain || !S.only || !!sectionMap(b)) &&
      (mine.has(b) ? mine.get(b).some((k) => ok[k]) : oks(entriesOf(b), chain).some(Boolean));
    const to = nextBook(order, from, true, fine);
    if (!to) return null;
    const pick = (ks) => (d > 0 ? ks[0] : ks.at(-1));
    if (mine.has(to)) return { items: Q.items, k: pick(mine.get(to).filter((k) => ok[k])) };
    const items = entriesOf(to);
    return { items, k: pick(oks(items, chain).flatMap((x, k) => (x ? [k] : []))) };
  }
  function cross(d, play, chain) {
    const r = crossPlan(d, chain);
    if (!r || r.k == null) return;
    if (r.items !== Q.items) {
      Q.items = r.items;
      emit('list');
    }
    go(r.k, play);
  }

  // ---- 上一个 / 下一个。当前曲目不在列表里时按它所在的书的列表算（切换时再替换）。
  function plan(d) {
    const p = S.track;
    if (!p) return null;
    const items = at(p) >= 0 ? Q.items : entriesOf(p.book),
      cur = place(p, items),
      ok = oks(items),
      r = stepTo({ scope: pref.scope, ok, cur, d });
    return r && { ...r, items, ok, cur };
  }
  function step(d) {
    const p = S.track,
      r = plan(d);
    if (!p || !r) return;
    const play = on(p);
    if (r.items !== Q.items) {
      Q.items = r.items;
      emit('list');
    }
    if (r.type === 'item') go(r.i, play);
    else cross(d, play, false);
  }
  function canStep(d) {
    const r = plan(d);
    if (!r) return false;
    return r.type === 'item' || ctx.readingList().length > 1 || r.ok.some((x, k) => x && k !== r.cur);
  }

  // ---- 移除、定位
  function remove(item) {
    if (!item?.book || !item.page) return;
    const k = Q.items.findIndex((e) => e.book === item.book && e.name === item.page.name);
    if (k < 0) return;
    const p = S.track,
      cur = !!p && p.book === item.book && p.page.name === item.page.name;
    Q.items = Q.items.filter((_, j) => j !== k);
    emit('list');
    if (!cur) return;
    const j = afterRemove(oks(Q.items, true), k);
    if (j == null) return end(p);
    go(j, on(p));
  }
  // 没有可接续的项：停止播放、取消当前曲目（自动滚动正在播它时一并停止自动滚动）。
  function end(p) {
    if (ctx.transport.running && p.by === 'scroll') ctx.transport.stop();
    if (on(p)) S.pause(p);
    S.stop();
  }
  function locate(item) {
    const it = item ?? (S.track && { book: S.track.book, page: S.track.page });
    if (!it?.book || !it.page) return;
    const { book, page } = it;
    if (book !== ctx.current) ctx.select(book);
    if (ctx.current !== book) return;
    const jump = () => {
      const i = book.pages.indexOf(page),
        starts = ctx.view.panes?.[0]?.starts ?? [];
      if (ctx.current !== book || i < 0) return true;
      if (starts.length !== book.pages.length + 1) return false;
      if (S.full) S.leaveFull();
      ctx.view.jump({ i, f: 0.5 });
      return true;
    };
    if (!jump()) requestAnimationFrame(jump);
  }

  // ---- 列表里的书变了：被删除的书的项移除；书签、页变了时各项的状态随之变化。
  const touches = (book) => Q.items.some((e) => e.book === book);
  ctx.on('books', () => {
    const keep = Q.items.filter((e) => ctx.books.get(e.book.id) === e.book);
    if (keep.length === Q.items.length) return;
    Q.items = keep;
    emit('list');
  });
  ctx.on('marks', (book) => touches(book) && emit('list'));
  ctx.on('synced', (book, keys) => {
    if (touches(book) && keys.some((k) => k === 'bookmarks' || k === 'pages')) emit('list');
  });

  // ---- 收藏列表
  const readFavorites = () => favoritesOf(get(FAVORITES, null));
  function writeFavorites(list) {
    put(FAVORITES, list);
    emit('favorites');
  }
  ctx.on('storage', (key) => key === FAVORITES && emit('favorites'));
  // 可保存的项：播得了、没有被过滤的，按当前顺序。
  const saveable = () => {
    const ok = oks();
    return Q.items.filter((_, k) => ok[k]);
  };
  function nameFor(items, all) {
    const books = [...new Set(items.map((e) => e.book))],
      first = ctx.title(books[0]),
      base = books.length > 1 ? fmt('qFavBooks', { s: first, n: books.length }) : first;
    return defaultName(
      base,
      all.map((f) => f.name),
    );
  }
  const favorites = {
    list: () => readFavorites().map((f) => ({ id: f.id, name: f.name, count: f.items.length })),
    defaultName() {
      const items = saveable();
      return items.length ? nameFor(items, readFavorites()) : '';
    },
    save(name) {
      const items = saveable();
      if (!items.length) return null;
      const all = readFavorites(),
        f = {
          id: crypto.randomUUID(),
          name: String(name ?? '').trim() || nameFor(items, all),
          items: items.map((e) => ({ book: e.book.id, page: e.name })),
        };
      writeFavorites([...all, f]);
      return { id: f.id, name: f.name, count: f.items.length };
    },
    load(id) {
      const f = readFavorites().find((x) => x.id === id);
      if (!f) return false;
      const found = [];
      for (const x of f.items) {
        const book = ctx.books.get(x.book);
        if (!book || ctx.expired?.(book)) continue;
        const i = indexOf(book, x.page);
        if (i >= 0 && playable(book.pages[i])) found.push({ book, name: x.page });
      }
      const items = append([], found, keyOf).list;
      if (!items.length) {
        ctx.notice(null, t('qFavGone'));
        return false;
      }
      Q.items = items;
      emit('list');
      const k = oks(items, true).indexOf(true);
      go(k < 0 ? 0 : k, true);
      return true;
    },
    rename(id, name) {
      const s = String(name ?? '').trim(),
        all = readFavorites(),
        f = all.find((x) => x.id === id);
      if (!f || !s || f.name === s) return false;
      f.name = s;
      writeFavorites(all);
      return true;
    },
    remove(id) {
      const all = readFavorites(),
        rest = all.filter((x) => x.id !== id);
      if (rest.length === all.length) return false;
      writeFavorites(rest);
      return true;
    },
  };

  const describe = (p) => (p ? { book: p.book, page: p.page, kind: p.kind, playing: on(p), by: p.by ?? 'user' } : null);
  ctx.media.queue = {
    items() {
      const p = S.track,
        F = filter(),
        marks = new Map(),
        out = [];
      for (const e of Q.items) {
        const i = indexOf(e.book, e.name),
          page = i < 0 ? null : e.book.pages[i];
        if (!playable(page)) continue;
        const kind = pageKind(page),
          m = marksOf(e.book, marks).get(i);
        out.push({
          book: e.book,
          page,
          kind,
          current: !!p && p.book === e.book && p.page.name === e.name,
          filtered: !passes(F, kind, m?.n ?? 0),
          marks: markKind(m),
        });
      }
      return out;
    },
    track: () => describe(S.track),
    playing: () => !!S.track && on(S.track),
    play(item, { time } = {}) {
      if (!item?.book || !item.page) return;
      const p0 = S.find(item.book, item.page),
        tm = time ?? (p0 ? null : (times.get(item.page) ?? savedPos(item.book, item.page)));
      const p = playAt(item.book, item.page, { time: tm, play: true });
      if (p) ensure(p);
    },
    toggle() {
      const p = S.track;
      if (!p) return;
      if (on(p)) S.pause(p);
      else {
        if (ctx.transport.running && p.by === 'scroll') ctx.transport.stop();
        p.by = 'user';
        start(p);
      }
    },
    step,
    prev: () => step(-1),
    next: () => step(1),
    canStep,
    remove,
    addBook,
    locate,
    get scope() {
      return pref.scope;
    },
    get types() {
      return [...pref.types];
    },
    get marked() {
      return pref.marked;
    },
    filtering: () => filtering(filter()),
    setScope: (v) => setPref('scope', v),
    setTypes: (v) => setPref('types', v),
    setMarked: (b) => setPref('marked', !!b),
    favorites,
  };
  Object.assign(S, { proceed, ensure });
}
