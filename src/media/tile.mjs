// 占位小块：缩略图栏、全屏缩略图里的视频、音频（ctx.mediaTile），固定样式，不读文件。
// 视频：类型图标 + 文件名，时长角标在右下（之后叠上真实画面，见 reader/thumbs.mjs）。
// 音频：整块是音频的图（art.mjs：书的当前封面，没有封面时按文件名配色的占位图，不存进页记录，封面换了跟着变），
// 不压暗、不放大图标；小音乐图标 + 时长在上，文件名在最下（接近不透明的底色上）。
import { extend } from '../core/lang.mjs';
import { shownName, pageKind, clock } from '../core/model.mjs';
import { midName } from '../reader/view.mjs';
import { audioArt } from './art.mjs';

extend({
  mvVideo: ['Video', '视频', '動画', '동영상'],
  mvAudio: ['Audio', '音频', '音声', '오디오'],
});
export function install(ctx, S) {
  const { t, make, icon } = ctx;
  function tile(page, kind) {
    const el = make('div', 'mv-tile ' + kind),
      badge = make('span', 'mv-badge');
    el.setAttribute('aria-label', t(kind === 'video' ? 'mvVideo' : 'mvAudio') + ' · ' + shownName(page));
    badge.append(icon(kind === 'video' ? 'film' : 'music'));
    if (page.d) badge.append(make('span', '', clock(page.d)));
    if (kind === 'audio') {
      el.append(badge, midName(shownName(page)));
      audioArt(ctx, el, bookOf(page), page);
    } else el.append(icon('film'), midName(shownName(page)), badge);
    return el;
  }
  // 占位所在的书：缩略图栏和全屏缩略图显示的都是当前书。
  const bookOf = (page) =>
    ctx.current?.pages.includes(page) ? ctx.current : [...ctx.books.values()].find((b) => b.pages.includes(page));
  ctx.mediaTile = (page) => tile(page, pageKind(page));
  S.tile = tile;
}
