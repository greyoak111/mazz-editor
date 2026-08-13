// renderer/shell/shell.js —— 外壳总装配：一切操作皆命令的调度中枢
import { bus } from '../core/events.js';
import { iconHtml } from '../lib/svg-icons.js';
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
import { installPaneZoom, setPaneZoomListener, paneZoomOf, resetAllPaneZooms } from './pane-zoom.js';
import { FileTree } from './file-tree.js';
import { SidebarCtl } from './sidebar-ctl.js';
import { t, onLanguageChange } from '../i18n/index.js';
import { StatusBar } from './statusbar.js';
import { ALL_CODE_EXTENSIONS, CODE_FILE_EXTENSIONS, CODE_FILE_DEFAULTS, CODE_NEW_FILE_TYPES, LANGUAGE_BY_EXT } from '../modules/code/language-catalog.js';

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
  { id: 'genshin', name: '星辉' },
  { id: 'custom', name: '图片自定义' },
];
const EXT_MODULE = {
  png: 'viewer', jpg: 'viewer', jpeg: 'viewer', gif: 'viewer', webp: 'viewer', svg: 'viewer',
  bmp: 'viewer', avif: 'viewer', ico: 'viewer', pdf: 'viewer',
  mp4: 'viewer', webm: 'viewer', ogv: 'viewer', ogg: 'viewer', mov: 'viewer', m4v: 'viewer', mkv: 'viewer',
  avi: 'viewer', wmv: 'viewer', flv: 'viewer', mts: 'viewer', m2ts: 'viewer', mpg: 'viewer', mpeg: 'viewer', '3gp': 'viewer',
  mp3: 'viewer', wav: 'viewer', oga: 'viewer', m4a: 'viewer', aac: 'viewer', flac: 'viewer', opus: 'viewer',
  md: 'markdown', markdown: 'markdown', mazz: 'markdown', txt: 'text',
  csv: 'sheet', mazzsheet: 'sheet', tsv: 'sheet',
  xlsx: 'sheet', // 二进制通道
  docx: 'markdown', // 二进制通道 → mammoth 导入
  mazzslide: 'slide', pptx: 'slide', // pptx 二进制 → 大纲导入
  mindmap: 'mindmap', mazzdraw: 'draw', opml: 'mindmap', mm: 'mindmap', xmind: 'mindmap',
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', tsx: 'code', jsx: 'code',
  json: 'code', css: 'code', html: 'code', py: 'code', sh: 'code',
  yml: 'code', yaml: 'code', xml: 'code',
};
// W59c：底层 RUNNERS 已覆盖的扩展名统一进代码模块；已有专用查看器/文档路由保持优先。
for (const ext of ALL_CODE_EXTENSIONS) if (!EXT_MODULE[ext]) EXT_MODULE[ext] = 'code';

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
const CODE_EXTS = CODE_FILE_EXTENSIONS;

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
    // bundle 会把 core 拆到不同 chunk，window.MazzModules 指向的可能是个空副本（E2E 实锤）；
    // 经壳暴露应用真正在用的 registry，测试与桥接以它为准
    if (typeof window !== 'undefined') window.MazzModulesReal = modules;
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
      // 活取主进程当前工作区（缓存会害死切换：workspace:setCurrent 后 this.workspace 是旧值）
      getWorkspace: async () => {
        const ws = await window.mazz.invoke('workspace:get').catch(() => null);
        if (ws) this.workspace = ws;
        return this.workspace;
      },
    });
    this.fileTree.defaults = { NEW_FILE_TYPES, NEW_FILE_DEFAULTS, BINARY_EXTS, makeBinaryDoc };
    // 右侧工具坞（智能创作/打开方式集中地；Ribbon 启动，可拖拽/拉伸/缩放）
    import('./side-dock.js').then(({ SideDock }) => {
      this.sideDock = new SideDock(this);
    });
    this.sidebarCtl = new SidebarCtl(this.sidebar);
    this.sidebarCtl.init();
    // 侧栏多页签面板（思源工作区：文档/大纲/书签/标签/反链）
    import('./sidebar-panels.js').then(({ SidebarPanels }) => {
      this.sidebarPanels = new SidebarPanels({ sidebar: this.sidebar, fileTree: this.fileTree, shell: this });
    });
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
        bus.emit('doc:changed', { tabId });
      },
      setStatus: (container, text) => {
        const tabId = this.containerTab.get(container);
        if (tabId === this.tabs.activeId) this.statusbar.set(undefined, text);
      },
      openTab: (moduleId, opts) => this.openTab(moduleId, opts),
      setTabTitle: (container, title) => {
        const tabId = this.containerTab.get(container);
        if (tabId) {
          const pane = this.paneTree.paneOfTab(tabId);
          (pane ? pane.tabs : this.tabs).setTitle(tabId, title);
        }
      },
      // 切歌/导航后同步标签路径（此前 tab.filePath 停在旧文件：已开判定失效+切回复活播错片）
      setTabFilePath: (container, filePath) => {
        const tabId = this.containerTab.get(container);
        if (!tabId) return;
        const pane = this.paneTree.paneOfTab(tabId);
        const t = (pane ? pane.tabs : this.tabs).get(tabId);
        if (t) { t.filePath = filePath; this.syncTitle(); }
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
        { command: 'file.newViewer', icon: '🎬', label: '播放器' },
        { command: 'file.newCode', icon: '💻', label: '代码' },
        { command: 'file.newMath', icon: '🧮', label: '计算' },
        { command: 'file.newNotes', icon: '📓', label: '笔记' },
        { command: 'file.newSearch', icon: '🔎', label: '全局搜索' },
        { command: 'file.newMindmap', icon: '🧠', label: '导图' },
        { command: 'file.newDraw', icon: '🎨', label: '画板' },
        { command: 'file.newLibrary', icon: '📚', label: '书库' },
        { command: 'file.newText', icon: '🄣', label: '纯文本' },
        { command: 'file.open', icon: '📂', label: '打开' },
        { command: 'file.openViewer', icon: '🖼', label: '查看器' },
        { command: 'file.openWithSystem', icon: '🚀', label: '外部打开' },
        { command: 'file.import', icon: '📥', label: '导入' },
        { command: 'file.openWorkspace', icon: '🗂', label: '工作区' },
      ]);
      this.ribbon.group('面板', [
        { command: 'factory.toggleDock', icon: '🧰', label: '工具坞' },
      ]);
      this.ribbon.group('保存', [
        { command: 'file.save', icon: '💾', label: '保存' },
        { command: 'file.saveAs', icon: '⇢', label: '另存为' },
      ]);
      this.ribbon.group('输出', [
        { command: 'file.print', icon: '🖨', label: '打印' },
        { command: 'file.exportPDF', icon: '📄', label: '导出PDF' },
        { command: 'file.share', icon: '📤', label: '发送' },
      ]);
    }, 10);
    this.ribbon.addPage('factory', '智能创作', () => {
      this.ribbon.group('创作', [
        { command: 'factory.toggleDock', icon: '🔥', label: '智能创作' },
        { command: 'factory.copyMantra', icon: '📋', label: '复制模板' },
        { command: 'factory.generate', icon: '⚡', label: '直接生成' },
      ]);
      this.ribbon.group('任务', [
        { command: 'factory.runAll', icon: '▶', label: '全部启动' },
        { command: 'factory.newGenre', icon: '✚', label: '新建模板' },
        { command: 'factory.provider', icon: '⚙', label: 'AI 设置' },
      ]);
      this.ribbon.group('工具', [
        { command: 'dock.openWith', icon: '📂', label: '打开方式' },
        { command: 'dock.tools', icon: '🧰', label: '全部工具' },
      ]);
    }, 15);
    this.ribbon.addPage('view', '视图', () => {
      this.ribbon.group('面板', [
        { command: 'view.toggleSidebar', icon: '🗀', label: '目录树' },
        { command: 'app.commandPalette', icon: '⌘', label: '命令面板' },
      ]);
      this.ribbon.group('界面', [
        { command: 'view.cycleTheme', icon: '🎨', label: '换主题' },
        { command: 'view.focusMode', icon: '🎯', label: '专注' },
        { command: 'view.fullScreen', icon: '⛶', label: '全屏' },
        { command: 'annotate.toggle', icon: '✍', label: '批注' },
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

  splitRight() { this.splitAndMove('row'); }
  splitDown() { this.splitAndMove('column'); }

  /** 分屏并把当前标签送到新窗格（右/下），免去再拖拽 */
  splitAndMove(direction) {
    const srcLeaf = this.paneTree.active;
    const tab = srcLeaf?.tabs.active;
    const newLeaf = this.paneTree.splitActive(direction);
    if (tab && newLeaf) {
      this.paneTree.moveTabToPane(tab.id, newLeaf);
    }
  }

  /** 全局内录对话框：源多选 + 音频开关 + 变速 + 启停 */
  async openScreenRecorderDialog() {
    if (!window.mazz?.isElectron) { toast('全局内录仅桌面版可用'); return; }
    // W53：全原生独立子窗格（控制台面板）；已在录=旧命令行为保留（再按=停止）
    if (window.mazz?.isElectron) { window.mazz.invoke('panel:open', { kind: 'recorder' }).catch(() => {}); return; }
    if (this._screenRec) { this._screenRec.stop(); this._screenRec = null; toast('正在停止并收尾…'); return; }
    let sources = [];
    try { sources = await window.mazz.invoke('rec:sources'); }
    catch (e) { toast('录制源枚举失败：' + e.message); return; }
    if (!sources.length) { toast('没有可用的录制源（检查系统录屏权限后重试）'); return; }
    const m = modal('全局内录');
    const picked = new Set(sources[0] ? [sources[0].id] : []);
    m.body.innerHTML = `
      <div style="min-width:560px;max-width:720px">
        <div style="font-size:12.5px;color:#83817a;margin-bottom:8px">选择录制源（可多选平铺合成）：</div>
        <div class="rec-srcs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;max-height:280px;overflow-y:auto">
          ${sources.map(s => `
            <div class="rec-src ${picked.has(s.id) ? 'on' : ''}" data-id="${s.id}" style="border:2px solid ${picked.has(s.id) ? 'var(--acc,#4f46e5)' : 'var(--bd,#e0ded8)'};border-radius:8px;padding:5px;cursor:pointer;text-align:center">
              ${s.thumb ? `<img src="${s.thumb}" style="width:100%;border-radius:5px">` : '<div style="height:80px;display:grid;place-items:center;color:#999">无预览</div>'}
              <div style="font-size:11.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name}</div>
            </div>`).join('')}
        </div>
        <div style="display:flex;gap:14px;align-items:center;margin-top:12px;font-size:12.5px;flex-wrap:wrap">
          <label><input type="checkbox" id="rec-sys" checked> 系统内音</label>
          <label><input type="checkbox" id="rec-mic"> 麦克风</label>
          <label><input type="checkbox" id="rec-sub" checked> 字幕轨（语音识别存 .srt）</label>
          <label>变速 <select id="rec-speed" class="rb-select"><option value="1">原速</option><option value="3" selected>3 倍速</option><option value="10">10 倍速</option><option value="6">6 倍速</option></select></label>
          <label>格式 <select id="rec-fmt" class="rb-select"><option value="webm">webm（即存即播）</option><option value="mp4">mp4（H.264，录完转码）</option></select></label>
          <span style="flex:1"></span>
          <button id="rec-go" class="rb-btn" style="flex-direction:row;background:var(--acc,#4f46e5);color:#fff">● 开始录制</button>
        </div>
        <div style="font-size:11.5px;color:#a3a19a;margin-top:8px">默认保存到工作区「录制/」；mp4 经本地转码产出真 H.264（首次需加载转码内核）</div>
      </div>`;
    m.body.querySelectorAll('.rec-src').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (picked.has(id)) { picked.delete(id); el.style.borderColor = 'var(--bd,#e0ded8)'; }
      else { picked.add(id); el.style.borderColor = 'var(--acc,#4f46e5)'; }
    }));
    m.body.querySelector('#rec-go').addEventListener('click', async () => {
      if (!picked.size) { toast('先选择录制源'); return; }
      const chosen = sources.filter(s => picked.has(s.id));
      const { startScreenRecorder } = await import('../lib/recorder.js');
      let r = null;
      try {
        r = await startScreenRecorder({
          sources: chosen,
          speed: +m.body.querySelector('#rec-speed').value,
          sysAudio: m.body.querySelector('#rec-sys').checked,
          micAudio: m.body.querySelector('#rec-mic').checked,
          outFormat: m.body.querySelector('#rec-fmt')?.value || 'webm',
          subtitle: m.body.querySelector('#rec-sub')?.checked ?? true,
          name: '全局内录',
        });
      } catch (e) { toast('录制启动失败：' + (e?.message || e)); return; } // 旧实现此处无 catch：采集被拒=未处理拒绝静默吞掉
      if (!r) { toast('启动失败'); return; }
      this._screenRec = r;
      toast('内录中… 再次执行「全局内录」命令停止');
      m.close();
    });
  }

  /** 页签拖拽分屏：拖到【鼠标下的那个窗格】的四区边缘 → 该窗格内低可视预览 + 定向分屏
   *  要点：
   *  1) 区域按目标窗格（elementFromPoint 命中的 .pane）计算，不是整个容器——多窗格下每个窗格都能各自分屏
   *  2) 标签栏区域不产生分屏区（拖标签进别的窗格标签栏 = 直接移签，不被分屏吞掉）
   *  3) webview（浏览器窗格）会吞掉 HTML5 拖拽事件：拖签期间给每个 .editor-area 盖透明盾牌保证事件可达 */
  installSplitPreview() {
    let overlay = null, zone = null, zoneLeaf = null;
    // 提示色跟随当前 UI 主题（不再死紫）：showOverlay 时实时取主题 accent 转 rgba
    // v45 再就业：平面填色 → 边沿→中心渐隐（先急剧后舒缓），覆盖比例不变
    const zoneColors = () => {
      const c = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5';
      const m = /^#([0-9a-f]{6})$/i.exec(c);
      const rgb = m ? (() => { const n = parseInt(m[1], 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; })() : '79, 70, 229';
      return { rgb, border: `rgba(${rgb}, 0.55)` };
    };
    // 渐隐曲线：0% 强 → 16% 陡降 → 42% 缓释 → 100% 全隐（先急剧后舒缓）
    const zoneGradient = (z, rgb) => {
      const stops = `rgba(${rgb}, 0.40) 0%, rgba(${rgb}, 0.24) 16%, rgba(${rgb}, 0.10) 42%, rgba(${rgb}, 0.03) 72%, rgba(${rgb}, 0) 100%`;
      const dir = { left: 'to right', right: 'to left', up: 'to bottom', down: 'to top' }[z] || 'to right';
      return `linear-gradient(${dir}, ${stops})`;
    };

    const leafAt = (x, y) => {
      const paneEl = document.elementFromPoint(x, y)?.closest?.('.pane');
      if (!paneEl) return null;
      return this.paneTree.leaves().find(l => l.el === paneEl) || null;
    };
    // 区域判定：相对目标窗格四区
    const zoneIn = (leaf, x, y) => {
      const r = leaf.el.getBoundingClientRect();
      const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
      if (fx < 1 / 3) return 'left';
      if (fx > 2 / 3) return 'right';
      if (fy < 1 / 3) return 'up';
      if (fy > 2 / 3) return 'down';
      return null;
    };
    // W57 分屏路线修正（用户定版）：老 DOM overlay 转正——罩页方案停用（独立窗链路长收效差实锤）；
    // Min 思路=DOM 直接简单零延迟，「不抢渲染」=拖拽 cloak：拖起页签→浏览器视图全隐让位，DOM 预览随便画，落下即恢复
    const dragCloak = (on) => {
      const bctl = window.__activeBrowserCtl;
      if (!bctl) return;
      bctl._dragCloak = !!on; // 拖拽独立闸（不复用 _cloaked——mask observer 会每帧覆盖它（探针实锤 dragging=true cloaked=false））
      bctl.__sync?.();
    };
    const showOverlay = (leaf, z) => {
      const r = leaf.el.getBoundingClientRect();
      const zc = zoneColors();
      const rect = { left: r.left, top: r.top, width: r.width / 3, height: r.height / 3 };
      if (z === 'left') Object.assign(rect, { width: r.width / 3, height: r.height });
      else if (z === 'right') Object.assign(rect, { left: r.left + r.width * 2 / 3, width: r.width / 3, height: r.height });
      else if (z === 'up') Object.assign(rect, { width: r.width, height: r.height / 3 });
      else Object.assign(rect, { top: r.top + r.height * 2 / 3, width: r.width, height: r.height / 3 });
      const borderSide = ({ left: 'borderRight', right: 'borderLeft', up: 'borderBottom', down: 'borderTop' })[z] || 'borderRight';
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.style.cssText = `position:fixed;pointer-events:none;z-index:60;border-radius:6px;transition:all .08s ease`;
        document.body.appendChild(overlay);
      }
      overlay.style.background = zoneGradient(z, zc.rgb); // 每次换区都重算（方向随区变）
      // 边框只留画面边沿那一条锚线；中心侧零边界（用户实锤：整圈虚线框让渐隐尽头挂了一条线）
      overlay.style.border = 'none';
      overlay.style.borderRadius = '0';
      overlay.style[borderSide] = `1.5px solid ${zc.border}`;
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
    };
    const hideOverlay = () => { overlay?.remove(); overlay = null; zone = null; zoneLeaf = null; };
    const shields = (on) => document.body.classList.toggle('tab-dragging', on);
    // 清理唯一真源（三路兜底，不再单押 dragend）：拖签中途源元素被重渲染销毁→dragend 永失，
    // 33% 框+盾牌钉死屏幕（「神秘框」粘连复现实锤）——看门狗/pointerup/blur 三路必达
    let dog = null;
    const cleanup = () => { hideOverlay(); shields(false); clearTimeout(dog); dog = null; dragCloak(false); }; // 落下即恢复视图
    const armDog = () => { clearTimeout(dog); dog = setTimeout(cleanup, 1500); }; // 1.5s 无 dragover 即判拖拽死亡

    document.addEventListener('dragstart', (e) => {
      if (e.dataTransfer?.types?.includes('mazz/tab') || e.target.closest?.('.tab')) { shields(true); armDog(); dragCloak(true); } // 拖起即隐视图（不抢渲染）
    }, true);
    // 捕获相：模块内部（如编辑器拖拽插图区）stopPropagation 也截不到这里——
    // 此前 dragover 走冒泡相，多窗格下被模块内层截停，分区永 null=拖不了分屏（灾难现场病根）
    document.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('mazz/tab')) return;
      // 标签栏：放行（交给窗格的移签 drop），不做分屏
      if (e.target.closest?.('.tabbar')) { if (zone) hideOverlay(); return; }
      const leaf = leafAt(e.clientX, e.clientY);
      const z = leaf && zoneIn(leaf, e.clientX, e.clientY);
      if (leaf && z) { zone = z; zoneLeaf = leaf; showOverlay(leaf, z); armDog(); e.preventDefault(); }
      else if (zone) hideOverlay();
    }, true);
    document.addEventListener('drop', (e) => {
      const tabId = e.dataTransfer?.getData('mazz/tab');
      const z = zone, leaf = zoneLeaf;
      cleanup();
      if (!tabId || !z || !leaf) return;
      e.preventDefault();
      e.stopPropagation();
      this.splitWithTab(tabId, z, leaf);
    }, true);
    document.addEventListener('dragend', cleanup);
    // 兜底一：真实鼠标拖拽必以 pointerup 收场（dragend 被源毁灭吞掉时的唯一活口）
    document.addEventListener('pointerup', () => { if (overlay || document.body.classList.contains('tab-dragging')) cleanup(); }, true);
    // 兜底二：切窗/失焦即清（alt-tab 中断拖拽的残渣）
    window.addEventListener('blur', cleanup);
  }

  /** 外部文件拖入：主界面/外部窗格自动打开（支持格式走 EXT_MODULE 路由） */
  installFileDrop() {
    const ROUTE = EXT_MODULE;
    document.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    document.addEventListener('drop', async (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      // 落在自带拖放语义的模块里（编辑器拖图插入等）→ 让位给模块，全局打开不抢
      if (e.target.closest?.('.ProseMirror, [data-file-drop]')) return;
      e.preventDefault();
      e.stopPropagation();
      const OPENABLE = new Set(Object.keys(ROUTE).concat(['epub', 'cbz', 'mobi', 'azw3', 'opml', 'mm', 'xmind']));
      let opened = 0, skipped = [];
      for (const f of files) {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (!OPENABLE.has(ext)) { skipped.push(f.name); continue; }
        // Electron 32+：File.path 已移除，必须 webUtils.getPathForFile
        const realPath = window.mazz?.isElectron ? (window.mazz.getPathForFile?.(f) || '') : '';
        if (realPath) { await this.openFile(realPath); opened++; }
        else if (window.mazz?.isElectron) skipped.push(f.name);
      }
      if (opened) toast(`已打开 ${opened} 个文件`);
      if (skipped.length) toast(`不支持或未取到路径：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? ' 等' : ''}`);
    }, true);
  }

  /** 定向分屏：拖到目标窗格某侧 1/3 → 在该侧新建窗格放拖来的签，目标窗格原标签一律不动（VS Code 行为） */
  splitWithTab(tabId, zone, leaf = null) {
    const dir = zone === 'right' || zone === 'left' ? 'row' : 'column';
    const targetLeaf = leaf || this.paneTree.active || this.paneTree.leaves()[0];
    this.paneTree.setActive(targetLeaf);
    const newLeaf = this.paneTree.split(targetLeaf, dir);
    if (!newLeaf) return;
    if (zone === 'left' || zone === 'up') {
      // split 固定 {a: 原 leaf, b: 新 leaf}；左/上分需要新格在前——交换分支顺序
      const branch = this.paneTree.findParent(this.paneTree.root, newLeaf);
      if (branch && branch.b === newLeaf) {
        branch.a = newLeaf;
        branch.b = targetLeaf;
        this.paneTree.render();
      }
    }
    this.paneTree.moveTabToPane(tabId, newLeaf, { keepEmpty: true });
    toast(zone === 'right' ? '已向右分屏' : zone === 'down' ? '已向下分屏' : zone === 'left' ? '已向左分屏' : '已向上分屏');
  }

  /** W58b 树拖图即插：图片节点插到 markdown 落点（posAtCoords 定位；src=mazz-res 绝对径与 insertImage 同径） */
  async insertImageToMarkdown(inst, path, coords) {
    const view = inst.state?.view;
    if (!view) return;
    const src = 'mazz-res://media/' + encodeURIComponent(String(path).replace(/\\/g, '/'));
    // PM posAtCoords 要 {left, top} 不要 {x, y}（传 x/y=undefined 非有限=elementFromPoint 炸雷实锤）
    const pos = (coords ? view.posAtCoords?.({ left: coords.x, top: coords.y })?.pos : null) ?? view.state.selection.head;
    const alt = path.split(/[\\/]/).pop();
    const node = view.state.schema.nodes.image.create({ src, alt });
    view.dispatch(view.state.tr.insert(pos, node).scrollIntoView());
    view.focus();
    toast('已插入图片：' + alt);
  }

  /** 磁盘内容重载到标签（外部编辑回传；脏标签只提示不覆盖） */
  async reloadTabFromDisk(tab) {
    const RELOADABLE = new Set(['markdown', 'text', 'sheet', 'slide', 'mindmap', 'code', 'notes', 'draw']);
    const inst = modules.instances.get(tab.id);
    if (!inst || !RELOADABLE.has(inst.name)) return;
    if (tab.dirty) {
      toast(`「${tab.title}」在外部被修改，这边有未保存改动——请先保存或放弃改动`);
      return;
    }
    try {
      const ext = tab.filePath.split('.').pop().toLowerCase();
      // W58d：二进制族的对象契约只合 markdown/sheet/slide——降级 tab（超大 docx 走 code 纯文本）强灌 {__docx} 对象
      // 会被 string-only setContent 抹成空白（监看回刷连坐实锤）——模块不合直接跳过重载
      if ((ext === 'xlsx' || ext === 'docx' || ext === 'pptx') && !['markdown', 'sheet', 'slide'].includes(inst.name)) return;
      let content;
      if (ext === 'xlsx' || ext === 'docx' || ext === 'pptx') {
        const b64 = await window.mazz.invoke('fs:readFileBase64', { path: tab.filePath });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (ext === 'pptx') {
          const { pptxToOutline } = await import('../modules/slide/pptx-import.js');
          content = await pptxToOutline(bytes.buffer);
        } else {
          content = ext === 'xlsx' ? { __xlsx: bytes.buffer } : { __docx: bytes.buffer };
        }
      } else {
        content = await window.mazz.invoke('fs:readFile', { path: tab.filePath });
      }
      // 自己保存触发的 watcher：内容一致则跳过
      try { if (inst.def.getContent(inst.state) === content) return; } catch {}
      inst.def.setContent(content, inst.state);
      this.tabs.setDirty(tab.id, false);
      toast(`「${tab.title}」已同步外部修改`);
    } catch (e) { console.warn('[reload]', e.message); }
  }

  /** 外部文件/文件夹导入工作区（递归复制 + 重名避让） */
  async importExternal(paths) {
    try {
      const r = await window.mazz.invoke('import:external', { sources: paths });
      if (r.error === 'no-workspace') { toast('尚未设置工作区'); return; }
      const n = r.imported?.length || 0;
      if (n) {
        await this.fileTree.refresh();
        toast(`已导入 ${n} 项到工作区${r.skipped?.length ? `（${r.skipped.length} 项跳过）` : ''}`);
      } else {
        toast('没有可导入的内容');
      }
    } catch (e) { toast('导入失败：' + e.message); }
  }
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
    installPaneZoom(); // Ctrl+滚轮 / 双指捏合：模块窗格内容缩放（固定 UI 除外）
    this.installSplitPreview();
    this.installFileDrop(); // 页签拖拽分屏：区域预览 + 定向分屏
    setPaneZoomListener((area, z) => {
      // 正在缩放哪个窗格就显示哪个（缩放操作即焦点）
      this.statusbar.setZoom(this.zoom * z);
    });
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

  /** W58c 主题变量快照：主窗 computed style 单源（预设/主题包/图片自定义通吃）——
   *  广播与面板初始化共用；自定义主题下原生子窗透明裸奔的根治件 */
  _themeVarsSnapshot() {
    const KEYS = ['bg', 'bg-elev', 'bg-hover', 'bg-active', 'fg', 'fg-dim', 'border', 'accent', 'accent-soft', 'accent-fg', 'danger', 'warn', 'ok', 'shadow', 'doc-bg', 'acc', 'bd', 'bd2', 'card', 'mut', 'faint', 'sh'];
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const k of KEYS) { const v = cs.getPropertyValue('--' + k).trim(); if (v) vars[k] = v; }
    return { id: document.documentElement.dataset.theme || 'paper', vars };
  }

  /** 主窗换主题 → 广播子窗口跟随（v33 外部窗格主题不同步修复；pack/图片自定义一并覆盖） */
  _broadcastThemeNow() {
    if (contextKeys.get('windowRole') === 'child') return;
    const { id, vars } = this._themeVarsSnapshot();
    window.mazz?.invoke('theme:broadcast', { id, vars }).catch(() => {});
  }

  setTheme(id) {
    // W58c：广播必须在变量真落应用之后——旧版开口就播，子窗拿到的是上一主题的皮；
    // 自定义主题包/图片主题干脆只有 id 没有变量通道=面板无 [data-theme] 规则可匹配=透明裸奔（真机实锤）
    if (id?.startsWith('pack:')) {
      // 自定义主题包（工作区 themes/ 下的 JSON）：注入后切换
      import('../lib/theme-store.js').then(async ({ listPacks, applyPack }) => {
        const packId = id.slice(5);
        const packs = await listPacks();
        const pack = packs.find(p => p.id === packId);
        if (!pack) {
          document.documentElement.dataset.theme = 'paper';
          this.statusbar.setTheme('纸白');
          toast('主题包不存在（可能已被删除）——已回退纸白');
          this._broadcastThemeNow();
          return;
        }
        applyPack(packId, pack);
        this.statusbar.setTheme(pack.name);
        this._broadcastThemeNow();
      });
      window.mazz?.invoke('settings:set', { key: 'theme', value: id }).catch(() => {});
      return;
    }
    document.documentElement.dataset.theme = id;
    if (id === 'custom') {
      // 图片自定义主题：确保变量已注入（无注入则提示并退回构成）
      import('../theme-custom.js').then(async ({ restoreImageTheme }) => {
        const ok = await restoreImageTheme();
        if (!ok) {
          document.documentElement.dataset.theme = 'construct';
          toast('还没有图片自定义主题——请先在设置里「从图片生成主题」');
        }
        this._broadcastThemeNow(); // 成败都播：ok=注入后快照，fail=construct 回退后快照
      });
    } else {
      this._broadcastThemeNow();
    }
    const t = THEMES.find(t => t.id === id) || THEMES[0];
    this.statusbar.setTheme(t.name);
    window.mazz?.invoke('settings:set', { key: 'theme', value: id }).catch(() => {});
  }

  /** 全部主题：自带（固定命名，不可删改）+ 工作区自定义主题包 */
  async allThemes() {
    const { listPacks } = await import('../lib/theme-store.js');
    const packs = await listPacks().catch(() => []);
    return [
      ...THEMES.map(t => ({ ...t, builtin: true })),
      ...packs.map(p => ({ id: 'pack:' + p.id, name: p.name, builtin: false })),
    ];
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
          <button class="w-card" data-cmd="file.new"><div class="t">${iconHtml('＋')} ${t('新建文档')}</div><div class="d">${t('Markdown 文档内核')}<br>${t('WYSIWYG 即时渲染')}</div></button>
          <button class="w-card" data-cmd="file.newSheet"><div class="t">${iconHtml('📊')} ${t('新建表格')}</div><div class="d">${t('虚拟网格 · 100+ 公式')}<br>${t('图表 / 透视 / xlsx')}</div></button>
          <button class="w-card" data-cmd="file.newSlide"><div class="t">${iconHtml('📽')} ${t('新建演示')}</div><div class="d">${t('大纲成稿 · 主题×5')}<br>${t('放映 / pptx 导出')}</div></button>
          <button class="w-card" data-cmd="file.newBrowser"><div class="t">${iconHtml('🌐')} ${t('隐私浏览器')}</div><div class="d">${t('独立会话 · 反追踪')}<br>${t('SearXNG 搜索内核')}</div></button>
          <button class="w-card" data-cmd="file.newCode"><div class="t">${iconHtml('💻')} ${t('新建代码')}</div><div class="d">${t('Monaco 智能 · F5 调试')}<br>${t('集成终端')}</div></button>
          <button class="w-card" data-cmd="file.newMath"><div class="t">${iconHtml('🧮')} ${t('计算 REPL')}</div><div class="d">${t('Python+JS 双后端')}<br>${t('calc 算块')}</div></button>
          <button class="w-card" data-cmd="file.newNotes"><div class="t">${iconHtml('📓')} ${t('笔记库')}</div><div class="d">${t('[[双链]] · 反向链接')}<br>${t('图谱 · 每日笔记')}</div></button>
          <button class="w-card" data-cmd="file.newSearch"><div class="t">${iconHtml('🔎')} ${t('全局搜索')}</div><div class="d">${t('全文索引 · 正则')}<br>${t('类型过滤 · 直达命中')}</div></button>
          <button class="w-card" data-cmd="file.newMindmap"><div class="t">${iconHtml('🧠')} ${t('思维导图')}</div><div class="d">${t('Tab 快建节点')}<br>${t('拖拽重排 · PNG/大纲导出')}</div></button>
          <button class="w-card" data-cmd="file.newDraw"><div class="t">${iconHtml('🎨')} ${t('画板')}</div><div class="d">${t('压感矢量笔 · 图层')}<br>${t('帧/洋葱皮 · PNG 序列')}</div></button>
          <button class="w-card" data-cmd="file.newLibrary"><div class="t">${iconHtml('📚')} ${t('书库')}</div><div class="d">${t('epub 电子书 · cbz 漫画')}<br>${t('进度记忆 · 导出笔记')}</div></button>
          <button class="w-card" data-cmd="file.newText"><div class="t">${iconHtml('🄣')} ${t('新建纯文本')}</div><div class="d">${t('即开即用')}<br>${t('TXT 读写')}</div></button>
          <button class="w-card" data-cmd="file.open"><div class="t">${iconHtml('📂')} ${t('打开文件')}</div><div class="d">.md / .txt / .csv / .xlsx<br>${t('双击关联直达')}</div></button>
          <button class="w-card" data-cmd="help.open"><div class="t">${iconHtml('❓')} ${t('使用指南')}</div><div class="d">${t('喂饭级帮助文档')}<br>${t('功能全解 · F1 直达')}</div></button>
          <button class="w-card" data-cmd="app.openSettings"><div class="t">${iconHtml('⚙')} ${t('设置')}</div><div class="d">${t('主题 / 关闭行为')}<br>${t('拼写 / 快捷笔记')}</div></button>
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
    // W58 路径同步另一半：打开即把 filePath 写进模块 state（attach 单参丢路径——打开时实例路径盲=runFile fp=null 实锤）
    try { if (filePath) inst.state.filePath = filePath; } catch {}
    this.containerTab.set(tab.view, tab.id);
    tab.forceClose = false;
    if (!inst.def.readOnly) {
      snapshots.track(tab.id, () => ({
        filePath, moduleId,
        content: safeGet(() => inst.def.getContent(inst.state)),
      }));
    }
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
        this.appendBridgeGroup(panel, def.name); // 桥接入口进对应模块 Ribbon（不再藏在命令面板）
        this.appendQuickLaunch(panel, def.name, tab);
      }, 0);
    }
    this.ribbon.showPage?.('module'); // W58：ribbon 上下文跟随模块——切模块自动切 module 页（code toolbarHTML 从未渲染=B12 按钮不在的总根）
    this.ribbon.renderTabs();
  }

  /** 「桥接」组：按模块列出可用桥接命令（画板/导图/文稿/表格/代码/书库） */
  appendBridgeGroup(panel, moduleId) {
    const BRIDGE_RIBBON = {
      markdown: ['bridge.mdToPptx', 'slide.compileFromMarkdown', 'markdown.toMindmap', 'bridge.mdToDraw'],
      sheet: ['bridge.sheetToPandas'],
      code: ['bridge.codeToMarkdown', 'bridge.terminalToSheet'],
      draw: ['bridge.drawToDoc', 'bridge.drawToSlide'],
      mindmap: ['bridge.mmToDoc', 'bridge.mmToSlide'],
      library: ['bridge.libToNote'],
    };
    const ids = BRIDGE_RIBBON[moduleId];
    if (!ids?.length) return;
    const g = document.createElement('div');
    g.className = 'rb-group';
    g.dataset.label = '桥接';
    for (const id of ids) {
      const cmd = commands.get(id);
      if (!cmd) continue;
      const btn = document.createElement('button');
      btn.className = 'rb-btn';
      btn.innerHTML = `<i class="ico">${iconHtml(cmd.icon || '⚡')}</i><span>${cmd.title}</span>`;
      btn.title = cmd.title;
      btn.addEventListener('click', () => commands.execute(id));
      g.appendChild(btn);
    }
    if (g.children.length) panel.appendChild(g);
  }

  /** 「外部打开」组：按模块类型列出系统已安装的对应软件（开始菜单扫描，7 天缓存） */
  async appendQuickLaunch(panel, moduleId, tab) {
    if (!window.mazz?.isElectron) return;
    const category = ({ markdown: 'word', text: 'word', sheet: 'excel', slide: 'powerpoint', code: 'code', draw: 'draw' })[moduleId];
    if (!category) return;
    const { apps } = await window.mazz.invoke('apps:quickLaunch', {}).catch(() => ({ apps: [] }));
    const mine = (apps || []).filter(a => a.category === category);
    if (!panel.isConnected) return; // 页面已被换走
    // 合并用户自定义应用（手动寻路 + 自定义命名）
    const { listCustomApps, editCustomAppDialog, appIconHtml } = await import('../lib/custom-apps.js');
    const customs = await listCustomApps(category);
    const all = [...mine, ...customs];
    const g = document.createElement('div');
    g.className = 'rb-group';
    g.dataset.label = '外部打开';
    for (const app of all) {
      const btn = document.createElement('button');
      btn.className = 'rb-btn';
      btn.innerHTML = `<i class="ico">${appIconHtml(app)}</i><span style="max-width:none">${app.name}</span>`;
      btn.title = `用 ${app.name} 打开当前文件${app.custom ? '（自定义应用，右键编辑/删除）' : ''}`;
      if (app.custom) {
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          editCustomAppDialog({ category, existing: app, onSaved: () => this.ribbon?.showPage?.(this.ribbon.activePage) });
        });
      }
      btn.addEventListener('click', async () => {
        // 先把未保存内容落盘，确保外部软件读到最新
        if (tab.dirty && tab.filePath) {
          toast('正在保存当前内容…');
          await this.saveTab(tab).catch(() => {});
        }
        if (!tab.filePath) { toast('当前标签没有已保存的文件'); return; }
        // 自创格式 → 转换为目标软件可读的原生格式（xlsx/pptx/png），回传时自动转回
        let launchPath = tab.filePath;
        try {
          const { prepareForExternalOpen } = await import('../lib/extern-convert.js');
          const prep = await prepareForExternalOpen(tab, modules.instances.get(tab.id), app);
          launchPath = prep.launchPath;
          if (prep.converted) toast(`已转换为 .${prep.outExt} 供 ${app.name} 打开`);
        } catch (e) { toast('格式转换失败：' + e.message); return; }
        const r = await window.mazz.invoke('apps:launch', { exe: app.exe, args: [launchPath] }).catch(() => ({ ok: false }));
        toast(r.ok ? `已用 ${app.name} 打开（外部保存后这边自动同步）` : `拉起 ${app.name} 失败`);
      });
      g.appendChild(btn);
    }
    // 手动添加入口（所有外部打开的兜底：手动寻路 + 自定义命名）
    const addBtn = document.createElement('button');
    addBtn.className = 'rb-btn';
    addBtn.innerHTML = `<i class="ico">${iconHtml('✚')}</i><span style="max-width:none">添加应用…</span>`;
    addBtn.title = '手动寻路添加外部应用（可自定义显示名称）';
    addBtn.addEventListener('click', () => {
      editCustomAppDialog({ category, onSaved: () => this.ribbon?.showPage?.(this.ribbon.activePage) });
    });
    g.appendChild(addBtn);
    panel.appendChild(g);
  }

  /** W58d 大文件降级通道：ProseMirror 无虚拟化=整树渲染此量级必卡死（8.3MB/10万行 md 打开即渲染进程崩落实锤）——
   *  降级走 Monaco（虚拟化+自带 largeFileOptimizations，官方大文件姿势）；docx 走 mammoth extractRawText 轻提取 */
  async openLargeFile(filePath, ext, size) {
    const name = filePath.split(/[\\/]/).pop();
    const mb = (size / 1048576).toFixed(1);
    let content;
    if (ext === 'docx') {
      toast(`大文档降级：${name}（${mb}MB）以纯文本轻快打开——富文本解析此量级必卡死，如需排版请分段处理`, [], 6000);
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: filePath });
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { extractRawTextFromDocx } = await import('../modules/markdown/docx-io.js');
      content = await extractRawTextFromDocx(bytes.buffer);
    } else {
      toast(`大文件降级：${name}（${mb}MB）以轻快编辑器打开——富文本引擎整树渲染此量级必卡死`, [], 6000);
      content = await window.mazz.invoke('fs:readFile', { path: filePath });
    }
    const { tab, inst } = this.openTab('code', { title: name, filePath, content });
    if (inst?.def.setLanguage) {
      const lang = ext === 'docx' ? 'plaintext' : (inst.def.langOfPath?.(filePath) || 'plaintext');
      inst.def.setLanguage(lang, inst.state);
    }
    tab.forceClose = false;
    this.tabs.setDirty(tab.id, false);
    await window.mazz?.invoke('recent:add', { path: filePath });
    this.fileTree.markActive(filePath);
    this.syncTitle();
  }

  async openFile(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const moduleId = EXT_MODULE[ext] || 'text';
    // W58d 大文件降级闸：md/txt/mazz 超 1.5MB / docx 超 3MB 一律走降级通道（富文本引擎卡死防线）
    if (['md', 'markdown', 'mazz', 'txt', 'docx'].includes(ext)) {
      const st = await window.mazz.invoke('fs:stat', { path: filePath }).catch(() => null);
      if (st?.size > (ext === 'docx' ? 3 * 1024 * 1024 : 1.5 * 1024 * 1024)) return this.openLargeFile(filePath, ext, st.size);
    }
    // epub/cbz/mobi/azw3：进书库入库打开（原来是当文本打开成乱码）
    if (ext === 'epub' || ext === 'cbz' || ext === 'mobi' || ext === 'azw3') {
      const name0 = filePath.split(/[\\/]/).pop();
      const { tab } = this.openTab('library', { title: name0, filePath, content: '' });
      tab.forceClose = false;
      this.tabs.setDirty(tab.id, false);
      const libInst = modules.instances.get(tab.id);
      await libInst?.def.importPath?.(filePath, libInst.state);
      await window.mazz?.invoke('recent:add', { path: filePath });
      this.fileTree.markActive(filePath);
      this.syncTitle();
      return;
    }
    // OPML/FreeMind/XMind：导图格式导入（v37；v45 改确定性管道——先解析再开签，
    // 旧流程开空签再延时 350ms 投 __activeMindmapCtl，慢机/他签激活时投空或投错签=打开为空）
    if (ext === 'opml' || ext === 'mm' || ext === 'xmind') {
      const name2 = filePath.split(/[\/]/).pop();
      try {
        const { parseMindmapFile } = await import('../modules/mindmap/formats.js');
        let data;
        if (ext === 'xmind') {
          const b64 = await window.mazz.invoke('fs:readFileBase64', { path: filePath });
          const bin = atob(b64);
          data = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        } else {
          data = await window.mazz.invoke('fs:readFile', { path: filePath });
        }
        const doc = await parseMindmapFile(name2, data);
        const { tab: t2 } = this.openTab('mindmap', { title: name2, filePath, content: JSON.stringify({ parentLinks: [], notes: [], refLines: [], ...doc }) });
        t2.forceClose = false;
        this.tabs.setDirty(t2.id, false);
      } catch (e) { toast('导图导入失败：' + e.message); return; }
      await window.mazz?.invoke('recent:add', { path: filePath });
      this.fileTree.markActive(filePath);
      this.syncTitle();
      return;
    }
    // 图片/PDF：查看器模块按路径读二进制，不走文本通道（否则打开全是乱码）
    if (moduleId === 'viewer') {
      const name = filePath.split(/[\\/]/).pop();
      // 已开则激活（此前一律新开签：同一文件连开 N 个查看器签的温床）
      for (const leaf of this.paneTree.leaves()) {
        const exist = leaf.tabs.tabs.find(t => t.filePath === filePath && t.moduleId === 'viewer');
        if (exist) {
          leaf.tabs.activate(exist.id);
          this.paneTree.setActive(leaf);
          this.fileTree.markActive(filePath);
          this.syncTitle();
          return;
        }
      }
      const { tab } = this.openTab('viewer', { title: name, filePath, content: { path: filePath } });
      tab.forceClose = false;
      this.tabs.setDirty(tab.id, false);
      await window.mazz?.invoke('recent:add', { path: filePath });
      this.fileTree.markActive(filePath);
      this.syncTitle();
      return;
    }
    let content = '';
    try {
      if (ext === 'xlsx' || ext === 'docx' || ext === 'pptx') {
        const b64 = await window.mazz.invoke('fs:readFileBase64', { path: filePath });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (ext === 'pptx') {
          const { pptxToOutline } = await import('../modules/slide/pptx-import.js');
          content = await pptxToOutline(bytes.buffer);
        } else {
          content = ext === 'xlsx' ? { __xlsx: bytes.buffer } : { __docx: bytes.buffer };
        }
      } else {
        content = await window.mazz.invoke('fs:readFile', { path: filePath });
      }
    }
    catch (e) { toast(`打开失败：${e.message}`); return; }
    const name = filePath.split(/[\\/]/).pop();
    const { tab, inst } = this.openTab(moduleId, { title: name, filePath, content });
    if (moduleId === 'code' && LANGUAGE_BY_EXT[ext] && inst?.def.setLanguage) {
      inst.def.setLanguage(LANGUAGE_BY_EXT[ext], inst.state);
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
    if (inst.def.readOnly) { toast('查看器是只读模块，无需保存'); return false; } // 防呆：空内容写回媒体文件
    let target = tab.filePath;
    if (saveAs || !target) {
      target = await window.mazz.invoke('dialog:saveFile', {
        // 文件名框不带默认后缀——系统对话框按所选格式自动补（整个软件统一）
        defaultPath: (tab.filePath || tab.title).replace(/\.[^.]*$/, ''),
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
    try { inst.state.filePath = target; } catch {} // 同步模块实例路径（此前只更 tab.filePath：调试/外部打开等读实例路径的功能全是盲的）
    // W58 语言链根治②：保存后按扩展名同步 code 模块语言（保存为 .py 后 RUNNERS 仍 plaintext=无法运行的总根）
    if (inst.name === 'code') {
      const l = inst.def.langOfPath?.(target);
      if (l) { try { inst.state.language = l; } catch {} }
    }
    this.tabs.setDirty(tab.id, false);
    snapshots.untrack(tab.id);
    snapshots.track(tab.id, () => ({ filePath: target, moduleId: inst.name, content: safeGet(() => inst.def.getContent(inst.state)) }));
    await window.mazz?.invoke('recent:add', { path: target });
    this.syncTitle();
    toast(`已保存 ${target.split(/[\\/]/).pop()}`);
    return true;
  }

  /** 关闭指定路径（或其父路径）已删除的全部标签（虚空标签清扫；含目录级联） */
  closeGhostTabs(path) {
    const norm = String(path || '').replace(/\\/g, '/');
    if (!norm) return;
    let closed = 0;
    for (const leaf of this.paneTree.leaves()) {
      for (const tab of [...leaf.tabs.tabs]) {
        const fp = String(tab.filePath || '');
        if (fp && (fp === norm || fp.startsWith(norm + '/'))) {
          tab.forceClose = true;
          modules.detach(tab.id);
          snapshots.untrack(tab.id);
          leaf.tabs.close(tab.id, { force: true });
          closed++;
        }
      }
    }
    if (closed) toast(`已关闭 ${closed} 个已删除文件的标签`);
    return closed;
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
    this.statusbar.set(`${inst.def.icon ? iconHtml(inst.def.icon) + ' ' : ''}${inst.def.displayName}`,
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
    // ==================== W58b 解压缩：命令族 ====================
    const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'jar', 'apk', '7zip', 'cab']);
    this.isArchivePath = (p) => ARCHIVE_EXTS.has((p.split('.').pop() || '').toLowerCase());
    // W66：ctxmenuPick 无载荷直执——解构必须带默认（undefined 炸=哑火实锤）+无目标人话提示
    const archTarget = (p) => {
      const fp = p || this.fileTree.selected?.path;
      if (!fp) toast('请先在文件树选中压缩包或目标文件/文件夹', [], 4000);
      return fp;
    };
    R('archive.view', { title: '查看压缩包内容', icon: '📦', group: '压缩包', when: 'treeArchive', run: ({ path: p } = {}) => {
      const fp = archTarget(p);
      if (!fp) return;
      window.mazz.invoke('panel:action', { type: 'archiveStash', path: fp }).catch(() => {});
      window.mazz.invoke('panel:open', { kind: 'archive' }).catch(() => {});
    } });
    R('archive.openPanel', { title: '压缩包面板', icon: '📦', group: '压缩包', run: () => {
      // W66：面板可发现化——选中压缩包则直开清单，未选中开空态面板（带「打开压缩包…」门）
      const fp = this.fileTree.selected?.path;
      if (fp && this.isArchivePath(fp)) window.mazz.invoke('panel:action', { type: 'archiveStash', path: fp }).catch(() => {});
      window.mazz.invoke('panel:open', { kind: 'archive' }).catch(() => {});
    } });
    R('archive.extractHere', { title: '解压缩到此处', icon: '📂', group: '压缩包', when: 'treeArchive', run: async ({ path: p } = {}) => {
      const fp = archTarget(p);
      if (!fp) return;
      const dest = fp.replace(/[\\/][^\\/]+$/, '');
      const r = await window.mazz.invoke('archive:extract', { path: fp, dest }).catch(e => ({ error: e.message }));
      if (r?.jobId) toast('已排入解压队列（最多 2 并发）——进度见压缩包面板', [], 4000);
      else toast('解压失败：' + (r?.error || '未知'), [], 4000);
    } });
    R('archive.extractSub', { title: '解压缩到「包名」子文件夹', icon: '🗀', group: '压缩包', when: 'treeArchive', run: async ({ path: p } = {}) => {
      const fp = archTarget(p);
      if (!fp) return;
      const dir = fp.replace(/[\\/][^\\/]+$/, '');
      const base = (fp.split(/[\\/]/).pop() || 'out').replace(/\.[^.]+$/, '');
      const r = await window.mazz.invoke('archive:extract', { path: fp, dest: dir + '/' + base }).catch(e => ({ error: e.message }));
      if (r?.jobId) toast('已排入解压队列（最多 2 并发）——进度见压缩包面板', [], 4000);
      else toast('解压失败：' + (r?.error || '未知'), [], 4000);
    } });
    R('archive.pack', { title: '压缩为 zip…', icon: '🗜', group: '压缩包', run: async ({ path: p } = {}) => {
      const fp = archTarget(p);
      if (!fp) return;
      const dir = fp.replace(/[\\/][^\\/]+$/, '');
      const base = fp.split(/[\\/]/).pop() || 'pack';
      let out = `${dir}/${base}.zip`;
      for (let i = 1; ; i++) {
        const ex = await window.mazz.invoke('fs:stat', { path: out }).catch(() => null);
        if (!ex || ex.exists === false) break;
        out = `${dir}/${base}-${i}.zip`;
      }
      const r = await window.mazz.invoke('archive:pack', { sources: [fp], out }).catch(e => ({ error: e.message }));
      if (r?.jobId) toast('已排入打包队列（最多 2 并发）', [], 3000);
      else toast('打包失败：' + (r?.error || '未知'), [], 4000);
    } });
    R('file.newBrowser', { title: '打开浏览器', icon: '🌐', group: '文件', run: () => this.openTab('browser', { title: '隐私浏览器', content: '' }) });
    R('file.newCode', { title: '新建代码文件', icon: '💻', group: '文件', run: () => this.openTab('code', { title: '未命名.js', content: CODE_SAMPLE }) });
    R('file.newMath', { title: '打开计算器', icon: '🧮', group: '文件', run: () => this.openTab('math', { title: '计算 REPL', content: '' }) });
    R('file.newNotes', { title: '打开笔记库', icon: '📓', group: '文件', run: () => this.openTab('notes', { title: '笔记', content: '' }) });
    R('file.newSearch', { title: '全局搜索', icon: '🔎', group: '文件', run: () => this.openTab('search', { title: '全局搜索', content: '' }) });
    R('file.newMindmap', { title: '新建思维导图', icon: '🧠', group: '文件', run: () => this.openTab('mindmap', { title: '未命名.mindmap', content: '' }) });
    R('file.newViewer', { title: '新建播放器（无视频启动）', icon: '🎬', group: '文件', run: () => this.openTab('viewer', { title: '播放器', content: '' }) }); // W44：裸播放器起手——侧栏三源选源即播
    R('file.newDraw', { title: '新建画板', icon: '🎨', group: '文件', run: () => this.openTab('draw', { title: '未命名.mazzdraw', content: '' }) });
    R('file.newLibrary', { title: '打开书库', icon: '📚', group: '文件', run: () => this.openTab('library', { title: '书库', content: '' }) });
    R('file.open', {
      title: '打开文件…', icon: '📂', group: '文件', run: async () => {
        const p = await window.mazz.invoke('dialog:openFile', {});
        if (p) await this.openFile(p);
      },
    });
    R('file.openPath', { title: '打开路径', run: async ({ path: p } = {}) => { if (p) await this.openFile(p); } });
    R('file.openViewer', {
      title: '查看器预览…（图片/PDF/音视频）', icon: '🖼', group: '文件', run: async () => {
        const p = await window.mazz.invoke('dialog:openFile', {
          filters: [
            { name: '可预览文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf', 'mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        });
        if (p) await this.openFile(p);
      },
    });
    R('player.open', {
      title: '打开播放器…（音视频）', icon: '🎬', group: '文件', run: async () => {
        const p = await window.mazz.invoke('dialog:openFile', {
          filters: [{ name: '音视频', extensions: ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'mp3', 'wav', 'oga', 'm4a', 'aac', 'flac', 'opus', 'ogg'] }],
        });
        if (p) await this.openFile(p);
      },
    });
    R('file.openWithSystem', {
      title: '用系统默认程序打开…', icon: '🚀', group: '文件', when: 'hasWorkspace || electron', run: async () => {
        const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '所有文件', extensions: ['*'] }] });
        if (!p) return;
        if (!window.mazz?.isElectron) { toast('系统默认打开仅桌面版可用'); return; }
        const r = await window.mazz.invoke('shell:openPath', { path: p }).catch(e => e.message || e);
        if (r !== true) toast('外部打开失败：' + r);
      },
    });
    R('file.save', { title: '保存', icon: '💾', group: '文件', when: 'hasTabs', run: () => this.tabs.active && this.saveTab(this.tabs.active) });
    R('file.saveAs', { title: '另存为…', group: '文件', when: 'hasTabs', run: () => this.tabs.active && this.saveTab(this.tabs.active, { saveAs: true }) });
    R('file.closeTab', { title: '关闭当前标签', group: '文件', when: 'hasTabs', run: () => this.closeTabFlow(this.tabs.activeId) });
    R('file.print', { title: '打印…', icon: '🖨', group: '文件', when: 'hasTabs', run: () => window.mazz.invoke('print:print') });
    R('file.exportPDF', {
      title: '导出为 PDF…', group: '文件', when: 'hasTabs', run: async () => {
        const tab = this.tabs.active;
        const mod = tab?.moduleId;
        // 专用管线：直接打主窗口会把网格/画布打成空白，必须走各模块分页 HTML（离屏窗导 PDF）
        try {
          if (mod === 'sheet' || mod === 'slide' || mod === 'markdown' || mod === 'text' || mod === 'notes') {
            const target = await window.mazz.invoke('dialog:saveFile', {
              defaultPath: (tab?.title || '文档').replace(/\.[^.]*$/, '') + '.pdf',
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
            }).catch(() => null);
            if (!target) return;
            const { buildPrintDocument } = await import('../lib/print-preview.js');
            let setup = { size: 'A4', orientation: 'portrait', margins: { top: 20, right: 20, bottom: 20, left: 20 }, pageno: true };
            let pages = [];
            if (mod === 'sheet') {
              const ctl = window.__activeSheetCtl;
              if (!ctl?.sheet) throw new Error('表格未就绪');
              const { buildSheetPages } = await import('../modules/sheet/print.js');
              setup = ctl.printSetup || { size: 'A4', orientation: 'landscape', margins: { top: 15, right: 15, bottom: 15, left: 15 }, pageno: true };
              pages = buildSheetPages(ctl.sheet, setup);
              if (!pages.length) { toast('表格没有内容'); return; }
            } else if (mod === 'slide') {
              const ctl = window.__activeSlideCtl;
              if (!ctl?.slides?.length) throw new Error('演示未就绪');
              const { buildSlidePages } = await import('../modules/slide/print.js');
              setup = ctl.printSetup || { size: 'A4', orientation: 'landscape', margins: { top: 8, right: 8, bottom: 8, left: 8 }, pageno: false };
              pages = buildSlidePages(ctl.slides, ctl.theme);
            } else {
              // 文档类：取编辑器渲染 HTML，本地图片内联为 data:（离屏沙盒窗读不到 file://）
              const ctl = window.__activeMarkdownCtl;
              const dom = ctl?.view?.dom;
              const pm = dom ? (dom.classList.contains('ProseMirror') ? dom : dom.querySelector('.ProseMirror')) : null;
              let inner = pm ? pm.innerHTML : `<pre style="white-space:pre-wrap">${String(ctl?.getContent?.() || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</pre>`;
              const ws = await window.mazz.invoke('workspace:get').catch(() => null);
              const imgs = [...inner.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/g)].map(m => m[0] && m[1]).filter(s => /^file:\/\/|^(?!https?:|data:|blob:)/.test(s));
              for (const src of imgs.slice(0, 30)) {
                let p = src.startsWith('file://') ? decodeURIComponent(src.slice(7)) : (ws ? ws + '/' + src.replace(/^\.\//, '') : null);
                if (!p) continue;
                try {
                  const b64 = await window.mazz.invoke('fs:readFileBase64', { path: p });
                  inner = inner.split(src).join(`data:image/${p.split('.').pop().replace(/jpg/i, 'jpeg')};base64,${b64}`);
                } catch {}
              }
              pages = [`<div class="md-body" style="font-size:12pt;line-height:1.8">${inner}</div>`];
            }
            const html = buildPrintDocument({
              title: tab?.title || '文档', setup,
              pagesHtml: pages.map(i => `<div class="sheet">${i}</div>`).join(''),
            });
            const p = await window.mazz.invoke('print:html', { html, setup, toPdf: true, defaultPath: target });
            if (p) toast(`PDF 已导出：${String(p).split(/[\\/]/).pop()}`);
            return;
          }
        } catch (e) { toast('PDF 导出失败：' + e.message); return; }
        // 其余模块：整窗打印兜底
        const p = await window.mazz.invoke('print:toPDF', { savePath: null });
        if (p) toast(`PDF 已导出：${p}`);
      },
    });
    R('file.share', {
      title: '发送到工作软件…', icon: '📤', group: '文件', when: 'hasTabs', run: async () => {
        const { shareActiveFile } = await import('../lib/share.js');
        await shareActiveFile(this);
      },
    });
    R('file.import', {
      title: '导入到工作区…', icon: '📥', group: '文件', run: async () => {
        const paths = await window.mazz.invoke('dialog:openImport').catch(() => []);
        if (paths?.length) await this.importExternal(paths);
      },
    });
    R('sheet.printPreview', {
      title: '打印预览…（表格）', icon: '🖨', group: '输出', when: "module=='sheet'", run: async () => {
        const ctl = window.__activeSheetCtl;
        if (!ctl) return;
        const { openSheetPrintPreview } = await import('../modules/sheet/print.js');
        const tab = this.tabs.active;
        openSheetPrintPreview(ctl, tab?.title || '工作表');
      },
    });
    R('slide.printPreview', {
      title: '打印预览…（演示）', icon: '🖨', group: '输出', when: "module=='slide'", run: async () => {
        const ctl = window.__activeSlideCtl;
        if (!ctl) return;
        const { openSlidePrintPreview } = await import('../modules/slide/print.js');
        const tab = this.tabs.active;
        openSlidePrintPreview(ctl, tab?.title || '演示文稿');
      },
    });
    R('markdown.toMindmap', {
      title: '提取标题结构为思维导图', icon: '🧠', group: '桥接', when: "module=='markdown'", run: async () => {
        const inst = [...modules.instances.values()].find(i => i.name === 'markdown');
        if (!inst) { toast('先打开一个文档'); return; }
        const text = inst.def.getContent(inst.state) || '';
        const { createNode } = await import('../modules/mindmap/model.js');
        // 按 # / ## / ### 提取层级；无标题时用文件名作根
        const roots = [];
        const stack = [];
        for (const line of text.split(/\r?\n/)) {
          const m = /^(#{1,6})\s+(.*)$/.exec(line.trim());
          if (!m) continue;
          const level = m[1].length;
          const node = createNode(m[2].trim());
          while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
          if (stack.length) stack[stack.length - 1].node.children.push(node);
          else roots.push(node);
          stack.push({ level, node });
        }
        if (!roots.length) roots.push(createNode(inst.state.title?.replace(/\.[^.]*$/, '') || '未命名'));
        const doc = { v: 3, mode: 'lr', scheme: 0, roots, notes: [], refLines: [], parentLinks: [], linkStyle: null };
        this.openTab('mindmap', { title: (inst.state.title || '文档').replace(/\.[^.]*$/, '') + '.mindmap', content: JSON.stringify(doc) });
        toast('已生成思维导图');
      },
    });
    R('rec.screen', {
      title: '全局内录（窗口/混音/变速）…', icon: '⏺', group: '工具', run: () => this.openScreenRecorderDialog(),
    });
    R('apps.rescanQuickLaunch', {
      title: '重新扫描已安装软件（外部打开列表）', icon: '🔄', group: '工具', run: async () => {
        const r = await window.mazz.invoke('apps:quickLaunch', { refresh: true }).catch(() => null);
        toast(r?.apps?.length ? `发现 ${r.apps.length} 个可用软件` : '未发现可用软件（或非 Windows 平台）');
      },
    });
    R('file.quickOpen', { title: '快速跳转（最近/项目文件）', icon: '⚡', group: '文件', run: () => {
      // W53：命令面板子窗格文件页（DOM palette.open('files') 浏览器前台必被压——漏网收编）
      if (window.mazz?.isElectron) {
        this._paletteInitTab = 'files';
        window.mazz.invoke('panel:open', { kind: 'palette' }).catch(() => palette.open('files'));
        return;
      }
      palette.open('files');
    } });
    // —— 智能创作（Factory，右侧工具坞承载）——
    R('factory.copyMantra', { title: '新建立项并复制模板母版', icon: '📋', group: '智能创作', run: () => this.sideDock?.factoryPanel?.openProjectWizard() });
    R('factory.generate', { title: '新建立项并开始创作', icon: '⚡', group: '智能创作', run: () => this.sideDock?.factoryPanel?.openProjectWizard() });
    R('factory.runAll', { title: '全部启动创作任务', icon: '▶', group: '智能创作', run: () => this.sideDock?.factoryPanel?.runAllTasks() });
    R('factory.newGenre', { title: '新建创作模板', icon: '✚', group: '智能创作', run: () => this.sideDock?.factoryPanel?.openGenreEditor() });
    R('factory.provider', { title: 'AI 服务设置（智能创作）', icon: '⚙', group: '智能创作', run: () => this.sideDock?.factoryPanel?.openProviderDialog() });
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
    R('view.zoomReset', { title: '重置缩放', group: '视图', run: () => {
      resetAllPaneZooms(); // 全局与窗格缩放一起回 100%
      this.setZoom(1);
    } });
    R('annotate.toggle', {
      title: '全局批注（悬浮手写外套）', icon: '✍', group: '工具', run: async () => {
        // W52④ 分路：浏览器页（WebContentsView 原生层压 DOM）走透明墨迹子窗；其余模块保 DOM 老层（久经考验）
        if (window.mazz?.isElectron && contextKeys.get('module') === 'browser') {
          const opened = await window.mazz.invoke('panel:open', { kind: 'annotate' }).catch(() => null);
          if (opened?.ok) { toast('批注模式（墨迹子窗）：直接圈画（Esc 退出）'); return; }
          if (opened?.already) { await window.mazz.invoke('panel:close', { kind: 'annotate' }).catch(() => {}); toast('已退出批注'); return; }
        }
        const { toggleAnnotate } = await import('../lib/annotate.js');
        const on = toggleAnnotate();
        toast(on ? '批注模式：直接圈画（Esc 退出，Ctrl+Z 撤销）' : '已退出批注');
      },
    });
    R('annotate.clear', {
      title: '批注清屏', icon: '⌫', group: '工具', run: async () => {
        const { clearAnnotate } = await import('../lib/annotate.js');
        clearAnnotate();
        toast('批注已清屏');
      },
    });
    R('view.cycleTheme', {
      title: '轮换主题', icon: '🎨', group: '视图', run: async () => {
        // 「图片自定义」不参与循环；自定义主题包参与循环
        const all = await this.allThemes();
        const cycle = all.filter(t => t.id !== 'custom');
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
    R('tab.moveToExistingWindow', {
      title: '移到已有外部窗格…', icon: '🪟', group: '标签', when: "hasTabs && windowRole!='child'", run: async () => {
        const tabId = this.tabs.activeId;
        if (!tabId) return;
        const wins = await window.mazz.invoke('window:listChildren').catch(() => []);
        if (!wins.length) { toast('还没有外部窗格（可「移到新窗口」先建一个）'); return; }
        const { showDomMenu } = await import('../lib/dom-menu.js');
        const items = wins.map(w => ({
          label: `${w.title || '外部窗格'} #${w.id}`,
          fn: () => this.moveTabToNewWindow(tabId, { childId: w.id }),
        }));
        const r = { left: innerWidth / 2 - 100, bottom: 160 };
        showDomMenu(items, r.left, r.bottom);
      },
    });
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
    R('app.commandPalette', { title: '命令面板', icon: '⌘', group: '应用', run: () => {
      // W52③ 薄子窗（Quick Open 体感——不占主窗 DOM 零遮盖；网页预览留内嵌兜底）
      if (window.mazz?.isElectron) { window.mazz.invoke('panel:open', { kind: 'palette' }).catch(() => palette.open('commands')); return; }
      palette.open('commands');
    } });
    R('app.openSettings', { title: '设置…', icon: '⚙', group: '应用', run: () => {
      // W53 全原生独立子窗格（应用壳 lean 路线退役；网页预览留 modal 兜底）
      if (window.mazz?.isElectron) { window.mazz.invoke('panel:open', { kind: 'settings' }).catch(() => this.openSettingsModal()); return; }
      this.openSettingsModal();
    } });
    R('app.language', { title: '界面语言设置 (Language)', icon: '🌐', group: '应用', run: () => {
      if (window.mazz?.isElectron) { window.mazz.invoke('panel:open', { kind: 'settings' }).catch(() => this.openSettingsModal()); return; }
      this.openSettingsModal();
    } });
    R('app.toggleSpellcheck', { title: '开关拼写检查', group: '应用', run: async () => {
      if (!window.mazz?.isElectron) { toast('浏览器预览模式无拼写检查服务'); return; }
      const cur = await window.mazz.invoke('settings:get', { key: 'spellcheckEnabled' });
      await window.mazz.invoke('spell:setEnabled', { enabled: !cur });
      this.statusbar.setSpell(!cur);
      toast(!cur ? '拼写检查已开启' : '拼写检查已关闭');
    } });
    R('app.shortcutSheet', { title: '快捷键速查表', group: '应用', run: () => {
      // W52③ 薄子窗（同上）
      if (window.mazz?.isElectron) { window.mazz.invoke('panel:open', { kind: 'shortcuts' }).catch(() => this.openShortcutSheet()); return; }
      this.openShortcutSheet();
    } });
    R('app.about', { title: '关于 Mazz Editor', group: '应用', run: () => toast('Mazz Editor v0.1.0 · 榨干 Electron 的一站式超级编辑器（第一阶段构建）') });

    // —— 目录树命令 ——
    R('fileTree.newFile', { title: '新建文件', group: '目录树', run: () => this.newFileInTree() });
    R('fileTree.newFolder', { title: '新建文件夹', group: '目录树', run: () => this.newFolderInTree() });
    R('fileTree.openManga', { title: '作为漫画打开', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (!p) return;
      const { tab } = this.openTab('library', { title: p.split(/[\\/]/).pop(), filePath: p, content: '' });
      const inst = modules.instances.get(tab.id);
      await inst?.def.importMangaFolderPath?.(p, inst.state);
    } });
    R('fileTree.open', { title: '打开', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (p) await this.openFile(p);
    } });
    R('fileTree.rename', { title: '重命名…', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (!p) return;
      // 命名框不带后缀（文件保留原后缀；文件夹无后缀概念）
      const base = p.split(/[\\/]/).pop();
      const isDir = contextKeys.get('treeIsDir');
      const dot = base.lastIndexOf('.');
      const stem = (!isDir && dot > 0) ? base.slice(0, dot) : base;
      const ext = (!isDir && dot > 0) ? base.slice(dot) : '';
      const name = await inputModal(`重命名${ext ? `（后缀 ${ext} 不变）` : ''}`, stem);
      if (!name?.trim()) return;
      const to = p.split(/[\\/]/).slice(0, -1).concat(name.trim() + ext).join('/');
      await window.mazz.invoke('fs:rename', { from: p, to });
      bus.emit('filetree:renamed', { from: p, to });
      await this.fileTree.refresh();
    } });
    R('fileTree.delete', { title: '删除（回收站）', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (!p) return;
      const r = await window.mazz.invoke('dialog:confirm', { title: '删除', message: `将「${p.split(/[\\/]/).pop()}」移入回收站？`, buttons: ['删除', '取消'] });
      if (r === 0) {
        try {
          const res = await window.mazz.invoke('fs:delete', { path: p });
          if (res && res.trashed === false) toast('回收站不可用，已直接删除（文件被占用）');
          this.closeGhostTabs(p); // 虚空标签即扫（watcher 的 unlink 是第二道）
        } catch (e) { toast('删除失败：' + e.message); }
        await this.fileTree.refresh();
      }
    } });
    R('fileTree.copyPath', { title: '复制路径', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (p) { await window.mazz.invoke('clipboard:write', { text: p }); toast('路径已复制'); }
    } });
    R('fileTree.closeDir', { title: '关闭文件夹', group: '目录树', run: async () => {
      const p = contextKeys.get('treePath');
      if (!p || !contextKeys.get('treeIsDir')) return;
      await this.fileTree.closeDir(p);
    } });
    R('fileTree.showInFolder', { title: '在文件夹中显示', group: '目录树', run: () => {
      const p = contextKeys.get('treePath');
      if (p) window.mazz.invoke('shell:showItemInFolder', { path: p });
    } });
    // —— 资源管理器式：剪切/复制/粘贴/刷新 ——
    R('fileTree.cut', { title: '剪切', group: '目录树', run: () => this.fileTree.cutCopy('cut') });
    R('fileTree.copy', { title: '复制', group: '目录树', run: () => this.fileTree.cutCopy('copy') });
    R('fileTree.paste', { title: '粘贴', group: '目录树', run: () => this.fileTree.paste() });
    R('fileTree.refresh', { title: '刷新', group: '目录树', run: () => this.fileTree.refresh() });

    // W58b 树拖即开/树拖图即插：文件树文件拖到主窗格直接打开；图片落 markdown 窗格=直接插图
    this.panesEl.addEventListener('dragover', (e) => {
      if (e.target.closest?.('.tabbar')) return; // 标签栏归移签
      if (e.dataTransfer?.types?.includes('text/plain') && !e.dataTransfer.types.includes('mazz/tab')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.panesEl.addEventListener('drop', async (e) => {
      if (e.target.closest?.('.tabbar')) return;
      if (e.dataTransfer?.types?.includes('mazz/tab')) return;
      const p = e.dataTransfer?.getData('text/plain');
      if (!p || (!p.includes(':') && !p.startsWith('/'))) return;
      e.preventDefault();
      e.stopPropagation();
      const ext = (p.split('.').pop() || '').toLowerCase();
      // 树拖图即插：图片 + 落点窗格为 markdown → 插图（mazz-res 绝对径，与 insertImage 同径）
      if (/^(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(ext)) {
        const leaf = this.paneTree.leaves().find(l => l.el.contains(e.target)) || this.paneTree.active;
        const tab = leaf?.tabs?.active;
        const inst = tab && modules.instances.get(tab.id);
        // 坐标闸：合成事件/异形拖拽可无有限坐标——退化选区头（posAtCoords 收到非有限值=pageerror 实锤）
        const coords = Number.isFinite(e.clientX) && Number.isFinite(e.clientY) ? { x: e.clientX, y: e.clientY } : null;
        if (inst?.name === 'markdown') { await this.insertImageToMarkdown(inst, p, coords); return; }
      }
      await this.openFile(p);
    }, true);
    bus.on('tab:requestClose', (id) => this.closeTabFlow(id));
    bus.on('tab:dragOut', (p) => this.moveTabToNewWindow(p?.id ?? p, Number.isFinite(p?.x) ? p : null));
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
    this.syncZoomDisplay();
  }

  /** 活动窗格的内容缩放倍率（无窗格/无缩放 → 1） */
  activePaneZoom() {
    const area = this.paneTree.active?.el.querySelector('.editor-area');
    return area ? paneZoomOf(area) : 1;
  }

  /** 状态栏百分比 = 全局缩放 × 活动窗格缩放 */
  syncZoomDisplay() {
    this.statusbar.setZoom(this.zoom * this.activePaneZoom());
  }

  /** 把标签移交到新窗口（快照内容 → 新窗口开同标签 → 本窗口关闭） */
  async moveTabToNewWindow(tabId, pos = null) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const inst = modules.instances.get(tabId);
    const snapshot = {
      moduleId: tab.moduleId,
      title: tab.title,
      filePath: tab.filePath,
      // 只读查看器：交接路径而非空内容（getContent 返回 ''，子窗要能重新加载）
      content: inst ? (inst.def.readOnly && tab.filePath ? { path: tab.filePath } : inst.def.getContent(inst.state)) : '',
    };
    if (snapshot.content == null) snapshot.content = '';
    try {
      // 指定/拖到既有外部窗格 → 迁入该窗（v33 反馈：只会新建窗格进不去）
      const targetId = pos?.childId || (pos && Number.isFinite(pos.x)
        ? (await window.mazz.invoke('window:childAt', { x: pos.x, y: pos.y }).catch(() => null))?.id
        : null);
      if (targetId) {
        const ok = await window.mazz.invoke('window:toChild', { winId: targetId, handoff: snapshot });
        if (ok) {
          tab.forceClose = true;
          modules.detach(tabId);
          snapshots.untrack(tabId);
          const pane0 = this.paneTree.paneOfTab(tabId);
          await (pane0 ? pane0.tabs : this.tabs).close(tabId, { force: true });
          if (pane0) this.paneTree.onLeafEmpty(pane0);
          toast(`已移入该窗口：${tab.title}`);
          return;
        }
      }
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
    // W52③ 全应用子窗 modal 支路：settings/help/agreement 大 UI 零重写落第二窗
    // W53：openModal/lean 支路全体退役——设置/帮助/协议/翻译/插件/快开/内录全走 panel-windows 全原生子窗格
    if (!snapshot?.moduleId || !modules.get(snapshot.moduleId)) return;
    this.openTab(snapshot.moduleId, {
      title: snapshot.title || '分窗标签',
      filePath: snapshot.filePath || null,
      content: snapshot.content,
    });
    if (snapshot.filePath) await window.mazz?.invoke('recent:add', { path: snapshot.filePath });
  }

  async newFileInTree() {
    const t = this.fileTree.resolveTargetDir();
    if (t.error) { toast(t.error); return; }
    // W58e：新建文件收编全原生独立子窗（漏网之鱼——DOM modal 被视图压的最后一个）
    if (window.mazz?.isElectron) {
      this._newfileDir = t.dir; // 落点选中态 stash（面板开着期间用户可能改选——以开窗瞬间为准）
      window.mazz.invoke('panel:open', { kind: 'newfile' }).catch(() => {});
      return;
    }
    // 类型选择弹窗：办公/创作 + 代码四档全族（二进制办公格式自动生成合法空文档）——非 Electron 兜底
    const ext = await pickNewFileType();
    if (!ext) return;
    // 资源管理器式：自动名落位 + 行内改名（后缀下拉）
    await this.fileTree.startInlineCreate(t.dir, 'file', ext);
  }
  async newFolderInTree() {
    const t = this.fileTree.resolveTargetDir();
    if (t.error) { toast(t.error); return; }
    await this.fileTree.startInlineCreate(t.dir, 'folder');
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

    // —— 模块快建系列：Ctrl+Alt+Shift+字母（系统/主流软件均不占，与软件内既有键位不撞）——
    K('ctrl+alt+shift+m', 'file.new');        // 新建文档（Markdown）
    K('ctrl+alt+shift+e', 'file.newSheet');   // 新建表格（shEet）
    K('ctrl+alt+shift+p', 'file.newSlide');   // 新建演示（PPT）
    K('ctrl+alt+shift+b', 'file.newBrowser'); // 打开浏览器（Browser）
    K('ctrl+alt+shift+c', 'file.newCode');    // 新建代码（Code）
    K('ctrl+alt+shift+r', 'file.newMath');    // 打开计算器（REPL）
    K('ctrl+alt+shift+n', 'file.newNotes');   // 新建笔记（Notes）
    K('ctrl+alt+shift+g', 'file.newMindmap'); // 新建导图（Graph）
    K('ctrl+alt+shift+d', 'file.newDraw');    // 新建画板（Draw）
    K('ctrl+alt+shift+t', 'file.newText');    // 新建纯文本（Text）
    K('ctrl+alt+shift+l', 'file.newLibrary'); // 打开书库（Library）
    K('ctrl+alt+shift+f', 'file.newSearch');  // 全局搜索（Find）
    K('ctrl+alt+shift+o', 'file.open');       // 打开文件（Open）
    K('ctrl+alt+shift+s', 'app.openSettings');// 设置（Settings）
    K('ctrl+alt+shift+a', 'factory.toggleDock'); // 智能创作面板（AI）
    K('ctrl+alt+shift+w', 'dock.openWith');      // 打开方式面板（With）
    K('ctrl+alt+shift+u', 'dock.tools');         // 工具面板（Utilities）
    K('ctrl+alt+shift+k', 'annotate.toggle');    // 全局批注（marKer）
    K('ctrl+alt+shift+x', 'annotate.clear');     // 批注清屏（X）
    K('ctrl+alt+shift+v', 'view.toggleSidebar');  // 工作区折叠展开（V）

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
      { command: 'tab.moveToExistingWindow', group: '4_window', title: '移到已有外部窗格…', when: "hasTabs && windowRole!='child'" },
      { command: 'tab.moveToMainWindow', group: '4_window', title: '移回主窗口', when: "windowRole=='child' && hasTabs" },
    ]);
    // 3 号上下文：文件树·文件
    menus.contribute('fileTree/file', [
      { command: 'fileTree.open', title: '打开', group: '1_open' },
      { command: 'archive.view', title: '查看压缩包内容', group: '1_open', when: 'treeArchive' },
      { command: 'archive.extractHere', title: '解压缩到此处', group: '2_archive', when: 'treeArchive' },
      { command: 'archive.extractSub', title: '解压缩到「包名」子文件夹', group: '2_archive', when: 'treeArchive' },
      { command: 'archive.pack', title: '压缩为 zip…', group: '2_archive' },
      { command: 'fileTree.cut', title: '剪切', group: '2_clip' },
      { command: 'fileTree.copy', title: '复制', group: '2_clip' },
      { command: 'fileTree.paste', title: '粘贴', group: '2_clip', when: 'treeClip' },
      { command: 'fileTree.rename', title: '重命名…（F2）', group: '3_file' },
      { command: 'fileTree.delete', title: '删除（回收站）', group: '3_file' },
      { command: 'fileTree.copyPath', title: '复制路径', group: '4_path' },
      { command: 'fileTree.showInFolder', title: '在文件夹中显示', group: '4_path' },
      { command: 'fileTree.closeDir', title: '关闭文件夹（归入底部已关闭组）', group: '5_close' },
    ]);
    // 4 号上下文：文件树·文件夹
    menus.contribute('fileTree/folder', [
      { command: 'fileTree.openManga', title: '作为漫画打开（图片序列 = 一话）', group: '1_open' },
      { command: 'archive.pack', title: '压缩为 zip…', group: '1_archive' },
      { command: 'fileTree.newFile', title: '新建文件', group: '1_new' },
      { command: 'fileTree.newFolder', title: '新建文件夹', group: '1_new' },
      { command: 'fileTree.cut', title: '剪切', group: '2_clip' },
      { command: 'fileTree.copy', title: '复制', group: '2_clip' },
      { command: 'fileTree.paste', title: '粘贴', group: '2_clip', when: 'treeClip' },
      { command: 'fileTree.rename', title: '重命名…（F2）', group: '3_file' },
      { command: 'fileTree.delete', title: '删除（回收站）', group: '3_file' },
      { command: 'fileTree.copyPath', title: '复制路径', group: '4_path' },
      { command: 'fileTree.showInFolder', title: '在文件夹中显示', group: '4_path' },
      { command: 'fileTree.closeDir', title: '关闭文件夹（归入底部已关闭组）', group: '5_close' },
    ]);
    // 5 号上下文：文件树·空白区（视同工作区根目录）
    menus.contribute('fileTree/blank', [
      { command: 'fileTree.newFile', title: '新建文件', group: '1_new' },
      { command: 'fileTree.newFolder', title: '新建文件夹', group: '1_new' },
      { command: 'fileTree.paste', title: '粘贴', group: '2_clip', when: 'treeClip' },
      { command: 'fileTree.refresh', title: '刷新（F5）', group: '3_view' },
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
      this.syncZoomDisplay(); // 切换窗格/标签时刷新百分比
    });
    bus.on('tab:deactivate', (id) => modules.deactivateTab(id));
    // W58c 分屏穿帮根治：移签跨窗格后——①等布局落稳重同步视图边界（activate 时可能拿到旧几何）
    // ②浏览器页自动刷新（用户定版药方：挪窝的 GPU 表面不重绘=渲染穿帮，reload 强制重画）
    bus.on('pane:tabMoved', ({ tabId }) => {
      const inst = modules.instances.get(tabId);
      if (!inst || inst.name !== 'browser') return;
      setTimeout(() => {
        const ctl = inst.state;
        ctl?.__sync?.();
        const t = ctl?.tabs?.find(x => x.id === ctl.activeId) || ctl?.tabs?.[0];
        if (t && !ctl?._cloaked && !ctl?._dragCloak) ctl.reloadTab?.(t);
      }, 80);
    });
    // 资源管理器右键「导入到 Mazz 工作区」（--import 参数经主进程转发）
    if (window.mazz?.on) window.mazz.on('file:import', ({ paths }) => { if (paths?.length) this.importExternal(paths); });
    // 外部编辑回传：磁盘文件变化 → 打开中的干净标签自动重载（外部软件保存后这边同步更新）
    if (window.mazz?.isElectron && window.mazz?.on) {
      const deb = new Map();
      window.mazz.on('file:changed', ({ path: p }) => {
        if (!p) return;
        // 外部打开的转换文件被保存 → 优先走回传转换
        import('../lib/extern-convert.js').then(m => {
          if (m.handleExternalSave(p)) return;
        }).catch(() => {});
        for (const leaf of this.paneTree.leaves()) {
          for (const tab of leaf.tabs.tabs) {
            if (tab.filePath !== p) continue;
            clearTimeout(deb.get(tab.id));
            deb.set(tab.id, setTimeout(() => this.reloadTabFromDisk(tab), 400));
          }
        }
      });
    }
    // 文件树改名 → 同步所有打开标签的路径与标题（否则保存会写回旧名）
    bus.on('filetree:renamed', ({ from, to }) => {
      const newName = to.split(/[\\/]/).pop();
      for (const leaf of this.paneTree.leaves()) {
        for (const tab of leaf.tabs.tabs) {
          if (tab.filePath === from || (tab.filePath && from && tab.filePath.startsWith(from + '/'))) {
            tab.filePath = to + tab.filePath.slice(from.length);
            tab.title = tab.filePath.split(/[\\/]/).pop() || newName;
            leaf.tabs.render();
          }
        }
      }
    });
    bus.on('tab:empty', () => { contextKeys.set('hasTabs', false); contextKeys.set('module', null); this.syncTitle(); });

    if (window.mazz?.isElectron) {
      window.mazz.on('file:open', async ({ path: p }) => { await this.openFile(p); });
      window.mazz.on('command:invoke', ({ id, payload }) => commands.execute(id, payload));
      window.mazz.on('window:handoff', async (snapshot) => { await this.receiveHandoff(snapshot); });
      window.mazz.on('theme:changed', ({ id }) => { if (id) this.setTheme(id); });
      // W58b 解压缩进度：主进程广播 → 压缩包面板转发 + 完工 toast（面板不开也知情）
      window.mazz.on('archive:progress', (pl) => {
        window.mazz.invoke('panel:push', { kind: 'archive', payload: { type: 'archiveProgress', data: pl } }).catch(() => {});
      });
      window.mazz.on('archive:done', (pl) => {
        window.mazz.invoke('panel:push', { kind: 'archive', payload: { type: 'archiveDone', data: pl } }).catch(() => {});
        if (pl?.ok) { toast('✓ ' + (pl.info || '解压缩完成')); this.fileTree?.refresh?.(); }
        else if (pl && pl.info !== '已取消') toast('✗ ' + (pl.info || '解压缩失败'), [], 4000);
      });
      // W52③ 薄子窗数据桥：paletteQuery/shortcutQuery 答、paletteRun 行
      // W54 B10 拽回吸附提示：进热区主窗右缘亮条
      window.mazz.on('dock:snapHint', ({ on } = {}) => {
        let el = document.querySelector('.dock-snap-hint');
        if (!el) { el = document.createElement('div'); el.className = 'dock-snap-hint'; document.body.appendChild(el); }
        el.classList.toggle('on', !!on);
      });
      // W53 坞浮动联动：dockfloat 子窗格 ✕ 关闭 → 坞回停靠上岗
      window.mazz.on('panel:changed', (pl) => {
        if (pl?.kind === 'dockfloat' && pl.closed) this.sideDock?.backFromFloat?.();
      });
      window.mazz.on('panel:action', async (pl) => {
        if (!pl?.type) return;
        // W61a 只读预览桥：instanceId 即 taskId，读档前由 FactoryPanel 校验任务目录边界。
        if (pl.type === 'factoryPreviewQuery') {
          const fp = this.sideDock?.factoryPanel;
          if (fp) await fp.previewSnapshot(pl.taskId || pl.instanceId, pl.instanceId).catch(() => {});
          return;
        }
        if (pl.type === 'factoryPreviewRead') {
          const fp = this.sideDock?.factoryPanel;
          if (fp) await fp.readPreviewFile(pl.taskId || pl.instanceId, pl.path, pl.instanceId).catch(() => {});
          return;
        }
        if (pl.type === 'factoryPreviewEdit') {
          const fp = this.sideDock?.factoryPanel;
          if (fp) await fp.openTaskEditor(pl.taskId || pl.instanceId, pl.path).catch(() => {});
          return;
        }
        if (pl.type === 'factoryEditQuery') {
          const fp = this.sideDock?.factoryPanel;
          if (fp) await fp.editorSnapshot(pl.taskId || pl.instanceId, pl.instanceId).catch(() => {});
          return;
        }
        if (pl.type === 'factoryEditSave') {
          const fp = this.sideDock?.factoryPanel;
          if (fp) await fp.saveTaskEditor(pl.taskId || pl.instanceId, pl.path, pl.content, pl.instanceId).catch(() => {});
          return;
        }
        // W58c 主题快照桥：面板窗初始化取 id+变量一把抓（预设/主题包/图片自定义通吃——子窗透明化根治）
        if (pl.type === 'themeSnapshot') {
          if (pl.kind) window.mazz.invoke('panel:push', { kind: pl.kind, payload: { type: 'themeInit', ...this._themeVarsSnapshot() } }).catch(() => {});
          return;
        }
        // W58e 新建文件子窗桥：类型目录单源下发（NEW_FILE_TYPES 不复制）+ 落点 stash 行内创建
        if (pl.type === 'newfileQuery') {
          if (pl.kind) window.mazz.invoke('panel:push', { kind: pl.kind, payload: { type: 'newfileTypes', types: NEW_FILE_TYPES } }).catch(() => {});
          return;
        }
        if (pl.type === 'newfilePick') {
          // dir 允许 null（未选中=工作区根——startInlineCreate 自带 `dir ?? getWorkspace()` 回落；门死 null=无选中断粮实锤）
          if (pl.ext) await this.fileTree.startInlineCreate(this._newfileDir ?? null, 'file', pl.ext);
          return;
        }
        // W58i picklist 通用选择格桥（字体/字号收编——数据由 pickers.js 经 window.__picklistPending stash）
        if (pl.type === 'picklistQuery') {
          const d = window.__picklistPending;
          if (pl.kind && d) window.mazz.invoke('panel:push', { kind: pl.kind, payload: { type: 'picklistData', data: { title: d.title, items: d.items, searchable: d.searchable, allowFree: d.allowFree, current: d.current } } }).catch(() => {});
          return;
        }
        if (pl.type === 'picklistPick') {
          const d = window.__picklistPending;
          window.__picklistPending = null;
          if (d?.onPick) d.onPick(pl.value);
          return;
        }
        // W58b 解压缩桥：stash/清单/解压/取消/打包 + 进度转发面板
        if (pl.type === 'archiveStash') { this._archivePath = pl.path; return; }
        if (pl.type === 'archiveQuery') {
          const p = this._archivePath;
          if (pl.kind && p) {
            const r = await window.mazz.invoke('archive:list', { path: p }).catch(e => ({ error: e.message }));
            window.mazz.invoke('panel:push', { kind: pl.kind, payload: { type: 'archiveData', data: r } }).catch(() => {});
          }
          return;
        }
        if (pl.type === 'archiveExtract') {
          const p = this._archivePath;
          if (!p) return { error: '无包' };
          return await window.mazz.invoke('archive:extract', { path: p, dest: pl.dest }).catch(e => ({ error: e.message }));
        }
        if (pl.type === 'archiveCancel') {
          return await window.mazz.invoke('archive:cancel', { jobId: pl.jobId }).catch(e => ({ error: e.message }));
        }
        // W66：面板空态「打开压缩包…」门——对话框选档→stash→回推清单
        if (pl.type === 'archiveOpenDialog') {
          const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '压缩包', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'jar', 'apk', '7zip', 'cab'] }] }).catch(() => null);
          const fp = Array.isArray(p) ? p[0] : p;
          if (fp) {
            this._archivePath = fp;
            const r = await window.mazz.invoke('archive:list', { path: fp }).catch(e => ({ error: e.message }));
            if (pl.kind) window.mazz.invoke('panel:push', { kind: pl.kind, payload: { type: 'archiveData', data: r } }).catch(() => {});
          }
          return;
        }
        // W53 协议面板桥（全原生子窗格：文案单源在 lib/agreement.js，面板页不复制维护）
        if (pl.type === 'agreementQuery') {
          try {
            const { agreementContent } = await import('../lib/agreement.js');
            const c = agreementContent();
            window.mazz.invoke('panel:push', { kind: 'agreement', payload: { type: 'agreement', title: c.title, body: c.body, noMore: c.noMore, closeLabel: c.close, acceptLabel: c.accept } }).catch(() => {});
          } catch {}
          return;
        }
        if (pl.type === 'agreementDone') {
          if (pl.nomore) window.mazz.invoke('settings:set', { key: 'agreement.noMore', value: true }).catch(() => {});
          return;
        }
        // W53 设置面板桥（全原生子窗格：逻辑单源在 openSettingsModal——面板页只渲染，主窗干活）
        if (pl.type === 'settingsQuery') {
          try {
            const { LANGUAGES, getLanguage } = await import('../i18n/index.js');
            const gx = (k) => window.mazz.invoke('settings:get', { key: k }).catch(() => null);
            const all = await this.allThemes();
            const cur = document.documentElement.dataset.theme || 'paper';
            const [closeBehavior, themeSource, quickNoteTarget, spellcheck, autolaunch, searxMc, explorerSt] = await Promise.all([
              gx('closeBehavior'), gx('themeSource'), gx('quickNoteTarget'), gx('spellcheckEnabled'),
              window.mazz.invoke('app:getAutoLaunch').catch(() => false),
              window.mazz.invoke('searx:getMaskedConfig').catch(() => ({})),
              window.mazz.invoke('explorermenu:status').catch(() => null),
            ]);
            window.mazz.invoke('panel:push', { kind: 'settings', payload: {
              type: 'settingsAll', languages: LANGUAGES, lang: getLanguage(),
              closeBehavior: closeBehavior || 'ask', themeSource: themeSource || 'system',
              themes: all, theme: cur, quickNoteTarget: quickNoteTarget || 'daily',
              spellcheck, autolaunch: !!autolaunch,
              explorerRegistered: !!explorerSt?.registered,
              searxMasked: searxMc?.masked || '', searxUser: searxMc?.user || '', searxHasPass: !!searxMc?.hasPass,
            } }).catch(() => {});
          } catch {}
          return;
        }
        if (pl.type === 'settingsSet') {
          try {
            if (pl.key === 'lang') {
              const { setLanguage } = await import('../i18n/index.js');
              await setLanguage(pl.value);
            } else if (pl.key === 'theme') {
              this.setTheme(pl.value); // 广播全窗+面板跟随（主题变窗格变）
            } else if (pl.key === 'themeSource') {
              window.mazz.invoke('theme:setSource', { source: pl.value }).catch(() => {});
            } else if (pl.key === 'spellcheck') {
              await window.mazz.invoke('spell:setEnabled', { enabled: !!pl.value }).catch(() => {});
              this.statusbar.setSpell(!!pl.value);
            } else if (pl.key) {
              window.mazz.invoke('settings:set', { key: pl.key, value: pl.value }).catch(() => {});
            }
          } catch {}
          window.mazz.invoke('panel:push', { kind: 'settings', payload: { type: 'settingsActionResult', act: 'set', reload: true } }).catch(() => {});
          return;
        }
        if (pl.type === 'settingsAction') {
          const back = (act, msg, reload = false) => window.mazz.invoke('panel:push', { kind: 'settings', payload: { type: 'settingsActionResult', act, msg, reload } }).catch(() => {});
          try {
            if (pl.act === 'delTheme') {
              if (!String(pl.id || '').startsWith('pack:')) { back('delTheme', '自带主题不可删除', false); return; }
              const { deletePack } = await import('../lib/theme-store.js');
              await deletePack(String(pl.id).slice(5));
              this.setTheme('paper');
              toast('已删除主题包'); back('delTheme', '已删除主题包', true);
            } else if (pl.act === 'blankPack') {
              const { obtainBlankPack } = await import('../lib/theme-store.js');
              const p = await obtainBlankPack();
              toast('空白主题包已生成：' + p.split('/').pop());
              await this.openFile(p);
              back('blankPack', '已生成空白主题包', true);
            } else if (pl.act === 'importPack') {
              const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '主题包', extensions: ['json'] }] }).catch(() => null);
              if (!p) { back('importPack', '', false); return; }
              const text = await window.mazz.invoke('fs:readFile', { path: p });
              const { importPack } = await import('../lib/theme-store.js');
              const id = await importPack(text, p.split(/[\\/]/).pop());
              this.setTheme('pack:' + id);
              toast('主题包已导入'); back('importPack', '已导入并启用', true);
            } else if (pl.act === 'packFolder') {
              const { themesDir } = await import('../lib/theme-store.js');
              const dir = await themesDir();
              await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
              window.mazz.invoke('shell:showItemInFolder', { path: dir }).catch(() => {});
              back('packFolder', '已打开主题文件夹', false);
            } else if (pl.act === 'imgTheme') {
              const { applyImageTheme } = await import('../theme-custom.js');
              await applyImageTheme();
              back('imgTheme', '', true);
            } else if (pl.act === 'clearRecent') {
              await window.mazz.invoke('recent:clear').catch(() => {});
              this.rebuildFileIndex();
              toast('最近文件已清空'); back('clearRecent', '已清空', false);
            } else if (pl.act === 'autolaunch') {
              const on = await window.mazz.invoke('app:setAutoLaunch', { enabled: !!pl.enabled }).catch(() => !!pl.enabled);
              back('autolaunch', on ? '已开启' : '已关闭', true);
            } else if (pl.act === 'shortcut') {
              const ok = await window.mazz.invoke('app:createDesktopShortcut').catch(() => false);
              back('shortcut', ok ? '✓ 已发送到桌面' : '创建失败', false);
            } else if (pl.act === 'explorerReg') {
              const r = await window.mazz.invoke('explorermenu:register').catch((e) => ({ ok: false, reason: e.message }));
              back('explorerReg', r.ok ? '已注册（若未立刻出现，重启资源管理器）' : ('注册失败：' + (r.reason || '')), true);
            } else if (pl.act === 'explorerUnreg') {
              await window.mazz.invoke('explorermenu:unregister').catch(() => {});
              back('explorerUnreg', '未注册', true);
            } else if (pl.act === 'searxSave') {
              const cur = await window.mazz.invoke('settings:get', { key: 'searx' }).catch(() => null);
              const cfg = { url: pl.url || cur?.url, user: pl.user || cur?.user, pass: pl.pass || cur?.pass };
              try {
                const sc = await window.mazz.invoke('searx:setConfig', cfg);
                back('searxSave', sc.ok ? '✓ 实例连通正常' : '✗ ' + (sc.checks || []).map(c => `${c.name}:${c.detail}`).join('；'), false);
              } catch (e) { back('searxSave', '✗ ' + e.message, false); }
            }
          } catch (e) { back(pl.act || '?', '失败：' + e.message, false); }
          return;
        }
        if (pl.type === 'translateStashInit') { this._translateInitText = String(pl.text || ''); return; }
        // W56 B7 翻译「替换/插入」跨窗桥：主窗对当前编辑器选区执行（面板无选区概念）
        if (pl.type === 'translateAction') {
          const back = (msg) => window.mazz.invoke('panel:push', { kind: 'translate', payload: { type: 'translateActResult', msg } }).catch(() => {});
          try {
            const sel = (window.getSelection()?.toString() || '');
            if (pl.act === 'replace' && !sel.trim()) { back('当前编辑器无选区——先在主窗选中一段'); return; }
            document.execCommand('insertText', false, String(pl.text || ''));
            back(pl.act === 'replace' ? '已替换选区' : '已插入到光标');
          } catch (e) { back('执行失败：' + e.message); }
          return;
        }
        // W53 翻译面板桥：初始文本（选区透传暂存——面板 ready 后问取）
        if (pl.type === 'translateQueryInit') {
          const text = this._translateInitText || '';
          this._translateInitText = '';
          if (text) window.mazz.invoke('panel:push', { kind: 'translate', payload: { type: 'translateInit', text } }).catch(() => {});
          return;
        }
        // W53 插件管理桥（逻辑单源在 plugins/loader.js——面板页只渲染）
        if (pl.type === 'pluginsQuery') {
          try {
            const { listPluginFiles, readMaz, isEnabled } = await import('../plugins/loader.js');
            const files = await listPluginFiles();
            const rows = [];
            for (const f2 of files) {
              try {
                const { manifest } = await readMaz(f2.path);
                rows.push({ id: manifest.id, name: manifest.name, version: manifest.version, desc: manifest.description || manifest.id, enabled: await isEnabled(manifest.id), error: null, path: f2.path });
              } catch (e) {
                rows.push({ id: f2.name, name: f2.name, version: '?', desc: '', enabled: false, error: e.message, path: f2.path });
              }
            }
            window.mazz.invoke('panel:push', { kind: 'plugins', payload: { type: 'plugins', rows } }).catch(() => {});
          } catch {}
          return;
        }
        if (pl.type === 'pluginsAction') {
          const reload = () => window.mazz.invoke('panel:action', { type: 'pluginsQuery' }).catch(() => {});
          try {
            const L = await import('../plugins/loader.js');
            if (pl.act === 'toggle') {
              await L.setEnabled(pl.id, !pl.enabled);
              if (!pl.enabled) {
                try { const { manifest, code } = await L.readMaz(pl.path); await L.loadPlugin(code, manifest); }
                catch (e) { toast('加载失败：' + e.message); }
              }
              toast(pl.enabled ? `插件「${pl.name}」已禁用（重载后生效）` : `插件「${pl.name}」已启用`);
            } else if (pl.act === 'del') {
              await window.mazz.invoke('fs:delete', { path: pl.path }).catch(() => {});
              await L.setEnabled(pl.id, false);
              toast('插件已删除（已加载的实例重启后卸载）');
            } else if (pl.act === 'open') {
              window.MazzHost?.openTab('plugin:' + pl.id, { title: pl.name, content: '' });
            } else if (pl.act === 'install') {
              const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: 'Mazz 插件', extensions: ['maz'] }] }).catch(() => null);
              if (p) {
                try { await L.installFromFile(p); toast('插件已安装'); }
                catch (e) { toast('安装失败：' + e.message); }
              }
            }
          } catch (e) { toast('插件操作失败：' + e.message); }
          setTimeout(reload, 300);
          return;
        }
        // W53 帮助面板桥：主窗预渲染 HTML（renderHelpMd 单源——面板页零渲染逻辑复制）
        if (pl.type === 'helpQuery') {
          try {
            const { renderHelpMd } = await import('../help/index.js');
            const { HELP_SECTIONS } = await import('../help/content.js');
            const { SENIOR_SECTIONS } = await import('../help/content-senior.js');
            const ver = pl.ver === 'senior' ? 'senior' : 'std';
            const src = ver === 'senior' ? SENIOR_SECTIONS : HELP_SECTIONS;
            const sections = src.map(s => ({ id: s.id, icon: s.icon, title: s.title, html: renderHelpMd(s.body), text: s.body.replace(/[#*`|\[\]()>-]/g, '').slice(0, 4000) }));
            window.mazz.invoke('panel:push', { kind: 'help', payload: { type: 'help', ver, sections, section: pl.section || null } }).catch(() => {});
          } catch (e) { console.error('[help] 桥应答失败:', e.message || e); }
          return;
        }
        // W53 全局内录桥（录制本体在主窗 recorder.js——面板页纯控制台，关面板不中断）
        if (pl.type === 'recQuery') {
          if (this._screenRec) {
            window.mazz.invoke('panel:push', { kind: 'recorder', payload: { type: 'recState', recording: true, startedAt: this._screenRecAt || Date.now(), desc: this._screenRecDesc || '' } }).catch(() => {});
          }
          return;
        }
        if (pl.type === 'recStart') {
          if (this._screenRec) { window.mazz.invoke('panel:push', { kind: 'recorder', payload: { type: 'recState', recording: true, startedAt: this._screenRecAt } }).catch(() => {}); return; }
          try {
            const { startScreenRecorder } = await import('../lib/recorder.js');
            const r = await startScreenRecorder(pl.payload || {});
            if (!r) throw new Error('启动失败');
            this._screenRec = r;
            this._screenRecAt = Date.now();
            this._screenRecDesc = `${(pl.payload?.sources || []).length} 个源 · ${pl.payload?.outFormat || 'webm'} · ${pl.payload?.speed || 1}x`;
            toast('内录中… 面板/命令随时可停');
            window.mazz.invoke('panel:push', { kind: 'recorder', payload: { type: 'recState', recording: true, startedAt: this._screenRecAt, desc: this._screenRecDesc } }).catch(() => {});
          } catch (e) {
            window.mazz.invoke('panel:push', { kind: 'recorder', payload: { type: 'recState', recording: false, msg: '启动失败：' + (e.message || e) } }).catch(() => {});
          }
          return;
        }
        if (pl.type === 'recStop') {
          try { this._screenRec?.stop(); } catch {}
          this._screenRec = null;
          toast('内录已停止，文件保存中…');
          window.mazz.invoke('panel:push', { kind: 'recorder', payload: { type: 'recState', recording: false, msg: '已停止，保存中…' } }).catch(() => {});
          return;
        }
        // W53 快速跳转桥（fileIndex 缓存索引单源——命令面板文件页）
        if (pl.type === 'paletteInitQuery') {
          const tab = this._paletteInitTab || 'commands';
          this._paletteInitTab = null;
          if (tab !== 'commands') window.mazz.invoke('panel:push', { kind: 'palette', payload: { type: 'paletteInit', tab } }).catch(() => {});
          return;
        }
        if (pl.type === 'quickopenQuery') {
          try {
            const { fuzzyScore } = await import('../core/command-palette.js');
            const q = String(pl.q || '').toLowerCase();
            const items = (this.fileIndex || [])
              .map(it => ({ it, s: fuzzyScore(q, (it.label || '') + ' ' + (it.detail || '')) || { score: -1 } }))
              .filter(x => !q || x.s.score >= 0)
              .sort((a, b) => b.s.score - a.s.score)
              .slice(0, 30)
              .map(x => ({ title: x.it.label, detail: x.it.detail || '', path: x.it.path, group: x.it.icon || '' }));
            window.mazz.invoke('panel:push', { kind: 'palette', payload: { items } }).catch(() => {});
          } catch {}
          return;
        }
        if (pl.type === 'quickopenRun') {
          if (pl.path) await this.openFile(pl.path).catch(() => {});
          return;
        }
        // W53 坞浮动桥（dockfloat 子窗格：SideDock.factoryPanel 是真相源——面板纯远程视图）
        if (pl.type === 'dockFloatInit') {
          this.sideDock?.factoryPanel?.pushSnapshot();
          return;
        }
        if (pl.type === 'dockToolsQuery') {
          const groups = this.sideDock?.toolsGroups?.() || [];
          // 图标 SVG 化（零 emoji 按钮军规——ctxmenu 正解同款：主窗 iconHtml 转换随 push 带，面板页无 iconHtml 不裸奔）
          const { iconHtml } = await import('../lib/svg-icons.js');
          const svgGroups = groups.map(([g, items]) => [g, items.map(it => ({ ...it, ico: it.ico ? iconHtml(it.ico) : '' }))]);
          window.mazz.invoke('panel:push', { kind: 'dockfloat', payload: { type: 'dockTools', groups: svgGroups } }).catch(() => {});
          return;
        }
        if (pl.type === 'dockRun') {
          if (pl.cmd) commands.execute(pl.cmd);
          return;
        }
        if (pl.type === 'dockOpenPath') {
          if (pl.path) await this.openFile(pl.path).catch(() => {});
          return;
        }
        if (pl.type === 'dockFloatBack') {
          // 回停靠：坞重新上岗（子窗由面板自己 close）
          this.sideDock?.backFromFloat?.();
          return;
        }
        if (pl.type === 'factoryAction') {
          const fp = this.sideDock?.factoryPanel;
          if (!fp) return;
          try {
            if (pl.act === 'selectGenre') {
              const g = (fp.genres || []).find(x => x.id === pl.id);
              if (g) { fp.genre = g; fp.values = {}; fp.lengthPlan = (await import('../modules/factory/engine.js')).resolveFactoryLengthPlan({ preset: 'short' }); fp.renderForm(); fp.syncLengthControls(); }
            } else if (pl.act === 'setValue') {
              fp.values[pl.f] = pl.v;
            } else if (pl.act === 'setDump') {
              const el = fp.el.querySelector('.fc-dump-text'); if (el) el.value = String(pl.v || '');
            } else if (pl.act === 'setFlag') {
              const map = { dualLoop: '.fc-dualloop', maxMode: '.fc-maxmode' };
              if (pl.k === 'maxChapters') { const el = fp.el.querySelector('.fc-maxchapters'); if (el) el.value = pl.v; }
              else if (map[pl.k]) { const el = fp.el.querySelector(map[pl.k]); if (el) el.checked = !!pl.v; }
            } else if (pl.act === 'setAutoPreview') {
              fp.setAutoPreview(pl.value);
            } else if (pl.act === 'setConcurrency') {
              fp.setConcurrency(pl.value);
            } else if (pl.act === 'fill') {
              await fp.smartFill();
              fp.pushSnapshot();
            } else if (pl.act === 'copy') {
              await fp.copyMantra();
            } else if (pl.act === 'generate') {
              fp.generateNow();
            } else if (pl.act === 'addtask') {
              fp.addTask();
            } else if (pl.act === 'projectSubmit') {
              const draft = pl.draft || {};
              fp.values = { ...fp.values, ...(draft.values || {}) };
              fp.lengthPlan = (await import('../modules/factory/engine.js')).resolveFactoryLengthPlan({
                preset: draft.preset, totalWords: draft.totalWords, wordsPerUnit: draft.wordsPerUnit,
              });
              fp.renderForm();
              fp.syncLengthControls(false);
              if (fp.dumpEl) fp.dumpEl.value = String(draft.dump || '');
              const dual = fp.el.querySelector('.fc-dualloop'); if (dual) dual.checked = !!draft.dualLoop;
              const max = fp.el.querySelector('.fc-maxmode'); if (max) max.checked = !!draft.maxMode;
              fp.setAutoPreview(draft.autoPreview !== false);
              fp.setConcurrency(draft.concurrency);
              fp.setExportFormat(draft.exportFmt);
              if (draft.batchTitles?.length) await fp.addBatchTitles(draft.batchTitles);
              else if (pl.mode === 'generate') await fp.generateNow();
              else fp.addTask();
            } else if (pl.act === 'project') {
              await fp.openProjectWizard();
            } else if (pl.act === 'setLengthPreset') {
              fp.applyLengthPreset(pl.preset);
            } else if (pl.act === 'setTotalWords') {
              fp.setTotalWords(pl.value);
            } else if (pl.act === 'setWordsPerUnit') {
              fp.setWordsPerUnit(pl.value);
            } else if (pl.act === 'setExportFmt') {
              fp.setExportFormat(pl.value);
            } else if (pl.act === 'runall') {
              fp.runAllTasks();
            } else if (pl.act === 'togglePlugin') {
              // W54 B8 增强区全桥：chips 选中态切换（renderExtras 自推快照）
              fp.pluginSel.has(pl.id) ? fp.pluginSel.delete(pl.id) : fp.pluginSel.add(pl.id);
              fp.renderExtras(); fp.pushSnapshot();
            } else if (pl.act === 'toggleStyle') {
              fp.styleIds.has(pl.id) ? fp.styleIds.delete(pl.id) : fp.styleIds.add(pl.id);
              fp.renderExtras(); fp.pushSnapshot();
            } else if (pl.act === 'plugcfg') {
              fp.openPluginConfig();
            } else if (pl.act === 'styleup') {
              await fp.uploadStyle(); fp.pushSnapshot();
            } else if (pl.act === 'styleonline') {
              fp.onlineStyle();
            } else if (pl.act === 'embedadd') {
              await fp.addEmbed(); fp.pushSnapshot();
            } else if (pl.act === 'embeddel') {
              fp.embeds.splice(+pl.i, 1); fp.renderExtras(); fp.pushSnapshot();
            } else if (pl.act === 'websearch') {
              const el = fp.el.querySelector('.fc-search');
              if (el) el.value = String(pl.q || '');
              await fp.webSearch();
              fp.pushSnapshot(); // 检索结果注入 dump 后回填面板
            }
          } catch (e) { toast('创作面板动作失败：' + e.message); }
          return;
        }
        // W55 右键菜单子窗格桥：菜单项单源在 menu-service._ctxItems（全软件右键并行化）
        if (pl.type === 'ctxmenuQuery') {
          try {
            const { menus } = await import('../core/menu-service.js');
            const { iconHtml } = await import('../lib/svg-icons.js');
            // 图标 SVG 化（零 emoji 按钮军规——面板页无 iconHtml，svg 串随 push 带）
            const items = (menus._ctxItems || []).map(it => ({ ...it, svg: it.icon ? iconHtml(it.icon) : '' }));
            menus._ctxItems = null;
            window.mazz.invoke('panel:push', { kind: 'ctxmenu', payload: { type: 'ctxmenu', items } }).catch(() => {});
          } catch {}
          return;
        }
        if (pl.type === 'ctxmenuPick') {
          if (pl.id) commands.execute(pl.id);
          return;
        }
        if (pl.type === 'syncStashTab') { this._syncInitTab = pl.tab || 'host'; return; }
        // P2b sync 面板桥：页签参数透传（host/join/update）
        if (pl.type === 'syncInitQuery') {
          const tab = this._syncInitTab || 'host';
          this._syncInitTab = null;
          window.mazz.invoke('panel:push', { kind: 'sync', payload: { type: 'syncInit', tab } }).catch(() => {});
          return;
        }
        // W57 创作配置面板桥（AI 服务/创作模板——单源在 factory 模块，面板只渲染）
        if (pl.type === 'factoryPresetsQuery') {
          try {
            const { PRESETS } = await import('../modules/factory/provider.js');
            window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryPresets', presets: PRESETS } }).catch(() => {});
          } catch {}
          return;
        }
        // W62a-0 AI 分工桥：配置窗永不直读 Key，只接收脱敏登记表与路由表；写入统一回 provider.js。
        if (pl.type === 'factoryProviderQuery') {
          try {
            const { getProviderAdminSnapshot } = await import('../modules/factory/provider.js');
            const state = await getProviderAdminSnapshot();
            window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProviderState', state } }).catch(() => {});
          } catch (e) {
            window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProviderError', message: e.message } }).catch(() => {});
          }
          return;
        }
        if (pl.type === 'factoryProviderSave') {
          try {
            const { saveProviderConfig } = await import('../modules/factory/provider.js');
            const state = await saveProviderConfig(pl.connection || {});
            window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProviderState', state } }).catch(() => {});
            this.sideDock?.factoryPanel?.reload?.();
            toast('AI 服务已登记，并设为全局默认');
          } catch (e) {
            window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProviderError', message: e.message } }).catch(() => {});
          }
          return;
        }
        if (pl.type === 'factoryRolePickOpen') {
          try {
            const { AI_ROLES, getProviderAdminSnapshot, saveProviderRoute } = await import('../modules/factory/provider.js');
            const state = await getProviderAdminSnapshot();
            const role = pl.role || '';
            const meta = AI_ROLES.find(x => x.id === role);
            if (role !== 'default' && !meta) throw new Error('未知 AI 岗位');
            const target = role === 'default' ? state.routing.default : state.routing.routes?.[role];
            const current = target?.providerId && target?.model ? `${target.providerId}::${target.model}` : '__follow_global__';
            const items = [
              ...(role === 'default' ? [] : [{ v: '__follow_global__', label: '跟随全局' }]),
              ...state.connected.map(x => ({ v: x.value, label: x.label })),
            ];
            if (!items.length) throw new Error('尚无已保存 Key 的可用模型，请先在中央登记中接入');
            window.__picklistPending = {
              title: `AI 指派 · ${role === 'default' ? '全局默认' : meta.label}`,
              searchable: true, allowFree: false, current, items,
              onPick: async value => {
                try {
                  const at = String(value || '').indexOf('::');
                  const next = value === '__follow_global__' ? null : (at > 0 ? { providerId: value.slice(0, at), model: value.slice(at + 2) } : null);
                  const updated = await saveProviderRoute(role, next);
                  window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProviderState', state: updated } }).catch(() => {});
                  this.sideDock?.factoryPanel?.reload?.();
                } catch (e) {
                  window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProviderError', message: e.message } }).catch(() => {});
                }
              },
            };
            window.mazz.invoke('panel:open', { kind: 'picklist', opts: { w: 410, h: 430 } }).catch(() => {});
          } catch (e) {
            window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryProviderError', message: e.message } }).catch(() => {});
          }
          return;
        }
        if (pl.type === 'factoryInitQuery') {
          const tab = this._factoryInitTab || 'provider';
          this._factoryInitTab = null;
          window.mazz.invoke('panel:push', { kind: 'factorycfg', payload: { type: 'factoryInit', tab } }).catch(() => {});
          return;
        }
        if (pl.type === 'factoryProjectQuery') {
          this.sideDock?.factoryPanel?.pushSnapshot();
          return;
        }
        if (pl.type === 'factoryStashTab') { this._factoryInitTab = pl.tab || 'provider'; return; }
        if (pl.type === 'genreSave') {
          try {
            const { saveCustomGenre } = await import('../modules/factory/engine.js');
            await saveCustomGenre(pl.tpl);
            this.sideDock?.factoryPanel?.reload?.();
            toast('模板已保存到工作区');
          } catch (e) { toast('模板保存失败：' + e.message); }
          return;
        }
        if (pl.type === 'factoryProviderSaved') {
          this.sideDock?.factoryPanel?.reload?.();
          return;
        }
        if (pl.type === 'paletteQuery') {
          const { fuzzyScore } = await import('../core/command-palette.js');
          const { keymap, displayKey } = await import('../core/keymap-service.js');
          const q = String(pl.q || '').toLowerCase();
          const items = commands.list()
            .map(c => ({ c, s: fuzzyScore(q, (c.title || '') + ' ' + c.id) || { score: -1, ranges: [] } })) // fuzzyScore 未命中返 null——裸读 .score 必崩（实证实锤）
            .filter(x => !q || x.s.score >= 0)
            .sort((a, b) => (b.s.score - a.s.score) || String(a.c.title).localeCompare(String(b.c.title), 'zh-CN'))
            .slice(0, 50)
            .map(x => ({ id: x.c.id, title: x.c.title || x.c.id, group: x.c.group || '', key: displayKey(keymap.keyForCommand(x.c.id)) || '' }));
          window.mazz.invoke('panel:push', { kind: 'palette', payload: { items } }).catch(() => {});
        } else if (pl.type === 'shortcutQuery') {
          const { keymap, displayKey } = await import('../core/keymap-service.js');
          const groups = {};
          for (const b of (keymap.defaults || [])) {
            const cmd = commands.get(b.command);
            const g = cmd?.group || '其他';
            (groups[g] = groups[g] || []).push({ key: displayKey(b.key) || b.key, title: cmd?.title || b.command });
          }
          window.mazz.invoke('panel:push', { kind: 'shortcuts', payload: { groups } }).catch(() => {});
        } else if (pl.type === 'paletteRun' && pl.id) {
          commands.execute(pl.id);
          window.mazz.invoke('panel:close', { kind: 'palette' }).catch(() => {});
        } else if (pl.type === 'annotateExit') {
          toast('已退出批注');
        }
      });
      // 全屏逃生（系统覆盖层会吃自绘标题栏按钮——Esc + 浮动退出钮双保险，误触也能一眼看到出路）
      let fsExitBtn = null;
      const setFsUi = (on) => {
        document.body.classList.toggle('is-fullscreen', !!on);
        if (on && !fsExitBtn) {
          fsExitBtn = document.createElement('button');
          fsExitBtn.className = 'fs-exit';
          fsExitBtn.textContent = '退出全屏（Esc）';
          fsExitBtn.addEventListener('click', () => window.mazz.invoke('window:toggleFullScreen'));
          document.body.appendChild(fsExitBtn);
        } else if (!on && fsExitBtn) { fsExitBtn.remove(); fsExitBtn = null; }
      };
      window.mazz.on('window:fullscreen', ({ on }) => setFsUi(on));
      window.mazz.invoke('window:isFullScreen').then(setFsUi).catch(() => {});
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!document.body.classList.contains('is-fullscreen')) return;
        if (document.querySelector('.mazz-palette-mask, .help-mask')) return; // 弹窗优先吃 Esc
        e.stopPropagation();
        window.mazz.invoke('window:toggleFullScreen').catch(() => {});
      }, true);
      // 多工作区切换：缓存路径全部失效（shell.workspace / ws-path 缓存 / watcher 重挂）→ 文件树重扎根
      window.mazz.on('workspace:changed', async ({ path: p }) => {
        this.workspace = p || await window.mazz.invoke('workspace:get').catch(() => this.workspace);
        try { const { invalidateWsCache } = await import('../lib/ws-path.js'); invalidateWsCache(); } catch {}
        if (this.workspace) window.mazz.invoke('fs:watch', { paths: [this.workspace] }).catch(() => {});
        if (this.fileTree) this.fileTree._closedDirs = null; // 已关闭列表按工作区隔离：换区必须清缓存重读（此前换区不跟随）
        await this.fileTree?.refresh?.();
      });
      window.mazz.on('window:role', ({ role }) => { contextKeys.set('windowRole', role); });
      window.mazz.on('file:changed', ({ path: p, event }) => {
        // 删除治理：文件/目录被删（回收站/外部/脚本）→ 打开中的标签不再虚空存在
        if (event === 'unlink' || event === 'unlinkDir') { this.closeGhostTabs(p); return; }
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
        <select id="s-theme" class="rb-select" style="max-width:56%"></select>
        <button id="s-theme-del" class="rb-btn" style="flex-direction:row" title="删除选中的自定义主题（自带主题不可删）">🗑 删除</button></div>
      <div class="set-row"><label>主题包</label>
        <button id="s-theme-blank" class="rb-btn" style="flex-direction:row" title="在工作区 themes/ 生成空白主题包模板">📄 获取空白主题包</button>
        <button id="s-theme-import" class="rb-btn" style="flex-direction:row" title="从 JSON 文件导入主题包">📥 导入</button>
        <button id="s-theme-folder" class="rb-btn" style="flex-direction:row" title="打开主题文件夹（可给自定义主题改名）">📂 主题文件夹</button></div>
      <div class="set-row"><label>图片取色</label>
        <button id="s-imgtheme" class="rb-btn" style="flex-direction:row">🖼 从图片生成主题</button>
        <span style="font-size:11px;color:var(--fg-dim)">提取颜色按构成主义原则组合；色彩太少会提示换图</span></div>
      <div class="set-row"><label>快速笔记保存到</label>
        <select id="s-qn" class="rb-select"><option value="daily">每日笔记</option><option value="inbox">inbox.md</option></select></div>
      <div class="set-row"><label>拼写检查</label>
        <select id="s-spell" class="rb-select"><option value="on">开启</option><option value="off">关闭</option></select></div>
      <div class="set-row"><label>最近文件</label>
        <button id="s-clearRecent" class="rb-btn" style="flex-direction:row">清空</button></div>
      <div class="set-row"><label>系统集成</label>
        <label style="font-weight:400;font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="s-autolaunch"> 开机自启动（默认关闭）</label>
        <button id="s-shortcut" class="rb-btn" style="flex-direction:row">🖥 发送桌面快捷方式</button>
        <span id="s-shortcut-status" style="font-size:11px;color:var(--fg-dim)"></span></div>
      <div class="set-row" id="s-explorer-row"><label>资源管理器</label>
        <button id="s-explorer-reg" class="rb-btn" style="flex-direction:row">注册右键「导入到 Mazz 工作区」</button>
        <button id="s-explorer-unreg" class="rb-btn" style="flex-direction:row">取消注册</button>
        <span id="s-explorer-status" style="font-size:11px;color:var(--fg-dim)"></span></div>
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
    // —— 主题：自带（不可删改）+ 自定义主题包（可增删/导入/改名）——
    const refreshThemeSelect = async () => {
      const all = await this.allThemes();
      const cur = document.documentElement.dataset.theme || 'paper';
      g('#s-theme').innerHTML =
        `<optgroup label="自带主题">${all.filter(t => t.builtin).map(t => `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${t.name}</option>`).join('')}</optgroup>` +
        (all.some(t => !t.builtin)
          ? `<optgroup label="自定义主题包">${all.filter(t => !t.builtin).map(t => `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${t.name}</option>`).join('')}</optgroup>`
          : '');
      g('#s-theme-del').disabled = !(cur.startsWith('pack:'));
      g('#s-theme-del').style.opacity = cur.startsWith('pack:') ? 1 : 0.4;
    };
    await refreshThemeSelect();
    g('#s-theme').addEventListener('change', async (e) => {
      this.setTheme(e.target.value);
      await refreshThemeSelect();
    });
    g('#s-theme-del').addEventListener('click', async () => {
      const cur = g('#s-theme').value;
      if (!cur.startsWith('pack:')) { toast('自带主题不可删除'); return; }
      const { deletePack } = await import('../lib/theme-store.js');
      await deletePack(cur.slice(5));
      toast('已删除主题包');
      this.setTheme('paper');
      await refreshThemeSelect();
    });
    g('#s-theme-blank').addEventListener('click', async () => {
      const { obtainBlankPack } = await import('../lib/theme-store.js');
      const p = await obtainBlankPack();
      toast('空白主题包已生成：' + p.split('/').pop() + '（填色后在 UI 主题里选用）');
      await this.openFile(p);
      await refreshThemeSelect();
    });
    g('#s-theme-import').addEventListener('click', async () => {
      const p = await window.mazz.invoke('dialog:openFile', { filters: [{ name: '主题包', extensions: ['json'] }] }).catch(() => null);
      if (!p) return;
      try {
        const text = await window.mazz.invoke('fs:readFile', { path: p });
        const { importPack } = await import('../lib/theme-store.js');
        const id = await importPack(text, p.split(/[\\/]/).pop());
        toast('主题包已导入');
        this.setTheme('pack:' + id);
        await refreshThemeSelect();
      } catch (e) { toast('导入失败：' + e.message); }
    });
    g('#s-theme-folder').addEventListener('click', async () => {
      const { themesDir } = await import('../lib/theme-store.js');
      const dir = await themesDir();
      await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
      if (window.mazz.isElectron) {
        window.mazz.invoke('shell:showItemInFolder', { path: dir });
      } else {
        // 网页/移动端：在文件树中展开主题文件夹
        this.fileTree.expanded.add(dir);
        await this.fileTree.refresh();
        toast('主题文件在 themes/ 里——重命名文件即给主题改名');
      }
    });
    g('#s-imgtheme').addEventListener('click', async () => {
      const { applyImageTheme } = await import('../theme-custom.js');
      const ok = await applyImageTheme();
      if (ok) g('#s-theme').value = 'custom';
    });
    // —— 资源管理器右键菜单（仅 Windows 桌面版显示状态）——
    (async () => {
      const st = await window.mazz.invoke('explorermenu:status').catch(() => null);
      const statusEl = m.body.querySelector('#s-explorer-status');
      if (!window.mazz.isElectron) { m.body.querySelector('#s-explorer-row').style.display = 'none'; return; }
      if (statusEl && st) statusEl.textContent = st.registered ? '已注册' : '未注册';
    })();
    g('#s-explorer-reg').addEventListener('click', async () => {
      const r = await window.mazz.invoke('explorermenu:register').catch((e) => ({ ok: false, reason: e.message }));
      toast(r.ok
        ? '已注册：右键文件/文件夹可见「导入到 Mazz 工作区」（若未立刻出现，重启资源管理器）'
        : '注册失败：' + (r.reason || '未知错误'), [], r.ok ? 3000 : 6000);
      g('#s-explorer-status').textContent = r.ok ? '已注册' : ('注册失败：' + (r.reason || ''));
    });
    g('#s-explorer-unreg').addEventListener('click', async () => {
      await window.mazz.invoke('explorermenu:unregister').catch(() => {});
      toast('已取消注册');
      g('#s-explorer-status').textContent = '未注册';
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
    // 系统集成：开机自启 + 桌面快捷方式
    if (window.mazz?.isElectron) {
      const alEl = m.body.querySelector('#s-autolaunch');
      alEl.checked = await window.mazz.invoke('app:getAutoLaunch').catch(() => false);
      alEl.addEventListener('change', async () => {
        const on = await window.mazz.invoke('app:setAutoLaunch', { enabled: alEl.checked }).catch(() => alEl.checked);
        toast(on ? '开机自启动已开启' : '开机自启动已关闭');
      });
      g('#s-shortcut').addEventListener('click', async () => {
        const st = m.body.querySelector('#s-shortcut-status');
        try {
          const ok = await window.mazz.invoke('app:createDesktopShortcut');
          st.textContent = ok ? '✓ 已发送到桌面' : '创建失败';
          toast(ok ? '桌面快捷方式已创建' : '创建失败');
        } catch (e) { st.textContent = e.message; toast(e.message); }
      });
    } else {
      m.body.querySelector('#s-autolaunch').disabled = true;
      m.body.querySelector('#s-shortcut').disabled = true;
    }
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
// —— 新建文件类型（覆盖全部可导出格式；二进制办公格式生成合法空文档）——
export const NEW_FILE_TYPES = [
  { label: 'Word 文档 (.docx)', ext: 'docx', group: '文档', binary: true },
  { label: 'Mazz 表格', ext: 'mazzsheet', group: '表格' },
  { label: 'CSV 表格', ext: 'csv', group: '表格' },
  { label: 'TSV 表格', ext: 'tsv', group: '表格' },
  { label: 'Excel 工作簿 (.xlsx)', ext: 'xlsx', group: '表格', binary: true },
  { label: 'Mazz 演示', ext: 'mazzslide', group: '演示' },
  { label: 'PowerPoint (.pptx)', ext: 'pptx', group: '演示', binary: true },
  { label: '思维导图', ext: 'mindmap', group: '创作' },
  { label: '画板', ext: 'mazzdraw', group: '创作' },
  ...CODE_NEW_FILE_TYPES,
];

export const BINARY_EXTS = new Set(['docx', 'xlsx', 'pptx']);

export const NEW_FILE_DEFAULTS = {
  md: () => '# 未命名\n\n',
  mazzslide: () => '# 第 1 页\n',
  mindmap: () => '中心主题\n',
  csv: () => '', tsv: () => '', mazzsheet: () => '', txt: () => '', mazzdraw: () => '',
  ...CODE_FILE_DEFAULTS,
};

/** 生成二进制空办公文档（docx/xlsx/pptx），返回 base64 */
export async function makeBinaryDoc(ext) {
  if (ext === 'docx') {
    const { Document, Packer, Paragraph } = await import('docx');
    const doc = new Document({ sections: [{ children: [new Paragraph('')] }] });
    return Packer.toBase64String(doc);
  }
  if (ext === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  }
  if (ext === 'pptx') {
    const { parseOutline } = await import('../modules/slide/outline.js');
    const { exportPptx } = await import('../modules/slide/pptx.js');
    const { SLIDE_THEMES } = await import('../modules/slide/themes.js');
    const buf = await exportPptx(parseOutline('# 第 1 页\n'), SLIDE_THEMES[0], { fileName: '未命名' });
    const u8 = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
    return btoa(bin);
  }
  throw new Error('未知二进制类型: ' + ext);
}

export function toast(msg, actions = [], ms = 3000) {
  document.querySelectorAll('.mazz-toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'mazz-toast';
  // W57 toast 防压（创作提示半截被视图压实锤）：活动浏览器视图覆盖左下安全区时挪顶（ribbon 下缘=视图永远够不着）
  try {
    const bctl = window.__activeBrowserCtl;
    const t = bctl?.tabs?.find(x => x.id === bctl.activeId);
    const vr = t?.host?.getBoundingClientRect?.();
    if (vr && vr.left < 300 && vr.bottom > window.innerHeight - 120) el.classList.add('mazz-toast-top');
  } catch {}
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
  // 全屏挂接：全屏时只有 fullscreenElement 子树可见——toast 挂 body 必隐身（全屏按字幕钮无反馈实锤，与 modal 同款修法）
  (document.fullscreenElement || document.body).appendChild(el);
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
  // 全屏挂接：全屏时只有 fullscreenElement 子树可见——mask 挂 body 必隐身（播放设置全屏打不开实锤）
  (document.fullscreenElement || document.body).appendChild(mask);
  mask.querySelector('#m-close').addEventListener('click', () => mask.remove());
  mask.addEventListener('mousedown', e => { if (e.target === mask) mask.remove(); });
  return { el: mask, body: mask.querySelector('.modal-body'), close: () => mask.remove() };
}

/** 新建文件类型选择弹窗：分组展示全量类型，resolve 扩展名（不含点）或 null（取消） */
export function pickNewFileType() {
  return new Promise((resolve) => {
    const m = modal('新建文件');
    const groups = [...new Set(NEW_FILE_TYPES.map(t => t.group))];
    m.body.innerHTML = `
      <div style="min-width:430px;max-width:600px">
        ${groups.map(g => `
          <div style="font-size:11.5px;color:var(--fg-dim);margin:10px 0 6px">${g}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(126px,1fr));gap:7px">
            ${NEW_FILE_TYPES.filter(t => t.group === g).map(t => `
              <button class="nft-btn" data-ext="${t.ext}" style="display:flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--bg-elev);cursor:pointer;font-size:12.5px;color:var(--fg);text-align:left">
                <span style="color:var(--accent);font-weight:700">.${t.ext}</span><span>${t.label.replace(/ *\([^)]*\)/g, '')}</span>
              </button>`).join('')}
          </div>`).join('')}
      </div>`;
    const done = (v) => { resolve(v); m.close(); };
    m.body.querySelectorAll('.nft-btn').forEach(b => b.addEventListener('click', () => done(b.dataset.ext)));
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
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
