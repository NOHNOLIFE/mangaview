import { isMedia } from './list.mjs';
import { nameStrip } from '../media/art.mjs';
// 书签列表项的绘制（书签面板与书架书签栏共用，全屏书架书签、设置封面用其中的格子内容）：缩略图格子（画面、类型角标、区段标记、名称）、
// 区段书签的小图、最近书签的高亮、显示比例。
export function install(ctx, S) {
  const { main, t, make, icon } = ctx;
  // 格子里的内容（书签列表、全屏书架书签、设置封面共用）：画面或媒体占位、媒体的类型角标与时间点、生效区段的起点标记、名称。
  // holder 为格子，img 为其中的 <img>。
  function face(holder, img, book, x) {
    S.paint(holder, img, book, x);
    if (isMedia(x.bm)) holder.append(S.mediaBadge(book, x));
    if (x.bm.end && x.live) holder.append(markIcon('start'));
    named(holder, book, x.bm);
  }
  // 名称叠在缩略图下沿（读屏已在 aria-label 里）：媒体书签都有名称；图片书签只在改过名时显示。改名后原地更新。
  const named = (holder, book, bm) => nameStrip(ctx, holder, S.name(book, bm));
  // 区段书签的小图（.bm-sub，data-end）：叠在起点格子的左下角，有自己的区段标记（与起点的互相呼应）；del 为真时带自己的删除按钮（只删区段书签，起点变回普通书签）。
  // 区段暂不生效时（页序改变使区段书签排到起点前）小图变灰、两头都不画区段标记，数据保留；所在的页已不存在时（.gone）不能跳转，仍可删除。
  function sub(book, x, del = true) {
    const el = make('span', 'bm-sub' + (x.live ? '' : ' off') + (x.e < 0 ? ' gone' : '')),
      img = make('img');
    el.dataset.end = '';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', t('secEnd') + ' · ' + S.where(book, x, true));
    img.alt = '';
    img.draggable = false;
    el.append(img);
    S.paint(el, img, book, x, true);
    if (x.live) el.append(markIcon('end'));
    if (del) el.append(ctx.iconButton('close', t('secDelete'), () => S.dropEnd(book, x.bm), 'bm-sub-del'));
    return el;
  }
  // 一个书签一格：缩略图、铅笔（重命名）与删除按钮；带区段书签的（.paired）左下角叠一张区段书签的小图，悬停任一张两张一起高亮（区段配色），点哪张跳到哪里。
  // 页已不存在的项（.gone）不能跳转。媒体书签悬停 / 聚焦时显示文件详情框（filecard.mjs，由列表接上），不设 title；图片书签的提示是它的名称。
  function tile(book, x, withBook = false) {
    const item = make('div', 'bm-item' + (x.i < 0 ? ' gone' : '') + (x.bm.end ? ' paired' : '')),
      thumb = make('span', 'bm-thumb'),
      img = make('img');
    const label = S.where(book, x) + (x.bm.end ? ' · ' + t('secStart') : '');
    item.dataset.id = x.bm.id;
    item.setAttribute('aria-label', withBook ? ctx.title(book) + ' · ' + label : label);
    const name = S.name(book, x.bm);
    if (name && !isMedia(x.bm)) item.title = name;
    img.alt = '';
    img.draggable = false;
    thumb.append(img);
    face(thumb, img, book, x);
    item.append(
      thumb,
      ctx.iconButton('pencil', t('bmRename'), () => S.editItem(item), 'bm-ren'),
      ctx.iconButton('close', t('bmDelete'), () => S.drop(book, x.bm), 'bm-del'),
    );
    if (x.bm.end) item.append(sub(book, x));
    return item;
  }
  const markIcon = (kind) => {
    const el = make('span', 'bm-mk ' + kind);
    el.append(icon(kind === 'start' ? 'bm-start' : 'bm-end'));
    return el;
  };
  // 最近书签（S.nearest 的 {id, end}）在列表里对应的元素：起点或普通书签是整格，区段书签是那一格的小图。scope 为所在的列表或分组。
  const spotOf = (scope, r) => {
    const item = r && scope?.querySelector('.bm-item[data-id="' + CSS.escape(r.id) + '"]');
    return item ? (r.end ? item.querySelector(':scope>.bm-sub') : item) : null;
  };
  // 列表（书签面板、书架书签栏）里的视频、音频书签：悬停 / 聚焦时显示文件详情框（filecard.mjs），指在小图上时是区段书签那一端。
  function cards(box) {
    ctx.fileCard?.attach(box, (target) => {
      const item = target.closest('.bm-item');
      if (!item || !box.contains(item)) return null;
      const group = item.closest('.sm-book'),
        book = group ? ctx.books.get(group.dataset.book) : ctx.current,
        bm = book?.bookmarks?.find((b) => b.id === item.dataset.id),
        end = !!bm?.end && !!target.closest('.bm-sub'),
        m = end ? bm.end : bm;
      if (!isMedia(m)) return null;
      const page = book.pages.find((p) => p.name === m.name);
      return page ? { el: item, book, page, mark: { id: bm.id, end } } : null;
    });
  }
  // 缩略图按视口形状截取；显示时把比例限制在 3:4 ~ 4:3，避免窄窗口或宽屏下变成长条（居中裁切，书签位置仍在中央）。
  const ratio = () => String(Math.min(4 / 3, Math.max(3 / 4, main.clientWidth / Math.max(1, main.clientHeight))));
  Object.assign(S, { tile, sub, face, named, spotOf, cards, ratio });
}
