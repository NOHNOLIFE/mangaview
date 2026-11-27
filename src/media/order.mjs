// 播放顺序与循环：状态 S.order / S.loop（设置类偏好，跨窗口同步，按钮在总控栏，变化时派发 ctx.emit('media', 'order')）、
// 一个媒体播完之后切到哪一个（finished，只在影音模式下按播放顺序切换；漫画模式下单个媒体自己的播放键开始的 p.solo 播完即停；
// 混合模式按页序，运行中由 reader/engine.mjs 接着往下滚。开启跨书时本书的媒体播完后进入阅读列表里下一本有媒体的书，循环作用于整个阅读列表），
// 以及待接手的播放请求（S.queued：按播放顺序、书签跳转、新窗口播放要播放的页，该页的播放器出现在视窗里时由 claim 接手）。
// 顺序与循环的规则在 playlist.mjs（following）。
import { extend } from '../core/lang.mjs';
import { pageKind } from '../core/model.mjs';
import { orderOf, ORDERS, following } from '../core/playlist.mjs';
import { nextBook } from '../core/engine.mjs';

extend({
  mvOrderList: ['Play order: list', '播放顺序：列表', '再生順：リスト', '재생 순서: 목록'],
  mvOrderShuffle: ['Play order: shuffle', '播放顺序：随机', '再生順：シャッフル', '재생 순서: 무작위'],
  mvOrderSingle: ['Play order: single', '播放顺序：单集', '再生順：1 つだけ', '재생 순서: 하나만'],
  mvLoop: ['Loop', '循环', 'ループ', '반복'],
});
export const ORDER_ICON = { list: 'order-list', shuffle: 'order-shuffle', single: 'order-single' },
  ORDER_LABEL = { list: 'mvOrderList', shuffle: 'mvOrderShuffle', single: 'mvOrderSingle' };

export function install(ctx, S) {
  const { t, get, put } = ctx,
    { players, times, rounds, failedPages } = S;
  const refreshControls = (...a) => S.refreshControls(...a),
    sectionMap = (...a) => S.sectionMap(...a),
    rangesOf = (...a) => S.rangesOf(...a),
    selfSeek = (...a) => S.selfSeek(...a),
    start = (...a) => S.start(...a),
    seek = (...a) => S.seek(...a),
    inView = (...a) => S.inView(...a);
  S.order = orderOf(get('playOrder', 'list'));
  S.loop = get('playLoop', false) === true;
  ctx.prefs
    .sync('playOrder', (v) => {
      S.order = orderOf(v);
      rounds.delete(ctx.current);
      changed();
    })
    .sync('playLoop', (v) => {
      S.loop = v === true;
      changed();
    });
  function changed() {
    refreshControls();
    ctx.emit('media', 'order');
  }
  // ---- 播放顺序与循环：一个媒体播完之后做什么。「列表」是当前书里可播放的媒体（图片、播不了的跳过），按当前页序；
  // 开启「只播放书签区段」且书里有区段时，没有区段的媒体也跳过（整个处在某个图片区段之内的除外）。切到下一个媒体时把它滚到视窗中央、从头（或第一个区段）播放。
  function candidates(book, withSec) {
    const out = [];
    book.pages.forEach((pg, i) => {
      const k = pageKind(pg);
      if (
        (k === 'video' || k === 'audio') &&
        !pg.bad &&
        !failedPages.has(pg) &&
        (!withSec || withSec.get(pg.name)?.length || withSec.covered?.has(i))
      )
        out.push(i);
    });
    return out;
  }
  let lastFinish = null;
  function finished(p) {
    const now = performance.now();
    if (lastFinish?.p === p && now - lastFinish.at < 800) return;
    lastFinish = { p, at: now }; // 区段播完与 ended 可能先后到达
    if (p.solo || ctx.transport?.mode !== 'media') {
      p.solo = false;
      return;
    }
    const book = p.book,
      cur = book.pages.indexOf(p.page);
    if (book !== ctx.current || !players.has(p.node) || cur < 0) return;
    const withSec = sectionMap(book);
    if (S.order === 'single') {
      if (S.loop) restart(p);
      return;
    }
    const list = candidates(book, withSec),
      names = rounds.get(book) ?? new Set(),
      cross = !!ctx.transport?.crossBook && S.order !== 'single';
    const r = following({
      order: S.order,
      loop: S.loop && !cross,
      list,
      cur,
      played: new Set(book.pages.flatMap((pg, i) => (names.has(pg.name) ? [i] : []))),
    });
    rounds.set(book, new Set([...r.played].map((i) => book.pages[i]?.name)));
    if (r.next == null) {
      if (cross) onward(book);
      return;
    }
    if (r.next === cur) restart(p);
    else switchTo(book, r.next, withSec);
  }
  // 跨书：进入阅读列表（与上一本 / 下一本相同的范围）里下一本有可播放媒体的书，从它的第一个媒体开始；循环开着则最后一本之后回到第一本。
  function onward(book) {
    const first = (b) => candidates(b, sectionMap(b))[0];
    const to = nextBook(ctx.readingList(book), book, S.loop, (b) => (!S.only || !!sectionMap(b)) && first(b) != null);
    if (!to) return;
    rounds.delete(to);
    if (to === book) return switchTo(book, first(book), sectionMap(book));
    S.onward = to; // 不算用户切书（driver.mjs）
    ctx.select(to);
    // 在 'select' 事件（清掉待接手的播放请求）之后
    queueMicrotask(() => {
      if (ctx.current === to) switchTo(to, first(to), sectionMap(to));
    });
  }
  function restart(p) {
    const rs = S.only ? rangesOf(p) : [];
    if (p.state === 'ready') selfSeek(p, rs.length ? rs[0].a : 0);
    else p.time = rs.length ? rs[0].a : 0;
    start(p);
  }
  // 切到第 i 页的媒体：滚到视窗中央，从头（或第一个区段）开始；play 为假时只定位、停在该处（总控栏的上一个 / 下一个媒体，未在播放时）。
  function switchTo(book, i, withSec, play = true) {
    const page = book.pages[i],
      rs = withSec?.get(page.name) ?? [],
      s = rs.length ? rs[0].a : 0;
    times.set(page, s);
    S.queued = { page, time: s, play, auto: play };
    if (S.full) S.leaveFull();
    ctx.view.jump({ i, f: 0.5 });
    if (document.hidden) ctx.view.paint(); // 窗口在后台时不会有动画帧：立即排版，播放顺序照常生效
    claimNow();
    requestAnimationFrame(claimNow);
  }
  // 要播放的页的播放器在视窗里时接手：定位到指定时间，play 为真则播放，否则只挂上源停在该画面。
  function claim(p) {
    if (!S.queued || S.queued.page !== p.page || p.book !== ctx.current) return;
    const q = S.queued;
    S.queued = null;
    if (p.state === 'failed') return;
    S.select(p, q.auto ? 'switch' : 'goto'); // 成为选中媒体（autoplay.mjs）
    p.auto = !!q.auto;
    p.popped = !!q.popped;
    seek(p, q.time);
    if (q.play) start(p);
  }
  function claimNow() {
    if (!S.queued) return;
    for (const p of players.values()) if (p.page === S.queued?.page && inView(p)) claim(p);
  }
  // 总控栏「播放顺序」「循环」按钮的操作（经 ctx.media，driver.mjs）。
  function cycleOrder() {
    S.order = ORDERS[(ORDERS.indexOf(S.order) + 1) % ORDERS.length];
    put('playOrder', S.order);
    rounds.delete(ctx.current);
    changed();
    ctx.notice(null, t(ORDER_LABEL[S.order]));
  }
  function toggleLoop() {
    S.loop = !S.loop;
    put('playLoop', S.loop);
    changed();
  }
  Object.assign(S, { candidates, switchTo, finished, claim, claimNow, cycleOrder, toggleLoop });
}
