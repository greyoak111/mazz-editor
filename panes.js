// renderer/shell/panes.js —— 窗格树：二叉分裂布局（右/下任意分，三分/四分自然成形，隔条拖拽改大小）
// 叶子 = 窗格（tabbar + editor-area + Tabs）；分支 = row/column + 可调比例
import { bus } from '../core/events.js';
import { contextKeys } from '../core/contextkey-service.js';
import { Tabs } from './tabs.js';

const MIN_RATIO = 0.1; // 每侧最小占比
let paneSeq = 1;

class Leaf {
  constructor(tree) {
    this.id = 'pane-' + paneSeq++;
    this.tree = tree;
    this.el = document.createElement('div');
    this.el.className = 'pane';
    this.el.innerHTML = `<div class="tabbar"></div><div class="editor-area"></div>
      <div class="pane-empty">空窗格 · 拖标签到此，或从命令面板（Ctrl+Shift+P）新建</div>`;
    this.tabs = new Tabs(this.el.querySelector('.tabbar'), this.el.querySelector('.editor-area'));
    // 窗格关闭钮（多窗格时显示在标签栏右侧）
    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'pane-close';
    this.closeBtn.title = '关闭此窗格（标签移到相邻窗格）';
    this.closeBtn.textContent = '✕';
    this.closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.tree.closePane(this);
    });
    this.el.querySelector('.tabbar').appendChild(this.closeBtn);
    this.el.addEventListener('mousedown', () => tree.setActive(this));
    // 拖标签到此窗格
    this.el.querySelector('.tabbar').addEventListener('dragover', (e) => e.preventDefault());
    this.el.querySelector('.tabbar').addEventListener('drop', (e) => {
      e.preventDefault();
      const tabId = e.dataTransfer.getData('mazz/tab');
      if (tabId) this.tree.moveTabToPane(tabId, this);
    });
    this.refreshEmpty();
  }
  isEmpty() { return this.tabs.tabs.length === 0; }
  refreshEmpty() {
    // 欢迎页显示时占位提示隐藏（防文字叠在欢迎卡片上）
    const hasWelcome = !!this.el.querySelector('.welcome');
    this.el.querySelector('.pane-empty').style.display = (this.isEmpty() && !hasWelcome) ? 'grid' : 'none';
  }
  destroy() { this.el.remove(); }
}

export class PaneTree {
  constructor(rootEl) {
    this.rootEl = rootEl; // .panes 容器
    this.root = new Leaf(this); // 初始单窗格
    this.active = this.root;
    this.render();
  }

  /** 当前活动窗格的 Tabs（外壳 this.tabs 经此取数） */
  get tabs() { return this.active.tabs; }
  leaves() {
    const out = [];
    const walk = (n) => { n instanceof Leaf ? out.push(n) : (walk(n.a), walk(n.b)); };
    walk(this.root);
    return out;
  }
  leafById(id) { return this.leaves().find(l => l.id === id) || null; }
  paneOfTab(tabId) { return this.leaves().find(l => l.tabs.get(tabId)) || null; }

  setActive(leaf) {
    if (this.active === leaf) return;
    this.active = leaf;
    this.renderActiveClass();
    const t = leaf.tabs.active;
    if (t) bus.emit('tab:activate', t);
  }
  renderActiveClass() {
    for (const l of this.leaves()) l.el.classList.toggle('active', l === this.active);
  }

  // ==================== 分裂 ====================
  /** direction: 'row'（右） | 'column'（下）。新窗格为空白占位；标签保留在原窗格（不搬动，防误收缩） */
  split(leaf, direction) {
    const parent = this.findParent(this.root, leaf);
    const branch = {
      direction,
      sizes: [0.5, 0.5],
      a: leaf,
      b: new Leaf(this),
    };
    if (parent) {
      if (parent.a === leaf) parent.a = branch;
      else parent.b = branch;
    } else {
      this.root = branch;
    }
    this.render();
    this.setActive(branch.b);
    this.syncKeys();
    return branch.b;
  }

  splitActive(direction) {
    return this.split(this.active, direction);
  }

  // ==================== 关闭/合并 ====================
  closePane(leaf) {
    // 把标签全移到相邻窗格再收缩
    const sibling = this.siblingOf(leaf);
    for (const t of [...leaf.tabs.tabs]) this.moveTabToPane(t.id, sibling || this.leaves()[0]);
    this.collapseLeaf(leaf);
  }

  /** 叶子最后一个标签关闭后自动收缩（用户要求 1） */
  collapseLeaf(leaf) {
    if (this.root === leaf) return; // 根窗格永不收缩
    const parent = this.findParent(this.root, leaf);
    if (!parent) return;
    const grand = this.findParent(this.root, parent);
    const survivor = parent.a === leaf ? parent.b : parent.a;
    if (grand) {
      if (grand.a === parent) grand.a = survivor;
      else grand.b = survivor;
    } else {
      this.root = survivor;
    }
    leaf.destroy();
    if (this.active === leaf) {
      const next = survivor instanceof Leaf ? survivor : this.leaves()[0];
      this.setActive(next);
    }
    this.render();
    this.syncKeys();
  }

  /** 叶子变空时调用（若无标签则自动收缩） */
  onLeafEmpty(leaf) {
    if (leaf.isEmpty() && this.root !== leaf) {
      this.collapseLeaf(leaf);
    } else {
      leaf.refreshEmpty();
    }
    this.syncKeys();
  }

  /** 合并全部窗格为单窗格 */
  joinAll() {
    if (this.leaves().length <= 1) return;
    const target = this.leaves()[0];
    for (const leaf of this.leaves().slice(1)) {
      for (const t of [...leaf.tabs.tabs]) this.moveTabToPane(t.id, target);
      leaf.destroy();
    }
    this.root = target;
    this.setActive(target);
    this.render();
    this.syncKeys();
  }

  siblingOf(leaf) {
    const parent = this.findParent(this.root, leaf);
    if (!parent) return null;
    const sib = parent.a === leaf ? parent.b : parent.a;
    return sib instanceof Leaf ? sib : this.leaves().find(l => l !== leaf);
  }

  findParent(node, target) {
    if (node instanceof Leaf) return null;
    if (node.a === target || node.b === target) return node;
    return this.findParent(node.a, target) || this.findParent(node.b, target);
  }

  // ==================== 标签迁移 ====================
  moveTabToPane(tabId, targetLeaf) {
    const from = this.paneOfTab(tabId);
    if (!from || from === targetLeaf) return;
    const tab = from.tabs.get(tabId);
    from.tabs.tabs = from.tabs.tabs.filter(t => t.id !== tabId);
    targetLeaf.tabs.area.appendChild(tab.view);
    targetLeaf.tabs.tabs.push(tab);
    if (from.tabs.activeId === tabId) {
      from.tabs.activeId = null;
      const next = from.tabs.tabs[from.tabs.tabs.length - 1];
      if (next) from.tabs.activate(next.id);
      else from.tabs.render();
    }
    this.setActive(targetLeaf);
    targetLeaf.tabs.activate(tab.id);
    from.tabs.render();
    targetLeaf.tabs.render();
    from.refreshEmpty();
    targetLeaf.refreshEmpty();
    this.onLeafEmpty(from);
  }

  /** 活动标签移到下一个窗格（活动窗格为空时，自动找最近有标签的窗格） */
  moveActiveTabToNextPane() {
    const leaves = this.leaves();
    // 源窗格：优先活动窗格；否则向前找最近的有活动标签的窗格
    let source = this.active.tabs.active ? this.active : null;
    if (!source) {
      const idx = leaves.indexOf(this.active);
      for (let i = 1; i <= leaves.length; i++) {
        const cand = leaves[(idx - i + leaves.length) % leaves.length];
        if (cand.tabs.active) { source = cand; break; }
      }
    }
    if (!source) return false;
    const tab = source.tabs.active;
    let target;
    if (leaves.length < 2) {
      target = this.split(source, 'row');
    } else {
      const sIdx = leaves.indexOf(source);
      target = leaves[(sIdx + 1) % leaves.length];
      if (target === source) target = this.split(source, 'row');
    }
    this.moveTabToPane(tab.id, target);
    return true;
  }

  // ==================== 渲染 ====================
  render() {
    this.rootEl.innerHTML = '';
    this.rootEl.appendChild(this.renderNode(this.root));
    this.renderActiveClass();
  }

  renderNode(node) {
    if (node instanceof Leaf) {
      // 关键：叶子作为独立根窗格或进入新分支前，必须重置掉旧分支残留的内联比例
      node.el.style.flex = '1 1 0';
      return node.el;
    }
    const wrap = document.createElement('div');
    wrap.className = `pane-branch ${node.direction}`;
    const a = this.renderNode(node.a);
    const b = this.renderNode(node.b);
    a.style.flex = `${node.sizes[0]} 1 0`;
    b.style.flex = `${node.sizes[1]} 1 0`;
    const divider = document.createElement('div');
    divider.className = 'pane-divider';
    wrap.append(a, divider, b);
    this.bindDivider(divider, node, wrap, a, b);
    return wrap;
  }

  /** 隔条拖拽改大小（用户要求 3） */
  bindDivider(divider, node, wrap, a, b) {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const horizontal = node.direction === 'row';
      const rect = wrap.getBoundingClientRect();
      const total = horizontal ? rect.width : rect.height;
      const move = (ev) => {
        const pos = horizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
        let ratio = pos / total;
        ratio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio));
        node.sizes = [ratio, 1 - ratio];
        a.style.flex = `${node.sizes[0]} 1 0`;
        b.style.flex = `${node.sizes[1]} 1 0`;
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.classList.remove('pane-resizing');
      };
      document.body.classList.add('pane-resizing');
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  syncKeys() {
    const many = this.leaves().length > 1;
    contextKeys.set('hasSplit', many);
    contextKeys.set('paneCount', this.leaves().length);
    for (const l of this.leaves()) {
      l.closeBtn.style.display = many ? 'block' : 'none';
      l.refreshEmpty();
    }
  }
}
