import { at, point, pageKind } from '../core/model.mjs';
import { forget } from '../reader/thumbs.mjs';
import { pair } from '../core/sections.mjs';
import { isMedia, key, endKey, list, coord, coords } from './list.mjs';
// 书签的数据操作：按阅读位置添加书签与区段书签（区段配对见 sections.mjs）、删除、跳转（F / Enter 短按、长按添加；跨书开关关闭时只在本书内），以及离阅读位置最近的书签。
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
  // 添加区段书签：取屏幕中央的位置，按 sections.mjs 的规则配给前面的一个区段（更新终点）或普通书签（新建区段）。
  // 返回 'added' | 'updated'，没有添加时为 false。终点离起点不到半屏（同一张图内）按“这里已有书签”处理。
  // 媒体：只在同一个文件内按时间配对（当前媒体的当前时间）；离起点不到 NEAR 秒按“这里已有书签”处理。
  async function addSection(player) {
    const book = ctx.current,
      p = target(player);
    if (!book || !p) return false;
    const r = pair(coords(list(book), p.player ? p.i : -1), p.player ? p.t : coord(p.i, p));
    if (!r) {
      notice(null, t('secNone'));
      return false;
    }
    const bm = book.bookmarks.find((b) => b.id === r.id);
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
  // 离屏幕中心最近的有效书签；刚跳到的书签被夹在书首 / 书尾时仍是它。还没有版面时返回 null。
  function nearest(book) {
    if (repeat(book)) return S.last.id;
    const s = starts();
    if (!s) return null;
    const items = list(book).filter((x) => x.i >= 0),
      m = book === ctx.current ? mediaNow() : null;
    // 当前媒体里有书签：取播放时间之前最近的一个（还没到第一个时取第一个）。
    if (m) {
      const own = items.filter((x) => x.i === m.i && isMedia(x.bm));
      if (own.length) return (own.findLast((x) => x.bm.t <= m.t + 0.5) ?? own[0]).bm.id;
    }
    const y = main.scrollTop + main.clientHeight / 2;
    let best = null,
      gap = Infinity;
    for (const x of items) {
      const d = Math.abs(point(s, { i: x.i, f: isMedia(x.bm) ? 0.5 : x.bm.f }) - y);
      if (d < gap) {
        gap = d;
        best = x.bm.id;
      }
    }
    return best;
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
      // 跨书（总控栏的开关）关闭时只在本书的书签之间跳；开启时书架书签常驻则跨书跳（dock.mjs nextShelf）。
      if (!p.done) (S.pinned() && ctx.transport?.crossBook ? S.nextShelf : next)(p.d);
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
