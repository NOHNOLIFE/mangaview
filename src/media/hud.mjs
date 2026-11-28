// 提示浮层（.mv-hud）：调音量、快进 / 快退（长按、时间处的快退 / 快进按钮、横向拖动定位）时短暂显示。同一个组件、同一套样式（media.css）：
// 图标（强调色）、文字、音量条（调音量时）。按宿主创建：主窗口一个（S.hud：阅读区中部，全屏播放时显示在全屏的播放器里），
// 每个画中画面板一个（ctx.media.hud(内容区)，pipview.mjs：内容区中上部，随内容区大小缩放，样式在 pipview.css）。
// 操作发生在哪个窗口、哪块画面，提示就显示在那里：调用方把那里的浮层交给 S.hold、S.setVolume、画面交互（surface.mjs）等。
// 实例：show(图标名, 文字, 音量比例?（给了才显示音量条）, 毫秒 = 900（0 为常显，直到 hide）)，hide(毫秒)（过这么久收起）。
export function install(ctx, S) {
  const { make, icon } = ctx;
  // host：放浮层的元素，或返回它的函数（每次显示时取）。
  function create(host) {
    const at = typeof host === 'function' ? host : () => host;
    const hud = make('div', 'mv-hud'),
      hudIcon = icon('volume'),
      hudText = make('span', 'mv-hud-text'),
      hudBar = make('i', 'mv-hud-bar');
    let timer = 0;
    hud.hidden = true;
    hud.setAttribute('aria-hidden', 'true');
    hud.append(hudIcon, hudText, hudBar);
    at().append(hud);
    const hide = (ms = 0) => {
      clearTimeout(timer);
      if (!ms) hud.hidden = true;
      else
        timer = setTimeout(() => {
          hud.hidden = true;
        }, ms);
    };
    return {
      el: hud,
      show(name, text, ratio = null, ms = 900) {
        clearTimeout(timer);
        hudIcon.firstChild.setAttribute('href', '#i-' + name);
        hudText.textContent = text;
        hudBar.hidden = ratio == null;
        if (ratio != null) hudBar.style.setProperty('--v', ratio);
        const place = at();
        if (hud.parentNode !== place) place.append(hud);
        hud.hidden = false;
        if (ms) timer = setTimeout(() => (hud.hidden = true), ms);
      },
      hide,
    };
  }
  // 主窗口的浮层：全屏播放时显示在全屏的播放器里。
  S.hud = create(() =>
    document.fullscreenElement?.classList.contains('media') ? document.fullscreenElement : document.body,
  );
  S.makeHud = create;
}
