import { extend, languageList, translate } from '../core/lang.mjs';
import { clock, fileOf } from '../core/model.mjs';
import { isMedia, list } from './list.mjs';
// 书签的名称与位置文案（书签项的读屏说明、提示、搜索）。
// 名称存为完整字符串 bm.label：媒体书签都有名称（应用内新增为「<文件名>-书签N」，.pbf 导入为「<文件名>-<pbf 里的名称>」，见 pbf.mjs），
// 图片书签只有手动改过才有。named：用户手动改过的名称（不被 .pbf 覆盖）；pbfName：.pbf 里的原名（跟随 .pbf 改名时比较它）。
// <文件名> 不含路径和扩展名；「书签」按创建时的界面语言。读取名称一律经 nameOf / ctx.marks.name，不各自读 label。
extend({
  bmWord: ['Bookmark', '书签', 'しおり', '책갈피'],
  bmRename: ['Rename bookmark', '重命名书签', 'しおりの名前を変更', '책갈피 이름 바꾸기'],
});
const WORDS = languageList.map((l) => translate('bmWord', l));
// ---- 纯逻辑（tests/core/names.test.mjs）----
export const nameOf = (bm) => (typeof bm?.label === 'string' ? bm.label : '');
// 文件名去掉路径和扩展名。
export function stem(file) {
  const base = String(file ?? '')
      .split('/')
      .pop(),
    dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
// 书签所在媒体的 <文件名>（页已不存在时按页名推断）。
export function fileStem(book, name) {
  const page = book.pages?.find((p) => p.name === name);
  return stem(page ? fileOf(page) : name);
}
// 「<文件名>-书签N」里的 N（任一语言的「书签」都算），不是这种格式为 0。
export function numberOf(label, file) {
  const pre = file + '-';
  if (typeof label !== 'string' || !label.startsWith(pre)) return 0;
  const rest = label.slice(pre.length);
  for (const w of WORDS) if (rest.startsWith(w) && /^\d+$/.test(rest.slice(w.length))) return +rest.slice(w.length);
  return 0;
}
// 同一个媒体文件里已有序号的最大值加一。
export const nextNumber = (marks, name, file) =>
  marks.reduce((n, m) => (m?.name === name && isMedia(m) ? Math.max(n, numberOf(m.label, file)) : n), 0) + 1;
export const autoName = (file, word, n) => file + '-' + word + n;
// 媒体书签的默认名称：有 .pbf 原名的为「<文件名>-<原名>」，否则按应用内规则编号（不算它自己）。
export function defaultName(marks, bm, file, word) {
  if (typeof bm.pbfName === 'string' && bm.pbfName) return file + '-' + bm.pbfName;
  return autoName(
    file,
    word,
    nextNumber(
      marks.filter((m) => m !== bm),
      bm.name,
      file,
    ),
  );
}
// 旧的媒体书签补上名称（原地修改，返回改了的书签）：没有名称的按默认规则补上（按书签顺序编号）；
// 2.3.0 导入的 .pbf 书签 label 是 .pbf 原名，移到 pbfName 后按「<文件名>-<原名>」重新命名。
export const unnamed = (m) => isMedia(m) && (!nameOf(m) || (m.from === 'pbf' && typeof m.pbfName !== 'string'));
export function fillNames(book, word) {
  const out = [],
    marks = book.bookmarks ?? [];
  if (!marks.some(unnamed)) return out;
  const files = new Map(),
    fileFor = (name) => {
      if (!files.has(name)) files.set(name, fileStem(book, name));
      return files.get(name);
    };
  for (const { bm } of list(book)) {
    if (!unnamed(bm)) continue;
    if (bm.from === 'pbf' && typeof bm.pbfName !== 'string') {
      bm.pbfName = nameOf(bm);
      if (!bm.named) delete bm.label;
    }
    if (!nameOf(bm)) bm.label = defaultName(marks, bm, fileFor(bm.name), word);
    out.push(bm);
  }
  return out;
}

export function install(ctx, S) {
  const { t, fmt } = ctx;
  const word = () => t('bmWord');
  // 旧书签在读入 / 首次使用时补上名称并保存（ctx.persist 按 id 合并书签条目，多个窗口同时补也不会重复）。
  const saving = new Set();
  function ensure(book) {
    if (!book?.bookmarks?.some(unnamed)) return false;
    fillNames(book, word());
    if (ctx.books.get(book.id) === book && !saving.has(book)) {
      saving.add(book);
      queueMicrotask(() => {
        saving.delete(book);
        ctx.safe(ctx.persist)(book);
      });
    }
    return true;
  }
  const sweep = () => {
    for (const b of ctx.books.values()) ensure(b);
  };
  sweep();
  ctx.on('books', sweep);
  ctx.on('synced', (book, keys) => {
    if (keys?.includes('bookmarks')) ensure(book);
  });
  // 书签的名称（没有为空字符串）。
  function name(book, bm) {
    if (isMedia(bm)) ensure(book);
    return nameOf(bm);
  }
  // 新增媒体书签的名称：「<文件名>-书签N」。
  function fresh(book, pageName) {
    ensure(book);
    const file = fileStem(book, pageName);
    return autoName(file, word(), nextNumber(book.bookmarks, pageName, file));
  }
  // 清空名称时恢复的默认名称（输入框的占位文字也用它）：媒体书签为自动名称，图片书签为「第 N 页」。
  function fallback(book, bm) {
    if (!isMedia(bm)) {
      const i = book.pages.findIndex((p) => p.name === bm.name);
      return i < 0 ? t('bmGone') : fmt('bmPage', { n: i + 1 });
    }
    if (!bm.named) return nameOf(bm);
    return defaultName(book.bookmarks, bm, fileStem(book, bm.name), word());
  }
  // 重命名：value 为空恢复默认（媒体书签恢复自动名称，图片书签恢复无名称）。没有变化返回 false。
  async function rename(book, bm, value) {
    const v = String(value ?? '').trim();
    if (v) {
      if (v === nameOf(bm)) return false;
      bm.label = v;
      bm.named = true;
    } else if (!bm.named) return false;
    else if (isMedia(bm)) {
      bm.label = defaultName(book.bookmarks, bm, fileStem(book, bm.name), word());
      delete bm.named;
    } else {
      delete bm.label;
      delete bm.named;
    }
    await ctx.persist(book);
    S.changed(book);
    return true;
  }
  // 书签所在位置的说明（读屏、提示）：第 N 页，媒体另带时间点和名称。
  function where(book, x, end = false) {
    const m = end ? x.bm.end : x.bm,
      i = end ? x.e : x.i,
      n = end ? '' : name(book, x.bm);
    if (i < 0) return t('bmGone') + (n ? ' · ' + n : '');
    return fmt('bmPage', { n: i + 1 }) + (isMedia(m) ? ' · ' + clock(m.t) : '') + (n ? ' · ' + n : '');
  }
  Object.assign(S, { where, name, fresh, fallback, rename, ensure, word });
}
