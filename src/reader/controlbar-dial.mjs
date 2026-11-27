// 总控栏上悬停弹出的小面板：速率、音量（dial）与播放模式。指针悬停或键盘聚焦按钮时在按钮上方弹出（hoverPop），
// 移开（或焦点离开）后收起；同一时间只显示一个。小面板用 popover（top layer），位置按按钮计算、夹在窗口内；
// 与按钮之间的空隙由面板下方的透明延伸区（.cb-hover::after）补上，指针经过时不会收起。
// dial：按钮显示数字或图标，面板是滑杆 + 常用档位（音量另有静音）；在按钮上滚轮、按方向键直接逐档调整；点击按钮由调用方决定（速率回到 1.0×，音量静音）。
import { make } from '../ui/dom.mjs';

const CLOSE = 220; // 指针离开后多久收起（毫秒）
let shown = null; // 同一时间只显示一个小面板

// 悬停 / 聚焦弹出：btn 与 pop（已设 popover="manual"）。onShow 在弹出后调用（重画内容）。返回 {show, hide, open}。
export function hoverPop(btn, pop, onShow) {
  pop.popover = 'manual';
  pop.classList.add('cb-hover');
  let timer = 0;
  const open = () => pop.matches(':popover-open');
  function show() {
    clearTimeout(timer);
    if (btn.disabled || open() || !btn.isConnected) return;
    if (shown && shown !== hide) shown();
    shown = hide;
    pop.showPopover();
    place();
    onShow?.();
  }
  function hide() {
    clearTimeout(timer);
    if (shown === hide) shown = null;
    if (open()) pop.hidePopover();
  }
  function leaveSoon() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!btn.matches(':hover') && !pop.matches(':hover') && !within()) hide();
    }, CLOSE);
  }
  const within = () => {
    const a = document.activeElement;
    return (a === btn && btn.matches(':focus-visible')) || pop.contains(a);
  };
  function place() {
    const r = btn.getBoundingClientRect(),
      w = pop.offsetWidth,
      h = pop.offsetHeight;
    pop.style.left = Math.round(Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2))) + 'px';
    pop.style.top = Math.round(Math.max(4, r.top - h - 8)) + 'px';
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
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  return { show, hide, open };
}

// 方向键逐档：上 / 右加，下 / 左减（不滚动正文）。
export function arrows(btn, nudge) {
  btn.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (d == null) return;
    e.preventDefault();
    e.stopPropagation();
    nudge(d);
  });
}

// opt：{id, cls, label()（文案）, face(按钮)（画按钮上的数字或图标）, click(), nudge(d)（逐档，d 为 ±1）,
//   slider:{min,max,step,get(),set(v),text(v)}, presets:[{value,text}], extra?（面板最前面的元素，如静音按钮）}
export function dial(opt) {
  const btn = make('button', 'cb-btn cb-dial ' + (opt.cls ?? ''));
  btn.type = 'button';
  btn.dataset.id = opt.id;
  const pop = make('div', 'cb-pop dial-pop'),
    range = make('input', 'dial-range'),
    value = make('output', 'dial-value'),
    presets = make('div', 'dial-presets');
  pop.dataset.for = opt.id;
  range.type = 'range';
  Object.assign(range, { min: opt.slider.min, max: opt.slider.max, step: opt.slider.step });
  range.addEventListener('input', () => opt.slider.set(Number(range.value)));
  range.addEventListener('keydown', (e) => e.stopPropagation()); // 方向键只调这个滑杆，不翻屏
  for (const p of opt.presets) {
    const b = make('button', 'dial-preset', p.text);
    b.type = 'button';
    b.dataset.value = p.value;
    b.addEventListener('click', () => opt.slider.set(p.value));
    presets.append(b);
  }
  const line = make('div', 'dial-line');
  line.append(range, value);
  pop.append(...(opt.extra ? [opt.extra] : []), line, presets);

  // ---- 显隐：悬停（按钮或面板）与键盘焦点是同一个“选中”。
  const { hide } = hoverPop(btn, pop, sync);
  btn.addEventListener('click', () => opt.click());
  // 滚轮：向上加、向下减，一格一档。
  btn.addEventListener(
    'wheel',
    (e) => {
      if (btn.disabled || !e.deltaY) return;
      e.preventDefault();
      opt.nudge(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  arrows(btn, opt.nudge);
  // 重画按钮、滑杆、当前档位。
  function sync() {
    const v = opt.slider.get();
    opt.face(btn);
    const label = opt.label();
    btn.setAttribute('aria-label', label);
    range.setAttribute('aria-label', label);
    btn.title = label;
    if (document.activeElement !== range) range.value = String(v);
    range.style.setProperty('--v', (v - opt.slider.min) / (opt.slider.max - opt.slider.min));
    value.textContent = opt.slider.text(v);
    for (const b of presets.children)
      b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.value) - v) < 1e-6));
    if (btn.disabled) hide();
  }
  return { button: btn, pop, sync, hide };
}
