import { isMedia } from './list.mjs';
import { nameStrip } from '../media/art.mjs';
// 书签列表项的绘制（书签面板与书架书签栏共用，全屏书架书签、设置封面用其中的格子内容）：缩略图格子（画面、类型角标、区段标记、名称）、
// 区段的起点与区段书签两项、成对高亮、最近书签的位置、显示比例。
export function install(ctx, S) {
  const { main, t, make, icon } = ctx;
  // 格子里的内容（书签列表、全屏书架书签、设置封面共用）：画面或媒体占位、媒体的类型角标与时间点、生效区段的起点 / 区段书签标记、名称。
  // holder 为格子，img 为其中的 <img>，end：区段书签那一项。
  function face(holder, img, book, x, end = false) {
    S.paint(holder, img, book, x, end);
    if (isMedia(end ? x.bm.end : x.bm)) holder.append(S.mediaBadge(book, x, end));
    if (x.bm.end && x.live) holder.append(markIcon(end ? 'end' : 'start'));
    named(holder, book, x.bm);
  }
  // 名称叠在缩略图下沿（读屏已在 aria-label 里）：媒体书签都有名称；图片书签只在改过名时显示。改名后原地更新。区段的两项显示同一个名称。
  const named = (holder, book, bm) => nameStrip(ctx, holder, S.name(book, bm));
  // 一项一格，大小相同：缩略图、铅笔（重命名）与删除按钮。区段的起点和区段书签（end，data-end）各是一项，按位置排在列表里（list.mjs 的 entries），
  // 生效时各带一个互相呼应的区段标记（.sec-start / .sec-end）；区段书签那一项的删除按钮只删区段书签（起点变回普通书签）。
  // 区段暂不生效时（页序改变使区段书签排到起点前）区段书签那一项变灰（.off）、两项都不画标记，起点按普通书签显示，数据保留。
  // 页已不存在的项（.gone）不能跳转，仍可删除。媒体书签悬停 / 聚焦时显示文件详情框（filecard.mjs，由列表接上），不设 title；图片书签的提示是它的名称。
  function tile(book, x, withBook = false, end = false) {
    const gone = (end ? x.e : x.i) < 0,
      item = make(
        'div',
        'bm-item' +
          (gone ? ' gone' : '') +
          (x.live ? (end ? ' sec-end' : ' sec-start') : '') +
          (end && !x.live ? ' off' : ''),
      ),
      thumb = make('span', 'bm-thumb'),
      img = make('img');
    const label = end
      ? t('secEnd') + ' · ' + S.where(book, x, true)
      : S.where(book, x) + (x.bm.end ? ' · ' + t('secStart') : '');
    item.dataset.id = x.bm.id;
    if (end) item.dataset.end = '';
    item.setAttribute('aria-label', withBook ? ctx.title(book) + ' · ' + label : label);
    const name = S.name(book, x.bm);
    if (name && !isMedia(x.bm)) item.title = name;
    img.alt = '';
    img.draggable = false;
    thumb.append(img);
    face(thumb, img, book, x, end);
    item.append(
      thumb,
      ctx.iconButton('pencil', t('bmRename'), () => S.editItem(item), 'bm-ren'),
      end
        ? ctx.iconButton('close', t('secDelete'), () => S.dropEnd(book, x.bm), 'bm-del')
        : ctx.iconButton('close', t('bmDelete'), () => S.drop(book, x.bm), 'bm-del'),
    );
    return item;
  }
  const markIcon = (kind) => {
    const el = make('span', 'bm-mk ' + kind);
    el.append(icon(kind === 'start' ? 'bm-start' : 'bm-end'));
    return el;
  };
  // 成对高亮：悬停或聚焦生效区段的起点或区段书签，两项一起以区段配色高亮（.mate）。box 为列表容器，sel 为项的选择器。
  // 返回 set(项)，供列表自己管理选中项时调用（全屏书架书签的键盘选中）。
  function mates(box, sel = '.bm-item') {
    let hot = null;
    const set = (el) => {
      const id = el && (el.classList.contains('sec-start') || el.classList.contains('sec-end')) ? el.dataset.id : null;
      if (id === hot) return;
      hot = id;
      for (const e of box.querySelectorAll(sel + '.mate')) e.classList.remove('mate');
      if (id) for (const e of box.querySelectorAll(sel + '[data-id="' + CSS.escape(id) + '"]')) e.classList.add('mate');
    };
    box.addEventListener('pointerover', (e) => set(e.target.closest(sel)));
    box.addEventListener('pointerleave', () =>
      set(box.contains(document.activeElement) ? document.activeElement.closest(sel) : null),
    );
    box.addEventListener('focusin', (e) => set(e.target.closest(sel)));
    box.addEventListener('focusout', (e) => {
      if (!box.contains(e.relatedTarget)) set(box.matches(':hover') ? box.querySelector(sel + ':hover') : null);
    });
    return set;
  }
  // 最近书签（S.nearest 的 {id, end}）在列表里对应的一项（起点与区段书签各是一项）。scope 为所在的列表或分组。
  const spotOf = (scope, r) =>
    (r &&
      scope?.querySelector(
        '.bm-item[data-id="' + CSS.escape(r.id) + '"]' + (r.end ? '[data-end]' : ':not([data-end])'),
      )) ||
    null;
  // 列表（书签面板、书架书签栏）：区段两项的成对高亮；视频、音频书签悬停 / 聚焦时显示文件详情框（filecard.mjs），区段书签那一项是区段书签那一端。
  // opts 原样交给 fileCard.attach（如 ready：浮出的面板淡入完成后才弹）。
  function cards(box, opts) {
    mates(box);
    ctx.fileCard?.attach(
      box,
      (target) => {
        const item = target.closest('.bm-item');
        if (!item || !box.contains(item)) return null;
        const group = item.closest('.sm-book'),
          book = group ? ctx.books.get(group.dataset.book) : ctx.current,
          bm = book?.bookmarks?.find((b) => b.id === item.dataset.id),
          end = !!bm?.end && 'end' in item.dataset,
          m = end ? bm.end : bm;
        if (!isMedia(m)) return null;
        const page = book.pages.find((p) => p.name === m.name);
        return page ? { el: item, book, page, mark: { id: bm.id, end } } : null;
      },
      opts,
    );
  }
  // 缩略图按视口形状截取；显示时把比例限制在 3:4 ~ 4:3，避免窄窗口或宽屏下变成长条（居中裁切，书签位置仍在中央）。
  const ratio = () => String(Math.min(4 / 3, Math.max(3 / 4, main.clientWidth / Math.max(1, main.clientHeight))));
  Object.assign(S, { tile, face, named, mates, spotOf, cards, ratio });
}
