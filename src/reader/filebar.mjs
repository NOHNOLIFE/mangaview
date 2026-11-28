// 文件栏：总控栏里三区那一行上方的两行（行容器是 ctx.controlBar.fileRow，与总控栏一起弹出 / 收起、同宽），作用于当前文件
// （ctx.media.target()：在播放的当前曲目——不在视窗里、在别的书里也一样；暂停的当前曲目只在本书、中线在视窗内时；否则视窗中心所在的页，
// 规则见 core/selection.mjs fileTarget；长按 A / D、空格作用于同一个对象）。
// - 上行（标题行）：文件名在行的正中（只显示最末一段、不带扩展名，过长省略中间、放不下时向左让出；完整路径在悬停提示里，可选中复制），
//   右端是标题行按钮区（.fb-head-tools）：
//   「定位」（主窗口跳到当前曲目所在的页，必要时切书；没有当前曲目时禁用），其后是「画中画」（media/pip.mjs 登记，order 20；浏览器不支持时没有）。
//   往标题行右端加按钮：ctx.fileBar.addHead({id, icon, label(文案 key), order?, click(当前文件), state?(当前文件)→{disabled,pressed,icon,label}})，
//   按 order 从小到大排在文件名后面、行的右端（「定位」10、「画中画」20，默认 50，同值按登记顺序）；当前文件为 {book, page, i, kind, player}
//   （没有为 null），文件变了、当前曲目变了或播放状态变了时重新取 state。
// - 下行：播放 / 暂停（等同媒体自己的播放键）、进度条（书签与区段标记，media/marks.mjs；可点击、拖动）、当前时间 / 总时长，右侧按钮；
//   图片时播放键、进度条、时间留空（占位不变）。时间处悬停或键盘聚焦时原位换成「快退」「快进」（media/shell.mjs makeTime，与音频卡片共用）。
// - 右侧按钮：三个固定的按钮位（core/filebar.mjs arrange）：直接显示「添加书签」「添加区段书签」，其余收进第三个位上的「⋯」
//   （悬停展开，ui/hoverpop.mjs），按钮总数不超过 3 个时全部直接显示；这种文件没有的位置留空，按钮位置不随文件类型跳动。
//   添加书签、添加区段书签沿用 ctx.player.add 的登记（与音频卡片上的同一份），设置为封面是 ctx.actions.setCover，全屏是 ctx.media.fullscreen。
//   字幕按钮在总控栏右区（controlbar.mjs）。
// - 任何宽度都不横向溢出：先缩短文件名（标题行），下行由进度条让出宽度（filebar.css）。
// - 只在总控栏显示时更新：显示时取一次，之后随 'media' 事件（'current' 当前文件变了、'state' 播放 / 暂停、'time' 时间）更新；收起后不做任何工作。
import { extend } from '../core/lang.mjs';
import { shownName, stem } from '../core/model.mjs';
import { BUTTONS, buttonsOf, arrange } from '../core/filebar.mjs';
import { make, icon } from '../ui/dom.mjs';
import { morePop } from '../ui/hoverpop.mjs';
import { midName } from './view.mjs';

extend({
  fbBar: ['File bar', '文件栏', 'ファイルバー', '파일 바'],
  fbLocate: ['Locate', '定位', '場所へ移動', '위치로 이동'],
});
// 各按钮的图标与文案。
const LOOK = {
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
    if (action) b.addEventListener('click', action);
    return b;
  }
  // 上行：文件名 + 标题行按钮区。
  const head = make('div', 'fb-head'),
    name = make('div', 'fb-name'),
    headTools = make('div', 'fb-head-tools');
  head.append(name, headTools);
  // 下行：播放键、进度条、时间（悬停换成快退 / 快进），右侧三个按钮位。
  const line = make('div', 'fb-line'),
    mid = make('div', 'fb-mid'),
    play = btn('fb-play', 'play', () => {
      const p = player();
      if (p) M().press(p, 'bar');
    }),
    seek = P().seekBar(() => (showing() ? player() : null)),
    time = P().timeBox(() => (showing() ? player() : null), 'fb-time');
  mid.append(play, seek.bar, time.box);
  const tools = make('div', 'fb-tools'),
    slots = {};
  for (const id of BUTTONS) {
    const b = btn('fb-x', LOOK[id].icon, () => click(id, b));
    b.dataset.slot = id;
    slots[id] = b;
  }
  const more = btn('cb-more fb-more', 'more', null),
    pop = make('div', 'cb-pop fb-more-pop'),
    moreH = morePop(more, pop),
    voids = Array.from({ length: 3 }, () => make('span', 'fb-place fb-void'));
  line.append(mid, tools);
  row.append(head, line, pop);
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
  // ---- 标题行右端的按钮（ctx.fileBar.addHead）。
  const heads = [];
  function addHead(spec) {
    const b = btn('fb-h', spec.icon, () => {
      spec.click?.(tg);
      later();
    });
    b.dataset.head = spec.id;
    heads.push({ spec, b });
    heads.sort((x, y) => (x.spec.order ?? 50) - (y.spec.order ?? 50)); // 稳定排序：同值按登记顺序
    headTools.replaceChildren(...heads.map((h) => h.b));
    if (showing()) states();
    return b;
  }

  // ---- 状态显示
  let shownPage = null,
    shownKind = undefined,
    drawn = null; // 书签标记按哪个播放器、哪个时长画的：{p, d}
  function refresh() {
    tg = M()?.target() ?? null;
    const p = player();
    row.dataset.kind = tg?.kind ?? '';
    if (tg?.page !== shownPage) {
      shownPage = tg?.page ?? null;
      if (shownPage) {
        const full = shownName(shownPage),
          n = midName(stem(full.slice(full.lastIndexOf('/') + 1)));
        n.title = full;
        n.dataset.nodrag = '';
        name.replaceChildren(n);
      } else name.replaceChildren();
    }
    mid.classList.toggle('fb-void', !p);
    place(tg?.kind);
    states();
    progress();
  }
  // 三个按钮位：按文件类型放按钮、「⋯」或空位（位置固定）。
  function place(kind) {
    if (kind === shownKind) return;
    shownKind = kind;
    moreH.hide();
    const { row: places, more: inMore } = arrange(kind);
    tools.replaceChildren(...places.map((id, i) => (id === 'more' ? more : id ? slots[id] : voids[i])));
    pop.replaceChildren(...inMore.map((id) => slots[id]));
  }
  function states() {
    const p = player(),
      failed = p?.state === 'failed',
      api = P().api,
      on = !!p && p.state === 'ready' && !p.el.paused;
    setIcon(play, on ? 'pause' : 'play');
    setLabel(play, t(on ? 'mvPause' : 'mvPlay'));
    play.disabled = !p || failed;
    time.sync(p);
    mid.classList.toggle('playing', on);
    mid.classList.toggle('sec-only', !!p?.node.classList.contains('sec-only'));
    const has = new Set(buttonsOf(tg?.kind));
    for (const id of BUTTONS) {
      const b = slots[id],
        c = control(id);
      let s = {};
      if (!has.has(id)) s = { disabled: true };
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
      setIcon(b, s.icon ?? LOOK[id].icon);
      setLabel(b, t(s.label ?? LOOK[id].label));
    }
    more.disabled = !tg || failed;
    setLabel(more, t('cbMore'));
    for (const { spec, b } of heads) {
      const s = spec.state?.(tg) ?? {};
      b.disabled = !!s.disabled;
      if (s.pressed != null) b.setAttribute('aria-pressed', String(!!s.pressed));
      else b.removeAttribute('aria-pressed');
      setIcon(b, s.icon ?? spec.icon);
      setLabel(b, t(s.label ?? spec.label));
    }
    row.setAttribute('aria-label', t('fbBar'));
  }
  // 进度与时间；时长变了（读到元数据）时按位数重设时间的宽度、重画书签标记。
  function progress() {
    const p = player(),
      text = P().paintBar(seek, p);
    time.text.textContent = p ? text : '';
    const d = p ? P().api.duration(p) : null;
    if (drawn?.p !== p || drawn.d !== d) {
      drawn = { p, d };
      time.size(d);
      marks();
    }
  }
  function marks() {
    P().drawMarks?.(seek.bar, player());
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
    if (on) refresh();
    else moreH.hide();
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
    refresh();
  });
  refresh();
  // addHead：往标题行右端加按钮（见文件开头）；refresh()：立即按当前文件重画。
  ctx.fileBar = { addHead, refresh: later };
  // 标题行的「定位」：作用于当前曲目（播放列表 ctx.media.queue），没有当前曲目时禁用。
  const Q = () => ctx.media?.queue;
  addHead({
    id: 'locate',
    icon: 'locate',
    label: 'fbLocate',
    order: 10,
    click: () => Q()?.locate(),
    state: () => ({ disabled: !Q()?.track() }),
  });
}
