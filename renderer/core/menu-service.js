// renderer/core/menu-service.js —— 右键选单体系：12 种上下文，when 表达式精确控制
// Electron 下默认原生菜单（编辑器文本上下文由主进程拼写菜单接管）；浏览器/特殊场景用自绘 DOM 菜单
import { commands } from './command-registry.js';
import { t } from '../i18n/index.js';
import { contextKeys } from './contextkey-service.js';
import { keymap, displayKey } from './keymap-service.js';

class MenuService {
  constructor() {
    this.contributions = new Map(); // menuId -> [{command, when, group, order, title}]
    this.activeDom = null;
  }

  contribute(menuId, items) {
    if (!this.contributions.has(menuId)) this.contributions.set(menuId, []);
    this.contributions.get(menuId).push(...items);
  }
  removeBySource(source) {
    for (const [id, items] of this.contributions) {
      this.contributions.set(id, items.filter(it => it.source !== source));
    }
  }

  /** 解析菜单：when 过滤 + 组排序 + 组间分隔线 */
  resolve(menuId) {
    const items = (this.contributions.get(menuId) || [])
      .filter(it => contextKeys.evaluate(it.when))
      .map(it => {
        const cmd = commands.get(it.command);
        return {
          id: it.command,
          label: t(it.title || cmd?.title || it.command),
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

  /** 弹出上下文菜单：优先原生（Electron），回退自绘 DOM */
  async show(menuId, { x, y, preferDom = false } = {}) {
    const items = this.resolve(menuId);
    if (!items.length) return;
    if (window.mazz?.isElectron && !preferDom) {
      try {
        const id = await window.mazz.invoke('menu:context', { items, context: menuId });
        if (id) await commands.execute(id);
        return;
      } catch (e) { console.warn('[menu] 原生菜单失败，回退 DOM:', e.message); }
    }
    this.showDom(items, { x, y });
  }

  showDom(items, { x, y }) {
    this.closeDom();
    const menu = document.createElement('div');
    menu.className = 'mazz-menu';
    for (const it of items) {
      if (it.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'mazz-menu-sep';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'mazz-menu-item' + (it.enabled ? '' : ' disabled');
      row.innerHTML = `<span class="mazz-menu-icon">${it.icon || ''}</span><span class="mazz-menu-label"></span><span class="mazz-menu-key">${it.accelerator || ''}</span>`;
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
    setTimeout(() => {
      window.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) this.closeDom(); }, { once: true });
      window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeDom(); }, { once: true });
    }, 0);
  }
  closeDom() { this.activeDom?.remove(); this.activeDom = null; }
}

export const menus = new MenuService();
