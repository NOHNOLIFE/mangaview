// 拖动滚动：按住鼠标左键拖动来滚动容器；没有拖动（移动不超过几像素）时当作点击。
// 带 data-nodrag 的区域（播放器的壳、可选的文件名等）不参与拖动和点击翻屏；click 收到按下时的目标（指针捕获后 pointerup 的目标是容器本身）。
export function drag(el, click) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.offsetX >= el.clientWidth && e.target === el) || e.target.closest?.('[data-nodrag]'))
      return;
    start = { y: e.clientY, x: e.clientX, top: el.scrollTop, moved: false, target: e.target };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 4 || Math.abs(e.clientX - start.x) > 4) start.moved = true;
    if (start.moved) el.scrollTop = start.top - dy;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !start) return;
    const { moved, target } = start;
    start = null;
    if (!moved) click(e, target);
  });
  el.onlostpointercapture = () => {
    start = null;
  };
}
