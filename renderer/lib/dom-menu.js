// renderer/lib/dom-menu.js —— 轻量自绘右键菜单（模块局部选单共用）
// items: [{label, fn, disabled?} | '-' 分隔线]
export function showDomMenu(items, x, y) {
  document.querySelector('.mazz-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'mazz-menu';
  for (const it of items) {
    if (it === '-') {
      const sep = document.createElement('div');
      sep.className = 'mazz-menu-sep';
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'mazz-menu-item' + (it.disabled ? ' disabled' : '');
    row.textContent = it.label;
    if (!it.disabled) row.addEventListener('click', () => { menu.remove(); it.fn?.(); });
    menu.appendChild(row);
  }
  if (!menu.children.length) return;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
  menu.style.left = Math.min(x, vw - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, vh - rect.height - 8) + 'px';
  setTimeout(() => {
    window.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) menu.remove(); }, { once: true });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.remove(); }, { once: true });
  }, 0);
  return menu;
}
