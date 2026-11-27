// 媒体按键：长按 A / D / ← / → 快退 / 快进当前媒体（ctx.pageHold）；空格 = 总控栏的大播放键（ctx.transport.toggle）、Q / E 调音量、Z / / 新窗口播放（ctx.keys）。
// 按住快退 / 快进的推进（S.hold）是同一份逻辑：长按 A / D 与文件栏、音频卡片时间处的快退 / 快进按钮（shell.mjs makeTime）共用，
// 按下立即走一步（core/model.mjs seekStep：最初 2 秒），按住每 250 毫秒再走一步，步长随按住的时间递增；提示浮层显示累计偏移与目标时间。
import { clock, seekStep, nudge } from '../core/model.mjs';

export function install(ctx, S) {
  const { players, api } = S;
  const current = (...a) => S.current(...a),
    popout = (...a) => S.popout(...a),
    setVolume = (...a) => S.setVolume(...a),
    progress = (...a) => S.progress(...a),
    showHud = (...a) => S.showHud(...a),
    hideHud = (...a) => S.hideHud(...a);
  // 按住快退 / 快进：start(播放器, d)（d 为 ±1；播放器没挂上源时不响应，返回 false），stop() 松开。暂停中的也可以。
  let held = null;
  function tick() {
    const { p, d, t0 } = held;
    if (p.state !== 'ready' || !players.has(p.node)) {
      hold.stop();
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
  const hold = {
    start(p, d) {
      hold.stop();
      if (!p || p.state !== 'ready') return false;
      held = { p, d, t0: performance.now(), moved: 0 };
      tick();
      if (held) held.timer = setInterval(() => held && tick(), 250);
      return !!held;
    },
    stop() {
      if (!held) return;
      clearInterval(held.timer);
      held = null;
      hideHud(700);
    },
  };
  S.hold = hold;
  // 长按 A / D / ← / →（reader/keys.mjs 的长按翻页键，经 ctx.pageHold 交到这里）：当前媒体快退 / 快进；没有当前媒体时无功能。
  ctx.pageHold = {
    start: (d) => hold.start(current(), d),
    stop: () => hold.stop(),
  };
  // 按键：空格（含 Shift）是总控栏的大播放键（运行 / 停止，见 reader/transport.mjs），不滚动；Q / ; 音量减、E / ' 音量加（每次 5%，按住连续调）；Z / / 新窗口播放当前媒体（无当前媒体时无功能）。
  // 书架页、全屏界面里的 / 是聚焦搜索框：它们是对话框，reader/keys.mjs 不把按键交到这里。
  ctx.keys.push({
    down(e) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) ctx.transport.toggle();
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
