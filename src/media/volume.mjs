// 统一音量：全应用一套音量和静音（S.volume / S.muted），所有媒体共用；设置类偏好，跨窗口即时同步，去抖保存。
// 壳上的音量滑块、静音按钮在 shell.mjs；按键调音量在 keys.mjs。
export function install(ctx, S) {
  const { get, put } = ctx,
    { players } = S;
  const renderVolume = (...a) => S.renderVolume(...a),
    showHud = (...a) => S.showHud(...a);
  // ---- 统一音量：全应用一套音量和静音，所有媒体共用；设置类偏好，跨窗口即时同步，去抖保存。
  const level = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(1, Math.max(0, +v)) : 1);
  S.volume = level(get('volume', 1));
  S.muted = !!get('muted', false);
  let saveTimer = 0;
  ctx.prefs
    .sync('volume', (v) => {
      S.volume = level(v ?? 1);
      applyVolume();
    })
    .sync('muted', (v) => {
      S.muted = !!v;
      applyVolume();
    });
  function applyVolume() {
    for (const p of players.values()) {
      p.el.volume = S.volume;
      p.el.muted = S.muted;
      renderVolume(p);
    }
  }
  function saveVolume() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      put('volume', S.volume);
      put('muted', S.muted);
    }, 300);
  }
  function setVolume(v, hud = false) {
    S.volume = level(v);
    if (S.volume > 0) S.muted = false;
    applyVolume();
    saveVolume();
    if (hud) showHud(volIcon(), Math.round(S.volume * 100) + '%', S.volume);
  }
  function setMuted(on) {
    S.muted = !!on;
    applyVolume();
    saveVolume();
  }
  const volIcon = () => (S.muted || !S.volume ? 'volume-x' : S.volume < 0.5 ? 'volume-low' : 'volume');
  window.addEventListener('pagehide', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      put('volume', S.volume);
      put('muted', S.muted);
    }
  });
  Object.assign(S, { setVolume, setMuted, volIcon });
}
