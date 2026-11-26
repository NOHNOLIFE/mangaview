import { isMedia } from './list.mjs';
// 书签列表项的绘制（书签面板与书架书签栏共用）：缩略图格子（画面、类型角标、区段标记、名称）、区段的起点 / 终点两项、成对高亮、显示比例。
export function install(ctx, S) {
  const { main, t, make, icon } = ctx;
  // 格子里的内容（书签列表、全屏书架书签、设置封面共用）：画面或媒体占位、媒体的类型角标与时间点、区段的起点 / 终点标记、名称。
  // holder 为格子，img 为其中的 <img>，end：区段的终点那一项。
  function face(holder, img, book, x, end = false) {
    S.paint(holder, img, book, x, end);
    if (isMedia(end ? x.bm.end : x.bm)) holder.append(S.mediaBadge(book, x, end));
    if (x.bm.end) holder.append(markIcon(end ? 'end' : 'start'));
    named(holder, book, x.bm);
  }
  // 名称叠在缩略图下沿（读屏已在 aria-label 里）：媒体书签都有名称；图片书签只在改过名时显示。改名后原地更新。
  function named(holder, book, bm) {
    const text = S.name(book, bm);
    let el = holder.querySelector(':scope>.bm-name');
    holder.classList.toggle('named', !!text);
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = make('span', 'bm-name');
      el.setAttribute('aria-hidden', 'true');
      holder.append(el);
    }
    el.textContent = text;
  }
  // 区段书签的起点和终点是前后紧挨的两项，大小相同；终点（end）点击跳到终点，删除按钮只删终点（起点变回普通书签）。
  // 区段暂不生效时终点变灰（.off），仍可删除。页已不存在的项（.gone）不能跳转。
  function tile(book, x, withBook = false, end = false) {
    const gone = (end ? x.e : x.i) < 0,
      item = make(
        'div',
        'bm-item' +
          (gone ? ' gone' : '') +
          (x.bm.end ? (end ? ' sec-end' : ' sec-start') : '') +
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
    if (name) item.title = name;
    img.alt = '';
    img.draggable = false;
    thumb.append(img);
    face(thumb, img, book, x, end);
    item.append(
      thumb,
      ctx.iconButton('pencil', t('bmRename'), () => S.editItem(item), 'bm-ren'),
      ctx.iconButton(
        'close',
        t(end ? 'secDelete' : 'bmDelete'),
        () => (end ? S.dropEnd : S.drop)(book, x.bm),
        'bm-del',
      ),
    );
    return item;
  }
  const tiles = (book, x, withBook = false) =>
    x.bm.end ? [tile(book, x, withBook), tile(book, x, withBook, true)] : [tile(book, x, withBook)];
  const markIcon = (kind) => {
    const el = make('span', 'bm-mk ' + kind);
    el.append(icon(kind === 'start' ? 'bm-start' : 'bm-end'));
    return el;
  };
  // 成对高亮：悬停或聚焦区段的起点或终点，两项一起高亮（.mate）。box 为列表容器，sel 为项的选择器。返回 set(项)，供键盘选中时调用。
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
  // 缩略图按视口形状截取；显示时把比例限制在 3:4 ~ 4:3，避免窄窗口或宽屏下变成长条（居中裁切，书签位置仍在中央）。
  const ratio = () => String(Math.min(4 / 3, Math.max(3 / 4, main.clientWidth / Math.max(1, main.clientHeight))));
  Object.assign(S, { tile, tiles, face, named, mates, ratio });
}
