// 文件详情框（可复用）：视频、音频在列表里悬停或键盘聚焦时立即弹出，取代 title 提示。用于缩略图栏、全屏缩略图、书签面板、书架书签、
// 全屏书签、选择起点（以及播放列表）。
// 内容：文件名（不带路径）、类型、播放进度（上次播放位置 / 时长；正在播放时实时更新；不读文件，时长未知时只显示已知的部分、不画进度条）、
// 一条进度条，条上画出该文件的全部书签与区段（进度条是 ctx.player.seekBar / paintBar，标记是 ctx.marks.drawBar，与播放器同一画法）。
// 书签上弹出的（mark）：同一文件的各书签内容相同，只是这个书签在进度条上另有醒目的指针（.fc-pin，区段书签那一端则指在它的时间上），
// 它这一对标记高亮，并在最下一行显示它的时间和名称。
// 不可交互（inert、不接收指针）、不挡住所指的格子（优先放在右侧，其次左侧、下方、上方），夹在窗口内；popover（top layer），在 <dialog> 之上；
// 指针移开、焦点离开、按下指针即消失；所指的元素随滚动移动时跟着走，被移除或滚出窗口时消失。
//
// 接口（ctx.fileCard）：
// - attach(box, resolve)：在容器 box 上事件委托（适用于虚拟列表，容器只接一次）：指针移到、焦点进入 box 里的元素时调用 resolve(目标元素)，
//   返回 {el, book, page, mark?} 即为 el 弹出（page 不是视频、音频时不弹；mark 为书签 {id, end}，end 为区段书签那一端），返回 null 则收起；
//   指针离开 box、焦点移出 box 时收起。
// - show(el, {book, page, mark?})：为 el 弹出（列表自己管理选中项时用，如全屏界面里键盘移动的选中）；内容相同时不重画。
// - hide()：收起。
// - current()：当前所指的元素，没有为 null。
import { extend } from '../core/lang.mjs';
import { shownName, pageKind, clock } from '../core/model.mjs';
import { midName } from '../reader/view.mjs';

extend({
  fcPlaying: ['Playing', '正在播放', '再生中', '재생 중'],
});
const GAP = 8,
  EDGE = 4,
  TICK = 250; // 正在播放时刷新进度的间隔（毫秒）
const isMedia = (page) => !!page && pageKind(page) !== 'image';

export function install(ctx) {
  const { t, make, icon } = ctx;
  let card = null,
    head = null,
    meta = null,
    parts = null,
    pin = null,
    note = null,
    cur = null, // {el, book, page, mark, box}
    timer = 0,
    frame = 0;
  // 第一次弹出时才建（进度条要等播放器模块装好）。
  function build() {
    card = make('div', 'fc');
    card.popover = 'manual';
    card.inert = true;
    card.setAttribute('aria-hidden', 'true');
    head = make('div', 'fc-name');
    meta = make('div', 'fc-meta');
    parts = ctx.player?.seekBar(() => null) ?? null;
    note = make('div', 'fc-mark');
    card.append(head, meta);
    if (parts) {
      parts.bar.tabIndex = -1;
      pin = make('i', 'fc-pin');
      parts.bar.append(pin);
      card.append(parts.bar);
    }
    card.append(note);
    document.body.append(card);
  }
  const same = (a, b) =>
    a.el === b.el &&
    a.book === b.book &&
    a.page === b.page &&
    (a.mark?.id ?? null) === (b.mark?.id ?? null) &&
    !!a.mark?.end === !!b.mark?.end;
  function show(el, info, box = null) {
    if (!el?.isConnected || !info?.book || !isMedia(info.page)) return hide();
    const next = { el, book: info.book, page: info.page, mark: info.mark ?? null, box };
    if (cur && same(cur, next) && card?.matches(':popover-open')) {
      cur.box = box;
      return;
    }
    if (!card) build();
    cur = next;
    render(true);
    // 重新放进 top layer：之后才打开的对话框（全屏界面、选择起点）也盖不住它。
    if (card.matches(':popover-open')) card.hidePopover();
    card.showPopover();
    place();
    clearInterval(timer);
    timer = setInterval(tick, TICK);
  }
  function hide() {
    cur = null;
    clearInterval(timer);
    timer = 0;
    if (card?.matches(':popover-open')) card.hidePopover();
  }
  // 正在播放时刷新进度；所指的元素没了就收起。
  function tick() {
    if (!cur) return;
    if (!cur.el.isConnected) return hide();
    render(false);
  }
  function render(full) {
    const { book, page, mark } = cur,
      kind = pageKind(page),
      pos = ctx.player?.position?.(book, page) ?? { t: 0, d: page.d ?? null, playing: false },
      d = Number.isFinite(pos.d) && pos.d > 0 ? pos.d : null,
      now = Math.max(0, pos.t || 0);
    if (full) {
      const name = shownName(page);
      head.replaceChildren(icon(kind === 'audio' ? 'music' : 'film'), midName(name.slice(name.lastIndexOf('/') + 1)));
    }
    meta.textContent =
      t(kind === 'audio' ? 'mvAudio' : 'mvVideo') +
      (d ? ' · ' + clock(now) + ' / ' + clock(d) : now > 0 ? ' · ' + clock(now) : '') +
      (pos.playing ? ' · ' + t('fcPlaying') : '');
    card.classList.toggle('playing', !!pos.playing);
    if (parts) {
      parts.bar.hidden = !d;
      if (d) {
        ctx.player.paintBar(parts, { el: { duration: d }, page }, Math.min(d, now));
        if (full || !parts.bar.querySelector('.mv-marks')?._sig) ctx.marks?.drawBar(parts.bar, book, page, d, null);
      }
    }
    // 书签：指针指在它（或区段书签那一端）的时间上，它这一对标记高亮，最下一行是它的时间和名称。
    const bm = mark ? book.bookmarks?.find((b) => b.id === mark.id) : null,
      m = bm ? (mark.end ? bm.end : bm) : null,
      at = Number.isFinite(m?.t) ? m.t : null;
    if (pin) {
      pin.hidden = at == null || !d;
      if (at != null && d) pin.style.left = Math.min(100, Math.max(0, (at / d) * 100)) + '%';
      const layer = parts.bar.querySelector('.mv-marks');
      for (const el of layer?.children ?? [])
        el.classList.toggle(
          'hot',
          !!bm && (el.dataset.sec === bm.id || (el.classList.contains('mark') && +el.dataset.t === bm.t)),
        );
    }
    note.hidden = at == null;
    if (full && at != null) {
      const name = ctx.marks?.name(book, bm) ?? '';
      note.replaceChildren(
        icon(mark.end ? 'bm-end' : 'bookmark'),
        make('span', '', (mark.end ? t('secEnd') : t('bmWord')) + ' ' + clock(at) + (name ? ' · ' + name : '')),
      );
    }
  }
  // 放在格子旁边，不挡住它：右侧放得下放右侧，否则左侧，再否则下方、上方；夹在窗口内。
  function place() {
    if (!cur) return;
    const r = cur.el.getBoundingClientRect();
    if (!cur.el.isConnected || !r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)
      return hide();
    const w = card.offsetWidth,
      h = card.offsetHeight,
      midY = r.top + r.height / 2 - h / 2,
      midX = r.left + r.width / 2 - w / 2;
    let x, y;
    if (r.right + GAP + w <= innerWidth - EDGE) [x, y] = [r.right + GAP, midY];
    else if (r.left - GAP - w >= EDGE) [x, y] = [r.left - GAP - w, midY];
    else if (r.bottom + GAP + h <= innerHeight - EDGE) [x, y] = [midX, r.bottom + GAP];
    else [x, y] = [midX, r.top - GAP - h];
    card.style.left = Math.round(Math.min(innerWidth - w - EDGE, Math.max(EDGE, x))) + 'px';
    card.style.top = Math.round(Math.min(innerHeight - h - EDGE, Math.max(EDGE, y))) + 'px';
  }
  // 委托：容器里的元素由 resolve 认出；离开容器即收起。
  function attach(box, resolve) {
    const pick = (target) => {
      const info = target instanceof Element ? resolve(target) : null;
      if (info?.el && isMedia(info.page)) show(info.el, info, box);
      else if (cur?.box === box) hide();
    };
    box.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'touch') pick(e.target);
    });
    box.addEventListener('pointerleave', () => {
      if (cur?.box === box) hide();
    });
    box.addEventListener('focusin', (e) => pick(e.target));
    box.addEventListener('focusout', (e) => {
      if (cur?.box === box && !box.contains(e.relatedTarget)) hide();
    });
  }
  // 按下指针（点击跳转、拖动滚动）即收起；滚动时跟着所指的元素走（每帧至多一次）。
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener(
    'scroll',
    () => {
      if (cur && !frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
    },
    { capture: true, passive: true },
  );
  addEventListener('blur', hide);
  addEventListener('resize', hide);
  ctx.on('lang', () => {
    if (cur) render(true);
  });
  ctx.on('marks', (book) => {
    if (cur?.book === book) {
      const l = parts?.bar.querySelector('.mv-marks');
      if (l) l._sig = null;
      render(true);
    }
  });
  ctx.fileCard = { attach, show: (el, info) => show(el, info), hide, current: () => cur?.el ?? null };
}
