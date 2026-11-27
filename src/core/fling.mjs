// 拖动滚动的惯性（纯计算，界面在 src/ui/dragscroll.mjs）：按松手前一小段时间的指针轨迹估算速度，速度随时间衰减，手感接近触屏系统的滚动。
// 速度单位一律是像素 / 毫秒；时间用事件和帧的时间戳（同一时间轴）。
// 衰减分两段：速度在 KNEE 以下按指数衰减（每 TAU 毫秒降到 1/e，低速手感与触屏一致）；KNEE 以上按恒定减速度 KNEE / TAU 减速，
// 两段在 KNEE 处减速度相同、衔接平滑。高速时相对衰减更慢：起步速度 v 的总滑行距离为
//   v ≤ KNEE：v × TAU；  v > KNEE：TAU × (v² + KNEE²) / (2 × KNEE)（最快一甩 MAX 约 11800px）。
export const SLOP = 4, // 位移超过这么多像素才算拖动，否则是点击
  SPAN = 100, // 只看松手前这么多毫秒内的移动
  REST = 60, // 松手前停住超过这么久：不带惯性
  TAU = 325, // 低速段的衰减时间常数
  KNEE = 6, // 低速段与高速段的分界速度
  START = 0.15, // 起步速度低于它不滑行
  END = 0.02, // 速度低于它停下
  MAX = 20; // 起步速度上限
const clamp = (v) => Math.max(-MAX, Math.min(MAX, v));
// samples：按时间排列的 { t, x, y }（指针位置）；now：松手的时间。返回指针的速度 { x, y }。
export function velocity(samples, now) {
  const last = samples.at(-1);
  if (!last || now - last.t > REST) return { x: 0, y: 0 };
  let i = samples.findIndex((s) => last.t - s.t <= SPAN);
  // 窗口内只有一两个采样、时间太短时，往前多取一个，避免除以接近 0 的时间。
  if (last.t - samples[i].t < 8 && i > 0) i--;
  const first = samples[i],
    dt = last.t - first.t;
  if (dt <= 0) return { x: 0, y: 0 };
  return { x: clamp((last.x - first.x) / dt), y: clamp((last.y - first.y) / dt) };
}
// 速度 v 经过 dt 毫秒：返回这段时间滑过的距离和剩下的速度（按上面的两段规律精确积分，与帧率无关）。
export function glide(v, dt) {
  dt = Math.max(0, dt);
  const s = Math.sign(v),
    a = Math.abs(v);
  let d = 0,
    left = dt,
    u = a;
  if (u > KNEE) {
    const acc = KNEE / TAU,
      t1 = (u - KNEE) / acc; // 减到 KNEE 所需的时间
    if (left <= t1) return { d: s * (u * left - (acc * left * left) / 2), v: s * (u - acc * left) };
    d = (u * u - KNEE * KNEE) / (2 * acc);
    left -= t1;
    u = KNEE;
  }
  const k = Math.exp(-left / TAU);
  return { d: s * (d + u * TAU * (1 - k)), v: s * u * k };
}
// 滑行未停时再甩一次：同方向的新速度叠加上滑行剩下的速度（不超过 MAX），超长列表可以越甩越快；
// 反方向、没有滑行或新速度太低（不足 START，不滑行）时只按新速度。prev、v：同一个方向（轴）上的滚动速度。
export function stack(prev, v) {
  if (!prev || Math.abs(v) < START || Math.sign(prev) !== Math.sign(v)) return v;
  return clamp(prev + v);
}
