// 媒体画面的同一套交互：页内视频（含全屏）、音频卡片与画中画面板的内容区都经这里的登记（ctx.media.surface）接入，表现与逻辑相同：
// - 单击（没有拖动）= 播放 / 暂停这块画面的播放器；
// - 按住横向拖动 = 快进 / 快退：经全局拖动滚动（ui/dragscroll.mjs sideways）接入，方向判定与换算见 core/scrub.mjs，
//   判定为横向后不滚动、不触发点击、没有惯性；拖动中提示浮层显示偏移与目标时间（按整秒变化），松手才定位（拖动中不读盘），Esc 取消。
//   只对当前曲目（选中的媒体）、时长已知的生效；其他媒体上同样接手这个手势但什么也不做（横向拖动不定位、不算点击），竖向照常；
// - 提示显示在这块画面所在处（登记时给出的浮层，hud.mjs）。
// 各处的差异只作为登记的参数：surface(根元素, opts) → 注销函数。按下 / 点击归包含它的最近一个登记：
//   player(元素)：元素所在画面的播放器，不属于任何画面为 null（必填）；
//   seek(按下事件, 播放器)：按在这里能否横向定位（命中区域），默认能；
//   play(元素, 播放器)：单击这里是否播放 / 暂停，默认是（不是时点击仍算这块画面的，不再往外分派）；
//   width(播放器)：换算按哪个元素的宽度，默认根元素；
//   scroll(播放器)：竖向拖动是否照常滚动，默认否（什么也不做）；
//   hud(播放器)：提示浮层，默认主窗口的（S.hud）；
//   press(播放器)：单击的动作，默认后台播放 / 暂停（driver.mjs press）；
//   tap：为真时自己监听根元素上的点按（ui/dragscroll.mjs tap，根元素可以在另一个文档里，那个窗口须已接上拖动滚动）；
//   否则由外层分派：ctx.media.tap(元素) 处理点击并返回它是否属于画面（正文的点按先问这里，不是才翻屏，reader/tap.mjs）。
// 正文（#reader）的登记在这里：视频是整个画面，音频是卡片的字幕区（它不接收指针，按矩形判断）可定位；卡片上单击等同它自己的播放键，
// 控件（壳）上不动作；画面在外部时页内的占位（.mv-away，自己处理点击）、带 data-nodrag 的元素、播不了的不接手；
// 竖向拖动滚动正文，全屏的视频除外（什么也不做，不滚动背后的正文）；提示在主窗口（全屏时在全屏的播放器里）。
// 画中画面板的登记在 pipview.mjs：当前曲目，整个内容区（按钮除外），竖向拖动不滚动，提示在面板自己的浮层里。
import { clock } from '../core/model.mjs';
import { offset, target } from '../core/scrub.mjs';
import { sideways, tap } from '../ui/dragscroll.mjs';

export function install(ctx, S) {
  const { api } = S;
  const areas = new Map(); // 根元素 → 参数
  const elOf = (t) => (t?.nodeType === 1 ? t : (t?.parentElement ?? null));
  const areaOf = (t) => {
    for (let el = t; el; el = el.parentElement) if (areas.has(el)) return el;
    return null;
  };
  function surface(root, o) {
    const opts = {
      seek: () => true,
      play: () => true,
      width: () => root,
      scroll: () => false,
      hud: () => S.hud,
      press: (p) => S.press(p, 'page'),
      ...o,
    };
    areas.set(root, opts);
    const untap = o.tap ? tap(root, (e, down) => click(down.target)) : null;
    return () => {
      if (areas.get(root) === opts) areas.delete(root);
      untap?.();
    };
  }
  // 点击：属于某块画面时按它的规则播放 / 暂停，返回 true。
  function click(target) {
    const t = elOf(target),
      root = areaOf(t);
    if (!root) return false;
    const o = areas.get(root),
      p = o.player(t);
    if (!p) return false;
    if (p.state !== 'failed' && o.play(t, p)) o.press(p);
    return true;
  }
  // 横向定位的会话：p 为当前曲目，el 为捕获指针、按其宽度换算的元素，hud 为提示浮层，fixed 为竖向拖动不滚动。
  function session(p, el, hud, fixed) {
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
        hud.show(moved < 0 ? 'rewind' : 'fast-forward', text, null, 0);
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
      const t = elOf(e.target),
        root = areaOf(t);
      if (!root) return null;
      const o = areas.get(root),
        p = o.player(t);
      if (!p || p.state === 'failed' || !o.seek(e, p)) return null;
      const el = o.width(p),
        fixed = !o.scroll(p);
      // 不是当前曲目（或时长未知）：横向拖动什么也不做。
      if (p !== S.track || !api.duration(p)) return { el, fixed, move() {}, end() {}, cancel() {} };
      return session(p, el, o.hud(p), fixed);
    },
  });

  // ---- 正文里的媒体页
  const inside = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  surface(ctx.main, {
    player: (t) => S.playerOf(t.closest('.page.media')),
    seek: (e, p) =>
      !e.target.closest('[data-nodrag],.mv-away') && (p.kind !== 'audio' || inside(p.subs.getBoundingClientRect(), e)),
    play: (t) => !t.closest('.mv-shell,.mv-subs,.mv-away'),
    width: (p) => p.node,
    scroll: (p) => S.full !== p,
  });
  ctx.media.surface = surface;
  ctx.media.tap = click;
}
