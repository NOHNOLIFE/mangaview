// 启动装配：建立 ctx（各模块共用的上下文），按顺序安装各模块，载入书目并打开上次读的书。
// 书目与保存、阅读位置、导入、刷新、键鼠输入等都在各自的模块里，这里不放功能代码。
import { languageList } from './core/lang.mjs';
import { natural } from './core/model.mjs';
import { library, thumbs } from './core/store.mjs';
import { snap } from './core/merge.mjs';
import { popoutTarget } from './core/playlist.mjs';
import { source, mergeKeys, down, isLive, isLoose } from './core/sources.mjs';
import { t, fmt, title, lang, langPref } from './core/locale.mjs';
import { listeners, emit } from './core/events.mjs';
import { normalize } from './core/normalize.mjs';
import { expired, looseLost, lostSources, probeAll } from './core/status.mjs';
import { prefs, prefix, get, put, dropKey, resetPrefs } from './core/prefs.mjs';
import { books, bases, persist, pull, joinLoose } from './core/books.mjs';
import { $, main, shelf, make, icon, iconButton, safe, notice, fade, showing, copy, holdRing } from './ui/dom.mjs';
import { getThumb, saveThumb, makeThumb, dropThumbs, installFrames } from './reader/thumbs.mjs';
import { current, view, createView, select, step, readingList, readRatio, flush } from './reader/session.mjs';
import { localize, toolsState, updateProgress, accessState, setLang, markProbed } from './reader/shell.mjs';
import { actions } from './reader/actions.mjs';
import { showBar, bindBar } from './reader/toolbar.mjs';
import { toStart, toEnd, atStart, atEnd } from './reader/tap.mjs';
import { relink, relinkAll, rebuild } from './shelf/relink.mjs';
import { relocate } from './shelf/pick.mjs';
import { refreshAll } from './shelf/refresh.mjs';
import { discard, remove } from './shelf/remove.mjs';
import { install as prefsSync } from './core/prefs.mjs';
import { install as bookStore } from './core/books.mjs';
import { install as session } from './reader/session.mjs';
import { install as readerShell } from './reader/shell.mjs';
import { install as pageSort } from './reader/sort.mjs';
import { install as sidePanel } from './reader/panel.mjs';
import { install as importer } from './shelf/import.mjs';
import { install as filePick } from './shelf/pick.mjs';
import { install as dropImport } from './shelf/drop.mjs';
import { install as folderRefresh } from './shelf/refresh.mjs';
import { install as bookRemove } from './shelf/remove.mjs';
import { install as actionTable } from './reader/actions.mjs';
import { install as dragScroll } from './ui/dragscroll.mjs';
import { install as tapInput } from './reader/tap.mjs';
import { install as keyInput } from './reader/keys.mjs';
import { install as windows } from './core/windows.mjs';
import { install as shelfUI } from './shelf/shelf.mjs';
import { install as settingsPanel } from './panels/settings.mjs';
import { install as backup } from './panels/backup.mjs';
import { install as bookmarks } from './marks/bookmarks.mjs';
import { install as focusMode } from './reader/focus.mjs';
import { install as overview } from './reader/overview.mjs';
import { install as helpPanel } from './panels/help.mjs';
import { install as coverPicker } from './shelf/cover.mjs';
import { install as toolPanel } from './reader/toolbar.mjs';
import { install as transport } from './reader/transport.mjs';
import { install as singleFile } from './reader/single.mjs';
import { install as controlBar } from './reader/controlbar.mjs';
import { install as mediaPlayer } from './media/media.mjs';
import { install as pbfImport } from './marks/pbf.mjs';

// 边缘触发区（像素）：四边同一个值，见下方 atEdge。inset：顶缘从窗口控件覆盖区（--top）以下算起。
const EDGE = 32;
const atEdge = (side, e, inset = 0) =>
  side === 'left'
    ? e.clientX < EDGE
    : side === 'right'
      ? innerWidth - e.clientX <= EDGE
      : side === 'top'
        ? e.clientY - inset < EDGE
        : innerHeight - e.clientY <= EDGE;
localize();
const ring = holdRing();
createView();
// 功能模块共用的上下文。成员按归属分组；名称和含义是模块间的约定，不随文件调整而改。
const ctx = {
  // ---- 书目与当前书（core/books.mjs、reader/session.mjs）
  books,
  get current() {
    return current;
  },
  select,
  step,
  readingList,
  readRatio,
  persist,
  pull,
  normalize,
  flush,
  // ---- 正文与阅读区外壳（reader/）
  view,
  main,
  shelf,
  source,
  toolsState,
  updateProgress,
  showBar: (open) => showBar(open),
  toStart,
  toEnd,
  atStart,
  atEnd,
  atEdge,
  actions,
  // ---- 书的状态（core/status.mjs）
  expired,
  looseLost,
  lostSources,
  isDown: down,
  isLive,
  // ---- 导入、恢复、刷新、删除（shelf/）
  relink,
  relinkAll,
  rebuild,
  mergeKeys,
  relocate,
  refreshAll,
  discard,
  remove,
  // ---- 文案与界面小工具（core/locale.mjs、reader/shell.mjs、ui/dom.mjs）
  get lang() {
    return lang;
  },
  setLang,
  t,
  fmt,
  title,
  notice,
  make,
  icon,
  iconButton,
  safe,
  copy,
  ring,
  fade,
  showing,
  // ---- 偏好（core/prefs.mjs）
  get,
  put,
  dropKey,
  prefs,
  resetPrefs,
  // ---- 存储与缩略图（core/store.mjs、reader/thumbs.mjs）
  library,
  thumbs,
  getThumb,
  saveThumb,
  makeThumb,
  dropThumbs,
  // ---- 登记点。keys：{down(e)→true 表示已处理, up(e), blur()}；settings：设置面板条目，见下方 settings 描述；on / emit：模块间的事件
  keys: [],
  settings: [],
  on(type, fn) {
    (listeners[type] ??= []).push(fn);
  },
  emit,
  // ---- 由后装的模块提供：这里先放默认值，安装后被覆盖
  orderBooks: (list) => list.sort((a, b) => natural(title(a), title(b))), // 书架页（shelf/）：按「书籍排序」排序
  matchFilter: () => true, // 书架页（shelf/）：是否符合书架页的筛选条件
  drawShelf() {}, // 书架页（shelf/）：重绘书架页
  redrawShelf() {
    if (shelf.open) ctx.drawShelf();
  },
};
ctx.pageHold = null; // 长按翻页键的接入点（见 reader/keys.mjs 的 HOLD_LONG），media/keys.mjs 把媒体快进 / 快退接在这里
// 其余成员由各模块安装时添加：
// - windows.mjs：disk（后台读盘的轮次）、hold / reloadOthers（全局操作前后通知其他窗口）
// - 书架页（shelf/）：autoMatch、restoreBatch、restoreOne、shelfView、filtering、clearFilters、refreshCard；cover.mjs：pickCover
// - bookmarks.mjs：marks、shelfmarks；overview.mjs：overview；thumbs.mjs：frames；pbf.mjs：pbf
// - transport.mjs：transport（总控的状态与驱动器）；single.mjs：single（单文件模式）；controlbar.mjs：controlBar
// - media.mjs：media、player、mediaTile、pageHold
// - 本文件启动流程：popout（新窗口播放打开的窗口）、started（启动完成）
prefsSync(ctx);
readerShell(ctx);
prefs.sync('autoCheck').sync('edgeRight').sync('edgeLeft');
pageSort();
bookStore(ctx);
session(ctx);
sidePanel(ctx);
importer(ctx);
filePick();
dropImport();
folderRefresh(ctx);
bookRemove(ctx);
actionTable(ctx);
bindBar();
dragScroll();
tapInput(ctx);
keyInput(ctx);
// 设置条目：{id,group,label(文案 key),type:'toggle'|'choice'|'button',options:[{value,label|text}],get(),set(v),run()}
ctx.settings.push(
  {
    id: 'lang',
    group: 'general',
    label: 'langLabel',
    type: 'choice',
    options: [
      { value: '', label: 'langAuto' },
      ...languageList.map((v) => ({ value: v, text: { en: 'English', zh: '中文', ja: '日本語', ko: '한국어' }[v] })),
    ],
    get: () => langPref() || '',
    set: (v) => setLang(v),
  },
  {
    id: 'autoCheck',
    group: 'general',
    label: 'autoCheck',
    type: 'toggle',
    get: () => get('autoCheck', true),
    set: (v) => put('autoCheck', v),
  },
  {
    id: 'edgeRight',
    group: 'reading',
    label: 'edgeRight',
    type: 'toggle',
    get: () => get('edgeRight', true),
    set: (v) => put('edgeRight', v),
  },
);
// 新窗口播放（media.mjs）打开的窗口：地址里带着要接着播放的书、媒体和时间点。打开这本书并从该处播放，不做启动时的全量文件夹检查（windows.mjs 也不接手）。
const popped = popoutTarget(location.search);
ctx.popout = !!popped;
if (popped) history.replaceState(null, '', location.pathname);

try {
  for (const b of await library('getAll')) {
    try {
      const base = snap(b),
        old = b.added == null;
      books.set(b.id, normalize(b));
      bases.set(b, base);
      if (old) persist(b);
    } catch (e) {
      console.warn(e);
    }
  }
} catch {
  notice('storage');
} // 旧记录补上的添加时间写回，排序才稳定
{
  const albums = [...books.values()].filter(isLoose);
  if (albums.length > 1)
    try {
      await joinLoose(albums);
    } catch (e) {
      console.warn(e);
    }
}
// 功能模块：各自导出 install(ctx)，按依赖顺序安装。
windows(ctx);
shelfUI(ctx);
settingsPanel(ctx);
backup(ctx);
bookmarks(ctx);
focusMode(ctx);
overview(ctx);
helpPanel(ctx);
coverPicker(ctx);
toolPanel(ctx);
transport(ctx);
singleFile(ctx);
controlBar(ctx);
mediaPlayer(ctx);
installFrames(ctx);
pbfImport(ctx);

await probeAll([...books.values()]);
markProbed();
select((popped && books.get(popped.book)) || books.get(get('last')) || books.values().next().value);
if (popped && current?.id === popped.book) {
  const book = current;
  queueMicrotask(() => {
    if (current === book) ctx.media?.resume?.(book, popped.name, popped.t);
  });
} // 在 'select' 事件之后
accessState(true);
(listeners.books ??= []).push(() => accessState(false));
ctx.started = true;
if (get('autoCheck', true) && !ctx.popout) safe(() => refreshAll(false))(); // 每次打开或刷新页面时检查一次已授权的文件夹（新窗口播放打开的窗口除外）
// 从旧版 v1（dist/）迁移过来时提示安装新版。
try {
  if (sessionStorage.getItem(prefix + 'reset')) {
    sessionStorage.removeItem(prefix + 'reset');
    notice('resetDone');
  }
} catch {} // 还原默认设置后的重新载入
if (new URLSearchParams(location.search).get('from') === 'v1') {
  history.replaceState(null, '', location.pathname);
  notice('upgraded', undefined, 10000);
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then(async (reg) => {
      if (reg.active) await reg.update();
    })
    .catch(() => {});
  navigator.serviceWorker.ready.then(() => {
    $('offline').hidden = false;
  });
}
