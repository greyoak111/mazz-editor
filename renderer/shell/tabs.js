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
    this.el.setAttribute('role', 'tablist');
    this.el.setAttribute('aria-label', '已打开内容');
    this.el.setAttribute('aria-orientation', 'horizontal');
    this.area = area;        // .editor-area
    this.tabs = [];          // {id, title, moduleId, iconId, filePath, dirty, pinned, view}
    this.activeId = null;
    // W87i：页签条是一个“右缘锚定、活动项优先可见”的滚动视口。
    // render 会重建 .tab 节点，不能把浏览器偶然保留下来的 scrollLeft 当状态。
    this._scrollPinnedRight = true;
    this._renderGeneration = 0;
    this.el.addEventListener('scroll', (event) => {
      // 只把用户真实滚动解释为“离开/回到右缘”；程序写入由 _setScroll 记账。
      if (event.isTrusted) this._scrollPinnedRight = this._isAtRight();
    }, { passive: true });
    this._resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (!this.el.isConnected) {
        this._resizeObserver?.disconnect();
        return;
      }
      if (!this.tabs.length) return;
      if (this._scrollPinnedRight) this._setScroll(this._maxScroll(), true);
      else this._ensureActiveVisible();
    }) : null;
    this._resizeObserver?.observe(this.el);
  }

  add({ title, moduleId, iconId = moduleIconId(moduleId), filePath = null, activate = true, provisional = false }) {
    // 同文件复用标签
    if (filePath) {
      const hit = this.tabs.find(t => t.filePath === filePath);
      if (hit) { if (activate) this.activate(hit.id); return hit; }
    }
    const id = 'tab-' + seq++;
    const view = document.createElement('div');
    view.className = 'module-view';
    view.dataset.tabId = id;
    view.id = id + '-panel';
    view.setAttribute('role', 'tabpanel');
    view.setAttribute('aria-labelledby', id + '-tab');
    view.setAttribute('aria-hidden', 'true');
    view.setAttribute('inert', '');
    this.area.appendChild(view);
    const tab = { id, title, moduleId, iconId, filePath, dirty: false, pinned: false, provisional: !!provisional, view };
    this.tabs.push(tab);
    this.render();
    if (activate && !provisional) this.activate(id);
    if (!provisional) bus.emit('tab:added', tab);
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
    if (!tab || tab.provisional || tab.handoffFrozen) return false;
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
    return true;
  }

  /** Publish a fully-restored handoff tab. Until this call it has no tab-strip
   * presence, cannot receive focus and its module view remains inert. */
  commitProvisional(id) {
    const tab = this.get(id);
    if (!tab || !tab.provisional) return false;
    tab.provisional = false;
    bus.emit('tab:added', tab);
    this.render();
    return this.activate(id);
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
    const visible = this.tabs.filter(tab => !tab.provisional);
    if (visible.length < 2) return;
    const i = visible.findIndex(t => t.id === this.activeId);
    const next = visible[(i + dir + visible.length) % visible.length];
    this.activate(next.id);
  }
  activateIndex(n) {
    const tab = this.tabs.filter(item => !item.provisional)[n - 1];
    if (tab) this.activate(tab.id);
  }

  _maxScroll() {
    return Math.max(0, this.el.scrollWidth - this.el.clientWidth);
  }

  _isAtRight() {
    return this._maxScroll() - this.el.scrollLeft <= 2;
  }

  _tabElement(id) {
    return [...this.el.querySelectorAll('.tab')].find(el => el.dataset.tabId === id) || null;
  }

  _setScroll(value, pinned = null) {
    const max = this._maxScroll();
    this.el.scrollLeft = Math.max(0, Math.min(max, Number(value) || 0));
    this._scrollPinnedRight = pinned == null ? this._isAtRight() : !!pinned;
  }

  _scrollSnapshot() {
    const barRect = this.el.getBoundingClientRect();
    const renderedActive = this.el.querySelector('.tab.on');
    const visible = [...this.el.querySelectorAll('.tab')].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.right > barRect.left + 1 && rect.left < barRect.right - 1;
    });
    const anchor = renderedActive && visible.includes(renderedActive) ? renderedActive : visible[0];
    return {
      scrollLeft: this.el.scrollLeft,
      rightPinned: this._scrollPinnedRight || this._isAtRight(),
      renderedActiveId: renderedActive?.dataset.tabId || null,
      anchorId: anchor?.dataset.tabId || null,
      anchorLeft: anchor ? anchor.getBoundingClientRect().left - barRect.left : null,
    };
  }

  _ensureActiveVisible() {
    const active = this._tabElement(this.activeId);
    if (!active) {
      this._scrollPinnedRight = this._isAtRight();
      return;
    }
    const tabs = [...this.el.querySelectorAll('.tab')];
    if (active === tabs.at(-1)) {
      this._setScroll(this._maxScroll(), true);
      return;
    }
    const barRect = this.el.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    let next = this.el.scrollLeft;
    if (activeRect.left < barRect.left) next -= barRect.left - activeRect.left;
    else if (activeRect.right > barRect.right) next += activeRect.right - barRect.right;
    this._setScroll(next);
  }

  _restoreScroll(snapshot) {
    if (!this.tabs.length) {
      this._setScroll(0, true);
      return;
    }
    const activeChanged = snapshot.renderedActiveId !== this.activeId;
    if (!activeChanged && snapshot.rightPinned) {
      // append / dirty / rename / reorder 在右缘发生时，新增宽度由右侧吸收。
      this._setScroll(this._maxScroll(), true);
      return;
    }

    this._setScroll(snapshot.scrollLeft, false);
    if (!activeChanged && snapshot.anchorId && snapshot.anchorLeft != null) {
      // 非右缘浏览状态用同一可见标签作视觉锚，避免全量重建或前项改名造成横跳。
      const anchor = this._tabElement(snapshot.anchorId);
      if (anchor) {
        const barRect = this.el.getBoundingClientRect();
        const currentLeft = anchor.getBoundingClientRect().left - barRect.left;
        this._setScroll(this.el.scrollLeft + currentLeft - snapshot.anchorLeft, false);
      }
    }
    // 激活、dirty、rename、跨窗格迁移最终都以活动标签完整可见为硬门。
    this._ensureActiveVisible();
  }

  render() {
    const scrollSnapshot = this._scrollSnapshot();
    const generation = ++this._renderGeneration;
    this.el.querySelectorAll('.tab').forEach(e => e.remove()); // 保留窗格关闭钮等非标签元素
    for (const t of this.tabs) {
      if (t.provisional) continue;
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === this.activeId ? ' on' : '');
      // W87d：document capture 阶段必须在抓取原生 Surface 前识别并激活拖动源。
      // dataTransfer 要到本节点的 dragstart 才会写入，来不及作为 capture 阶段的身份源。
      el.dataset.tabId = t.id;
      el.setAttribute('role', 'presentation');
      const name = document.createElement('span');
      name.className = 't-name';
      name.id = t.id + '-tab';
      name.setAttribute('role', 'tab');
      name.setAttribute('aria-controls', t.id + '-panel');
      name.setAttribute('aria-selected', String(t.id === this.activeId));
      name.setAttribute('aria-label', `${t.title}${t.dirty ? '，未保存' : ''}`);
      name.tabIndex = t.id === this.activeId ? 0 : -1;
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
        d.className = 't-dirty'; d.innerHTML = iconHtml('●'); d.setAttribute('aria-hidden', 'true');
        el.appendChild(d);
      }
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 't-close'; closeBtn.title = '关闭'; closeBtn.setAttribute('aria-label', `关闭 ${t.title}`); closeBtn.innerHTML = iconHtml('✕');
      el.appendChild(closeBtn);
      el.addEventListener('click', (e) => { if (!e.target.closest('.t-close')) this.activate(t.id); });
      name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.activate(t.id);
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const visible = this.tabs.filter(tab => !tab.provisional);
        const at = visible.findIndex(tab => tab.id === t.id);
        const target = event.key === 'Home' ? visible[0]
          : event.key === 'End' ? visible.at(-1)
            : visible[(at + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length];
        this.activate(target.id);
        requestAnimationFrame(() => this.el.querySelector(`[data-tab-id="${target.id}"] .t-name`)?.focus());
      });
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
    this._restoreScroll(scrollSnapshot);
    // 字体/图标在同一帧完成布局后再收敛一次；generation 防旧 render 覆写新激活态。
    requestAnimationFrame(() => {
      if (generation !== this._renderGeneration) return;
      if (this._scrollPinnedRight) this._setScroll(this._maxScroll(), true);
      else this._ensureActiveVisible();
    });
    contextKeys.set('hasTabs', this.tabs.some(tab => !tab.provisional));
  }
}
