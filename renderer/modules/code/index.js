// renderer/modules/code/index.js —— 编程内核（Monaco + 集成终端）
// Monaco：JS/TS 内置智能（补全/跳转/诊断/格式化）；终端：node-pty + xterm 多标签
import { getMonaco, LANG_BY_EXT } from './monaco-setup.js';
import { TerminalPanel } from './terminal-view.js';
import { DebugService } from './debug.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';

const MODULE = 'code';
const instances = new Map();
let current = null;

const RUNNERS = {
  javascript: (p) => `node "${p}"`,
  typescript: (p) => `npx ts-node "${p}"`,
  python: (p) => `python "${p}"`,
  shell: (p) => `bash "${p}"`,
};

function createCode(container, { filePath = null, language = null } = {}) {
  const root = document.createElement('div');
  root.className = 'code-root';
  root.innerHTML = `
    <div class="code-editor"></div>
    <div class="code-bottom collapsed"></div>`;
  container.appendChild(root);

  const ctl = {
    container, root,
    editor: null,
    model: null,
    language: language || 'plaintext',
    filePath,
    terminal: null,
    bottomEl: root.querySelector('.code-bottom'),
    editorEl: root.querySelector('.code-editor'),
    ready: false,
  };

  async function init() {
    const monaco = await getMonaco();
    ctl.model = monaco.editor.createModel('', ctl.language);
    ctl.editor = monaco.editor.create(ctl.editorEl, {
      model: ctl.model,
      automaticLayout: true,
      fontSize: 13.5,
      fontFamily: 'var(--font-mono)',
      minimap: { enabled: true, maxColumn: 80 },
      renderWhitespace: 'selection',
      tabSize: 2,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      suggestOnTriggerCharacters: true,
      quickSuggestions: true,
      wordBasedSuggestions: 'currentDocument',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      theme: document.documentElement.dataset.theme === 'paper' || document.documentElement.dataset.theme === 'sand' ? 'mazz-light' : 'mazz-dark',
    });
    ctl.model.onDidChangeContent(() => {
      window.MazzHost?.notifyChange(container);
      contextKeys.set('hasSelection', !ctl.editor.getSelection().isEmpty());
    });
    ctl.editor.onDidChangeCursorSelection(() => {
      contextKeys.set('hasSelection', !ctl.editor.getSelection().isEmpty());
    });
    ctl.editor.onDidFocusEditorText(() => {
      current = ctl;
      contextKeys.set('module', MODULE);
    });
    // 主题联动
    watchTheme(ctl.editor);
    // 调试服务（DAP：断点/单步/变量/监视/调用栈/调试控制台）
    ctl.debug = new DebugService(ctl);
    ctl.ready = true;
  }

  function watchTheme(editor) {
    const mo = new MutationObserver(() => {
      const t = document.documentElement.dataset.theme;
      getMonaco().then(monaco => {
        monaco.editor.setTheme(t === 'paper' || t === 'sand' ? 'mazz-light' : 'mazz-dark');
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  init();

  // 终端面板（默认折叠；最后一个终端被关闭时自动收起，重新展开时若无终端自动新建）
  ctl.toggleTerminal = async (show) => {
    const want = show ?? ctl.bottomEl.classList.contains('collapsed');
    ctl.bottomEl.classList.toggle('collapsed', !want);
    const cwd = ctl.filePath ? ctl.filePath.replace(/[\\/][^\\/]*$/, '') : undefined;
    if (want && !ctl.terminal) {
      ctl.terminal = new TerminalPanel(ctl.bottomEl, {
        onCountChange: (n) => { if (n === 0) ctl.bottomEl.classList.add('collapsed'); },
      });
      await ctl.terminal.create({ cwd });
    } else if (want && ctl.terminal && !ctl.terminal.count()) {
      await ctl.terminal.create({ cwd });
    }
    if (want) setTimeout(() => ctl.terminal?.resize(), 50);
  };

  ctl.runFile = async () => {
    const runner = RUNNERS[ctl.language];
    if (!runner) { toast(`暂不支持运行 ${ctl.language}（支持 js/ts/py/sh）`); return; }
    if (!ctl.filePath) { toast('请先保存文件再运行'); return; }
    await window.MazzCommands.execute('file.save');
    await ctl.toggleTerminal(true);
    const term = ctl.terminal;
    if (!term?.activeId) return;
    window.mazz.invoke('term:write', { id: term.activeId, data: runner(ctl.filePath) + '\r' });
  };

  ctl.runSelection = async () => {
    if (!ctl.editor) return;
    const sel = ctl.editor.getSelection();
    const text = sel.isEmpty() ? ctl.editor.getValue() : ctl.editor.getModel().getValueInRange(sel);
    if (!text.trim()) return;
    await ctl.toggleTerminal(true);
    const term = ctl.terminal;
    if (!term?.activeId) return;
    const lang = ctl.language;
    if (lang === 'python') {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      window.mazz.invoke('term:write', { id: term.activeId, data: `python -c "import base64;exec(base64.b64decode('${b64}').decode())"\r` });
    } else if (lang === 'javascript' || lang === 'typescript') {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      window.mazz.invoke('term:write', { id: term.activeId, data: `node -e "eval(Buffer.from('${b64}','base64').toString())"\r` });
    } else {
      window.mazz.invoke('term:write', { id: term.activeId, data: text + '\r' });
    }
  };

  return ctl;
}

function withCtl(fn) { return () => { if (current?.ready) fn(current); } }

// ==================== 模块契约 ====================
export default {
  displayName: '代码',
  icon: '💻',

  create(container) {
    const ctl = createCode(container, {});
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    window.__activeCodeCtl = ctl; // 桥接 #2/#4 取数
    contextKeys.set('module', MODULE);
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },

  getContent(state) {
    const ctl = instances.get(state.container);
    return ctl?.editor ? ctl.editor.getValue() : (ctl?._pendingText ?? '');
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    const text = typeof data === 'string' ? data : '';
    // 语言按文件类型（由外壳经 setLanguage 提前指定，或内容推断）
    const setModel = async () => {
      const monaco = await getMonaco();
      if (ctl.editor) {
        ctl.editor.setValue(text);
        ctl.editor.revealLine(1);
      } else {
        ctl._pendingText = text;
        const iv = setInterval(() => {
          if (ctl.editor) {
            clearInterval(iv);
            ctl.editor.setValue(ctl._pendingText || '');
          }
        }, 100);
      }
    };
    setModel();
  },
  setLanguage(lang, state) {
    const ctl = instances.get(state.container);
    if (ctl) ctl.language = lang;
    if (ctl?.model) {
      getMonaco().then(monaco => monaco.editor.setModelLanguage(ctl.model, lang));
    }
  },
  newDocument(state) { this.setContent('', state); },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl?.editor ? ctl.editor.getValue().length : 0;
  },
  getCursorPos(state) {
    const ctl = instances.get(state.container);
    const pos = ctl?.editor?.getPosition();
    return pos ? `行 ${pos.lineNumber}，列 ${pos.column}` : '';
  },

  toolbarHTML: `
    <div class="rb-group" data-label="语言">
      <select class="rb-select" id="code-lang" title="编程语言">
        <option value="javascript">JavaScript</option>
        <option value="typescript">TypeScript</option>
        <option value="python">Python</option>
        <option value="json">JSON</option>
        <option value="css">CSS</option>
        <option value="html">HTML</option>
        <option value="shell">Shell</option>
        <option value="yaml">YAML</option>
        <option value="xml">XML</option>
        <option value="markdown">Markdown</option>
        <option value="plaintext">纯文本</option>
      </select>
    </div>
    <div class="rb-group" data-label="运行">
      <button class="rb-btn" data-command="code.runFile"><i class="ico">▶</i><span>运行文件</span></button>
      <button class="rb-btn" data-command="code.runSelection"><i class="ico">⏎</i><span>运行选区</span></button>
      <button class="rb-btn" data-command="code.format"><i class="ico">⌨</i><span>格式化</span></button>
    </div>
    <div class="rb-group" data-label="终端">
      <button class="rb-btn" data-command="code.toggleTerminal"><i class="ico">▗</i><span>切换终端</span></button>
      <button class="rb-btn" data-command="code.newTerminal"><i class="ico">＋</i><span>新建终端</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
    const langSel = panel.querySelector('#code-lang');
    if (langSel && current) langSel.value = current.language || 'javascript';
    langSel?.addEventListener('change', () => {
      window.MazzCommands.execute('code.setLanguage', { language: langSel.value });
    });
  },

  contributes: {
    commands: [
      { id: 'code.runFile', title: '运行当前文件', icon: '▶', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.runFile()) },
      { id: 'code.runSelection', title: '运行选区/当前 cell', icon: '⏎', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.runSelection()) },
      { id: 'code.format', title: '格式化文档', icon: '⌨', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.editor.getAction('editor.action.formatDocument').run()) },
      { id: 'code.setLanguage', title: '切换编程语言', group: '编程',
        when: "module=='code'", run: (p) => withCtl(ctl => {
          const lang = p?.language || 'javascript';
          ctl.language = lang;
          getMonaco().then(monaco => monaco.editor.setModelLanguage(ctl.model, lang));
          // 未命名文件的扩展名跟随语言
          const extMap = { javascript: 'js', typescript: 'ts', python: 'py', json: 'json', css: 'css', html: 'html', shell: 'sh', yaml: 'yml', xml: 'xml', markdown: 'md', plaintext: 'txt' };
          const ext = extMap[lang] || 'txt';
          const tabName = document.querySelector('.tab.on .t-name')?.textContent || '';
          if (tabName.startsWith('未命名.')) {
            window.MazzHost?.setTabTitle(ctl.container, `未命名.${ext}`);
          }
          toast(`语言已切换：${lang}`);
        })() },
      { id: 'code.toggleTerminal', title: '切换集成终端', icon: '▗', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.toggleTerminal()) },
      { id: 'code.newTerminal', title: '新建终端', icon: '＋', group: '编程',
        when: "module=='code'", run: withCtl(async ctl => { await ctl.toggleTerminal(true); await ctl.terminal.create(); }) },
      { id: 'code.commentToggle', title: '切换行注释', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.editor.getAction('editor.action.commentLine').run()) },
      { id: 'code.goToDefinition', title: '转到定义', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.editor.getAction('editor.action.revealDefinition').run()) },
      { id: 'code.findReferences', title: '查找引用', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.editor.getAction('editor.action.referenceSearch.trigger').run()) },
      { id: 'code.renameSymbol', title: '重命名符号', group: '编程',
        when: "module=='code'", run: withCtl(ctl => ctl.editor.getAction('editor.action.rename').run()) },
      // —— 调试（DAP：debugpy）——
      { id: 'debug.start', title: '启动/继续调试', icon: '▶', group: '调试',
        when: "module=='code'",
        run: withCtl(ctl => ctl.debug.active ? ctl.debug.continue_() : ctl.debug.start()) },
      { id: 'debug.stop', title: '停止调试', icon: '■', group: '调试',
        when: "module=='code'", run: withCtl(ctl => ctl.debug.stop()) },
      { id: 'debug.toggleBreakpoint', title: '切换断点', icon: '●', group: '调试',
        when: "module=='code'",
        run: withCtl(ctl => ctl.debug.toggleBreakpoint(ctl.editor.getPosition().lineNumber)) },
      { id: 'debug.stepOver', title: '单步跳过', group: '调试',
        when: "module=='code'", run: withCtl(ctl => ctl.debug.stepOver()) },
      { id: 'debug.stepIn', title: '单步进入', group: '调试',
        when: "module=='code'", run: withCtl(ctl => ctl.debug.stepIn()) },
      { id: 'debug.stepOut', title: '单步跳出', group: '调试',
        when: "module=='code'", run: withCtl(ctl => ctl.debug.stepOut()) },
      { id: 'debug.showPanel', title: '调试面板', group: '调试',
        when: "module=='code'", run: withCtl(ctl => ctl.debug.showPanel(true)) },
    ],
    keybindings: [
      { command: 'code.toggleTerminal', key: 'ctrl+`', when: "module=='code'" },
      { command: 'code.newTerminal', key: 'ctrl+shift+`', when: "module=='code'" },
      { command: 'code.runSelection', key: 'ctrl+enter', when: "module=='code'" },
      { command: 'code.format', key: 'alt+shift+f', when: "module=='code'" },
      { command: 'code.commentToggle', key: 'ctrl+/', when: "module=='code'" },
      { command: 'code.goToDefinition', key: 'f12', when: "module=='code'" },
      { command: 'code.findReferences', key: 'shift+f12', when: "module=='code'" },
      { command: 'code.renameSymbol', key: 'f2', when: "module=='code'" },
      { command: 'debug.start', key: 'f5', when: "module=='code'" },
      { command: 'debug.stop', key: 'shift+f5', when: "module=='code'" },
      { command: 'debug.toggleBreakpoint', key: 'f9', when: "module=='code'" },
      { command: 'debug.stepOver', key: 'f10', when: "module=='code'" },
      { command: 'debug.stepIn', key: 'f11', when: "module=='code'" },
      { command: 'debug.stepOut', key: 'shift+f11', when: "module=='code'" },
    ],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
