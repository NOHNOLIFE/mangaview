// 只播放书签区段（4.5）：开关状态 S.only（即 ctx.transport.sectionsOnly，偏好由 reader/transport.mjs 登记、跨窗口同步，开关在总控栏）、
// 一个媒体内只播放它的区段、全书各媒体的区段（sectionMap）。
// 区段规则在 playlist.mjs（sectionStart / sectionStep），区段来自 bookmarks.mjs（ctx.marks.ranges / mediaRanges）。
import { extend } from '../core/lang.mjs';
import { sectionStep } from '../core/playlist.mjs';

extend({
  mvSections: ['Play bookmark sections only', '只播放书签区段', 'しおり区間だけ再生', '책갈피 구간만 재생'],
  mvNoSections: [
    'This book has no bookmark sections',
    '本书没有书签区段',
    'この本にはしおり区間がありません',
    '이 책에는 책갈피 구간이 없습니다',
  ],
});
export function install(ctx, S) {
  const { t } = ctx,
    { times } = S;
  const selfSeek = (...a) => S.selfSeek(...a),
    remember = (...a) => S.remember(...a),
    render = (...a) => S.render(...a),
    finished = (...a) => S.finished(...a),
    refreshAll = (...a) => S.refreshAll(...a);
  S.only = !!ctx.transport?.sectionsOnly;
  // 本窗口打开开关而本书一个区段都没有时提示（别的窗口同步过来的不提示）。
  ctx.on('transport', (key, local) => {
    if (key !== 'sectionsOnly') return;
    S.only = ctx.transport.sectionsOnly;
    refreshAll();
    if (local && S.only && ctx.current && !sectionMap(ctx.current)) ctx.notice(null, t('mvNoSections'));
  });
  // ---- 只播放书签区段（4.5）：一个媒体内只播放它的区段（ctx.marks.ranges，秒），区段末尾跳到下一个区段，最后一个播完视为该媒体播完。
  const rangesOf = (p) => (p.ranges ??= ctx.marks?.ranges?.(p.book, p.page) ?? []);
  function sectionTick(p) {
    if (p.el.paused || p.el.seeking || p.state !== 'ready') return;
    const rs = rangesOf(p);
    if (!rs.length) {
      p.sec = null;
      return;
    }
    const r = sectionStep(rs, p.el.currentTime, p.sec ?? null);
    p.sec = r.k;
    if (r.seek != null) selfSeek(p, r.seek);
    else if (r.done) {
      p.done = true;
      p.time = 0;
      times.delete(p.page);
      p.el.pause();
      remember(p, 0);
      render(p);
      finished(p);
    }
  }
  const sectionMap = (book) => {
    const m = S.only ? ctx.marks?.mediaRanges?.(book) : null;
    return m && [...m.values()].some((r) => r.length) ? m : null;
  };
  Object.assign(S, { rangesOf, sectionTick, sectionMap });
}
