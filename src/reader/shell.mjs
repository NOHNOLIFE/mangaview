// 阅读区外壳的状态显示：书名、页码与进度（toolsState / updateProgress），文件夹找不到、句柄失效的提示条（accessState），
// 静态文案的本地化与切换界面语言（localize / setLang）。
import { detect } from '../core/lang.mjs';
import { t, fmt, title, lang, langPref, setLangValue } from '../core/locale.mjs';
import { emit } from '../core/events.mjs';
import { get, put, prefs } from '../core/prefs.mjs';
import { books } from '../core/books.mjs';
import { isDead, isLoose } from '../core/sources.mjs';
import { handlesOf } from '../core/status.mjs';
import { $ } from '../ui/dom.mjs';
import { current, view } from './session.mjs';
import { pinned, preview } from './panel.mjs';
import { sortOptions, showSortChoices } from './sort.mjs';
let ctx, hudTimer;
// 启动时的句柄探测完成后才记下浏览器版本（accessState）。
let probed = false;
export function markProbed() {
  probed = true;
}
export function localize() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  queueMicrotask(() => accessState());
  for (const el of document.querySelectorAll('[data-label]')) {
    el.title = t(el.dataset.label);
    el.setAttribute('aria-label', el.title);
  }
  for (const el of document.querySelectorAll('[data-aria]')) el.setAttribute('aria-label', t(el.dataset.aria)); // 只给读屏，不显示悬停文字
  for (const el of document.querySelectorAll('[data-placeholder]')) {
    el.placeholder = t(el.dataset.placeholder);
    el.setAttribute('aria-label', el.placeholder);
  }
}
export function toolsState() {
  $('bookTitle').textContent = $('bookTitle').title = $('barTitle').title = current ? title(current) : 'MangaView';
  $('empty').hidden = !!current;
  $('hud').hidden = !current;
  for (const key of ['fit', 'preview']) document.querySelector(`#bar [data-act="${key}"]`).disabled = !current;
  document.querySelector('[data-act="fit"]').setAttribute('aria-pressed', String(view.fit));
  preview(pinned);
  updateProgress();
}
// 页码、进度环和工具栏进度条；flash 表示由滚动触发，短暂显示页码浮标。
export function updateProgress(flash = false) {
  const pos = current && view.position(),
    ratio = pos ? pos.ratio : 0,
    d = pos ? String(pos.n).length : 0;
  // 名称区：当前页 / 总页数 · 进度（已到书尾时是 n / n）；按总页数的位数预留宽度，滚动中位数变化不推动书名。
  $('bookMeta').textContent = pos
    ? `${ctx?.atEnd?.() ? pos.n : pos.i + 1} / ${pos.n} · ${Math.round(ratio * 100)}%`
    : current
      ? `${current.pages.length} ${t('pages')}`
      : '';
  $('bookMeta').dataset.room = pos ? `${'0'.repeat(d)} / ${'0'.repeat(d)} · 100%` : '';
  $('pageNum').textContent = pos ? `${pos.i + 1} / ${pos.n}` : '';
  $('barProgress').style.transform = `scaleX(${ratio})`;
  $('ring').style.strokeDashoffset = String(100 - ratio * 100);
  if (flash && pos) {
    $('hud').classList.add('show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => $('hud').classList.remove('show'), 1400);
  }
}
// 浏览器作废的句柄数（文件夹逐个计，散图图集算一个）。大量失效通常是浏览器更新所致：提示条说明原因并直接给出恢复入口。
const browserVer = () => /(?:Chrome|Firefox|Version)\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '';
export const staleCount = () =>
  new Set(handlesOf([...books.values()]).filter(isDead)).size +
  [...books.values()].filter((b) => isLoose(b) && b.pages.some((p) => isDead(p.handle))).length;
export function accessState(show) {
  const n = staleCount(),
    was = get('ua'),
    now = browserVer(),
    bar = $('access');
  if (probed && !n && now) put('ua', now); // 记下句柄完好时的浏览器版本，失效时用来说明是哪次更新之后出的问题
  bar.classList.toggle('stale', !!n);
  bar.querySelector('span').textContent = n
    ? was && now && was !== now
      ? fmt('staleUp', { a: was, b: now, n })
      : fmt('stale', { n })
    : t('missing');
  bar.querySelector('[data-act="allow"] span').textContent = t(n ? 'restoreAll' : 'allow');
  if (show && n) bar.hidden = false;
  else if (show === false && !n && bar.classList.contains('wasStale')) bar.hidden = true;
  bar.classList.toggle('wasStale', !!n);
}
function relocalize() {
  localize();
  toolsState();
  if (sortOptions.open) showSortChoices();
  ctx.redrawShelf();
  emit('lang', lang);
}
export function setLang(code) {
  put('lang', code || null);
  setLangValue(code || detect(navigator.languages || [navigator.language]));
  relocalize();
}
export function install(c) {
  ctx = c;
  prefs.sync('lang', (code) => {
    setLangValue(code || detect(navigator.languages || [navigator.language]));
    relocalize();
  });
  window.addEventListener('languagechange', () => {
    if (langPref()) return;
    setLangValue(detect(navigator.languages));
    relocalize();
  });
}
