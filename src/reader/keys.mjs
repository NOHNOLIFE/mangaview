// 按键：全局快捷键的分派（功能模块的按键经 ctx.keys 接入），按住 W / S 持续滚动，长按翻页键（交给 ctx.pageHold）。
import { $, main, shelf, safe, showing } from '../ui/dom.mjs';
import { books } from '../core/books.mjs';
import { current, step, flush } from './session.mjs';
import { pinned, preview } from './panel.mjs';
import { actions } from './actions.mjs';
import { bar, showBar } from './toolbar.mjs';
import { screenStep, toStart, toEnd } from './tap.mjs';
import { flip } from './single.mjs';
import { remove } from '../shelf/remove.mjs';
let ctx;
let hold = null,
  frame;
function stop() {
  hold = null;
  cancelAnimationFrame(frame);
}
// 长按翻页键（A / D / ← / →）：按满 HOLD_LONG 算长按，松开时不翻屏，交给 ctx.pageHold（{start(d),stop()}，留给媒体快进 / 快退；未接入时长按无功能）。
const HOLD_LONG = 550;
let pageHold = null;
function cancelPage() {
  const p = pageHold;
  if (!p) return;
  clearTimeout(p.fire);
  if (p.done) ctx.pageHold?.stop?.();
  pageHold = null;
}
function startHold(code, d) {
  if (hold === code) return;
  stop();
  hold = code;
  let prev = performance.now(),
    carry = 0;
  function tick(now) {
    carry += Math.min(60, now - prev) * 0.65 * d;
    const delta = Math.trunc(carry);
    carry -= delta;
    main.scrollTop += delta;
    prev = now;
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}
export function install(c) {
  ctx = c;
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.target.closest('input,textarea,[contenteditable="true"]')) return;
    if (e.ctrlKey || e.metaKey) {
      if (books.size && !$('help').open && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault();
        safe(actions.copy)();
      }
      return;
    }
    // B：打开 / 关闭书架（书架页的搜索框等输入框内不拦截，上面已经返回）。
    if (
      shelf.open &&
      !e.altKey &&
      e.key.toLowerCase() === 'b' &&
      [...document.querySelectorAll('dialog[open]')].every((d) => d === shelf || d.classList.contains('overview'))
    ) {
      e.preventDefault();
      if (!e.repeat) shelf.close();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      showBar(false);
      if (!pinned) preview(false);
      main.focus();
      return;
    }
    if (e.altKey) return;
    if (e.key.toLowerCase() === 'b') {
      e.preventDefault();
      if (!e.repeat) actions.shelf();
      return;
    }
    if (e.key.toLowerCase() === 't') {
      e.preventDefault();
      if (!e.repeat) {
        showBar(!showing(bar));
        (showing(bar) ? bar.querySelector('button') : main).focus();
      }
      return;
    }
    if (!current || (e.target.closest('button') && [' ', 'Enter'].includes(e.key))) return;
    for (const h of ctx.keys) if (h.down?.(e)) return; // 功能模块的按键（书签 F / Enter、全屏总览 C / V 等）
    const k = e.key.toLowerCase();
    // Shift+W / Shift+↑ 上一作品、Shift+S / Shift+↓ 下一作品：按下切换一次，按住不连续触发。
    if (e.shiftKey && ['w', 'arrowup', 's', 'arrowdown'].includes(k)) {
      e.preventDefault();
      if (!e.repeat) step(['w', 'arrowup'].includes(k) ? -1 : 1);
      return;
    }
    // S / ↓ 向下、W / ↑ 向上：按住持续滚动；单文件模式下是下一个 / 上一个文件，按住按间隔连续翻页。空格（含 Shift）是播放 / 暂停当前媒体（media.mjs 的按键），不再滚动。
    if (['s', 'arrowdown', 'w', 'arrowup'].includes(k)) {
      e.preventDefault();
      const d = ['w', 'arrowup'].includes(k) ? -1 : 1;
      if (ctx.single?.active) flip(d, e.repeat);
      else startHold(e.code, d);
      return;
    }
    // D / → 、A / ←：短按（松开时）翻一屏；长按见 HOLD_LONG。
    if (['d', 'arrowright', 'a', 'arrowleft'].includes(k)) {
      e.preventDefault();
      if (e.repeat || pageHold) return;
      const p = (pageHold = { code: e.code, d: ['a', 'arrowleft'].includes(k) ? -1 : 1, done: false });
      p.fire = setTimeout(() => {
        p.done = true;
        ctx.pageHold?.start?.(p.d);
      }, HOLD_LONG);
      return;
    }
    if (!['home', 'end', 'pageup', 'pagedown', 'delete'].includes(k)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (k === 'home') toStart();
    else if (k === 'end') toEnd();
    else if (k === 'delete') safe(remove)(current);
    else if (ctx.single?.active)
      flip(k === 'pageup' ? -1 : 1); // 单文件模式：上一个 / 下一个文件
    else step(k === 'pageup' ? -1 : 1);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === hold) stop();
    if (pageHold?.code === e.code) {
      const p = pageHold;
      cancelPage();
      if (!p.done) screenStep(p.d);
    }
    for (const h of ctx.keys) h.up?.(e);
  });
  window.addEventListener('blur', () => {
    stop();
    cancelPage();
    for (const h of ctx.keys) h.blur?.();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flush();
      stop();
    }
  });
}
