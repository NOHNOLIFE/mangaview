// 播放位置记忆：会话内存在 S.times，持久化在书目记录的 book.mediaPos=[{id:页名,t:秒}]（按条目合并，见 merge.mjs）。
// 只在暂停、离开视窗、切书、关闭窗口时保存，播放中定时保存（player.mjs 的 play 事件）；播到结尾清除。
// 播放位置：播放中至多每 POS_EVERY 毫秒记一次；记下后 POS_SAVE 毫秒内合并为一次写入。剩余不足 POS_END 秒视为播完，清除位置。
export const POS_EVERY = 10000;
const POS_SAVE = 1000,
  POS_END = 5;

export function install(ctx, S) {
  const { api } = S;
  // ---- 播放位置记忆：随书目记录保存（book.mediaPos，进入备份），已移除的媒体的位置在下次保存时一并清掉。
  const savedPos = (book, page) => {
    const e = Array.isArray(book.mediaPos) ? book.mediaPos.find((x) => x?.id === page.name) : null;
    return Number.isFinite(e?.t) && e.t > 0 ? e.t : 0;
  };
  const dirtyBooks = new Set();
  let posTimer = 0;
  function remember(p, t) {
    const book = p.book,
      name = p.page.name,
      d = api.duration(p),
      list = Array.isArray(book.mediaPos) ? book.mediaPos : [];
    const v = Number.isFinite(t) && t > 0.5 && !(d && d - t < POS_END) ? Math.round(t * 1000) / 1000 : 0;
    const names = new Set(book.pages.map((x) => x.name)),
      old = list.find((x) => x?.id === name),
      stale = list.some((x) => !names.has(x?.id));
    if (!stale && (v ? old?.t === v : !old)) return;
    const next = list.filter((x) => x?.id !== name && names.has(x?.id));
    if (v) next.push({ id: name, t: v });
    book.mediaPos = next;
    dirtyBooks.add(book);
    clearTimeout(posTimer);
    posTimer = setTimeout(flushPos, POS_SAVE);
  }
  function flushPos() {
    clearTimeout(posTimer);
    posTimer = 0;
    for (const b of dirtyBooks) ctx.persist(b);
    dirtyBooks.clear();
  }
  window.addEventListener('pagehide', () => {
    for (const p of S.all()) if (p.state === 'ready') remember(p, p.el.currentTime);
    flushPos();
  });
  Object.assign(S, { savedPos, remember });
}
