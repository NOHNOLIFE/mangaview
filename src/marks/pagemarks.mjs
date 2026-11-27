import { at } from '../core/model.mjs';
import { pageMarks, sig } from './list.mjs';
// 页上的书签标记：缩略图的角标（缩略图栏、全屏缩略图共用），以及缩略图栏上按页内位置画的细标记。每页的标记汇总见 list.mjs 的 pageMarks。
export function install(ctx, S) {
  const { view, make, icon } = ctx;
  // 角标：标记种类的图标（普通 / 起点 / 区段书签），书签多于一个时带数量。绝对定位叠在缩略图一角，不改变排布。
  function badge(m) {
    const el = make('span', 'mk');
    el.setAttribute('aria-hidden', 'true');
    for (const k of ['mark', 'start', 'end'])
      if (m[k]) {
        const i = icon(k === 'mark' ? 'bookmark' : 'bm-' + k);
        if (k !== 'mark') i.classList.add('sec'); // 区段的标记用区段配色（--sec）
        el.append(i);
      }
    if (m.n > 1) el.append(make('b', '', String(m.n)));
    return el;
  }

  // 缩略图栏：在正文的等比缩小长条上，为有书签的页叠一层标记（角标 + 按页内位置画的细标记：普通书签一道横线，起点与区段书签是一对方括号，
  // 嵌套的区段按层级（list.mjs 的 lv，最多 3 级）向内缩进）。
  // 标记层在长条之外（切书时长条被清空也不受影响），只随排版（ctx.on('layout')）重新定位；书签变化时只重建内容变了的那几页。
  const nav = document.getElementById('preview'),
    layer = make('div', 'pv-marks'),
    bar = new Map();
  layer.setAttribute('aria-hidden', 'true');
  nav.append(layer);
  function drawBar(reset = false) {
    if (reset) {
      bar.clear();
      layer.replaceChildren();
    }
    const book = ctx.current,
      s = view.panes[1].starts,
      ok = book && s.length === book.pages.length + 1,
      marks = ok ? pageMarks(book) : new Map(),
      seen = new Set();
    for (const [i, m] of marks) {
      const name = book.pages[i].name,
        k = sig(m);
      let r = bar.get(name);
      seen.add(name);
      if (!r) {
        r = { el: make('div', 'pv-mk'), sig: null };
        r.el.dataset.name = name;
        bar.set(name, r);
        layer.append(r.el);
      }
      if (r.sig !== k) {
        r.sig = k;
        r.el.replaceChildren(
          badge(m),
          ...m.ticks.map((t) => {
            const d = make('i', 'tick ' + t.kind);
            d.style.top = t.f * 100 + '%';
            if (t.kind !== 'mark') {
              d.dataset.sec = t.id;
              d.style.setProperty('--lv', t.lv ?? 0);
            }
            return d;
          }),
        );
      }
      r.el.style.top = s[i] + 'px';
      r.el.style.height = s[i + 1] - s[i] + 'px';
    }
    for (const [name, r] of bar)
      if (!seen.has(name)) {
        r.el.remove();
        bar.delete(name);
      }
  }
  // 指针所在的页有起点或区段书签时，同一对的两个细标记一起高亮（只提示）。
  let hot = '';
  function heat(ids) {
    const k = [...ids].join();
    if (k === hot) return;
    hot = k;
    for (const el of layer.querySelectorAll('.tick[data-sec]')) el.classList.toggle('hot', ids.has(el.dataset.sec));
  }
  nav.addEventListener('pointermove', (e) => {
    const book = ctx.current,
      s = view.panes[1].starts;
    if (!book || s.length !== book.pages.length + 1) return;
    const { i } = at(s, e.clientY - nav.getBoundingClientRect().top + nav.scrollTop),
      r = bar.get(book.pages[i]?.name);
    heat(new Set(r ? [...r.el.querySelectorAll('.tick[data-sec]')].map((el) => el.dataset.sec) : []));
  });
  nav.addEventListener('pointerleave', () => heat(new Set()));
  ctx.on('layout', () => drawBar());
  ctx.on('marks', (book) => {
    if (book === ctx.current) drawBar();
  });
  ctx.on('select', () => drawBar(true));
  S.badge = badge;
}
