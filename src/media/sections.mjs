// 只播放书签区段（4.5）：开关状态 S.only（设置类偏好，跨窗口同步）、一个媒体内只播放它的区段、全书各媒体的区段（sectionMap）。
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
  const { t, get, put } = ctx,
    { times } = S;
  const selfSeek = (...a) => S.selfSeek(...a),
    remember = (...a) => S.remember(...a),
    render = (...a) => S.render(...a),
    finished = (...a) => S.finished(...a),
    refreshAll = (...a) => S.refreshAll(...a);
  S.only = get('sectionsOnly', false) === true;
  ctx.prefs.sync('sectionsOnly', (v) => {
    S.only = v === true;
    refreshAll();
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
  // 壳上「只播放书签区段」按钮（buttons.mjs）的操作。
  function toggleSections() {
    S.only = !S.only;
    put('sectionsOnly', S.only);
    refreshAll();
    if (S.only && ctx.current && !sectionMap(ctx.current)) ctx.notice(null, t('mvNoSections'));
  }
  Object.assign(S, { rangesOf, sectionTick, sectionMap, toggleSections });
}
