// 文件栏：总控栏里三区那一行上方的一行（行容器是 ctx.controlBar.fileRow，与总控栏一起弹出 / 收起、同宽），作用于当前文件
// （ctx.media.target()：选中的媒体，否则视窗中心所在的页，规则见 core/selection.mjs；书签快捷键、长按 A / D、Z 作用于同一个对象）。
// - 左：文件名，只显示最末一段（中间省略，完整路径在悬停提示里，可选中复制）；名称列宽度固定（约 24 字），长短不推动其他控件。
// - 中：播放 / 暂停（等同媒体自己的播放键）、进度条（书签与区段标记，media/marks.mjs；可点击、拖动）、当前时间 / 总时长；图片时留空（占位不变）。
// - 右：固定的按钮位（core/filebar.mjs SLOTS：字幕、添加书签、添加区段书签、设置为封面、全屏），只有图标，靠右对齐；这种文件没有的按钮留空位，
//   按钮位置不随文件类型跳动。字幕、添加书签、添加区段书签沿用 ctx.player.add 的登记（与音频卡片上的同一份），设置为封面是 ctx.actions.setCover，
//   全屏是 ctx.media.fullscreen。
// - 任何宽度都是一行、不溢出：先缩短文件名，再缩短进度条（CSS 的收缩权重，filebar.css），仍放不下时把次要按钮收进「⋯」（core/filebar.mjs fitLevel）。
// - 只在总控栏显示时更新：显示时取一次，之后随 'media' 事件（'current' 当前文件变了、'state' 播放 / 暂停、'time' 时间）更新；收起后不做任何工作。
import { extend } from '../core/lang.mjs';
import { shownName } from '../core/model.mjs';
import { SLOTS, slotsOf, arrange, fitLevel } from '../core/filebar.mjs';
import { make, icon } from '../ui/dom.mjs';
import { midName } from './view.mjs';

extend({
  fbBar: ['File bar', '文件栏', 'ファイルバー', '파일 바'],
});
// 宽度预算（像素，与 filebar.css / controlbar.css 一致）：按钮 36，按钮间距 2，栏内间距 6（#filebar 的 gap），中区内间距 4，
// 文件名、进度条缩到最小时的宽度 NAME_MIN、BAR_MIN。
const BTN = 36,
  GAP = 2,
  ROW_GAP = 6,
  MID_GAP = 4,
  NAME_MIN = 56,
  BAR_MIN = 56;
// 各按钮位的图标与文案（字幕、书签两项的文案和状态来自登记的按钮）。
const LOOK = {
  subs: { icon: 'subtitles', label: 'mvSubs' },
  bookmark: { icon: 'bookmark-plus', label: 'bmAdd' },
  section: { icon: 'bm-start', label: 'secAdd' },
  cover: { icon: 'cover', label: 'coverHere' },
  full: { icon: 'full-enter', label: 'mvFull' },
};

export function install(ctx) {
  const row = ctx.controlBar?.fileRow;
  if (!row) return;
  const { t } = ctx;
  const M = () => ctx.media,
    P = () => ctx.player;
  const showing = () => ctx.controlBar.showing();
  let tg = null; // 当前文件 {book, page, i, kind, player}
  const player = () => tg?.player ?? null;

  // ---- DOM
  const setIcon = (b, name) => b.querySelector('use').setAttribute('href', '#i-' + name);
  const setLabel = (b, text) => {
    if (b.title !== text) b.title = text;
    if (b.getAttribute('aria-label') !== text) b.setAttribute('aria-label', text);
  };
  function btn(cls, name, action) {
    const b = make('button', 'cb-btn ' + cls);
    b.type = 'button';
    b.append(icon(name));
    b.addEventListener('click', action);
    return b;
  }
  const name = make('div', 'fb-name');
  const mid = make('div', 'fb-mid'),
    play = btn('fb-play', 'play', () => {
      const p = player();
      if (p) M().press(p.node);
    }),
    seek = P().seekBar(() => (showing() ? player() : null)),
    time = make('span', 'fb-time');
  mid.append(play, seek.bar, time);
  const tools = make('div', 'fb-tools'),
    slots = {};
  for (const id of SLOTS) {
    const b = btn('fb-x', LOOK[id].icon, (e) => click(id, b, e));
    b.dataset.slot = id;
    if (id === 'subs') b.dataset.control = 'subs'; // 字幕菜单按 [data-control="subs"] 判断是否点在同一个按钮上（再点一次即收起）
    slots[id] = b;
  }
  const more = btn('cb-more fb-more', 'more', null),
    pop = make('div', 'cb-pop cb-more-pop fb-more-pop');
  pop.popover = 'auto';
  more.popoverTargetElement = pop;
  more.setAttribute('aria-haspopup', 'true');
  pop.addEventListener('click', (e) => {
    if (e.target.closest('button')?.parentElement === pop) pop.hidePopover();
  });
  // 打开前（同步）定位在总控栏上方、按钮居中、夹在窗口内：弹出层是一行固定尺寸的按钮。
  pop.addEventListener('beforetoggle', (e) => {
    more.setAttribute('aria-expanded', String(e.newState === 'open'));
    if (e.newState !== 'open') return;
    const n = [...pop.children].filter((c) => !c.classList.contains('fb-void')).length,
      r = more.getBoundingClientRect(),
      w = n * BTN + Math.max(0, n - 1) * GAP + 14,
      top = document.getElementById('controlbar').getBoundingClientRect().top;
    pop.style.left = Math.round(Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2))) + 'px';
    pop.style.top = Math.round(Math.max(4, top - BTN - 14 - 8)) + 'px';
  });
  row.append(name, mid, tools);
  row.hidden = false;

  // ---- 按钮的动作：媒体传入它的播放器；图片不传（书签、封面按视窗中心处）。
  const control = (id) =>
    P()
      ?.controls()
      .find((c) => c.id === id);
  function click(id, b) {
    const p = player();
    if (id === 'cover') ctx.actions.setCover?.(p ?? undefined);
    else if (id === 'full') p && M().fullscreen(p);
    else control(id)?.click?.(p ?? undefined, P().api, b);
    later();
  }

  // ---- 状态显示
  let shownPage = null,
    drawn = null, // 书签标记按哪个播放器、哪个时长画的：{p, d}
    level = -1;
  const has = () => slotsOf(tg?.kind);
  function refresh() {
    tg = M()?.target() ?? null;
    const p = player(),
      kinds = has();
    row.dataset.kind = tg?.kind ?? '';
    if (tg?.page !== shownPage) {
      shownPage = tg?.page ?? null;
      if (shownPage) {
        const full = shownName(shownPage),
          n = midName(full.slice(full.lastIndexOf('/') + 1));
        n.title = full;
        n.dataset.nodrag = '';
        name.replaceChildren(n);
      } else name.replaceChildren();
    }
    mid.classList.toggle('fb-void', !p);
    for (const id of SLOTS) slots[id].classList.toggle('fb-void', !kinds.has(id));
    states();
    progress();
  }
  function states() {
    const p = player(),
      failed = p?.state === 'failed',
      api = P().api,
      on = !!p && p.state === 'ready' && !p.el.paused;
    setIcon(play, on ? 'pause' : 'play');
    setLabel(play, t(on ? 'mvPause' : 'mvPlay'));
    play.disabled = !p || failed;
    mid.classList.toggle('playing', on);
    mid.classList.toggle('sec-only', !!p?.node.classList.contains('sec-only'));
    for (const id of SLOTS) {
      const b = slots[id],
        c = control(id);
      let s = {};
      if (id === 'subs') s = p && c?.state ? (c.state(p, api, b) ?? {}) : { disabled: true };
      else if (id === 'cover') s = { disabled: failed || !ctx.canSetCover?.(p ?? undefined) };
      else if (id === 'full') {
        const full = !!M().isFull?.(p);
        s = {
          disabled: !p || failed,
          pressed: full,
          icon: full ? 'full-exit' : 'full-enter',
          label: full ? 'mvExitFull' : 'mvFull',
        };
      } else s = { disabled: !tg || failed || !c };
      b.disabled = !!s.disabled;
      if (s.pressed != null) b.setAttribute('aria-pressed', String(!!s.pressed));
      else b.removeAttribute('aria-pressed');
      if (s.icon) setIcon(b, s.icon);
      setLabel(b, t(s.label ?? LOOK[id].label));
    }
    setLabel(more, t('cbMore'));
    row.setAttribute('aria-label', t('fbBar'));
  }
  // 进度与时间；时长变了（读到元数据）时按位数重设时间的宽度、重画书签标记。
  function progress() {
    const p = player(),
      text = P().paintBar(seek, p);
    time.textContent = p ? text : '';
    const d = p ? P().api.duration(p) : null;
    if (drawn?.p !== p || drawn.d !== d) {
      drawn = { p, d };
      const w = P().timeWidth(d) + 'ch';
      if (time.style.width !== w) {
        time.style.width = w;
        fit();
      }
      marks();
    }
  }
  function marks() {
    P().drawMarks?.(seek.bar, player());
  }

  // ---- 窄时：先缩短文件名、再缩短进度条（CSS），仍放不下时把次要按钮收进「⋯」。
  function fit() {
    if (!showing()) return;
    const base = NAME_MIN + ROW_GAP + BTN + MID_GAP + BAR_MIN + MID_GAP + time.offsetWidth + ROW_GAP,
      n = fitLevel(row.clientWidth, { base, slot: BTN, gap: GAP });
    if (n === level) return;
    level = n;
    if (pop.matches(':popover-open')) pop.hidePopover();
    const { row: inRow, more: inMore } = arrange(n);
    tools.replaceChildren(...inRow.map((id) => (id === 'more' ? more : slots[id])), ...(inMore.length ? [pop] : []));
    pop.replaceChildren(...inMore.map((id) => slots[id]));
    row.classList.toggle('compact', n > 0);
  }

  // ---- 更新：只在显示时
  let frame = 0;
  function later() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (showing()) refresh();
      });
  }
  ctx.on('controlbar', (on) => {
    if (on) {
      refresh();
      fit();
    } else if (pop.matches(':popover-open')) pop.hidePopover();
  });
  ctx.on('media', (key) => {
    if (!showing()) return;
    if (key === 'time') progress();
    else if (key === 'state') {
      states();
      progress();
    } else refresh();
  });
  const redraw = (book) => showing() && tg?.book === book && marks();
  ctx.on('marks', redraw);
  ctx.on('synced', (book, keys) => keys.includes('bookmarks') && redraw(book));
  ctx.on('lang', () => {
    if (!showing()) return;
    level = -1;
    refresh();
    fit();
  });
  new ResizeObserver(() => fit()).observe(row);
  refresh();
}
