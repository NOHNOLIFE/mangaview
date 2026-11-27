import { at, point, pageKind } from '../core/model.mjs';
import { forget } from '../reader/thumbs.mjs';
import { starts as startsBefore } from '../core/sections.mjs';
import { line, recent } from '../core/recent.mjs';
import { isMedia, key, endKey, list, coord, coords } from './list.mjs';
// 书签的数据操作：按阅读位置添加书签与区段书签（先在「选择起点」里选起点，startpick.mjs；规则见 core/sections.mjs）、删除、
// 跳转（F / Enter 短按、长按添加；总控栏的循环不是跨书循环时只在本书内），以及最近书签（规则见 core/recent.mjs）。
const SHOW = 150,
  ADD = 550,
  NEAR = 2; // NEAR：同一媒体这么多秒内已有书签即视为已存在
export function install(ctx, S) {
  const { main, view, t, fmt, notice } = ctx;
  function starts() {
    const s = view.panes[0].starts,
      b = ctx.current;
    return b?.pages.length && s.length === b.pages.length + 1 ? s : null;
  }
  // 屏幕中心所在的图与图内位置（view.anchor() 在书首返回 null，这里不能用）。
  // 单文件模式下取 view.anchor()（该页在长条里的位置，h 为长条里的高度），退出单文件模式后书签仍指向同一处。
  function here() {
    const s = starts();
    if (!s) return null;
    if (view.single) {
      const a = view.anchor(),
        i = a ? ctx.current.pages.findIndex((p) => p.name === a.name) : -1;
      return i < 0 ? null : { i, f: a.f, name: a.name, h: view.stripH(ctx.current.pages[i]) };
    }
    const { i, f } = at(s, main.scrollTop + main.clientHeight / 2);
    return { i, f, name: ctx.current.pages[i].name, h: s[i + 1] - s[i] };
  }
  // 添加书签的位置：有当前媒体（ctx.media.current，从壳上的按钮添加时是那个播放器）时为它的当前播放时间；
  // 否则是屏幕中央的图片位置，中央是播放不了的媒体时不添加。
  function target(player = ctx.media?.current?.()) {
    const book = ctx.current;
    if (!book) return null;
    if (player && player.book === book) {
      const i = book.pages.indexOf(player.page);
      if (i >= 0)
        return { i, name: player.page.name, t: Math.round((ctx.player.api.time(player) || 0) * 1000) / 1000, player };
    }
    const h = here();
    return h && pageKind(book.pages[h.i]) === 'image' ? h : null;
  }
  // 当前媒体所在的页与播放时间（媒体书签按时间比较前后）。
  function mediaNow() {
    const p = ctx.media?.current?.(),
      b = ctx.current;
    if (!p || p.book !== b) return null;
    const i = b.pages.indexOf(p.page);
    return i < 0 ? null : { i, t: ctx.player.api.time(p) || 0 };
  }
  // 书签相对阅读位置的前后：返回比较函数，>0 在后，<0 在前，0 视为就在这里。当前媒体里的书签按播放时间比较，其余按画面位置（媒体页取其中线）。
  function cursor() {
    const s = starts();
    if (!s) return null;
    const y = main.scrollTop + main.clientHeight / 2,
      m = mediaNow(),
      page = at(s, y).i;
    return (x) => {
      if (m && x.i === m.i && isMedia(x.bm)) return x.bm.t > m.t + 0.5 ? 1 : x.bm.t < m.t - 0.5 ? -1 : 0;
      if (view.single) return Math.sign(x.i - page); // 单文件模式：同一页的书签都算"就在这里"
      const py = point(s, { i: x.i, f: isMedia(x.bm) ? 0.5 : x.bm.f });
      return py > y + 2 ? 1 : py < y - 2 ? -1 : 0;
    };
  }
  S.last = null; // 最近一次跳到的书签：滚动位置被夹住（书首 / 书尾）时仍能接着跳下一个。
  // 跳到媒体书签：把该媒体滚到视窗中央，定位到书签时间（自动播放开启则从该处播放，见 media.mjs goto）。
  function seat(i, m) {
    const book = ctx.current;
    if (isMedia(m)) {
      view.jump({ i, f: 0.5 });
      ctx.media?.goto(book, book.pages[i], m.t);
    } else view.jump({ i, f: m.f });
  }
  function go(x) {
    seat(x.i, x.bm);
    S.last = { id: x.bm.id, top: main.scrollTop, book: ctx.current, t: isMedia(x.bm) ? x.bm.t : null };
    S.markDock();
    S.reveal();
  }
  // 刚跳到的书签：滚动位置没变，媒体书签还要求播放时间仍在它附近（播放了一会儿就按当前时间重新找）。
  const repeat = (book) =>
    S.last &&
    S.last.book === book &&
    Math.abs(main.scrollTop - S.last.top) < 2 &&
    (S.last.t == null || Math.abs((mediaNow()?.t ?? S.last.t) - S.last.t) < 1.5);
  // d=1：下一个书签，到末尾回到第一个；d=-1（Shift）：上一个，到开头回到最后一个。
  function next(d = 1) {
    const book = ctx.current;
    if (!book) return;
    if (!book.bookmarks?.length) {
      notice(null, t('bmNone'));
      return;
    }
    const valid = list(book).filter((x) => x.i >= 0),
      s = starts();
    if (!valid.length) {
      notice('bmAllGone');
      return;
    }
    if (!s) return;
    let k = repeat(book) ? valid.findIndex((x) => x.bm.id === S.last.id) : -1;
    if (k >= 0) k += d;
    else {
      const r = cursor();
      k = d > 0 ? valid.findIndex((x) => r(x) > 0) : valid.findLastIndex((x) => r(x) < 0);
    }
    const wrap = k < 0 || k >= valid.length;
    if (wrap) k = d > 0 ? 0 : valid.length - 1;
    go(valid[k]);
    notice(null, wrap ? t(d > 0 ? 'bmWrap' : 'bmWrapBack') : fmt('bmN', { n: k + 1, m: valid.length }));
  }
  async function add(player) {
    const book = ctx.current,
      p = target(player);
    if (!book || !p) return false;
    const close = p.player
      ? (b) =>
          b.name === p.name && [b, b.end].some((m) => isMedia(m) && m.name === p.name && Math.abs(m.t - p.t) < NEAR)
      : (b) => b.name === p.name && Math.abs(b.f - p.f) * p.h < main.clientHeight / 2;
    if (book.bookmarks.some(close)) {
      notice('bmExists');
      return false;
    }
    const bm = p.player
        ? { id: crypto.randomUUID(), name: p.name, t: p.t, at: Date.now(), label: S.fresh(book, p.name) }
        : { id: crypto.randomUUID(), name: p.name, f: p.f, at: Date.now() },
      page = book.pages[p.i];
    book.bookmarks = list({ pages: book.pages, bookmarks: [...book.bookmarks, bm] }).map((x) => x.bm);
    await ctx.persist(book);
    notice('bmAdded');
    changed(book);
    if (p.player) S.shoot(book, bm, p.player).catch((e) => console.warn(e));
    else S.snap(book, bm, page, p, main.clientWidth, main.clientHeight).catch((e) => console.warn(e)); // 读图失败只缺缩略图，书签照常可用
    return true;
  }
  // 添加区段书签：终点取触发这一刻的位置（屏幕中央的图片位置，或当前媒体的当前时间，之后媒体照常播放），再弹出「选择起点」（startpick.mjs）：
  // 图片列出本书这里之前的图片书签，媒体列出同一文件里这个时间之前的书签（core/sections.mjs 的 starts），默认选中最近的一个。
  // 所选起点已有区段时把它的终点移到这里；区段可以嵌套、交叉。前面没有可选的书签时只提示、不弹出。
  // 返回 'added' | 'updated'，没有添加（取消、太近）时为 false。终点离起点不到半屏（同一张图内）、媒体不到 NEAR 秒按“这里已有书签”处理。
  // 图片书签与媒体书签互不配对。
  async function addSection(player) {
    const book = ctx.current,
      p = target(player);
    if (!book || !p) return false;
    const opts = startsBefore(coords(list(book), p.player ? p.i : -1), p.player ? p.t : coord(p.i, p));
    if (!opts.length) {
      notice(null, t('secNone'));
      return false;
    }
    S.close(); // 从书签面板打开时先收起面板
    ctx.ring.hide(); // 长按 Shift+F 时的进度环让位给对话框，确认后再显示完成
    const id = await S.pickStart(book, opts, p),
      bm = id && ctx.books.has(book.id) ? book.bookmarks.find((b) => b.id === id) : null;
    if (!bm) return false;
    if (
      p.player ? Math.abs(bm.t - p.t) < NEAR : bm.name === p.name && Math.abs(bm.f - p.f) * p.h < main.clientHeight / 2
    ) {
      notice('bmExists');
      return false;
    }
    const had = !!bm.end,
      end = (bm.end = p.player ? { name: p.name, t: p.t, at: Date.now() } : { name: p.name, f: p.f, at: Date.now() });
    await ctx.persist(book);
    notice(had ? 'secUpdated' : 'secAdded');
    changed(book);
    if (p.player) S.shoot(book, bm, p.player, end).catch((e) => console.warn(e));
    else S.snap(book, bm, book.pages[p.i], p, main.clientWidth, main.clientHeight, end).catch((e) => console.warn(e)); // 旧终点的缩略图换成新的
    return had ? 'updated' : 'added';
  }
  // 删除起点书签：它的区段书签一并删除。删除区段书签：起点变回普通书签。
  async function drop(book, bm) {
    book.bookmarks = book.bookmarks.filter((b) => b !== bm);
    if (S.last?.id === bm.id) S.last = null;
    await ctx.persist(book);
    forget(key(book, bm));
    await ctx.thumbs('delete', key(book, bm));
    if (bm.end) await ctx.thumbs('delete', endKey(book, bm));
    changed(book);
  }
  async function dropEnd(book, bm) {
    if (!bm.end) return;
    delete bm.end;
    await ctx.persist(book);
    forget(endKey(book, bm));
    await ctx.thumbs('delete', endKey(book, bm));
    changed(book);
  }
  // 书签增删改后：面板、书架书签列表、缩略图栏和全屏界面（ctx.on('marks')）只更新受影响的部分。
  function changed(book) {
    if (book === ctx.current && !S.panel.hidden) S.render();
    S.renderDock();
    ctx.emit('marks', book);
  }
  function jumpTo(id, end = false) {
    const book = ctx.current,
      x = book && list(book).find((x) => x.bm.id === id);
    if (!x) return;
    if (end) {
      if (x.e >= 0) goEnd(x);
    } else if (x.i >= 0) go(x);
  }
  // 跳到区段书签：它不是 F / Enter 的停靠点，不记为“刚跳到的书签”。
  function goEnd(x) {
    seat(x.e, x.bm.end);
    S.last = null;
    S.markDock();
    S.reveal();
  }
  // 阅读位置（最近书签用）：视窗中心所在的页与页内位置，这一页是视频、音频时取它的当前播放时间（还没有播放器时为 0）。
  // 容差：图片加 2 像素，媒体加半秒；单文件模式下这一页上的图片书签都算。还没有版面时为 null。
  function reading() {
    const s = starts(),
      book = ctx.current;
    if (!s) return null;
    let i, f, h;
    if (view.single) {
      const a = view.anchor();
      i = a ? book.pages.findIndex((p) => p.name === a.name) : -1;
      if (i < 0) return null;
    } else {
      ({ i, f } = at(s, main.scrollTop + main.clientHeight / 2));
      h = s[i + 1] - s[i];
    }
    const page = book.pages[i];
    if (pageKind(page) !== 'image') {
      const p = ctx.player?.list().find((q) => q.book === book && q.page === page);
      return { i, v: (p ? ctx.player.api.time(p) || 0 : 0) + 0.5 };
    }
    return { i, v: view.single ? Infinity : f + 2 / Math.max(1, h) };
  }
  const entries = (book) => (book.bookmarks?.length ? line(list(book)) : []);
  // 最近书签（core/recent.mjs）：当前阅读位置之前最近的一项（区段的起点、终点各算一项），本书前面没有时取 books 里前面最近一本有书签的书的最后一项。
  // books：参与的书，按阅读列表的顺序（书签面板只有当前书）。刚跳到的书签被夹在书首 / 书尾（滚动位置没变）时仍是它。
  // 返回 {book, id, end}（end：是区段书签那一项），没有或还没有版面时为 null。
  function nearest(books = [ctx.current]) {
    const book = ctx.current;
    if (!book) return null;
    if (repeat(book)) return { book, id: S.last.id, end: false };
    const here = reading();
    return here && recent(books, book, entries, here);
  }
  // F / Enter：短按跳到下一个书签（按住 Shift 为上一个）；长按 150ms 后显示进度环，满 550ms 添加书签，按住 Shift 时添加区段书签。
  let press = null;
  const showHold = (state, sec, r) =>
    state === 'done'
      ? ctx.ring.done('check', t(sec ? (r === 'updated' ? 'secUpdated' : 'secAdded') : 'bmAdded'))
      : ctx.ring.show(sec ? 'bm-start' : 'bookmark', t(sec ? 'secKeep' : 'bmKeep'));
  function cancel() {
    if (!press) return;
    clearTimeout(press.show);
    clearTimeout(press.add);
    if (!press.done) ctx.ring.hide();
    press = null;
  }
  ctx.keys.push({
    down(e) {
      if (e.key !== 'Enter' && e.key.toLowerCase() !== 'f') return false;
      e.preventDefault();
      if (e.repeat || press) return true;
      const p = (press = { code: e.code, d: e.shiftKey ? -1 : 1, sec: e.shiftKey, done: false });
      p.show = setTimeout(() => showHold('fill', p.sec), SHOW);
      p.add = setTimeout(() => {
        p.done = true;
        ctx.safe(async () => {
          const r = await (p.sec ? addSection : add)();
          if (r) showHold('done', p.sec, r);
          else ctx.ring.hide();
        })();
      }, ADD);
      return true;
    },
    up(e) {
      if (!press || e.code !== press.code) return;
      const p = press;
      cancel();
      // 总控栏的循环是跨书循环、且书架书签常驻时跨书跳（dock.mjs nextShelf）；其余只在本书的书签之间跳。
      if (!p.done) (S.pinned() && ctx.transport?.loop === 'books' ? S.nextShelf : next)(p.d);
    },
    blur() {
      cancel();
    },
  });
  Object.assign(S, {
    starts,
    cursor,
    repeat,
    go,
    goEnd,
    next,
    add,
    addSection,
    drop,
    dropEnd,
    changed,
    jumpTo,
    nearest,
    cancel,
  });
}
