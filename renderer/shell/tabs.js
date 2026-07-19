// renderer/shell/tabs.js —— 多标签页：打开/关闭/固定/上下文菜单/快捷键循环
import { bus } from '../core/events.js';
import { menus } from '../core/menu-service.js';
import { contextKeys } from '../core/contextkey-service.js';
import { inputModal } from './shell.js';

let seq = 1;

export class Tabs {
  constructor(root, area) {
    this.el = root;          // .tabbar
    this.area = area;        // .editor-area
    this.tabs = [];          // {id, title, moduleId, filePath, dirty, pinned, view}
    this.activeId = null;
  }

  add({ title, moduleId, filePath = null }) {
    // 同文件复用标签
    if (filePath) {
      const hit = this.tabs.find(t => t.filePath === filePath);
      if (hit) { this.activate(hit.id); return hit; }
    }
    const id = 'tab-' + seq++;
    const view = document.createElement('div');
    view.className = 'module-view';
    view.dataset.tabId = id;
    this.area.appendChild(view);
    const tab = { id, title, moduleId, filePath, dirty: false, pinned: false, view };
    this.tabs.push(tab);
    this.render();
    this.activate(id);
    bus.emit('tab:added', tab);
    return tab;
  }

  get(id) { return this.tabs.find(t => t.id === id); }
  get active() { return this.get(this.activeId); }

  activate(id) {
    const tab = this.get(id);
    if (!tab) return;
    if (this.activeId && this.activeId !== id) bus.emit('tab:deactivate', this.activeId);
    this.activeId = id;
    this.tabs.forEach(t => t.view.classList.toggle('on', t.id === id));
    bus.emit('tab:activate', tab);
    this.render();
    contextKeys.set('hasTabs', this.tabs.length > 0);
  }

  setDirty(id, dirty) {
    const t = this.get(id);
    if (t && t.dirty !== dirty) { t.dirty = dirty; this.render(); }
  }
  setTitle(id, title) {
    const t = this.get(id);
    if (t) { t.title = title; this.render(); }
  }

  async close(id, { force = false } = {}) {
    const i = this.tabs.findIndex(t => t.id === id);
    if (i < 0) return false;
    const tab = this.tabs[i];
    if (tab.dirty && !force && !tab.forceClose) return false; // 确认流程由 shell 处理
    bus.emit('tab:closing', tab);
    tab.view.remove();
    this.tabs.splice(i, 1);
    if (this.activeId === id) {
      const next = this.tabs[i] || this.tabs[i - 1];
      this.activeId = null;
      if (next) this.activate(next.id);
      else { this.render(); bus.emit('tab:empty'); }
    } else this.render();
    return true;
  }

  cycle(dir = 1) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex(t => t.id === this.activeId);
    const next = this.tabs[(i + dir + this.tabs.length) % this.tabs.length];
    this.activate(next.id);
  }
  activateIndex(n) { if (this.tabs[n - 1]) this.activate(this.tabs[n - 1].id); }

  render() {
    this.el.querySelectorAll('.tab').forEach(e => e.remove()); // 保留窗格关闭钮等非标签元素
    for (const t of this.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === this.activeId ? ' on' : '');
      const name = document.createElement('span');
      name.className = 't-name';
      name.textContent = (t.pinned ? '📌 ' : '') + t.title;
      el.appendChild(name);
      if (t.dirty) {
        const d = document.createElement('span');
        d.className = 't-dirty'; d.textContent = '●';
        el.appendChild(d);
      }
      const closeBtn = document.createElement('button');
      closeBtn.className = 't-close'; closeBtn.title = '关闭'; closeBtn.textContent = '✕';
      el.appendChild(closeBtn);
      el.addEventListener('click', (e) => { if (!e.target.closest('.t-close')) this.activate(t.id); });
      // 双击重命名（自定义标签标题，未命名文件尤其需要）
      el.addEventListener('dblclick', async (e) => {
        if (e.target.closest('.t-close')) return;
        const name = await inputModal('重命名标签', t.title);
        if (name?.trim()) this.setTitle(t.id, name.trim());
      });
      closeBtn.addEventListener('click', () => bus.emit('tab:requestClose', t.id));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.activate(t.id);
        contextKeys.set('tabId', t.id);
        menus.show('tab/context', { x: e.clientX, y: e.clientY, preferDom: true });
      });
      // 拖拽排序；拖出主窗口边界 → 移到新窗口
      el.draggable = true;
      el.addEventListener('dragstart', (e) => e.dataTransfer.setData('mazz/tab', t.id));
      el.addEventListener('dragend', (e) => {
        const { outerWidth, outerHeight, screenX, screenY } = window;
        const x = e.screenX, y = e.screenY;
        const inside = x >= screenX && x <= screenX + outerWidth && y >= screenY && y <= screenY + outerHeight;
        if (!inside) bus.emit('tab:dragOut', t.id);
      });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData('mazz/tab');
        if (!from || from === t.id) return;
        const fi = this.tabs.findIndex(x => x.id === from);
        if (fi < 0) return; // 跨窗格拖动：交给窗格树的 tabbar drop 处理
        const ti = this.tabs.findIndex(x => x.id === t.id);
        const [moved] = this.tabs.splice(fi, 1);
        this.tabs.splice(ti, 0, moved);
        this.render();
      });
      this.el.appendChild(el);
    }
    contextKeys.set('hasTabs', this.tabs.length > 0);
  }
}
