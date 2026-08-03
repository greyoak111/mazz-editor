// renderer/shell/sidebar-panels.js —— 侧栏多页签面板（思源工作区思路）
// 页签：文件 / 大纲 / 书签 / 标签 / 反链；文件页 = 既有 FileTree，其余为新增面板
import { iconHtml } from '../lib/svg-icons.js';
import { toast, modal } from './shell.js';

const MARKS_KEY = 'mazz.sidebar.marks';
const CLOSED_DIRS_KEY = 'mazz.sidebar.closedDirs';

export class SidebarPanels {
  /**
   * @param {object} o { sidebar, fileTree, shell }
   */
  constructor({ sidebar, fileTree, shell }) {
    this.sidebar = sidebar;
    this.fileTree = fileTree;
    this.shell = shell;
    this.tab = 'files';
    this.outlineExpanded = new Set();
    this.buildTabs();
    this.buildPanels();
    this.showTab(this.tab);
    // 工作区切换（主进程广播）→ 刷新列表与文件树
    if (window.mazz?.on) {
      window.mazz.on('workspace:changed', () => {
        this.refreshWsList();
        window.MazzShell?.fileTree?.refresh?.();
      });
    }
    // 内容联动：标签切换/文档变化时刷新大纲与反链
    import('../core/events.js').then(({ bus }) => {
      bus.on('tab:activate', () => this.refreshActive());
      bus.on('doc:changed', () => { if (this.tab === 'outline' || this.tab === 'backlinks') this.refreshActive(); });
    });
  }

  // ==================== 页签条 ====================
  buildTabs() {
    const head = this.sidebar.querySelector('.sidebar-head');
    if (!head) return;
    // 工具行保留（钉住/折叠/新建/重建索引/折叠全部/排序——v39 误伤恢复）：
    // 标题文字藏掉（页签条已接管），按钮区保留，仅「文档」页签显示
    head.classList.add('sb-toolhead');
    head.querySelector('span:first-child')?.remove();
    this.toolhead = head;
    // 工作区切换器（多工作区：列表 + 切换 + 管理）
    this.wsBar = document.createElement('div');
    this.wsBar.className = 'sb-wsbar';
    this.wsBar.innerHTML = `
      <select class="sb-ws-sel rb-select" title="切换工作区"></select>
      <button class="sb-tbtn" data-a="ws-manage" title="工作区管理（添加/移除/改名）">⋯</button>`;
    head.before(this.wsBar);
    this.wsSel = this.wsBar.querySelector('.sb-ws-sel');
    // B12b 收编：工作区切换器子窗格化（原生弹出层被视图压的根治形——select 隐藏保留作状态单源，选项开格时重读）
    import('../lib/select-menu.js').then(({ selectProxy }) => selectProxy(this.wsSel, { btnClass: 'sb-ws-btn' }));
    this.wsSel.addEventListener('change', async () => {
      const p = this.wsSel.value;
      if (!p) return;
      try {
        await window.mazz.invoke('workspace:setCurrent', { path: p });
        toast('已切换工作区');
        this.refreshAll?.();
        window.MazzShell?.fileTree?.refresh?.();
      } catch (e) { toast('切换失败：' + e.message); }
    });
    this.wsBar.querySelector('[data-a=ws-manage]').addEventListener('click', () => this.openWsManage());
    this.refreshWsList();

    this.tabbar = document.createElement('div');
    this.tabbar.className = 'sb-tabbar';
    const TABS = [
      ['files', '🗀', '文档'],
      ['outline', '≡', '大纲'],
      ['marks', '🔖', '书签'],
      ['tags', '🏷', '标签'],
      ['backlinks', '🔗', '反链'],
    ];
    this.tabbar.innerHTML = TABS.map(([id, ico, t]) =>
      `<button class="sb-tab" data-t="${id}" title="${t}">${iconHtml(ico)}<span>${t}</span></button>`).join('');
    head.before(this.tabbar);
    this.tabbar.querySelectorAll('.sb-tab').forEach(b =>
      b.addEventListener('click', () => this.showTab(b.dataset.t)));
  }

  // ==================== 面板容器 ====================
  buildPanels() {
    const tree = this.sidebar.querySelector('.filetree');
    this.panels = {};
    for (const id of ['outline', 'marks', 'tags', 'backlinks']) {
      const el = document.createElement('div');
      el.className = 'sb-panel sb-panel-' + id;
      el.style.display = 'none';
      tree.after(el);
      this.panels[id] = el;
    }
    this.panels.files = tree;
    this.buildOutline();
    this.buildMarks();
    this.buildTags();
    this.buildBacklinks();
  }

  async refreshWsList() {
    const r = await window.mazz.invoke('workspace:list').catch(() => null);
    if (!r) return;
    this.wsSel.innerHTML = r.list.map(w =>
      `<option value="${w.path}" ${w.path === r.current ? 'selected' : ''}>${w.name}</option>`).join('');
  }

  openWsManage() {
    import('./shell.js').then(async ({ modal, toast, inputModal }) => {
      const m = modal('工作区管理');
      const render = async () => {
        const r = await window.mazz.invoke('workspace:list').catch(() => null);
        m.body.querySelector('.ws-list').innerHTML = (r?.list || []).map(w => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:13px">${w.name} <span style="font-size:11px;color:var(--fg-dim)">${w.path}</span></span>
            ${w.path === r.current ? '<span style="color:var(--accent);font-size:11.5px">当前</span>' : ''}
            <button class="fc-mini" data-ren="${w.path}">改名</button>
            ${w.path !== r.current ? `<button class="fc-mini" data-del="${w.path}">移除</button>` : ''}
          </div>`).join('') || '<div class="fc-empty">（暂无）</div>';
        m.body.querySelectorAll('[data-ren]').forEach(b => b.addEventListener('click', async () => {
          const name = await inputModal('工作区名称', '');
          if (!name?.trim()) return;
          await window.mazz.invoke('workspace:rename', { path: b.dataset.ren, name: name.trim() });
          this.refreshWsList();
          render();
        }));
        m.body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
          try {
            await window.mazz.invoke('workspace:remove', { path: b.dataset.del });
            this.refreshWsList();
            render();
          } catch (e) { toast(e.message); }
        }));
      };
      m.body.innerHTML = `
        <div style="min-width:420px">
          <div class="ws-list" style="max-height:40vh;overflow:auto"></div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="rb-btn" id="ws-add" style="flex-direction:row">＋ 添加工作区…</button>
          </div>
        </div>`;
      m.body.querySelector('#ws-add').addEventListener('click', async () => {
        const dir = await window.mazz.invoke('dialog:openFolder').catch(() => null);
        if (!dir) return;
        const name = await inputModal('工作区名称', dir.split(/[\\/]/).pop());
        try {
          await window.mazz.invoke('workspace:add', { path: dir, name: name || dir.split(/[\\/]/).pop() });
          this.refreshWsList();
          render();
          toast('已添加');
        } catch (e) { toast(e.message); }
      });
      render();
    });
  }

  showTab(id) {
    this.tab = id;
    if (this.toolhead) this.toolhead.style.display = id === 'files' ? '' : 'none';
    this.tabbar.querySelectorAll('.sb-tab').forEach(b => b.classList.toggle('on', b.dataset.t === id));
    for (const [k, el] of Object.entries(this.panels)) el.style.display = k === id ? '' : 'none';
    if (id === 'outline') this.refreshOutline();
    if (id === 'marks') this.refreshMarks();
    if (id === 'tags') this.refreshTags();
    if (id === 'backlinks') this.refreshBacklinks();
  }

  refreshActive() {
    if (this.tab === 'outline') this.refreshOutline();
    if (this.tab === 'backlinks') this.refreshBacklinks();
  }

  /** 当前 markdown 文档标题树（PM 节点级提取——textBetween 会丢 # 前缀） */
  activeHeadings() {
    const ctl = window.__activeMarkdownCtl;
    if (!ctl?.view) return null;
    const out = [];
    ctl.view.state.doc.descendants((node) => {
      if (node.type.name === 'heading') {
        out.push({ level: node.attrs.level || 1, text: node.textContent.replace(/[*_`~]/g, '').trim() });
      }
    });
    return out;
  }

  // ==================== 大纲面板 ====================
  buildOutline() {
    const el = this.panels.outline;
    el.innerHTML = `
      <div class="sb-tool">
        <input class="sb-filter rb-input" placeholder="关键字过滤 Enter" spellcheck="false">
        <button class="sb-tbtn" data-a="expand-all" title="全部展开">${iconHtml('▾')}</button>
        <button class="sb-tbtn" data-a="collapse-all" title="全部收起">${iconHtml('▴')}</button>
      </div>
      <div class="sb-list sb-outline"></div>`;
    this.outlineList = el.querySelector('.sb-outline');
    el.querySelector('.sb-filter').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.refreshOutline(e.target.value.trim());
    });
    el.querySelector('[data-a=expand-all]').addEventListener('click', () => {
      this.outlineList.querySelectorAll('.sb-ol-node').forEach(n => { n.classList.remove('closed'); n.style.display = ''; });
    });
    el.querySelector('[data-a=collapse-all]').addEventListener('click', () => {
      // 只折顶层（后代随父级隐藏），与单击箭头同一套逻辑
      const nodes = [...this.outlineList.querySelectorAll('.sb-ol-node')];
      const minLv = Math.min(...nodes.map(n => +n.querySelector('.sb-ol-lv').textContent.slice(1)));
      nodes.forEach(n => { n.style.display = ''; });
      nodes.filter(n => +n.querySelector('.sb-ol-lv').textContent.slice(1) === minLv)
        .forEach(n => this._olSetClosed(n, true));
    });
    // 大纲项点击展开/折叠（代理）
    this.outlineList.addEventListener('click', (e) => {
      // 箭头逻辑全部走节点级 setNodeClosed（此处不再碰 closed——
      // 双重绑定曾致 class 被连切两次：节点藏了状态却复位，全展全收全乱）
      const item = e.target.closest('.sb-ol-item');
      if (item && !e.target.closest('.sb-ol-arrow')) this.jumpToHeading(item.dataset.text);
    });
  }

  parseHeadings(text) {
    const out = [];
    let inCode = false;
    for (const line of String(text || '').split('\n')) {
      if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
      if (inCode) continue;
      const m = /^(#{1,6})\s+(.+)$/.exec(line);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`~]/g, '').trim() });
    }
    return out;
  }

  refreshOutline(filter = '') {
    const hs = this.activeHeadings() || [];
    const items = filter ? hs.filter(h => h.text.toLowerCase().includes(filter.toLowerCase())) : hs;
    if (!items.length) {
      this.outlineList.innerHTML = `<div class="sb-empty">${hs === null ? '在大纲页查看当前文档的标题结构——打开一个 Markdown 文档' : '（无标题或全部被过滤）'}</div>`;
      return;
    }
    // 树形缩进 + 父子可折叠（有子级的显示箭头与计数）
    const html = [];
    const stack = [];
    for (let i = 0; i < items.length; i++) {
      const h = items[i];
      let children = 0;
      for (let j = i + 1; j < items.length && items[j].level > h.level; j++) children++;
      const pad = (h.level - 1) * 14;
      html.push(`<div class="sb-ol-node" style="padding-left:${pad + 6}px">
        <span class="sb-ol-item" data-text="${h.text.replace(/"/g, '&quot;')}">
          ${children ? `<i class="sb-ol-arrow">▾</i>` : '<i class="sb-ol-arrow sb-ol-leaf"></i>'}
          <em class="sb-ol-lv">H${h.level}</em> ${h.text}
          ${children ? `<span class="sb-ol-count">${children}</span>` : ''}
        </span></div>`);
    }
    this.outlineList.innerHTML = html.join('');
    // 折叠态：父级收起时隐藏后代（用 max-level 标记实现）
    const setNodeClosed = (node, close) => {
      node.classList.toggle('closed', close);
      const myLv = +node.querySelector('.sb-ol-lv').textContent.slice(1);
      let sib = node.nextElementSibling;
      while (sib) {
        const lv = +sib.querySelector('.sb-ol-lv').textContent.slice(1);
        if (lv <= myLv) break;
        sib.style.display = close ? 'none' : '';
        sib = sib.nextElementSibling;
      }
    };
    this._olSetClosed = setNodeClosed;
    this.outlineList.querySelectorAll('.sb-ol-node').forEach((node) => {
      node.querySelector('.sb-ol-arrow').addEventListener('click', (e) => {
        e.stopPropagation();
        setNodeClosed(node, !node.classList.contains('closed'));
      });
    });
  }

  jumpToHeading(text) {
    const ctl = window.__activeMarkdownCtl;
    if (!ctl?.view) return;
    const { state } = ctl.view;
    let pos = 0;
    state.doc.descendants((node, p) => {
      if (pos) return false;
      if (/^heading/.test(node.type.name) && node.textContent.replace(/[*_`~]/g, '').trim() === text) pos = p;
    });
    if (pos) {
      ctl.view.dispatch(state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(pos))).scrollIntoView());
      ctl.view.focus();
    }
  }

  // ==================== 书签面板（文件级全局书签） ====================
  buildMarks() {
    const el = this.panels.marks;
    el.innerHTML = `
      <div class="sb-tool">
        <button class="sb-tbtn sb-wide" data-a="mark-current">${iconHtml('🔖')} 把当前文件加入书签</button>
      </div>
      <div class="sb-list sb-marks"></div>`;
    this.marksList = el.querySelector('.sb-marks');
    el.querySelector('[data-a=mark-current]').addEventListener('click', async () => {
      const tab = this.shell.tabs?.active;
      if (!tab?.filePath) { toast('先保存这个文件（Ctrl+S），再把它加入书签'); return; }
      const all = await this.getMarks();
      if (all.some(m => m.path === tab.filePath)) { toast('已在书签里'); return; }
      all.unshift({ path: tab.filePath, title: tab.title, at: Date.now() });
      await this.saveMarks(all);
      this.refreshMarks();
      toast('已加入书签');
    });
    this.marksList.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        const all = await this.getMarks();
        all.splice(+del.dataset.del, 1);
        await this.saveMarks(all);
        this.refreshMarks();
        return;
      }
      const item = e.target.closest('.sb-item');
      if (item?.dataset.path) this.shell.openFile(item.dataset.path);
    });
  }

  async getMarks() {
    return (await window.mazz.invoke('settings:get', { key: MARKS_KEY }).catch(() => [])) || [];
  }
  async saveMarks(v) { await window.mazz.invoke('settings:set', { key: MARKS_KEY, value: v }); }

  async refreshMarks() {
    const all = await this.getMarks();
    this.marksList.innerHTML = all.length
      ? all.map((m, i) => `<div class="sb-item" data-path="${m.path}">${iconHtml('🔖')}<span class="sb-item-t">${m.title || m.path.split(/[\\/]/).pop()}</span><span class="sb-item-del" data-del="${i}" title="移除">✕</span></div>`).join('')
      : '<div class="sb-empty">未找到相关内容——把常用文件加入书签，一键直达</div>';
  }

  // ==================== 标签面板（#标签 聚合） ====================
  buildTags() {
    const el = this.panels.tags;
    el.innerHTML = `
      <div class="sb-tool">
        <button class="sb-tbtn" data-a="rescan" title="重新扫描">${iconHtml('⟳')}</button>
        <span class="sb-tool-note">扫描工作区 md 文档中的 #标签</span>
      </div>
      <div class="sb-list sb-tags"></div>`;
    this.tagsList = el.querySelector('.sb-tags');
    el.querySelector('[data-a=rescan]').addEventListener('click', () => this.refreshTags(true));
    this.tagsList.addEventListener('click', (e) => {
      const f = e.target.closest('.sb-tag-file');
      if (f?.dataset.path) this.shell.openFile(f.dataset.path);
    });
  }

  async refreshTags(force = false) {
    if (this._tagCache && !force) { this.renderTags(this._tagCache); return; }
    this.tagsList.innerHTML = '<div class="sb-empty">扫描中…</div>';
    const ws = await this.shell.workspace || await this.fileTree.getWorkspace();
    const map = new Map(); // tag -> Set<path>
    const walk = async (dir) => {
      const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
      for (const e of entries) {
        if (e.isDir) await walk(e.path);
        else if (/\.(md|markdown|mazz|txt)$/i.test(e.name)) {
          const text = await window.mazz.invoke('fs:readFile', { path: e.path }).catch(() => '');
          for (const m of String(text).matchAll(/(?:^|\s)#([^\s#.,，。！？!?:;；]{1,20})/g)) {
            if (!map.has(m[1])) map.set(m[1], new Set());
            map.get(m[1]).add(e.path);
          }
        }
      }
    };
    await walk(ws);
    this._tagCache = map;
    this.renderTags(map);
  }

  renderTags(map) {
    if (!map.size) { this.tagsList.innerHTML = '<div class="sb-empty">未找到相关内容——在文档里写 #标签 试试</div>'; return; }
    const sorted = [...map.entries()].sort((a, b) => b[1].size - a[1].size);
    this.tagsList.innerHTML = sorted.map(([tag, files]) => `
      <div class="sb-tag-group">
        <div class="sb-tag-head">${iconHtml('🏷')} ${tag} <span class="sb-ol-count">${files.size}</span></div>
        ${[...files].map(f => `<div class="sb-item sb-tag-file" data-path="${f}"><span class="sb-item-t">${f.split(/[\\/]/).pop()}</span></div>`).join('')}
      </div>`).join('');
  }

  // ==================== 反链面板 ====================
  buildBacklinks() {
    const el = this.panels.backlinks;
    el.innerHTML = `
      <div class="sb-tool"><span class="sb-tool-note sb-back-target"></span></div>
      <div class="sb-sec-title">反向链接</div>
      <div class="sb-list sb-back-links"></div>
      <div class="sb-sec-title">提及</div>
      <div class="sb-list sb-back-mentions"></div>`;
    this.backLinksEl = el.querySelector('.sb-back-links');
    this.backMentionsEl = el.querySelector('.sb-back-mentions');
    this.backTargetEl = el.querySelector('.sb-back-target');
    el.addEventListener('click', (e) => {
      const item = e.target.closest('.sb-item');
      if (item?.dataset.path) this.shell.openFile(item.dataset.path);
    });
  }

  async refreshBacklinks() {
    const tab = this.shell.tabs?.active;
    const name = tab?.filePath ? tab.filePath.split(/[\\/]/).pop().replace(/\.(md|markdown|mazz|txt)$/i, '') : (tab?.title || '').replace(/\.(md|markdown|mazz|txt)$/i, '');
    this.backTargetEl.textContent = name ? `当前：${name}` : '（打开一个文档查看谁链接到它）';
    if (!name) {
      this.backLinksEl.innerHTML = '<div class="sb-empty">未找到相关内容</div>';
      this.backMentionsEl.innerHTML = '';
      return;
    }
    const ws = await this.shell.workspace || await this.fileTree.getWorkspace();
    const links = [], mentions = [];
    const self = tab?.filePath || '';
    const walk = async (dir) => {
      const entries = await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
      for (const e of entries) {
        if (e.isDir) await walk(e.path);
        else if (/\.(md|markdown|mazz|txt)$/i.test(e.name) && e.path !== self) {
          const text = await window.mazz.invoke('fs:readFile', { path: e.path }).catch(() => '');
          if (new RegExp('\\[\\[' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\|[^\\]]*)?\\]\\]').test(text)) links.push(e.path);
          else if (text.includes(name)) mentions.push(e.path);
        }
      }
    };
    await walk(ws);
    const row = (p) => `<div class="sb-item" data-path="${p}">${iconHtml('📄')}<span class="sb-item-t">${p.split(/[\\/]/).pop()}</span></div>`;
    this.backLinksEl.innerHTML = links.length ? links.map(row).join('') : '<div class="sb-empty">未找到相关内容</div>';
    this.backMentionsEl.innerHTML = mentions.length ? mentions.map(row).join('') : '<div class="sb-empty">（无提及）</div>';
  }
}
