// 画中画窗口（Document Picture-in-Picture）：一个始终置顶的小窗口，显示后台播放的画面并在里面完成全部播放列表操作（面板见 pipview.mjs）。
// 它不是另一套播放：曲目、进度、列表与主窗口是同一份，只是当前曲目的画面显示在哪里不同（ctx.media.stage，track.mjs）。
// - 入口：文件栏标题行的「画中画」（ctx.fileBar.addHead，order 20）、音频卡片按钮行上的同一个按钮（ctx.player.add，只上音频卡片，
//   不进文件栏下行的按钮位）、Z 键（ctx.keys，键位登记在 panels/help.mjs）。作用的文件：文件栏 / Z 是当前文件（ctx.media.target()），
//   音频卡片是该卡片。做什么由 core/pip.mjs entry 决定：视频、音频成为当前曲目并开始播放（已在播放的不中断、进度不变），画面搬进窗口
//   （没开就打开）；它的画面已在窗口里时再按即关闭窗口；图片（有当前曲目时文件栏显示的总是它，所以只在没有曲目时）只打开窗口，
//   窗口开着时再按关闭。
//   入口在用户手势里直接调用 requestWindow（不隔着异步）。浏览器不支持该接口时不登记任何入口，其余功能不受影响。
// - 打开：requestWindow（默认约 420×520，之后浏览器记住用户调整的大小），在空白文档里装上面板（pipview.mjs mount：自带样式表、图标、
//   lang、拖动滚动与按键），面板的内容区登记为显示位置（stage.take）。
// - 关闭：窗口自己的关闭按钮、再按入口、主窗口刷新或关闭；同一浏览器里另一个窗口（另一个 MangaView 窗口）再开画中画时浏览器会关掉这一个。
//   都在窗口的 pagehide 里同步收回：画面回到页内（或停放处），继续后台播放；万一浏览器仍暂停了它，立即恢复（进度不变）。
// - 打开 / 关闭时派发 ctx.emit('media', 'pip')；打开 / 关闭与显示位置变化（'display'）时重画播放器上登记的按钮（入口按钮的按下状态）。
// 接口 ctx.pip：supported（浏览器是否支持）；entry(文件)（入口的动作，须在用户手势里调用；文件为 {book, page, kind}，可为 null）；
// close()；window()（打开着的画中画窗口，没有为 null）；mount(容器, {keys})（把面板装进任意容器，见 pipview.mjs）。
import { extend } from '../core/lang.mjs';
import { entry as decide } from '../core/pip.mjs';
import { install as viewer } from './pipview.mjs';

extend({
  pipOpen: ['Picture-in-picture', '画中画', 'ピクチャーインピクチャー', 'PIP 화면'],
  pipClose: ['Exit picture-in-picture', '退出画中画', 'ピクチャーインピクチャーを終了', 'PIP 화면 종료'],
});
const SIZE = { width: 420, height: 520 };

export function install(ctx) {
  const api = globalThis.documentPictureInPicture ?? null,
    mount = viewer(ctx);
  const P = { win: null, view: null, opening: null };
  const Q = () => ctx.media.queue,
    stage = () => ctx.media.stage;
  ctx.pip = {
    supported: !!api,
    entry: (file) => act(file),
    close,
    window: () => P.win,
    mount,
  };
  if (!api) return;

  // 入口作用于 file 时会做什么（'show' | 'open' | 'close'）。
  function what(file) {
    const tr = Q().track(),
      isTrack = !!tr && !!file && tr.book === file.book && tr.page === file.page,
      out = !!P.view && stage().container === P.view.screen && stage().where() === 'out' && !!stage().screen();
    return decide({ open: !!P.win || !!P.opening, kind: file?.kind ?? null, track: isTrack, out });
  }
  function act(file) {
    const w = what(file);
    if (w === 'close') return close();
    if (w === 'show') {
      const tr = Q().track();
      if (!tr || tr.book !== file.book || tr.page !== file.page) Q().play({ book: file.book, page: file.page });
      else if (!Q().playing()) Q().toggle();
    }
    open(() => P.view && stage().take(P.view.screen));
  }
  // 打开窗口（已开着就直接 then）：requestWindow 在这里同步调用，调用方须在用户手势里。
  function open(then) {
    if (P.win) return then();
    if (!P.opening)
      P.opening = api
        .requestWindow(SIZE)
        .then(async (win) => {
          win.document.title = document.title;
          const view = mount(win.document.body, { keys: win });
          await view.ready;
          if (win.closed) {
            view.destroy();
            return;
          }
          P.win = win;
          P.view = view;
          win.addEventListener('pagehide', () => shut(win), { once: true });
          changed();
        })
        .catch((e) => console.warn(e))
        .finally(() => (P.opening = null));
    P.opening.then(() => P.win && then());
  }
  // 窗口关闭（pagehide，或这里主动关闭之前）：同一任务里把画面收回页内，再让窗口消失；原来在播放的保持播放。
  function shut(win) {
    if (P.win !== win) return;
    const tr = Q().track(),
      was = Q().playing();
    const view = P.view;
    P.win = null;
    P.view = null;
    view.destroy();
    changed();
    if (was)
      setTimeout(() => {
        const now = Q().track();
        if (now && now.page === tr.page && !Q().playing()) Q().toggle();
      }, 0);
  }
  function close() {
    const win = P.win;
    if (!win) return;
    shut(win);
    win.close();
  }
  function changed() {
    ctx.emit('media', 'pip');
    ctx.player.refresh();
  }
  ctx.on('media', (key) => {
    if (key === 'display') ctx.player.refresh();
  });
  // 主窗口刷新或关闭：画中画窗口随之关闭（浏览器本来也会关掉它）。
  window.addEventListener('pagehide', close);

  // ---- 入口
  const look = (file) => {
    const on = what(file) === 'close';
    return { pressed: on, label: on ? 'pipClose' : 'pipOpen' };
  };
  ctx.fileBar?.addHead({ id: 'pip', icon: 'pip', label: 'pipOpen', order: 20, click: (tg) => act(tg), state: look });
  ctx.player.add({
    id: 'pip',
    icon: 'pip',
    label: 'pipOpen',
    order: 30,
    kinds: ['audio'],
    click: (p) => act(p),
    state: (p) => look(p),
  });
  // Z：等同文件栏的「画中画」（作用于当前文件）。
  ctx.keys.push({
    down(e) {
      if (e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return false;
      e.preventDefault();
      if (!e.repeat) act(ctx.media.target());
      return true;
    },
  });
}
