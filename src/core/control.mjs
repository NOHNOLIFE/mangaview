// 总控栏的纯逻辑，不碰界面和存储（reader/transport.mjs、reader/controlbar.mjs 调用，tests/core/control.test.mjs 覆盖）：
// 模式的归一化与轮换、滚动 / 播放速率的范围与档位、速率的显示文字、三区的按钮排布、各模式下哪些控件禁用。
export const MODES = ['comic', 'mixed', 'media'];
export const modeOf = (v) => (MODES.includes(v) ? v : 'mixed');
// 速率：滚动速率 0.2–4.0（1.0 = 每秒滚过视窗高度的 10%），播放速率 0.5–3.0（作用于所有媒体，变速不变调）。
// 一律按 0.1 一档（滑杆、小面板的常用档位、滚轮、方向键），显示一位小数即真实值；presets 是小面板里的常用档位。
export const RATES = {
  scroll: { min: 0.2, max: 4, presets: [0.5, 1, 1.5, 2, 3] },
  play: { min: 0.5, max: 3, presets: [0.8, 1, 1.2, 1.5, 2] },
};
export const RATE_STEP = 0.1;
// 读入的速率：不是正数时为 1，按 0.1 取整并夹在范围内（旧版本存下的 0.25、1.75 等读入时随之取整）。
export function rateOf(v, kind) {
  const r = RATES[kind],
    n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(r.max, Math.max(r.min, Math.round(n * 10) / 10));
}
// 逐档调整：d 为 1 时加 0.1，-1 时减 0.1，夹在范围内（已在两端时不变）。
export const stepRate = (v, d, kind) => rateOf(rateOf(v, kind) + (d > 0 ? RATE_STEP : -RATE_STEP), kind);
// 显示文字：一位小数，不带单位（按钮与其他图标按钮同宽，controlbar.css）；提示与小面板里另加「×」（rateLabel）。
export const rateText = (x) => (Math.round(x * 10) / 10).toFixed(1);
export const rateLabel = (x) => rateText(x) + '×';
// 三区的按钮排布（id 与 controlbar.mjs 的 data-id 一致，'|' 是分隔线），左右对称：
// 左（阅读）上一本、书首、书尾、下一本 │ 跨书、滚动速率；中（运行）播放模式、只播区段、大播放键、单文件、循环；
// 右（媒体）上一个媒体、下一个媒体、播放顺序 │ 播放速率、音量、新窗口播放、字幕。
// 放不下一行时，左、右区只留 KEEP 里的按钮，其余收进本区末尾的「⋯」（more）弹出层，仍是一行；再放不下时分两行（中区一行，左、右区并排一行）。
export const ZONES = {
  left: ['prevBook', 'toStart', 'toEnd', 'nextBook', '|', 'crossBook', 'scrollRate'],
  mid: ['mode', 'sections', 'play', 'single', 'loop'],
  right: ['mediaPrev', 'mediaNext', 'order', '|', 'playRate', 'volume', 'popout', 'subs'],
};
export const KEEP = { left: ['prevBook', 'nextBook'], right: ['mediaNext', 'volume'] };
// 一个区在收起次要按钮（compact）与否时的排布：row 为栏上的顺序（含分隔线与 'more'），more 为「⋯」弹出层里的顺序。中区不收。
export function arrange(zone, compact) {
  const all = ZONES[zone],
    keep = KEEP[zone];
  if (!compact || !keep) return { row: [...all], more: [] };
  return { row: [...keep, 'more'], more: all.filter((id) => id !== '|' && !keep.includes(id)) };
}
// 播放模式按钮：点击按 MODES 的顺序轮换，方向键逐个切换（d 为 ±1，两端相接）。
export const nextMode = (mode, d = 1) =>
  MODES[(MODES.indexOf(modeOf(mode)) + (d < 0 ? MODES.length - 1 : 1)) % MODES.length];
// 与当前模式无关的控件变暗并禁用（不隐藏、不移动）：漫画模式下右区除字幕外全部；影音模式下滚动速率；混合模式下播放顺序；
// 书里没有媒体时同样是右区除字幕外全部，影音模式下大播放键也禁用。中区的播放模式、只播区段、单文件、循环对三种模式都有意义，始终可用
// （循环在漫画、混合模式下是整本循环）。返回禁用的控件 id 集合。RIGHT 是右区的全部控件；其中只对媒体列表有意义的是 MEDIA_ONLY，
// 字幕作用于文件栏显示的那个文件，由它自己的状态决定（没有字幕或不是媒体时变灰，controlbar.mjs）。
export const RIGHT = ZONES.right.filter((id) => id !== '|');
export const MEDIA_ONLY = RIGHT.filter((id) => id !== 'subs');
export function disabledControls({ mode, hasMedia }) {
  const off = new Set();
  if (mode === 'comic' || !hasMedia) for (const id of MEDIA_ONLY) off.add(id);
  if (mode === 'media') off.add('scrollRate');
  if (mode === 'mixed') off.add('order');
  if (mode === 'media' && !hasMedia) off.add('play');
  return off;
}
