// 占位小块：缩略图栏、全屏缩略图里的视频、音频（ctx.mediaTile），固定样式，不读文件。两处大小、比例相同（全屏缩略图的格子比例，见 model.mjs cellRatio）。
// 视频：类型图标 + 文件名，类型与时长的角标在右下（之后叠上真实画面，见 reader/thumbs.mjs）。
// 音频：与书签列表里的音频书签同一种样子（art.mjs 的 audioArt / typeBadge / nameStrip）：整块是音频的图（书的当前封面，没有封面时
// 按文件名配色的占位图，不存进页记录，封面换了跟着变），右下角音乐图标 + 时长，文件名在下沿的名称条上；没有重命名、删除按钮，书签角标在右上。
// 悬停 / 聚焦时显示的是文件详情框（filecard.mjs），不设 title。
import { extend } from '../core/lang.mjs';
import { shownName, pageKind } from '../core/model.mjs';
import { midName } from '../reader/view.mjs';
import { audioArt, typeBadge, nameStrip } from './art.mjs';

extend({
  mvVideo: ['Video', '视频', '動画', '동영상'],
  mvAudio: ['Audio', '音频', '音声', '오디오'],
});
export function install(ctx, S) {
  const { t, make, icon } = ctx;
  function tile(page, kind) {
    const el = make('div', 'mv-tile ' + kind);
    el.setAttribute('aria-label', t(kind === 'video' ? 'mvVideo' : 'mvAudio') + ' · ' + shownName(page));
    if (kind === 'audio') {
      audioArt(ctx, el, bookOf(page), page);
      el.append(typeBadge(ctx, 'audio', page.d || undefined));
      nameStrip(ctx, el, midName(shownName(page)));
    } else el.append(icon('film'), midName(shownName(page)), typeBadge(ctx, 'video', page.d || undefined));
    return el;
  }
  // 占位所在的书：缩略图栏和全屏缩略图显示的都是当前书。
  const bookOf = (page) =>
    ctx.current?.pages.includes(page) ? ctx.current : [...ctx.books.values()].find((b) => b.pages.includes(page));
  ctx.mediaTile = (page) => tile(page, pageKind(page));
  S.tile = tile;
}
