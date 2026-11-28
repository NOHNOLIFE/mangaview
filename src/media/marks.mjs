import { clock } from '../core/model.mjs';
import { union } from '../core/sections.mjs';
import { list, isMedia } from '../marks/list.mjs';
// 播放器上的书签：进度条上的书签标记与区段、「添加书签」「添加区段书签」按钮（音频卡片与文件栏）。由 marks/bookmarks.mjs 安装（S 为书签模块的共享对象）。
// 进度条标记只依赖进度条元素本身（drawBar / wireBar：给一个进度条和它的书、页、时长、定位函数就能画、能交互），不依赖它所在的面板。
const NEAR = 9; // 指针离标记这么多像素以内算指向它（挤在一起时取最近的）
export function install(ctx, S) {
  const { t, make } = ctx;
  // ---- 进度条上的书签：按时间位置画出该文件的全部书签。普通书签是轨道上的圆点；起点与区段书签是一对方括号，各在自己的时间点上（不连线、不分层）。
  // 指针指向某个标记（标记挤在一起时取离指针最近的）：只高亮它这一对（区段的两个方括号，两者之间的一段在轨道上以区段配色显示），
  // 提示两端的时间与名称；点击跳到该标记的时间。键盘聚焦标记同样。
  // 开启「只播放书签区段」时（.sec-only，shell.mjs），各区段常显（即所有区段的并集），并集以外变暗。
  function drawBar(bar, book, page, d, seek) {
    let layer = bar.querySelector(':scope>.mv-marks');
    if (!layer) bar.append((layer = make('div', 'mv-marks')));
    wireBar(bar, layer);
    layer._seek = seek;
    const items =
      d && book.bookmarks?.length ? list(book).filter((x) => x.i >= 0 && isMedia(x.bm) && x.bm.name === page.name) : [];
    const sig =
      d + '|' + items.map((x) => [x.bm.id, x.bm.t, x.live ? x.bm.end.t : '', S.name(book, x.bm)].join(',')).join(';');
    if (layer._sig === sig) return;
    layer._sig = sig;
    hot(layer, null);
    const pct = (s) => Math.min(100, Math.max(0, (s / d) * 100)) + '%',
      out = [],
      marks = [],
      secs = items.filter((x) => x.live);
    // 变暗：所有区段的并集以外的部分（没有区段时不画）。
    let from = 0;
    for (const s of union(secs.map((x) => ({ a: x.bm.t, b: x.bm.end.t })))) {
      if (s.a > from) out.push(dim(from, s.a));
      from = s.b;
    }
    if (secs.length && from < d) out.push(dim(from, d));
    function dim(a, b) {
      const el = make('i', 'mv-dim');
      el.style.left = pct(a);
      el.style.width = ((b - a) / d) * 100 + '%';
      return el;
    }
    const name = (x) => (S.name(book, x.bm) ? ' · ' + S.name(book, x.bm) : '');
    for (const x of items) {
      if (!x.live) {
        const tip = clock(x.bm.t) + name(x);
        out.push(marker(x.bm.t, 'mark', tip));
        continue;
      }
      const tip = t('secStart') + ' ' + clock(x.bm.t) + ' – ' + clock(x.bm.end.t) + name(x),
        span = make('i', 'mv-span');
      span.dataset.sec = x.bm.id;
      span.style.left = pct(x.bm.t);
      span.style.width = ((x.bm.end.t - x.bm.t) / d) * 100 + '%';
      out.push(
        span,
        marker(x.bm.t, 'start', tip, x.bm.id),
        marker(
          x.bm.end.t,
          'end',
          t('secEnd') + ' ' + clock(x.bm.end.t) + ' · ' + t('secStart') + ' ' + clock(x.bm.t) + name(x),
          x.bm.id,
        ),
      );
    }
    function marker(s, kind, tip, sec) {
      const b = make('button', 'mv-mk ' + kind);
      b.type = 'button';
      b.setAttribute('aria-label', tip);
      b.style.left = pct(s);
      b.dataset.t = s;
      b.dataset.tip = tip;
      if (sec) b.dataset.sec = sec;
      marks.push(b);
      return b;
    }
    layer.replaceChildren(...out);
    layer._marks = marks;
  }
  // 提示：一个浮在最上层（popover）的小条，跟着指向 / 聚焦的标记，不受面板裁切（视频全屏时也在最上层）。
  let tipEl = null;
  function tip(b) {
    if (!tipEl) {
      tipEl = make('div', 'mv-tip');
      tipEl.popover = 'manual';
      tipEl.setAttribute('aria-hidden', 'true');
      document.body.append(tipEl);
    }
    if (!b) {
      if (tipEl.matches(':popover-open')) tipEl.hidePopover();
      return;
    }
    tipEl.textContent = b.dataset.tip;
    if (!tipEl.matches(':popover-open')) tipEl.showPopover();
    const r = b.getBoundingClientRect(),
      w = tipEl.offsetWidth,
      h = tipEl.offsetHeight;
    tipEl.style.left = Math.round(Math.min(innerWidth - w - 4, Math.max(4, r.left + r.width / 2 - w / 2))) + 'px';
    tipEl.style.top = Math.round(r.top - h - 6 < 4 ? r.bottom + 6 : r.top - h - 6) + 'px';
  }
  // 指向 / 聚焦的标记（null 为没有）：区段的一对（两个方括号和两者之间的一段）一起高亮，普通书签只高亮它自己。
  function hot(layer, b) {
    if (layer._hot === b) return;
    layer._hot = b;
    const id = b?.dataset.sec ?? null;
    for (const el of layer.children)
      el.classList.toggle('hot', !!b && (el === b || (id != null && el.dataset.sec === id)));
    tip(b);
  }
  // 离指针最近的标记：圆点按到它的距离，方括号按到它那一竖的距离；NEAR 像素以外为 null。
  function nearest(layer, e) {
    let best = null,
      gap = NEAR;
    const box = layer.getBoundingClientRect();
    for (const b of layer._marks ?? []) {
      const r = b.getBoundingClientRect(),
        cx = box.left + (parseFloat(b.style.left) / 100) * box.width, // 标记所在的时间点（方括号那一竖、圆点的中心）
        dy = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0,
        g = Math.hypot(e.clientX - cx, dy);
      if (g < gap) {
        gap = g;
        best = b;
      }
    }
    return best;
  }
  // 交互接在进度条上（标记本身不接收指针）：指向标记时按下不触发进度条的拖动定位，点击跳到该标记的时间；键盘聚焦标记时同样高亮和提示。
  function wireBar(bar, layer) {
    if (layer._wired) return;
    layer._wired = true;
    let down = null;
    bar.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' && !e.buttons) hot(layer, nearest(layer, e));
    });
    bar.addEventListener('pointerleave', () => {
      const f = document.activeElement;
      hot(layer, layer.contains(f) ? f : null);
    });
    bar.addEventListener(
      'pointerdown',
      (e) => {
        down = e.button === 0 ? nearest(layer, e) : null;
        if (!down) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        hot(layer, down);
      },
      true,
    );
    bar.addEventListener(
      'click',
      (e) => {
        const b = e.target.closest('.mv-mk') ?? down;
        down = null;
        if (!b || !layer.contains(b)) return;
        e.stopPropagation();
        layer._seek?.(+b.dataset.t);
      },
      true,
    );
    layer.addEventListener('focusin', (e) => hot(layer, e.target.closest('.mv-mk')));
    layer.addEventListener('focusout', (e) => {
      if (!layer.contains(e.relatedTarget)) hot(layer, null);
    });
  }
  // 播放器（media.mjs 的 ctx.player）的进度条：音频卡片上的（视频画面内没有）；文件栏的进度条经 ctx.player.drawMarks(进度条, 播放器) 画，没有播放器时清空。
  const drawFor = (bar, p) =>
    p
      ? drawBar(bar, p.book, p.page, ctx.player.api.duration(p), (s) => ctx.player.api.seek(p, s))
      : drawBar(bar, null, null, 0, null);
  const drawPlayer = (p) => p.bar && drawFor(p.bar, p);
  // media.mjs 在 bookmarks.mjs 之后安装：等安装完再登记到播放器。
  queueMicrotask(() => {
    if (!ctx.player) return;
    ctx.player.drawMarks = drawFor;
    ctx.player.decorate(drawPlayer);
    ctx.player.add({
      id: 'bookmark',
      icon: 'bookmark-plus',
      label: 'bmAdd',
      order: 20,
      click: (p) => ctx.safe(S.add)(p),
    });
    ctx.player.add({
      id: 'section',
      icon: 'bm-start',
      label: 'secAdd',
      order: 21,
      click: (p) => ctx.safe(S.addSection)(p),
    });
  });
  Object.assign(S, { drawPlayer, drawBar });
}
