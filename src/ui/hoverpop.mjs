// 悬停 / 聚焦弹出的浮层：总控栏的速率、音量、播放模式小面板与「⋯」，文件栏与音频卡片的「⋯」共用。
// - 指针悬停或键盘聚焦按钮时在按钮正上方弹出（水平居中、夹在窗口内，placeAbove），移开（或焦点离开）后稍等收起。
// - 同一时间只显示一组：弹出一个时收起其他的；嵌套的除外（「⋯」里的速率按钮弹出自己的小面板时「⋯」保持打开，
//   指针停在里层面板上外层不收起，里层收起后外层再按指针位置决定是否收起）。Esc 全部收起。
// - 浮层用 popover="manual"（top layer，显示在 <dialog> 之上，不靠 z-index）；与按钮之间的空隙由浮层下方的透明延伸区
//   （style.css .hover-pop::after）补上，指针经过时不会收起。
// 接口：hoverPop(按钮, 浮层, onShow?) → {show, hide, open}（onShow 在弹出后调用，重画内容）；
//   morePop(按钮, 浮层) → 同上，另外点击按钮也弹出（不收起：悬停已弹出时点击不会把它关掉），点了浮层里的按钮即收起
//   （带 .keep-pop 的除外，如速率按钮：它的小面板接着用）；按钮带 aria-haspopup / aria-expanded。
const CLOSE = 220; // 指针离开后多久收起（毫秒）
const open = []; // 打开着的浮层（外层在前）：{btn, pop, hide, check}

// 定位：按钮正上方 8px，水平居中，夹在窗口内（浮层已显示，尺寸可读）。
export function placeAbove(btn, pop) {
  const r = btn.getBoundingClientRect(),
    w = pop.offsetWidth,
    h = pop.offsetHeight;
  pop.style.left = Math.round(Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2))) + 'px';
  pop.style.top = Math.round(Math.max(4, r.top - h - 8)) + 'px';
}

export function hoverPop(btn, pop, onShow) {
  pop.popover = 'manual';
  pop.classList.add('hover-pop');
  let timer = 0;
  const isOpen = () => pop.matches(':popover-open');
  const me = { btn, pop, hide, check };
  // 里层：按钮在这个浮层里的、打开着的浮层。
  const inner = () => open.filter((o) => o !== me && pop.contains(o.btn));
  const hovered = (o) => o.btn.matches(':hover') || o.pop.matches(':hover');
  const within = () => {
    const a = document.activeElement;
    return (a === btn && btn.matches(':focus-visible')) || pop.contains(a);
  };
  const busy = () =>
    hovered(me) || within() || inner().some((o) => hovered(o) || o.pop.contains(document.activeElement));
  function show() {
    clearTimeout(timer);
    if (btn.disabled || isOpen() || !btn.isConnected) return;
    for (const o of [...open].reverse()) if (!o.pop.contains(btn)) o.hide();
    open.push(me);
    pop.showPopover();
    placeAbove(btn, pop);
    onShow?.();
  }
  function hide() {
    clearTimeout(timer);
    for (const o of inner().reverse()) o.hide();
    const i = open.indexOf(me);
    if (i >= 0) open.splice(i, 1);
    if (isOpen()) pop.hidePopover();
  }
  // 里层收起后：外层按指针与焦点的位置决定是否也收起。
  function check() {
    if (isOpen() && !busy()) hide();
  }
  function leaveSoon() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (busy()) return;
      const outer = open.filter((o) => o !== me && o.pop.contains(btn));
      hide();
      for (const o of outer.reverse()) o.check();
    }, CLOSE);
  }
  for (const el of [btn, pop]) {
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') show();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') leaveSoon();
    });
    el.addEventListener('focusout', () => queueMicrotask(() => !within() && leaveSoon()));
  }
  btn.addEventListener('focus', () => {
    if (btn.matches(':focus-visible')) show();
  });
  pop.addEventListener('focusin', () => clearTimeout(timer));
  // 浏览器自己收起（如另一个 popover 打开）时同步记录。
  pop.addEventListener('toggle', (e) => {
    if (e.newState === 'closed' && open.includes(me)) hide();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  return { show, hide, open: isOpen };
}

export function morePop(btn, pop) {
  btn.popoverTargetElement = pop; // 浮层与按钮的关联（读屏、键盘）；点击只弹出、不收起
  btn.popoverTargetAction = 'show';
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  pop.addEventListener('toggle', (e) => btn.setAttribute('aria-expanded', String(e.newState === 'open')));
  const h = hoverPop(btn, pop);
  btn.addEventListener('click', () => h.show());
  pop.addEventListener('click', (e) => {
    const hit = e.target.closest('button');
    if (hit?.parentElement === pop && !hit.matches('.keep-pop')) h.hide();
  });
  return h;
}
