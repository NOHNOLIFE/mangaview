// 视频、音频：正文里的播放器（原生 <video> / <audio> 负责播放，外面套一层自绘的壳）、当前媒体、自动播放、统一音量和媒体按键。
// - 页的类型按扩展名判断（model.mjs kindOf）；排版见 model.mjs offsets（视频按帧比例、高于视窗时封顶到一屏，音频是固定高度的横条）。
// - 正文里的媒体页由 view.mjs 的 hooks.media 交给这里：只有与视窗相交的媒体挂上源（对象 URL，浏览器按需读取，不整体读进内存），
//   离开视窗即卸载源、释放解码器；相邻页不预加载。缩略图栏、全屏缩略图里是固定样式的占位（ctx.mediaTile），不读文件。
// - 帧尺寸、时长在首次挂上源时读到，记入页记录（page.w / h / d），之后排版不再读文件；浏览器播不了的文件记下当时的
//   大小和修改时间（page.bad），文件没变就不再探测，只在用户点「重试」或文件变化后重做（变化在该页本来要读取时顺带比较）。
// - 只与该文件有关的按钮登记在 ctx.player.add（添加书签、添加区段书签、字幕等）：音频卡片上排成一行（默认是次要控件，宽度不够时收进弹出层；
//   card: false 的不上卡片，如字幕），文件栏（reader/filebar.mjs）与总控栏的字幕按钮按 id 取用同一份登记（ctx.player.controls()），
//   点击、状态都带上所在的按钮；视频画面内没有控件。
//   列表级的控制（音量、只播区段、上一个 / 下一个媒体、播放速率）在总控栏（reader/controlbar.mjs），经 ctx.media 读写；循环在总控（ctx.transport.loop）；
//   进度条上有一层 .mv-marks 容器，ctx.player.decorate(fn) 在每个播放器创建时（以及 ctx.player.refresh() 时）调用 fn(播放器) 画标记。
// - 选中媒体与当前文件（autoplay.mjs，规则见 core/selection.mjs）：选中媒体不压暗、没有大播放键；当前文件是选中的媒体，否则视窗中心所在的页，
//   文件栏与快捷键作用于它；ctx.media.current() 是其中的媒体播放器（没有为 null）。
// - 总控（ctx.transport）的 'media' 驱动器、单个媒体自己的播放键、上一个 / 下一个媒体、播放速率在 driver.mjs。
// - 播完后的接续、只播放书签区段的规则在 core/playlist.mjs；区段来自 bookmarks.mjs（ctx.marks.ranges）。
// - 播放位置记忆：会话内存在 times，持久化在书目记录的 book.mediaPos=[{id:页名,t:秒}]（按条目合并，见 merge.mjs），
//   只在暂停、离开视窗、切书、关闭窗口时保存，播放中至多每 POS_EVERY 毫秒保存一次；播到结尾（剩余不足 5 秒）清除。
// 本文件是唯一入口：建立子模块共享的 S，按顺序装配子模块，对外提供 ctx.media、ctx.player（含 api）和正文的 ctx.view.hooks.media。
// 子模块（安装顺序）：volume 统一音量；order 播完后的切换、待接手的播放请求；sections 只播放书签区段；
// position 播放位置记忆；hud 提示浮层；tile 缩略图里的占位；shell 壳的 DOM 与状态显示；player 播放器的状态（挂源、失败、播放 / 暂停）；
// autoplay 当前媒体与自动播放；keys 媒体按键；scrub 横向拖动快进 / 快退；driver 与总控的衔接；subtitles 外挂字幕。
// 进度条上的书签标记在 marks.mjs（由 bookmarks.mjs 安装）。
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
import { install as keys } from './keys.mjs';
import { install as scrub } from './scrub.mjs';
import { install as driver } from './driver.mjs';
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
  sections: '<path d="M7 5H4v14h3M17 5h3v14h-3M9 12h6"/>',
  'fast-forward': '<path d="m13 19 9-7-9-7zM2 19l9-7-9-7z"/>',
  rewind: '<path d="m11 19-9-7 9-7zM22 19l-9-7 9-7z"/>',
};

export function install(ctx) {
  const { get } = ctx;
  addIcons(ICONS);
  // S：子模块之间共享的状态与函数。状态：players 正文里的媒体页节点 → 播放器、times 会话内的播放位置、controls / decorators 登记的按钮与装饰、
  // failedPages 打不开的页、playing 正在播放的播放器、queued 待接手的播放请求、api 播放器对外的操作；
  // volume / muted（volume.mjs）、only（sections.mjs）由各子模块维护。函数由各子模块安装时登记，经 S 互相调用。
  const S = {
    players: new Map(), // 正文里的媒体页节点 → 播放器
    times: new WeakMap(), // 本次会话里各媒体的播放位置（页对象 → 秒），卸载源之后回来从这里继续
    controls: [],
    decorators: [],
    failedPages: new WeakSet(), // 本次会话里打不开的页：自动切换时跳过
    playing: null,
    queued: null, // 影音模式切到的或书签跳转要播放的页 {page,time,play,auto}：该页的播放器出现在视窗里时接手
  };
  const { players, times, controls, decorators } = S;
  const start = (...a) => S.start(...a),
    seek = (...a) => S.seek(...a),
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
  // 播放器对外的操作（供书签等使用）。
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
    S.mark?.();
    S.centerSoon?.();
    if (visible && S.queued?.page === page) claim(p);
    if (visible) {
      if (p.state === 'idle') load(p);
    } else if (p.state === 'loading' || p.state === 'ready') unload(p);
  };
  autoplay(ctx, S);

  // 点击正文里的媒体：画面、大播放键、卡片上等同它自己的播放键（driver.mjs press），卡片控件之间的空白处不动作；都不翻屏（tap.mjs 的正文点击先问这里）。
  ctx.media = {
    tap(target) {
      const node = target?.closest?.('.page.media');
      const p = node && players.get(node);
      if (!p) return false;
      if (!target.closest('.mv-shell,.mv-subs')) S.press(p);
      return true;
    },
    current: () => current(),
    // 跳到媒体书签（bookmarks.mjs，正文已滚到该页）：定位到书签时间；自动播放开启则从该处播放，关闭则停在该画面（正在播放的继续播放）。
    goto(book, page, s) {
      times.set(page, s);
      S.queued = { page, time: s, play: get('autoplay', false) === true, auto: false };
      const p = [...players.values()].find((q) => q.page === page && q.book === book);
      if (p && !S.queued.play && p.state === 'ready' && !p.el.paused) S.queued.play = true;
      claimNow();
    },
  };
  keys(ctx, S);
  scrub(ctx, S);
  // ---- 播放器的扩展点：登记按钮、画进度条上的标记。
  // add({id,icon,label(文案 key),order?,secondary?=true,card?=true,kinds?:['video','audio'],click(播放器,api,按钮),state?(播放器,api,按钮)→{disabled,pressed,icon,label}})
  // 文件栏用：controls() 登记的按钮；seekBar(get) 建一条进度条（get() 为它作用的播放器），paintBar(进度条, 播放器) 画进度、返回时间文字；
  // timeBox(get, 类名) 建时间（悬停换成快退 / 快进，见 shell.mjs makeTime）；timeWidth(时长) 时间文字的宽度（ch）。
  // 文件详情框（filecard.mjs）用：seekBar、paintBar、position(书, 页)。
  ctx.player = {
    add(c) {
      controls.push(c);
      for (const p of players.values()) layoutControls(p);
    },
    controls: () => controls,
    seekBar: (get) => S.makeBar(get),
    timeBox: (get, cls) => S.makeTime(get, cls),
    paintBar: (parts, p, at) => S.paintBar(parts, p, at),
    timeWidth: (d) => S.timeWidth(d),
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
    // 某个文件的播放进度 {t, d, playing}（文件详情框用，不读文件）：有播放器时是它的实时值，否则是本次会话记下的或保存的位置、页记录里的时长（未知为 null）。
    position(book, page) {
      const p = [...players.values()].find((q) => q.book === book && q.page === page);
      if (p) return { t: api.time(p) || 0, d: api.duration(p), playing: p.state === 'ready' && !p.el.paused };
      return { t: times.get(page) ?? savedPos(book, page), d: page.d ?? null, playing: false };
    },
    api,
  };
  driver(ctx, S);
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
