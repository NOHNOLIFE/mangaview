// 自动滚动（总控栏的大按钮）的漫画、混合模式驱动器（影音模式的在 media/driver.mjs）。纯规则在 core/engine.mjs。
// - 漫画：只滚图片，匀速向下滚动（ctx.transport.scrollRate，1.0× = 每秒视窗高度的 10%）；视频、音频页不进入画面：
//   连续的图片是一段（core/engine.mjs imageRuns），段尾到达视窗底时直接跳到下一段的开头，比视窗还短的段在原处停留相应的时间；不碰任何媒体。
// - 混合：同样滚动；媒体的中线到达视窗中央时停住，经 ctx.media.run 播放（只播区段、播放位置记忆照常），播完接着往下滚；
//   页序上紧挨的下一页也是要播的媒体时，播完直接定位到它（居中）接着播，不滚动过去（core/engine.mjs 的 chained）；
//   始终按页序。开始运行时先播刚按了自己播放键的、正在播放的或选定的当前媒体。
//   运行中暂停 = 暂停滚动或暂停正在播放的媒体，继续时从原处接着；正在播放的媒体被滚出视窗（autoplay.mjs 随即暂停它）就从新位置继续滚动。
// - 只播区段：滚动只经过图片区段，到区段终点直接跳到下一个区段的起点；混合模式下只停在自带区段的媒体、整个处在图片区段之内的媒体；
//   漫画模式下与图片段取交集（core/engine.mjs intersect），只经过区段内的图片。
// - 循环（ctx.transport.loop，没有"不循环"）：本书循环到书末回到书首；跨书循环进入阅读列表（ctx.readingList，与上一本 / 下一本一致）的下一本，
//   从书首继续，最后一本之后回到第一本；单文件循环在混合模式下反复播放停下来播的那个媒体（只播区段时反复播它的区段），图片按本书循环。
// - 用户手动滚动、翻屏、拖动不停止运行：停 QUIET 毫秒不推进（不与滚轮的平滑滚动、拖动、惯性叠加），再从新位置接着走；
//   正文重排（图片加载后的锚定、缩放、窗口调整）只换坐标，不停顿。窗口在后台时没有动画帧，滚动随之暂停，回到前台从原处继续（媒体照常播放）。
//   用户切到别的书照常运行；切到没有内容的书（只播区段时没有区段的书、漫画模式下没有图片的书）即停止。
// - 单文件模式（ctx.single）：不连续滚动，按页推进（规则在 core/engine.mjs 的 pagePlan / pageAfter）：漫画模式每页停留
//   pageInterval（1.0× = 5 秒，间隔 = 5 秒 ÷ 滚动速率）后换到下一页，跳过视频、音频页；混合模式图片按间隔，媒体页停下播放、播完再换页；
//   只播区段时只经过图片区段内的页（及应播的媒体）。手动翻页不打断运行，从新的一页重新计时；暂停后继续从当前页重新计时；
//   停留时间按动画帧累计，窗口在后台时随之暂停。书末的循环与长条相同。运行中进入或退出单文件模式不停止，下一帧按新的方式接着走。
import {
  EPS,
  scrollSpeed,
  travel,
  next,
  stopsOf,
  MAX_DT,
  pageInterval,
  pagePlan,
  pageAfter,
  imageSpans,
  covered,
  hasSections,
  nextBook,
  chained,
  imageRuns,
  intersect,
} from '../core/engine.mjs';
import { point, pageKind } from '../core/model.mjs';
import { hasImages } from './transport.mjs';
import { stop as stopFling } from '../ui/dragscroll.mjs';
import { Glide } from './autoscroll.mjs';

const QUIET = 250,
  WAIT = 30000; // 等媒体开始播放的上限（挂源、读元数据另有超时，这里只防万一）

export function install(ctx) {
  const { main } = ctx;
  const M = () => ctx.media?.run;
  const glide = new Glide(main);
  let mode = null, // 正在运行的驱动器名，未运行为 null
    frame = 0,
    prev = null,
    quiet = 0,
    jumped = false, // 上一帧之后被别人挪过位置
    playing = null, // 混合模式下停下来播放的 {i, page, since}
    own = null, // 自己（跨书）切到的书：它的 'select' 不算用户切书
    idle = 0, // 连续几次到了尽头却没有任何进展（回到开头、换书之后马上又到尽头），防止空转
    flat = null, // 上一帧是否在单文件模式（null：刚开始，下一帧重新判断）
    cur = null, // 单文件模式下正在停留计时的页序号（null：下一帧把所在的页当作自己换到的页）
    elapsed = 0, // 在这一页已停留的时间（毫秒）
    held = 0; // 漫画模式在比视窗还短的图片段上已停留的距离（像素，next 的 held）
  const skip = new Set(); // 已播过或播不了、不再停靠的媒体页序号；离开视窗中线后清掉

  // 当前书的书签列表与各媒体的区段（只播区段用），书签变化、切书时重取。
  let cache = null;
  const marks = (book) => {
    if (cache?.book !== book)
      cache = { book, items: ctx.marks?.list(book) ?? [], ranges: ctx.marks?.mediaRanges(book) ?? new Map() };
    return cache;
  };
  const items = (book) => marks(book).items;
  ctx.on('marks', () => (cache = null));
  ctx.on('synced', () => (cache = null));
  const sectioned = (book) => hasSections(ctx.marks?.list(book) ?? []);

  // 只播区段时的图片区段（页内位置，null 为不限）与混合模式下应停下播放的媒体页序号。
  function plays(book) {
    const only = ctx.transport.sectionsOnly && hasSections(items(book)),
      raw = only ? imageSpans(items(book)) : null,
      ranges = only ? marks(book).ranges : null,
      stops = [];
    if (mode === 'mixed')
      book.pages.forEach((pg, i) => {
        if (!M()?.playable(pg) || (only && !ranges.get(pg.name)?.length && !covered(raw, i))) return;
        stops.push(i);
      });
    const away = mode === 'comic' ? new Set(book.pages.flatMap((pg, i) => (isImage(pg) ? [] : [i]))) : null;
    return { raw, stops, away };
  }
  const isImage = (pg) => pageKind(pg) === 'image';
  // 这一帧的几何（中线坐标）：中线范围 lo..hi、媒体停靠点、只播区段时的图片区段。版面还没排好时为 null。
  function geometry(book) {
    const starts = ctx.view.panes[0].starts,
      H = main.clientHeight;
    if (!H || starts.length !== book.pages.length + 1) return null;
    const lo = H / 2,
      hi = Math.max(lo, main.scrollHeight - H / 2),
      { raw, stops, away } = plays(book),
      pages = stops.map((i) => ({ i, top: starts[i], bottom: starts[i + 1] }));
    let spans = raw && raw.map((s) => ({ a: point(starts, s.a), b: point(starts, s.b) }));
    if (away) {
      // 漫画模式只经过图片段（与只播区段同时开启时取交集）
      const runs = imageRuns({ starts, image: (i) => !away.has(i), H, lo, hi });
      spans = spans ? intersect(runs, spans) : runs;
    }
    return { H, lo, hi, spans, stops: stopsOf(pages, lo, hi) };
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    const dt = prev == null ? 0 : now - prev;
    prev = now;
    const book = ctx.current;
    if (!book) return finish();
    const single = !!ctx.single?.active;
    if (single !== flat) {
      // 进入 / 退出单文件模式（或刚开始）：从所在的位置按新的方式接着走
      flat = single;
      cur = null;
      elapsed = 0;
      glide.reset();
      jumped = true;
      quiet = 0;
    }
    if (single) return paged(dt, book);
    const { y, moved } = glide.here();
    if (moved) {
      jumped = true;
      held = 0;
      // 正文重排把位置校正到 correctedTop（view.mjs layout）；其余都是用户或别的模块挪的。
      if (main.scrollTop !== ctx.view.correctedTop) quiet = now + QUIET;
    }
    if (playing) return watch(now, book);
    if (now < quiet) return;
    const g = geometry(book);
    if (!g) return;
    const c = y + g.H / 2;
    for (const s of g.stops) if (skip.has(s.i) && (s.at < c - EPS || (jumped && s.at > c + EPS))) skip.delete(s.i); // 回到前面的媒体可以再播
    jumped = false;
    const r = next({
      c,
      d: travel(scrollSpeed(ctx.transport.scrollRate, g.H), dt),
      lo: g.lo,
      hi: g.hi,
      stops: g.stops,
      skip,
      spans: g.spans,
      held,
    });
    if (r.type === 'hold') {
      held += travel(scrollSpeed(ctx.transport.scrollRate, g.H), dt);
      return;
    }
    held = 0;
    if (r.type === 'end') return ended(book);
    if (r.to > c + 0.01 || r.type !== 'scroll') idle = 0;
    if (r.type !== 'scroll' && Math.abs(r.to - c) > 0.5) stopFling();
    glide.set(r.to - g.H / 2);
    if (r.type === 'play') {
      playing = { i: r.i, page: book.pages[r.i], since: now };
      M().play(playing.page);
    }
  }
  // 停下来播放时：播完或播不了就记下、接着滚；被滚出视窗从新位置接着滚；在视窗里被别处暂停（系统媒体键等）即停止运行。
  // 单文件循环：播完重新播放它。播完的下一页紧挨着也是要播的媒体：直接定位到它居中并播放。
  function watch(now, book) {
    const s = M()?.state(playing.page) ?? 'away';
    if (s === 'playing' || (s === 'wait' && now - playing.since < WAIT)) return;
    if (s === 'paused') return finish();
    if (s === 'done' && ctx.transport.loop === 'file') return replay(now);
    const done = playing.i;
    playing = null;
    if (s === 'away') return;
    skip.add(done);
    const g = geometry(book),
      r = g && chained(g.stops, done, skip);
    if (!r) return;
    stopFling();
    glide.set(r.to - g.H / 2);
    idle = 0;
    playing = { i: r.i, page: book.pages[r.i], since: now };
    M().play(playing.page);
  }
  // 单文件循环：从头（只播区段时从第一个区段）重新播放停下来播的那个媒体。
  function replay(now) {
    playing.since = now;
    M().play(playing.page);
  }
  // ---- 单文件模式：按页推进。
  function paged(dt, book) {
    const i = ctx.single.index();
    if (i < 0) return; // 版面还没排好
    if (playing && i === playing.i) return watchPage(book);
    playing = null; // 翻到了别的页：正在播放的媒体随之离开视窗（autoplay.mjs 暂停它），从新的一页重新计时
    if (cur !== i) return arrive(book, i, cur == null);
    elapsed += Math.min(MAX_DT, Math.max(0, dt));
    if (elapsed >= pageInterval(ctx.transport.scrollRate)) advance(book);
  }
  // 停在第 i 页：应播的媒体开始播放，其余从零计时。auto：不是用户翻过来的（开始运行、回到书首、换书、切换显示方式），
  // 此时区段之外的页直接换到下一个要经过的页，刚在长条里播过的媒体不再重播。
  function arrive(book, i, auto) {
    cur = i;
    elapsed = 0;
    const kind = pagePlan({ n: book.pages.length, ...planOf(book) })[i];
    if (kind === 'play' && !(auto && skip.has(i))) return playPage(book, i);
    if (!kind && auto) advance(book);
  }
  function advance(book) {
    const r = pageAfter(pagePlan({ n: book.pages.length, ...planOf(book) }), cur);
    if (r.type === 'end') return ended(book);
    idle = 0;
    ctx.single.go(r.i);
    cur = r.i;
    elapsed = 0;
    if (r.type === 'play') playPage(book, r.i);
  }
  const planOf = (book) => {
    const { raw, stops, away } = plays(book);
    return { spans: raw, stops: new Set(stops), away: away ?? new Set() };
  };
  function playPage(book, i) {
    playing = { i, page: book.pages[i], since: performance.now() };
    M().play(playing.page);
  }
  // 停下播放时：播完或播不了就换到下一页；在这一页被别处暂停即停止运行（与长条相同）。
  function watchPage(book) {
    const s = M()?.state(playing.page) ?? 'away';
    if (s === 'playing' || (s === 'wait' && performance.now() - playing.since < WAIT)) return;
    if (s === 'paused') return finish();
    if (s === 'done' && ctx.transport.loop === 'file') return replay(performance.now());
    skip.add(playing.i);
    cur = playing.i;
    playing = null;
    advance(book);
  }
  // 到了尽头（书末，或只播区段时最后一个区段之后、漫画模式最后一段图片之后）：本书、单文件循环回到书首，跨书循环进入下一本。
  // 回到开头、换书之后马上又到尽头（没有可走的内容）几次即停止，不空转。
  function ended(book) {
    const tr = ctx.transport,
      cross = tr.loop === 'books';
    if (++idle > 2 + (cross ? ctx.readingList(book).length : 0)) return finish();
    if (!cross) return restart();
    const to = nextBook(
      ctx.readingList(book),
      book,
      true,
      (b) => b.pages.length > 0 && (!tr.sectionsOnly || sectioned(b)) && (mode !== 'comic' || hasImages(b)),
    );
    if (!to) return finish();
    if (to === book) return restart();
    own = to;
    skip.clear();
    ctx.select(to);
    restart();
  }
  // 从书首重新开始（循环、换书）。
  // 漫画模式直接回到第一段图片的开头（书首是视频、音频时不让它进入画面）。
  function restart() {
    skip.clear();
    stopFling();
    const g = mode === 'comic' && !ctx.single?.active ? geometry(ctx.current) : null;
    glide.set(g?.spans?.length ? g.spans[0].a - g.H / 2 : 0);
    jumped = false;
    held = 0;
    cur = null;
  }

  function begin(name) {
    const book = ctx.current;
    if (!book?.pages.length) return false;
    cancelAnimationFrame(frame);
    stopFling();
    mode = name;
    prev = null;
    quiet = 0;
    idle = 0;
    jumped = true; // 停着的时候可能被挪过：前面播过的媒体可以再播
    playing = null;
    flat = null; // 单文件模式下从当前页重新计时
    cur = null;
    held = 0;
    glide.reset();
    if (name === 'mixed') {
      const page = M()?.first();
      if (page) {
        playing = { i: book.pages.indexOf(page), page, since: performance.now() };
        M().play(page);
      }
    }
    frame = requestAnimationFrame(tick);
    return true;
  }
  function halt() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (playing) M()?.pause();
    mode = null;
    playing = null;
  }
  // 自己停下（没有可走的内容、媒体被别处暂停等）：报告给总控，总控栏的「自动滚动」随之回到未运行。
  function finish() {
    const m = mode;
    halt();
    if (m) ctx.transport.report(m, false);
  }
  for (const name of ['comic', 'mixed']) ctx.transport.drive(name, { start: () => begin(name), stop: halt });

  // 切书：自己切的接着走；用户切的在新书里照常运行（从它的阅读位置开始），没有内容就停止。
  ctx.on('select', (book) => {
    cache = null;
    if (!mode) return;
    if (book === own) {
      own = null;
      return;
    }
    own = null;
    playing = null;
    cur = null;
    skip.clear();
    glide.reset();
    if (
      !book?.pages.length ||
      (ctx.transport.sectionsOnly && !sectioned(book)) ||
      (mode === 'comic' && !hasImages(book))
    )
      finish();
  });
  // 回到前台：帧间隔从零算起。
  document.addEventListener('visibilitychange', () => {
    prev = null;
  });
}
