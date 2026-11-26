// 媒体按键：长按 A / D / ← / → 快退 / 快进当前媒体（ctx.pageHold）；空格播放 / 暂停、Q / E 调音量、Z / / 新窗口播放（ctx.keys）。
import { clock, seekStep, nudge } from '../core/model.mjs';

export function install(ctx, S) {
  const { players, api } = S;
  const current = (...a) => S.current(...a),
    toggle = (...a) => S.toggle(...a),
    popout = (...a) => S.popout(...a),
    setVolume = (...a) => S.setVolume(...a),
    progress = (...a) => S.progress(...a),
    showHud = (...a) => S.showHud(...a),
    hideHud = (...a) => S.hideHud(...a);
  // 长按 A / D / ← / →（app.mjs 的 pageHold）：当前媒体快退 / 快进，暂停中的也可以；没有当前媒体时无功能。
  let held = null;
  function tick() {
    const { p, d, t0 } = held;
    if (p.state !== 'ready' || !players.has(p.node)) {
      ctx.pageHold.stop();
      return;
    }
    const el = p.el,
      end = api.duration(p),
      from = el.currentTime;
    let to = Math.max(0, from + d * seekStep(performance.now() - t0));
    if (end) to = Math.min(end, to);
    el.currentTime = to;
    held.moved += to - from;
    progress(p, to);
    showHud(
      d > 0 ? 'fast-forward' : 'rewind',
      (held.moved < 0 ? '−' : '+') + clock(Math.abs(held.moved)) + ' → ' + clock(to),
      null,
      0,
    );
  }
  ctx.pageHold = {
    start(d) {
      const p = current();
      if (!p || p.state !== 'ready') return;
      held = { p, d, t0: performance.now(), moved: 0 };
      tick();
      held.timer = setInterval(() => held && tick(), 250);
    },
    stop() {
      if (!held) return;
      clearInterval(held.timer);
      held = null;
      hideHud(700);
    },
  };
  // 按键：空格（含 Shift）播放 / 暂停当前媒体，不再滚动；Q / ; 音量减、E / ' 音量加（每次 5%，按住连续调）；Z / / 新窗口播放当前媒体（无当前媒体时无功能）。
  // 书架页、全屏界面里的 / 是聚焦搜索框：它们是对话框，app.mjs 不把按键交到这里。
  ctx.keys.push({
    down(e) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          const p = current();
          if (p) toggle(p);
        }
        return true;
      }
      if (e.altKey) return false;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === '/') {
        e.preventDefault();
        if (!e.repeat) {
          const p = current();
          if (p && p.state !== 'failed') popout(p);
        }
        return true;
      }
      const d =
        k === 'q' || k === ';' || e.code === 'Semicolon' ? -1 : k === 'e' || k === "'" || e.code === 'Quote' ? 1 : 0;
      if (!d) return false;
      e.preventDefault();
      setVolume(nudge(S.volume, d), true);
      return true;
    },
  });
}
