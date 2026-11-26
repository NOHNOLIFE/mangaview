// 书的标签：标签芯片、标签统计（按使用次数）、标签编辑对话框（输入联想、最近用过的标签）。
import { natural } from '../core/model.mjs';
import { norm, hue } from '../core/match.mjs';
import { extend } from '../core/lang.mjs';
import { tagsOf } from './criteria.mjs';
import { $ } from './util.mjs';

extend({
  tagRecent: ['Recent', '最近', '最近', '최근'],
  tagHint: [
    '↑ ↓ to choose · Enter to add',
    '↑ ↓ 选择 · 回车添加',
    '↑ ↓ で選択 · Enter で追加',
    '↑ ↓ 선택 · Enter 추가',
  ],
});
export function install(ctx, S) {
  const { books, t, make, icon, safe, get, put, shelf } = ctx;
  const draw = (...a) => S.draw(...a);
  function allTags(filter = () => true) {
    const counts = new Map();
    for (const b of books.values())
      if (filter(b))
        for (const x of tagsOf(b)) {
          const k = norm(x),
            c = counts.get(k);
          counts.set(k, { tag: c?.tag ?? x, n: (c?.n ?? 0) + 1 });
        }
    return [...counts].sort((a, b) => b[1].n - a[1].n || natural(a[1].tag, b[1].tag));
  }
  function chip(tag, { onclick, pressed, count, remove } = {}) {
    const el = make(onclick ? 'button' : 'span', 'tag', tag);
    el.style.setProperty('--h', hue(tag));
    if (onclick) {
      el.type = 'button';
      el.onclick = onclick;
      if (pressed != null) el.setAttribute('aria-pressed', String(pressed));
    }
    if (count != null) el.append(make('small', '', count));
    if (remove) {
      const x = make('button', 'tag-x');
      x.type = 'button';
      x.setAttribute('aria-label', t('remove') + ' · ' + tag);
      x.append(icon('close'));
      x.onclick = remove;
      el.append(x);
    }
    return el;
  }

  // ---- 标签编辑：输入即联想已有标签（前缀匹配优先，再按包含），↑ ↓ 选择、回车添加；输入为空时列出最近用过和常用的标签。
  let tagging = null,
    hl = -1,
    sugs = [],
    sugOff = false; // sugOff：联想浮层被 Esc 收起，再输入或按 ↑ ↓ 时重新显示
  const recentTags = () => {
    const r = get('recentTags', []);
    return Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [];
  };
  function editTags(b) {
    tagging = b;
    hl = -1;
    sugOff = false;
    $('tagBook').textContent = ctx.title(b);
    $('tagInput').value = '';
    drawTagEditor();
    $('tagEditor').showModal();
    $('tagInput').focus();
  }
  const lastPart = (v) => v.split(/[,，、#]/).pop();
  function suggestions() {
    const have = new Set(tagsOf(tagging).map(norm)),
      q = norm(lastPart($('tagInput').value)),
      all = allTags().filter(([k]) => !have.has(k));
    if (!q) {
      const byKey = new Map(all),
        out = [],
        seen = new Set();
      for (const x of recentTags()) {
        const k = norm(x),
          c = byKey.get(k);
        if (c && !seen.has(k)) {
          seen.add(k);
          out.push({ tag: c.tag, n: c.n, recent: true });
        }
        if (out.length >= 8) break;
      }
      for (const [k, { tag, n }] of all) {
        if (out.length >= 30) break;
        if (!seen.has(k)) out.push({ tag, n });
      }
      return out;
    }
    const pre = [],
      mid = [];
    for (const [k, { tag, n }] of all)
      if (k.startsWith(q)) pre.push({ tag, n });
      else if (k.includes(q)) mid.push({ tag, n });
    return pre.concat(mid).slice(0, 30);
  }
  function drawTagEditor() {
    const b = tagging;
    if (!b) return;
    const input = $('tagInput');
    $('tagList').replaceChildren(
      ...tagsOf(b).map((x) =>
        chip(x, {
          remove: safe(async () => {
            b.tags = tagsOf(b).filter((y) => y !== x);
            await saveTags(b);
          }),
        }),
      ),
    );
    sugs = suggestions();
    if (hl >= sugs.length) hl = sugs.length - 1;
    // 联想是输入框下方的浮层（绝对定位，不参与对话框布局）：结果增减时对话框大小和输入框位置都不动；标签紧凑地一行排多个。
    const box = $('tagSuggest');
    box.hidden = sugOff || !sugs.length;
    input.setAttribute('aria-expanded', String(!box.hidden));
    box.replaceChildren(
      ...sugs.map((s, i) => {
        const row = make('button', 'sug');
        row.type = 'button';
        row.id = 'tag-sug-' + i;
        row.tabIndex = -1;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(i === hl));
        row.append(chip(s.tag), make('small', '', s.recent ? t('tagRecent') : String(s.n)));
        row.onmousedown = (e) => e.preventDefault();
        row.onclick = safe(() => pick(i));
        return row;
      }),
    );
    if (sugs.length) box.append(make('p', 'sug-hint', t('tagHint')));
    if (hl >= 0 && !box.hidden) {
      input.setAttribute('aria-activedescendant', 'tag-sug-' + hl);
      box.children[hl]?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function pick(i) {
    const s = sugs[i];
    if (!s) return;
    const parts = $('tagInput').value.split(/[,，、#]/);
    parts[parts.length - 1] = s.tag;
    hl = -1;
    return addTags(parts.join(','));
  }
  async function addTags(raw) {
    const b = tagging;
    if (!b) return;
    const known = new Map(allTags().map(([k, { tag }]) => [k, tag])),
      added = [];
    for (let x of raw
      .split(/[,，、#]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      x = known.get(norm(x)) ?? x; // 与已有标签只差大小写或全半角时沿用已有写法
      if (!tagsOf(b).some((y) => norm(y) === norm(x))) {
        b.tags = [...tagsOf(b), x];
        added.push(x);
      }
    }
    if (added.length) {
      const r = recentTags().filter((x) => !added.some((y) => norm(y) === norm(x)));
      put('recentTags', [...added.reverse(), ...r].slice(0, 12));
    }
    $('tagInput').value = '';
    hl = -1;
    await saveTags(b);
    $('tagInput').focus();
  }
  async function saveTags(b) {
    await ctx.persist(b);
    drawTagEditor();
    if (shelf.open) draw();
  }
  $('tagForm').onsubmit = (e) => {
    e.preventDefault();
    if (hl >= 0) safe(pick)(hl);
    else safe(addTags)($('tagInput').value);
  };
  $('tagInput').oninput = () => {
    hl = -1;
    sugOff = false;
    drawTagEditor();
  };
  $('tagInput').onkeydown = (e) => {
    if (e.isComposing) return;
    // ↑ ↓ 随时选择；← → 只在已选中某项时切换（否则留给光标移动）。Esc 先收起浮层，再按才关闭对话框。
    const step = { ArrowDown: 1, ArrowUp: -1, ...(hl >= 0 && !sugOff ? { ArrowRight: 1, ArrowLeft: -1 } : {}) }[e.key];
    if (step) {
      e.preventDefault();
      if (!sugs.length) return;
      if (sugOff) {
        sugOff = false;
        hl = -1;
      }
      hl = step > 0 ? (hl + 1) % sugs.length : hl <= 0 ? sugs.length - 1 : hl - 1;
      drawTagEditor();
    } else if (e.key === 'Escape' && !$('tagSuggest').hidden) {
      e.preventDefault();
      hl = -1;
      sugOff = true;
      drawTagEditor();
    }
  };
  $('tagEditor').addEventListener('close', () => {
    if (!$('tagEditor').open) tagging = null;
  }); // 同上：迟到的 close 不能让刚重新打开的编辑器失效
  S.allTags = allTags;
  S.chip = chip;
  S.editTags = editTags;
}
