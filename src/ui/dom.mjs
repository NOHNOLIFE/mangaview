// 通用 DOM 小工具：取元素与三个主要区域（正文、缩略图栏、书架页）、建元素 / 图标 / 图标按钮、浮动面板的淡出，
// 提示条（notice）、异步动作的统一出错提示（safe）、复制到剪贴板、长按进度环（holdRing）。
import { t } from '../core/locale.mjs';
export const $ = (id) => document.getElementById(id),
  main = $('reader'),
  nav = $('preview'),
  shelf = $('shelf');
export function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
export function iconButton(name, label, action, className = '') {
  const el = make('button', 'icon-btn ' + className);
  el.type = 'button';
  el.title = label;
  el.setAttribute('aria-label', label);
  el.append(icon(name));
  el.onclick = safe(action);
  return el;
}
// 长按进度环（长按 F / Enter 添加书签）：show 开始填充，done 显示完成后自动消失。
export function holdRing() {
  const el = make('div', 'hold'),
    dial = make('span', 'hold-dial'),
    text = make('span', 'hold-text'),
    glyph = icon('bookmark');
  let timer = 0;
  dial.innerHTML =
    '<svg class="hold-ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="track" cx="20" cy="20" r="17"/><circle class="fill" cx="20" cy="20" r="17" pathLength="100"/></svg>';
  dial.append(glyph);
  el.append(dial, text);
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  function set(name, label, done) {
    clearTimeout(timer);
    el.hidden = true;
    void el.offsetWidth; // 先隐藏再显示，重新开始填充动画
    el.classList.toggle('done', done);
    glyph.firstChild.setAttribute('href', '#i-' + name);
    text.textContent = label;
    el.hidden = false;
    if (done)
      timer = setTimeout(() => {
        el.hidden = true;
      }, 900);
  }
  return {
    show: (name, label) => set(name, label, false),
    done: (name, label) => set(name, label, true),
    hide() {
      clearTimeout(timer);
      el.hidden = true;
    },
  };
}
let noticeTimer;
export function notice(key, text = t(key), ms = 3800) {
  clearTimeout(noticeTimer);
  $('notice').textContent = text;
  noticeTimer = setTimeout(() => ($('notice').textContent = ''), ms);
}
export function safe(fn) {
  return (...args) =>
    Promise.resolve()
      .then(() => fn(...args))
      .catch((e) => {
        if (e.name !== 'AbortError') {
          console.warn(e);
          notice('failed');
        }
      });
}
// 浮动面板淡出后再隐藏，鼠标快速划过时不会一闪；淡出途中再次打开会直接取消淡出。
export function fade(el, show) {
  if (show) {
    clearTimeout(el.fadeTimer);
    el.classList.remove('leaving');
    el.hidden = false;
    return;
  }
  if (el.hidden || el.classList.contains('leaving')) return;
  el.classList.add('leaving');
  el.fadeTimer = setTimeout(() => {
    el.hidden = true;
    el.classList.remove('leaving');
  }, 170);
}
export const showing = (el) => !el.hidden && !el.classList.contains('leaving');
export async function copy(value) {
  await navigator.clipboard.writeText(value);
  notice('copied');
}
