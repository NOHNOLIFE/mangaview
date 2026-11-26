// 书架界面：书架（在读列表）/ 书库（大量藏书）/ 全部 / 过期书籍；瀑布流纯封面、筛选与搜索预设、标签、批量移动与恢复。
// 本文件是书架的唯一入口：建立子模块共享的 S，按顺序装配各子模块，并负责重画（draw）、列表页签、布局切换与关闭处理。
// 子模块：sort 排序；covercache 封面与指纹的后台生成；filter 筛选状态（criteria 为纯逻辑）；layout 列表布局与焦点；card 卡片；
// actions 卡片上的操作按钮；bulk 批量操作；filterbar 筛选界面；presets 搜索预设；storage 存储空间；rename 书名；tags 标签；
// restore 恢复（pairing 为配对规则）。共用的小工具在 util.mjs。
import { extend } from '../core/lang.mjs';
import { addIcons } from '../ui/icons.mjs';
import { $ } from './util.mjs';
import { install as sorting } from './sort.mjs';
import { install as covers } from './covercache.mjs';
import { install as filter } from './filter.mjs';
import { install as layout } from './layout.mjs';
import { install as cards } from './card.mjs';
import { install as cardActions } from './actions.mjs';
import { install as bulk } from './bulk.mjs';
import { install as filterbar } from './filterbar.mjs';
import { install as presets } from './presets.mjs';
import { install as storage } from './storage.mjs';
import { install as rename } from './rename.mjs';
import { install as tags } from './tags.mjs';
import { install as restore } from './restore.mjs';

extend({
  layoutGrid: ['Grid', '普通网格', 'グリッド', '격자'],
  layoutMasonry: ['Masonry', '瀑布流', 'マソンリー', '메이슨리'],
  layoutSwitch: [
    'Layout: {now} — click for {next}',
    '布局：{now}（点击切换为{next}）',
    'レイアウト：{now}（クリックで{next}に切替）',
    '레이아웃: {now} (클릭하면 {next}(으)로 전환)',
  ],
});
export function install(ctx) {
  const { books, t, fmt, make, icon, safe, get, put, shelf } = ctx,
    holder = $('books');
  addIcons({
    photo:
      '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  }); // 类型筛选的「图片」；视频、音频沿用 media.mjs 的 film / music
  addIcons({
    'layout-grid':
      '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    'layout-masonry':
      '<rect x="4" y="4" width="7" height="10" rx="1.5"/><rect x="13" y="4" width="7" height="6" rx="1.5"/><rect x="4" y="16" width="7" height="4" rx="1.5"/><rect x="13" y="12" width="7" height="8" rx="1.5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  });
  // 布局、筛选面板展开状态和当前筛选条件随「还原默认设置」重置；预设（shelfPresets）和最近用过的标签（recentTags）是用户数据，保留。
  ctx.prefs.add('shelfLayout');
  ctx.prefs.add('shelfPanel');
  ctx.prefs.add('shelfFilter');
  // S：子模块之间共享的状态与函数。状态：view 当前列表、shown 显示中的书、activeId 选中的卡片、layoutMode 布局、
  // F 筛选条件、presets / presetId 预设；函数由各子模块安装时登记（S.draw 等），子模块之间经 S 互相调用。
  const S = { draw };
  S.view = get('shelfView', 'shelf');
  if (!['shelf', 'library', 'all'].includes(S.view)) S.view = 'shelf';
  sorting(ctx, S);
  covers(ctx, S);
  filter(ctx, S);
  layout(ctx, S);
  cards(ctx, S);
  cardActions(ctx, S);
  const { grid, empty, nodes } = S;
  let opened = false,
    introTimer = 0;
  const checkStorage = (...a) => S.checkStorage(...a);
  const filtered = (...a) => S.filtered(...a);
  const filtering = (...a) => S.filtering(...a);
  const drawFilterUI = (...a) => S.drawFilterUI(...a);
  const drawBulk = (...a) => S.drawBulk(...a);
  const clearFilters = (...a) => S.clearFilters(...a);
  const mark = (...a) => S.mark(...a);
  const drawSortBtn = (...a) => S.drawSortBtn(...a);
  const place = (...a) => S.place(...a);
  const setActive = (...a) => S.setActive(...a);
  const flushFilter = (...a) => S.flushFilter(...a);

  // ---- 绘制。reason：open 打开书架（焦点落在当前书并居中）；view 切换列表；filter 改筛选（回到第一本）；sort 改排序；
  // update（默认，外部调用）数据变化后增量更新：保留滚动位置和焦点，被删的书由相邻的书接替焦点。
  function draw(reason = 'update') {
    if (!opened) {
      if (!shelf.open) return;
      opened = true;
      reason = 'open';
      safe(checkStorage)();
    }
    const counts = { shelf: 0, library: 0, all: 0, expired: 0 };
    for (const b of books.values()) {
      if (ctx.expired(b)) counts.expired++;
      else {
        counts.all++;
        counts[b.place === 'library' ? 'library' : 'shelf']++;
      }
    }
    if (S.view === 'expired' && !counts.expired) S.view = 'shelf';
    for (const tab of $('views').querySelectorAll('[data-view]')) {
      const v = tab.dataset.view;
      tab.setAttribute('aria-selected', String(v === S.view));
      tab.tabIndex = v === S.view ? 0 : -1;
      tab.querySelector('.count').textContent = counts[v] || '';
      if (v === 'expired') tab.hidden = !counts.expired;
    }
    const before = S.shown,
      oldIndex = before.findIndex((b) => b.id === S.activeId),
      hadFocus = holder.contains(document.activeElement) || document.activeElement === document.body;
    S.shown = filtered();
    // 筛选结果数显示在搜索框内右侧（叠加显示，不占工具条宽度）。
    $('shelfCount').textContent = filtering() ? S.shown.length + ' / ' + counts[S.view] : '';
    $('expiredHint').hidden = S.view !== 'expired';
    drawFilterUI();
    drawBulk(counts);
    for (const [id, el] of nodes)
      if (!books.has(id)) {
        el.remove();
        nodes.delete(id);
      }
    empty.hidden = !!S.shown.length;
    if (!S.shown.length) {
      const filteredOut = counts[S.view] > 0;
      empty.replaceChildren(
        icon('book-open'),
        make(
          'p',
          '',
          t(filteredOut ? 'noBooks' : ({ library: 'emptyLibrary', expired: 'emptyExpired' }[S.view] ?? 'emptyShelf')),
        ),
      );
      if (filteredOut && filtering()) {
        const c = make('button', '', t('clearFilters'));
        c.type = 'button';
        c.onclick = () => clearFilters();
        empty.append(c);
      }
    }
    const ids = new Set(S.shown.map((b) => b.id)),
      cur = ctx.current && ids.has(ctx.current.id) ? ctx.current.id : null;
    let target = S.activeId,
      scroll = null,
      focus = false;
    if (reason === 'open') {
      target = cur ?? S.shown[0]?.id;
      scroll = cur ? 'center' : null;
      focus = true;
      holder.scrollTop = 0;
    } else if (reason === 'view') {
      target = cur ?? S.shown[0]?.id;
      scroll = cur ? 'center' : null;
      holder.scrollTop = 0;
    } else if (reason === 'filter') {
      target = S.shown[0]?.id;
      holder.scrollTop = 0;
    } else if (reason === 'sort' || reason === 'layout') {
      if (!ids.has(target)) target = S.shown[0]?.id;
      scroll = 'center';
    } else if (!ids.has(target)) {
      target = S.shown[Math.min(Math.max(oldIndex, 0), S.shown.length - 1)]?.id;
      scroll = 'nearest';
      focus = hadFocus;
    }
    if (reason === 'open') {
      grid.classList.add('intro');
      clearTimeout(introTimer);
      introTimer = setTimeout(() => grid.classList.remove('intro'), 900);
    }
    const was = nodes.get(S.activeId);
    S.activeId = target ?? null;
    if (was && was.dataset.id !== S.activeId) mark(was, false);
    drawLayoutBtn();
    drawSortBtn();
    place((reason === 'update' || reason === 'layout') && before.length > 0);
    setActive(S.activeId, { focus, scroll });
  }
  bulk(ctx, S);
  // 布局切换按钮：图标表示当前布局，提示文字说明点击后切换到哪种。
  function drawLayoutBtn() {
    const btn = $('layoutBtn'),
      now = t(S.layoutMode === 'grid' ? 'layoutGrid' : 'layoutMasonry'),
      next = t(S.layoutMode === 'grid' ? 'layoutMasonry' : 'layoutGrid');
    btn.replaceChildren(icon(S.layoutMode === 'grid' ? 'layout-grid' : 'layout-masonry'));
    btn.title = fmt('layoutSwitch', { now, next });
    btn.setAttribute('aria-label', btn.title);
    btn.dataset.mode = S.layoutMode;
  }
  $('layoutBtn').onclick = () => {
    S.layoutMode = S.layoutMode === 'grid' ? 'masonry' : 'grid';
    put('shelfLayout', S.layoutMode);
    draw('layout');
  };
  // 再点一次已激活的列表页签：关闭书架，回到阅读界面。
  $('views').onclick = (e) => {
    const tab = e.target.closest('[data-view]');
    if (!tab) return;
    if (tab.dataset.view === S.view) {
      shelf.close();
      return;
    }
    S.view = tab.dataset.view;
    if (S.view !== 'expired') put('shelfView', S.view);
    draw('view');
  };
  $('views').onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...$('views').querySelectorAll('[data-view]:not([hidden])')],
      i = tabs.findIndex((x) => x.dataset.view === S.view);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (next.dataset.view !== S.view) next.click();
    next.focus();
  };
  filterbar(ctx, S);
  presets(ctx, S);
  // close 事件异步派发：关闭后立刻重新打开时，迟到的事件不能清空新画好的列表。
  shelf.addEventListener('close', () => {
    flushFilter();
    if (!shelf.open) {
      opened = false;
      grid.classList.remove('intro');
    }
  });
  // close 事件是异步的：关闭后立刻再按 B 打开时它还没到，这里用属性变化（微任务）及时记下“已关闭”，下次绘制按“打开”处理。
  new MutationObserver(() => {
    if (!shelf.open) opened = false;
  }).observe(shelf, { attributes: true, attributeFilter: ['open'] });
  ctx.drawShelf = draw;
  ctx.shelfView = () => S.view;
  ctx.clearFilters = clearFilters;
  ctx.actions.copy = () => ctx.copy(filtered().map(ctx.title).join('\n'));

  storage(ctx, S);
  rename(ctx, S);
  tags(ctx, S);
  restore(ctx, S);
}
