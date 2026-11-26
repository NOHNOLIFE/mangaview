// 书的当前封面（供音频的缩略图、音频书签、音频播放面板作背景）：ctx.bookCover(book) → Promise<图片地址|null>。
// 自定义封面（cover.mjs）优先，否则是默认封面（covercache.mjs 生成）；全书只有音频、用文字封面时为 null。
// 不另读盘、不另存：直接取书架已有的封面缩略图（getThumb 带会话缓存）。结果按封面的签名缓存，封面变了（设置 / 重置、
// 默认封面重新生成、别的窗口换了封面）时失效并派发 ctx.emit('cover', book)，已显示的背景随之更新。
// ctx.coverBg(el, book)：把封面设为元素的背景（CSS 变量 --cover 与 .has-cover），并在封面变化时自动更新。
export const coverSig = (b) =>
  b.customCover
    ? 'c' + b.customCover.at
    : b.fp?.text
      ? 't'
      : b.fp?.thumb
        ? 'd' + (b.fp.pic ?? '') + '|' + (b.fp.src ?? '')
        : '';
export function install(ctx) {
  const cache = new Map(); // 书 id → {sig, p}
  async function load(b) {
    const custom = b.customCover ? await ctx.getThumb(b.id + ':custom').catch(() => null) : null;
    if (custom) return custom.url;
    if (b.fp?.text) return null;
    return (await ctx.getThumb(b.id + ':cover').catch(() => null))?.url ?? null;
  }
  function bookCover(b) {
    if (!b) return Promise.resolve(null);
    const sig = coverSig(b);
    let c = cache.get(b.id);
    if (!c || c.sig !== sig) cache.set(b.id, (c = { sig, p: load(b) }));
    return c.p;
  }
  // 封面变了：清掉缓存，稍后（等书目记下新封面的签名）通知各处重取。
  const timers = new Map();
  function changed(id) {
    cache.delete(id);
    if (timers.has(id)) return;
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        cache.delete(id);
        const b = ctx.books.get(id);
        if (b) ctx.emit('cover', b);
      }),
    );
  }
  // 封面缩略图的写入都经 ctx.saveThumb（默认封面的后台生成、设置自定义封面）：在这里得知封面换了。
  const save = ctx.saveThumb;
  ctx.saveThumb = async (key, th) => {
    await save(key, th);
    const m = /^(.*):(cover|custom)$/.exec(key);
    if (m) changed(m[1]);
  };
  ctx.on('thumbs', (keys) => {
    for (const k of keys) {
      const m = /^(.*):(cover|custom)$/.exec(k);
      if (m) changed(m[1]);
    }
  });
  ctx.on('synced', (b, keys) => {
    if (keys?.some((k) => k === 'customCover' || k === 'fp') && cache.get(b.id)?.sig !== coverSig(b)) changed(b.id);
  });
  function paint(el, b) {
    bookCover(b).then((url) => {
      if (el.dataset.coverBook !== b.id) return;
      el.classList.toggle('has-cover', !!url);
      if (url) el.style.setProperty('--cover', 'url("' + url + '")');
      else el.style.removeProperty('--cover');
    });
  }
  function coverBg(el, b) {
    if (!b) return;
    el.dataset.coverBook = b.id;
    paint(el, b);
  }
  ctx.on('cover', (b) => {
    for (const el of document.querySelectorAll('[data-cover-book="' + CSS.escape(b.id) + '"]')) paint(el, b);
  });
  ctx.bookCover = bookCover;
  ctx.coverBg = coverBg;
  ctx.coverChanged = changed;
}
