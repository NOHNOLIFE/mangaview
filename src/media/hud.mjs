// 提示浮层（.mv-hud）：调音量、长按快进 / 快退时在阅读区中部短暂显示；全屏播放时显示在全屏的播放器里。
export function install(ctx, S) {
  const { make, icon } = ctx;
  // ---- 提示浮层：调音量、长按快进 / 快退时短暂显示。
  const hud = make('div', 'mv-hud'),
    hudIcon = icon('volume'),
    hudText = make('span', 'mv-hud-text'),
    hudBar = make('i', 'mv-hud-bar');
  let hudTimer = 0;
  hud.hidden = true;
  hud.setAttribute('aria-hidden', 'true');
  hud.append(hudIcon, hudText, hudBar);
  document.body.append(hud);
  function showHud(name, text, ratio = null, ms = 900) {
    clearTimeout(hudTimer);
    hudIcon.firstChild.setAttribute('href', '#i-' + name);
    hudText.textContent = text;
    hudBar.hidden = ratio == null;
    if (ratio != null) hudBar.style.setProperty('--v', ratio);
    const host = document.fullscreenElement?.classList.contains('media') ? document.fullscreenElement : document.body;
    if (hud.parentNode !== host) host.append(hud); // 全屏播放时提示显示在全屏的播放器里
    hud.hidden = false;
    if (ms)
      hudTimer = setTimeout(() => {
        hud.hidden = true;
      }, ms);
  }
  // 过 ms 毫秒后收起（长按快进 / 快退松开时，keys.mjs）。
  function hideHud(ms) {
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      hud.hidden = true;
    }, ms);
  }
  Object.assign(S, { showHud, hideHud });
}
