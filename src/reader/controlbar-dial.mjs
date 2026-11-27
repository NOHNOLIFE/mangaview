// 总控栏上悬停弹出的小面板：速率、音量（dial）。悬停 / 聚焦弹出、定位与收起见 ui/hoverpop.mjs（播放模式、「⋯」同样用它）。
// dial：按钮显示数字或图标，面板是滑杆 + 常用档位（音量另有静音）；在按钮上滚轮、按方向键直接逐档调整；点击按钮由调用方决定（速率回到 1.0，音量静音）。
import { make } from '../ui/dom.mjs';
import { hoverPop } from '../ui/hoverpop.mjs';

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
  const btn = make('button', 'cb-btn cb-dial keep-pop ' + (opt.cls ?? ''));
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
