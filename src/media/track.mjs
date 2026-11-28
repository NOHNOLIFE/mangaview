// 当前曲目（选中媒体，规则见 core/selection.mjs）、它的画面的显示位置（ctx.media.stage），以及当前文件与书签作用的对象。
// - 当前曲目 S.track：带 .selected 类（不压暗、没有大播放键，shell.css）。select(播放器, 原因, {stay}) 换成别的，release(播放器) 被释放或打不开、
//   stop() 结束后台播放（播放列表没有可接续的项时，queue.mjs）时取消；离开视窗、切书都不取消（由自动播放开始、用户尚未接手的除外，见 autoplay.mjs）。变化时派发 ctx.emit('media', 'track')。
// - 后台播放：当前曲目的播放器脱离正文的虚拟列表存活。正文回收它所在的页时（view.mjs release → letGo）不释放，而是把页的内容收进一个
//   不在文档里的节点（unhost），媒体元素移到主文档里隐藏的停放处（#mv-park），继续播放、保持源；该页再出现在正文里时（hooks.media → host）
//   把内容和媒体元素放回页里，不重新加载、不中断。其余播放器照旧：离开视窗卸载源，页被回收即释放（dispose）。
//   播放列表接续到不在正文里的文件（别的书里的、没滚到的）时，播放器不经正文直接建出来（shell.mjs build(null, …)），同样停放。
//   不在正文里的播放器只能是当前曲目：换成别的当前曲目时，停放中的原曲目随即释放。
// - 显示位置（ctx.media.stage）：当前曲目的画面在页内（页不在正文里时停放），或在登记的外部容器里（如画中画窗口，可以在另一个文档里）。
//   画面是媒体元素与字幕容器（p.el、p.subs）：移出时包进一个 div.mv-screen（另带 .video / .audio 类，样式由容器所在的文档提供）放进容器，
//   页内原位置显示占位（.mv-away：视频盖住画面，音频在卡片的字幕区；点它收回页内，media.mjs tap）；收回时放回原处、移除 .mv-screen。
//   搬动都在同一任务内同步完成：同一文档内优先用 moveBefore（保持播放状态），跨文档时直接移入。
//   - stage.where() → 'page' | 'out'：新的当前曲目放在哪里（'out' 时放进 stage.container）；
//   - stage.container：登记的外部容器（没有为 null）；
//   - stage.take(容器)：登记容器并把当前曲目的画面移进去（没有当前曲目时只登记，之后成为当前曲目的直接进去）；
//   - stage.back()：画面收回页内，容器仍登记（可再 take(stage.container)）；stage.drop()：收回并注销容器（外部窗口关闭时）；
//   - stage.screen()：当前曲目在外部容器里的 .mv-screen，没有为 null。
//   位置变化（含换了当前曲目、画面换了一个 .mv-screen）时派发 ctx.emit('media', 'display')。
//   换当前曲目时：select(p, 原因, {stay: true})（播放列表里的切换、接续、移除）保持原来的显示位置；其余（在阅读区点击、自动滚动、
//   自动播放、书签跳转）回到页内（where() 变为 'page'），容器仍登记。
// - 当前文件（target：当前曲目，否则视窗中心所在的页，含图片）：文件栏、长按 A / D、空格作用的对象，{book, page, i, kind, player}；
//   current 是其中的媒体播放器（播不了的、图片为 null）。书签作用的对象（here：当前曲目在本书且中线在视窗内时是它，
//   否则视窗中心所在的页的播放器）：书签快捷键、右键书签面板。
// - 自动滚动开始时先播哪个（pick：当前曲目在本书且中线在视窗内时是它，否则中线在视窗内、离视窗中心最近的媒体，没有为 null）。
import { extend } from '../core/lang.mjs';
import { pageKind, at } from '../core/model.mjs';
import { selectAfter, markTarget } from '../core/selection.mjs';

extend({
  mvAway: [
    'Playing in picture-in-picture',
    '正在画中画播放',
    'ピクチャーインピクチャーで再生中',
    'PIP 화면에서 재생 중',
  ],
  mvAwayBack: ['Click to show it here', '点击在此处显示', 'クリックでここに表示', '클릭하면 여기에 표시'],
});

export function install(ctx, S) {
  const { main, make, icon, t } = ctx,
    { players } = S;
  const park = make('div');
  park.id = 'mv-park';
  park.setAttribute('aria-hidden', 'true');
  document.body.append(park);
  const stage = { where: 'page', out: null };
  const hosted = (p) => !!p && players.get(p.node) === p;
  const changed = () => ctx.emit('media', 'display');

  // ---- 搬动：同一文档、都在文档里时用 moveBefore（不重新加载、不中断），否则 insertBefore（同一任务内移回文档的媒体不会被暂停）。
  function move(child, parent, before = null) {
    if (child.parentNode === parent && child.nextSibling === before) return;
    if (parent.moveBefore && child.isConnected && parent.isConnected && child.ownerDocument === parent.ownerDocument)
      try {
        parent.moveBefore(child, before);
        return;
      } catch {
        // 退回普通插入
      }
    parent.insertBefore(child, before);
  }
  // 页内的原位置：视频的画面、字幕层在页节点里大播放键之前；音频的字幕区在卡片里壳之前，媒体元素在大播放键之前。
  function home(p, withEl) {
    if (p.kind === 'video') {
      move(p.subs, p.node, p.big);
      if (withEl) move(p.el, p.node, p.subs);
    } else {
      move(p.subs, p.card, p.shell);
      if (withEl) move(p.el, p.node, p.big);
    }
  }
  // 画面在外部时页内的占位（点它收回页内）。
  function awayOf(p) {
    if (!p.away) {
      p.away = make('button', 'mv-away');
      p.away.type = 'button';
      p.away.addEventListener('click', () => S.stage.back());
      labelAway(p);
    }
    return p.away;
  }
  function labelAway(p) {
    p.away.replaceChildren(
      icon(p.kind === 'video' ? 'film' : 'music'),
      make('span', '', t('mvAway')),
      make('small', '', t('mvAwayBack')),
    );
  }
  // 按状态放好媒体元素与字幕容器：外部容器里（当前曲目且 where 为 'out'）、页里（在正文里）、停放处（不在正文里，字幕容器留在页的内容里）。
  function seat(p) {
    const out = p === S.track && stage.where === 'out' && stage.out;
    if (out) {
      const scr = (p.screen ??= make('div', 'mv-screen ' + p.kind));
      if (scr.parentNode !== out) out.append(scr);
      const away = awayOf(p);
      if (p.kind === 'video') move(away, p.node, p.big);
      else move(away, p.card, p.shell);
      move(p.el, scr);
      move(p.subs, scr);
      p.node.classList.add('mv-out');
      return;
    }
    p.away?.remove();
    p.node.classList.remove('mv-out');
    if (hosted(p)) home(p, true);
    else {
      home(p, false);
      move(p.el, park);
    }
    p.screen?.remove();
  }
  // 停放中的播放器回到正文的页节点 node：页的内容、类名一起搬过去，媒体元素放回原处（或留在外部容器里）。
  function host(p, node) {
    const old = p.node;
    for (const c of old.classList) if (c !== 'mv-center') node.classList.add(c);
    node.replaceChildren(...old.childNodes);
    p.node = node;
    players.set(node, p);
    node._dispose = () => letGo(p);
    seat(p);
    if (p.art) ctx.coverBg?.(p.art, p.book); // 停放期间封面可能换了（'cover' 事件只更新文档里的）
    S.render(p);
  }
  // 正文回收当前曲目的页：媒体元素先移到停放处（仍在文档里，不中断），页的内容收进不在文档里的节点。
  function unhost(p) {
    if (S.full === p) S.leaveFull();
    const node = p.node,
      keep = make('div');
    for (const c of node.classList) if (c !== 'mv-center') keep.classList.add(c);
    players.delete(node);
    p.node = keep;
    p.visible = false;
    if (p.el.parentNode === node) move(p.el, park);
    keep.append(...node.childNodes);
  }
  // 正文回收一页（view.mjs release 经 node._dispose）：当前曲目停放，其余释放。
  function letGo(p) {
    if (p === S.track && p.state !== 'failed') unhost(p);
    else S.dispose(p);
  }
  // 释放播放器时：移除停放处、外部容器里的媒体元素与 .mv-screen。
  function unpark(p) {
    if (p.el.parentNode === park) p.el.remove();
    p.screen?.remove();
  }

  // ---- 当前曲目
  function setTrack(p, stay = false) {
    const old = S.track;
    p ??= null;
    if (p === old) return;
    old?.node.classList.remove('selected');
    S.track = p;
    p?.node.classList.add('selected');
    const wasOut = stage.where === 'out';
    if (!stay) stage.where = 'page';
    if (old) {
      seat(old);
      if (!hosted(old)) S.dispose(old);
      else if (!old.visible && (old.state === 'loading' || old.state === 'ready')) S.unload(old);
    }
    if (p) seat(p);
    S.markNow?.(); // 当前文件随之变化：立即派发，总控栏、文件栏与 .selected 同步
    ctx.emit('media', 'track');
    if (wasOut || stage.where === 'out') changed();
  }
  const select = (p, type = 'press', { stay = false } = {}) =>
    setTrack(selectAfter(S.track, { type, player: p }), stay);
  const release = (p) => setTrack(selectAfter(S.track, { type: 'gone', player: p }), true);
  const after = (e) => setTrack(selectAfter(S.track, { auto: S.track?.by === 'auto', ...e }), true);
  ctx.on('lang', () => {
    for (const p of S.all()) if (p.away) labelAway(p);
  });

  // ---- 显示位置
  S.stage = {
    where: () => stage.where,
    get container() {
      return stage.out;
    },
    take(container) {
      if (!container) return;
      stage.out = container;
      stage.where = 'out';
      if (S.track) seat(S.track);
      changed();
    },
    back() {
      if (stage.where === 'page') return;
      stage.where = 'page';
      if (S.track) seat(S.track);
      changed();
    },
    drop() {
      const was = stage.where === 'out' || !!stage.out;
      stage.where = 'page';
      if (S.track) seat(S.track);
      stage.out = null;
      if (was) changed();
    },
    screen: () => (stage.where === 'out' && S.track?.screen?.parentNode === stage.out ? S.track.screen : null),
  };

  // ---- 视窗
  const middle = (p) => p.node.offsetTop + p.node.offsetHeight / 2;
  // 中线在视窗内：只算正文里、当前书的播放器。
  const inView = (p) => {
    if (!hosted(p) || p.book !== ctx.current) return false;
    const y = middle(p);
    return y >= main.scrollTop && y <= main.scrollTop + main.clientHeight;
  };
  function nearest(ok = () => true) {
    let best = null,
      bd = Infinity;
    const c = main.scrollTop + main.clientHeight / 2;
    for (const p of players.values()) {
      if (p.state === 'failed' || !inView(p) || !ok(p)) continue;
      const d = Math.abs(middle(p) - c);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  // 视窗中心所在的页（单文件模式下是显示的那一页），没有时为 -1。
  function centerIndex() {
    const book = ctx.current,
      view = ctx.view;
    if (!book?.pages.length) return -1;
    if (view.single) {
      const a = view.anchor();
      return a ? book.pages.findIndex((pg) => pg.name === a.name) : -1;
    }
    const s = view.panes?.[0]?.starts ?? [];
    return s.length === book.pages.length + 1 ? at(s, main.scrollTop + main.clientHeight / 2).i : -1;
  }
  // 视窗中心所在的页 {book, page, i, kind, player}（媒体页带上它的播放器）；没有为 null。
  function centerFile() {
    const book = ctx.current,
      i = centerIndex();
    if (i < 0) return null;
    const page = book.pages[i],
      kind = pageKind(page),
      player = kind === 'video' || kind === 'audio' ? S.find(book, page) : null;
    return { book, page, i, kind, player };
  }
  // 当前文件：当前曲目（任何书里），否则视窗中心所在的页。
  function target() {
    const tr = S.track;
    if (tr) return { book: tr.book, page: tr.page, i: tr.book.pages.indexOf(tr.page), kind: tr.kind, player: tr };
    return ctx.current ? centerFile() : null;
  }
  const usable = (p) => (p && p.state !== 'failed' ? p : null);
  const current = () => usable(target()?.player);
  // 书签作用的媒体播放器：当前曲目在本书且中线在视窗内时是它，否则视窗中心所在的页的（图片、播不了的为 null）。
  function here() {
    const tr = S.track;
    const p = markTarget(tr, { inBook: !!tr && tr.book === ctx.current, inView: !!tr && inView(tr) }, null);
    return usable(p ?? (ctx.current ? centerFile()?.player : null));
  }
  const pick = () => {
    const tr = S.track;
    return tr && tr.state !== 'failed' && inView(tr) ? tr : nearest();
  };
  Object.assign(S, {
    hosted,
    host,
    letGo,
    unpark,
    seat,
    select,
    release,
    after,
    stop: () => setTrack(null, true), // 结束后台播放：外部容器的登记与显示位置不变
    inView,
    nearest,
    centerIndex,
    target,
    current,
    here,
    pick,
  });
}
