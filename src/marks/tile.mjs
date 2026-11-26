import { isMedia } from './list.mjs';
// 书签列表项的绘制（右键书签面板与书架书签列表共用）：缩略图格子、区段书签的小图、成对标记、显示比例。
export function install(ctx, S) {
  const { main, t, make, icon } = ctx;
  // 书签缩略图格子：右键面板与书架书签列表共用。
  // 紧凑显示：只有缩略图，不显示文件名、书名和页码文字；页码（及书名）只放进 aria-label 给读屏。
  // 带区段书签的书签显示为一组：起点缩略图（带起点标记）加左下角一张较小的区段书签缩略图（带区段书签标记、自己的删除按钮），点哪张跳到哪里。
  // 悬停任意一张，两张一起高亮。区段暂不生效时小图变灰，仍可删除。
  function tile(book, x, withBook = false) {
    const item = make('div', 'bm-item' + (x.i < 0 ? ' gone' : '')),
      thumb = make('span', 'bm-thumb'),
      img = make('img');
    const label = S.where(book, x);
    item.dataset.id = x.bm.id;
    item.setAttribute(
      'aria-label',
      (withBook ? ctx.title(book) + ' · ' + label : label) + (x.bm.end ? ' · ' + t('secStart') : ''),
    );
    img.alt = '';
    img.draggable = false;
    thumb.append(img);
    if (typeof x.bm.label === 'string' && x.bm.label) item.title = x.bm.label;
    S.paint(thumb, img, book, x);
    if (isMedia(x.bm)) thumb.append(S.mediaBadge(book, x));
    item.append(
      thumb,
      ctx.iconButton('close', t('bmDelete'), () => S.drop(book, x.bm), 'bm-del'),
    );
    if (x.bm.end) {
      item.classList.add('paired');
      thumb.append(markIcon('start'));
      const sub = make('span', 'bm-sub' + (x.live ? '' : ' off')),
        simg = make('img');
      simg.alt = '';
      simg.draggable = false;
      sub.setAttribute('aria-label', t('secEnd') + ' · ' + S.where(book, x, true));
      sub.setAttribute('role', 'button');
      sub.append(simg);
      S.paint(sub, simg, book, x, true);
      sub.append(
        markIcon('end'),
        ctx.iconButton('close', t('secDelete'), () => S.dropEnd(book, x.bm), 'bm-sub-del'),
      );
      item.append(sub);
    }
    return item;
  }
  const markIcon = (kind) => {
    const el = make('span', 'bm-mk ' + kind);
    el.append(icon(kind === 'start' ? 'bm-start' : 'bm-end'));
    return el;
  };
  // 缩略图按视口形状截取；显示时把比例限制在 3:4 ~ 4:3，避免窄窗口或宽屏下变成长条（居中裁切，书签位置仍在中央）。
  const ratio = () => String(Math.min(4 / 3, Math.max(3 / 4, main.clientWidth / Math.max(1, main.clientHeight))));
  S.tile = tile;
  S.ratio = ratio;
}
