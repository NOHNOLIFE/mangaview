import { clock } from '../core/model.mjs';
import { isMedia } from './list.mjs';
// 书签的名称与位置文案（书签项的读屏说明、提示、搜索）。名称目前只来自 .pbf 导入（bm.label，pbf.mjs）。
export function install(ctx, S) {
  const { t, fmt } = ctx;
  // 书签所在位置的说明（读屏、提示）：第 N 页，媒体另带时间点和名称。
  function where(book, x, end = false) {
    const m = end ? x.bm.end : x.bm,
      i = end ? x.e : x.i;
    if (i < 0) return t('bmGone');
    return (
      fmt('bmPage', { n: i + 1 }) +
      (isMedia(m) ? ' · ' + clock(m.t) : '') +
      (!end && typeof x.bm.label === 'string' && x.bm.label ? ' · ' + x.bm.label : '')
    );
  }
  S.where = where;
}
