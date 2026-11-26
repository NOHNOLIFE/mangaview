// 顶部工具栏：鼠标贴近顶缘稍作停留即弹出、移开后收起（showBar），平时不可见的菜单按钮供键盘打开；窄窗口自动换行。
// 底部操作栏见 endbar.mjs。
import { extend } from '../core/lang.mjs';
import { $, fade, showing } from '../ui/dom.mjs';
import { updateProgress } from './shell.mjs';
extend({
  tbEdgeTop: [
    'Show tools at the top edge',
    '鼠标移到顶缘时弹出工具栏',
    '上端でツールを表示',
    '위쪽 가장자리에서 도구 표시',
  ],
});
export const DWELL = 120,
  LEAVE = 450; // 边缘触发区的距离四边统一，见 app.mjs 的 ctx.atEdge
export const bar = $('bar'),
  toolbar = $('toolbar'),
  tab = $('tab');
let barTimer;
export function showBar(open) {
  clearTimeout(barTimer);
  fade(bar, open);
  toolbar.classList.toggle('open', open);
  tab.setAttribute('aria-expanded', String(open));
  if (open) updateProgress();
}
export function bindBar() {
  // 菜单按钮平时不可见，只供键盘（Tab 聚焦后回车）打开，打开后焦点移到第一个按钮。
  tab.onclick = () => {
    const keyboard = document.activeElement === tab;
    showBar(true);
    if (keyboard) bar.querySelector('.tb:not([hidden])')?.focus();
  };
  toolbar.onpointerenter = (e) => {
    clearTimeout(barTimer);
    if (e.pointerType === 'mouse' && !showing(bar)) showBar(true);
  };
  toolbar.onpointerleave = () => {
    clearTimeout(barTimer);
    if (!toolbar.querySelector(':focus-visible')) barTimer = setTimeout(() => showBar(false), 450);
  };
  toolbar.onfocusout = () =>
    queueMicrotask(() => {
      if (!toolbar.contains(document.activeElement) && !toolbar.matches(':hover')) showBar(false);
    });
}
export function install(ctx) {
  // 书签、设置由其他模块注册 action；模块在本模块之后安装，所以延后检查，未注册时隐藏按钮。
  const sync = () => {
    for (const el of bar.querySelectorAll('[data-optional]')) el.hidden = !ctx.actions[el.dataset.act];
  };
  ctx.dropKey('toolbarColumns'); // 旧版的单列 / 双列设置

  // 按钮只显示图标（操作栏放不下时也只显示图标）：把（已本地化的）文字写进 title 作为悬停提示，切换语言时同步。
  const tips = () => {
    for (const el of bar.querySelectorAll('.tb')) el.title = el.querySelector('span')?.textContent ?? '';
  };
  queueMicrotask(sync);
  ctx.on('select', sync);
  // 换行后，落在行首或行尾的分隔线隐藏：前后两个可见按钮不在同一行即是。
  const edges = () => {
    if (bar.hidden) return;
    for (const s of bar.querySelectorAll('.sep')) {
      let a = s.previousElementSibling,
        b = s.nextElementSibling;
      while (a?.hidden) a = a.previousElementSibling;
      while (b?.hidden) b = b.nextElementSibling;
      s.classList.toggle('edge', !a || !b || a.offsetTop !== b.offsetTop);
    }
  };
  new ResizeObserver(edges).observe(bar);
  const dialog = () => document.querySelector('dialog[open]');
  // 顶缘：窗口控件覆盖区（--top）以下的边缘触发区内。菜单按钮平时不可见，但位置仍在左上角（--top + 8px）。
  const topInset = () => tab.getBoundingClientRect().top - 8;
  // 正在显示的侧栏（常驻或浮动弹出）顶部是它们的头部行（含“打开全屏”按钮），这一段不算顶缘，避免在按钮上停留时误弹工具栏。
  const sides = [$('panel'), $('shelfmarks')];
  const overSide = (x) =>
    sides.some((el) => {
      if (!el || el.hidden) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right;
    });
  let edgeTimer = 0,
    leaveTimer = 0,
    auto = false;
  const cancel = () => {
      clearTimeout(edgeTimer);
      edgeTimer = 0;
    },
    stay = () => {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    };
  new MutationObserver(() => {
    if (bar.hidden) {
      auto = false;
      stay();
    } else {
      sync();
      edges();
    }
  }).observe(bar, { attributes: true, attributeFilter: ['hidden'] });

  document.addEventListener('pointermove', (e) => {
    const mouse = e.pointerType === 'mouse' && !e.buttons;
    // 顶缘弹出工具栏
    const near =
      mouse &&
      ctx.atEdge('top', e, topInset()) &&
      bar.hidden &&
      !dialog() &&
      !overSide(e.clientX) &&
      ctx.get('edgeTop', true);
    if (!near) cancel();
    else if (!edgeTimer)
      edgeTimer = setTimeout(() => {
        edgeTimer = 0;
        if (bar.hidden && !dialog()) {
          ctx.showBar(true);
          auto = true;
        }
      }, DWELL);
    // 面板在指针下方出现时浏览器未必补发 pointerenter，指针直接移走就收不到 pointerleave，这里兜底收起。
    if (auto && !bar.hidden && e.pointerType === 'mouse') {
      if (toolbar.contains(e.target)) stay();
      else if (!leaveTimer)
        leaveTimer = setTimeout(() => {
          leaveTimer = 0;
          if (!toolbar.matches(':hover') && !toolbar.querySelector(':focus-visible')) ctx.showBar(false);
        }, LEAVE);
    }
  });
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) cancel();
  });
  tips();
  ctx.on('lang', tips);
  ctx.prefs?.sync('edgeTop');
  ctx.settings.push({
    id: 'edgeTop',
    group: 'toolbar',
    label: 'tbEdgeTop',
    type: 'toggle',
    get: () => ctx.get('edgeTop', true),
    set: (v) => ctx.put('edgeTop', !!v),
  });
}
