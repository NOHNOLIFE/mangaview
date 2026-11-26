// 书签的就地重命名（书签面板、书架书签栏、全屏书架书签共用）：选中项上的铅笔按钮或 F2，在缩略图下沿出现输入框。
// 回车或移开焦点确认，Esc 取消；清空则恢复默认名称（媒体书签恢复自动名称，图片书签恢复无名称，names.mjs rename）。
// 编辑期间输入框截下所有按键，不触发阅读、面板和全屏界面的快捷键；所在列表的重画推迟到改完。
export function install(ctx, S) {
  const { t, make, main } = ctx;
  let cur = null; // {input, item, book, bm, back, after}
  const later = new Set();
  // item：列表项；holder：名称所在的格子（书签列表是 .bm-thumb，全屏书架书签是项本身）；after：改完（含取消）后调用。
  function edit(item, book, bm, after) {
    if (!book || !bm) return;
    if (cur) finish(true);
    const holder = item.querySelector(':scope>.bm-thumb') ?? item,
      input = make('input', 'bm-edit');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = S.name(book, bm);
    input.placeholder = S.fallback(book, bm);
    input.setAttribute('aria-label', t('bmRename'));
    holder.append(input);
    item.classList.add('editing');
    cur = { input, item, book, bm, back: document.activeElement, after };
    input.focus({ preventScroll: true });
    input.select();
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu'])
      input.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('blur', () => {
      if (cur?.input === input) finish(true);
    });
  }
  function finish(commit) {
    const s = cur;
    if (!s) return;
    cur = null;
    const value = s.input.value;
    s.item.classList.remove('editing');
    const focused = s.input === document.activeElement;
    s.input.remove();
    if (focused) (s.back?.isConnected && s.back !== document.body ? s.back : main).focus({ preventScroll: true });
    const done = () => {
      s.after?.();
      for (const fn of [...later]) {
        later.delete(fn);
        fn();
      }
    };
    if (commit) ctx.safe(S.rename)(s.book, s.bm, value).finally(done);
    else done();
  }
  // 从列表项找到它的书和书签（书架书签栏的项在各书的分组里，书签面板的是当前书）。
  function editItem(item) {
    const group = item.closest('.sm-book'),
      book = group ? ctx.books.get(group.dataset.book) : ctx.current,
      bm = book?.bookmarks.find((b) => b.id === item.dataset.id);
    edit(item, book, bm);
  }
  // F2：重命名选中的书签。书签面板开着时是其中悬停 / 聚焦的项（没有则是离阅读位置最近的一项），否则是书架书签栏里的。
  function selected() {
    for (const box of [S.panel.hidden ? null : S.panel, S.dock?.hidden ? null : S.dock]) {
      if (!box) continue;
      const item =
        box.querySelector('.bm-item:hover') ??
        document.activeElement?.closest?.('.bm-item') ??
        box.querySelector('.bm-item.active');
      if (item && box.contains(item)) return item;
    }
    return null;
  }
  ctx.keys.push({
    down(e) {
      if (e.key !== 'F2' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
      e.preventDefault();
      const item = !e.repeat && selected();
      if (item) editItem(item);
      return true;
    },
  });
  Object.assign(S, {
    edit,
    editItem,
    editing: (box) => !!cur && (!box || box.contains(cur.input)),
    later: (fn) => later.add(fn),
  });
}
