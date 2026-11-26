// 界面语言：当前语言（设置里固定的，未设置时跟随浏览器）、取文案（t / fmt）、书的显示名（title）。不操作界面。
import { detect, translate } from './lang.mjs';
// 设置面板可固定界面语言；未设置时跟随浏览器。
export const langPref = () => {
  try {
    return JSON.parse(localStorage.getItem('mv2:lang'));
  } catch {
    return null;
  }
};
export let lang = langPref() || detect(navigator.languages || [navigator.language]);
export const t = (key) => translate(key, lang),
  title = (b) => b.name || (b.title ?? t('loose')); // name：用户编辑的书名；title 是文件夹名，用于识别和恢复，不改
export const fmt = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k]);
// 改当前语言（设置、跟随浏览器时由 shell.mjs 调用，界面随后由它的 relocalize 刷新）。
export function setLangValue(code) {
  lang = code;
}
