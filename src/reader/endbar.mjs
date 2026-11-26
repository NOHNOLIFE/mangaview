// 底部操作栏：鼠标贴近底缘稍作停留即弹出、移开后收起；上一本 / 回到书首 / 位置 / 滚到书尾 / 下一本。
import { extend } from '../core/lang.mjs';
import { $ } from '../ui/dom.mjs';
import { DWELL, LEAVE } from './toolbar.mjs';
extend({
  tbEdgeBottom: [
    'Show the action bar at the bottom edge',
    '鼠标移到底缘时弹出操作栏',
    '下端で操作バーを表示',
    '아래쪽 가장자리에서 작업 표시줄 표시',
  ],
  ebScoped: [
    'Only switches within the shelf filter results',
    '仅在书架筛选结果内切换',
    '本棚の絞り込み結果の中だけで切り替え',
    '책장 필터 결과 안에서만 전환',
  ],
});

export function install(ctx) {
  const main = ctx.main,
    end = $('endbar');
  const dialog = () => document.querySelector('dialog[open]');
  // 按钮只显示图标（放不下文字时）：把（已本地化的）文字写进 title 作为悬停提示，切换语言时同步。
  const tips = () => {
    for (const el of end.querySelectorAll('.eb')) el.title = el.querySelector('span')?.textContent ?? '';
    syncEnd();
    syncBooks();
    fitEnd();
  };
  // 按钮固定为 上一本、回到书首、位置、滚到书尾、下一本。
  // 回到书首 / 滚到书尾只滚动（已在首尾时变灰），切书交给两端的上一本 / 下一本；Home / End 在首尾再按一次切书的键盘行为不变（keys.mjs）。
  const [prevBtn, startBtn, endBtn, nextBtn] = ['prev', 'toStart', 'toEnd', 'next'].map((a) =>
    end.querySelector(`[data-act="${a}"]`),
  );
  ctx.actions.toStart = () => {
    if (!ctx.atStart()) ctx.toStart();
  };
  ctx.actions.toEnd = () => {
    if (!ctx.atEnd()) ctx.toEnd();
  };
  function syncEnd() {
    if (end.hidden) return;
    startBtn.disabled = ctx.atStart();
    endBtn.disabled = ctx.atEnd();
    syncPos();
  }
  // 位置只显示“已读 / 总张数”（滚到书尾即 n / n）。按总张数的位数预留宽度：零高度的隐藏占位串（::after）撑开宽度（等宽数字），
  // 滚动中位数变化时两侧按钮不左右移动。
  const pos = $('endPos');
  function syncPos() {
    const p = ctx.current && ctx.view.position(),
      n = p?.n ?? ctx.current?.pages.length ?? 0,
      d = String(n).length;
    pos.textContent = p ? `${ctx.atEnd() ? n : p.i + 1} / ${n}` : '';
    pos.dataset.room = n ? `${'0'.repeat(d)} / ${'0'.repeat(d)}` : '';
  }
  // 列表里没有别的书时，上一本 / 下一本变灰。
  // 书架页设了筛选条件时，上一本 / 下一本只在筛选结果内切换：按钮带一个小圆点，提示文字说明原因。
  function syncBooks() {
    if (end.hidden) return;
    const others = !!ctx.current && ctx.readingList(ctx.current).some((b) => b !== ctx.current);
    prevBtn.disabled = nextBtn.disabled = !others;
    const scoped = !!ctx.filtering?.();
    for (const b of [prevBtn, nextBtn]) {
      b.classList.toggle('scoped', scoped);
      b.title = (b.querySelector('span')?.textContent ?? '') + (scoped ? ' · ' + ctx.t('ebScoped') : '');
    }
  }
  // 宽度不够放下文字时只显示图标：先按完整宽度量一次，再决定。
  function fitEnd() {
    if (end.hidden) return;
    end.classList.remove('compact');
    if (end.scrollWidth > end.clientWidth + 1) end.classList.add('compact');
  }
  let endTimer = 0,
    endLeave = 0;
  const endCancel = () => {
      clearTimeout(endTimer);
      endTimer = 0;
    },
    endStay = () => {
      clearTimeout(endLeave);
      endLeave = 0;
    };
  function showEnd(open) {
    endStay();
    ctx.fade(end, open);
    document.body.classList.toggle('endbar-open', open);
    if (open) {
      syncEnd();
      syncBooks();
      fitEnd();
    }
  }
  const nearBottom = (e) => {
    const r = main.getBoundingClientRect();
    return ctx.atEdge('bottom', e) && e.clientX >= r.left && e.clientX <= r.right;
  };
  main.addEventListener(
    'scroll',
    () => {
      if (ctx.showing(end)) requestAnimationFrame(syncEnd);
    },
    { passive: true },
  );
  new ResizeObserver(() => {
    if (ctx.showing(end)) fitEnd();
  }).observe(main); // 窗口缩放、侧栏停靠时阅读区宽度变化
  end.addEventListener('click', () => main.focus()); // 按钮不留焦点，F / Enter / 空格继续作用于正文
  ctx.on('select', () => {
    if (!ctx.current) showEnd(false);
    else
      setTimeout(() => {
        syncEnd();
        syncBooks();
      });
  });
  ctx.on('books', syncBooks);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ctx.showing(end)) showEnd(false);
  });

  document.addEventListener('pointermove', (e) => {
    const mouse = e.pointerType === 'mouse' && !e.buttons;
    // 底缘弹出操作栏；离开后收起
    const low = mouse && ctx.current && nearBottom(e) && !ctx.showing(end) && !dialog() && ctx.get('edgeBottom', true);
    if (!low) endCancel();
    else if (!endTimer)
      endTimer = setTimeout(() => {
        endTimer = 0;
        if (ctx.current && !dialog()) showEnd(true);
      }, DWELL);
    if (ctx.showing(end) && e.pointerType === 'mouse') {
      if (end.contains(e.target) || nearBottom(e)) endStay();
      else if (!endLeave)
        endLeave = setTimeout(() => {
          endLeave = 0;
          if (!end.matches(':hover') && !end.querySelector(':focus-visible')) showEnd(false);
        }, LEAVE);
    }
  });
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) endCancel();
  });
  tips();
  ctx.on('lang', tips);
  ctx.prefs?.sync('edgeBottom');
  ctx.settings.push({
    id: 'edgeBottom',
    group: 'toolbar',
    label: 'tbEdgeBottom',
    type: 'toggle',
    get: () => ctx.get('edgeBottom', true),
    set: (v) => ctx.put('edgeBottom', !!v),
  });
}
