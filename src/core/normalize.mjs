// 旧记录读入时的归一化（纯逻辑）：补齐新字段，旧版单文件夹记录转为一个源，清掉只在一次会话内有效的标记。
import { sortMode, sortedPages } from './model.mjs';
import { looseNames, dirOf } from './sources.mjs';
// 旧记录补齐新字段：place 区分书架 / 书库；tags、bookmarks 随书目保存，导出时一并带走。
// v2.1 及以前的书只有一个文件夹（b.dir / b.title / b.path），转为一个 key 为 '' 的源。找不到的标记只在本次会话有效，
// 载入时清掉并把暂存的页放回原位，由启动时的检查重新判断。
export function normalize(b) {
  b.place ??= 'shelf';
  b.added ??= Date.now();
  for (const k of ['tags', 'bookmarks', 'pages']) if (!Array.isArray(b[k])) b[k] = [];
  if (b.parked != null && !Array.isArray(b.parked)) delete b.parked;
  if (!Array.isArray(b.sources))
    b.sources =
      b.dir || b.title != null
        ? [{ key: '', title: b.title ?? null, ...(b.path && { path: b.path }), ...(b.dir && { dir: b.dir }) }]
        : [];
  b.sources = b.sources.filter((s) => s && typeof s === 'object' && typeof s.key === 'string');
  if (b.roots != null && !Array.isArray(b.roots)) delete b.roots;
  for (const s of b.sources) delete s.missing;
  delete b.dir;
  delete b.missing;
  looseNames(b);
  if (b.parked?.length) {
    b.pages = b.pages.concat(b.parked);
    delete b.parked;
    if (sortMode(b) !== 'shuffle') b.pages = sortedPages(b.pages, sortMode(b), dirOf(b));
  }
  return b;
}
