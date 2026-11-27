import { extend } from '../core/lang.mjs';
import { shownName } from '../core/model.mjs';
import { list, isMedia } from './list.mjs';
// 「选择起点」对话框：添加区段书签时（actions.mjs 的 addSection）列出可作起点的书签（core/sections.mjs 的 starts），按位置排序，默认选中最近的一个并滚到可见。
// 缩略图网格：方向键或点击改选，回车 / 「确定」确认（双击即确认），Esc / 「取消」取消。悬停只高亮、不改选（移向「确定」时不会经过别的书签而改掉选择）。
// 已有区段的起点带区段标记和虚线框，选中时底部写明「已有区段，将移动终点」。视频、音频书签悬停 / 聚焦时显示文件详情框（filecard.mjs）。终点在打开之前就已取好，媒体不因对话框暂停。
// 书签很多（几百个）时：格子固定比例，只为进入可见范围的格子画缩略图（IntersectionObserver），加载不引起重排；列表照常可以按住拖动滚动（ui/dragscroll.mjs）。
extend({
  spTitle: ['Choose the section start', '选择起点', '区間の始点を選択', '구간 시작점 선택'],
  spMoves: [
    'Already has a section — its end moves here',
    '已有区段，将移动终点',
    'すでに区間あり：終点をここへ移動',
    '이미 구간이 있음: 끝을 여기로 이동',
  ],
  spOk: ['OK', '确定', 'OK', '확인'],
});
export function install(ctx, S) {
  const { t, make } = ctx;
  const dialog = make('dialog', 'start-pick'),
    title = make('h2'),
    sub = make('span', 'stp-sub'),
    grid = make('div', 'stp-grid'),
    info = make('p', 'stp-info'),
    cancel = make('button', 'stp-cancel'),
    ok = make('button', 'stp-ok');
  title.id = 'spTitle';
  dialog.setAttribute('aria-labelledby', 'spTitle');
  grid.setAttribute('role', 'listbox');
  cancel.type = ok.type = 'button';
  const head = make('header'),
    heading = make('div', 'stp-title'),
    foot = make('div', 'stp-foot'),
    shut = ctx.iconButton('close', '', () => dialog.close());
  heading.append(title, sub);
  head.append(heading, shut);
  foot.append(info, cancel, ok);
  dialog.append(head, grid, foot);
  document.body.append(dialog);
  let items = [],
    sel = -1,
    done = null, // 打开期间：关闭时以选中的书签 id（或 null）结束等待
    chosen = null,
    book = null;
  // 只为进入可见范围（含上下各一屏余量）的格子画缩略图。
  const seen = new IntersectionObserver(
    (es) => {
      for (const e of es)
        if (e.isIntersecting) {
          seen.unobserve(e.target);
          const it = items[+e.target.dataset.k];
          if (it && !it.painted) {
            it.painted = true;
            S.face(it.thumb, it.img, book, it.x);
          }
        }
    },
    { root: grid, rootMargin: '100% 0px' },
  );
  function select(k, scroll = 'nearest') {
    if (!items.length) return;
    k = Math.max(0, Math.min(items.length - 1, k));
    items[sel]?.node.classList.remove('sel');
    items[sel]?.node.setAttribute('aria-selected', 'false');
    sel = k;
    const it = items[k];
    it.node.classList.add('sel');
    it.node.setAttribute('aria-selected', 'true');
    if (dialog.open) it.node.focus({ preventScroll: true });
    if (scroll) it.node.scrollIntoView({ block: scroll });
    info.textContent = info.title = label(it);
  }
  const label = (it) => S.where(book, it.x) + (it.moves ? ' · ' + t('spMoves') : '');
  // 打开：opts 为 core/sections.mjs 的 starts 结果（按位置排序）；p 为终点（actions.mjs 的 target），用来写副标题。返回所选起点书签的 id，取消为 null。
  function pick(b, opts, p) {
    if (dialog.open) return Promise.resolve(null);
    book = b;
    chosen = null;
    const byId = new Map(list(b).map((x) => [x.bm.id, x]));
    title.textContent = t('spTitle');
    sub.textContent = sub.title = p.player ? shownName(b.pages[p.i]) : ctx.title(b);
    shut.title = t('cancel');
    shut.setAttribute('aria-label', t('cancel'));
    cancel.textContent = t('cancel');
    ok.textContent = t('spOk');
    dialog.style.setProperty('--bm-ar', S.ratio());
    seen.disconnect();
    items = opts
      .map((o, k) => {
        const x = byId.get(o.id);
        if (!x) return null;
        const node = make('button', 'stp-item' + (o.moves ? ' moves' : '')),
          thumb = make('span', 'bm-thumb'),
          img = make('img');
        node.type = 'button';
        node.tabIndex = -1;
        node.setAttribute('role', 'option');
        img.alt = '';
        img.draggable = false;
        thumb.append(img);
        node.append(thumb);
        return { x, node, thumb, img, moves: o.moves, painted: false };
      })
      .filter(Boolean);
    // 视频、音频书签悬停 / 聚焦时显示文件详情框（filecard.mjs），不设提示。
    items.forEach((it, k) => {
      it.node.dataset.k = k;
      it.node.setAttribute('aria-label', label(it));
      if (!isMedia(it.x.bm)) it.node.title = label(it);
    });
    grid.replaceChildren(...items.map((it) => it.node));
    sel = -1;
    dialog.showModal();
    select(items.length - 1, 'center');
    for (const it of items) seen.observe(it.node);
    return new Promise((r) => (done = r));
  }
  function confirm() {
    if (sel < 0) return;
    chosen = items[sel].x.bm.id;
    dialog.close();
  }
  ok.onclick = confirm;
  cancel.onclick = () => dialog.close();
  grid.addEventListener('click', (e) => {
    const node = e.target.closest('.stp-item');
    if (node) select(+node.dataset.k, false);
  });
  ctx.fileCard?.attach(grid, (target) => {
    const node = target.closest('.stp-item'),
      it = node && items[+node.dataset.k];
    if (!it || !isMedia(it.x.bm) || it.x.i < 0) return null;
    return { el: node, book, page: book.pages[it.x.i], mark: { id: it.x.bm.id, end: false } };
  });
  grid.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.stp-item');
    if (!node) return;
    select(+node.dataset.k, false);
    confirm();
  });
  // 每行几格：按格子的上沿数第一行。
  const cols = () => {
    const top = items[0]?.node.offsetTop;
    let n = 0;
    while (n < items.length && items[n].node.offsetTop === top) n++;
    return Math.max(1, n);
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // 回车：在书签上（或对话框本身）即确认；按住不放的自动重复不算（长按 Shift+Enter 打开对话框时，回车还按着）。
    if (e.key === 'Enter') {
      if (e.target.closest('button') && !e.target.closest('.stp-item')) return; // 「取消」「确定」、关闭按钮照常
      e.preventDefault();
      if (!e.repeat) confirm();
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols(), ArrowDown: cols() }[e.key];
    if (step != null) {
      e.preventDefault();
      select(sel + step);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      select(e.key === 'Home' ? 0 : items.length - 1);
    }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // close 事件异步派发：期间已重新打开就不清理
    seen.disconnect();
    grid.replaceChildren();
    items = [];
    sel = -1;
    const r = done;
    done = null;
    r?.(chosen);
  });
  // 切书时取消（终点属于原来那本书）。
  ctx.on('select', () => {
    if (dialog.open && ctx.current !== book) dialog.close();
  });
  S.pickStart = pick;
}
