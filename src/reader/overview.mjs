import { extend } from '../core/lang.mjs';
import { install as sheets } from './overview-sheet.mjs';
import { install as pages } from './overview-pages.mjs';
import { install as shelfmarks } from './overview-marks.mjs';
import { addIcons } from '../ui/icons.mjs';
// 全屏总览：
// · 全屏缩略图：缩略图栏顶部的按钮，或快捷键 V / ]。整本书的页面排成规整网格（默认）或瀑布流，只为可见范围创建元素；
//   缩略图与缩略图栏共用会话内存缓存（thumbs.mjs），再次打开、切书后回来都不必重读原图。
// · 全屏书架书签：书架书签列表顶部的按钮，或快捷键 C / [。书架上各书的书签按书分组。
// 标题行的按钮在“网格 / 瀑布流”间切换，两个全屏界面共用一个偏好（mv2:ovLayout）。
// 面板里 WASD / 方向键按网格行列（瀑布流按列）移动选中；鼠标移到哪格就选中哪格，悬停与键盘共用同一个选中样式（缩小 + 描边，不遮挡相邻格）。
// 空格 / Enter 或点击跳过去并关闭。
// 标题行的搜索框：输入即过滤，键盘选择只在结果内移动；打开时焦点仍在列表上，/ 或 Ctrl+F 聚焦搜索框，搜索框内 Esc 先清空并回到列表。
// 搜索框旁的「图片 / 视频 / 音频」开关按页（书签所在页）的类型过滤，可多选，全不选等于不限；没有结果时的一键清除连同类型一起清除。
// 搜索词和类型只在本次打开期间有效，关闭即清空，不影响上一本 / 下一本和书签跳转。
// 标题行的书架按钮（或 B）在上层打开书架，全屏界面留在下面：书架里切书时全屏缩略图跟着换成新书，关闭书架后回到全屏界面（全屏书签按书架的最新状态重排）。
// 本文件是入口：文案、图标、按顺序装配面板外壳（overview-sheet.mjs）、全屏缩略图（overview-pages.mjs）、全屏书架书签（overview-marks.mjs），以及缩略图栏顶部的打开按钮。
extend({
  ovOpen: ['Full-screen thumbnails (V)', '全屏缩略图（V）', '全画面サムネイル（V）', '전체 화면 미리보기 (V)'],
  smOvOpen: [
    'Full-screen shelf bookmarks (C)',
    '全屏书架书签（C）',
    '全画面の本棚しおり（C）',
    '전체 화면 책장 책갈피 (C)',
  ],
  ovGrid: [
    'Layout: grid (click for masonry)',
    '布局：网格（点击切换为瀑布流）',
    'レイアウト：グリッド（クリックでメイソンリー）',
    '레이아웃: 격자 (클릭하면 메이슨리)',
  ],
  ovMasonry: [
    'Layout: masonry (click for grid)',
    '布局：瀑布流（点击切换为网格）',
    'レイアウト：メイソンリー（クリックでグリッド）',
    '레이아웃: 메이슨리 (클릭하면 격자)',
  ],
  pvOpenLabel: ['Full screen', '全屏缩略图', '全画面で表示', '전체 화면'],
  ovPos: ['Page {n} / {m}', '第 {n} / {m} 页', '{n} / {m} ページ', '{n} / {m} 페이지'],
  ovShelf: ['Bookshelf (B)', '书架（B）', '本棚（B）', '책장 (B)'],
  ovFindPages: ['Search file names', '搜索文件名', 'ファイル名を検索', '파일 이름 검색'],
  ovFindMarks: [
    'Search titles, file names',
    '搜索作品名、文件名',
    '作品名・ファイル名を検索',
    '작품명, 파일 이름 검색',
  ],
  ovNoMatch: ['No matching items', '没有匹配的项', '一致する項目はありません', '일치하는 항목 없음'],
  ovClear: ['Clear search', '清除搜索', '検索をクリア', '검색 지우기'],
  ovHint: [
    'WASD / arrows: choose · Space / Enter: open · {key} / Esc: close',
    'WASD / 方向键选择 · 空格 / Enter 打开 · {key} / Esc 关闭',
    'WASD / 矢印で選択 · Space / Enter で開く · {key} / Esc で閉じる',
    'WASD / 화살표로 선택 · Space / Enter로 열기 · {key} / Esc로 닫기',
  ],
});
// 侧栏顶部“打开全屏”按钮的图标（2×2 网格）；模块加载时就放进 sprite，书签列表安装时即可引用。
addIcons({
  overview:
    '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  masonry:
    '<rect x="3" y="3" width="7.5" height="10" rx="1.5"/><rect x="3" y="16" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.5"/>',
});
export function install(ctx) {
  const { t, make } = ctx;
  ctx.dropKey('overview');
  ctx.dropKey('smOverview'); // 旧版“鼠标移入上角打开”的两个开关已移除
  ctx.prefs.add('ovLayout');
  const kit = sheets(ctx);
  const thumbs = pages(ctx, kit);
  const shelfSheet = shelfmarks(ctx, kit);

  // ---- 缩略图栏顶部：占满整行的块状“全屏缩略图”按钮（图标、文字、页数；书架书签列表的同款按钮见 bookmarks.mjs，两侧镜像、等高）----
  // 浮动弹出和常驻时都可用；浮动时点开后先收起窄条。
  const panel = document.getElementById('panel'),
    pvHead = make('div', 'side-head pv-head'),
    pvName = make('span', 'side-title'),
    pvCount = make('span', 'count');
  const pvOpen = ctx.iconButton(
    'overview',
    '',
    () => {
      if (thumbs.open() && !document.body.classList.contains('docked')) ctx.fade(panel, false);
    },
    'side-open',
  );
  pvOpen.append(pvName, pvCount);
  pvHead.append(pvOpen);
  panel.prepend(pvHead);
  function pvSync() {
    pvName.textContent = t('pvOpenLabel');
    pvCount.textContent = ctx.current?.pages.length || '';
    pvOpen.title = t('ovOpen');
    pvOpen.setAttribute('aria-label', t('ovOpen'));
  }
  pvSync();
  ctx.on('select', pvSync);
  ctx.on('books', pvSync);
  ctx.on('lang', pvSync);
  ctx.overview = { thumbs, shelfmarks: shelfSheet };
}
