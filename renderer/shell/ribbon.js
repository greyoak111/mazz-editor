// renderer/shell/ribbon.js —— 上下文 Ribbon：页签随模块切换；按钮一律走命令注册表
import { commands } from '../core/command-registry.js';
import { contextKeys } from '../core/contextkey-service.js';
import { keymap, displayKey } from '../core/keymap-service.js';
import { t } from '../i18n/index.js';

export class Ribbon {
  constructor(root) {
    this.root = root;
    this.pages = new Map(); // id -> {label, build(panel), order}
    this.el = document.createElement('div');
    this.el.className = 'ribbon';
    this.el.innerHTML = `<div class="ribbon-tabs"></div><div class="ribbon-panel"></div>`;
    root.appendChild(this.el);
    this.tabsEl = this.el.querySelector('.ribbon-tabs');
    this.panelEl = this.el.querySelector('.ribbon-panel');
    this.activePage = null;
    this.ribbonState = { collapsed: false, height: null };
    // 双击页签折叠
    this.tabsEl.addEventListener('dblclick', () => this.setCollapsed(!this.ribbonState.collapsed));
    // 下缘拖拽调高
    const grip = document.createElement('div');
    grip.className = 'ribbon-grip';
    grip.title = '拖拽调整工具栏高度';
    this.el.appendChild(grip);
    grip.addEventListener('mousedown', (e) => this.startDrag(e));
    contextKeys.onChange(() => this.refreshStates());
    commands.events.on('changed', () => this.refreshStates());
    this.restoreState();
  }

  async restoreState() {
    const saved = await window.mazz?.invoke('settings:get', { key: 'ui.ribbon' }).catch(() => null);
    if (saved && typeof saved === 'object') Object.assign(this.ribbonState, saved);
    this.applyState();
  }
  persistState() {
    window.mazz?.invoke('settings:set', { key: 'ui.ribbon', value: this.ribbonState }).catch(() => {});
  }
  setCollapsed(v) {
    this.ribbonState.collapsed = v;
    this.applyState();
    this.persistState();
  }
  applyState() {
    this.el.classList.toggle('collapsed', this.ribbonState.collapsed);
    this.el.classList.toggle('panel-collapsed', this.ribbonState.collapsed);
    if (this.ribbonState.height && !this.ribbonState.collapsed) {
      this.panelEl.style.height = this.ribbonState.height + 'px';
      this.panelEl.style.overflowY = 'auto';
    } else {
      this.panelEl.style.height = '';
      this.panelEl.style.overflowY = '';
    }
    const foldBtn = this.tabsEl.querySelector('.ribbon-fold-btn');
    if (foldBtn) foldBtn.textContent = this.ribbonState.collapsed ? '▾' : '▴';
  }
  startDrag(e) {
    e.preventDefault();
    if (this.ribbonState.collapsed) this.setCollapsed(false);
    const startY = e.clientY;
    const startH = this.panelEl.getBoundingClientRect().height;
    const move = (ev) => {
      const h = Math.min(Math.max(startH + ev.clientY - startY, 64, 0), 320);
      this.ribbonState.height = Math.round(h);
      this.panelEl.style.height = this.ribbonState.height + 'px';
      this.panelEl.style.overflowY = 'auto';
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.persistState();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  addPage(id, label, build, order = 0) {
    this.pages.set(id, { id, label, build, order });
    this.renderTabs();
  }
  removePage(id) { this.pages.delete(id); this.renderTabs(); }

  renderTabs() {
    const pages = this.sortedPages();
    this.tabsEl.innerHTML = '';
    for (const p of pages) {
      const b = document.createElement('button');
      b.className = 'ribbon-tab' + (this.activePage === p.id ? ' on' : '');
      b.textContent = t(p.label);
      b.addEventListener('click', () => this.showPage(p.id));
      this.tabsEl.appendChild(b);
    }
    // 常驻：折叠钮 + 帮助入口（右对齐，所有页面可见）
    const fold = document.createElement('button');
    fold.className = 'ribbon-tab ribbon-fold-btn';
    fold.textContent = this.ribbonState.collapsed ? '▾' : '▴';
    fold.title = '折叠/展开工具栏（双击页签栏同效）';
    fold.style.marginLeft = 'auto';
    fold.addEventListener('click', () => this.setCollapsed(!this.ribbonState.collapsed));
    this.tabsEl.appendChild(fold);
    const help = document.createElement('button');
    help.className = 'ribbon-tab ribbon-help-btn';
    help.textContent = '❓ 帮助';
    help.title = '使用指南（F1）';
    help.addEventListener('click', () => commands.execute('help.open'));
    this.tabsEl.appendChild(help);
    if (!this.activePage || !this.pages.has(this.activePage)) {
      this.activePage = pages[0]?.id || null;
    }
    this.renderPanel();
  }
  sortedPages() { return [...this.pages.values()].sort((a, b) => a.order - b.order); }

  showPage(id) {
    this.activePage = id;
    this.el.classList.remove('collapsed');
    const pages = this.sortedPages();
    this.tabsEl.querySelectorAll('.ribbon-tab').forEach((t, i) =>
      t.classList.toggle('on', pages[i]?.id === id));
    this.renderPanel();
  }

  renderPanel() {
    this.panelEl.innerHTML = '';
    const page = this.pages.get(this.activePage);
    if (page) page.build(this.panelEl);
    this.refreshStates();
  }

  /** 工具方法：按钮组（data-command 一律走注册表） */
  group(label, buttons) {
    const g = document.createElement('div');
    g.className = 'rb-group';
    g.dataset.label = label;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'rb-btn';
      btn.dataset.command = b.command;
      btn.innerHTML = `<i class="ico">${b.icon || ''}</i><span>${b.label || ''}</span>`;
      const key = displayKey(keymap.keyForCommand(b.command));
      btn.title = (b.title || b.label || '') + (key ? `（${key}）` : '');
      btn.addEventListener('click', () => commands.execute(b.command));
      g.appendChild(btn);
    }
    this.panelEl.appendChild(g);
    return g;
  }

  /** 上下文变化时刷新按钮可用态 */
  refreshStates() {
    this.panelEl.querySelectorAll('[data-command]').forEach(btn => {
      const cmd = commands.get(btn.dataset.command);
      btn.disabled = !cmd || (cmd.when && !contextKeys.evaluate(cmd.when));
    });
  }
}
