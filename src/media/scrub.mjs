// 横向拖动快进 / 快退：在视频画面（含全屏）、音频卡片的字幕区上按住鼠标横向拖动即定位（方向判定与换算见 core/scrub.mjs）。
// 手势经全局拖动滚动（ui/dragscroll.mjs sideways）接入：方向判定为横向时交到这里，不滚动、不触发点击、没有惯性；否则照常拖动滚动
// （全屏的视频除外：竖向拖动什么也不做，不滚动背后的正文）。
// 拖动中显示提示浮层（偏移与目标时间，按整秒变化；hud.mjs），松手才定位（拖动中不读盘）；Esc 取消。播不了、时长未知的媒体不接手。
import { clock } from '../core/model.mjs';
import { offset, target } from '../core/scrub.mjs';
import { sideways } from '../ui/dragscroll.mjs';

export function install(ctx, S) {
  const { players, api } = S;
  const inside = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  // 按下处属于哪个播放器的可定位区域：视频是整个画面，音频是卡片的字幕区（它不接收指针，按矩形判断）。
  function hit(e) {
    const node = e.target.closest?.('.page.media'),
      p = node && players.get(node);
    if (!p || p.state === 'failed' || e.target.closest('[data-nodrag],.mv-away')) return null; // 画面在外部时的占位不定位
    if (p.kind === 'audio' && !inside(p.subs.getBoundingClientRect(), e)) return null;
    return api.duration(p) ? p : null;
  }
  sideways({
    grab(e) {
      const p = hit(e);
      if (!p) return null;
      const d = api.duration(p),
        t0 = api.time(p),
        width = p.node.getBoundingClientRect().width;
      let off = null,
        to = t0,
        shown = '';
      return {
        el: p.node,
        fixed: S.full === p,
        move(dx) {
          off = offset(dx, width, d, off);
          to = target(t0, off, d);
          const moved = to - t0,
            text = (moved < 0 ? '−' : '+') + clock(Math.abs(moved)) + ' → ' + clock(to);
          if (text === shown) return; // 按整秒变化：同一秒内不重画
          shown = text;
          S.showHud(moved < 0 ? 'rewind' : 'fast-forward', text, null, 0);
        },
        end() {
          S.hideHud(700);
          if (off && S.all().includes(p)) S.seek(p, to);
        },
        cancel() {
          if (shown) S.hideHud(0);
        },
      };
    },
  });
}
