// 书卡片上的操作按钮：恢复、重命名、编辑标签、设置封面、移到书库 / 书架、复制书名、删除（过期书只有恢复、重命名、设置封面、删除）。
export function install(ctx, S) {
  const { t, iconButton, make } = ctx;
  const restoreOne = (...a) => S.restoreOne(...a);
  const editName = (...a) => S.editName(...a);
  const editTags = (...a) => S.editTags(...a);
  const move = (...a) => S.move(...a);
  // ex：过期书；lost：找不到的源（卷）数。
  S.cardActions = (b, ex, lost) => {
    const tools = make('div', 'actions');
    const cover = iconButton('cover', t('coverSet'), () => ctx.pickCover?.(b));
    if (ex)
      tools.append(
        iconButton('link', t('restore'), () => restoreOne(b)),
        iconButton('pencil', t('rename'), () => editName(b)),
        cover,
        iconButton('trash', t('remove'), () => ctx.remove(b), 'danger'),
      );
    else
      tools.append(
        ...(lost ? [iconButton('link', t('restore'), () => restoreOne(b))] : []),
        iconButton('pencil', t('rename'), () => editName(b)),
        iconButton('tag', t('editTags'), () => editTags(b)),
        cover,
        b.place === 'library'
          ? iconButton('library', t('toShelf'), () => move([b], 'shelf'))
          : iconButton('archive', t('toLibrary'), () => move([b], 'library')),
        iconButton('copy', t('titleCopy'), () => ctx.copy(ctx.title(b))),
        iconButton('trash', t('remove'), () => ctx.remove(b), 'danger'),
      );
    return tools;
  };
}
