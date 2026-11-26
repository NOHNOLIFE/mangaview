import { clock } from '../core/model.mjs';
import { list, isMedia } from '../marks/list.mjs';
// 播放器上的书签：进度条上的书签标记与区段、壳上的「添加书签」「添加区段书签」按钮。由 marks/bookmarks.mjs 安装（S 为书签模块的共享对象）。
export function install(ctx, S) {
  const { t, make } = ctx;
  // ---- 播放器上的书签（media.mjs 的 ctx.player）：壳上的「添加书签」「添加区段书签」按钮；进度条上按时间位置画出该文件全部书签的标记。
  // 普通书签是圆点，起点与区段书签是一对方括号；悬停或聚焦一对中的任意一个，两者之间的区段高亮，提示两端的时间与名称；点击跳到该标记的时间。
  // 区段在开启「只播放书签区段」时常显，区段以外的部分变暗（.sec-only，media.mjs）。
  function drawPlayer(p) {
    const d = ctx.player.api.duration(p),
      book = p.book,
      items =
        d && book.bookmarks?.length
          ? list(book).filter((x) => x.i >= 0 && isMedia(x.bm) && x.bm.name === p.page.name)
          : [];
    const sig =
      d + '|' + items.map((x) => [x.bm.id, x.bm.t, x.live ? x.bm.end.t : '', x.bm.label ?? ''].join(',')).join(';');
    if (p.marks._sig === sig) return;
    p.marks._sig = sig;
    const pct = (s) => Math.min(100, Math.max(0, (s / d) * 100)) + '%',
      out = [],
      spans = items.filter((x) => x.live).map((x) => [x.bm.t, x.bm.end.t]);
    // 变暗：区段以外的部分（没有区段时不画）。
    let from = 0;
    for (const [a, b] of spans) {
      if (a > from) out.push(dim(from, a));
      from = Math.max(from, b);
    }
    if (spans.length && from < d) out.push(dim(from, d));
    function dim(a, b) {
      const el = make('i', 'mv-dim');
      el.style.left = pct(a);
      el.style.width = ((b - a) / d) * 100 + '%';
      return el;
    }
    const name = (x) => (typeof x.bm.label === 'string' && x.bm.label ? ' · ' + x.bm.label : '');
    for (const x of items) {
      if (x.live) {
        const tip = t('secStart') + ' ' + clock(x.bm.t) + ' – ' + clock(x.bm.end.t) + name(x),
          span = make('i', 'mv-span');
        span.dataset.sec = x.bm.id;
        span.style.left = pct(x.bm.t);
        span.style.width = ((x.bm.end.t - x.bm.t) / d) * 100 + '%';
        out.push(
          span,
          marker(p, x.bm.t, 'start', tip, x.bm.id),
          marker(
            p,
            x.bm.end.t,
            'end',
            t('secEnd') + ' ' + clock(x.bm.end.t) + ' · ' + t('secStart') + ' ' + clock(x.bm.t) + name(x),
            x.bm.id,
          ),
        );
      } else out.push(marker(p, x.bm.t, 'mark', clock(x.bm.t) + name(x)));
    }
    p.marks.replaceChildren(...out);
  }
  function marker(p, s, kind, tip, sec) {
    const b = make('button', 'mv-mk ' + kind);
    b.type = 'button';
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.style.left = Math.min(100, Math.max(0, (s / ctx.player.api.duration(p)) * 100)) + '%';
    b.dataset.t = s;
    if (sec) b.dataset.sec = sec;
    return b;
  }
  // 标记层里的事件：按下不触发进度条的拖动定位，点击跳到标记的时间；悬停 / 聚焦一对中的任意一个，两者及区段一起高亮。
  function hotPair(layer, id) {
    for (const el of layer.querySelectorAll('[data-sec]')) el.classList.toggle('hot', el.dataset.sec === id);
  }
  function wire(p) {
    const layer = p.marks;
    if (layer._wired) return;
    layer._wired = true;
    layer.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.mv-mk')) {
        e.stopPropagation();
        e.preventDefault();
      }
    });
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('.mv-mk');
      if (!b) return;
      e.stopPropagation();
      ctx.player.api.seek(p, +b.dataset.t);
    });
    layer.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.mv-mk');
      hotPair(layer, b?.dataset.sec ?? null);
    });
    layer.addEventListener('pointerleave', () =>
      hotPair(layer, layer.contains(document.activeElement) ? (document.activeElement.dataset.sec ?? null) : null),
    );
    layer.addEventListener('focusin', (e) => hotPair(layer, e.target.dataset?.sec ?? null));
    layer.addEventListener('focusout', () => hotPair(layer, null));
  }
  // media.mjs 在 bookmarks.mjs 之后安装：等安装完再登记到播放器。
  queueMicrotask(() => {
    if (!ctx.player) return;
    ctx.player.decorate((p) => {
      wire(p);
      drawPlayer(p);
    });
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
  S.drawPlayer = drawPlayer;
}
