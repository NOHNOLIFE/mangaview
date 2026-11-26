// 图标：把 24×24 线条图标直接补进页面的 sprite（已有同名的不重复添加），避免多个模块同时改 index.html。
export function addIcons(table) {
  const sprite = document.querySelector('svg.sprite');
  for (const [name, body] of Object.entries(table))
    if (!document.getElementById('i-' + name))
      sprite?.insertAdjacentHTML('beforeend', '<symbol id="i-' + name + '" viewBox="0 0 24 24">' + body + '</symbol>');
}
