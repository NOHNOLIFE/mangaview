// 偏好的存取与跨窗口同步：登记（prefs.sync / prefs.add）、读写（get / put / dropKey），
// 别的窗口的改动（storage 事件），还原默认设置（resetPrefs）。
import { isFrozen } from './store.mjs';
import { emit } from './events.mjs';
import { notice } from '../ui/dom.mjs';
import { flush } from '../reader/session.mjs';
let ctx;
export const prefix = 'mv2:';
// 偏好（界面设置与布局）：「还原默认设置」只清除这些键，再重新载入页面，各模块按默认值重新安装。
// 书目、书签、标签、阅读位置（pos:*）、最近打开的书（last）、搜索预设等数据不在其中。键名不含 mv2: 前缀；以 * 结尾表示该前缀下的所有键。
// 多个窗口时偏好分两类登记：
// - 设置类：ctx.prefs.sync('键名', apply)。跨窗口即时同步：别的窗口改动后，本窗口调用 apply(新值) 并派发 'pref' 事件（键名, 新值）。
//   设置面板里的开关、语言、默认排序都属于这一类，以后新增的音量、静音、自动播放等也这样登记。
// - 布局类：ctx.prefs.add('键名')。侧栏、宽度、列表样式等，各窗口互不影响：本窗口读过或写过之后只用自己的值，最后写入的作为下次启动的值。
// 其余的键（数据）总是读最新值。
export const prefs = new Set([
    'lang',
    'autoCheck',
    'fit',
    'preview',
    'width',
    'defaultSort',
    'edgeRight',
    'edgeLeft',
    'shelfmarks',
    'shelfmarksWidth',
    'focusMode',
    'shelfSort',
    'shelfView',
  ]),
  synced = new Map();
prefs.sync = (key, apply = null) => {
  prefs.add(key);
  synced.set(key, apply);
  own.delete(key);
  return prefs;
};
const isPref = (k) => prefs.has(k) || [...prefs].some((p) => p.endsWith('*') && k.startsWith(p.slice(0, -1)));
const layout = (k) => !synced.has(k) && isPref(k),
  own = new Map(); // own：本窗口的布局类偏好
export function get(key, otherwise = null) {
  if (own.has(key)) return own.get(key) ?? otherwise;
  let value = null;
  try {
    value = JSON.parse(localStorage.getItem(prefix + key));
  } catch {}
  if (layout(key)) own.set(key, value);
  return value ?? otherwise;
}
// 冻结时（别的窗口正在做全局操作，本窗口即将重新载入）不写，见 windows.mjs。
export function put(key, value) {
  if (isFrozen()) return;
  if (layout(key)) own.set(key, value);
  try {
    localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch {
    notice('storage');
  }
}
export function dropKey(key) {
  if (isFrozen()) return;
  own.delete(key);
  try {
    localStorage.removeItem(prefix + key);
  } catch {
    notice('storage');
  }
}
export function install(c) {
  ctx = c;
  // 别的窗口写入 localStorage：设置类即时应用；布局类不理会；其余派发 'storage' 事件（键名, 新值），如书架页据此更新搜索预设。
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage || !e.key?.startsWith(prefix) || isFrozen()) return;
    const key = e.key.slice(prefix.length);
    if (layout(key)) return;
    let value = null;
    try {
      value = JSON.parse(e.newValue);
    } catch {}
    if (synced.has(key)) {
      try {
        synced.get(key)?.(value);
      } catch (err) {
        console.warn(err);
      }
      emit('pref', key, value);
    }
    emit('storage', key, value);
  });
}
// 其他窗口先停止写入，本窗口清除偏好后连同它们一起重新载入（windows.mjs）。
export async function resetPrefs() {
  flush();
  await ctx.hold?.();
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix) && isPref(key.slice(prefix.length))) localStorage.removeItem(key);
    sessionStorage.setItem(prefix + 'reset', '1');
  } catch {
    notice('storage');
    ctx.reloadOthers?.('reset');
    return;
  }
  ctx.reloadOthers?.('reset');
  location.reload();
}
