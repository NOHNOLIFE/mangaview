import { extend } from '../core/lang.mjs';
import { list, isMedia, key, endKey, mediaRanges, pageMarks, sig, spans } from './list.mjs';
import { install as names } from './names.mjs';
import { install as tiles } from './tile.mjs';
import { install as rename } from './rename.mjs';
import { install as snaps } from './snap.mjs';
import { install as panel } from './panel.mjs';
import { install as actions } from './actions.mjs';
import { install as dock } from './dock.mjs';
import { install as playerMarks } from '../media/marks.mjs';
import { install as pageMarkers } from './pagemarks.mjs';
import { addIcons } from '../ui/icons.mjs';
// 书签：book.bookmarks=[{id,name,f,at,end?}]，按页名定位，重新排序后仍有效。缩略图存在 thumbs store 的 `${book.id}:bm:${id}`。
// 媒体（视频、音频）书签记录时间点而不是页内位置：{id,name,t(秒，毫秒精度),at,label,named?,pbfName?,from?,end?}。
// 名称（names.mjs）：label 为完整的名称字符串，媒体书签都有，图片书签只在手动改名后有；named：手动改过；pbfName：.pbf 里的原名（pbf.mjs）。
// end：区段书签（终点，见 sections.mjs），记录的内容与书签相同 {name,f|t,at}，缩略图键为 `${book.id}:bm:${id}:end`；它不是独立的书签，
// 不计数、不是 F / Enter 的停靠点；列表里紧跟在起点后面单独显示一项（tile.mjs）。配对只在同一坐标系里：图片为「页序 + 页内位置」（可跨页），每个媒体文件各自按时间。
// 本文件是书签功能的入口：文案、图标、按顺序安装各子模块（共享对象 S 上登记彼此要用的函数与状态），登记跨子模块的事件，对外提供 ctx.marks。
extend({
  bmAdd: ['Add bookmark', '添加书签', 'しおりを追加', '책갈피 추가'],
  bmHold: ['Hold', '长按', '長押し', '길게'],
  bmEmpty: ['No bookmarks yet', '还没有书签', 'しおりはまだありません', '아직 책갈피가 없습니다'],
  bmNone: [
    'No bookmarks yet — hold F or Enter to add one',
    '还没有书签，长按 F 或 Enter 添加',
    'しおりはまだありません。F か Enter を長押しで追加',
    '아직 책갈피가 없습니다. F 또는 Enter를 길게 눌러 추가하세요',
  ],
  bmAllGone: [
    'The bookmarked files no longer exist',
    '书签所在的文件都已不存在',
    'しおりのファイルが見つかりません',
    '책갈피한 파일이 더 이상 없습니다',
  ],
  bmAdded: ['Bookmark added', '已添加书签', 'しおりを追加しました', '책갈피를 추가했습니다'],
  bmExists: [
    'There is already a bookmark here',
    '这里已有书签',
    'ここにはすでにしおりがあります',
    '여기에 이미 책갈피가 있습니다',
  ],
  bmKeep: ['Keep holding to add a bookmark', '继续按住添加书签', '押し続けるとしおりを追加', '계속 누르면 책갈피 추가'],
  bmN: ['Bookmark {n} / {m}', '书签 {n} / {m}', 'しおり {n} / {m}', '책갈피 {n} / {m}'],
  bmWrap: [
    'Back to the first bookmark',
    '已回到第一个书签',
    '最初のしおりに戻りました',
    '첫 번째 책갈피로 돌아왔습니다',
  ],
  bmWrapBack: [
    'Back to the last bookmark',
    '已回到最后一个书签',
    '最後のしおりに戻りました',
    '마지막 책갈피로 돌아왔습니다',
  ],
  bmPage: ['Page {n}', '第 {n} 页', '{n} ページ目', '{n}페이지'],
  bmGone: ['File missing', '文件已不存在', 'ファイルなし', '파일 없음'],
  bmDelete: ['Delete bookmark', '删除书签', 'しおりを削除', '책갈피 삭제'],
  secAdd: ['Add section bookmark', '添加区段书签', '区間しおりを追加', '구간 책갈피 추가'],
  secKeep: [
    'Keep holding to add a section bookmark',
    '继续按住添加区段书签',
    '押し続けると区間しおりを追加',
    '계속 누르면 구간 책갈피 추가',
  ],
  secAdded: ['Section bookmark added', '已添加区段书签', '区間しおりを追加しました', '구간 책갈피를 추가했습니다'],
  secUpdated: ['Section end updated', '已更新区段书签', '区間しおりを更新しました', '구간 책갈피를 업데이트했습니다'],
  secNone: [
    'No bookmark before this point to pair with — add a bookmark first',
    '前面没有可配对的书签，请先添加书签',
    'この位置より前に組になるしおりがありません。先にしおりを追加してください',
    '앞쪽에 짝지을 책갈피가 없습니다. 먼저 책갈피를 추가하세요',
  ],
  secDelete: ['Delete section bookmark', '删除区段书签', '区間しおりを削除', '구간 책갈피 삭제'],
  secStart: ['Section start', '区段起点', '区間の始点', '구간 시작'],
  secEnd: ['Section bookmark', '区段书签', '区間しおり', '구간 책갈피'],
  smEmpty: [
    'No bookmarks in the current list yet — hold F or Enter while reading to add one',
    '当前列表里还没有书签，阅读时长按 F 或 Enter 添加',
    '現在のリストにしおりはまだありません。読書中に F か Enter を長押しで追加',
    '현재 목록에 아직 책갈피가 없습니다. 읽는 중에 F 또는 Enter를 길게 눌러 추가하세요',
  ],
  smFiltered: [
    'No bookmarks in the current shelf filter results — clear or change the filters',
    '当前书架筛选结果中没有书签，可清除或更换筛选条件',
    '本棚の絞り込み結果にしおりはありません。絞り込みを解除するか変更してください',
    '현재 책장 필터 결과에 책갈피가 없습니다. 필터를 지우거나 바꿔 보세요',
  ],
  smOpenLabel: ['Full screen', '全屏书签', '全画面で表示', '전체 화면'],
  smEdgeLeft: [
    'Show shelf bookmarks at the left edge (when not pinned)',
    '书架书签未常驻时，鼠标移到左缘弹出',
    '本棚のしおりを固定していないとき、左端で表示',
    '책장 책갈피를 고정하지 않았을 때 왼쪽 가장자리에서 표시',
  ],
  smWidth: ['Bookmark list width', '书签列表宽度', 'しおり一覧の幅', '책갈피 목록 너비'],
});
export function install(ctx) {
  const mark = 'M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z';
  // 成对标记：起点是书签标记里一个向后的箭头，区段书签是向前的箭头，一头一尾互相呼应（缩略图栏的页内细标记是一对方括号，见 bookmarks.css）。
  addIcons({
    bookmark: `<path d="${mark}"/>`,
    'bookmark-plus': `<path d="${mark}"/><path d="M12 7v6M9 10h6"/>`,
    'bm-start': `<path d="${mark}"/><path d="M10 7.5l4.5 3-4.5 3z" fill="currentColor"/>`,
    'bm-end': `<path d="${mark}"/><path d="M14 7.5l-4.5 3 4.5 3z" fill="currentColor"/>`,
  });
  const S = {}; // 子模块之间共享的函数与状态，各子模块在安装时登记自己的成员（S.last：最近一次跳到的书签，见 actions.mjs）
  names(ctx, S);
  tiles(ctx, S);
  rename(ctx, S);
  snaps(ctx, S);
  panel(ctx, S);
  actions(ctx, S);
  ctx.on('select', () => {
    S.cancel();
    S.close();
    if (S.last?.book !== ctx.current) S.last = null;
    S.renderDock();
    S.reveal();
  });
  ctx.on('lang', () => {
    if (!S.panel.hidden) S.render();
    S.renderDock();
    for (const p of ctx.player?.list() ?? []) {
      p.marks._sig = null;
      S.drawPlayer(p);
    }
  });
  // 别的窗口改了书签或存好了书签缩略图（windows.mjs）：书架书签列表随 'books' 更新，这里补上打开着的书签面板。
  ctx.on('synced', (book) => {
    if (book === ctx.current && !S.panel.hidden) S.render();
  });
  ctx.on('thumbs', (keys) => {
    if (!keys.some((k) => k.includes(':bm:'))) return;
    if (!S.panel.hidden) S.render();
    S.renderDock();
  });

  dock(ctx, S);
  playerMarks(ctx, S);
  pageMarkers(ctx, S);
  // ranges(book,page)：一个媒体内生效的区段（秒）；face / named / where / name：书签格子的内容、名称、位置说明、名称文字（全屏书架书签、设置封面共用）。
  // edit(item,book,bm,after)：就地重命名（rename.mjs）；mates(box,sel)：区段两项的成对高亮。
  // changed(book)：书签在别处（如 .pbf 导入，pbf.mjs）增改后，更新面板、书架书签列表和其他界面。
  ctx.marks = {
    list,
    pages: pageMarks,
    sig,
    badge: S.badge,
    spans,
    thumbKey: key,
    endKey,
    isMedia,
    mediaRanges,
    ranges: (book, page) => mediaRanges(book).get(page.name) ?? [],
    face: S.face,
    named: S.named,
    mates: S.mates,
    where: S.where,
    name: S.name,
    ensure: S.ensure,
    edit: S.edit,
    changed: S.changed,
  };
}
