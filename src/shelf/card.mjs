// 书卡片：卡片的内容（书名、进度、标签、书签数、类型角标）、按内容摘要增量更新，以及封面的显示（进入视窗时加载，文字封面）。
// 卡片的位置与挂载见 layout.mjs，卡片上的操作按钮见 actions.mjs，封面的后台生成见 covercache.mjs。
import { extend } from '../core/lang.mjs';
import { KIND_LABEL, tagsOf, marksOf, pagesOf, kindsOf } from './criteria.mjs';
import { $ } from './util.mjs';

extend({
  bmCount: ['{n} bookmarks', '{n} 个书签', 'しおり {n} 件', '책갈피 {n}개'],
});
export function install(ctx, S) {
  const { books, t, fmt, make, icon, safe, shelf } = ctx,
    holder = $('books'),
    { nodes } = S;
  const needs = (...a) => S.needs(...a);
  const queue = (...a) => S.queue(...a);
  const ensureCover = (...a) => S.ensureCover(...a);
  const picOf = (...a) => S.picOf(...a);
  const picFresh = (...a) => S.picFresh(...a);
  const relayoutSoon = (...a) => S.relayoutSoon(...a);
  const mark = (...a) => S.mark(...a);
  const chip = (...a) => S.chip(...a);
  const restoreOne = (...a) => S.restoreOne(...a);
  const cardActions = (...a) => S.cardActions(...a);
  const coverOf = new WeakMap(); // 封面槽 → 书 id
  // 自定义封面（cover.mjs）优先于默认封面；默认封面照常在后台生成，它的摘要用于识别，与自定义封面无关。
  // 默认封面的画面过期（如视频最早的书签变了）时签名带 ~：卡片换一个封面槽，进入视窗时重新生成。
  const coverKey = (b) => (b.customCover ? b.id + ':custom' : b.id + ':cover');
  const coverSig = (b) =>
    b.customCover
      ? 'c' + b.customCover.at
      : [
          b.fp?.cover?.hash ?? '',
          picOf(b.fp) ?? '',
          b.fp?.src ?? '',
          b.fp?.text ? 't' + ctx.title(b) : '',
          ctx.expired(b) || picFresh(b) ? '' : '~',
        ].join('|');
  const ratioOf = (b) => b.customCover?.r || b.coverRatio || 1.42;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          io.unobserve(e.target);
          const b = books.get(coverOf.get(e.target));
          if (b) safe(showCover)(e.target, b);
        }
    },
    { root: holder, rootMargin: '400px 0px' },
  );
  // 文字封面：作品名（长名称换行，超出行数末尾省略），不存图。
  function textCover(slot, b) {
    if (slot.querySelector('.text-cover')) return;
    const s = make('span', 'text-cover');
    s.append(make('span', '', ctx.title(b)));
    slot.append(s);
    slot.classList.add('ready');
  }
  async function showCover(slot, b) {
    if (!b.customCover && !ctx.expired(b) && needs(b, true)) await queue(() => ensureCover(b, true));
    if (b.fp?.text && !b.customCover) return textCover(slot, b);
    const th = (await ctx.getThumb(coverKey(b))) ?? (b.customCover ? await ctx.getThumb(b.id + ':cover') : null);
    if (!th) {
      if (b.fp?.media && !b.customCover) textCover(slot, b);
      return;
    } // 旧记录（媒体封面还没有画面、书已过期）
    if (slot.querySelector('img')) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.src = th.url;
    slot.append(img);
    slot.classList.add('ready');
    if (Math.abs(ratioOf(b) - th.h / th.w) > 0.01) {
      if (b.customCover) b.customCover.r = th.h / th.w;
      else b.coverRatio = th.h / th.w;
      if (S.layoutMode === 'masonry') relayoutSoon();
    }
  }
  // 设置 / 重置封面后只更新这一张卡片（cover.mjs），其余卡片不动；瀑布流里比例变了才重排。
  ctx.refreshCard = (b) => {
    const el = nodes.get(b.id);
    if (el) fill(el, b);
    if (S.layoutMode === 'masonry' && shelf.open && S.shown.includes(b)) relayoutSoon();
  };
  // 卡片显示的内容摘要：变了才重建卡片内容（封面节点保留，不重新加载）。
  const sig = (b) =>
    [
      ctx.title(b),
      pagesOf(b),
      [...kindsOf(b)].join(),
      ctx.expired(b) ? 'x' : Math.round(ctx.readRatio(b) * 100) + '/' + ctx.lostSources(b),
      tagsOf(b).join('\x01'),
      b.place,
      b === ctx.current,
      marksOf(b),
      coverSig(b),
      ctx.lang,
    ].join('|');
  function card(b) {
    const el = make('article', 'book'),
      pick = make('button', 'pick'),
      cover = make('span', 'cover');
    el.dataset.id = b.id;
    el.setAttribute('role', 'listitem');
    pick.type = 'button';
    pick.tabIndex = -1;
    pick.append(cover);
    el.append(pick);
    pick.onclick = safe(() => {
      const x = books.get(el.dataset.id);
      if (!x) return;
      if (ctx.expired(x)) return restoreOne(x);
      ctx.select(x);
      shelf.close();
      ctx.main.focus();
    });
    el._pick = pick;
    fill(el, b);
    return el;
  }
  function fill(el, b) {
    const ex = ctx.expired(b),
      pick = el._pick,
      hash = coverSig(b);
    el._sig = sig(b);
    el.className = 'book' + (b === ctx.current ? ' current' : '') + (ex ? ' expired' : '');
    // 封面换了（例如文件夹内容变化）才重新加载，否则保留已显示的图。
    if (!el._cover || el._hash !== hash) {
      const cover = make('span', 'cover');
      if (el._cover) el._cover.replaceWith(cover);
      else pick.firstChild.replaceWith(cover);
      el._cover = cover;
      el._hash = hash;
      coverOf.set(cover, b.id);
      io.observe(cover);
    }
    while (pick.lastChild !== el._cover) pick.lastChild.remove();
    pick.setAttribute('aria-label', ctx.title(b));
    const veil = make('span', 'veil'),
      ratio = ex ? 0 : ctx.readRatio(b),
      pct = Math.round(ratio * 100),
      meta = make('span', 'meta'),
      marks = marksOf(b);
    const info = make('span', 'info');
    info.append(make('span', '', pagesOf(b) + ' ' + t('pages')));
    if (marks) {
      const m = make('span', 'marks');
      m.title = fmt('bmCount', { n: marks });
      m.append(icon('bookmark'), String(marks));
      info.append(m);
    }
    meta.append(
      info,
      make('span', ex ? 'lost' : pct ? '' : 'fresh', ex ? t('viewExpired') : pct ? pct + '%' : t('unread')),
    );
    const name = make('strong', 'name', ctx.title(b));
    name.title = ctx.title(b); // 书名最多两行，末尾省略，完整书名在提示里
    veil.append(name, meta);
    if (tagsOf(b).length) {
      const tags = make('span', 'tags');
      for (const x of tagsOf(b)) tags.append(chip(x));
      veil.append(tags);
    }
    pick.append(veil);
    if (ratio > 0) {
      const bar = make('span', 'progress');
      bar.style.setProperty('--p', ratio);
      pick.append(bar);
    }
    if (b === ctx.current) pick.append(make('span', 'badge', t('nowReading')));
    const lost = ex ? 0 : ctx.lostSources(b);
    if (lost) {
      const w = make('span', 'part');
      w.title = fmt('partN', { n: lost });
      w.setAttribute('aria-label', w.title);
      w.append(icon('alert'));
      pick.append(w);
    }
    // 书签数：有书签时在封面左下角常显（没有书签不显示）。
    if (marks) {
      const m = make('span', 'bm-flag');
      m.title = fmt('bmCount', { n: marks });
      m.setAttribute('aria-label', m.title);
      m.append(icon('bookmark'), make('span', '', String(marks)));
      pick.append(m);
    }
    // 类型角标：含视频 / 音频的书在封面右上角常显对应图标（只有图片的书不显示）。
    const media = ['video', 'audio'].filter((k) => kindsOf(b).has(k));
    if (media.length) {
      const k = make('span', 'kind-flag');
      k.title = media.map((x) => t(KIND_LABEL[x])).join(' · ');
      k.setAttribute('aria-label', k.title);
      for (const x of media) k.append(icon(x === 'video' ? 'film' : 'music'));
      pick.append(k);
    }
    const tools = cardActions(b, ex, lost);
    el.querySelector(':scope>.actions')?.remove();
    el.append(tools);
    mark(el, el.dataset.id === S.activeId);
  }
  // 别的窗口换了封面缩略图（缓存已由 windows.mjs 清掉）：重新加载这张卡片的封面。
  ctx.on('thumbs', (keys) => {
    for (const k of keys) {
      if (!k.endsWith(':cover')) continue;
      const el = nodes.get(k.slice(0, -6)),
        b = books.get(k.slice(0, -6));
      if (el && b) {
        el._hash = null;
        fill(el, b);
      }
    }
  });
  S.ratioOf = ratioOf;
  S.sig = sig;
  S.card = card;
  S.fill = fill;
}
