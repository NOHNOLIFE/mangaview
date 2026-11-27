export const isImage = (name) => /\.(avif|bmp|gif|ico|jfif|jpe?g|png|svg|webp|apng)$/i.test(name);
// 页的类型（图片、视频、音频）只按扩展名判断，导入、刷新都不打开文件。媒体只收浏览器原生能播的格式；
// 浏览器播不了的常见媒体格式（unplayable）导入时提示、不建记录，刷新时不再提示。
const KINDS = new Map([
  ...'mp4 m4v webm mkv mov ogv'.split(' ').map((x) => [x, 'video']),
  ...'mp3 flac wav ogg oga opus m4a aac weba'.split(' ').map((x) => [x, 'audio']),
]);
const UNPLAYABLE = new Set(
  'avi wmv flv f4v rmvb rm ts m2ts mts mpg mpeg vob 3gp 3g2 asf divx wma ape ac3 dts amr'.split(' '),
);
export const extOf = (name) => {
  const m = /\.([^./\\]+)$/.exec(name ?? '');
  return m ? m[1].toLowerCase() : '';
};
export const kindOf = (name) =>
  typeof name !== 'string' ? 'image' : (KINDS.get(extOf(name)) ?? (isImage(name) ? 'image' : null));
export const isContent = (name) => kindOf(name) !== null;
export const unplayable = (name) => UNPLAYABLE.has(extOf(name));
// PotPlayer 书签（.pbf，见 pbf.mjs）本身不是页：与同一目录（散图为同一批拖入）里主文件名相同的视频、音频配对（X.flac ↔ X.pbf），也接受 X.flac.pbf。
// 只看文件名、不读盘；同一主文件名对应多个媒体文件时不猜测、跳过；X.flac.pbf 与 X.pbf 都在时用前者。返回 Map(媒体文件名 → .pbf 文件名)。
export const isPbf = (name) => typeof name === 'string' && /\.pbf$/i.test(name);
export function pairPbf(names, pbfs) {
  const low = (s) => s.toLowerCase(),
    media = names.filter((n) => ['video', 'audio'].includes(kindOf(n))),
    exact = new Map(media.map((n) => [low(n), n])),
    stems = new Map(),
    out = new Map(),
    rest = [];
  for (const n of media) {
    const s = low(n.slice(0, n.length - extOf(n).length - 1));
    if (!stems.has(s)) stems.set(s, []);
    stems.get(s).push(n);
  }
  for (const p of pbfs) {
    const base = low(p.slice(0, -4)),
      m = exact.get(base);
    if (m) out.set(m, p);
    else rest.push([base, p]);
  }
  for (const [base, p] of rest) {
    const list = stems.get(base);
    if (list?.length === 1 && !out.has(list[0])) out.set(list[0], p);
  }
  return out;
}
// 外挂字幕（.srt .vtt .ass .ssa .lrc，解析见 subtitles.mjs）本身不是页：与同一目录（散图为同一批拖入或图集里的同一相对目录）里的媒体配对，
// 字幕的文件名以媒体的主文件名开头再接 "."（片名.srt、片名.zh.srt、片名.chs.ass，不区分大小写）。只看文件名、不读盘。
// 几个媒体的主文件名都能接上时只配最长的那个（ep1.part2.srt 配 ep1.part2.mp4 而不是 ep1.mp4）；主文件名相同的几个媒体共用。
// 返回 Map(媒体文件名 → [字幕文件名，按文件名顺序])。
export const isSub = (name) => typeof name === 'string' && /\.(srt|vtt|ass|ssa|lrc)$/i.test(name);
const stemOf = (name) => name.slice(0, name.length - extOf(name).length - 1).toLowerCase();
export function pairSubs(names, subs) {
  const stems = new Map(),
    out = new Map();
  for (const n of names)
    if (['video', 'audio'].includes(kindOf(n))) {
      const s = stemOf(n);
      if (!stems.has(s)) stems.set(s, []);
      stems.get(s).push(n);
    }
  for (const sub of subs) {
    const low = sub.toLowerCase();
    let best = null;
    for (let i = low.indexOf('.'); i > 0; i = low.indexOf('.', i + 1))
      if (stems.has(low.slice(0, i))) best = low.slice(0, i);
    for (const m of best == null ? [] : stems.get(best)) {
      if (!out.has(m)) out.set(m, []);
      out.get(m).push(sub);
    }
  }
  for (const list of out.values()) list.sort(natural);
  return out;
}
// 默认的字幕：与媒体完全同名（只差扩展名）的优先，其次按文件名顺序第一个。
export function defaultSub(media, subs) {
  const list = [...subs].sort(natural),
    s = stemOf(media);
  return list.find((x) => stemOf(x) === s) ?? list[0] ?? null;
}
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export const natural = (a, b) => collator.compare(a, b) || (a > b ? 1 : a < b ? -1 : 0);
export function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((v, i) => v === list[i])) [out[0], out[1]] = [out[1], out[0]];
  return out;
}
export const sortMode = (book) => book.sortMode ?? (book.random ? 'shuffle' : 'nameAsc');
// 旧书只有实际顺序字段；保留已有设置。新记录用 null 明确表示跟随默认。
export const folderSort = (book) =>
  book.sortOverride === undefined ? (book.sortMode ?? (book.random ? 'shuffle' : null)) : book.sortOverride;
export function needsSort(book, defaults) {
  const override = folderSort(book),
    mode = override ?? defaults.mode;
  return (
    sortMode(book) !== mode || (override === null && mode === 'shuffle' && book.shuffleRevision !== defaults.revision)
  );
}
export const byTime = (mode) => mode === 'timeAsc' || mode === 'timeDesc';
// 页名是页在书内的唯一标识（书签、阅读位置靠它），不一定等于文件名：
// 合并作品（多个源文件夹）的页名为“源 key/文件名”，page.src 为源的 key；单文件夹书的页名就是文件名；
// 散图另记 file（文件名）和 path（来自文件夹时的相对目录），同名的不同图片页名加序号区分（见 sources.mjs addLoose）。
export const fileOf = (p) => p.file ?? (p.src ? p.name.slice(p.src.length + 1) : p.name);
// 界面上显示的名称：散图为“相对目录/文件名”（不带区分用的序号），其他书为页名。
export const shownName = (p) => (p.file != null ? (p.path ? p.path + '/' : '') + p.file : p.name);
// 页的类型：'image' | 'video' | 'audio'（散图的页名可能带区分序号，按文件名判断）。
export const pageKind = (p) => kindOf(fileOf(p)) ?? 'image';
// 目录路径逐段自然比较（'' 为根）：父目录在其子目录之前。
export function compareDirs(a, b) {
  if (a === b) return 0;
  const A = a ? a.split('/') : [],
    B = b ? b.split('/') : [];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const c = natural(A[i], B[i]);
    if (c) return c;
  }
  return A.length - B.length;
}
// 「文件名」排序实际按完整路径：先比较所在目录（dir(page)，见 sources.mjs dirOf），同一目录内比较文件名；
// 单文件夹书的目录都相同，即按文件名；合并作品即先按卷、再按文件名；目录完全相同的两卷按 key 分开，不交错；
// 同名散图最后按页名（加入先后的序号）定次序。所有书共用这一个比较。
export const nameOrder =
  (dir = (p) => p.path ?? '') =>
  (a, b) =>
    compareDirs(dir(a), dir(b)) ||
    natural(a.src ?? '', b.src ?? '') ||
    natural(fileOf(a), fileOf(b)) ||
    natural(a.name, b.name);
export function sortedPages(pages, mode, dir) {
  if (mode === 'shuffle') return shuffled(pages);
  const direction = mode === 'nameDesc' || mode === 'timeDesc' ? -1 : 1;
  const byName = nameOrder(dir);
  return [...pages].sort((a, b) => {
    if (byTime(mode)) {
      const knownA = Number.isFinite(a.lastModified),
        knownB = Number.isFinite(b.lastModified);
      if (knownA !== knownB) return knownA ? -1 : 1;
      if (knownA && a.lastModified !== b.lastModified) return direction * (a.lastModified - b.lastModified);
      return byName(a, b);
    }
    return direction * byName(a, b);
  });
}
// 长名称：作品名末尾省略，clipEnd 按字符截短（用于通知等无法悬停查看全名的纯文本）；
// 文件名中间省略、保留开头和结尾（结尾常带集数、序号和扩展名）：splitTail 拆成可省略的开头和保留的结尾（扩展名连同其前 keep 个字符），
// 界面把两段并排，开头按宽度省略（见 style.css .mid-name）。
export const clipEnd = (s, max = 40) => {
  const a = [...s];
  return a.length <= max ? s : a.slice(0, max - 1).join('') + '…';
};
export function splitTail(name, keep = 8) {
  const a = [...name],
    ext = [...(/\.[^./\s]{1,8}$/.exec(name)?.[0] ?? '')].length,
    n = Math.min(a.length, ext + keep);
  return n >= a.length ? [name, ''] : [a.slice(0, a.length - n).join(''), a.slice(a.length - n).join('')];
}
// 全屏缩略图网格的格子比例（高 / 宽）：本书已知尺寸的页面比例的中位数，限制在 0.7 ~ 1.6，一页都不知道时为 1.4。
// 缩略图栏里的视频、音频也按它（offsets 的 nav），与全屏缩略图的格子同样大小。
export function cellRatio(pages) {
  const r = pages
    .filter((p) => p.w && p.h)
    .map((p) => p.h / p.w)
    .sort((x, y) => x - y);
  return Math.min(1.6, Math.max(0.7, r.length ? r[r.length >> 1] : 1.4));
}
// 只为可见项创建元素；累计高度同时用于虚拟窗口、长图内跳转和续读。
// 媒体页：视频的宽度规则与图片相同、高度按帧比例（尺寸未知时按 16:9），高于 cap（阅读视窗高度）时等比缩小到正好一屏；
// 音频在正文里是固定高度的卡片（AUDIO_H：文件名、3 行字幕区、控件）。
// nav：缩略图栏的排版（宽度一律铺满），视频、音频是与全屏缩略图格子同样比例的小块（cellRatio；nav 为数字时即用它作比例）。
export const AUDIO_H = 170;
export function offsets(pages, width, fit, cap = Infinity, nav = false) {
  const starts = [0],
    cell = nav ? width * (typeof nav === 'number' ? nav : cellRatio(pages)) : 0;
  for (const p of pages) {
    const kind = pageKind(p);
    let h;
    if (nav && kind !== 'image') h = cell;
    else if (kind === 'audio') h = AUDIO_H;
    else {
      const w = p.w || (kind === 'video' ? 1600 : 800),
        ph = p.h || (kind === 'video' ? 900 : 1120);
      h = (ph * (fit ? width : Math.min(width, w))) / w;
      if (kind === 'video' && !nav) h = Math.min(h, cap);
    }
    starts.push(starts.at(-1) + Math.max(1, h));
  }
  return starts;
}
// 媒体时间（秒）显示为 m:ss 或 h:mm:ss。
export function clock(s) {
  s = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  const h = Math.floor(s / 3600),
    m = Math.floor(s / 60) % 60,
    x = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
}
// 长按快进 / 快退的步长（秒）：按住第 1 秒内 2 秒，第 2 秒内 5 秒，第 3 秒内 10 秒，之后 30 秒封顶。ms 为已按住的毫秒数。
export const seekStep = (ms) => (ms < 1000 ? 2 : ms < 2000 ? 5 : ms < 3000 ? 10 : 30);
// 音量每次调 5%，夹在 0–1 之间，避免浮点误差累积。
export const nudge = (v, d) =>
  Math.round(Math.min(1, Math.max(0, (Number.isFinite(v) ? v : 1) + d * 0.05)) * 100) / 100;
// 视频在正文里的显示宽度（封顶后等比缩小，居中）：与 offsets 同一规则。
export function videoWidth(p, width, fit, cap = Infinity) {
  const w = p.w || 1600,
    h = p.h || 900,
    dw = fit ? width : Math.min(width, w);
  return (h * dw) / w > cap ? (cap * w) / h : dw;
}
export function at(starts, y) {
  let lo = 0,
    hi = starts.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= y) lo = mid;
    else hi = mid;
  }
  return { i: lo, f: Math.min(1, Math.max(0, (y - starts[lo]) / (starts[lo + 1] - starts[lo] || 1))) };
}
export const point = (s, { i, f }) => s[i] + (s[i + 1] - s[i]) * f;
