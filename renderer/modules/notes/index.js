// renderer/modules/notes/index.js —— 笔记管理：[[双链]] 笔记库 + 反向链接 + 关系图谱 + 每日笔记
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';
import markdownModule from '../markdown/index.js';
import * as lib from './library.js';
import { GraphView } from './graph.js';

const MODULE = 'notes';
const instances = new Map();
let current = null;
let hookInstalled = false;

const DAILY_DIR = '每日笔记';

function dateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function createNotes(container) {
  const root = document.createElement('div');
  root.className = 'notes-root';
  root.innerHTML = `
    <div class="notes-main">
      <div class="notes-side">
        <div class="notes-side-head">
          <input class="notes-filter" placeholder="筛选笔记…" spellcheck="false">
          <button class="rb-btn" data-a="refresh" title="重建笔记索引" style="min-width:30px">↻</button>
        </div>
        <div class="notes-list"></div>
      </div>
      <div class="notes-editor">
        <div class="notes-ed-host" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
        <div class="notes-backlinks" style="display:none"><h4>反向链接</h4><div class="bl-list"></div></div>
      </div>
      <div class="notes-graph" style="display:none"><canvas></canvas>
        <div class="notes-graph-legend">滚轮缩放 · 拖拽平移 · 点击节点打开笔记</div>
      </div>
    </div>`;
  container.appendChild(root);

  const edHost = root.querySelector('.notes-ed-host');
  const listEl = root.querySelector('.notes-list');
  const filterEl = root.querySelector('.notes-filter');
  const blWrap = root.querySelector('.notes-backlinks');
  const blList = root.querySelector('.bl-list');
  const graphWrap = root.querySelector('.notes-graph');

  // 嵌入 markdown 编辑器作为笔记编辑内核
  const edState = markdownModule.create(edHost);

  const ctl = {
    root, container, edState,
    currentPath: null,
    currentName: '',
    mode: 'editor', // 'editor' | 'graph'
    dirty: false,
    lastContent: markdownModule.getContent(edState),
    graph: null,
  };

  async function saveNow() {
    if (!ctl.dirty || !ctl.currentPath) return;
    ctl.dirty = false;
    const content = markdownModule.getContent(edState);
    try {
      await window.mazz.invoke('fs:writeFile', { path: ctl.currentPath, content });
      lib.invalidate();
      ctl.blTimer && clearTimeout(ctl.blTimer);
      ctl.blTimer = setTimeout(renderBacklinks, 800); // 保存后刷新反链
    } catch (e) { toast('笔记保存失败：' + (e.message || e)); }
  }

  // 自动保存：1s 轮询内容变化，静默 1.5s 后落盘（Obsidian 式）
  ctl.pollTimer = setInterval(() => {
    if (!document.body.contains(root)) { clearInterval(ctl.pollTimer); return; }
    const c = markdownModule.getContent(edState);
    if (c !== ctl.lastContent) {
      ctl.lastContent = c;
      ctl.dirty = true;
      clearTimeout(ctl.saveTimer);
      ctl.saveTimer = setTimeout(saveNow, 1500);
    }
  }, 1000);

  async function openNote(path) {
    let content = '';
    try { content = (await window.mazz.invoke('fs:readFile', { path })) || ''; }
    catch { toast('打不开笔记：' + path); return; }
    if (ctl.dirty) await saveNow();
    ctl.currentPath = path;
    ctl.currentName = path.replace(/[\\/]/g, '/').split('/').pop().replace(/\.md$/i, '');
    markdownModule.setContent(content, edState);
    ctl.lastContent = markdownModule.getContent(edState);
    ctl.dirty = false;
    window.MazzHost?.setTabTitle(container, '📓 ' + ctl.currentName);
    setMode('editor');
    renderList();
    renderBacklinks();
  }

  async function openDaily() {
    const ws = await window.mazz.invoke('workspace:get');
    const stamp = dateStamp();
    const path = `${ws}/${DAILY_DIR}/${stamp}.md`;
    // 用 stat 探测存在性（readFile 探测会把预期内 ENOENT 刷进主进程日志）
    const st = await window.mazz.invoke('fs:stat', { path }).catch(() => null);
    const exists = !!st?.exists;
    if (!exists) {
      const week = WEEK[new Date().getDay()];
      await window.mazz.invoke('fs:writeFile', { path, content: `# ${stamp} 周${week}\n\n- [ ] \n` });
      lib.invalidate();
    }
    await openNote(path);
  }

  async function renderList() {
    const data = await lib.scanLibrary();
    const filter = filterEl.value.trim().toLowerCase();
    const items = data.entries
      .filter(e => !filter || e.name.toLowerCase().includes(filter))
      .sort((a, b) => b.path.localeCompare(a.path));
    const daily = items.filter(e => e.path.includes(DAILY_DIR));
    const others = items.filter(e => !e.path.includes(DAILY_DIR));
    const itemHtml = (e) => `
      <div class="notes-item${e.path === ctl.currentPath ? ' on' : ''}" data-path="${e.path.replace(/"/g, '&quot;')}" title="${e.path.replace(/"/g, '&quot;')}">
        <span class="n-name">${e.path.includes(DAILY_DIR) ? '📅 ' : '📄 '}${e.name}</span>
      </div>`;
    listEl.innerHTML =
      (daily.length ? `<div class="notes-sect">每日笔记</div>` + daily.map(itemHtml).join('') : '')
      + (others.length ? `<div class="notes-sect">全部笔记（${others.length}）</div>` + others.map(itemHtml).join('') : '')
      + (!items.length ? '<div class="notes-sect">（无匹配笔记）</div>' : '');
    listEl.querySelectorAll('.notes-item').forEach(el =>
      el.addEventListener('click', () => openNote(el.dataset.path)));
  }

  async function renderBacklinks() {
    if (!ctl.currentName) { blWrap.style.display = 'none'; return; }
    const list = (await lib.getBacklinks(ctl.currentName)).filter(x => x.path !== ctl.currentPath);
    blWrap.style.display = 'block';
    blList.innerHTML = list.length
      ? list.map(x => `<div class="notes-bl-item" data-path="${x.path.replace(/"/g, '&quot;')}">← ${x.name}</div>`).join('')
      : '<div class="notes-bl-ctx">（暂无其他笔记链接到这里）</div>';
    blList.querySelectorAll('.notes-bl-item').forEach(el =>
      el.addEventListener('click', () => openNote(el.dataset.path)));
  }

  function setMode(mode) {
    ctl.mode = mode;
    const isGraph = mode === 'graph';
    root.querySelector('.notes-editor').style.display = isGraph ? 'none' : 'flex';
    graphWrap.style.display = isGraph ? 'block' : 'none';
    if (isGraph) renderGraph();
  }

  async function renderGraph() {
    const data = await lib.scanLibrary();
    if (!ctl.graph) ctl.graph = new GraphView(graphWrap, { onOpen: (p) => openNote(p) });
    // 等布局显示后再量尺寸
    requestAnimationFrame(() => {
      ctl.graph._resize();
      ctl.graph.setData(data.entries, ctl.currentPath);
    });
  }

  // 事件
  filterEl.addEventListener('input', () => renderList());
  root.querySelector('[data-a=refresh]').addEventListener('click', async () => {
    await lib.scanLibrary({ force: true });
    renderList(); renderBacklinks();
    if (ctl.mode === 'graph') renderGraph();
    toast('笔记索引已重建');
  });
  root.addEventListener('focusin', (e) => {
    if (current !== ctl && root.contains(e.target)) { current = ctl; contextKeys.set('module', MODULE); }
  });

  ctl.openNote = openNote;
  ctl.openDaily = openDaily;
  ctl.renderList = renderList;
  ctl.renderBacklinks = renderBacklinks;
  ctl.setMode = setMode;
  ctl.refreshLibrary = async () => { await lib.scanLibrary({ force: true }); renderList(); renderBacklinks(); if (ctl.mode === 'graph') renderGraph(); };
  ctl.saveNow = saveNow;

  // 初始化：装全局钩子 + 扫库 + 默认开今日笔记（若存在笔记）或空态
  if (!hookInstalled) { hookInstalled = true; lib.installGlobalHook(); }
  lib.scanLibrary().then(() => {
    renderList();
    if (!ctl.currentPath) openDaily();
  });

  return ctl;
}

export default {
  displayName: '笔记',
  icon: '📓',
  // 测试调试面
  _forTests: { instances },

  create(container) {
    const ctl = createNotes(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return JSON.stringify({ mark: 'mazz-notes-v1', path: ctl?.currentPath || null });
  },
  /** 按扩展名导出：.md/.txt → 当前笔记正文；其余回落 getContent */
  async exportAs(ext, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return null;
    if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
      return { text: markdownModule.getContent(ctl.edState) };
    }
    return null;
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      if (obj?.path) ctl.openNote(obj.path);
      else ctl.openDaily();
    } catch { ctl.openDaily(); }
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    ctl?.openDaily();
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    if (!ctl) return 0;
    return markdownModule.getCharCount?.(ctl.edState) ?? 0;
  },
  getCursorPos(state) { return '笔记'; },

  toolbarHTML: `
    <div class="rb-group" data-label="笔记">
      <button class="rb-btn" data-command="notes.daily"><i class="ico">📅</i><span>每日笔记</span></button>
      <button class="rb-btn" data-command="notes.toggleGraph"><i class="ico">🕸</i><span>图谱</span></button>
      <button class="rb-btn" data-command="notes.refresh"><i class="ico">↻</i><span>重建索引</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'notes.daily', title: '打开每日笔记', group: '笔记',
        run: () => current?.openDaily() },
      { id: 'notes.toggleGraph', title: '切换图谱/编辑视图', group: '笔记',
        run: () => current?.setMode(current.mode === 'graph' ? 'editor' : 'graph') },
      { id: 'notes.refresh', title: '重建笔记索引', group: '笔记',
        run: () => current?.refreshLibrary() },
      { id: 'notes.save', title: '立即保存笔记', group: '笔记',
        run: () => current?.saveNow() },
    ],
    keybindings: [],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
