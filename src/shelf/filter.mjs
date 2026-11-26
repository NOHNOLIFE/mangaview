// 书架筛选：筛选条件的状态（关键词、页数、标签、书签、类型）与持久化、按条件匹配书（ctx.matchFilter）、当前列表的书；预设的读取与保存。
// 筛选界面见 filterbar.mjs，预设菜单见 presets.mjs，条件的纯逻辑见 criteria.mjs。
import { norm } from '../core/match.mjs';
import { extend } from '../core/lang.mjs';
import { clean, KIND_LABEL, tagsOf, marksOf, pagesOf, kindsOf } from './criteria.mjs';
import { $ } from './util.mjs';

extend({
  pagesFrom: ['≥ {n} pages', '≥ {n} 页', '{n} ページ以上', '{n}쪽 이상'],
  pagesTo: ['≤ {n} pages', '≤ {n} 页', '{n} ページ以下', '{n}쪽 이하'],
  pagesRange: ['{a}–{b} pages', '{a}–{b} 页', '{a}〜{b} ページ', '{a}–{b}쪽'],
});
export function install(ctx, S) {
  const { books, t, fmt, get, put } = ctx;
  const draw = (...a) => S.draw(...a);
  const byTitle = (...a) => S.byTitle(...a);
  // 过期书只出现在“过期书籍”里，其他列表不显示，避免被当成可读的书。
  const inView = (b, v = S.view) => (ctx.expired(b) ? v === 'expired' : v === 'all' || b.place === v);

  // ---- 筛选：关键词、页数、标签、只看有书签。条件持久保存（去抖写入），在书架 / 书库 / 所有书籍之间切换时保持；
  // 上一本 / 下一本和书架书签列表也只在符合条件的书里进行（ctx.matchFilter，见 reader/session.mjs 的 readingList）。
  const saved = get('shelfFilter', null);
  S.F = clean(saved);
  const loadPresets = () =>
    (Array.isArray(get('shelfPresets', [])) ? get('shelfPresets', []) : [])
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p) => ({ id: String(p.id || crypto.randomUUID()), name: p.name.trim().slice(0, 60), f: clean(p.f) }));
  S.presets = loadPresets();
  S.presetId = S.presets.some((p) => p.id === saved?.preset) ? saved.preset : null;
  let saveTimer = 0;
  const storeFilter = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushFilter, 600);
  };
  function flushFilter() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    put('shelfFilter', { ...S.F, preset: S.presetId });
  }
  const savePresets = () => put('shelfPresets', S.presets);
  let parsed;
  function compile() {
    const qtags = [],
      words = [];
    for (const w of S.F.q.trim().split(/\s+/))
      if (w.length > 1 && w.startsWith('#')) qtags.push(norm(w.slice(1)));
      else if (w) words.push(norm(w));
    parsed = {
      words,
      qtags,
      min: +S.F.min || 0,
      max: S.F.max !== '' ? +S.F.max : Infinity,
      tags: S.F.tags.map(norm),
      marked: S.F.marked,
      kinds: S.F.kinds,
    };
  }
  compile();
  // 搜索文本按书缓存，书名、路径、标签或合并作品各卷（源文件夹）的名称、路径变化时才重新归一化。
  const hays = new WeakMap();
  function hay(b) {
    const key = [
      ctx.title(b),
      b.title ?? '',
      b.path ?? '',
      ...tagsOf(b),
      ...(Array.isArray(b.sources) && b.sources.length > 1
        ? b.sources.flatMap((s) => [s.title ?? '', s.path ?? ''])
        : []),
    ].join('\n');
    let h = hays.get(b);
    if (h?.key !== key) {
      h = { key, text: norm(key.replace(/\n/g, ' ')) };
      hays.set(b, h);
    }
    return h.text;
  }
  function matches(b) {
    const p = parsed,
      n = pagesOf(b);
    if (n < p.min || n > p.max || (p.marked && !marksOf(b))) return false;
    if (p.kinds.length) {
      const mine = kindsOf(b);
      if (!p.kinds.some((k) => mine.has(k))) return false;
    }
    if (p.tags.length || p.qtags.length) {
      const mine = tagsOf(b).map(norm);
      for (const k of p.tags) if (!mine.includes(k)) return false;
      for (const k of p.qtags) if (!mine.some((x) => x.startsWith(k))) return false;
    }
    if (p.words.length) {
      const h = hay(b);
      if (!p.words.every((w) => h.includes(w))) return false;
    }
    return true;
  }
  ctx.matchFilter = matches;
  const filtering = () => !!(S.F.q.trim() || S.F.min || S.F.max || S.F.tags.length || S.F.marked || S.F.kinds.length);
  ctx.filtering = filtering; // 总控栏（reader/controlbar.mjs）据此标出“只在筛选结果内切书”
  const extraFilters = () =>
    S.F.tags.length + (S.F.min || S.F.max ? 1 : 0) + (S.F.marked ? 1 : 0) + (S.F.kinds.length ? 1 : 0);
  function setFilter(next, { preset = S.presetId, inputs = true } = {}) {
    S.F = clean(next);
    S.presetId = preset;
    compile();
    storeFilter();
    if (inputs) syncInputs();
    draw('filter');
  }
  function syncInputs() {
    $('query').value = S.F.q;
    $('min').value = S.F.min;
    $('max').value = S.F.max;
  }
  syncInputs();
  function filtered() {
    return byTitle([...books.values()].filter((b) => inView(b) && matches(b)));
  }
  const rangeText = (f) =>
    f.min && f.max
      ? fmt('pagesRange', { a: f.min, b: f.max })
      : f.min
        ? fmt('pagesFrom', { n: f.min })
        : f.max
          ? fmt('pagesTo', { n: f.max })
          : '';
  const kindText = (f) => f.kinds.map((k) => t(KIND_LABEL[k])).join(' / ');
  const describe = (f) =>
    [
      f.q.trim() && '“' + f.q.trim() + '”',
      ...f.tags.map((x) => '#' + x),
      rangeText(f),
      f.marked && t('hasBookmarks'),
      kindText(f),
    ]
      .filter(Boolean)
      .join(' · ');
  S.inView = inView;
  S.loadPresets = loadPresets;
  S.storeFilter = storeFilter;
  S.flushFilter = flushFilter;
  S.savePresets = savePresets;
  S.filtering = filtering;
  S.extraFilters = extraFilters;
  S.setFilter = setFilter;
  S.filtered = filtered;
  S.rangeText = rangeText;
  S.kindText = kindText;
  S.describe = describe;
}
