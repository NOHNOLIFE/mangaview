// 添加对话框（#addDialog）。浏览器的系统选择框不能同时多选文件夹和文件，所以「添加」先开文件夹选择框、
// 「添加到散图图集」先开文件选择框，选完进入对话框：列出待添加项（名称、类型图标，可逐项移除），
// 可用「＋文件夹」「＋文件」继续追加，也可以把多个文件夹和文件一起拖进对话框；同一个文件夹 / 文件只列一次。
// 待添加项只记句柄（回退的 <input> 为本次会话的 File），确认后才扫描（纯逻辑见 addlist.mjs）：
// 添加为多个作品：文件夹按现有规则各自成书，零散文件进散图图集；添加为单个作品：并成一本（import.mjs addMerged）；
// 添加到散图图集：文件夹里的文件（含子文件夹）也全部并入图集。拖放到窗口的三块区域不经过这里（drop.mjs）。
import { extend } from '../core/lang.mjs';
import { t, fmt } from '../core/locale.mjs';
import { skipped, handleGroups, fileGroups, looseImages, looseFiles } from '../core/sources.mjs';
import { $, make, icon, notice, safe } from '../ui/dom.mjs';
import { add, addMerged, importPlace } from './import.mjs';
import { choose } from './pick.mjs';
import { append, split, typeOf, hasFolder, fromHandle, fromFiles } from './addlist.mjs';

extend({
  addHint: [
    'Add more folders or files, or drop them here.',
    '可以继续添加文件夹或文件，也可以直接拖进来。',
    'フォルダーやファイルを続けて追加するか、ここにドロップしてください。',
    '폴더나 파일을 계속 추가하거나 여기에 끌어다 놓으세요.',
  ],
  addEmpty: [
    'Nothing to add yet. Drop folders or files here.',
    '还没有要添加的内容，可以把文件夹或文件拖到这里。',
    '追加するものがありません。フォルダーやファイルをここにドロップしてください。',
    '추가할 항목이 없습니다. 폴더나 파일을 여기에 끌어다 놓으세요.',
  ],
  addFolder: ['Folder', '文件夹', 'フォルダー', '폴더'],
  addFiles: ['Files', '文件', 'ファイル', '파일'],
  addMany: ['Add as separate books', '添加为多个作品', '別々の作品として追加', '여러 작품으로 추가'],
  addOne: ['Add as one book', '添加为单个作品', '1 冊として追加', '한 권으로 추가'],
  addOneHint: [
    'Join all the folders into one book',
    '把所有文件夹合成一本书',
    'すべてのフォルダーを 1 冊にまとめます',
    '모든 폴더를 한 권으로 합칩니다',
  ],
  addOneNoFolder: [
    'Add a folder to make one book',
    '添加文件夹后才能合成一本',
    'フォルダーを追加すると 1 冊にまとめられます',
    '폴더를 추가해야 한 권으로 합칠 수 있습니다',
  ],
  addRemove: ['Remove {name}', '移除：{name}', '{name} を外す', '{name} 제거'],
  addTypeImage: ['Image', '图片', '画像', '이미지'],
  addTypeVideo: ['Video', '视频', '動画', '동영상'],
  addTypeAudio: ['Audio', '音频', '音声', '오디오'],
  addTypeFile: ['File', '文件', 'ファイル', '파일'],
});
const TYPE_ICON = { folder: 'folder', image: 'photo', video: 'film', audio: 'music', file: 'file' },
  TYPE_LABEL = {
    folder: 'addFolder',
    image: 'addTypeImage',
    video: 'addTypeVideo',
    audio: 'addTypeAudio',
    file: 'addTypeFile',
  };
let dlg,
  list = [],
  mode = 'add', // 'add'：添加；'loose'：添加到散图图集
  busy = false,
  depth = 0;
const rows = new WeakMap(); // 待添加项 → 列表行
function draw() {
  const ul = $('addList');
  ul.replaceChildren(
    ...list.map((it, i) => {
      const li = make('li', 'add-item'),
        type = typeOf(it),
        mark = make('span', 'add-type ' + type),
        name = make('span', 'add-name', it.name),
        x = make('button', 'icon-btn add-x');
      mark.title = t(TYPE_LABEL[type]);
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', mark.title);
      mark.append(icon(TYPE_ICON[type]));
      name.title = it.name;
      x.type = 'button';
      x.title = fmt('addRemove', { name: it.name });
      x.setAttribute('aria-label', x.title);
      x.append(icon('close'));
      x.onclick = () => removeAt(i);
      li.append(mark, name, x);
      rows.set(it, li);
      return li;
    }),
  );
  $('addEmpty').hidden = list.length > 0;
  const folder = hasFolder(list);
  $('addMany').disabled = $('addLoose').disabled = !list.length;
  $('addOne').disabled = !folder;
  $('addOne').title = t(folder ? 'addOneHint' : 'addOneNoFolder');
}
function removeAt(i) {
  list.splice(i, 1);
  draw();
  const xs = $('addList').querySelectorAll('.add-x');
  (xs[i] ?? xs[i - 1] ?? $('addFolder')).focus();
}
// 重复选入的：不再加一行，列表里已有的那一行闪一下。
function flash(items) {
  for (const it of items) {
    const li = rows.get(it);
    if (!li) continue;
    li.classList.remove('dup');
    void li.offsetWidth;
    li.classList.add('dup');
    li.scrollIntoView({ block: 'nearest' });
  }
}
async function take(items) {
  const { added, dups } = await append(list, items);
  if (!dlg.open && !list.length) return;
  draw();
  flash(dups);
  rows.get(added.at(-1))?.scrollIntoView({ block: 'nearest' });
}
async function more(kind) {
  if (busy) return;
  busy = true;
  try {
    await take(await choose(kind));
  } finally {
    busy = false;
  }
}
async function confirm(how) {
  if (!list.length || (how === 'one' && !hasFolder(list))) return;
  const items = list,
    place = importPlace(),
    odd = skipped(),
    { handles, files, dirs } = split(items);
  list = [];
  dlg.close();
  if (how === 'loose') {
    notice('scanning');
    const groups = [
      ...(handles.length ? await looseImages(handles, odd) : []),
      ...(files.length ? looseFiles(files, odd) : []),
    ];
    await add(groups, place, odd);
    return;
  }
  const groups = joined(handles.length && handleGroups(handles, odd), files.length && fileGroups(files, odd));
  if (how === 'one') await addMerged(dirs.length ? dirs : null, groups, place, odd);
  else await add(groups, place, odd);
}
async function* joined(...parts) {
  for (const p of parts) if (p) yield* p;
}
// 拖放到对话框：一次可以拖入多个文件夹和文件，追加进列表；拖放事件不再传到窗口（不弹出窗口的拖入覆盖层）。
function dropping() {
  const has = (e) => e.dataTransfer?.types.includes('Files');
  dlg.addEventListener('dragenter', (e) => {
    e.stopPropagation();
    if (!has(e)) return;
    e.preventDefault();
    depth++;
    dlg.classList.add('over');
  });
  dlg.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    if (has(e) && --depth <= 0) {
      depth = 0;
      dlg.classList.remove('over');
    }
  });
  dlg.addEventListener('dragover', (e) => {
    e.stopPropagation();
    if (!has(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  dlg.addEventListener('drop', (e) => {
    e.stopPropagation();
    depth = 0;
    dlg.classList.remove('over');
    if (!has(e)) return;
    e.preventDefault();
    const items = [...e.dataTransfer.items].filter((x) => x.kind === 'file');
    // 句柄要在 drop 事件里同步取出，之后 dataTransfer 就不可用了。
    const got =
      items.length && items[0].getAsFileSystemHandle
        ? Promise.all(items.map((x) => x.getAsFileSystemHandle())).then((l) => l.filter(Boolean).map(fromHandle))
        : Promise.resolve(fromFiles([...e.dataTransfer.files]));
    safe(async () => take(await got))();
  });
}
function setup() {
  if (dlg) return;
  dlg = $('addDialog');
  $('addFolder').onclick = safe(() => more('folder'));
  $('addFiles').onclick = safe(() => more('file'));
  $('addMany').onclick = safe(() => confirm('many'));
  $('addOne').onclick = safe(() => confirm('one'));
  $('addLoose').onclick = safe(() => confirm('loose'));
  // close 事件是异步派发的，可能在下一次打开之后才到：对话框已重新打开时不清空。
  dlg.addEventListener('close', () => {
    if (dlg.open) return;
    list = [];
    depth = 0;
    dlg.classList.remove('over');
    $('addList').replaceChildren();
  });
  dropping();
}
// 入口：「添加」（mode 'add'）与「添加到散图图集」（'loose'）。取消系统选择框且列表为空时不弹出对话框。
export async function openAdd(how) {
  setup();
  if (dlg.open || busy) return;
  busy = true;
  try {
    mode = how;
    list = [];
    const got = await choose(how === 'loose' ? 'file' : 'folder');
    await append(list, got);
    if (!list.length) return;
  } finally {
    busy = false;
  }
  const loose = mode === 'loose';
  // 文案每次打开时按当前语言写入（这些文案登记在本模块，不在 index.html 的静态标签里）。
  $('addTitle').textContent = t(loose ? 'files' : 'folder');
  $('addHint').textContent = t('addHint');
  $('addEmpty').textContent = t('addEmpty');
  $('addFolder').lastChild.textContent = t('addFolder');
  $('addFiles').lastChild.textContent = t('addFiles');
  $('addOne').textContent = t('addOne');
  $('addMany').textContent = t('addMany');
  dlg.classList.toggle('loose', loose);
  $('addMany').hidden = $('addOne').hidden = loose;
  $('addLoose').hidden = !loose;
  draw();
  dlg.showModal();
  $(loose ? 'addLoose' : 'addMany').focus();
}
