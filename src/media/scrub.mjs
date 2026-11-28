// 横向拖动快进 / 快退：在当前曲目（选中的媒体）的视频画面（含全屏）、音频卡片的字幕区上按住鼠标横向拖动即定位（方向判定与换算见 core/scrub.mjs）。
// 其他媒体上同样接手这个手势但什么也不做：横向拖动不定位、不算点击，竖向照常滚动。
// 手势经全局拖动滚动（ui/dragscroll.mjs sideways）接入：方向判定为横向时交到这里，不滚动、不触发点击、没有惯性；否则照常拖动滚动
// （全屏的视频除外：竖向拖动什么也不做，不滚动背后的正文）。
// 拖动中显示提示浮层（偏移与目标时间，按整秒变化；hud.mjs），松手才定位（拖动中不读盘）；Esc 取消。播不了、时长未知的媒体不接手。
// 外部的定位区（画中画面板的内容区）：ctx.media.scrubArea(元素, {show(图标, 文字), hide(毫秒)}) 登记，在它上面横向拖动定位当前曲目
// （与正文同一套判定与换算，宽度按该元素），提示显示在它自己的浮层里（show / hide，0 毫秒的 show 为常显）；按在按钮、带 data-nodrag 的元素上不接手。
// 返回注销函数。
import { clock } from '../core/model.mjs';
import { offset, target } from '../core/scrub.mjs';
import { sideways } from '../ui/dragscroll.mjs';

export function install(ctx, S) {
  const { api } = S;
  const inside = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  // 按下处属于哪个播放器的可定位区域：视频是整个画面，音频是卡片的字幕区（它不接收指针，按矩形判断）。
  function hit(e) {
    const p = S.playerOf(e.target.closest?.('.page.media'));
    if (!p || p.state === 'failed' || e.target.closest('[data-nodrag],.mv-away')) return null; // 画面在外部时的占位不定位
    if (p.kind === 'audio' && !inside(p.subs.getBoundingClientRect(), e)) return null;
    return p;
  }
  // 不是当前曲目（或时长未知）：横向拖动什么也不做。
  const inert = (p) => ({ el: p.node, move() {}, end() {}, cancel() {} });
  const hudOf = { show: (name, text) => S.showHud(name, text, null, 0), hide: (ms) => S.hideHud(ms) };
  // 外部的定位区：元素 → 它的提示浮层。
  const areas = new Map();
  ctx.media.scrubArea = (el, hud) => {
    areas.set(el, hud);
    return () => areas.delete(el);
  };
  const areaOf = (t) => {
    for (let el = t; el; el = el.parentElement) if (areas.has(el)) return el;
    return null;
  };
  // 定位会话：p 为当前曲目，el 为捕获指针的元素（宽度按它），hud 为提示浮层。
  function session(p, el, hud, fixed = false) {
    const d = api.duration(p),
      t0 = api.time(p),
      width = el.getBoundingClientRect().width;
    let off = null,
      to = t0,
      shown = '';
    return {
      el,
      fixed,
      move(dx) {
        off = offset(dx, width, d, off);
        to = target(t0, off, d);
        const moved = to - t0,
          text = (moved < 0 ? '−' : '+') + clock(Math.abs(moved)) + ' → ' + clock(to);
        if (text === shown) return; // 按整秒变化：同一秒内不重画
        shown = text;
        hud.show(moved < 0 ? 'rewind' : 'fast-forward', text);
      },
      end() {
        hud.hide(700);
        if (off && S.all().includes(p)) S.seek(p, to);
      },
      cancel() {
        if (shown) hud.hide(0);
      },
    };
  }
  sideways({
    grab(e) {
      const area = areaOf(e.target?.nodeType === 1 ? e.target : null);
      if (area) {
        const p = S.track;
        if (e.target.closest('button,[data-nodrag]') || !p || p.state === 'failed' || !api.duration(p)) return null;
        return session(p, area, areas.get(area));
      }
      const p = hit(e);
      if (!p) return null;
      if (p !== S.track || !api.duration(p)) return inert(p);
      return session(p, p.node, hudOf, S.full === p);
    },
  });
}
