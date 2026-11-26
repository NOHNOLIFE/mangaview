// 新窗口播放（10.2）：打开一个较小的新 MangaView 窗口（地址带上书、页名和时间点，playlist.mjs popoutUrl）接着播放这个媒体，本窗口的它暂停。
// 新窗口启动时经 ctx.media.resume（media.mjs）定位到该媒体并从该处播放。
import { extend } from '../core/lang.mjs';
import { popoutUrl, popoutSize } from '../core/playlist.mjs';

extend({
  mvPopout: ['Play in a new window', '新窗口播放', '新しいウィンドウで再生', '새 창에서 재생'],
  mvPopupBlocked: [
    'The browser blocked the new window — allow pop-ups for this site and try again',
    '浏览器拦截了新窗口，请允许本站弹出窗口后重试',
    'ブラウザーが新しいウィンドウをブロックしました。このサイトのポップアップを許可してからもう一度お試しください',
    '브라우저가 새 창을 차단했습니다. 이 사이트의 팝업을 허용한 후 다시 시도하세요',
  ],
});
export function install(ctx, S) {
  const { t } = ctx,
    { api } = S;
  // ---- 新窗口播放（10.2）：打开一个较小的新窗口接着播放这个媒体，本窗口的它暂停。浏览器拦截弹窗时提示，本窗口照常播放。
  function popout(p) {
    if (!ctx.books.has(p.book.id)) return;
    const size = popoutSize(p.kind, p.page, window.screen),
      url = popoutUrl(location.pathname, { book: p.book.id, name: p.page.name, t: api.time(p) });
    let w = null;
    try {
      w = window.open(url, '_blank', 'popup,width=' + size.width + ',height=' + size.height);
    } catch (e) {
      console.warn(e);
    }
    if (!w) {
      ctx.notice(null, t('mvPopupBlocked'), 8000);
      return;
    }
    if (p.state === 'ready' && !p.el.paused) {
      p.userPaused = true;
      p.el.pause();
    } else if (p.wantPlay) {
      p.wantPlay = false;
      p.userPaused = true;
    }
  }
  S.popout = popout;
}
