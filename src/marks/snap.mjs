import { pageKind, clock, shownName } from '../core/model.mjs';
import { forget, grabFrames, frameOf, fileStamp } from '../reader/thumbs.mjs';
import { isMedia, key, endKey } from './list.mjs';
// 书签缩略图：添加书签时截取（图片截视口区域、视频截当前画面），列表里绘制缩略图与媒体占位，视频书签画面的懒生成队列。
// 视频书签的缩略图是书签时间点的画面：在播放器里添加时直接截当前画面，否则在列表里可见时排队截取（懒生成、串行、持久化）；音频没有画面，显示占位。
const THUMB_W = 240,
  READ = 20000; // READ：截取书签画面时取文件的时限（毫秒）
export function install(ctx, S) {
  const { make, icon } = ctx;
  // 缩略图：截取屏幕中心所在那张图、以中心为准、与视口等比例的区域，换算到原图像素。
  // end：截的是区段书签（终点）的缩略图，保存到它自己的键；期间终点又被更新或删除就丢弃。
  async function snap(book, bm, page, p, vw, vh, end = null) {
    let crop = null;
    if (page.w && page.h) {
      const s = page.h / p.h,
        k = Math.min(1, page.w / (vw * s), page.h / (vh * s)),
        w = vw * s * k,
        h = vh * s * k;
      crop = {
        x: Math.round((page.w - w) / 2),
        y: Math.round(Math.min(page.h - h, Math.max(0, p.f * page.h - h / 2))),
        w: Math.round(w),
        h: Math.round(h),
      };
    }
    const thumb = await ctx.makeThumb(await ctx.source(book, page), { width: 240, crop });
    if (!book.bookmarks.includes(bm) || (end && bm.end !== end)) return;
    await ctx.saveThumb(end ? endKey(book, bm) : key(book, bm), thumb);
    if (book === ctx.current && !S.panel.hidden) S.render();
    S.renderDock();
  }
  // 媒体书签的缩略图：视频在播放器里正停在书签时间时直接截当前画面；截不到就删掉旧图（更新区段书签时），等它在列表里可见时再截。音频没有画面。
  async function shoot(book, bm, player, end = null) {
    const k = end ? endKey(book, bm) : key(book, bm),
      m = end ?? bm,
      v = player.el;
    if (player.kind !== 'video') return;
    const th =
      player.state === 'ready' && !v.seeking && Math.abs(v.currentTime - m.t) < 0.3
        ? await frameOf(v, { width: THUMB_W }).catch(() => null)
        : null;
    if (!book.bookmarks.includes(bm) || (end && bm.end !== end)) return;
    if (th) await ctx.saveThumb(k, th);
    else {
      forget(k);
      await ctx.thumbs('delete', k);
    }
    if (book === ctx.current && !S.panel.hidden) S.render();
    S.renderDock();
  }
  // ---- 书签缩略图（书签面板、书架书签、全屏书架书签、设置封面共用）：holder 为缩略图容器，img 为其中的 <img>，end 为区段书签那一张。
  // 图片书签：保存的缩略图，没有时显示空白占位。视频书签：书签时间点的画面，还没有时先显示占位，进入可见范围后排队截取；
  // 音频书签：始终是占位小块。媒体的占位是类型图标 + 名称（没有名称时为文件名），时间点在类型角标里（mediaBadge）；区段书签的小图里是图标 + 时间。
  function paint(holder, img, book, x, end = false) {
    const m = end ? x.bm.end : x.bm,
      k = end ? endKey(book, x.bm) : key(book, x.bm),
      i = end ? x.e : x.i,
      page = i >= 0 ? book.pages[i] : null;
    if (!isMedia(m)) {
      const none = () => {
        img.remove();
        holder.classList.add('empty');
      };
      ctx.getThumb(k).then((th) => {
        if (th) img.src = th.url;
        else none();
      }, none);
      return;
    }
    const kind = page ? pageKind(page) : 'video',
      ph = make('span', 'bm-ph ' + kind),
      name = typeof x.bm.label === 'string' && x.bm.label ? x.bm.label : page ? shownName(page) : '';
    ph.append(
      icon(kind === 'audio' ? 'music' : 'film'),
      end ? make('b', '', clock(m.t)) : make('span', 'bm-ph-name', name),
    );
    holder.classList.add('bm-media');
    img.hidden = true;
    img.after(ph);
    if (kind !== 'video' || !page) return;
    const show = (th) => {
      if (!th || !holder.isConnected) return;
      img.src = th.url;
      img.hidden = false;
      ph.remove();
    };
    ctx.getThumb(k).then(
      (th) => {
        if (th) show(th);
        else {
          holder._shot = { book, bm: x.bm, end: end ? m : null, k, name: m.name, t: m.t, show };
          seen.observe(holder);
        }
      },
      () => {},
    );
  }
  // 类型角标：视频 / 音频的图标 + 时间点，叠在缩略图右下角，不改变排布。
  function mediaBadge(book, x) {
    const el = make('span', 'mv-badge bm-type'),
      page = x.i >= 0 ? book.pages[x.i] : null;
    el.setAttribute('aria-hidden', 'true');
    el.append(icon(page && pageKind(page) === 'audio' ? 'music' : 'film'), make('span', '', clock(x.bm.t)));
    return el;
  }
  // 懒生成：缩略图进入可见范围才排队；串行、空闲时进行，同一个视频的多个书签一次打开截完；截好即保存（别的窗口经 'thumbs' 同步）。
  // 文件打不开（播不了、没有画面）：连同文件的大小和修改时间记入页记录（page.vfail，与视频缩略图共用，见 thumbs.mjs），文件没变就不再尝试；
  // 暂时读不到（找不到、超时）和个别时间点截不到的只在本次会话内不再重试。
  const seen = new IntersectionObserver((es) => {
    for (const e of es)
      if (e.isIntersecting) {
        seen.unobserve(e.target);
        const j = e.target._shot;
        e.target._shot = null;
        if (j) enqueue(j);
      }
  });
  const shots = new Map(),
    failedShots = new Set();
  let shooting = false;
  function enqueue(j) {
    const id = j.k + '@' + j.t;
    if (failedShots.has(id)) return;
    const had = shots.get(j.k);
    if (had && had.t === j.t) {
      had.shows.push(j.show);
      return;
    }
    shots.set(j.k, { ...j, shows: [j.show] });
    pump();
  }
  const idle = () =>
    new Promise((r) =>
      window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 60),
    );
  const timed = (promise, ms) => {
    let tm;
    return Promise.race([
      promise,
      new Promise((_, no) => {
        tm = setTimeout(() => no(new DOMException('', 'TimeoutError')), ms);
      }),
    ]).finally(() => clearTimeout(tm));
  };
  async function pump() {
    if (shooting) return;
    shooting = true;
    try {
      while (shots.size) {
        await idle();
        const first = shots.values().next().value,
          batch = [...shots.values()].filter((j) => j.book === first.book && j.name === first.name);
        for (const j of batch) shots.delete(j.k);
        const book = first.book,
          page = book.pages.find((p) => p.name === first.name),
          todo = [];
        for (const j of batch) {
          if (!book.bookmarks.includes(j.bm) || (j.end && j.bm.end !== j.end)) continue;
          const th = await ctx.getThumb(j.k).catch(() => null);
          if (th) {
            for (const f of j.shows) f(th);
            continue;
          } // 别的窗口已经截好
          todo.push(j);
        }
        if (!todo.length) continue;
        let out = null;
        try {
          if (!page || ctx.expired?.(book)) throw 0;
          const file = await timed(
              Promise.resolve().then(() => ctx.source(book, page)),
              READ,
            ),
            stamp = fileStamp(file);
          if (page.vfail !== stamp && page.bad !== stamp)
            try {
              out = await grabFrames(
                file,
                todo.map((j) => j.t),
                { width: THUMB_W },
              );
            } catch (e) {
              if (e?.name !== 'TimeoutError' && ctx.books.has(book.id)) {
                page.vfail = stamp;
                ctx.safe(ctx.persist)(book);
              }
            }
        } catch {}
        for (const [n, j] of todo.entries()) {
          const th = out?.[n];
          if (!th) {
            failedShots.add(j.k + '@' + j.t);
            continue;
          }
          if (!book.bookmarks.includes(j.bm) || (j.end && j.bm.end !== j.end)) continue;
          await ctx.saveThumb(j.k, th);
          const got = await ctx.getThumb(j.k).catch(() => null);
          for (const f of j.shows) f(got);
        }
      }
    } catch (e) {
      console.warn(e);
    } finally {
      shooting = false;
    }
  }
  S.snap = snap;
  S.shoot = shoot;
  S.paint = paint;
  S.mediaBadge = mediaBadge;
}
