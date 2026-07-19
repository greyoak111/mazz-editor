// renderer/shell/sidebar-ctl.js —— 工作区侧栏控制（思源式）：折叠/展开 + 钉住/浮出 + 拖拽调宽
const MIN_W = 180, MAX_W = 480;

export class SidebarCtl {
  constructor(sidebar) {
    this.sidebar = sidebar;
    this.state = { width: 232, pinned: true, collapsed: false };
    this._outsideHandler = null;

    // 头部按钮：钉住 + 折叠（插到既有按钮组最前）
    const acts = sidebar.querySelector('.sidebar-head .acts');
    if (acts) {
      acts.insertAdjacentHTML('afterbegin',
        `<button data-a="pin" title="钉住（推挤布局）/取消钉住（浮层覆盖）">📌</button>
         <button data-a="collapse" title="折叠工作区">«</button>`);
      acts.querySelector('[data-a=pin]').addEventListener('click', () => this.togglePin());
      acts.querySelector('[data-a=collapse]').addEventListener('click', () => this.setCollapsed(true));
    }
    // 右缘拖拽手柄
    this.grip = document.createElement('div');
    this.grip.className = 'sidebar-grip';
    this.grip.title = '拖拽调整宽度';
    sidebar.appendChild(this.grip);
    this.grip.addEventListener('mousedown', (e) => this.startDrag(e));
    // 折叠态的展开轨道条
    this.rail = document.createElement('button');
    this.rail.className = 'sidebar-rail';
    this.rail.textContent = '»';
    this.rail.title = '展开工作区';
    this.rail.style.display = 'none';
    this.rail.addEventListener('click', () => this.setCollapsed(false));
    sidebar.parentElement.insertBefore(this.rail, sidebar);
  }

  async init() {
    const saved = await window.mazz?.invoke('settings:get', { key: 'ui.sidebar' }).catch(() => null);
    if (saved && typeof saved === 'object') Object.assign(this.state, saved);
    this.apply();
  }

  persist() {
    window.mazz?.invoke('settings:set', { key: 'ui.sidebar', value: this.state }).catch(() => {});
  }

  setCollapsed(v) { this.state.collapsed = v; this.apply(); this.persist(); }
  togglePin() { this.state.pinned = !this.state.pinned; this.apply(); this.persist(); }
  setWidth(w) { this.state.width = Math.min(Math.max(w, MIN_W), MAX_W); this.apply(); this.persist(); }
  toggleCollapse() { this.setCollapsed(!this.state.collapsed); }

  apply() {
    const sb = this.sidebar;
    sb.classList.toggle('collapsed', this.state.collapsed);
    sb.classList.toggle('floating', !this.state.pinned && !this.state.collapsed);
    this.rail.style.display = this.state.collapsed ? 'flex' : 'none';
    sb.style.width = this.state.collapsed ? '0px' : this.state.width + 'px';
    const pinBtn = sb.querySelector('[data-a=pin]');
    if (pinBtn) {
      pinBtn.textContent = this.state.pinned ? '📌' : '📍';
      pinBtn.style.color = this.state.pinned ? '' : 'var(--accent, #4f46e5)';
      pinBtn.title = this.state.pinned ? '已钉住（推挤布局）——点击切换浮层' : '浮层模式（点击编辑器外自动收起）——点击钉住';
    }
    // 浮层模式：点击外部自动收起
    if (!this.state.pinned && !this.state.collapsed) {
      if (!this._outsideHandler) {
        this._outsideHandler = (e) => {
          if (!this.sidebar.contains(e.target) && e.target !== this.rail) {
            this.setCollapsed(true);
          }
        };
        setTimeout(() => document.addEventListener('mousedown', this._outsideHandler), 0);
      }
    } else if (this._outsideHandler) {
      document.removeEventListener('mousedown', this._outsideHandler);
      this._outsideHandler = null;
    }
  }

  startDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.state.width;
    const move = (ev) => {
      this.state.width = Math.min(Math.max(startW + ev.clientX - startX, MIN_W), MAX_W);
      this.sidebar.style.width = this.state.width + 'px';
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.persist();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
}
