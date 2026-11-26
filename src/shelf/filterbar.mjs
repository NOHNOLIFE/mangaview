// 书架的筛选界面：一行主工具条（搜索框、筛选面板开关、清除）、可折叠的筛选面板（页数、书签、类型、标签）、
// 面板收起时的生效条件摘要、预设按钮的状态，以及书架内的搜索快捷键与弹出层的 Esc。筛选状态见 filter.mjs。
import { norm } from '../core/match.mjs';
import { extend } from '../core/lang.mjs';
import { EMPTY, same } from './criteria.mjs';
import { $ } from './util.mjs';

extend({
  moreTags: ['Show all ({n} more)', '展开全部（还有 {n} 个）', 'すべて表示（あと {n} 個）', '모두 보기 ({n}개 더)'],
  lessTags: ['Show less', '收起', '閉じる', '접기'],
  filtersHide: ['Hide filters', '收起筛选', '絞り込みを閉じる', '필터 접기'],
});
export function install(ctx, S) {
  const { t, fmt, make, icon, get, put, shelf } = ctx;
  const setFilter = (...a) => S.setFilter(...a);
  const extraFilters = (...a) => S.extraFilters(...a);
  const filtering = (...a) => S.filtering(...a);
  const allTags = (...a) => S.allTags(...a);
  const inView = (...a) => S.inView(...a);
  const chip = (...a) => S.chip(...a);
  const rangeText = (...a) => S.rangeText(...a);
  const kindText = (...a) => S.kindText(...a);
  const drawPresets = (...a) => S.drawPresets(...a);
  const setActive = (...a) => S.setActive(...a);
  // ---- 筛选界面：一行主工具条；页数、书签、标签在可折叠的筛选面板里；面板收起且有筛选时，下方一行显示生效的条件（各条可单独移除）。
  const panel = $('filterPanel'),
    toggle = $('filterToggle');
  let tagsOpen = false;
  function showPanel(open) {
    panel.hidden = !open;
    put('shelfPanel', open);
    drawFilterUI();
  }
  toggle.onclick = () => showPanel(panel.hidden);
  panel.hidden = !get('shelfPanel', false);
  function toggleTag(tag) {
    const k = norm(tag),
      has = S.F.tags.some((x) => norm(x) === k);
    setFilter({ ...S.F, tags: has ? S.F.tags.filter((x) => norm(x) !== k) : [...S.F.tags, tag] }, { inputs: false });
  }
  function drawFilterUI() {
    const n = extraFilters();
    // 工具条按钮都只显示图标（文字在提示里），宽度固定：角标叠在按钮角上，“清除筛选”无条件时禁用而不移除。
    $('filterBadge').textContent = n || '';
    toggle.classList.toggle('on', n > 0);
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    toggle.title = t(panel.hidden ? 'filters' : 'filtersHide');
    toggle.setAttribute('aria-label', t('filters'));
    $('clearBtn').disabled = !filtering() && !S.presetId;
    $('markedToggle').setAttribute('aria-pressed', String(S.F.marked));
    for (const b of $('kindFilter').querySelectorAll('[data-kind]'))
      b.setAttribute('aria-pressed', String(S.F.kinds.includes(b.dataset.kind)));
    // 标签：当前列表中的标签按使用次数排列，已选的排在最前（即使当前列表里没有）。默认只显示一行，可展开或搜索。
    const tags = allTags((b) => inView(b)),
      counts = new Map(tags),
      on = new Set(S.F.tags.map(norm)),
      q = norm($('tagQuery').value);
    const items = [
      ...S.F.tags.map((x) => [norm(x), { tag: x, n: counts.get(norm(x))?.n ?? 0 }]),
      ...tags.filter(([k]) => !on.has(k)),
    ].filter(([k]) => !q || k.includes(q));
    $('tagSection').hidden = !tags.length && !S.F.tags.length;
    const bar = $('tagBar');
    bar.classList.toggle('collapsed', !tagsOpen && !q);
    bar.replaceChildren(
      ...items
        .slice(0, 300)
        .map(([k, { tag, n }]) => chip(tag, { count: n, pressed: on.has(k), onclick: () => toggleTag(tag) })),
    );
    const more = $('tagMore');
    more.hidden = true;
    if (!panel.hidden && !q) {
      const kids = [...bar.children],
        top = kids[0]?.offsetTop ?? 0,
        hidden = tagsOpen ? 0 : kids.filter((c) => c.offsetTop > top + 4).length + Math.max(0, items.length - 300);
      if (tagsOpen || hidden) {
        more.hidden = false;
        more.textContent = tagsOpen ? t('lessTags') : fmt('moreTags', { n: hidden });
      }
    }
    // 生效条件摘要（关键词就在搜索框里，不重复显示）
    const sum = $('filterSummary');
    sum.hidden = !panel.hidden || !n;
    if (!sum.hidden) {
      const x = (label, fn) => {
        const c = make('span', 'fchip', label),
          b = make('button', 'tag-x');
        b.type = 'button';
        b.setAttribute('aria-label', t('remove') + ' · ' + label);
        b.append(icon('close'));
        b.onclick = fn;
        c.append(b);
        return c;
      };
      sum.replaceChildren(
        make('span', 'flabel', t('filterOn')),
        ...S.F.tags.map((tag) => chip(tag, { remove: () => toggleTag(tag) })),
        ...(S.F.min || S.F.max ? [x(rangeText(S.F), () => setFilter({ ...S.F, min: '', max: '' }))] : []),
        ...(S.F.marked ? [x(t('hasBookmarks'), () => setFilter({ ...S.F, marked: false }))] : []),
        ...(S.F.kinds.length ? [x(kindText(S.F), () => setFilter({ ...S.F, kinds: [] }))] : []),
      );
    }
    // 预设按钮：正在使用预设时高亮，预设名写在提示里；条件被改动后加“已修改”圆点。
    const p = S.presets.find((x) => x.id === S.presetId),
      mod = !!p && !same(S.F, p.f),
      pb = $('presetBtn');
    pb.classList.toggle('on', !!p);
    pb.classList.toggle('modified', mod);
    pb.title = p ? fmt('presetNow', { s: p.name + (mod ? ' (' + t('presetModified') + ')' : '') }) : t('presets');
    pb.setAttribute('aria-label', pb.title);
    if ($('presetPop').matches(':popover-open')) drawPresets();
  }
  $('tagMore').onclick = () => {
    tagsOpen = !tagsOpen;
    drawFilterUI();
  };
  $('markedToggle').onclick = () => setFilter({ ...S.F, marked: !S.F.marked });
  // 类型：图片 / 视频 / 音频，可多选，全不选等于不限。
  $('kindFilter').onclick = (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    const k = b.dataset.kind;
    setFilter({ ...S.F, kinds: S.F.kinds.includes(k) ? S.F.kinds.filter((x) => x !== k) : [...S.F.kinds, k] });
  };
  function clearFilters() {
    $('tagQuery').value = '';
    setFilter(EMPTY, { preset: null });
  }
  const form = $('filters');
  form.oninput = (e) => {
    if (e.target.id === 'tagQuery') {
      drawFilterUI();
      return;
    }
    if (!['query', 'min', 'max'].includes(e.target.id)) return;
    setFilter({ ...S.F, q: $('query').value, min: $('min').value, max: $('max').value }, { inputs: false });
  };
  form.onreset = () => queueMicrotask(clearFilters);
  form.onsubmit = (e) => e.preventDefault();
  // 弹出层打开时 Esc 只关闭弹出层，不关闭整个书架。
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !shelf.open || e.target.closest?.('.pp-name')) return;
      const open = shelf.querySelector(':popover-open');
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      const btn = $({ presetPop: 'presetBtn', sortPop: 'sortBtn' }[open.id] ?? 'bulkBtn');
      open.hidePopover();
      btn.focus();
    },
    true,
  );
  // 搜索框快捷键：/ 或 Ctrl+F 聚焦；在搜索框里按 ↓ 回到列表，Esc 先清空关键词、再回到列表。
  shelf.addEventListener('keydown', (e) => {
    const typing = e.target.closest('input,select,textarea');
    if (
      !typing &&
      ((e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f'))
    ) {
      e.preventDefault();
      $('query').focus();
      $('query').select();
      return;
    }
    if (e.target.id === 'query' && (e.key === 'ArrowDown' || e.key === 'Escape')) {
      e.preventDefault();
      if (e.key === 'Escape' && $('query').value) {
        $('query').value = '';
        setFilter({ ...S.F, q: '' }, { inputs: false });
        return;
      }
      if (S.activeId) setActive(S.activeId, { focus: true, scroll: 'nearest' });
    }
  });
  S.drawFilterUI = drawFilterUI;
  S.clearFilters = clearFilters;
}
