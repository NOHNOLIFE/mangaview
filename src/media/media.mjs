// 视频、音频：正文里的播放器（原生 <video> / <audio> 负责播放，外面套一层自绘的壳）、当前媒体、自动播放、统一音量和媒体按键。
// - 页的类型按扩展名判断（model.mjs kindOf）；排版见 model.mjs offsets（视频按帧比例、高于视窗时封顶到一屏，音频是固定高度的横条）。
// - 正文里的媒体页由 view.mjs 的 hooks.media 交给这里：只有与视窗相交的媒体挂上源（对象 URL，浏览器按需读取，不整体读进内存），
//   离开视窗即卸载源、释放解码器；相邻页不预加载。缩略图栏、全屏缩略图里是固定样式的占位（ctx.mediaTile），不读文件。
// - 帧尺寸、时长在首次挂上源时读到，记入页记录（page.w / h / d），之后排版不再读文件；浏览器播不了的文件记下当时的
//   大小和修改时间（page.bad），文件没变就不再探测，只在用户点「重试」或文件变化后重做（变化在该页本来要读取时顺带比较）。
// - 壳上的按钮登记在 ctx.player.add：之后的「添加书签」「播放顺序」等按钮照此加入，默认是次要控件（宽度不够时收进弹出层）；
//   进度条上有一层 .mv-marks 容器，ctx.player.decorate(fn) 在每个播放器创建时（以及 ctx.player.refresh() 时）调用 fn(播放器) 画标记。
// - 当前媒体（ctx.media.current）：本窗口正在播放的；否则中线在视窗内、离视窗中心最近的；都没有为 null。
// - 播放顺序与循环（3.7）、只播放书签区段（4.5）的规则在 playlist.mjs；区段来自 bookmarks.mjs（ctx.marks.ranges）。
// - 播放位置记忆（3.9）：会话内存在 times，持久化在书目记录的 book.mediaPos=[{id:页名,t:秒}]（按条目合并，见 merge.mjs），
//   只在暂停、离开视窗、切书、关闭窗口时保存，播放中至多每 POS_EVERY 毫秒保存一次；播到结尾（剩余不足 5 秒）清除。
// - 新窗口播放（10.2）：壳上的按钮、快捷键 Z、/ 打开一个新的 MangaView 窗口（地址带上书、页名和时间点，playlist.mjs popoutUrl），
//   本窗口的该媒体暂停；新窗口启动时（app.mjs）经 ctx.media.resume 定位到该媒体并从该处播放，浏览器拦截出声时提示并停在该处等待点击。
// 本文件是唯一入口：建立子模块共享的 S，按顺序装配子模块，对外提供 ctx.media、ctx.player（含 api）和正文的 ctx.view.hooks.media。
// 子模块（安装顺序）：volume 统一音量；order 播放顺序与循环、播完后的切换、待接手的播放请求；sections 只播放书签区段；
// position 播放位置记忆；hud 提示浮层；tile 缩略图里的占位；shell 壳的 DOM 与状态显示；player 播放器的状态（挂源、失败、播放 / 暂停）；
// autoplay 当前媒体与自动播放；popout 新窗口播放；keys 媒体按键；buttons 壳上的列表级按钮登记；subtitles 外挂字幕。进度条上的书签标记在 marks.mjs（由 bookmarks.mjs 安装）。
import { pageKind } from '../core/model.mjs';
import { addIcons } from '../ui/icons.mjs';
import { install as volume } from './volume.mjs';
import { install as order } from './order.mjs';
import { install as sections } from './sections.mjs';
import { install as position } from './position.mjs';
import { install as hud } from './hud.mjs';
import { install as tiles } from './tile.mjs';
import { install as shell } from './shell.mjs';
import { install as player } from './player.mjs';
import { install as autoplay } from './autoplay.mjs';
import { install as popout } from './popout.mjs';
import { install as keys } from './keys.mjs';
import { install as buttons } from './buttons.mjs';
import { install as subtitles } from './subtitles.mjs';

const ICONS = {
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  'volume-low': '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  'volume-x': '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7.5 3v18M16.5 3v18M3 7.5h4.5M3 12h18M3 16.5h4.5M16.5 7.5H21M16.5 16.5H21"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  'order-list': '<path d="M4 6h12M4 12h12M4 18h8M17 15l3 3-3 3"/>',
  'order-shuffle':
    '<path d="M3 7h3a5 5 0 0 1 4 2l4 6a5 5 0 0 0 4 2h3M3 17h3a5 5 0 0 0 4-2M14 9a5 5 0 0 1 4-2h3M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  'order-single': '<path d="M4 12h11M12 8l4 4-4 4M20 6v12"/>',
  repeat:
    '<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  sections: '<path d="M7 5H4v14h3M17 5h3v14h-3M9 12h6"/>',
  popout: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M11 3h10v10M21 3l-9 9"/>',
  'fast-forward': '<path d="m13 19 9-7-9-7zM2 19l9-7-9-7z"/>',
  rewind: '<path d="m11 19-9-7 9-7zM22 19l-9-7 9-7z"/>',
};

export function install(ctx) {
  const { get } = ctx;
  addIcons(ICONS);
  // S：子模块之间共享的状态与函数。状态：players 正文里的媒体页节点 → 播放器、times 会话内的播放位置、controls / decorators 登记的按钮与装饰、
  // failedPages 打不开的页、rounds 本轮随机已播过的页名、playing 正在播放的播放器、queued 待接手的播放请求、api 播放器对外的操作；
  // volume / muted（volume.mjs）、order / loop（order.mjs）、only（sections.mjs）由各子模块维护。函数由各子模块安装时登记，经 S 互相调用。
  const S = {
    players: new Map(), // 正文里的媒体页节点 → 播放器
    times: new WeakMap(), // 本次会话里各媒体的播放位置（页对象 → 秒），卸载源之后回来从这里继续
    controls: [],
    decorators: [],
    failedPages: new WeakSet(), // 本次会话里打不开的页：按播放顺序自动切换时跳过
    rounds: new WeakMap(), // 书 → 本轮随机已播过的页名
    playing: null,
    queued: null, // 按播放顺序或书签跳转要播放的页 {page,time,play,auto}：该页的播放器出现在视窗里时接手
  };
  const { players, times, controls, decorators } = S;
  const start = (...a) => S.start(...a),
    seek = (...a) => S.seek(...a),
    toggle = (...a) => S.toggle(...a),
    build = (...a) => S.build(...a),
    tile = (...a) => S.tile(...a),
    claim = (...a) => S.claim(...a),
    claimNow = (...a) => S.claimNow(...a),
    load = (...a) => S.load(...a),
    unload = (...a) => S.unload(...a),
    current = (...a) => S.current(...a),
    layoutControls = (...a) => S.layoutControls(...a),
    refreshAll = (...a) => S.refreshAll(...a),
    decorate = (...a) => S.decorate(...a),
    progress = (...a) => S.progress(...a),
    savedPos = (...a) => S.savedPos(...a);
  // 播放器对外的操作（供之后的书签、播放顺序等使用）。
  const api = {
    play: (p) => start(p),
    pause: (p) => {
      p.userPaused = true;
      p.el.pause();
    },
    seek: (p, s) => seek(p, s),
    duration: (p) => (Number.isFinite(p.el.duration) ? p.el.duration : (p.page.d ?? null)),
    time: (p) => (p.state === 'ready' ? p.el.currentTime : p.time),
  };
  S.api = api;
  volume(ctx, S);
  order(ctx, S);
  sections(ctx, S);
  position(ctx, S);
  hud(ctx, S);
  tiles(ctx, S);
  shell(ctx, S);
  player(ctx, S);

  // ---- 正文里的媒体页（view.mjs paint 调用）：k 为 0 是正文，1 是缩略图栏；visible 为与视窗相交。
  ctx.view.hooks.media = (node, book, page, kind, k, visible) => {
    if (k) {
      if (!node.firstChild) node.append(tile(page, kind));
      return;
    }
    const p = players.get(node) ?? build(node, book, page, kind);
    if (visible && S.queued?.page === page) claim(p);
    if (visible) {
      if (p.state === 'idle') load(p);
    } else if (p.state === 'loading' || p.state === 'ready') unload(p);
  };
  autoplay(ctx, S);

  // 点击正文里的媒体（壳以外）：播放 / 暂停，不翻屏（app.mjs 的正文点击先问这里）。
  ctx.media = {
    tap(target) {
      const node = target?.closest?.('.page.media');
      const p = node && players.get(node);
      if (!p) return false;
      toggle(p);
      return true;
    },
    current: () => current(),
    // 跳到媒体书签（bookmarks.mjs，正文已滚到该页）：定位到书签时间；自动播放开启则从该处播放，关闭则停在该画面（正在播放的继续播放）。
    goto(book, page, s) {
      times.set(page, s);
      S.queued = { page, time: s, play: get('autoplay', true) !== false, auto: false };
      const p = [...players.values()].find((q) => q.page === page && q.book === book);
      if (p && !S.queued.play && p.state === 'ready' && !p.el.paused) S.queued.play = true;
      claimNow();
    },
    // 新窗口播放的新窗口启动时（app.mjs，当前书已是 book）：把该媒体滚到视窗中央，从 s 秒处播放（不看自动播放设置）。
    resume(book, name, s) {
      const i = book.pages.findIndex((pg) => pg.name === name),
        page = book.pages[i];
      if (!page || !['video', 'audio'].includes(pageKind(page))) return;
      times.set(page, s);
      S.queued = { page, time: s, play: true, auto: false, popped: true };
      ctx.view.jump({ i, f: 0.5 });
      claimNow();
      requestAnimationFrame(claimNow);
    },
  };
  popout(ctx, S);
  keys(ctx, S);
  // ---- 播放器的扩展点：登记按钮、画进度条上的标记。
  // add({id,icon,label(文案 key),order?,secondary?=true,kinds?:['video','audio'],click(播放器,api),state?(播放器,api)→{disabled,pressed,icon,label}})
  ctx.player = {
    add(c) {
      controls.push(c);
      for (const p of players.values()) layoutControls(p);
    },
    decorate(fn) {
      decorators.push(fn);
      for (const p of players.values())
        try {
          fn(p);
        } catch (e) {
          console.warn(e);
        }
    },
    refresh() {
      refreshAll();
    },
    list: () => [...players.values()],
    current: () => current(),
    api,
  };
  buttons(ctx, S);
  subtitles(ctx);
  // 书签增删（本窗口或别的窗口）后重画该书的播放器上的标记；别的窗口保存的播放位置，本窗口还没挂上源的播放器随之跟进。
  const refreshBook = (book) => {
    for (const p of players.values())
      if (p.book === book) {
        p.ranges = null;
        decorate(p);
      }
  };
  ctx.on('marks', refreshBook);
  ctx.on('synced', (book, keys) => {
    if (keys.includes('bookmarks')) refreshBook(book);
    if (keys.includes('mediaPos'))
      for (const p of players.values())
        if (p.book === book && p.state !== 'ready') {
          p.time = savedPos(book, p.page);
          times.set(p.page, p.time);
          progress(p);
        }
  });
}
