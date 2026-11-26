// 总控栏（docs/requirements-2.4.zh-CN.md 第 7、8 节）的纯逻辑，不碰界面和存储（reader/transport.mjs、reader/controlbar.mjs 调用，tests/core/control.test.mjs 覆盖）：
// 模式的归一化、滚动 / 播放速率的范围与档位、速率的显示文字、各模式下哪些控件禁用。
export const MODES = ['comic', 'mixed', 'media'];
export const modeOf = (v) => (MODES.includes(v) ? v : 'mixed');
// 速率：滚动速率 0.25×–4×（1.0× = 每秒滚过视窗高度的 10%），播放速率 0.5×–3×（作用于所有媒体，变速不变调）。
// steps 是滚轮、方向键逐档调整的档位，presets 是小面板里的常用档位；滑杆按 0.05 一档。
export const RATES = {
  scroll: { min: 0.25, max: 4, steps: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4], presets: [0.5, 1, 1.5, 2, 3] },
  play: { min: 0.5, max: 3, steps: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3], presets: [0.75, 1, 1.25, 1.5, 2] },
};
// 读入的速率：不是正数时为 1，夹在范围内，按 0.05 取整（避免浮点误差累积）。
export function rateOf(v, kind) {
  const r = RATES[kind],
    n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(r.max, Math.max(r.min, Math.round(n * 20) / 20));
}
// 逐档调整：d 为 1 时取比 v 大的下一档，-1 取比 v 小的上一档；已在两端时不变。
export function stepRate(v, d, kind) {
  const s = RATES[kind].steps,
    x = rateOf(v, kind);
  const next = d > 0 ? s.find((a) => a > x + 1e-9) : [...s].reverse().find((a) => a < x - 1e-9);
  return next ?? x;
}
// 显示文字：整十分位显示一位小数（1.0×、0.5×），否则两位（1.25×）。宽度按最长的 '0.25×' 预留（controlbar.css）。
export function rateText(x) {
  const n = Math.round(x * 100) / 100;
  return (Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? n.toFixed(1) : n.toFixed(2)) + '×';
}
// 与当前模式无关的控件变暗并禁用（不隐藏、不移动）：漫画模式下右区除循环外全部；影音模式下滚动速率；混合模式下播放顺序；
// 书里没有媒体时右区除循环外全部，影音模式下大播放键也禁用。循环对三种模式都有意义（漫画、混合模式下是整本循环），始终可用。
// 返回禁用的控件 id 集合（id 与 controlbar.mjs 的 data-id 一致）。RIGHT 是右区的全部控件，MEDIA_ONLY 是其中只对媒体有意义的。
export const RIGHT = ['mediaPrev', 'mediaNext', 'order', 'loop', 'playRate', 'volume', 'popout'];
export const MEDIA_ONLY = RIGHT.filter((id) => id !== 'loop');
export function disabledControls({ mode, hasMedia }) {
  const off = new Set();
  if (mode === 'comic' || !hasMedia) for (const id of MEDIA_ONLY) off.add(id);
  if (mode === 'media') off.add('scrollRate');
  if (mode === 'mixed') off.add('order');
  if (mode === 'media' && !hasMedia) off.add('play');
  return off;
}
