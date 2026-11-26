// 播放顺序与循环、只播放书签区段、新窗口播放的地址与窗口大小的纯逻辑，不碰界面和存储（media.mjs 调用，tests/core/playlist.test.mjs 覆盖）。
// 播放顺序：'list' 列表（默认）、'single' 单集、'shuffle' 随机；壳上的按钮按 ORDERS 的次序轮换。
export const ORDERS = ['list', 'shuffle', 'single'];
export const orderOf = (v) => (ORDERS.includes(v) ? v : 'list');
// 一个媒体播完之后播哪个：list 为当前书里可播放的媒体的页序号（按页序），cur 为刚播完的页序号；
// played 为本轮随机已播过的页序号（含 cur），random 返回 [0,1) 的随机数。
// 返回 {next, played}：next 为下一个的页序号（等于 cur 即重复播放当前媒体，null 即停下）；played 为更新后的本轮集合。
export function following({ order = 'list', loop = false, list = [], cur, played = new Set(), random = Math.random }) {
  if (order === 'single') return { next: loop ? cur : null, played };
  if (order === 'shuffle') {
    let round = new Set(played);
    round.add(cur);
    let pool = list.filter((i) => !round.has(i));
    if (!pool.length) {
      if (!loop) return { next: null, played: round };
      round = new Set([cur]);
      pool = list.filter((i) => i !== cur); // 一轮播完重新洗牌，刚播完的不紧接着重复
      if (!pool.length) return { next: list.includes(cur) ? cur : null, played: round };
    }
    const next = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    round.add(next);
    return { next, played: round };
  }
  const after = list.find((i) => i > cur);
  if (after != null) return { next: after, played };
  return { next: loop && list.length ? list[0] : null, played };
}
// ---- 只播放书签区段：ranges 为一个媒体内生效的区段 [{a,b}]（秒，按起点排序，互不重叠）。
// 开始播放（或自动切到该媒体）时从哪里播：在某个区段内就从当前时间继续；否则从当前时间之后的第一个区段起点开始，之后没有区段时从第一个区段开始。
export function sectionStart(ranges, t) {
  if (!ranges.length) return t;
  if (ranges.some((r) => r.a <= t && t < r.b)) return t;
  return (ranges.find((r) => r.a >= t) ?? ranges[0]).a;
}
// 播放中每次进度更新时调用：k 为正在播放的区段序号（不在区段里为 null）。
// 返回 {k, seek?, done?}：播到区段末尾跳到下一个区段的起点（seek）；最后一个区段播完即 done（视为该媒体播完）。
// 手动拖到区段之外（k 由调用方清为 null）时不强行跳回，进入后面的区段后恢复按区段跳转。
export const EPS = 0.05;
export function sectionStep(ranges, t, k) {
  const r = k == null ? null : ranges[k];
  if (r && t >= r.b - EPS) {
    if (k + 1 < ranges.length) return { k: k + 1, seek: ranges[k + 1].a };
    return { k: null, done: true };
  }
  if (r && t >= r.a - EPS) return { k };
  const i = ranges.findIndex((x) => x.a <= t && t < x.b - EPS);
  return { k: i < 0 ? null : i };
}

// ---- 新窗口播放：新窗口的地址带上书的 id、页名和时间点（秒），新窗口启动时据此定位并从该处播放（media.mjs、app.mjs）。
export function popoutUrl(path, { book, name, t }) {
  return (
    path +
    '?' +
    new URLSearchParams({
      play: book,
      page: name,
      t: String(Number.isFinite(t) && t > 0 ? Math.round(t * 1000) / 1000 : 0),
    })
  );
}
// 读地址里的目标：{book,name,t}，不是新窗口播放时为 null。
export function popoutTarget(search) {
  const q = new URLSearchParams(search),
    book = q.get('play'),
    name = q.get('page');
  if (!book || name == null) return null;
  const t = Number(q.get('t'));
  return { book, name, t: Number.isFinite(t) && t > 0 ? t : 0 };
}
// 新窗口的大小：默认开成较小的窗口。宽约为屏幕可用宽度的 45%（480–960）；视频按画面比例（未知时 16:9）定高，过高时按屏幕高度收窄；音频是一条横条，窗口矮一些。
export function popoutSize(kind, page, screen = {}) {
  const aw = screen.availWidth || 1280,
    ah = screen.availHeight || 800,
    top = Math.round(ah * 0.85);
  let w = Math.round(Math.min(960, Math.max(480, aw * 0.45)));
  if (kind === 'audio') return { width: w, height: Math.min(top, 360) };
  const r = page?.w > 0 && page?.h > 0 ? page.h / page.w : 9 / 16;
  let h = Math.round(w * r);
  if (h > top) {
    h = top;
    w = Math.max(320, Math.round(h / r));
  }
  return { width: w, height: Math.max(240, h) };
}
