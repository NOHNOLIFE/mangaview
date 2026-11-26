// 书名编辑对话框：只改显示名（b.name），留空恢复原名。
import { $ } from './util.mjs';

export function install(ctx, S) {
  const { t, fmt, safe, shelf } = ctx;
  const draw = (...a) => S.draw(...a);
  // ---- 书名编辑：只改显示名（b.name），文件夹名 b.title 仍用于识别同一文件夹和恢复过期书；留空恢复原名。
  let renaming = null;
  function editName(b) {
    renaming = b;
    $('renameInput').value = ctx.title(b);
    $('renameHint').textContent = fmt('renameHint', { name: b.title ?? t('loose') });
    $('renameBook').showModal();
    $('renameInput').select();
  }
  $('renameForm').onsubmit = (e) => {
    e.preventDefault();
    safe(async () => {
      const b = renaming,
        v = $('renameInput').value.trim();
      if (!b) return;
      if (v && v !== (b.title ?? t('loose'))) b.name = v;
      else delete b.name;
      await ctx.persist(b);
      $('renameBook').close();
      if (shelf.open) draw();
      ctx.toolsState();
      ctx.emit('books');
    })();
  };
  // close 事件异步派发：关闭后立刻为另一本书重新打开时，迟到的事件不能清掉新的编辑对象。
  $('renameBook').addEventListener('close', () => {
    if (!$('renameBook').open) renaming = null;
  });
  S.editName = editName;
}
