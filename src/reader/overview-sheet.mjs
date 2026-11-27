// 全屏总览的面板外壳（全屏缩略图、全屏书架书签共用）：标题行、搜索框与类型开关、网格 / 瀑布流切换、滚动区、开合动画和按键分发。
// 内容与导航由各自的 hooks 提供（overview-pages.mjs、overview-marks.mjs）。
const ACTS = {
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  pageup: 'pageUp',
  pagedown: 'pageDown',
  home: 'home',
  end: 'end',
  ' ': 'choose',
  enter: 'choose',
};
const plain = (e) => !e.ctrlKey && !e.metaKey && !e.altKey;
// 类型开关：图标（photo 由 shelf.mjs 登记，film / music 由 media.mjs 登记）与文案 key。
const KINDS = [
    ['image', 'photo'],
    ['video', 'film'],
    ['audio', 'music'],
  ],
  KIND_LABEL = { image: 'kindImage', video: 'kindVideo', audio: 'kindAudio' };
export function install(ctx) {
  const { t, make, main } = ctx;
  const sheets = [],
    masonry = () => ctx.get('ovLayout', 'grid') === 'masonry';
  function syncLayout() {
    for (const s of sheets) {
      const m = masonry(),
        label = t(m ? 'ovMasonry' : 'ovGrid');
      s.lay.querySelector('use').setAttribute('href', '#i-' + (m ? 'masonry' : 'overview'));
      s.lay.title = label;
      s.lay.setAttribute('aria-label', label);
    }
  }
  // 全屏面板外壳：标题行、滚动区、开合动画和按键分发；内容与导航由 hooks 提供。
  function sheet(id, keys, bodyClass, hooks) {
    const dialog = make('dialog', 'overview');
    dialog.id = id;
    dialog.setAttribute('aria-labelledby', id + 'Title');
    const head = make('header', 'ov-head'),
      name = make('strong', 'ov-title'),
      pos = make('span', 'ov-pos');
    name.id = id + 'Title';
    const shut = ctx.iconButton('close', t('close'), () => s.close()),
      shelfBtn = ctx.iconButton('library', t('ovShelf'), () => ctx.actions.shelf(), 'ov-shelf');
    // 切换布局后焦点回到列表，空格 / Enter 仍是“打开选中项”而不是再按一次按钮。
    const lay = ctx.iconButton(
      'overview',
      '',
      () => {
        ctx.put('ovLayout', masonry() ? 'grid' : 'masonry');
        syncLayout();
        for (const o of sheets) if (o.dialog.open) o.relayout();
        scroller.focus({ preventScroll: true });
      },
      'ov-layout',
    );
    const scroller = make('div', 'ov-scroll'),
      body = make('div', bodyClass);
    scroller.tabIndex = -1;
    scroller.setAttribute('role', 'listbox');
    // 搜索框；没有结果时在列表区显示「没有匹配的项」和一键清除（与“本来就没有”区分）。
    const find = make('label', 'ov-find'),
      q = make('input'),
      none = make('div', 'ov-none'),
      noneText = make('span'),
      clear = make('button', 'link-btn');
    // 搜索框旁的类型开关（图片 / 视频 / 音频）：可多选，全不选等于不限；与搜索词一样只在本次打开期间有效。切换后焦点回到列表。
    const kinds = new Set(),
      kindBox = make('div', 'ov-kinds');
    kindBox.setAttribute('role', 'group');
    const kindBtns = KINDS.map(([k, name]) => {
      const b = ctx.iconButton(
        name,
        '',
        () => {
          if (kinds.has(k)) kinds.delete(k);
          else kinds.add(k);
          syncKinds();
          hooks.filter();
          scroller.focus({ preventScroll: true });
        },
        'ov-kind',
      );
      b.dataset.kind = k;
      return b;
    });
    kindBox.append(...kindBtns);
    function syncKinds() {
      for (const b of kindBtns) {
        const k = b.dataset.kind,
          label = t(KIND_LABEL[k]);
        b.setAttribute('aria-pressed', String(kinds.has(k)));
        b.title = label;
        b.setAttribute('aria-label', label);
      }
    }
    syncKinds();
    q.type = 'search';
    q.autocomplete = 'off';
    q.spellcheck = false;
    find.append(ctx.icon('search'), q);
    clear.type = 'button';
    none.hidden = true;
    none.append(noneText, clear);
    clear.onclick = () => {
      q.value = '';
      kinds.clear();
      syncKinds();
      hooks.filter();
      scroller.focus({ preventScroll: true });
    };
    q.addEventListener('input', () => hooks.filter());
    scroller.append(body, none);
    // 右侧依次是布局切换、书架（橙色加宽，常用）、关闭；书名和位置文字占据剩余宽度。
    head.append(name, pos, find, kindBox, lay, shelfBtn, shut);
    dialog.append(head, scroller);
    document.body.append(dialog);
    let closing = 0;
    const s = {
      dialog,
      name,
      pos,
      scroller,
      body,
      lay,
      relayout: () => hooks.relayout(),
      query: () => q.value,
      kinds: () => kinds,
      filtered: () => !!q.value.trim() || kinds.size > 0,
      none(on) {
        none.hidden = !on;
        clear.textContent = t(kinds.size ? 'clearFilters' : 'ovClear');
      },
      is: (e) => plain(e) && keys.includes(e.key.toLowerCase()),
      open(quiet = false) {
        if (dialog.open || document.querySelector('dialog[open]')) return false;
        q.value = '';
        kinds.clear();
        syncKinds(); // 搜索词和类型只在一次打开期间有效（关闭后立即重新打开时 close 事件可能还没到）
        if (!hooks.setup(quiet)) return false;
        syncLayout();
        q.placeholder = t(hooks.find);
        q.setAttribute('aria-label', q.placeholder);
        noneText.textContent = t('ovNoMatch');
        clear.textContent = t('ovClear');
        syncKinds();
        for (const [b, k] of [
          [shut, 'close'],
          [shelfBtn, 'ovShelf'],
        ]) {
          b.title = t(k);
          b.setAttribute('aria-label', t(k));
        }
        clearTimeout(closing);
        closing = 0;
        dialog.classList.remove('closing');
        dialog.showModal();
        scroller.focus({ preventScroll: true });
        hooks.show();
        return true;
      },
      live: () => dialog.open && !dialog.classList.contains('closing'),
      // 按当前状态重建内容（切书、书架关闭后）；没有可显示的内容时关闭。
      reload() {
        hooks.cleanup();
        if (!hooks.setup(true)) {
          dialog.close();
          return;
        }
        hooks.show();
      },
      // now：立即关闭（切换到另一个全屏面板时），否则淡出后关闭。
      close(now = false) {
        if (!dialog.open) return;
        if (now) {
          dialog.close();
          return;
        }
        if (closing) return;
        dialog.classList.add('closing');
        closing = setTimeout(() => dialog.close(), 140);
      },
    };
    dialog.addEventListener('keydown', (e) => {
      // 搜索框内：Esc 清空并回到列表（再按一次才关闭界面），Enter / ↓ 回到列表，其余按键照常输入。
      if (e.target === q) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape' && q.value) {
            q.value = '';
            hooks.filter();
          }
          scroller.focus({ preventScroll: true });
        }
        return;
      }
      if (
        ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') ||
        (plain(e) && e.key === '/')
      ) {
        e.preventDefault();
        e.stopPropagation();
        q.focus();
        q.select();
        return;
      }
      if (!plain(e)) return;
      if (s.is(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) s.close();
        return;
      }
      const other = sheets.find((o) => o !== s && o.is(e));
      if (other) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          s.close(true);
          other.open();
        }
        return;
      }
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) ctx.actions.shelf();
        return;
      }
      const k = e.key.toLowerCase(),
        act = ACTS[k];
      if (!act || (e.target.closest('button') && act === 'choose')) return;
      e.preventDefault();
      e.stopPropagation();
      if (act === 'choose') {
        if (!e.repeat) hooks.choose();
      } else hooks.move(act);
    });
    // 鼠标真正移动过才让选中跟随悬停：键盘滚动把别的格子移到静止的指针下时不改选中。
    let px = null,
      py = null;
    body.addEventListener('pointermove', (e) => {
      if (e.clientX === px && e.clientY === py) return;
      px = e.clientX;
      py = e.clientY;
      const node = e.target.closest('.ov-item');
      if (node) hooks.hover(node);
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      s.close();
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      /* close 事件异步派发：期间已重新打开就不清理 */ clearTimeout(closing);
      closing = 0;
      dialog.classList.remove('closing');
      px = py = null;
      q.value = '';
      kinds.clear();
      syncKinds();
      none.hidden = true;
      hooks.cleanup();
      main.focus({ preventScroll: true });
    });
    sheets.push(s);
    ctx.keys.push({
      down(e) {
        if (!s.is(e)) return false;
        e.preventDefault();
        if (!e.repeat) s.open();
        return true;
      },
    });
    return s;
  }
  return { sheets, masonry, sheet };
}
