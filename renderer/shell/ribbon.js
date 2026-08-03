// renderer/shell/ribbon.js —— 上下文 Ribbon：页签随模块切换；按钮一律走命令注册表
import { commands } from '../core/command-registry.js';
import { iconHtml } from '../lib/svg-icons.js';
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
    // 高度监测：够高（>96px）自动换行显示，不用一直横向拉找功能
    if (typeof ResizeObserver !== 'undefined') {
      this._wrapRO = new ResizeObserver(() => this.updateWrap());
      this._wrapRO.observe(this.panelEl);
    }
    // 双击页签折叠
    this.tabsEl.addEventListener('dblclick', () => this.setCollapsed(!this.ribbonState.collapsed));
    // 下缘拖拽调高
    const grip = document.createElement('div');
    grip.className = 'ribbon-grip';
    grip.title = '拖拽调整工具栏高度';
    this.el.appendChild(grip);
    grip.addEventListener('pointerdown', (e) => this.startDrag(e));
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
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.persistState();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
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
    // 常驻：协议入口（帮助左侧，所有页面可见）
    const agree = document.createElement('button');
    agree.className = 'ribbon-tab';
    agree.innerHTML = '<span class="ribbon-tab-ico">§</span> 协议';
    agree.title = '用户服务协议及隐私政策';
    agree.addEventListener('click', async () => {
      const { showAgreement } = await import('../lib/agreement.js');
      // W52③ 协议走全应用子窗（Electron；网页预览留 modal 兜底）
      if (window.mazz?.isElectron) {
        window.mazz.invoke('panel:open', { kind: 'agreement' }).catch(() => showAgreement()); // W53：全原生独立子窗格（应用壳 lean 路线退役）
        return;
      }
      showAgreement();
    });
    this.tabsEl.appendChild(agree);
    const help = document.createElement('button');
    help.className = 'ribbon-tab ribbon-help-btn';
    help.innerHTML = `<span class="ribbon-tab-ico">${iconHtml('❓')}</span> 帮助`;
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
  /** 按面板高度切换换行模式；换行态下「更多▾」折叠组自动全展开（空间已够，无需二级菜单） */
  updateWrap() {
    const wrap = this.panelEl.clientHeight > 96;
    if (wrap !== this._wrapMode) {
      this._wrapMode = wrap;
      this.panelEl.classList.toggle('wrap', wrap);
      this.renderPanel(); // 重建面板：wrap 态 group() 不折叠
    } else {
      this.panelEl.classList.toggle('wrap', wrap);
    }
  }

  makeBtn(b) {
    const btn = document.createElement('button');
    btn.className = 'rb-btn';
    btn.dataset.command = b.command;
    btn.innerHTML = `<i class="ico">${iconHtml(b.icon || '')}</i><span>${b.label || ''}</span>`;
    const key = displayKey(keymap.keyForCommand(b.command));
    btn.title = (b.title || b.label || '') + (key ? `（${key}）` : '');
    btn.addEventListener('click', () => commands.execute(b.command));
    return btn;
  }

  /** 同组按钮超过 collapseAfter 个时，多余折叠进「更多▾」二级菜单（wrap 换行态全展开） */
  group(label, buttons, { collapseAfter = 7 } = {}) {
    const g = document.createElement('div');
    g.className = 'rb-group';
    g.dataset.label = label;
    const limit = this._wrapMode ? buttons.length : collapseAfter;
    const visible = buttons.slice(0, limit);
    const extra = buttons.slice(limit);
    for (const b of visible) g.appendChild(this.makeBtn(b));
    if (extra.length) {
      const more = document.createElement('button');
      more.className = 'rb-btn rb-more';
      more.innerHTML = `<i class="ico">▾</i><span>更多</span>`;
      more.title = `${label}·更多（${extra.length} 项）`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showMore(label, extra, more);
      });
      g.appendChild(more);
    }
    this.panelEl.appendChild(g);
    return g;
  }

  /** 二级菜单弹出（W56 救火 B13：回老样式——ctxmenu 子窗格承载（W55 应用风卡片菜单=老样式血统）；
   *  载体不回 DOM（回了必被浏览器视图压）；OS 原生菜单仅留浏览器视图内右键（W34 路）；网页预览留 DOM 兜底） */
  async showMore(label, buttons, anchor) {
    if (window.mazz?.isElectron && typeof window.mazz?.invoke === 'function') {
      const r = anchor?.getBoundingClientRect?.() || { left: 100, bottom: 80 };
      const { menus } = await import('../core/menu-service.js');
      // ctxmenu 桥（与右键菜单同体）：stash 项+开格定位（锚点正下，右缘对齐防出屏——主进程翻边兜底）
      menus._ctxItems = buttons.map(b => ({ id: b.command, label: b.label, icon: b.icon || '', enabled: b.enabled !== false })); // icon 必须带（B13 丢 icon=二级菜单无 SVG 样式平反——桥会 iconHtml 转换）
      const h = Math.min(buttons.length * 28 + 12, Math.round(window.innerHeight * 0.8));
      const w = Math.max(200, Math.min(280, 14 + Math.max(...buttons.map(b => String(b.label || '').length)) * 13));
      await window.mazz.invoke('panel:open', { kind: 'ctxmenu', opts: { x: Math.max(8, r.left + (r.width || 0) - w), y: (r.bottom || 80) + 4, w, h } }).catch(() => {});
      return;
    }
    document.querySelector('.rb-more-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'rb-more-pop';
    pop.innerHTML = `<div class="rb-more-title">${label}</div>`;
    for (const b of buttons) {
      const btn = this.makeBtn(b);
      btn.style.flexDirection = 'row';
      btn.style.width = '100%';
      btn.addEventListener('click', () => pop.remove());
      pop.appendChild(btn);
    }
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1024; // jsdom/契约环境 innerWidth 裸全局可能缺席（实锤）
    pop.style.cssText = `position:fixed;top:${r.bottom + 4}px;left:${Math.max(8, Math.min(r.left, vw - 260))}px;z-index:9999;background:var(--bg-elev,#fff);border:1px solid var(--border,#e0ded8);border-radius:10px;padding:8px;box-shadow:0 8px 30px rgba(0,0,0,.14);min-width:190px;max-height:60vh;overflow-y:auto;display:flex;flex-direction:column;gap:2px`;
    const close = (e) => {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  /** 上下文变化时刷新按钮可用态 */
  refreshStates() {
    this.panelEl.querySelectorAll('[data-command]').forEach(btn => {
      const cmd = commands.get(btn.dataset.command);
      btn.disabled = !cmd || (cmd.when && !contextKeys.evaluate(cmd.when));
    });
  }
}
