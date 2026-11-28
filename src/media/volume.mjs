// 统一音量：全应用一套音量和静音（S.volume / S.muted），所有媒体共用；设置类偏好，跨窗口即时同步，去抖保存。
// 音量按钮与小面板在总控栏（reader/controlbar.mjs，经 ctx.media 调用）；按键调音量在 keys.mjs（画中画窗口里的在 pipview.mjs）。变化时派发 ctx.emit('media', 'volume')。
// setVolume(值, 提示)：提示为 true 时在主窗口的提示浮层显示音量（带音量条），为浮层实例（hud.mjs）时显示在那里（画中画面板）。
export function install(ctx, S) {
  const { get, put } = ctx;
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
    for (const p of S.all()) {
      p.el.volume = S.volume;
      p.el.muted = S.muted;
    }
    ctx.emit('media', 'volume');
  }
  function saveVolume() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      put('volume', S.volume);
      put('muted', S.muted);
    }, 300);
  }
  function setVolume(v, hud = null) {
    S.volume = level(v);
    if (S.volume > 0) S.muted = false;
    applyVolume();
    saveVolume();
    const h = hud === true ? S.hud : hud;
    if (h) h.show(volIcon(), Math.round(S.volume * 100) + '%', S.volume);
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
