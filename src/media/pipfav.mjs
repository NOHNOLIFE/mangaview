// 画中画面板标题行的「收藏列表」按钮与菜单（pipview.mjs 装配；数据是 ctx.media.queue.favorites，见 queue.mjs）。
// - 按钮点击打开 / 关闭菜单（popover，建在面板所在的文档里；点菜单外、Esc 收起）。菜单贴着按钮弹出（上方放得下放上方，否则下方），
//   右沿与按钮对齐、夹在窗口内，列表长时在菜单里滚动。
// - 第一项「保存当前列表」：点击后就地变成名称输入框（默认名 favorites.defaultName()），回车保存、Esc 取消；当前列表没有可保存的项时不可用。
// - 其下是已收藏的列表（名称、项数，按保存顺序）：点击即载入并播放（载入后菜单收起；一项都找不到时在菜单里说明，列表不变），
//   每个有「改名」（就地编辑，回车保存、Esc 取消）和「删除」。没有收藏时是一句说明。
// - 菜单里 ↑ ↓ 在按钮之间移动焦点；菜单里的按键不传到面板的按键处理（不会切换播放、移动列表的选中项）。
// - 收藏或列表变了（'queue' 的 'favorites' / 'list'）时，菜单开着且没有在编辑名称就重画。
// favorites(ctx, {root, button, onClose}) → {menu, refresh(), open(), close()}；onClose 在菜单收起时调用（操作面板据此决定是否淡出）。
import { extend } from '../core/lang.mjs';

extend({
  pipFavSave: ['Save the current list', '保存当前列表', '現在のリストを保存', '현재 목록 저장'],
  pipFavName: ['List name', '列表名称', 'リスト名', '목록 이름'],
  pipFavEmpty: ['No saved lists yet', '还没有收藏的列表', '保存したリストはありません', '저장된 목록이 없습니다'],
  pipFavCount: ['{n} files', '{n} 个文件', '{n} ファイル', '파일 {n}개'],
  pipFavRename: ['Rename', '改名', '名前を変更', '이름 바꾸기'],
  pipFavDelete: ['Delete', '删除', '削除', '삭제'],
});
const GAP = 6,
  EDGE = 6;

export function favorites(ctx, { root, button, onClose = () => {} }) {
  const { t, fmt, make, icon } = ctx;
  const F = () => ctx.media.queue.favorites;
  const menu = make('div', 'pip-menu');
  menu.popover = 'auto';
  menu.setAttribute('role', 'menu');
  root.append(menu);
  button.popoverTargetElement = menu;
  button.popoverTargetAction = 'toggle';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  let editing = null, // 正在命名的收藏 id，'new' 为保存当前列表
    note = ''; // 载入失败的说明
  const isOpen = () => menu.matches(':popover-open');

  function item(cls, label, fn) {
    const b = make('button', 'pip-menu-item ' + cls);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (label) b.append(label);
    b.addEventListener('click', fn);
    return b;
  }
  function small(name, label, fn, cls = '') {
    const b = ctx.iconButton(name, label, fn, 'pip-menu-ib ' + cls);
    b.setAttribute('role', 'menuitem');
    return b;
  }
  function draw() {
    const out = [];
    if (editing === 'new')
      out.push(
        nameForm(F().defaultName(), (name) => {
          F().save(name);
        }),
      );
    else {
      const add = item('pip-menu-add', null, () => {
        editing = 'new';
        note = '';
        draw();
      });
      add.append(icon('plus'), make('span', '', t('pipFavSave')));
      add.disabled = !F().defaultName();
      out.push(add);
    }
    if (note) out.push(make('p', 'pip-menu-note', note));
    const all = F().list(),
      box = make('div', 'pip-menu-list');
    if (!all.length) box.append(make('p', 'pip-menu-empty', t('pipFavEmpty')));
    for (const f of all) {
      if (editing === f.id) {
        box.append(nameForm(f.name, (name) => F().rename(f.id, name)));
        continue;
      }
      const row = make('div', 'pip-menu-row'),
        load = item('pip-menu-load', null, () => {
          if (F().load(f.id)) return close();
          note = t('qFavGone');
          draw();
        }),
        txt = make('span', 'pip-menu-txt');
      load.dataset.id = f.id;
      txt.append(make('strong', '', f.name), make('small', '', fmt('pipFavCount', { n: f.count })));
      txt.firstChild.title = f.name;
      load.append(icon('star'), txt);
      row.append(
        load,
        small('pencil', t('pipFavRename'), () => {
          editing = f.id;
          note = '';
          draw();
        }),
        small(
          'trash',
          t('pipFavDelete'),
          () => {
            F().remove(f.id);
            draw();
            menu.querySelector('.pip-menu-item:not(:disabled)')?.focus();
          },
          'danger',
        ),
      );
      box.append(row);
    }
    out.push(box);
    menu.replaceChildren(...out);
    if (isOpen()) place();
  }
  // 就地输入名称：回车（或「保存」）提交，空名不提交；Esc 取消。
  function nameForm(value, done) {
    const f = make('form', 'pip-menu-name'),
      input = make('input'),
      ok = make('button', 'primary', t('renameSave'));
    input.value = value;
    input.maxLength = 60;
    input.placeholder = t('pipFavName');
    input.setAttribute('aria-label', input.placeholder);
    ok.type = 'submit';
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      done(v);
      editing = null;
      draw();
      menu.querySelector('.pip-menu-item:not(:disabled)')?.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      editing = null;
      draw();
      menu.querySelector('.pip-menu-item:not(:disabled)')?.focus();
    });
    f.append(input, ok);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return f;
  }
  // 贴着按钮：上方放得下放上方，否则放在空间大的一侧（限高、菜单里滚动）；右沿与按钮对齐，夹在窗口内。
  function place() {
    const win = menu.ownerDocument.defaultView,
      r = button.getBoundingClientRect(),
      W = win.innerWidth,
      H = win.innerHeight,
      above = r.top - GAP - EDGE,
      below = H - r.bottom - GAP - EDGE;
    menu.style.maxHeight = '';
    const h = menu.offsetHeight,
      up = h <= above || above >= below,
      room = Math.max(0, up ? above : below);
    if (h > room) menu.style.maxHeight = room + 'px';
    const w = menu.offsetWidth,
      hh = Math.min(h, room);
    menu.style.left = Math.round(Math.max(EDGE, Math.min(W - w - EDGE, r.right - w))) + 'px';
    menu.style.top = Math.round(up ? r.top - GAP - hh : r.bottom + GAP) + 'px';
  }
  menu.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    editing = null;
    note = '';
    draw();
  });
  menu.addEventListener('toggle', (e) => {
    const open = e.newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      place();
      if (button.matches(':focus-visible')) menu.querySelector('.pip-menu-item:not(:disabled)')?.focus();
    } else {
      editing = null;
      onClose();
    }
  });
  // 菜单里的按键：↑ ↓ 在按钮之间移动焦点，其余（除了输入框里的）不再传到面板的按键处理。
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = [...menu.querySelectorAll('button:not(:disabled)')],
        i = list.indexOf(menu.ownerDocument.activeElement),
        n = list.length;
      if (n) list[i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus();
      e.preventDefault();
    }
    e.stopPropagation();
  });
  function close() {
    if (isOpen()) menu.hidePopover();
  }
  return {
    menu,
    open: isOpen,
    close,
    refresh() {
      if (isOpen() && !editing) draw();
    },
  };
}
