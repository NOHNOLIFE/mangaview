// 当前曲目（选中媒体，规则见 core/selection.mjs）、它的画面的显示位置（ctx.media.stage），以及当前文件与书签作用的对象。
// - 当前曲目 S.track：带 .selected 类（不压暗、没有大播放键，shell.css）。select(播放器, 原因, {stay, page}) 换成别的，release(播放器) 被释放或打不开、
//   stop() 结束后台播放（播放列表没有可接续的项时，queue.mjs）时取消；离开视窗、切书都不取消（由自动播放开始、用户尚未接手的除外，见 autoplay.mjs）。变化时派发 ctx.emit('media', 'track')。
// - 后台播放：当前曲目的播放器脱离正文的虚拟列表存活。正文回收它所在的页时（view.mjs release → letGo）不释放，而是把页的内容收进一个
//   不在文档里的节点（unhost），媒体元素移到主文档里隐藏的停放处（#mv-park），继续播放、保持源；该页再出现在正文里时（hooks.media → host）
//   把内容和媒体元素放回页里，不重新加载、不中断。其余播放器照旧：离开视窗卸载源，页被回收即释放（dispose）。
//   播放列表接续到不在正文里的文件（别的书里的、没滚到的）时，播放器不经正文直接建出来（shell.mjs build(null, …)），同样停放。
//   不在正文里的播放器只能是当前曲目：换成别的当前曲目时，停放中的原曲目随即释放。
// - 显示位置（ctx.media.stage）：当前曲目的画面在页内（页不在正文里时停放），或在登记的外部容器里（如画中画窗口，可以在另一个文档里）。
//   画面是媒体元素与字幕容器（p.el、p.subs）：移出时包进一个 div.mv-screen（另带 .video / .audio 类，样式由容器所在的文档提供）放进容器，
//   页内原位置显示占位（.mv-away：视频盖住画面，音频在卡片的字幕区；点它只把画面收回页内，不触发翻屏等其他点击）；收回时放回原处、移除 .mv-screen。
//   视频的占位底下是压暗的一帧：搬走那一刻从媒体元素画到 canvas 上（不读文件）；元素还没有画面（从未在页内显示过）时用它已有的缩略图
//   （ctx.frames.cached，不生成），都没有时是黑底。
//   搬动都在同一任务内同步完成：同一文档内优先用 moveBefore（保持播放状态），跨文档时直接移入。
//   - stage.where() → 'page' | 'out'：当前曲目的画面现在在哪里（'out' 时在 stage.container 里）；
//   - stage.container：登记的外部容器（没有为 null）；
//   - stage.take(容器)：登记容器并把当前曲目的画面移进去（没有当前曲目时只登记，之后成为当前曲目的直接进去）；
//   - stage.back()：画面收回页内，容器仍登记（可再 take(stage.container)）；stage.drop()：收回并注销容器（外部窗口关闭时）；
//   - stage.screen()：当前曲目在外部容器里的 .mv-screen，没有为 null。
//   位置变化（含换了当前曲目、画面换了一个 .mv-screen）时派发 ctx.emit('media', 'display')。
//   显示位置跟随上一次的明确选择（take 选外部，back 选页内；drop 后为页内）：换当前曲目时 select(p, 原因, {stay: true})
//   （播放列表里的切换、接续、移除）保持原来的显示位置；其余方式开始播放新的曲目时，后台播放的（p.by === 'user'：点文件本体、播放键、
//   文件栏的播放键、空格、书签跳转）按上一次的选择放（选的是外部且容器登记着就直接进去，页内不显示）；自动滚动、自动播放的
//   与 {page: true}（全屏）、视频全屏期间换上的在页内显示，不改变那个选择。
// - 视频全屏期间（S.full，shell.mjs）当前曲目不在正文里时（别的书里、没滚到的），lift(p) 把它的页节点临时挂到阅读区里
//   （铺满窗口显示），unlift(p) 取下（媒体元素先回停放处）；该页回到正文时 host 一并接手。playerOf(页节点) 找节点对应的播放器（含这种情况）。
// - 当前文件（target，规则见 core/selection.mjs fileTarget：当前曲目在播放或全屏时是它，暂停时只在本书且中线在视窗内才是它，
//   否则视窗中心所在的页，含图片）：文件栏、长按 A / D、空格作用的对象，{book, page, i, kind, player}；
//   current 是其中的媒体播放器（播不了的、图片为 null）。书签作用的对象（here：当前曲目在本书且中线在视窗内时是它，
//   否则视窗中心所在的页的播放器）：书签快捷键、右键书签面板。
// - 自动滚动开始时先播哪个（pick：当前曲目在本书且中线在视窗内时是它，否则中线在视窗内、离视窗中心最近的媒体，没有为 null）。
import { extend } from '../core/lang.mjs';
import { pageKind, at } from '../core/model.mjs';
import { selectAfter, fileTarget, markTarget } from '../core/selection.mjs';

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
  const stage = { where: 'page', out: null, want: 'page' }; // want：上一次明确选择的显示位置
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
  // 画面在外部时页内的占位：点它只收回画面，不再冒泡到正文（点击翻屏、媒体的点击都不触发）。
  function awayOf(p) {
    if (!p.away) {
      p.away = make('button', 'mv-away');
      p.away.type = 'button';
      p.away.append(make('span', 'mv-away-text'));
      p.away.addEventListener('click', (e) => {
        e.stopPropagation();
        S.stage.back();
      });
      labelAway(p);
    }
    return p.away;
  }
  function labelAway(p) {
    p.away
      .querySelector('.mv-away-text')
      .replaceChildren(
        icon(p.kind === 'video' ? 'film' : 'music'),
        make('span', '', t('mvAway')),
        make('small', '', t('mvAwayBack')),
      );
  }
  // 视频的占位底下的画面：搬走那一刻的一帧（媒体元素有画面时直接画，不读文件），否则已有的缩略图（不生成），都没有时不放（黑底）。
  const STILL_W = 640;
  function still(p) {
    const away = p.away,
      el = p.el,
      token = (p.stillAt = (p.stillAt ?? 0) + 1);
    away.querySelector(':scope > .mv-still')?.remove();
    if (el.videoWidth && el.videoHeight && el.readyState >= 2) {
      const k = Math.min(1, STILL_W / el.videoWidth),
        c = make('canvas', 'mv-still');
      c.width = Math.max(1, Math.round(el.videoWidth * k));
      c.height = Math.max(1, Math.round(el.videoHeight * k));
      try {
        c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
        away.prepend(c);
        return;
      } catch {
        // 画不了时退回缩略图
      }
    }
    Promise.resolve(ctx.frames?.cached?.(p.book, p.page))
      .then((th) => {
        if (!th?.url || p.stillAt !== token || p.away !== away) return;
        const img = new Image();
        img.className = 'mv-still';
        img.alt = '';
        img.draggable = false;
        img.src = th.url;
        away.prepend(img);
      })
      .catch(() => {});
  }
  // 按状态放好媒体元素与字幕容器：外部容器里（当前曲目且 where 为 'out'）、页里（在正文里）、停放处（不在正文里，字幕容器留在页的内容里）。
  function seat(p) {
    const out = p === S.track && stage.where === 'out' && stage.out;
    if (out) {
      const scr = (p.screen ??= make('div', 'mv-screen ' + p.kind));
      if (scr.parentNode !== out) out.append(scr);
      const away = awayOf(p);
      if (p.kind === 'video' && p.el.parentNode !== scr) still(p); // 搬走的那一刻（已在外部的重新放置时保留原来那一帧）
      if (p.kind === 'video') move(away, p.node, p.big);
      else move(away, p.card, p.shell);
      move(p.el, scr);
      move(p.subs, scr);
      p.node.classList.add('mv-out');
      return;
    }
    p.away?.remove();
    p.node.classList.remove('mv-out');
    if (hosted(p) || p.lifted) home(p, true);
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
    if (p.lifted) {
      p.lifted = false;
      old.remove(); // 全屏时临时挂在阅读区里的节点（lift）
    }
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
  // stay：保持原来的显示位置；page：在页内显示（全屏）。其余按上一次的选择放后台播放的曲目（见文件开头）。
  function setTrack(p, stay = false, page = false) {
    const old = S.track;
    p ??= null;
    if (p === old) return;
    old?.node.classList.remove('selected');
    S.track = p;
    p?.node.classList.add('selected');
    const wasOut = stage.where === 'out';
    if (!stay) stage.where = !page && !S.full && stage.want === 'out' && stage.out && p?.by === 'user' ? 'out' : 'page';
    S.follow?.(old, p); // 视频全屏跟随当前曲目（shell.mjs）
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
  const select = (p, type = 'press', { stay = false, page = false } = {}) =>
    setTrack(selectAfter(S.track, { type, player: p }), stay, page);
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
      stage.where = stage.want = 'out';
      if (S.track) seat(S.track);
      changed();
    },
    back() {
      stage.want = 'page';
      if (stage.where === 'page') return;
      stage.where = 'page';
      if (S.track) seat(S.track);
      changed();
    },
    drop() {
      const was = stage.where === 'out' || !!stage.out;
      stage.where = stage.want = 'page';
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
  // 当前文件（core/selection.mjs fileTarget）：在播放（含等着播放）或全屏的当前曲目（任何书里），暂停的当前曲目在本书且中线在视窗内时也是它，
  // 否则视窗中心所在的页。
  function target() {
    const tr = S.track,
      center = () => (ctx.current ? centerFile() : null);
    if (!tr) return center();
    const own = { book: tr.book, page: tr.page, i: tr.book.pages.indexOf(tr.page), kind: tr.kind, player: tr },
      on = { playing: !!S.on?.(tr), full: S.full === tr, inBook: tr.book === ctx.current, inView: inView(tr) };
    return fileTarget(own, on.playing || on.full || on.inView ? null : center(), on);
  }
  const usable = (p) => (p && p.state !== 'failed' ? p : null);
  const current = () => usable(target()?.player);
  // 书签作用的媒体播放器：当前曲目在本书且中线在视窗内时是它，否则视窗中心所在的页的（图片、播不了的为 null）。
  function here() {
    const tr = S.track;
    const p = markTarget(tr, { inBook: !!tr && tr.book === ctx.current, inView: !!tr && inView(tr) }, null);
    return usable(p ?? (ctx.current ? centerFile()?.player : null));
  }
  // ---- 全屏的当前曲目不在正文里：页节点临时挂到阅读区里（铺满窗口），取下时媒体元素先回停放处（同一任务内，不中断）。
  function lift(p) {
    if (!p || hosted(p) || p.lifted) return;
    p.lifted = true;
    main.append(p.node);
    seat(p);
  }
  function unlift(p) {
    if (!p?.lifted) return;
    p.lifted = false;
    seat(p);
    p.node.remove();
  }
  // 页节点对应的播放器：正文里的，或临时挂在阅读区里的当前曲目。
  const playerOf = (node) => (node && (players.get(node) ?? (S.track?.node === node ? S.track : null))) || null;
  const pick = () => {
    const tr = S.track;
    return tr && tr.state !== 'failed' && inView(tr) ? tr : nearest();
  };
  Object.assign(S, {
    hosted,
    host,
    lift,
    unlift,
    playerOf,
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
