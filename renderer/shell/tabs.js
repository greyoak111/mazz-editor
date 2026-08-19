// renderer/shell/tabs.js —— 多标签页：打开/关闭/固定/上下文菜单/快捷键循环
import { bus } from '../core/events.js';
import { menus } from '../core/menu-service.js';
import { contextKeys } from '../core/contextkey-service.js';
import { inputModal } from './shell.js';
import { iconHtml } from '../lib/svg-icons.js';
import { iconHtmlById, moduleIconId } from '../core/icon-registry.js';

let seq = 1;

export class Tabs {
  constructor(root, area) {
    this.el = root;          // .tabbar
    this.area = area;        // .editor-area
    this.tabs = [];          // {id, title, moduleId, iconId, filePath, dirty, pinned, view}
    this.activeId = null;
  }

  add({ title, moduleId, iconId = moduleIconId(moduleId), filePath = null }) {
    // 同文件复用标签
    if (filePath) {
      const hit = this.tabs.find(t => t.filePath === filePath);
      if (hit) { this.activate(hit.id); return hit; }
    }
    const id = 'tab-' + seq++;
    const view = document.createElement('div');
    view.className = 'module-view';
    view.dataset.tabId = id;
    view.setAttribute('aria-hidden', 'true');
    view.setAttribute('inert', '');
    this.area.appendChild(view);
    const tab = { id, title, moduleId, iconId, filePath, dirty: false, pinned: false, view };
    this.tabs.push(tab);
    this.render();
    this.activate(id);
    bus.emit('tab:added', tab);
    return tab;
  }

  get(id) { return this.tabs.find(t => t.id === id); }
  get active() { return this.get(this.activeId); }

  _releaseFocus(view) {
    const focused = document.activeElement;
    if (focused && view?.contains(focused)) {
      try { focused.blur(); } catch {}
    }
  }

  activate(id) {
    const tab = this.get(id);
    if (!tab) return;
    if (this.activeId && this.activeId !== id) {
      const outgoing = this.get(this.activeId);
      this._releaseFocus(outgoing?.view);
      bus.emit('tab:deactivate', this.activeId);
    }
    this.activeId = id;
    this.tabs.forEach(t => {
      const active = t.id === id;
      t.view.classList.toggle('on', active);
      t.view.setAttribute('aria-hidden', String(!active));
      t.view.toggleAttribute('inert', !active);
    });
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
    this._releaseFocus(tab.view);
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
      name.innerHTML = '';
      if (t.pinned) { const pin = document.createElement('span'); pin.className = 'tab-pin'; pin.innerHTML = iconHtml('📌'); name.appendChild(pin); }
      const icon = document.createElement('span');
      icon.className = 't-icon';
      icon.dataset.iconId = t.iconId;
      icon.innerHTML = iconHtmlById(t.iconId);
      name.appendChild(icon);
      const label = document.createElement('span');
      label.className = 't-label';
      label.textContent = t.title;
      name.appendChild(label);
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
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('mazz/tab', t.id);
        // 杀掉 Chromium 默认 dragImage（跟手的半透明标签幻影）——分屏预览已统一为无框纯渐隐，
        // 幻影带完整边框被用户误认为"没砍掉的虚线框"，且松手瞬间会被截图定格成"漂浮标签"
        if (!Tabs._dragGhost) {
          // Windows 怪癖：opacity 透明技巧会被 Chromium 回退默认 tab 幻影（顽固实体框线实锤）——
          // 唯一可靠：给「无内容的空 Image 对象」（无 src，各平台一致渲染为空）
          Tabs._dragGhost = new Image();
        }
        try { e.dataTransfer.setDragImage(Tabs._dragGhost, 0, 0); } catch {}
      });
      el.addEventListener('dragend', (e) => {
        const { outerWidth, outerHeight, screenX, screenY } = window;
        const x = e.screenX, y = e.screenY;
        const inside = x >= screenX && x <= screenX + outerWidth && y >= screenY && y <= screenY + outerHeight;
        if (!inside) bus.emit('tab:dragOut', { id: t.id, x: e.screenX, y: e.screenY });
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
