// 总控（transport）：总控栏背后的状态与对外接口 ctx.transport，不含界面（界面在 controlbar.mjs，纯逻辑在 core/control.mjs）。
// - 设置类偏好（ctx.prefs.sync：跨窗口即时同步，「还原默认设置」重置）：模式 mode（'comic' 漫画 | 'mixed' 混合 | 'media' 影音，默认混合）、
//   滚动速率 scrollRate、播放速率 playRate、单文件模式 single、循环 loop（键 'loopMode'：'file' 单文件 | 'book' 本书〔默认〕| 'books' 跨书，
//   core/control.mjs loopOf；没有"不循环"）、只播放书签区段 sectionsOnly。各有 setXxx(值)。
//   旧偏好「跨书」crossBook（开着读作跨书循环）、「循环」playLoop、「播放顺序」playOrder 读入后删除，不再使用。
// - running：是否在自动滚动（总控栏的大按钮「自动滚动」处于运行状态），每个窗口独立、不记忆。
// - 运行由各模式的驱动器完成：drive(模式, {start(), stop()}) 登记（漫画、混合在 reader/engine.mjs，影音在 media/driver.mjs）；
//   start() / stop() / toggle() 调当前模式的驱动器，尚未登记驱动器的模式退回使用 'media' 驱动器。start() 返回 false 表示没有可运行的内容（running 保持 false）。
//   开启「只播放书签区段」而本书一个区段都没有时，提示并不启动；漫画模式下本书没有图片时同样提示并不启动（漫画模式只滚图片）。
//   驱动器经 report(名称, on) 报告实际状态（如媒体被暂停、播完不再继续时为 false）；只有当前模式生效的驱动器的报告会改变 running。
//   运行中切换模式且生效的驱动器随之改变时，先停下原来的，再用新的继续。
// - 任何状态变化派发 ctx.emit('transport', 字段名, 是否本窗口的操作)。
import { modeOf, rateOf, loopOf } from '../core/control.mjs';
import { hasSections } from '../core/engine.mjs';
import { pageKind } from '../core/model.mjs';
import { extend } from '../core/lang.mjs';

extend({
  trNoImages: [
    'This book has no images to scroll in Comic mode',
    '本书没有图片，漫画模式无可滚动',
    'この本には漫画モードでスクロールする画像がありません',
    '이 책에는 만화 모드에서 스크롤할 이미지가 없습니다',
  ],
});
// 书里有没有图片（漫画模式只滚图片）。
export const hasImages = (book) => !!book?.pages.some((pg) => pageKind(pg) === 'image');

// 字段 → 偏好键名与读入时的归一化。
const FIELDS = {
  mode: ['playMode', modeOf],
  scrollRate: ['scrollRate', (v) => rateOf(v, 'scroll')],
  playRate: ['playRate', (v) => rateOf(v, 'play')],
  single: ['singleFile', (v) => v === true],
  loop: ['loopMode', (v) => loopOf(v)],
  sectionsOnly: ['sectionsOnly', (v) => v === true],
};

export function install(ctx) {
  const { get, put } = ctx;
  const state = { running: false };
  for (const [field, [key, norm]] of Object.entries(FIELDS)) state[field] = norm(get(key, null));
  // 旧偏好：开着「跨书」的读作跨书循环（写入新键），旧键删除。
  if (get('loopMode', null) == null && get('crossBook', null) === true)
    put('loopMode', (state.loop = loopOf(null, true)));
  for (const old of ['crossBook', 'playLoop', 'playOrder']) if (get(old, null) != null) ctx.dropKey(old);
  const drivers = new Map();
  let active = null; // 正在运行的驱动器名
  const effective = () => (drivers.has(state.mode) ? state.mode : 'media');
  function running(on) {
    if (!on) active = null;
    if (state.running === on) return;
    state.running = on;
    ctx.emit('transport', 'running', true);
  }
  function set(field, value, local = true) {
    const [key, norm] = FIELDS[field],
      v = norm(value);
    if (state[field] === v) return;
    state[field] = v;
    if (local) put(key, v);
    ctx.emit('transport', field, local);
    if (field === 'mode' && state.running && active && active !== effective()) {
      drivers.get(active)?.stop();
      running(false);
      start();
    }
  }
  for (const [field, [key]] of Object.entries(FIELDS)) ctx.prefs.sync(key, (v) => set(field, v, false));
  function start() {
    const name = effective(),
      d = drivers.get(name),
      book = ctx.current;
    if (!d) return false;
    if (state.sectionsOnly && book && ctx.marks && !hasSections(ctx.marks.list(book))) {
      ctx.notice(null, ctx.t('mvNoSections'));
      return false;
    }
    if (state.mode === 'comic' && book && !hasImages(book)) {
      ctx.notice(null, ctx.t('trNoImages'));
      return false;
    }
    active = name;
    const ok = d.start() !== false;
    if (ok) active = name;
    running(ok);
    return ok;
  }
  function stop() {
    const d = drivers.get(active ?? effective());
    running(false);
    d?.stop();
  }
  ctx.transport = {
    get mode() {
      return state.mode;
    },
    get scrollRate() {
      return state.scrollRate;
    },
    get playRate() {
      return state.playRate;
    },
    get single() {
      return state.single;
    },
    // 循环：'file' | 'book' | 'books'（跨书循环：单击 F / Enter 的跨书跳转也跟随它）。
    get loop() {
      return state.loop;
    },
    get sectionsOnly() {
      return state.sectionsOnly;
    },
    get running() {
      return state.running;
    },
    // 当前模式实际使用的驱动器名（尚未登记的模式为 'media'）。
    get driver() {
      return effective();
    },
    setMode: (m) => set('mode', m),
    setScrollRate: (x) => set('scrollRate', x),
    setPlayRate: (x) => set('playRate', x),
    setSingle: (b) => set('single', !!b),
    setLoop: (v) => set('loop', v),
    setSectionsOnly: (b) => set('sectionsOnly', !!b),
    start,
    stop,
    toggle() {
      if (state.running) stop();
      else start();
    },
    drive(mode, driver) {
      drivers.set(mode, driver);
    },
    report(name, on) {
      if (name !== effective()) return;
      if (on) active = name;
      running(!!on);
    },
  };
  // 切书：运行状态由驱动器随之报告（媒体卸载即暂停）；这里不另做处理。
}
