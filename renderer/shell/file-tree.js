// renderer/shell/file-tree.js —— 目录树：工作区浏览 + 右键 3/4 号上下文 + 外部变更联动
import { menus } from '../core/menu-service.js';
import { contextKeys } from '../core/contextkey-service.js';
import { bus } from '../core/events.js';

export class FileTree {
  constructor(root, { onOpenFile, onNewFile, onNewFolder, getWorkspace }) {
    this.el = root;
    this.onOpenFile = onOpenFile;
    this.getWorkspace = getWorkspace;
    this.expanded = new Set();
    this.selectedPath = null;
    this.el.innerHTML = `
      <div class="sidebar-head"><span>工作区</span>
        <span class="acts">
          <button data-a="newFile" title="新建文件">＋</button>
          <button data-a="newFolder" title="新建文件夹">🗀</button>
          <button data-a="refresh" title="刷新">⟳</button>
        </span></div>
      <div class="filetree"></div>`;
    this.treeEl = this.el.querySelector('.filetree');
    this.el.querySelector('[data-a=newFile]').addEventListener('click', () => onNewFile());
    this.el.querySelector('[data-a=newFolder]').addEventListener('click', () => onNewFolder());
    this.el.querySelector('[data-a=refresh]').addEventListener('click', () => this.refresh());

    // 磁盘变更 → 自动刷新（防抖）
    if (window.mazz?.isElectron) {
      let deb;
      window.mazz.on('file:changed', ({ path }) => {
        clearTimeout(deb);
        deb = setTimeout(() => { this.refresh(); bus.emit('filetree:externallyChanged', path); }, 350);
      });
    }
  }

  async refresh() {
    const ws = await this.getWorkspace();
    this.treeEl.innerHTML = '';
    if (!ws) {
      const empty = document.createElement('div');
      empty.className = 'ft-empty';
      empty.innerHTML = '尚未选择工作区<br>点击「文件 → 打开工作区」';
      this.treeEl.appendChild(empty);
      return;
    }
    const frag = await this.renderDir(ws, 0);
    this.treeEl.appendChild(frag);
  }

  async renderDir(dirPath, depth) {
    const frag = document.createDocumentFragment();
    let entries = [];
    try { entries = await window.mazz.invoke('fs:listDir', { path: dirPath }); }
    catch (e) { console.warn('[filetree]', e.message); return frag; }
    for (const entry of entries) {
      const node = document.createElement('div');
      node.className = 'ft-node' + (this.selectedPath === entry.path ? ' on' : '');
      node.dataset.path = entry.path;
      const isOpen = this.expanded.has(entry.path);
      const ico = document.createElement('span');
      ico.className = 'ft-ico';
      ico.textContent = entry.isDir ? (isOpen ? '▾' : '▸') : iconFor(entry.name);
      const name = document.createElement('span');
      name.className = 'ft-name';
      name.textContent = entry.name;
      node.append(ico, name);
      node.title = entry.path;
      frag.appendChild(node);

      node.addEventListener('click', async () => {
        this.selectedPath = entry.path;
        this.treeEl.querySelectorAll('.ft-node').forEach(n => n.classList.toggle('on', n.dataset.path === entry.path));
        if (entry.isDir) {
          this.expanded.has(entry.path) ? this.expanded.delete(entry.path) : this.expanded.add(entry.path);
          await this.refresh();
        } else {
          this.onOpenFile(entry.path);
        }
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.selectedPath = entry.path;
        contextKeys.set('treePath', entry.path);
        contextKeys.set('treeIsDir', entry.isDir);
        menus.show(entry.isDir ? 'fileTree/folder' : 'fileTree/file', { x: e.clientX, y: e.clientY, preferDom: true });
      });

      if (entry.isDir && isOpen) {
        const childWrap = document.createElement('div');
        childWrap.className = 'ft-children';
        childWrap.appendChild(await this.renderDir(entry.path, depth + 1));
        frag.appendChild(childWrap);
      }
    }
    if (!entries.length && depth === 0) {
      const empty = document.createElement('div');
      empty.className = 'ft-empty';
      empty.textContent = '空文件夹 — 右键新建文件开始';
      frag.appendChild(empty);
    }
    return frag;
  }

  markActive(filePath) {
    this.selectedPath = filePath;
    this.treeEl.querySelectorAll('.ft-node').forEach(n =>
      n.classList.toggle('on', n.dataset.path === filePath));
  }
}

function iconFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { md: 'Ⓜ', markdown: 'Ⓜ', txt: '🄣', mazz: '◆', pdf: '📕', png: '🖼', jpg: '🖼', jpeg: '🖼' }[ext] || '🄵';
}
