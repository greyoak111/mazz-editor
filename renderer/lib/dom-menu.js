// renderer/lib/dom-menu.js —— 轻量自绘右键菜单（模块局部选单共用）
// items: [{label, fn, disabled?} | '-' 分隔线]
export function showDomMenu(items, x, y) {
  const existing = document.querySelector('.mazz-menu');
  const HTMLElementCtor = document.defaultView?.HTMLElement;
  const previousFocus = existing?.__mazzPreviousFocus
    || (HTMLElementCtor && document.activeElement instanceof HTMLElementCtor ? document.activeElement : null);
  if (typeof existing?.__mazzClose === 'function') existing.__mazzClose({ restoreFocus: false });
  else existing?.remove();
  const menu = document.createElement('div');
  menu.className = 'mazz-menu';
  menu.setAttribute('role', 'menu');
  menu.__mazzPreviousFocus = previousFocus?.isConnected ? previousFocus : null;
  let outsideHandler = null;
  let closed = false;
  const close = ({ restoreFocus = true } = {}) => {
    if (closed) return;
    closed = true;
    if (outsideHandler) window.removeEventListener('mousedown', outsideHandler);
    outsideHandler = null;
    menu.remove();
    if (restoreFocus && menu.__mazzPreviousFocus?.isConnected) menu.__mazzPreviousFocus.focus({ preventScroll: true });
  };
  menu.__mazzClose = close;
  for (const it of items) {
    if (it === '-') {
      const sep = document.createElement('div');
      sep.className = 'mazz-menu-sep';
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'mazz-menu-item' + (it.disabled ? ' disabled' : '');
    row.setAttribute('role', 'menuitem');
    row.tabIndex = it.disabled ? -1 : 0;
    row.setAttribute('aria-disabled', it.disabled ? 'true' : 'false');
    row.textContent = it.label;
    if (!it.disabled) row.addEventListener('click', () => { close(); it.fn?.(); });
    menu.appendChild(row);
  }
  if (!menu.children.length) return;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
  menu.style.left = Math.min(x, vw - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, vh - rect.height - 8) + 'px';
  const enabledRows = [...menu.querySelectorAll('[role="menuitem"]:not(.disabled)')];
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!enabledRows.length) return;
      const at = Math.max(0, enabledRows.indexOf(document.activeElement));
      enabledRows[(at + (event.key === 'ArrowDown' ? 1 : -1) + enabledRows.length) % enabledRows.length].focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches?.('[role="menuitem"]:not(.disabled)')) {
      event.preventDefault();
      document.activeElement.click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  enabledRows[0]?.focus({ preventScroll: true });
  setTimeout(() => {
    if (!menu.isConnected || closed) return;
    outsideHandler = event => { if (!menu.contains(event.target)) close({ restoreFocus: false }); };
    window.addEventListener('mousedown', outsideHandler);
  }, 0);
  return menu;
}
