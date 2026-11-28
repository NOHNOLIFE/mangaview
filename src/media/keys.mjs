// 媒体按键：长按 A / D / ← / → 快退 / 快进文件栏显示的媒体（ctx.pageHold）；空格、Shift+空格、Q / E 调音量（ctx.keys）。
// 空格：自动滚动运行中即停止；否则文件栏显示的是视频、音频就后台播放 / 暂停它（driver.mjs press）；否则开始自动滚动。Shift+空格固定是自动滚动的开关。
// 按住快退 / 快进的推进（S.hold）是同一份逻辑：长按 A / D 与文件栏、音频卡片时间处的快退 / 快进按钮（shell.mjs makeTime）共用，
// 按下立即走一步（core/model.mjs seekStep：最初 2 秒），按住每 250 毫秒再走一步，步长随按住的时间递增；提示浮层显示累计偏移与目标时间。
import { clock, seekStep, nudge } from '../core/model.mjs';

export function install(ctx, S) {
  const { api } = S;
  const current = (...a) => S.current(...a),
    setVolume = (...a) => S.setVolume(...a),
    progress = (...a) => S.progress(...a),
    showHud = (...a) => S.showHud(...a),
    hideHud = (...a) => S.hideHud(...a);
  // 按住快退 / 快进：start(播放器, d)（d 为 ±1；播放器没挂上源时不响应，返回 false），stop() 松开。暂停中的也可以。
  let held = null;
  function tick() {
    const { p, d, t0 } = held;
    if (p.state !== 'ready' || !S.all().includes(p)) {
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
  // 长按 A / D / ← / →（reader/keys.mjs 的长按翻页键，经 ctx.pageHold 交到这里）：文件栏显示的媒体（当前文件，规则见 core/selection.mjs）快退 / 快进；
  // 文件栏显示的是图片时无功能。start(d, 播放器?)：画中画面板传入当前曲目的播放器。
  ctx.pageHold = {
    start: (d, p = current()) => hold.start(p, d),
    stop: () => hold.stop(),
  };
  // 空格（见文件开头），不滚动。
  function space(shift) {
    const tr = ctx.transport;
    if (shift || tr.running) return tr.toggle();
    const p = S.target()?.player;
    if (p) {
      if (p.state !== 'failed') S.press(p, 'bar');
      return;
    }
    tr.start();
  }
  // 按键：空格、Shift+空格；Q / ; 音量减、E / ' 音量加（每次 5%，按住连续调）。
  ctx.keys.push({
    down(e) {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) space(e.shiftKey);
        return true;
      }
      if (e.altKey) return false;
      const k = e.key.toLowerCase();
      const d =
        k === 'q' || k === ';' || e.code === 'Semicolon' ? -1 : k === 'e' || k === "'" || e.code === 'Quote' ? 1 : 0;
      if (!d) return false;
      e.preventDefault();
      setVolume(nudge(S.volume, d), true);
      return true;
    },
  });
}
