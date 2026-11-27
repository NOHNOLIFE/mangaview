// 播放列表（后台播放的列表，ctx.media.queue）：一个窗口一份，只在内存里，不持久化。规则在 core/playlist.mjs。
// - 内容：列表所属的书（当前曲目所在的书）里可播放的视频、音频，按页序；类型开关之外的、本次移除的、记为播不了的不列入（queueOf）。
// - 重建（列表换成当前曲目所在的书，清掉移除记录与随机的本轮记录）：在阅读区点文件本体开始播放它（driver.mjs press 'page'）；
//   切换循环范围或类型开关；以其他方式（文件栏的播放键、空格、书签跳转带起的播放、play 一个不在列表里的项）开始播放不在列表里的文件（ensure）。
//   暂停 / 继续、列表内切换、自动滚动、自动播放都不重建（自动滚动播放的媒体不读写列表）。
// - 接续（proceed，order.mjs finished 对后台播放的当前曲目调用）：按循环范围与随机（afterEnd）：单文件重播；本书播完回到第一项；跨书在本书的列表播完后
//   进入阅读列表（ctx.readingList，与上一本 / 下一本一致）里下一本有可播放媒体（按类型开关）的书，列表换成那本，最后一本之后回到第一本。
//   开着「只播放书签区段」且书里有区段时跳过没有区段的媒体（与自动滚动相同）。下一项从头（或第一个区段）播放，画面留在原来的显示位置，
//   主窗口不滚动、不跳转；下一项不在正文里时播放器不经正文建出、停放（track.mjs）。窗口转入后台时照常接续（不依赖动画帧）。
// - 设置类偏好（ctx.prefs.sync：跨窗口同步，「还原默认设置」重置）：循环范围 'playScope'（'file' 单文件 | 'book' 本书〔默认〕| 'books' 跨书，都循环）、
//   随机 'playShuffle'（默认关；不重复地播完一轮再重新洗牌，自动滚动不受它影响）、类型 'playTypes'（'audio' / 'video' 的子集，空为不限，默认不限）。
//   它们的按钮和列表本身在画中画窗口里；不支持画中画的浏览器按已保存的偏好（默认值）接续。
//
// 接口 ctx.media.queue（列表界面只调用它）：
// - items() → [{book, page, kind, current}]：列表的项，按页序；current 为当前曲目。book() → 列表所属的书（没有为 null）。
// - track() → 当前曲目 {book, page, kind, playing, by}（by：'user' 后台播放 | 'scroll' 自动滚动 | 'auto' 自动播放）或 null；playing() → 是否在播放（含等着播放）。
// - play(item, {time?}?)：后台播放该项（item 为 {book, page}，可以是别的书里的；不跳转、不滚动；不在列表里时重建）。从 time 秒开始，
//   省略时从记住的位置开始；成为当前曲目，画面留在原来的显示位置。toggle()：当前曲目的播放 / 暂停。
// - step(d) / prev() / next()：列表内切换（d 为 ±1，按页序两端相接；随机开着时 next 取本轮未播过的、prev 回到上一个播过的）；
//   不跳转，保持播放或暂停，从头（或第一个区段）开始。canStep(d) 有没有可切换的项。
// - remove(item)：从列表移除（只对本次列表有效，重建后恢复）；移除的是当前曲目时切到页序上的下一项（保持播放或暂停），列表空了即 stop()。
// - stop()：结束后台播放——停止播放、清空列表、取消当前曲目，文件栏回到视窗中心所在的页（自动滚动正在播它时一并停止自动滚动）。
// - locate(item?)：主窗口跳到该项（默认当前曲目）所在的页并居中，必要时切书；不播放、不改变当前曲目。
// - scope / setScope(v)、shuffle / setShuffle(b)、types / setTypes(数组)：读写偏好。
// 事件：ctx.emit('queue', key)：'list' 列表内容变了（重建、移除、跨书接续、停止）；'scope' / 'shuffle' / 'types' 偏好变了（本窗口或别的窗口）。
// 当前曲目变了是 ctx.emit('media', 'track')，播放 / 暂停 'state'，当前曲目的时间 'time'（当前曲目即文件栏显示的文件），画面的显示位置 'display'。
import { pageKind } from '../core/model.mjs';
import { scopeOf, typesOf, queueOf, afterEnd, stepIn, following } from '../core/playlist.mjs';
import { nextBook } from '../core/engine.mjs';

export function install(ctx, S) {
  const { get, put } = ctx,
    { times, failedPages } = S;
  const start = (...a) => S.start(...a),
    sectionMap = (...a) => S.sectionMap(...a),
    rangesOf = (...a) => S.rangesOf(...a),
    selfSeek = (...a) => S.selfSeek(...a),
    savedPos = (...a) => S.savedPos(...a),
    on = (...a) => S.on(...a);
  const Q = { book: null, removed: new Set(), played: new Set(), history: [] };
  const emit = (key) => ctx.emit('queue', key);

  // ---- 偏好
  const FIELDS = {
    scope: ['playScope', (v) => scopeOf(v)],
    shuffle: ['playShuffle', (v) => v === true],
    types: ['playTypes', (v) => typesOf(v)],
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
    if (field !== 'shuffle' && S.track) rebuild(S.track);
    else if (field === 'shuffle') Q.played = new Set();
    emit(field);
  }

  // ---- 列表
  // book 的列表（页序号）：类型之内、没有记为播不了、本次没有移除的视频和音频。
  function list(book = Q.book) {
    if (!book) return [];
    const removed = book === Q.book ? Q.removed : null;
    return queueOf(book.pages.map(pageKind), pref.types, (i) => {
      const pg = book.pages[i];
      return !!pg.bad || failedPages.has(pg) || !!removed?.has(pg.name);
    });
  }
  // 接续用的列表：开着「只播放书签区段」且书里有区段时只留有区段（或整个处在图片区段之内）的。
  function chain(book) {
    const withSec = sectionMap(book),
      all = list(book);
    return withSec ? all.filter((i) => withSec.get(book.pages[i].name)?.length || withSec.covered?.has(i)) : all;
  }
  const at = (p) => p.book.pages.indexOf(p.page);
  const inList = (p) => Q.book === p.book && list().includes(at(p));
  function rebuild(p) {
    Q.book = p?.book ?? null;
    Q.removed = new Set();
    Q.played = new Set();
    Q.history = [];
    emit('list');
  }
  const ensure = (p) => inList(p) || rebuild(p);
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
  function go(book, i, play) {
    const cur = S.track;
    if (cur && cur.book === book) Q.history.push(cur.page.name);
    if (Q.history.length > 200) Q.history.shift();
    const page = book.pages[i];
    return playAt(book, page, { time: head(book, page), play, hop: play });
  }

  // ---- 播完之后（order.mjs finished，后台播放的当前曲目）
  function proceed(p) {
    if (p !== S.track) return;
    const book = p.book;
    if (Q.book !== book) rebuild(p);
    const r = afterEnd({ scope: pref.scope, shuffle: pref.shuffle, list: chain(book), cur: at(p), played: Q.played });
    Q.played = r.played;
    if (r.type === 'replay') return restart(p);
    if (r.type === 'next') return go(book, r.next, true);
    if (r.type === 'onward') return onward(book);
  }
  function restart(p) {
    const rs = S.only ? rangesOf(p) : [],
      s = rs.length ? rs[0].a : 0;
    if (p.state === 'ready') selfSeek(p, s);
    else p.time = s;
    p.hop = true;
    start(p);
  }
  // 跨书：阅读列表里下一本有可接续媒体的书（最后一本之后回到第一本），列表换成那本，从它的第一项（随机时任取一项）开始。
  function onward(book) {
    const firstOf = (b) => {
      const l = chain(b);
      return pref.shuffle ? l[Math.floor(Math.random() * l.length)] : l[0];
    };
    const to = nextBook(ctx.readingList(book), book, true, (b) => (!S.only || !!sectionMap(b)) && chain(b).length > 0);
    if (!to) return;
    const i = to === book ? chain(book)[0] : firstOf(to);
    if (i == null) return;
    if (to !== Q.book) {
      Q.book = to;
      Q.removed = new Set();
      Q.history = [];
      emit('list');
    }
    Q.played = new Set();
    go(to, i, true);
  }

  // ---- 列表内切换
  function target(d) {
    const p = S.track;
    if (!p) return null;
    const book = p.book,
      cur = at(p),
      l = Q.book === book ? list() : list(book);
    if (d > 0 && pref.shuffle) {
      const r = following({ shuffle: true, loop: true, list: l, cur, played: Q.book === book ? Q.played : new Set() });
      return r.next === cur ? null : { i: r.next, played: r.played };
    }
    if (d < 0 && pref.shuffle && Q.book === book)
      for (let k = Q.history.length - 1; k >= 0; k--) {
        const i = book.pages.findIndex((pg) => pg.name === Q.history[k]);
        if (i >= 0 && i !== cur && l.includes(i)) return { i, back: k };
      }
    const i = stepIn(l, cur, d);
    return i == null ? null : { i };
  }
  function step(d) {
    const p = S.track,
      r = target(d);
    if (!p || !r) return;
    if (Q.book !== p.book) rebuild(p);
    const play = on(p);
    if (r.played) Q.played = r.played;
    if (r.back != null) {
      Q.history.length = r.back;
      const page = p.book.pages[r.i];
      playAt(p.book, page, { time: head(p.book, page), play, hop: play });
    } else go(p.book, r.i, play);
  }

  // ---- 移除、停止、定位
  function remove(item) {
    if (!item?.page || item.book !== Q.book) return;
    const p = S.track,
      cur = !!p && p.book === Q.book && p.page === item.page,
      i = Q.book.pages.indexOf(item.page);
    Q.removed.add(item.page.name);
    emit('list');
    if (!cur) return;
    const l = list();
    if (!l.length) return stop();
    go(Q.book, l.find((x) => x > i) ?? l[0], on(p));
  }
  function stop() {
    const p = S.track;
    if (p) {
      if (ctx.transport.running && p.by === 'scroll') ctx.transport.stop();
      if (on(p)) S.pause(p);
    }
    Q.book = null;
    Q.removed = new Set();
    Q.played = new Set();
    Q.history = [];
    S.stop();
    emit('list');
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

  const describe = (p) => (p ? { book: p.book, page: p.page, kind: p.kind, playing: on(p), by: p.by ?? 'user' } : null);
  ctx.media.queue = {
    items() {
      const book = Q.book,
        p = S.track;
      return list().map((i) => {
        const page = book.pages[i];
        return { book, page, kind: pageKind(page), current: !!p && p.book === book && p.page === page };
      });
    },
    book: () => Q.book,
    track: () => describe(S.track),
    playing: () => !!S.track && on(S.track),
    play(item, { time } = {}) {
      if (!item?.book || !item.page) return;
      const p0 = S.find(item.book, item.page),
        t = time ?? (p0 ? null : (times.get(item.page) ?? savedPos(item.book, item.page)));
      const p = playAt(item.book, item.page, { time: t, play: true });
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
    canStep: (d) => !!target(d),
    remove,
    stop,
    locate,
    get scope() {
      return pref.scope;
    },
    get shuffle() {
      return pref.shuffle;
    },
    get types() {
      return [...pref.types];
    },
    setScope: (v) => setPref('scope', v),
    setShuffle: (b) => setPref('shuffle', !!b),
    setTypes: (v) => setPref('types', v),
  };
  Object.assign(S, { proceed, rebuild, ensure });
}
