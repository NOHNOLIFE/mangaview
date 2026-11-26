// 书卡片上的操作按钮。卡片上固定四个位置：编辑标签（源文件夹找不到时为「恢复」）、移到书库 / 书架、删除、更多（⋯）；
// 已失效的书：恢复、（空位）、删除、更多。按钮位置不随状态移动。
// 「更多」弹出菜单（书架里共用一个弹出层 #cardMenu，打开时按书生成菜单项）：重命名、设置封面、复制书名；
// 源找不到时编辑标签也在菜单里；已失效的书只有重命名、设置封面。菜单可用方向键、Home / End、回车操作，Esc 关闭后焦点回到「更多」。
import { extend } from '../core/lang.mjs';
import { $ } from './util.mjs';

extend({
  cardMore: ['More', '更多', 'その他', '더 보기'],
});
export function install(ctx, S) {
  const { books, t, iconButton, make, icon, safe, shelf } = ctx;
  const menu = $('cardMenu');
  let menuFor = null; // 菜单所属的书 id
  // 按钮闭包里的书按 id 现取：别的窗口同步过来的记录可能换了对象。
  const live = (b) => books.get(b.id) ?? b;
  const moreOf = (id) => S.nodes.get(id)?.querySelector(':scope>.actions .more');
  function items(b, ex, lost) {
    const list = [];
    const add = (name, label, fn) => list.push({ name, label, fn });
    if (lost && !ex) add('tag', t('editTags'), () => S.editTags(live(b)));
    add('pencil', t('rename'), () => S.editName(live(b)));
    add('cover', t('coverSet'), () => ctx.pickCover?.(live(b)));
    if (!ex) add('copy', t('titleCopy'), () => ctx.copy(ctx.title(live(b))));
    return list;
  }
  function place(btn) {
    const r = btn.getBoundingClientRect(),
      w = menu.offsetWidth,
      h = menu.offsetHeight,
      below = r.bottom + 6 + h <= innerHeight - 8;
    menu.style.top = Math.max(8, below ? r.bottom + 6 : r.top - 6 - h) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - w, document.documentElement.clientWidth - w - 8)) + 'px';
  }
  function fillMenu(b, ex, lost) {
    menuFor = b.id;
    menu.replaceChildren(
      ...items(b, ex, lost).map(({ name, label, fn }) => {
        const it = make('button', 'cm-item');
        it.type = 'button';
        it.setAttribute('role', 'menuitem');
        it.tabIndex = -1;
        it.append(icon(name), make('span', '', label));
        it.onclick = safe(() => {
          close(true);
          return fn();
        });
        return it;
      }),
    );
  }
  function close(refocus) {
    if (!menu.matches(':popover-open')) return;
    const btn = moreOf(menuFor);
    menu.hidePopover();
    if (refocus) btn?.focus({ preventScroll: true });
  }
  function open(b, ex, lost, btn) {
    const was = menu.matches(':popover-open');
    if (was && menuFor === b.id) return close(true); // 再点一次即关闭
    if (was) menu.hidePopover();
    fillMenu(b, ex, lost);
    menu.setAttribute('aria-label', t('cardMore'));
    menu.showPopover();
    place(btn);
    for (const el of S.nodes.values()) el.classList.toggle('menu-open', el.dataset.id === b.id);
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role=menuitem]')?.focus({ preventScroll: true });
  }
  menu.addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') return;
    for (const el of S.nodes.values()) el.classList.remove('menu-open');
    for (const x of document.querySelectorAll('#books .more[aria-expanded=true]'))
      x.setAttribute('aria-expanded', 'false');
  });
  // 焦点留在已关闭的菜单里（或落到页面上）时回到「更多」。
  menu.addEventListener('toggle', () => {
    if (menu.matches(':popover-open')) return;
    if (menu.contains(document.activeElement) || document.activeElement === document.body)
      moreOf(menuFor)?.focus({ preventScroll: true });
  });
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('[role=menuitem]')],
      i = list.indexOf(document.activeElement),
      n = list.length;
    if (!n) return;
    const j = {
      ArrowDown: (i + 1) % n,
      ArrowUp: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    }[e.key];
    if (j == null) return;
    e.preventDefault();
    e.stopPropagation();
    list[j].focus();
  });
  // Esc 只关闭菜单并回到「更多」，不关闭书架（先于书架里其他弹出层的 Esc 处理）。
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !shelf.open || !menu.matches(':popover-open')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close(true);
    },
    true,
  );
  // 卡片滚动、书架关闭时菜单随之关闭（菜单固定定位，不跟着卡片移动）。
  $('books').addEventListener('scroll', () => close(false), { passive: true });
  shelf.addEventListener('close', () => close(false));
  // ex：过期书；lost：找不到的源（卷）数。
  S.cardActions = (b, ex, lost) => {
    const tools = make('div', 'actions');
    const first =
      ex || lost
        ? iconButton('link', t('restore'), () => S.restoreOne(live(b)))
        : iconButton('tag', t('editTags'), () => S.editTags(live(b)));
    let second;
    if (ex) {
      second = make('span', 'slot'); // 空位：其余按钮的位置与其他状态相同
      second.setAttribute('aria-hidden', 'true');
    } else
      second =
        b.place === 'library'
          ? iconButton('library', t('toShelf'), () => S.move([live(b)], 'shelf'))
          : iconButton('archive', t('toLibrary'), () => S.move([live(b)], 'library'));
    const more = iconButton('more', t('cardMore'), () => {}, 'more');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', String(menuFor === b.id && menu.matches(':popover-open')));
    more.setAttribute('aria-controls', 'cardMenu');
    // 菜单开着时再点「更多」：弹出层在按下鼠标后会自动关闭，click 时已经关了，按“再点一次即关闭”处理，不重新打开。
    let wasOpen = false;
    more.addEventListener('pointerdown', () => {
      wasOpen = S.menuFor() === b.id;
    });
    more.onclick = () => {
      if (wasOpen) {
        wasOpen = false;
        return close(true);
      }
      open(b, ex, lost, more);
    };
    tools.append(
      first,
      second,
      iconButton('trash', t('remove'), () => ctx.remove(live(b)), 'danger'),
      more,
    );
    return tools;
  };
  // 按钮的状态：变了才重建卡片上的按钮（card.mjs），其余增量更新不动按钮，打开的菜单不受影响。
  S.menuFor = () => (menu.matches(':popover-open') ? menuFor : null);
  S.actionKey = (b, ex, lost) => [ex ? 'x' : lost ? 'l' : 'ok', b.place, ctx.lang].join('|');
}
