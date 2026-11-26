import { list } from './list.mjs';
// 书签面板（右键或快捷键呼出）：添加书签 / 区段书签的按钮和当前书的书签列表，点击跳转。
export function install(ctx, S) {
  const { main, t, make, icon } = ctx;
  // 面板：右键呼出，“添加书签”按钮正好在鼠标下；点击缩略图才跳转并关闭，点面板外或 Esc 关闭（位置不变）。
  const panel = make('div', 'bm-panel'),
    addBtn = make('button', 'bm-add'),
    secBtn = make('button', 'bm-add bm-sec'),
    head = make('div', 'bm-head'),
    grid = make('div', 'bm-grid');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  addBtn.type = secBtn.type = 'button';
  panel.append(addBtn, secBtn, head, grid);
  document.body.append(panel);
  S.mates(grid);
  function render() {
    const book = ctx.current;
    if (!book) return;
    if (S.editing(grid)) return S.later(render); // 正在就地改名：改完再重画
    panel.setAttribute('aria-label', t('bookmarks'));
    const keys = make('span', 'bm-keys', t('bmHold'));
    keys.append(make('kbd', '', 'F'), '/', make('kbd', '', 'Enter'));
    addBtn.replaceChildren(icon('bookmark-plus'), make('span', 'label', t('bmAdd')), keys);
    const secKeys = make('span', 'bm-keys', t('bmHold'));
    secKeys.append(make('kbd', '', 'Shift'), '+', make('kbd', '', 'F'), '/', make('kbd', '', 'Enter'));
    secBtn.replaceChildren(icon('bm-start'), make('span', 'label', t('secAdd')), secKeys);
    const items = list(book);
    head.replaceChildren(make('span', '', t('bookmarks')), make('span', 'count', items.length || ''));
    if (!items.length) {
      grid.replaceChildren(make('p', 'bm-empty', t('bmEmpty')));
      return;
    }
    grid.replaceChildren(...items.flatMap((x) => S.tiles(book, x)));
    markPanel();
  }
  // 面板里离阅读视窗最近的书签（与书架书签列表的 .active 相同）；面板开着时随阅读滚动更新。
  function markPanel() {
    const id = ctx.current && S.nearest(ctx.current);
    for (const el of grid.querySelectorAll('.bm-item'))
      el.classList.toggle('active', el.dataset.id === id && !('end' in el.dataset));
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function open(x, y) {
    if (!ctx.current) return;
    panel.style.setProperty('--bm-ar', S.ratio());
    render();
    panel.style.left = panel.style.top = '0px';
    panel.hidden = false;
    // 用布局尺寸而非 getBoundingClientRect：弹出动画的缩放会让后者偏几像素。
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    let left, top;
    if (x == null) {
      const m = main.getBoundingClientRect();
      left = m.left + (m.width - w) / 2;
      top = m.top + Math.max(0, (m.height - h) / 2.6);
    } else {
      left = x - panel.clientLeft - addBtn.offsetLeft - addBtn.offsetWidth / 2;
      top = y - panel.clientTop - addBtn.offsetTop - addBtn.offsetHeight / 2;
    }
    panel.style.left = clamp(left, 8, innerWidth - w - 8) + 'px';
    panel.style.top = clamp(top, 8, innerHeight - h - 8) + 'px';
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    if (document.activeElement && panel.contains(document.activeElement)) main.focus();
  }
  main.addEventListener('contextmenu', (e) => {
    if (!ctx.current) return;
    e.preventDefault();
    open(e.clientX, e.clientY);
  });
  panel.addEventListener('contextmenu', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    if (e.target.closest('.bm-del,.bm-ren,.bm-edit')) return;
    if (e.target.closest('.bm-sec')) {
      ctx.safe(S.addSection)();
      main.focus();
      return;
    }
    if (e.target.closest('.bm-add')) {
      ctx.safe(S.add)();
      main.focus();
      return;
    }
    const item = e.target.closest('.bm-item');
    if (!item || item.classList.contains('gone')) return;
    S.jumpTo(item.dataset.id, 'end' in item.dataset);
    close();
    main.focus();
  });
  // 点面板外关闭；点在正文上时这一下只用来关闭面板，不再翻屏。
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (panel.hidden || panel.contains(e.target)) return;
      close();
      if (main.contains(e.target)) e.stopPropagation();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (!panel.hidden && e.key === 'Escape' && !S.editing(panel)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    },
    true,
  );
  ctx.actions.bookmarks = () => {
    if (!panel.hidden) close();
    else open(null, null);
  };
  Object.assign(S, { panel, render, markPanel, close });
}
