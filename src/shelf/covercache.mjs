// 封面缓存（后台）：为每本书生成默认封面的压缩小图和识别用的指纹（封面摘要、合并作品各卷的摘要、媒体文件大小）；
// 串行读盘，多个窗口时只由持有后台磁盘任务的窗口进行。卡片上的显示见 card.mjs。
import { fileOf, nameOrder, pageKind } from '../core/model.mjs';
import { keyOf, dirOf } from '../core/sources.mjs';
import { digest } from './util.mjs';

export function install(ctx, S) {
  const { books } = ctx;
  // ---- 封面缓存：只存压缩 WebP，过期书也能显示；串行读取，不与阅读抢硬盘。
  let chain = Promise.resolve();
  const queue = (fn) => (chain = chain.then(fn).catch(() => {}));
  // 恢复与识别用（第 5 节）：含媒体的书记下各媒体文件的精确大小（page.size，只读文件元数据，不读内容）。
  // 后台空闲时逐个读取，不阻塞导入；读不到的本次会话不再重试。
  const isMedia = (p) => pageKind(p) !== 'image',
    tried = new WeakSet();
  const unsized = (b) =>
    !ctx.expired(b) && b.pages.some((p) => isMedia(p) && !Number.isFinite(p.size) && !tried.has(p));
  const idle = () =>
    new Promise((r) =>
      window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 50),
    );
  let sizing = false,
    resize = false;
  async function sweepSizes() {
    if (sizing) {
      resize = true;
      return;
    }
    sizing = true;
    resize = false;
    try {
      for (const b of [...books.values()]) {
        if (!books.has(b.id) || !unsized(b)) continue;
        await ctx.disk.turn();
        if (!books.has(b.id) || !unsized(b)) continue;
        await queue(async () => {
          let n = 0;
          for (const p of b.pages) {
            if (!isMedia(p) || Number.isFinite(p.size) || tried.has(p)) continue;
            await idle();
            if (!books.has(b.id)) return;
            tried.add(p);
            try {
              p.size = (await ctx.source(b, p)).size;
              n++;
            } catch (e) {
              if (e?.name === 'TimeoutError' || e?.name === 'NotAllowedError') break;
            }
          }
          if (n && books.has(b.id)) await ctx.persist(b);
        });
      }
    } finally {
      sizing = false;
      if (resize) setTimeout(sweepSizes, 800);
    }
  }
  setTimeout(sweepSizes, 4000);
  ctx.on('books', () => setTimeout(sweepSizes, 1200));
  // 封面页取「文件名」正序（按路径，与当前排序无关）的第一张：单文件夹书即文件名自然顺序的第一张（与 match.mjs coverName 一致），
  // 合并作品即第一个可见卷的第一张。结果按页表缓存，后台检查数千本书时不必每次重新比较全部文件名。
  const firstPage = (b, pages) => {
    const order = nameOrder(dirOf(b));
    return pages.reduce((a, p) => (!a || order(p, a) < 0 ? p : a), null);
  };
  const coverNames = new WeakMap();
  const coverPage = (b) => {
    const pages = b.pages || [];
    let c = coverNames.get(b);
    if (!c || c.pages !== pages || c.n !== pages.length || c.src !== b.sources) {
      c = { pages, n: pages.length, src: b.sources, name: firstPage(b, pages)?.name };
      coverNames.set(b, c);
    }
    return pages.find((p) => p.name === c.name);
  };
  // 合并作品的每一卷另记一份封面摘要（只读各卷首张图的前 64KB，每卷一次），恢复时按卷匹配。
  const bySource = (b) => {
    const m = new Map();
    for (const p of b.pages) {
      const k = keyOf(p);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  };
  const staleFp = (b) => {
    if (!(b.sources?.length > 1)) return [];
    const m = bySource(b);
    return b.sources
      .map((s) => [s, m.get(s.key) && firstPage(b, m.get(s.key))])
      .filter(([s, p]) => p && s.fp?.name !== fileOf(p) && !ctx.isDown(b, s));
  };
  const needsFp = (b) => staleFp(b).length > 0;
  // 识别用的指纹（book.fp.cover，第 5 节）：首个文件（不论类型）的文件名、精确大小、头部 64KB 摘要。
  // 默认封面的画面与它分开（fp.pic 记画面取自哪一页）：按「文件名」顺序第一个有画面的页，图片用图片本身，
  // 视频用它的缩略图（ctx.frames：优先最早的书签画面，否则片长约 10% 处；fp.src 记来源，变了就重做）；播不了的视频（page.vfail / page.bad）跳过。
  // 全书只有音频（没有任何画面）时 fp.text：卡片用作品名生成文字封面，不存图。视频截帧代价高，只为可见的卡片进行，后台检查只补指纹和图片封面。
  const sorted = new WeakMap();
  const byFileName = (b) => {
    const pages = b.pages || [];
    let c = sorted.get(b);
    if (!c || c.pages !== pages || c.n !== pages.length || c.src !== b.sources) {
      c = { pages, n: pages.length, src: b.sources, list: [...pages].sort(nameOrder(dirOf(b))) };
      sorted.set(b, c);
    }
    return c.list;
  };
  const picPage = (b) =>
    byFileName(b).find((p) => {
      const k = pageKind(p);
      return k === 'image' || (k === 'video' && !p.vfail && !p.bad);
    }) ?? null;
  const picOf = (fp) => fp?.pic ?? (fp?.thumb ? fp.cover?.name : undefined); // 旧记录没有 pic：画面就取自指纹页
  const fpFresh = (b) => {
    const p = coverPage(b);
    return !p || (b.fp?.cover?.name === p.name && !!b.fp.cover.hash);
  };
  const picFresh = (b) => {
    const q = picPage(b);
    if (!q) return !coverPage(b) || !!b.fp?.text;
    return !!b.fp?.thumb && picOf(b.fp) === q.name && (pageKind(q) !== 'video' || b.fp.src === ctx.frames?.src(b, q));
  };
  const needs = (b, visible) =>
    !fpFresh(b) || needsFp(b) || (!picFresh(b) && (visible || pageKind(picPage(b) ?? { name: '' }) !== 'video'));
  async function ensureCover(b, visible = false) {
    if (!books.has(b.id) || ctx.expired(b) || !needs(b, visible)) return;
    await ctx.disk.turn(); // 多个窗口时只由一个窗口生成，其他窗口等书目同步过来后直接显示
    if (!books.has(b.id) || ctx.expired(b) || !needs(b, visible)) return;
    const page = coverPage(b);
    let file = null;
    if (page && !fpFresh(b)) {
      file = await ctx.source(b, page);
      const hash = await digest(file);
      if (!books.has(b.id)) return;
      const { media, ...old } = b.fp ?? {};
      if (old.thumb && old.pic == null && old.cover) old.pic = old.cover.name;
      b.fp = { ...old, cover: { name: page.name, size: file.size, hash } };
    }
    for (let tries = 0; tries < 3 && !picFresh(b); tries++) {
      const q = picPage(b),
        kind = q && pageKind(q);
      if (!q) {
        await ctx.thumbs('delete', b.id + ':cover');
        b.fp = { cover: b.fp?.cover, text: true };
        delete b.coverRatio;
        break;
      }
      if (kind === 'video' && !visible) break;
      const th =
        kind === 'image'
          ? await ctx.makeThumb(q === page && file ? file : await ctx.source(b, q), { width: 320 })
          : await ctx.frames?.get(b, q);
      if (!books.has(b.id)) return; // 生成期间这本书已被删除
      if (!th) continue; // 播不了的视频已记下（page.vfail），换下一个有画面的页
      await ctx.saveThumb(b.id + ':cover', th);
      b.fp = { cover: b.fp?.cover, thumb: true, pic: q.name, ...(kind === 'video' && { src: th.src }) };
      b.coverRatio = th.h / th.w;
    }
    for (const [s, p] of staleFp(b)) {
      if (b.fp?.cover?.name === p.name) {
        s.fp = { ...b.fp.cover, name: fileOf(p) };
        continue;
      }
      try {
        const file = await ctx.source(b, p);
        s.fp = { name: fileOf(p), size: file.size, hash: await digest(file) };
      } catch {} // 读不到的卷下次再试
    }
    if (books.has(b.id)) await ctx.persist(b);
  }
  // 运行中又有新书加入时，跑完这一轮再从头检查一遍（否则这一轮开始后才加入的书要等下一次变化才生成封面）。
  let sweeping = false,
    again = false;
  async function sweep() {
    if (sweeping) {
      again = true;
      return;
    }
    sweeping = true;
    try {
      do {
        again = false;
        for (const b of [...books.values()]) {
          await ctx.disk.turn();
          if (needs(b, false) && !ctx.expired(b)) await queue(() => ensureCover(b));
        }
      } while (again);
    } finally {
      sweeping = false;
    }
  }
  ctx.on('books', () => setTimeout(sweep, 600));
  ctx.on('select', (b) => {
    if (b) queue(() => ensureCover(b));
  });
  setTimeout(sweep, 2500);
  S.queue = queue;
  S.needs = needs;
  S.ensureCover = ensureCover;
  S.picOf = picOf;
  S.picFresh = picFresh;
}
