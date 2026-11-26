// 添加对话框（add.mjs）的待添加项，纯逻辑，不含界面。待添加项只记句柄，确认后才扫描，选入时不读盘。
// 项：{ kind: 'directory' | 'file', name, handle }；没有 File System Access API 时（回退的 <input>）为
// { kind, name, files: File[] }：一次文件夹选择是一个文件夹项（webkitRelativePath 的第一段是它的名称），选中的每个文件各是一项。
import { timed } from '../core/sources.mjs';
import { kindOf, isPbf } from '../core/model.mjs';

// 文件选择框接受的类型：图片、视频、音频，PotPlayer 书签，以及外挂字幕（字幕按原样交给导入流程）。
export const PICK_TYPES = {
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg'],
  'video/*': ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv'],
  'audio/*': ['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.weba'],
  'application/x-potplayer-bookmark': ['.pbf'],
  'text/plain': ['.srt', '.vtt', '.ass', '.ssa', '.lrc'],
};
// 回退的 <input accept> 用同一张表。
export const ACCEPT = Object.entries(PICK_TYPES)
  .flatMap(([type, exts]) => (type.endsWith('/*') ? [type] : exts))
  .join(',');
export const fromHandle = (h) => ({ kind: h.kind, name: h.name, handle: h });
// 回退：一次 <input> 选择得到的 File 列表 → 待添加项。
export function fromFiles(files) {
  const dirs = new Map(),
    out = [];
  for (const f of files) {
    const root = f.webkitRelativePath?.split('/')[0];
    if (!root) {
      out.push({ kind: 'file', name: f.name, files: [f] });
      continue;
    }
    if (!dirs.has(root)) {
      const it = { kind: 'directory', name: root, files: [] };
      dirs.set(root, it);
      out.push(it);
    }
    dirs.get(root).files.push(f);
  }
  return out;
}
// 列表里显示的类型：folder / image / video / audio / file（字幕、.pbf 等）。
export const typeOf = (it) => (it.kind === 'directory' ? 'folder' : (!isPbf(it.name) && kindOf(it.name)) || 'file');
// 回退项只有本次会话的 File：按相对路径、大小、修改时间比较。
const sig = (it) =>
  it.files
    .map((f) => (f.webkitRelativePath || f.name) + ':' + f.size + ':' + f.lastModified)
    .sort()
    .join('|');
// 是否同一个文件夹 / 文件：句柄用 isSameEntry（经 timed 限时，卡住按不同处理），名称不同的一定不同，不必再问。
export async function same(a, b) {
  if (a.kind !== b.kind || a.name !== b.name) return false;
  if (a.handle && b.handle)
    return (
      a.handle === b.handle ||
      (!!a.handle.isSameEntry && (await timed(a.handle, () => a.handle.isSameEntry(b.handle)).catch(() => false)))
    );
  if (a.files && b.files) return sig(a) === sig(b);
  return false;
}
// 追加到列表（原地修改），重复的跳过。返回 { added: 新加的项, dups: 列表里与之重复的已有项 }。
export async function append(list, incoming) {
  const added = [],
    dups = [];
  for (const it of incoming) {
    let dup = null;
    for (const x of list)
      if (await same(x, it)) {
        dup = x;
        break;
      }
    if (dup) {
      if (!dups.includes(dup)) dups.push(dup);
      continue;
    }
    list.push(it);
    added.push(it);
  }
  return { added, dups };
}
// 确认时交给导入流程的内容：handles 句柄（文件夹与文件），dirs 其中的文件夹（添加为单个作品时作为根），files 回退模式的 File。
export function split(list) {
  const handles = [],
    files = [];
  for (const it of list) {
    if (it.handle) handles.push(it.handle);
    else if (it.files) files.push(...it.files);
  }
  return { handles, files, dirs: handles.filter((h) => h.kind === 'directory') };
}
export const hasFolder = (list) => list.some((it) => it.kind === 'directory');
