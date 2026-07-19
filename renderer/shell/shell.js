// renderer/shell/shell.js —— 外壳总装配：一切操作皆命令的调度中枢
import { bus } from '../core/events.js';
import { commands } from '../core/command-registry.js';
import { keymap } from '../core/keymap-service.js';
import { menus } from '../core/menu-service.js';
import { contextKeys } from '../core/contextkey-service.js';
import { palette, registerCommandSource } from '../core/command-palette.js';
import { modules } from '../core/module-registry.js';
import { snapshots } from '../core/snapshot-service.js';
import { createTitlebar } from './titlebar.js';
import { Ribbon } from './ribbon.js';
import { Tabs } from './tabs.js';
import { PaneTree } from './panes.js';
import { FileTree } from './file-tree.js';
import { SidebarCtl } from './sidebar-ctl.js';
import { t, onLanguageChange } from '../i18n/index.js';
import { StatusBar } from './statusbar.js';

const CODE_SAMPLE = `// Mazz Editor · 编程内核
// F5 调试 · Ctrl+\` 终端 · Ctrl+Enter 运行选区 · F12 跳定义 · Shift+F12 引用
const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));

for (let i = 0; i < 10; i++) {
  console.log('fib(' + i + ') = ' + fib(i));
}
`;
const THEMES = [
  { id: 'paper', name: '纸白' }, { id: 'ink', name: '墨黑' }, { id: 'indigo', name: '靛夜' },
  { id: 'moss', name: '苔绿' }, { id: 'sand', name: '暖沙' }, { id: 'construct', name: '构成' },
  { id: 'custom', name: '图片自定义' },
];
const EXT_MODULE = {
  md: 'markdown', markdown: 'markdown', mazz: 'markdown', txt: 'text',
  csv: 'sheet', mazzsheet: 'sheet', tsv: 'sheet',
  xlsx: 'sheet', // 二进制通道
  docx: 'markdown', // 二进制通道 → mammoth 导入
  mazzslide: 'slide',
  mindmap: 'mindmap', mazzdraw: 'draw',
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  json: 'code', css: 'code', html: 'code', py: 'code', sh: 'code',
  yml: 'code', yaml: 'code', xml: 'code',
};
const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescriptreact', jsx: 'javascriptreact',
  json: 'json', css: 'css', html: 'html', py: 'python', sh: 'shell', yml: 'yaml', yaml: 'yaml', xml: 'xml',
};

function defaultExt(moduleId) {
  return { text: '.txt', mindmap: '.mindmap', draw: '.mazzdraw' }[moduleId] || '.md';
}

/** 保存格式目录：各模块的可选格式（第一项 = 默认格式；另存为对话框全格式下拉） */
const SAVE_FORMATS = {
  markdown: [['Markdown 文档', ['md', 'markdown']], ['Word 文档', ['docx']], ['HTML 网页', ['html']], ['纯文本', ['txt']]],
  text: [['纯文本', ['txt']], ['Markdown 文档', ['md']]],
  sheet: [['Mazz 表格', ['mazzsheet']], ['Excel 工作簿', ['xlsx']], ['CSV 逗号分隔', ['csv']], ['TSV 制表分隔', ['tsv']]],
  slide: [['Mazz 演示', ['mazzslide']], ['PowerPoint 演示文稿', ['pptx']]],
  mindmap: [['思维导图', ['mindmap']], ['Markdown 大纲', ['md']], ['纯文本大纲', ['txt']]],
  draw: [['画板文档', ['mazzdraw']], ['PNG 图片', ['png']]],
  notes: [['Markdown 笔记', ['md']], ['纯文本', ['txt']]],
  math: [['纯文本', ['txt']], ['Markdown', ['md']]],
};
const CODE_EXTS = ['js', 'ts', 'py', 'css', 'html', 'json', 'sh', 'xml', 'yml', 'txt'];

export function saveFiltersFor(inst, tabTitle = '') {
  let formats;
  if (inst.name === 'code') {
    // 从标签标题取当前扩展名（inst.state 只有 container，无 title）
    const cur = ((tabTitle || '').match(/\.([a-z0-9]+)$/i)?.[1] || 'js').toLowerCase();
    const exts = [cur, ...CODE_EXTS.filter(e => e !== cur)];
    formats = exts.map(e => [`${e.toUpperCase()} 文件`, [e]]);
  } else {
    formats = SAVE_FORMATS[inst.name] || [['文档', [defaultExt(inst.name).slice(1)]]];
  }
  return [...formats.map(([name, extensions]) => ({ name, extensions })), { name: '所有文件', extensions: ['*'] }];
}
function safeGet(fn) { try { return fn(); } catch { return null; } }

export class Shell {
  constructor(root) {
    this.root = root;
    this.workspace = null;
    this.zoom = 1;
    this.containerTab = new WeakMap(); // container -> tabId

    // —— DOM 骨架 ——
    this.titlebar = createTitlebar(root);
    this.ribbon = new Ribbon(root);
    const ws = document.createElement('div');
    ws.className = 'workspace';
    ws.innerHTML = `<div class="sidebar"></div>
      <div class="editor-host"><div class="panes"></div></div>`;
    root.appendChild(ws);
    this.statusbar = new StatusBar(root);
    this.sidebar = ws.querySelector('.sidebar');
    this.panesEl = ws.querySelector('.panes');
    this.paneTree = new PaneTree(this.panesEl);
    this.fileTree = new FileTree(this.sidebar, {
      onOpenFile: (p) => commands.execute('file.openPath', { path: p }),
      onNewFile: () => commands.execute('fileTree.newFile'),
      onNewFolder: () => commands.execute('fileTree.newFolder'),
      getWorkspace: async () => this.workspace,
    });
    this.sidebarCtl = new SidebarCtl(this.sidebar);
    this.sidebarCtl.init();
    // 语言切换：欢迎页重建（其余界面随打开/渲染时自动用新语言）
    onLanguageChange(() => {
      document.querySelector('.welcome')?.remove();
      this.showWelcome();
      this.ribbon.renderTabs();
    });
    this.showWelcome();

    // —— 模块宿主接口（模块无需感知标签系统）——
    window.MazzHost = {
      notifyChange: (container) => {
        const tabId = this.containerTab.get(container);
        if (!tabId) return;
        this.tabs.setDirty(tabId, true);
        snapshots.markDirty(tabId);
      },
      setStatus: (container, text) => {
        const tabId = this.containerTab.get(container);
        if (tabId === this.tabs.activeId) this.statusbar.set(undefined, text);
      },
      openTab: (moduleId, opts) => this.openTab(moduleId, opts),
      setTabTitle: (container, title) => {
        const tabId = this.containerTab.get(container);
        if (tabId) this.tabs.setTitle(tabId, title);
      },
      toast,
    };

    this.registerCoreCommands();
    this.registerMenusAndKeys();
    this.registerRibbonPages();
    this.wireEvents();
    registerCommandSource();
    this.registerFileSource();
  }

  /** Ribbon 静态页：文件 / 视图（按钮一律走命令注册表） */
  registerRibbonPages() {
    this.ribbon.addPage('file', '文件', () => {
      this.ribbon.group('新建', [
        { command: 'file.new', icon: '＋', label: '文档' },
        { command: 'file.newSheet', icon: '📊', label: '表格' },
        { command: 'file.newSlide', icon: '📽', label: '演示' },
        { command: 'file.newBrowser', icon: '🌐', label: '浏览器' },
        { command: 'file.newCode', icon: '💻', label: '代码' },
        { command: 'file.newMath', icon: '🧮', label: '计算' },
        { command: 'file.newNotes', icon: '📓', label: '笔记' },
        { command: 'file.newSearch', icon: '🔎', label: '全局搜索' },
        { command: 'file.newMindmap', icon: '🧠', label: '导图' },
        { command: 'file.newDraw', icon: '🎨', label: '画板' },
        { command: 'file.newLibrary', icon: '📚', label: '书库' },
        { command: 'file.newText', icon: '🄣', label: '纯文本' },
        { command: 'file.open', icon: '📂', label: '打开' },
        { command: 'file.openWorkspace', icon: '🗂', label: '工作区' },
      ]);
      this.ribbon.group('保存', [
        { command: 'file.save', icon: '💾', label: '保存' },
        { command: 'file.saveAs', icon: '⇢', label: '另存为' },
      ]);
      this.ribbon.group('输出', [
        { command: 'file.print', icon: '🖨', label: '打印' },
        { command: 'file.exportPDF', icon: '📄', label: '导出PDF' },
      ]);
    }, 10);
    this.ribbon.addPage('view', '视图', () => {
      this.ribbon.group('面板', [
        { command: 'view.toggleSidebar', icon: '🗀', label: '目录树' },
        { command: 'app.commandPalette', icon: '⌘', label: '命令面板' },
      ]);
      this.ribbon.group('界面', [
        { command: 'view.cycleTheme', icon: '🎨', label: '换主题' },
        { command: 'view.focusMode', icon: '🎯', label: '专注' },
        { command: 'view.fullScreen', icon: '⛶', label: '全屏' },
      ]);
      this.ribbon.group('缩放', [
        { command: 'view.zoomIn', icon: '＋', label: '放大' },
        { command: 'view.zoomOut', icon: '－', label: '缩小' },
        { command: 'view.zoomReset', icon: '1:1', label: '重置' },
      ]);
    }, 20);
  }

  // ==================== 窗格（分屏树） ====================
  get tabs() { return this.paneTree.tabs; }

  splitRight() { this.paneTree.splitActive('row'); }
  splitDown() { this.paneTree.splitActive('column'); }
  joinPanes() {
    if (this.paneTree.leaves().length <= 1) return;
    this.paneTree.joinAll();
    toast('已合并为单窗格');
  }

  // ==================== 启动 ====================
  async boot() {
    let theme = 'paper';
    if (window.mazz?.isElectron) {
      const dark = await window.mazz.invoke('theme:isDark');
      theme = dark ? 'ink' : 'paper';
      this.workspace = await window.mazz.invoke('workspace:get');
      await window.mazz.invoke('fs:watch', { paths: [this.workspace] });
      const saved = await window.mazz.invoke('settings:get', { key: 'theme' });
      if (saved) theme = saved;
      const sc = await window.mazz.invoke('settings:get', { key: 'spellcheckEnabled' });
      this.statusbar.setSpell(sc !== false);
    } else {
      // 浏览器预览：localStorage 虚拟工作区
      this.workspace = await window.mazz.invoke('workspace:get').catch(() => null);
      const saved = await window.mazz.invoke('settings:get', { key: 'theme' }).catch(() => null);
      if (saved) theme = saved;
      this.statusbar.setSpell(false);
    }
    this.setTheme(theme);
    await this.fileTree.refresh();
    this.syncAppMenu();
    snapshots.start();
    await this.checkRecovery();
    // 浏览器预览分窗：localStorage 交接 + 跨标签页「移回主窗口」（storage 事件）
    if (!window.mazz?.isElectron) {
      try {
        const raw = localStorage.getItem('mazz.handoff');
        if (raw) {
          localStorage.removeItem('mazz.handoff');
          contextKeys.set('windowRole', 'child');
          await this.receiveHandoff(JSON.parse(raw));
        }
      } catch {}
      window.addEventListener('storage', async (e) => {
        if (e.key === 'mazz.handoff.main' && e.newValue) {
          try {
            localStorage.removeItem('mazz.handoff.main');
            await this.receiveHandoff(JSON.parse(e.newValue));
          } catch {}
        }
      });
    }
    setInterval(() => this.pollStatus(), 600);
  }

  setTheme(id) {
    document.documentElement.dataset.theme = id;
    if (id === 'custom') {
      // 图片自定义主题：确保变量已注入（无注入则提示并退回构成）
      import('../theme-custom.js').then(async ({ restoreImageTheme }) => {
        const ok = await restoreImageTheme();
        if (!ok) {
          document.documentElement.dataset.theme = 'construct';
          toast('还没有图片自定义主题——请先在设置里「从图片生成主题」');
        }
      });
    }
    const t = THEMES.find(t => t.id === id) || THEMES[0];
    this.statusbar.setTheme(t.name);
    window.mazz?.invoke('settings:set', { key: 'theme', value: id }).catch(() => {});
  }

  // ==================== 欢迎页 ====================
  showWelcome() {
    if (document.querySelector('.welcome')) return;
    const w = document.createElement('div');
    w.className = 'welcome module-view on';
    w.innerHTML = `
      <h1>◆ <b>Mazz</b> Editor</h1>
      <div>${t('一站式超级编辑器 · 一切操作皆命令 · Ctrl+Shift+P 唤起命令面板')}</div>
      <div class="w-grid">
        <button class="w-card" data-cmd="file.new"><div class="t">＋ ${t('新建文档')}</div><div class="d">${t('Markdown 文档内核')}<br>${t('WYSIWYG 即时渲染')}</div></button>
        <button class="w-card" data-cmd="file.newSheet"><div class="t">📊 ${t('新建表格')}</div><div class="d">${t('虚拟网格 · 100+ 公式')}<br>${t('图表 / 透视 / xlsx')}</div></button>
        <button class="w-card" data-cmd="file.newSlide"><div class="t">📽 ${t('新建演示')}</div><div class="d">${t('大纲成稿 · 主题×5')}<br>${t('放映 / pptx 导出')}</div></button>
        <button class="w-card" data-cmd="file.newBrowser"><div class="t">🌐 ${t('隐私浏览器')}</div><div class="d">${t('独立会话 · 反追踪')}<br>${t('SearXNG 搜索内核')}</div></button>
        <button class="w-card" data-cmd="file.newCode"><div class="t">💻 ${t('新建代码')}</div><div class="d">${t('Monaco 智能 · F5 调试')}<br>${t('集成终端')}</div></button>
        <button class="w-card" data-cmd="file.newMath"><div class="t">🧮 ${t('计算 REPL')}</div><div class="d">${t('Python+JS 双后端')}<br>${t('calc 算块')}</div></button>
        <button class="w-card" data-cmd="file.newNotes"><div class="t">📓 ${t('笔记库')}</div><div class="d">${t('[[双链]] · 反向链接')}<br>${t('图谱 · 每日笔记')}</div></button>
        <button class="w-card" data-cmd="file.newSearch"><div class="t">🔎 ${t('全局搜索')}</div><div class="d">${t('全文索引 · 正则')}<br>${t('类型过滤 · 直达命中')}</div></button>
        <button class="w-card" data-cmd="file.newMindmap"><div class="t">🧠 ${t('思维导图')}</div><div class="d">${t('Tab 快建节点')}<br>${t('拖拽重排 · PNG/大纲导出')}</div></button>
        <button class="w-card" data-cmd="file.newDraw"><div class="t">🎨 ${t('画板')}</div><div class="d">${t('压感矢量笔 · 图层')}<br>${t('帧/洋葱皮 · PNG 序列')}</div></button>
        <button class="w-card" data-cmd="file.newLibrary"><div class="t">📚 ${t('书库')}</div><div class="d">${t('epub 电子书 · cbz 漫画')}<br>${t('进度记忆 · 导出笔记')}</div></button>
        <button class="w-card" data-cmd="file.newText"><div class="t">🄣 ${t('新建纯文本')}</div><div class="d">${t('即开即用')}<br>${t('TXT 读写')}</div></button>
        <button class="w-card" data-cmd="file.open"><div class="t">📂 ${t('打开文件')}</div><div class="d">.md / .txt / .csv / .xlsx<br>${t('双击关联直达')}</div></button>
        <button class="w-card" data-cmd="help.open"><div class="t">❓ ${t('使用指南')}</div><div class="d">${t('喂饭级帮助文档')}<br>${t('功能全解 · F1 直达')}</div></button>
        <button class="w-card" data-cmd="app.openSettings"><div class="t">⚙ ${t('设置')}</div><div class="d">${t('主题 / 关闭行为')}<br>${t('拼写 / 快捷笔记')}</div></button>
      </div>
      <div style="margin-top:6px;font-size:11.5px">${t('托盘常驻 Ctrl+Alt+M 唤起 · Ctrl+Alt+N 快速笔记')}</div>`;
    w.querySelectorAll('[data-cmd]').forEach(b =>
      b.addEventListener('click', () => commands.execute(b.dataset.cmd)));
    this.tabs.area.appendChild(w);
    this.welcomeEl = w;
    // 欢迎页显示时隐藏窗格占位文字（防重叠）
    for (const leaf of this.paneTree.leaves()) {
      const ph = leaf.el.querySelector('.pane-empty');
      if (ph) ph.style.display = 'none';
    }
  }
  hideWelcome() { this.welcomeEl?.remove(); this.welcomeEl = null; }

  // ==================== 标签 ↔ 模块 ====================
  openTab(moduleId, { title, filePath = null, content = null }) {
    this.hideWelcome();
    const tab = this.tabs.add({ title, moduleId, filePath });
    // 空内容视为 null：让模块用自身默认初始内容（如演示模板），不触发 setContent('') 清空
    const inst = modules.attach(tab.id, moduleId, tab.view, content ? content : null);
    this.containerTab.set(tab.view, tab.id);
    tab.forceClose = false;
    snapshots.track(tab.id, () => ({
      filePath, moduleId,
      content: safeGet(() => inst.def.getContent(inst.state)),
    }));
    this.rebuildModuleRibbon(tab);
    this.paneTree.paneOfTab(tab.id)?.refreshEmpty();
    return { tab, inst };
  }

  /** 上下文 Ribbon：按当前模块重建「开始」页（契约 toolbarHTML/bindToolbar） */
  rebuildModuleRibbon(tab) {
    this.ribbon.removePage('module');
    const inst = tab && modules.instances.get(tab.id);
    if (!inst) return;
    const def = inst.def;
    if (def.toolbarHTML) {
      this.ribbon.addPage('module', `${def.displayName} · 开始`, (panel) => {
        panel.innerHTML = def.toolbarHTML;
        def.bindToolbar?.(panel);
      }, 0);
    }
    this.ribbon.renderTabs();
  }

  async openFile(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const moduleId = EXT_MODULE[ext] || 'text';
    let content = '';
    try {
      if (ext === 'xlsx' || ext === 'docx') {
        const b64 = await window.mazz.invoke('fs:readFileBase64', { path: filePath });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        content = ext === 'xlsx' ? { __xlsx: bytes.buffer } : { __docx: bytes.buffer };
      } else {
        content = await window.mazz.invoke('fs:readFile', { path: filePath });
      }
    }
    catch (e) { toast(`打开失败：${e.message}`); return; }
    const name = filePath.split(/[\\/]/).pop();
    const { tab, inst } = this.openTab(moduleId, { title: name, filePath, content });
    if (moduleId === 'code' && LANG_BY_EXT[ext] && inst?.def.setLanguage) {
      inst.def.setLanguage(LANG_BY_EXT[ext], inst.state);
    }
    tab.forceClose = false;
    this.tabs.setDirty(tab.id, false);
    await window.mazz?.invoke('recent:add', { path: filePath });
    await window.mazz?.invoke('fs:watch', { paths: [filePath] });
    this.fileTree.markActive(filePath);
    this.syncTitle();
  }

  async saveTab(tab, { saveAs = false } = {}) {
    const inst = modules.instances.get(tab.id);
    if (!inst) return false;
    let target = tab.filePath;
    if (saveAs || !target) {
      target = await window.mazz.invoke('dialog:saveFile', {
        defaultPath: (tab.filePath || tab.title).replace(/\.[^.]*$/, '') + defaultExt(inst.name),
        filters: saveFiltersFor(inst, tab.title),
      });
      if (!target) return false;
      tab.filePath = target;
      this.tabs.setTitle(tab.id, target.split(/[\\/]/).pop());
    }
    // 按目标扩展名转换内容（exportAs 契约；无则回落 getContent 原文）
    const ext = (target.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
    try {
      let wrote = false;
      if (typeof inst.def.exportAs === 'function') {
        const out = await inst.def.exportAs(ext, inst.state);
        if (out?.base64 != null) {
          await window.mazz.invoke('fs:writeFileBase64', { path: target, base64: out.base64 });
          wrote = true;
        } else if (out?.text != null) {
          await window.mazz.invoke('fs:writeFile', { path: target, content: out.text });
          wrote = true;
        }
      }
      if (!wrote) {
        const content = inst.def.getContent(inst.state);
        await window.mazz.invoke('fs:writeFile', { path: target, content });
      }
    } catch (e) { toast(`保存失败：${e.message}`); return false; }
    this.tabs.setDirty(tab.id, false);
    snapshots.untrack(tab.id);
    snapshots.track(tab.id, () => ({ filePath: target, moduleId: inst.name, content: safeGet(() => inst.def.getContent(inst.state)) }));
    await window.mazz?.invoke('recent:add', { path: target });
    this.syncTitle();
    toast(`已保存 ${target.split(/[\\/]/).pop()}`);
    return true;
  }

  async closeTabFlow(id) {
    // 先定位所属窗格（非激活窗格的 ✕ 也能正常关闭并触发收缩）
    const pane = this.paneTree.paneOfTab(id);
    const tabsObj = pane ? pane.tabs : this.tabs;
    const tab = tabsObj.get(id);
    if (!tab) return;
    if (tab.dirty && window.mazz?.isElectron) {
      const r = await window.mazz.invoke('dialog:confirm', {
        title: '未保存的更改', message: `“${tab.title}”有未保存的更改。`,
        detail: '关闭前是否保存？', buttons: ['保存', '不保存', '取消'],
      });
      if (r === 2) return;
      if (r === 0) { const ok = await this.saveTab(tab); if (!ok) return; }
    }
    tab.forceClose = true;
    modules.detach(id);
    snapshots.untrack(id);
    await tabsObj.close(id, { force: true });
    // 窗格最后一个标签关闭 → 自动收缩窗格（根窗格除外）
    if (pane) this.paneTree.onLeafEmpty(pane);
    if (!this.paneTree.leaves().some(l => l.tabs.tabs.length)) this.showWelcome();
    this.syncTitle();
  }

  syncTitle() {
    const t = this.tabs.active;
    this.titlebar.setTitle(t ? `${t.title}${t.dirty ? ' ●' : ''} — Mazz Editor` : 'Mazz Editor');
  }

  pollStatus() {
    const tab = this.tabs.active;
    if (!tab) { this.statusbar.set('—', '', ''); return; }
    const inst = modules.instances.get(tab.id);
    if (!inst) return;
    const count = safeGet(() => inst.def.getCharCount?.(inst.state));
    const pos = safeGet(() => inst.def.getCursorPos?.(inst.state));
    this.statusbar.set(`${inst.def.icon} ${inst.def.displayName}`,
      count != null ? `${count} 字符` : '', pos || '');
  }

  // ==================== 核心命令 ====================
  registerCoreCommands() {
    const R = (id, def) => commands.register(id, { ...def, source: 'shell' });

    // —— 文件 ——
    R('file.new', { title: '新建文档', icon: '＋', group: '文件', run: () => this.openTab('markdown', { title: '未命名.md', content: '' }) });
    R('file.newText', { title: '新建纯文本', icon: '🄣', group: '文件', run: () => this.openTab('text', { title: '未命名.txt', content: '' }) });
    R('file.newSheet', { title: '新建表格', icon: '📊', group: '文件', run: () => this.openTab('sheet', { title: '未命名.mazzsheet', content: '' }) });
    R('file.newSlide', { title: '新建演示', icon: '📽', group: '文件', run: () => this.openTab('slide', { title: '未命名.mazzslide', content: '' }) });
    R('file.newBrowser', { title: '打开浏览器', icon: '🌐', group: '文件', run: () => this.openTab('browser', { title: '隐私浏览器', content: '' }) });
    R('file.newCode', { title: '新建代码文件', icon: '💻', group: '文件', run: () => this.openTab('code', { title: '未命名.js', content: CODE_SAMPLE }) });
    R('file.newMath', { title: '打开计算器', icon: '🧮', group: '文件', run: () => this.openTab('math', { title: '计算 REPL', content: '' }) });
    R('file.newNotes', { title: '打开笔记库', icon: '📓', group: '文件', run: () => this.openTab('notes', { title: '笔记', content: '' }) });
    R('file.newSearch', { title: '全局搜索', icon: '🔎', group: '文件', run: () => this.openTab('search', { title: '全局搜索', content: '' }) });
    R('file.newMindmap', { title: '新建思维导图', icon: '🧠', group: '文件', run: () => this.openTab('mindmap', { title: '未命名.mindmap', content: '' }) });
    R('file.newDraw', { title: '新建画板', icon: '🎨', group: '文件', run: () => this.openTab('draw', { title: '未命名.mazzdraw', content: '' }) });
    R('file.newLibrary', { title: '打开书库', icon: '📚', group: '文件', run: () => this.openTab('library', { title: '书库', content: '' }) });
    R('file.open', {
      title: '打开文件…', icon: '📂', group: '文件', run: async () => {
        const p = await window.mazz.invoke('dialog:openFile', {});
        if (p) await this.openFile(p);
      },
    });
    R('file.openPath', { title: '打开路径', run: async ({ path: p } = {}) => { if (p) await this.openFile(p); } });
    R('file.save', { title: '保存', icon: '💾', group: '文件', when: 'hasTabs', run: () => this.tabs.active && this.saveTab(this.tabs.active) });
    R('file.saveAs', { title: '另存为…', group: '文件', when: 'hasTabs', run: () => this.tabs.active && this.saveTab(this.tabs.active, { saveAs: true }) });
    R('file.closeTab', { title: '关闭当前标签', group: '文件', when: 'hasTabs', run: () => this.closeTabFlow(this.tabs.activeId) });
    R('file.print', { title: '打印…', icon: '🖨', group: '文件', when: 'hasTabs', run: () => window.mazz.invoke('print:print') });
    R('file.exportPDF', {
      title: '导出为 PDF…', group: '文件', when: 'hasTabs', run: async () => {
        const p = await window.mazz.invoke('print:toPDF', { savePath: null });
        if (p) toast(`PDF 已导出：${p}`);
      },
    });
    R('file.quickOpen', { title: '快速跳转（最近/项目文件）', icon: '⚡', group: '文件', run: () => palette.open('files') });
    R('file.openWorkspace', {
      title: '打开工作区…', group: '文件', run: async () => {
        const dir = await window.mazz.invoke('dialog:openFolder');
        if (dir) {
          await window.mazz.invoke('settings:set', { key: 'workspace', value: dir });
          this.workspace = dir;
          await window.mazz.invoke('fs:watch', { paths: [dir] });
          await this.fileTree.refresh();
          toast(`工作区已切换：${dir}`);
        }
      },
    });

    // —— 视图 ——
    R('view.toggleSidebar', { title: '切换目录树', group: '视图', run: () => this.sidebar.classList.toggle('hidden') });
    R('view.focusMode', { title: '专注模式', group: '视图', run: () => document.body.classList.toggle('focus-mode') });
    R('view.fullScreen', { title: '全屏', group: '视图', run: () => window.mazz?.invoke('window:toggleFullScreen') });
    R('view.zoomIn', { title: '放大', group: '视图', run: () => this.setZoom(this.zoom + 0.1) });
    R('view.zoomOut', { title: '缩小', group: '视图', run: () => this.setZoom(this.zoom - 0.1) });
    R('view.zoomReset', { title: '重置缩放', group: '视图', run: () => this.setZoom(1) });
    R('view.cycleTheme', {
      title: '轮换主题', icon: '🎨', group: '视图', run: async () => {
        // 「图片自定义」不参与循环（只能从图片取色进入，无变量时会卡住循环）
        const cycle = THEMES.filter(t => t.id !== 'custom');
        const curId = document.documentElement.dataset.theme;
        const cur = cycle.findIndex(t => t.id === curId);
        this.setTheme(cycle[(cur + 1) % cycle.length].id);
      },
    });
    R('view.splitRight', { title: '向右分屏', icon: '◫', group: '视图', run: () => this.splitRight() });
    R('view.splitDown', { title: '向下分屏', icon: '⬒', group: '视图', run: () => this.splitDown() });
    R('view.moveToNextPane', { title: '移动标签到下一窗格', group: '视图', when: 'hasTabs', run: () => this.paneTree.moveActiveTabToNextPane() });
    R('view.closePane', { title: '关闭当前窗格', group: '视图', when: 'hasSplit', run: () => this.paneTree.closePane(this.paneTree.active) });
    R('view.joinPanes', { title: '合并全部窗格', group: '视图', when: 'hasSplit', run: () => this.joinPanes() });

    // —— 标签 ——
    R('tab.next', { title: '下一个标签', group: '标签', run: () => this.tabs.cycle(1) });
    R('tab.prev', { title: '上一个标签', group: '标签', run: () => this.tabs.cycle(-1) });
    for (let i = 1; i <= 9; i++) {
      R(`tab.goto${i}`, { title: `跳到第 ${i} 个标签`, group: '标签', run: () => this.tabs.activateIndex(i) });
    }
    R('tab.closeOthers', { title: '关闭其他标签', group: '标签', run: () => { for (const t of [...this.tabs.tabs]) if (t.id !== this.tabs.activeId) this.closeTabFlow(t.id); } });
    R('tab.closeRight', { title: '关闭右侧标签', group: '标签', run: () => {
      const i = this.tabs.tabs.findIndex(t => t.id === this.tabs.activeId);
      for (const t of [...this.tabs.tabs.slice(i + 1)]) this.closeTabFlow(t.id);
    } });
    R('tab.closeAll', { title: '全部关闭', group: '标签', run: () => { for (const t of [...this.tabs.tabs]) this.closeTabFlow(t.id); } });
    R('tab.pin', { title: '固定/取消固定标签', group: '标签', run: () => {
      const t = this.tabs.active; if (t) { t.pinned = !t.pinned; this.tabs.render(); }
    } });
    R('tab.copyPath', { title: '复制文件路径', group: '标签', when: 'hasTabs', run: async () => {
      const t = this.tabs.active;
      if (t?.filePath) { await window.mazz.invoke('clipboard:write', { text: t.filePath }); toast('路径已复制'); }
    } });
    // 移到新窗口（也可把标签直接拖出主窗口边界）
    R('tab.moveToNewWindow', { title: '移到新窗口', icon: '🗔', group: '标签', when: 'hasTabs',
      run: (payload) => this.moveTabToNewWindow(payload?.tabId || this.tabs.activeId) });
    // 移回主窗口（子窗专属）
    R('tab.moveToMainWindow', { title: '移回主窗口', icon: '⬅', group: '标签', when: "windowRole=='child' && hasTabs",
      run: async () => {
        const tab = this.tabs.active;
        if (!tab) return;
        const inst = modules.instances.get(tab.id);
        const snapshot = {
          moduleId: tab.moduleId, title: tab.title, filePath: tab.filePath,
          content: inst ? inst.def.getContent(inst.state) : '',
        };
        const ok = await window.mazz.invoke('window:toMain', { handoff: snapshot });
        if (ok) {
          tab.forceClose = true;
          modules.detach(tab.id);
          snapshots.untrack(tab.id);
          const pane = this.paneTree.paneOfTab(tab.id);
          await (pane ? pane.tabs : this.tabs).close(tab.id, { force: true });
          if (pane) this.paneTree.onLeafEmpty(pane);
          toast(`已移回主窗口：${tab.title}`);
        }
      } });

    // —— 应用 ——
    R('app.commandPalette', { title: '命令面板', icon: '⌘', group: '应用', run: () => palette.open('commands') });
    R('app.openSettings', { title: '设置…', icon: '⚙', group: '应用', run: () => this.openSettingsModal() });
    R('app.language', { title: '界面语言设置 (Language)', icon: '🌐', group: '应用', run: () => this.openSettingsModal() });
    R('app.toggleSpellcheck', { title: '开关拼写检查', group: '应用', run: async () => {
      if (!window.mazz?.isElectron) { toast('浏览器预览模式无拼写检查服务'); return; }
      const cur = await window.mazz.invoke('settings:get', { key: 'spellcheckEnabled' });
      await window.mazz.invoke('spell:setEnabled', { enabled: !cur });
      this.statusbar.setSpell(!cur);
      toast(!cur ? '拼写检查已开启' : '拼写检查已关闭');
    } });
    R('app.shortcutSheet', { title: '快捷键速查表', group: '应用', run: () => this.openShortcutSheet() });
    R('app.about', { title: '关于 Mazz Editor', group: '应用', run: () => toast('Mazz Editor v0.1.0 · 榨干 Electron 的一站式超级编辑器（第一阶段构建）') });

    // —— 目录树命令 ——
    R('fileTree.newFile', { title: '新建文件', group: '目录树', run: () => this.newFileInTree() });
    R('fileTree.newFolder', { title: '新建文件夹', group: '目录树', run: () => this.newFolderInTree() });
    R('fileTree.open', { title: '打开', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (p) await this.openFile(p);
    } });
    R('fileTree.rename', { title: '重命名…', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (!p) return;
      const name = await inputModal('重命名', p.split(/[\\/]/).pop());
      if (!name?.trim()) return;
      const to = p.split(/[\\/]/).slice(0, -1).concat(name.trim()).join('/');
      await window.mazz.invoke('fs:rename', { from: p, to });
      await this.fileTree.refresh();
    } });
    R('fileTree.delete', { title: '删除（回收站）', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (!p) return;
      const r = await window.mazz.invoke('dialog:confirm', { title: '删除', message: `将「${p.split(/[\\/]/).pop()}」移入回收站？`, buttons: ['删除', '取消'] });
      if (r === 0) { await window.mazz.invoke('fs:delete', { path: p }); await this.fileTree.refresh(); }
    } });
    R('fileTree.copyPath', { title: '复制路径', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (p) { await window.mazz.invoke('clipboard:write', { text: p }); toast('路径已复制'); }
    } });
    R('fileTree.showInFolder', { title: '在文件夹中显示', group: '目录树', run: () => {
      const p = contextKeys.get('treePath');
      if (p) window.mazz.invoke('shell:showItemInFolder', { path: p });
    } });

    bus.on('tab:requestClose', (id) => this.closeTabFlow(id));
    bus.on('tab:dragOut', (id) => this.moveTabToNewWindow(id));
    // 全部窗格都没有标签时 → 自动归一为单窗格（欢迎页）
    bus.on('tab:empty', () => {
      if (!this.paneTree.leaves().some(l => l.tabs.tabs.length) && this.paneTree.leaves().length > 1) {
        this.paneTree.joinAll();
      }
    });
  }

  setZoom(z) {
    this.zoom = Math.min(2, Math.max(0.5, z));
    this.tabs.area.style.zoom = this.zoom;
    this.statusbar.setZoom(this.zoom);
  }

  /** 把标签移交到新窗口（快照内容 → 新窗口开同标签 → 本窗口关闭） */
  async moveTabToNewWindow(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const inst = modules.instances.get(tabId);
    const snapshot = {
      moduleId: tab.moduleId,
      title: tab.title,
      filePath: tab.filePath,
      content: inst ? inst.def.getContent(inst.state) : '',
    };
    if (snapshot.content == null) snapshot.content = '';
    try {
      await window.mazz.invoke('window:openChild', { handoff: snapshot });
      tab.forceClose = true;
      modules.detach(tabId);
      snapshots.untrack(tabId);
      const pane = this.paneTree.paneOfTab(tabId);
      await (pane ? pane.tabs : this.tabs).close(tabId, { force: true });
      if (pane) this.paneTree.onLeafEmpty(pane);
      toast(`已移到新窗口：${tab.title}`);
    } catch (e) {
      toast('分窗失败：' + e.message);
    }
  }

  /** 新窗口启动时接收交接标签 */
  async receiveHandoff(snapshot) {
    if (!snapshot?.moduleId || !modules.get(snapshot.moduleId)) return;
    this.openTab(snapshot.moduleId, {
      title: snapshot.title || '分窗标签',
      filePath: snapshot.filePath || null,
      content: snapshot.content,
    });
    if (snapshot.filePath) await window.mazz?.invoke('recent:add', { path: snapshot.filePath });
  }

  async newFileInTree() {
    const base = contextKeys.get('treeIsDir') ? contextKeys.get('treePath') : this.workspace;
    const name = await inputModal('文件名（.md/.txt）', '未命名.md');
    if (!name) return;
    const p = `${base || this.workspace}/${name}`;
    await window.mazz.invoke('fs:writeFile', { path: p, content: '' });
    await this.fileTree.refresh();
    await this.openFile(p);
  }
  async newFolderInTree() {
    const base = contextKeys.get('treeIsDir') ? contextKeys.get('treePath') : this.workspace;
    const name = await inputModal('文件夹名', '新建文件夹');
    if (!name) return;
    await window.mazz.invoke('fs:mkdir', { path: `${base || this.workspace}/${name}` });
    await this.fileTree.refresh();
  }

  // ==================== 菜单贡献 + 键位总表 ====================
  registerMenusAndKeys() {
    const K = (key, command, when) => keymap.register({ key, command, when, source: 'shell' });
    // 6.2 文件
    K('ctrl+n', 'file.new'); K('ctrl+o', 'file.open'); K('ctrl+s', 'file.save');
    K('ctrl+shift+s', 'file.saveAs'); K('ctrl+shift+o', 'file.quickOpen');
    K('ctrl+p', 'file.print'); K('ctrl+w', 'file.closeTab');
    // 6.3 编辑与导航
    K('ctrl+shift+p', 'app.commandPalette');
    K('ctrl+tab', 'tab.next'); K('ctrl+shift+tab', 'tab.prev');
    for (let i = 1; i <= 9; i++) K(`ctrl+${i}`, `tab.goto${i}`);
    // 6.5 视图与窗口
    K('f11', 'view.fullScreen'); K('ctrl+shift+f', 'view.focusMode');
    K('ctrl+=', 'view.zoomIn'); K('ctrl+-', 'view.zoomOut'); K('ctrl+0', 'view.zoomReset');
    K('ctrl+alt+t', 'view.cycleTheme'); K('ctrl+shift+e', 'view.toggleSidebar');
    K('ctrl+\\', 'view.splitRight');
    K('ctrl+alt+\\', 'view.splitDown');
    K('ctrl+alt+right', 'view.moveToNextPane');

    // 5 号上下文：标签页
    menus.contribute('tab/context', [
      { command: 'file.closeTab', group: '1_close', title: '关闭' },
      { command: 'tab.closeOthers', group: '1_close', title: '关闭其他' },
      { command: 'tab.closeRight', group: '1_close', title: '关闭右侧' },
      { command: 'tab.closeAll', group: '1_close', title: '全部关闭' },
      { command: 'tab.pin', group: '2_action', title: '固定标签' },
      { command: 'view.splitRight', title: '向右分屏', group: '2_action' },
      { command: 'view.splitDown', title: '向下分屏', group: '2_action' },
      { command: 'view.joinPanes', title: '合并全部窗格', group: '2_action', when: 'hasSplit' },
      { command: 'tab.copyPath', group: '3_path', title: '复制文件路径', when: 'hasTabs' },
      { command: 'tab.moveToNewWindow', group: '4_window', title: '移到新窗口', when: "hasTabs && windowRole!='child'" },
      { command: 'tab.moveToMainWindow', group: '4_window', title: '移回主窗口', when: "windowRole=='child' && hasTabs" },
    ]);
    // 3 号上下文：文件树·文件
    menus.contribute('fileTree/file', [
      { command: 'fileTree.open', title: '打开', group: '1_open' },
      { command: 'fileTree.rename', title: '重命名…', group: '2_file' },
      { command: 'fileTree.delete', title: '删除（回收站）', group: '2_file' },
      { command: 'fileTree.copyPath', title: '复制路径', group: '3_path' },
      { command: 'fileTree.showInFolder', title: '在文件夹中显示', group: '3_path' },
    ]);
    // 4 号上下文：文件树·文件夹
    menus.contribute('fileTree/folder', [
      { command: 'fileTree.newFile', title: '新建文件', group: '1_new' },
      { command: 'fileTree.newFolder', title: '新建文件夹', group: '1_new' },
      { command: 'fileTree.copyPath', title: '复制路径', group: '3_path' },
    ]);

    // 用户覆盖层（keybindings 经设置读取）
    window.mazz?.invoke('settings:get', { key: 'keybindings' }).then(ov => { if (ov) keymap.setOverlay(ov); }).catch(() => {});
  }

  // ==================== 命令面板：文件源 ====================
  registerFileSource() {
    palette.addProvider({
      id: 'files', label: '文件', placeholder: '输入文件名…（最近文件 + 工作区）',
      getItems: () => this.fileIndex || [],
      onPick: async (item) => { if (item.path) await this.openFile(item.path); },
    });
    this.rebuildFileIndex();
    bus.on('filetree:externallyChanged', () => this.rebuildFileIndex());
  }
  async rebuildFileIndex() {
    const items = [];
    try {
      const recent = await window.mazz.invoke('recent:list');
      for (const p of (recent || []).slice(0, 15)) {
        items.push({ label: p.split(/[\\/]/).pop(), detail: `最近 · ${p}`, path: p, icon: '🕘' });
      }
    } catch {}
    const walk = async (dir, depth) => {
      if (depth > 3) return;
      let entries = [];
      try { entries = await window.mazz.invoke('fs:listDir', { path: dir }); } catch { return; }
      for (const e of entries) {
        if (e.isDir) await walk(e.path, depth + 1);
        else if (/\.(md|markdown|txt|mazz)$/i.test(e.name)) {
          items.push({ label: e.name, detail: e.path, path: e.path, icon: '📄' });
        }
      }
    };
    if (this.workspace) await walk(this.workspace, 0);
    this.fileIndex = items;
  }

  // ==================== 事件接线 ====================
  wireEvents() {
    bus.on('tab:activate', (tab) => {
      modules.activateTab(tab.id);
      this.syncTitle();
      this.fileTree.markActive(tab.filePath);
      contextKeys.set('hasTabs', true);
      this.rebuildModuleRibbon(tab);
    });
    bus.on('tab:deactivate', (id) => modules.deactivateTab(id));
    bus.on('tab:empty', () => { contextKeys.set('hasTabs', false); contextKeys.set('module', null); this.syncTitle(); });

    if (window.mazz?.isElectron) {
      window.mazz.on('file:open', async ({ path: p }) => { await this.openFile(p); });
      window.mazz.on('command:invoke', ({ id, payload }) => commands.execute(id, payload));
      window.mazz.on('window:handoff', async (snapshot) => { await this.receiveHandoff(snapshot); });
      window.mazz.on('window:role', ({ role }) => { contextKeys.set('windowRole', role); });
      window.mazz.on('file:changed', ({ path: p, event }) => {
        const tab = this.tabs.tabs.find(t => t.filePath === p);
        if (tab && event === 'change' && !tab.dirty) {
          toast('磁盘文件已变更', [
            { label: '重新载入', fn: async () => {
              const c = await window.mazz.invoke('fs:readFile', { path: p });
              const inst = modules.instances.get(tab.id);
              inst?.def.setContent(c, inst.state);
              this.tabs.setDirty(tab.id, false);
            } },
            { label: '忽略', fn: () => {} },
          ]);
        }
      });
    }
    bus.on('recovery:available', (snaps, restoreFn) => this.showRecoveryBar(snaps, restoreFn));
  }

  async checkRecovery() {
    await snapshots.checkRecovery(async (snaps) => {
      for (const s of snaps) {
        if (!modules.get(s.moduleId)) continue;
        this.openTab(s.moduleId, {
          title: (s.filePath ? s.filePath.split(/[\\/]/).pop() : '未保存') + '（已恢复）',
          filePath: s.filePath, content: s.content,
        });
      }
      toast(`已从快照恢复 ${snaps.length} 个标签`);
    });
  }

  showRecoveryBar(snaps, restoreFn) {
    const bar = document.createElement('div');
    bar.className = 'recovery-bar';
    bar.innerHTML = `<span>⚠ 检测到 ${snaps.length} 份未正常关闭的快照（自动保存/崩溃恢复）</span>
      <button>全部恢复</button><button class="ghost">忽略</button>`;
    bar.querySelector('button').addEventListener('click', async () => { bar.remove(); await restoreFn(snaps); });
    bar.querySelector('.ghost').addEventListener('click', async () => {
      bar.remove();
      await window.mazz?.invoke('snapshot:clearAll');
    });
    this.tabs.area.appendChild(bar);
  }

  // ==================== 应用菜单栏同步 ====================
  syncAppMenu() {
    if (!window.mazz?.isElectron) return;
    const item = (id, accelerator) => ({ id, label: commands.get(id)?.title || id, accelerator });
    window.mazz.invoke('appmenu:sync', {
      template: [
        { label: '文件', items: [
          item('file.new', 'CmdOrCtrl+N'), item('file.newSheet'), item('file.newSlide'), item('file.newText'),
          item('file.newBrowser'), item('file.newCode'), item('file.newMath'),
          item('file.newNotes'), item('file.newSearch'),
          item('file.newMindmap'), item('file.newDraw'), item('file.newLibrary'),
          item('file.open', 'CmdOrCtrl+O'), item('file.save', 'CmdOrCtrl+S'),
          item('file.saveAs', 'CmdOrCtrl+Shift+S'), { type: 'separator' },
          item('file.print', 'CmdOrCtrl+P'), item('file.exportPDF'), { type: 'separator' },
          item('file.closeTab', 'CmdOrCtrl+W'),
        ] },
        { label: '编辑', items: [
          { id: 'edit.undo', label: '撤销', accelerator: 'CmdOrCtrl+Z' },
          { id: 'edit.redo', label: '重做', accelerator: 'CmdOrCtrl+Y' },
          { type: 'separator' },
          { id: 'edit.cut', label: '剪切', accelerator: 'CmdOrCtrl+X' },
          { id: 'edit.copy', label: '复制', accelerator: 'CmdOrCtrl+C' },
          { id: 'edit.paste', label: '粘贴', accelerator: 'CmdOrCtrl+V' },
          { id: 'edit.selectAll', label: '全选', accelerator: 'CmdOrCtrl+A' },
        ] },
        { label: '视图', items: [
          item('app.commandPalette', 'CmdOrCtrl+Shift+P'), item('view.toggleSidebar', 'CmdOrCtrl+Shift+E'),
          item('view.focusMode', 'CmdOrCtrl+Shift+F'), item('view.cycleTheme'), { type: 'separator' },
          item('view.zoomIn', 'CmdOrCtrl+='), item('view.zoomOut', 'CmdOrCtrl+-'),
          item('view.zoomReset', 'CmdOrCtrl+0'), item('view.fullScreen', 'F11'),
        ] },
        { label: '帮助', items: [item('app.shortcutSheet'), item('app.about')] },
      ],
    });
  }

  // ==================== 设置面板 ====================
  async openSettingsModal() {
    const m = modal('设置');
    const { LANGUAGES, getLanguage, setLanguage } = await import('../i18n/index.js');
    m.body.innerHTML = `
      <div class="set-row"><label>${t('语言 (Language)')}</label>
        <select id="s-lang" class="rb-select">${LANGUAGES.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select></div>
      <div class="set-row"><label>关闭按钮行为</label>
        <select id="s-close" class="rb-select"><option value="ask">每次询问</option><option value="tray">最小化到托盘</option><option value="quit">直接退出</option></select></div>
      <div class="set-row"><label>主题模式</label>
        <select id="s-tsource" class="rb-select"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div>
      <div class="set-row"><label>UI 主题</label>
        <select id="s-theme" class="rb-select">${THEMES.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select></div>
      <div class="set-row"><label>图片取色</label>
        <button id="s-imgtheme" class="rb-btn" style="flex-direction:row">🖼 从图片生成主题</button>
        <span style="font-size:11px;color:var(--fg-dim)">提取颜色按构成主义原则组合；色彩太少会提示换图</span></div>
      <div class="set-row"><label>快速笔记保存到</label>
        <select id="s-qn" class="rb-select"><option value="daily">每日笔记</option><option value="inbox">inbox.md</option></select></div>
      <div class="set-row"><label>拼写检查</label>
        <select id="s-spell" class="rb-select"><option value="on">开启</option><option value="off">关闭</option></select></div>
      <div class="set-row"><label>最近文件</label>
        <button id="s-clearRecent" class="rb-btn" style="flex-direction:row">清空</button></div>
      <div style="border-top:1px solid var(--border);margin:10px 0 4px;padding-top:10px;font-weight:600">搜索实例（SearXNG）</div>
      <div class="set-row"><label>实例地址</label><input id="s-searx-url" class="rb-input" style="width:62%" placeholder="https://你的实例"></div>
      <div class="set-row"><label>用户名</label><input id="s-searx-user" class="rb-input" style="width:62%"></div>
      <div class="set-row"><label>密码</label><input id="s-searx-pass" class="rb-input" style="width:62%" type="password"></div>
      <div class="set-row"><label></label>
        <button id="s-searx-save" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存并自检</button>
        <span id="s-searx-status" style="font-size:11.5px;color:var(--fg-dim)"></span></div>
      <div style="margin-top:14px;color:var(--fg-dim);font-size:11.5px;line-height:1.7">
        全局快捷键：<b>Ctrl+Alt+M</b> 唤起主窗 · <b>Ctrl+Alt+N</b> 快速笔记（托盘常驻时仍可用）<br>
        AI 扩展层已预留（Provider 未配置，相关菜单为禁用态）
      </div>`;
    const g = (id) => m.body.querySelector(id);
    g('#s-lang').value = getLanguage();
    g('#s-lang').addEventListener('change', async (e) => {
      await setLanguage(e.target.value);
      m.close();
      this.openSettingsModal(); // 用新语言重开设置
    });
    window.mazz.invoke('settings:get', { key: 'closeBehavior' }).then(v => g('#s-close').value = v || 'ask').catch(() => {});
    window.mazz.invoke('settings:get', { key: 'themeSource' }).then(v => g('#s-tsource').value = v || 'system').catch(() => {});
    g('#s-theme').value = document.documentElement.dataset.theme || 'paper';
    g('#s-theme').addEventListener('change', e => this.setTheme(e.target.value));
    g('#s-imgtheme').addEventListener('click', async () => {
      const { applyImageTheme } = await import('../theme-custom.js');
      const ok = await applyImageTheme();
      if (ok) g('#s-theme').value = 'custom';
    });
    window.mazz.invoke('settings:get', { key: 'quickNoteTarget' }).then(v => g('#s-qn').value = v || 'daily').catch(() => {});
    window.mazz.invoke('settings:get', { key: 'spellcheckEnabled' }).then(v => g('#s-spell').value = v === false ? 'off' : 'on').catch(() => {});
    g('#s-close').addEventListener('change', e =>
      window.mazz.invoke('settings:set', { key: 'closeBehavior', value: e.target.value }));
    g('#s-tsource').addEventListener('change', e =>
      window.mazz.invoke('theme:setSource', { source: e.target.value }).catch(() => {}));
    g('#s-qn').addEventListener('change', e =>
      window.mazz.invoke('settings:set', { key: 'quickNoteTarget', value: e.target.value }));
    g('#s-spell').addEventListener('change', async e => {
      await window.mazz.invoke('spell:setEnabled', { enabled: e.target.value === 'on' }).catch(() => {});
      this.statusbar.setSpell(e.target.value === 'on');
    });
    g('#s-clearRecent').addEventListener('click', async () => {
      await window.mazz.invoke('recent:clear');
      toast('最近文件已清空');
      this.rebuildFileIndex();
    });
    // 搜索实例配置
    const fillSearx = async () => {
      if (!window.mazz?.isElectron) return;
      const mc = await window.mazz.invoke('searx:getMaskedConfig');
      g('#s-searx-url').placeholder = mc.masked || 'https://你的实例';
      g('#s-searx-user').value = mc.user || '';
      g('#s-searx-pass').placeholder = mc.hasPass ? '（已设置，不修改请留空）' : '（未设置）';
    };
    fillSearx();
    g('#s-searx-save').addEventListener('click', async () => {
      const url = g('#s-searx-url').value.trim();
      const user = g('#s-searx-user').value.trim();
      const pass = g('#s-searx-pass').value;
      const cur = await window.mazz.invoke('settings:get', { key: 'searx' });
      const cfg = { url: url || cur?.url, user: user || cur?.user, pass: pass || cur?.pass };
      const status = g('#s-searx-status');
      status.textContent = '自检中…';
      try {
        const sc = await window.mazz.invoke('searx:setConfig', cfg);
        status.textContent = sc.ok ? '✓ 实例连通正常' : '✗ ' + (sc.checks || []).map(c => `${c.name}:${c.detail}`).join('；');
      } catch (e) { status.textContent = '✗ ' + e.message; }
    });
  }

  openShortcutSheet() {
    const m = modal('快捷键速查表');
    const groups = {};
    for (const b of keymap.defaults) {
      const cmd = commands.get(b.command);
      const g = cmd?.group || '其他';
      (groups[g] = groups[g] || []).push({ key: b.key, title: cmd?.title || b.command });
    }
    m.body.innerHTML = Object.entries(groups).map(([g, rows]) => `
      <div style="margin-bottom:12px"><div style="font-weight:600;margin-bottom:6px">${g}</div>
      ${rows.map(r => `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:12.5px">
        <span>${r.title}</span><kbd style="background:var(--bg-active);border-radius:4px;padding:0 7px;font-family:var(--font-mono)">${r.key}</kbd></div>`).join('')}
      </div>`).join('');
  }
}

// ==================== 通用工具 ====================
export function toast(msg, actions = [], ms = 3000) {
  document.querySelectorAll('.mazz-toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'mazz-toast';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.ghost) b.className = 'ghost';
    b.addEventListener('click', () => { el.remove(); a.fn(); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms + actions.length * 1500);
  return el;
}

export function modal(title) {
  const mask = document.createElement('div');
  mask.className = 'mazz-palette-mask';
  mask.innerHTML = `<div class="mazz-palette" style="padding:18px 20px;max-height:76vh;overflow:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <b style="font-size:15px">${title}</b>
      <button class="rb-btn" style="min-width:28px" id="m-close">✕</button>
    </div><div class="modal-body"></div></div>`;
  document.body.appendChild(mask);
  mask.querySelector('#m-close').addEventListener('click', () => mask.remove());
  mask.addEventListener('mousedown', e => { if (e.target === mask) mask.remove(); });
  return { el: mask, body: mask.querySelector('.modal-body'), close: () => mask.remove() };
}

/** 输入对话框（Electron 不支持 window.prompt，全应用统一替代件）。resolve 输入串或 null（取消） */
export function inputModal(title, initial = '') {
  return new Promise((resolve) => {
    const m = modal(title);
    m.body.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;min-width:340px">
        <input id="im-input" class="rb-input" style="flex:1;padding:6px 8px" value="${String(initial).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}">
        <button id="im-ok" class="rb-btn" style="flex-direction:row">确定</button>
      </div>`;
    const input = m.body.querySelector('#im-input');
    const done = (val) => { resolve(val); m.close(); };
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.el)) { obs.disconnect(); resolve(null); }
    });
    obs.observe(document.body, { childList: true });
    m.body.querySelector('#im-ok').addEventListener('click', () => done(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
      e.stopPropagation();
    });
    input.focus();
    input.select();
  });
}
