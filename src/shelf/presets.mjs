// 搜索预设：把当前筛选条件存为预设，可命名、重命名、删除、点选应用；别的窗口改了预设时重新读入。
import { norm } from '../core/match.mjs';
import { extend } from '../core/lang.mjs';
import { clean, same } from './criteria.mjs';
import { $, anchor } from './util.mjs';

extend({
  presets: ['Presets', '预设', 'プリセット', '프리셋'],
  presetSave: [
    'Save current filters as a preset',
    '将当前筛选保存为预设',
    '現在の絞り込みをプリセットに保存',
    '현재 필터를 프리셋으로 저장',
  ],
  presetName: ['Preset name', '预设名称', 'プリセット名', '프리셋 이름'],
  presetFind: ['Find preset', '查找预设', 'プリセットを検索', '프리셋 찾기'],
  presetEmpty: [
    'No presets yet. Set some filters, then save them here.',
    '还没有预设。设置好筛选条件后，可以在这里保存。',
    'プリセットはまだありません。絞り込みを設定してからここで保存できます。',
    '아직 프리셋이 없습니다. 필터를 설정한 뒤 여기에서 저장하세요.',
  ],
  presetNoMatch: ['No matching presets', '没有匹配的预设', '一致するプリセットはありません', '일치하는 프리셋 없음'],
  presetNothing: ['Set a filter first', '请先设置筛选条件', '先に絞り込みを設定してください', '먼저 필터를 설정하세요'],
  presetUpdate: ['Update with current filters', '用当前条件更新', '現在の条件で更新', '현재 조건으로 업데이트'],
  presetModified: ['modified', '已修改', '変更あり', '수정됨'],
  presetRename: ['Rename', '重命名', '名前を変更', '이름 바꾸기'],
  presetDelete: ['Delete preset', '删除预设', 'プリセットを削除', '프리셋 삭제'],
  presetSaved: ['Preset saved', '已保存预设', 'プリセットを保存しました', '프리셋을 저장했습니다'],
  presetAll: ['All books (no filter)', '全部书籍（无筛选）', 'すべての本（絞り込みなし）', '모든 책 (필터 없음)'],
  presetNow: ['Preset: {s}', '预设：{s}', 'プリセット：{s}', '프리셋: {s}'],
});
export function install(ctx, S) {
  const { t, notice, make, icon, iconButton, shelf } = ctx;
  const describe = (...a) => S.describe(...a);
  const filtering = (...a) => S.filtering(...a);
  const storeFilter = (...a) => S.storeFilter(...a);
  const savePresets = (...a) => S.savePresets(...a);
  const drawFilterUI = (...a) => S.drawFilterUI(...a);
  const setFilter = (...a) => S.setFilter(...a);
  const loadPresets = (...a) => S.loadPresets(...a);
  // ---- 搜索预设：把当前筛选条件存为预设，可命名、重命名、删除、点选应用；应用后仍可继续调整，按钮上标出“已修改”。
  const pop = $('presetPop');
  let presetQuery = '',
    editing = null; // editing：正在命名的预设 id，'new' 表示新建
  function drawPresets() {
    const q = norm(presetQuery),
      list = S.presets.filter((p) => !q || norm(p.name).includes(q) || norm(describe(p.f)).includes(q)),
      rows = [];
    if (editing === 'new')
      rows.push(
        nameRow(describe(S.F).slice(0, 40), (name) => {
          const p = { id: crypto.randomUUID(), name, f: clean(S.F) };
          S.presets.push(p);
          S.presetId = p.id;
          savePresets();
          storeFilter();
          notice(null, t('presetSaved'));
        }),
      );
    else {
      const add = make('button', 'pp-add');
      add.type = 'button';
      add.append(icon('plus'), make('span', '', filtering() ? t('presetSave') : t('presetNothing')));
      add.disabled = !filtering();
      add.onclick = () => {
        editing = 'new';
        drawPresets();
      };
      rows.push(add);
    }
    if (S.presets.length > 6) {
      const s = make('label', 'pp-search'),
        input = make('input');
      input.type = 'search';
      input.value = presetQuery;
      input.placeholder = t('presetFind');
      input.setAttribute('aria-label', input.placeholder);
      input.oninput = () => {
        presetQuery = input.value;
        drawPresets();
        const again = pop.querySelector('.pp-search input');
        again?.focus();
        again?.setSelectionRange(9999, 9999);
      };
      s.append(icon('search'), input);
      rows.push(s);
    }
    const box = make('div', 'pp-list');
    if (!S.presets.length) box.append(make('p', 'pp-empty', t('presetEmpty')));
    else if (!list.length) box.append(make('p', 'pp-empty', t('presetNoMatch')));
    for (const p of list) {
      if (editing === p.id) {
        box.append(
          nameRow(p.name, (name) => {
            p.name = name;
            savePresets();
          }),
        );
        continue;
      }
      const on = p.id === S.presetId,
        mod = on && !same(S.F, p.f),
        row = make('div', 'pp-row' + (on ? ' on' : ''));
      const apply = make('button', 'pp-apply');
      apply.type = 'button';
      apply.setAttribute('aria-pressed', String(on));
      const txt = make('span', 'pp-txt');
      txt.append(
        make('strong', '', p.name),
        make('small', '', (mod ? t('presetModified') + ' · ' : '') + (describe(p.f) || t('presetAll'))),
      );
      apply.append(icon(on ? 'check' : 'star'), txt);
      apply.onclick = () => {
        pop.hidePopover();
        $('tagQuery').value = '';
        setFilter(p.f, { preset: p.id });
      };
      row.append(apply);
      if (mod)
        row.append(
          iconButton('refresh', t('presetUpdate'), () => {
            p.f = clean(S.F);
            savePresets();
            drawFilterUI();
          }),
        );
      row.append(
        iconButton('pencil', t('presetRename'), () => {
          editing = p.id;
          drawPresets();
        }),
        iconButton(
          'trash',
          t('presetDelete'),
          () => {
            S.presets = S.presets.filter((x) => x !== p);
            if (S.presetId === p.id) {
              S.presetId = null;
              storeFilter();
            }
            savePresets();
            drawFilterUI();
            drawPresets();
          },
          'danger',
        ),
      );
      box.append(row);
    }
    rows.push(box);
    pop.replaceChildren(...rows);
  }
  function nameRow(value, done) {
    const f = make('form', 'pp-name'),
      input = make('input'),
      ok = make('button', 'primary', t('renameSave'));
    input.value = value;
    input.maxLength = 60;
    input.placeholder = t('presetName');
    input.setAttribute('aria-label', input.placeholder);
    ok.type = 'submit';
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return input.focus();
      done(v);
      editing = null;
      drawFilterUI();
      drawPresets();
      (pop.querySelector('.pp-row.on .pp-apply') || pop.querySelector('button:not(:disabled)'))?.focus();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        editing = null;
        drawPresets();
      }
    };
    f.append(input, ok);
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return f;
  }
  pop.addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') {
      editing = null;
      presetQuery = '';
      drawPresets();
    }
  });
  // 别的窗口改了预设：重新读入，之后在本窗口保存时不会覆盖掉它们（正在命名时先不重画）。
  ctx.on('storage', (key) => {
    if (key !== 'shelfPresets') return;
    S.presets = loadPresets();
    if (S.presetId && !S.presets.some((p) => p.id === S.presetId)) S.presetId = null;
    if (shelf.open) drawFilterUI();
    if (pop.matches(':popover-open') && !editing) drawPresets();
  });
  anchor(pop, $('presetBtn'));
  S.drawPresets = drawPresets;
}
