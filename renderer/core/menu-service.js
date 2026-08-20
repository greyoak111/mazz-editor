// renderer/core/menu-service.js —— 右键选单体系：12 种上下文，when 表达式精确控制
// Electron 下默认原生菜单（编辑器文本上下文由主进程拼写菜单接管）；浏览器/特殊场景用自绘 DOM 菜单
import { commands } from './command-registry.js';
import { iconHtml } from '../lib/svg-icons.js';
import { t } from '../i18n/index.js';
import { contextKeys } from './contextkey-service.js';
import { keymap, displayKey } from './keymap-service.js';
import { MATURITY, maturityLabel } from './product-maturity.js';

class MenuService {
  constructor() {
    this.contributions = new Map(); // menuId -> [{command, when, group, order, title}]
    this.activeDom = null;
    this._domPreviousFocus = null;
    this._domOutsideHandler = null;
  }

  contribute(menuId, items) {
    if (!this.contributions.has(menuId)) this.contributions.set(menuId, []);
    this.contributions.get(menuId).push(...items);
  }
  removeBySource(source) {
    for (const [id, items] of this.contributions) {
      const remaining = items.filter(it => it.source !== source);
      if (remaining.length) this.contributions.set(id, remaining);
      else this.contributions.delete(id);
    }
  }

  /** 解析菜单：when 过滤 + 组排序 + 组间分隔线 */
  resolve(menuId) {
    const items = (this.contributions.get(menuId) || [])
      .filter(it => contextKeys.evaluate(it.when))
      .map(it => {
        const cmd = commands.get(it.command);
        const rawLabel = it.title || cmd?.title || it.command;
        return {
          id: it.command,
          label: t(cmd?.maturity === MATURITY.PREVIEW ? maturityLabel(rawLabel, cmd.maturity) : rawLabel),
          icon: it.icon || cmd?.icon,
          enabled: !!cmd,
          accelerator: displayKey(keymap.keyForCommand(it.command)),
          group: it.group || '0_default',
          order: it.order ?? 0,
          type: it.type,
          submenu: it.submenu,
        };
      })
      .sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'));
    const out = [];
    let lastGroup = null;
    for (const it of items) {
      if (lastGroup !== null && it.group !== lastGroup) out.push({ type: 'separator' });
      out.push(it);
      lastGroup = it.group;
    }
    return out;
  }

  /** 推送菜单模型到主进程（编辑器原生拼写菜单消费） */
  pushModel(menuId) {
    if (!window.mazz?.isElectron) return;
    window.mazz.invoke('menu:setModel', { items: this.resolve(menuId) }).catch(() => {});
  }

  /** 弹出上下文菜单：Electron 一律 ctxmenu 并行子窗格（应用风+主题跟随+永不被浏览器视图压——W55 全软件右键收编）；网页预览回退自绘 DOM */
  async show(menuId, { x, y, preferDom = false } = {}) {
    const items = this.resolve(menuId);
    if (!items.length) return;
    if (window.mazz?.isElectron) {
      try {
        // 尺寸估算：项高 28/分隔 9/padding 12；宽随最长项（基础 240）
        const h = Math.min(items.reduce((a, it) => a + (it.type === 'separator' ? 9 : 28), 12), Math.round(window.innerHeight * 0.82));
        const w = Math.max(220, Math.min(300, 14 + Math.max(...items.map(it => String(it.label || '').length)) * 13 + (items.some(it => it.accelerator) ? 64 : 0)));
        this._ctxItems = items; // ctxmenuQuery 应答取（面板 ready 后问取）
        await window.mazz.invoke('panel:open', { kind: 'ctxmenu', opts: { x: x ?? 100, y: y ?? 100, w, h } });
        return;
      } catch (e) { console.warn('[menu] 子窗格菜单失败，回退 DOM:', e.message); }
    }
    this.showDom(items, { x, y });
  }

  showDom(items, { x, y }) {
    const HTMLElementCtor = document.defaultView?.HTMLElement;
    const previousFocus = this.activeDom
      ? this._domPreviousFocus
      : (HTMLElementCtor && document.activeElement instanceof HTMLElementCtor ? document.activeElement : null);
    this.closeDom({ restoreFocus: false });
    this._domPreviousFocus = previousFocus?.isConnected ? previousFocus : null;
    const menu = document.createElement('div');
    menu.className = 'mazz-menu';
    menu.setAttribute('role', 'menu');
    for (const it of items) {
      if (it.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'mazz-menu-sep';
        menu.appendChild(sep);
        continue;
      }
      if (it.type === 'heading') {
        const heading = document.createElement('div');
        heading.className = 'mazz-menu-heading';
        heading.textContent = it.label;
        menu.appendChild(heading);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'mazz-menu-item' + (it.enabled ? '' : ' disabled');
      row.setAttribute('role', 'menuitem');
      row.tabIndex = it.enabled ? 0 : -1;
      row.setAttribute('aria-disabled', it.enabled ? 'false' : 'true');
      row.innerHTML = `<span class="mazz-menu-icon">${iconHtml(it.icon || '')}</span><span class="mazz-menu-label"></span><span class="mazz-menu-key">${it.accelerator || ''}</span>`;
      row.querySelector('.mazz-menu-label').textContent = it.label;
      if (it.enabled) {
        row.addEventListener('click', () => { this.closeDom(); commands.execute(it.id); });
      }
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
    this.activeDom = menu;
    const enabledRows = [...menu.querySelectorAll('[role="menuitem"]:not(.disabled)')];
    const moveFocus = (delta) => {
      if (!enabledRows.length) return;
      const at = Math.max(0, enabledRows.indexOf(document.activeElement));
      enabledRows[(at + delta + enabledRows.length) % enabledRows.length].focus();
    };
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveFocus(event.key === 'ArrowDown' ? 1 : -1);
      } else if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches?.('[role="menuitem"]:not(.disabled)')) {
        event.preventDefault();
        document.activeElement.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeDom();
      }
    });
    enabledRows[0]?.focus({ preventScroll: true });
    setTimeout(() => {
      if (this.activeDom !== menu) return;
      this._domOutsideHandler = (event) => {
        if (!menu.contains(event.target)) this.closeDom({ restoreFocus: false });
      };
      window.addEventListener('mousedown', this._domOutsideHandler);
    }, 0);
  }
  closeDom({ restoreFocus = true } = {}) {
    if (this._domOutsideHandler) window.removeEventListener('mousedown', this._domOutsideHandler);
    this._domOutsideHandler = null;
    this.activeDom?.remove();
    this.activeDom = null;
    const previousFocus = this._domPreviousFocus;
    this._domPreviousFocus = null;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
}

export const menus = new MenuService();
