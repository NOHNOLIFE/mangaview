// 拖动滚动的惯性（纯计算，界面在 src/ui/dragscroll.mjs）：按松手前一小段时间的指针轨迹估算速度，速度按时间指数衰减，手感接近触屏系统的滚动。
// 速度单位一律是像素 / 毫秒；时间用事件和帧的时间戳（同一时间轴）。
export const SLOP = 4, // 位移超过这么多像素才算拖动，否则是点击
  SPAN = 100, // 只看松手前这么多毫秒内的移动
  REST = 60, // 松手前停住超过这么久：不带惯性
  TAU = 325, // 衰减时间常数：速度每 TAU 毫秒降到 1/e，惯性滑行的总距离约为 起步速度 × TAU
  START = 0.15, // 起步速度低于它不滑行
  END = 0.02, // 速度低于它停下
  MAX = 8; // 起步速度上限
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
  const clamp = (v) => Math.max(-MAX, Math.min(MAX, v));
  return { x: clamp((last.x - first.x) / dt), y: clamp((last.y - first.y) / dt) };
}
// 速度 v 经过 dt 毫秒：返回这段时间滑过的距离（指数衰减的精确积分，与帧率无关）和剩下的速度。
export function glide(v, dt) {
  const k = Math.exp(-Math.max(0, dt) / TAU);
  return { d: v * TAU * (1 - k), v: v * k };
}
