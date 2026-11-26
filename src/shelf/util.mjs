// 书架各模块共用的小工具：按 id 取元素、封面摘要、弹出层定位。
export const $ = (id) => document.getElementById(id);
// 封面摘要：首张图前 64KB 的 SHA-256 加文件大小，只读一小段，不读整张大图。
export async function digest(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.slice(0, 65536).arrayBuffer());
  return [...new Uint8Array(buf).slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('') + ':' + file.size;
}
// 弹出层放在按钮下方（不超出窗口）。
export function anchor(popEl, btn, right = false) {
  popEl.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    const r = btn.getBoundingClientRect(),
      w = popEl.offsetWidth;
    popEl.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - popEl.offsetHeight - 8)) + 'px';
    popEl.style.left =
      Math.max(8, Math.min(right ? r.right - w : r.left, document.documentElement.clientWidth - w - 8)) + 'px';
  });
}
