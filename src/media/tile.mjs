// 占位小块：缩略图栏、全屏缩略图里的视频、音频（ctx.mediaTile），固定样式，不读文件。
import { extend } from '../core/lang.mjs';
import { shownName, pageKind, clock } from '../core/model.mjs';
import { midName } from '../reader/view.mjs';

extend({
  mvVideo: ['Video', '视频', '動画', '동영상'],
  mvAudio: ['Audio', '音频', '音声', '오디오'],
});
export function install(ctx, S) {
  const { t, make, icon } = ctx;
  // ---- 占位小块：缩略图栏、全屏缩略图里的视频、音频（类型图标 + 文件名，时长已知时显示时长）。这一版不截帧。
  function tile(page, kind) {
    const el = make('div', 'mv-tile ' + kind),
      badge = make('span', 'mv-badge');
    el.setAttribute('aria-label', t(kind === 'video' ? 'mvVideo' : 'mvAudio') + ' · ' + shownName(page));
    badge.append(icon(kind === 'video' ? 'film' : 'music'));
    if (page.d) badge.append(make('span', '', clock(page.d)));
    el.append(icon(kind === 'video' ? 'film' : 'music'), midName(shownName(page)), badge);
    return el;
  }
  ctx.mediaTile = (page) => tile(page, pageKind(page));
  S.tile = tile;
}
