// renderer/modules/code/index.js —— 编程内核（Monaco + 集成终端）
// Monaco：JS/TS 内置智能（补全/跳转/诊断/格式化）；终端：node-pty + xterm 多标签
import { getMonaco, getMonacoWorkerDiagnostics } from './monaco-setup.js';
import { LANGUAGE_CATALOG, LANGUAGE_TIERS, LANGUAGE_BY_EXT, PRIMARY_EXT_BY_LANGUAGE, languageName } from './language-catalog.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { TerminalPanel } from './terminal-view.js';
import { DebugService } from './debug.js';
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';

const MODULE = 'code';
const instances = new Map();
let current = null;
const TERMINAL_MIN_HEIGHT = 72; // 约两行终端（含标签栏），不得再压
const TERMINAL_DEFAULT_HEIGHT = 260;
const TERMINAL_MAX_RATIO = 0.6;

// W58 全语言运行体系：四档分级（A 解释直跑 / B 先编后跑 / C 预览型 / D 明示不可运行）
// exe 支持候选数组（toolchain:detect 取首中）；cmd(p, tmp) 中 tmp=编译产物路径（B 档用）
const RUNNERS = {
  javascript: { type: 'run', exe: 'node', cmd: p => `node "${p}"` },
  typescript: { type: 'run', exe: 'npx', cmd: p => `npx tsx "${p}"` }, // tsx 免配置比 ts-node 快一档
  python: { type: 'run', exe: 'python', cmd: p => `python "${p}"` },
  shell: { type: 'run', exe: ['bash', 'sh'], cmd: p => `bash "${p}"` },
  powershell: { type: 'run', exe: ['powershell', 'pwsh'], cmd: p => `powershell -NoProfile -File "${p}"` },
  bat: { type: 'run', exe: 'cmd', cmd: p => `cmd /c "${p}"` },
  ruby: { type: 'run', exe: 'ruby', cmd: p => `ruby "${p}"` },
  php: { type: 'run', exe: 'php', cmd: p => `php "${p}"` },
  perl: { type: 'run', exe: 'perl', cmd: p => `perl "${p}"` },
  lua: { type: 'run', exe: 'lua', cmd: p => `lua "${p}"` },
  r: { type: 'run', exe: 'Rscript', cmd: p => `Rscript "${p}"` },
  julia: { type: 'run', exe: 'julia', cmd: p => `julia "${p}"` },
  groovy: { type: 'run', exe: 'groovy', cmd: p => `groovy "${p}"` },
  dart: { type: 'run', exe: 'dart', cmd: p => `dart run "${p}"` },
  haskell: { type: 'run', exe: 'runghc', cmd: p => `runghc "${p}"` },
  scala: { type: 'run', exe: 'scala', cmd: p => `scala "${p}"` },
  clojure: { type: 'run', exe: 'clojure', cmd: p => `clojure "${p}"` },
  elixir: { type: 'run', exe: 'elixir', cmd: p => `elixir "${p}"` },
  erlang: { type: 'run', exe: 'escript', cmd: p => `escript "${p}"` },
  ocaml: { type: 'run', exe: 'ocaml', cmd: p => `ocaml "${p}"` },
  crystal: { type: 'run', exe: 'crystal', cmd: p => `crystal run "${p}"` },
  nim: { type: 'run', exe: 'nim', cmd: p => `nim r "${p}"` },
  d: { type: 'run', exe: ['dmd', 'rdmd'], cmd: p => `dmd -run "${p}"` },
  go: { type: 'run', exe: 'go', cmd: p => `go run "${p}"` }, // 捷径：go run 直跑
  java: { type: 'run', exe: 'java', cmd: p => `java "${p}"` }, // 捷径：JDK11+ 单文件源启动
  zig: { type: 'run', exe: 'zig', cmd: p => `zig run "${p}"` }, // 捷径：zig run
  swift: { type: 'run', exe: 'swift', cmd: p => `swift "${p}"` }, // 捷径：解释模式
  rust: { type: 'compile', exe: 'rustc', cmd: (p, tmp) => `rustc "${p}" -o "${tmp}" && "${tmp}"` },
  c: { type: 'compile', exe: ['gcc', 'cl', 'clang'], cmd: (p, tmp, exe) => exe === 'cl' ? `cl /nologo "${p}" /Fe:"${tmp}" && "${tmp}"` : `gcc "${p}" -o "${tmp}" && "${tmp}"` },
  cpp: { type: 'compile', exe: ['g++', 'cl', 'clang++'], cmd: (p, tmp, exe) => exe === 'cl' ? `cl /nologo /EHsc "${p}" /Fe:"${tmp}" && "${tmp}"` : `g++ "${p}" -o "${tmp}" && "${tmp}"` },
  csharp: { type: 'compile', exe: ['csc', 'dotnet'], cmd: (p, tmp) => `csc /nologo /out:"${tmp}" "${p}" && "${tmp}"` },
  fsharp: { type: 'run', exe: ['dotnet'], cmd: p => `dotnet fsi "${p}"` },
  kotlin: { type: 'compile', exe: 'kotlinc', cmd: (p, tmp) => `kotlinc "${p}" -include-runtime -d "${tmp}.jar" && java -jar "${tmp}.jar"` },
  fortran: { type: 'compile', exe: ['gfortran', 'flang'], cmd: (p, tmp, exe) => `${exe} "${p}" -o "${tmp}" && "${tmp}"` },
  pascal: { type: 'compile', exe: 'fpc', cmd: (p, tmp) => `fpc "${p}" -o"${tmp}" && "${tmp}"` },
  'objective-c': { type: 'compile', exe: ['clang', 'gcc'], cmd: (p, tmp, exe) => `${exe} "${p}" -o "${tmp}" && "${tmp}"` },
  html: { type: 'preview', cmd: p => p },
  markdown: { type: 'none', reason: 'Markdown 是文档不是程序——请用文档模块打开预览' },
  svg: { type: 'none', reason: 'SVG 是图形不是程序——请用查看器打开' },
  json: { type: 'none', reason: 'JSON 是数据不是程序' },
  css: { type: 'none', reason: 'CSS 是样式不是程序' },
  yaml: { type: 'none', reason: 'YAML 是数据不是程序' },
  xml: { type: 'none', reason: 'XML 是数据不是程序' },
  plaintext: { type: 'none', reason: '纯文本无语言——先在右下角选择语言或保存为对应扩展名' },
  sql: { type: 'run', exe: 'sqlite3', cmd: p => `sqlite3 ":memory:" ".read ${p}"`, optional: true }, // 口子：探测到才跑
};

/** 扩展名→语言映射（保存/打开/运行三处同步——plaintext 只留无扩展名/未知） */
const langOf = (p) => LANGUAGE_BY_EXT[(String(p || '').split('.').pop() || '').toLowerCase()] || null;

function createCode(container, { filePath = null, language = null } = {}) {
  const root = document.createElement('div');
  root.className = 'code-root';
  root.innerHTML = `
    <div class="code-editor"></div>
    <div class="code-term-grip" role="separator" aria-label="调整终端高度" aria-orientation="horizontal" title="上下拖动调整终端高度；双击恢复默认"></div>
    <div class="code-bottom collapsed"></div>`;
  container.appendChild(root);

  const ctl = {
    container, root,
    editor: null,
    model: null,
    // W58 语言链根治①：默认 javascript + 打开按扩展名同步
    language: language || (filePath ? (langOf(filePath) || 'javascript') : 'javascript'),
    filePath,
    terminal: null,
    bottomEl: root.querySelector('.code-bottom'),
    termGripEl: root.querySelector('.code-term-grip'),
    editorEl: root.querySelector('.code-editor'),
    ready: false,
    disposed: false,
    disposables: [],
    themeObserver: null,
    pendingTextTimer: null,
    timers: new Set(),
    cancelGripDrag: null,
    monaco: null,
    getWorkerDiagnostics: getMonacoWorkerDiagnostics,
  };

  const paneId = () => container.closest('.pane')?.dataset.paneId || 'default';
  const terminalHeightKey = () => `code.terminalHeight.${paneId()}`;
  const terminalBounds = () => {
    const rootHeight = root.getBoundingClientRect().height || root.clientHeight || TERMINAL_DEFAULT_HEIGHT / TERMINAL_MAX_RATIO;
    return { min: TERMINAL_MIN_HEIGHT, max: Math.max(TERMINAL_MIN_HEIGHT, Math.floor(rootHeight * TERMINAL_MAX_RATIO)) };
  };
  const clampTerminalHeight = (height) => {
    const { min, max } = terminalBounds();
    const n = Number.isFinite(+height) ? +height : TERMINAL_DEFAULT_HEIGHT;
    return Math.round(Math.max(min, Math.min(max, n)));
  };
  const applyTerminalHeight = (height, { persist = false } = {}) => {
    if (ctl.disposed) return 0;
    const next = clampTerminalHeight(height);
    ctl.bottomEl.style.height = `${next}px`;
    ctl.bottomEl.dataset.height = String(next);
    ctl.editor?.layout?.();
    ctl.terminal?.resize();
    if (persist) window.mazz?.invoke('settings:set', { key: terminalHeightKey(), value: next }).catch(() => {});
    return next;
  };
  const restoreTerminalHeight = async () => {
    const saved = await window.mazz?.invoke('settings:get', { key: terminalHeightKey() }).catch(() => null);
    if (ctl.disposed) return;
    applyTerminalHeight(saved ?? TERMINAL_DEFAULT_HEIGHT);
  };
  const setTerminalOpen = (open) => {
    if (ctl.disposed) return;
    ctl.bottomEl.classList.toggle('collapsed', !open);
    ctl.termGripEl.hidden = !open;
    root.classList.toggle('terminal-open', open);
  };
  ctl.termGripEl.hidden = true;
  restoreTerminalHeight();

  // W59f：终端上缘 grip。向上拖增高，按当前代码窗格 60% 限位；松手才落盘，避免 IO 风暴。
  ctl.termGripEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = ctl.bottomEl.getBoundingClientRect().height || +ctl.bottomEl.dataset.height || TERMINAL_DEFAULT_HEIGHT;
    try { ctl.termGripEl.setPointerCapture?.(e.pointerId); } catch {}
    root.classList.add('term-resizing');
    const move = (ev) => applyTerminalHeight(startHeight + startY - ev.clientY);
    ctl.cancelGripDrag?.();
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      root.classList.remove('term-resizing');
      if (!ctl.disposed) applyTerminalHeight(+ctl.bottomEl.dataset.height, { persist: true });
      ctl.cancelGripDrag = null;
    };
    ctl.cancelGripDrag = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  ctl.termGripEl.addEventListener('dblclick', () => applyTerminalHeight(TERMINAL_DEFAULT_HEIGHT, { persist: true }));

  async function init() {
    const monaco = await getMonaco();
    if (ctl.disposed) return;
    ctl.monaco = monaco;
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
    ctl.disposables.push(ctl.model.onDidChangeContent(() => {
      if (!ctl._loading) window.MazzHost?.notifyChange(container); // W58d：程序化装载期免脏（幻影改动绝育）
      contextKeys.set('hasSelection', !ctl.editor.getSelection().isEmpty());
    }));
    ctl.disposables.push(ctl.editor.onDidChangeCursorSelection(() => {
      contextKeys.set('hasSelection', !ctl.editor.getSelection().isEmpty());
    }));
    ctl.disposables.push(ctl.editor.onDidFocusEditorText(() => {
      current = ctl;
      contextKeys.set('module', MODULE);
    }));
    // 主题联动
    ctl.themeObserver = watchTheme(ctl.editor);
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
    return mo;
  }

  void init().catch((error) => {
    if (ctl.disposed) return;
    ctl.initError = error;
    console.error('[code] Monaco 初始化失败:', error);
  });

  // 终端面板（默认折叠；最后一个终端被关闭时自动收起，重新展开时若无终端自动新建）
  ctl.toggleTerminal = async (show) => {
    if (ctl.disposed) return;
    const want = show ?? ctl.bottomEl.classList.contains('collapsed');
    if (want) await restoreTerminalHeight();
    if (ctl.disposed) return;
    setTerminalOpen(want);
    const cwd = ctl.filePath ? ctl.filePath.replace(/[\\/][^\\/]*$/, '') : undefined;
    if (want && !ctl.terminal) {
      ctl.terminal = new TerminalPanel(ctl.bottomEl, {
        onCountChange: (n) => { if (n === 0) setTerminalOpen(false); },
      });
      await ctl.terminal.create({ cwd });
    } else if (want && ctl.terminal && !ctl.terminal.count()) {
      await ctl.terminal.create({ cwd });
    }
    if (want) {
      const timer = setTimeout(() => {
        ctl.timers.delete(timer);
        if (!ctl.disposed) ctl.terminal?.resize();
      }, 50);
      ctl.timers.add(timer);
    }
  };

  /** 全语言运行（W58）：语言三保险（ctl.language ← 扩展名兜底 ← 语言选择器）+工具链探测+四档分级 */
  ctl.runFile = async () => {
    // W58 扩展名权威优先：filePath 有扩展名映射即以文件为准（默认 javascript 会挡住 html/py 等——plaintext 兜底不够实锤；
    // 用户手动改语言后未被保存前不重置（setLanguage 会更新 filePath 吗？不会——保存才同步，合理）
    const extLang = ctl.filePath ? langOf(ctl.filePath) : null;
    if (extLang && extLang !== ctl.language) window.MazzCommands?.execute('code.setLanguage', { language: extLang });
    else if ((!ctl.language || ctl.language === 'plaintext') && ctl.filePath) {
      const l = langOf(ctl.filePath);
      if (l) window.MazzCommands?.execute('code.setLanguage', { language: l });
    }
    const lang = ctl.language || 'plaintext';
    const runner = RUNNERS[lang];
    if (!runner || runner.type === 'none') {
      toast(runner?.reason || `「${lang}」不可运行（数据/样式/标记类）`, [], 4000);
      return;
    }
    if (!ctl.filePath) { toast('请先保存文件再运行'); return; }
    if (runner.type === 'preview') {
      window.MazzCommands?.execute('file.newBrowser');
      const url = 'mazz-res://media/' + encodeURIComponent(String(ctl.filePath).replace(/\\/g, '/'));
      // 轮询等浏览器页签就绪再 openUrl（queueNav 竞态闸 viewReady 自带；file.newBrowser 异步 openTab+bv:create+activate 可超 600ms——单次延时必丢 nav 实锤）
      const t0 = Date.now();
      const tryNav = () => {
        const bctl = window.__activeBrowserCtl;
        if (bctl?.tabs?.length && bctl.openUrl) { bctl.openUrl(url); return; }
        if (Date.now() - t0 < 4000) setTimeout(tryNav, 300);
        else window.mazz.invoke('bv:nav', { tabId: bctl?.tabs?.[0]?.viewId, action: 'load', url }).catch(() => {});
      };
      setTimeout(tryNav, 300);
      return;
    }
    const det = await window.mazz.invoke('toolchain:detect', { exe: runner.exe }).catch(() => ({ exe: null }));
    if (!det?.exe) {
      const name = Array.isArray(runner.exe) ? runner.exe.join(' 或 ') : runner.exe;
      toast(`缺少工具链「${name}」——安装后重试（如未安装，请先装对应语言环境）`, [], 6000);
      return;
    }
    await window.MazzCommands.execute('file.save');
    await ctl.toggleTerminal(true);
    const term = ctl.terminal;
    if (!term?.activeId) { toast('终端创建失败（node-pty 未就绪或被拦截）——无法运行', [], 5000); return; }
    const cmd = runner.type === 'compile'
      ? runner.cmd(ctl.filePath, (os_tmp() + '/mazz-build-' + Math.random().toString(36).slice(2, 8) + (navigator.platform?.startsWith('Win') ? '.exe' : '')), det.exe)
      : runner.cmd(ctl.filePath);
    window.mazz.invoke('term:write', { id: term.activeId, data: cmd + '\r' });
  };
  const os_tmp = () => (navigator.platform?.startsWith('Win') ? (window.__tmpEnv || 'C:/Windows/Temp') : '/tmp');

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
  progressKind: 'editor',
  progressPath(state) { return state?.filePath || ''; },

  create(container) {
    const ctl = createCode(container, {});
    instances.set(container, ctl);
    // W58 根治：create 必须返回 ctl 本体（返回 { container } 的畸形态让 inst.state 与真 ctl 分家——
    // saveTab/openTab 写的 filePath/language 全进了 { container } 空壳，runFile 读真 ctl 全是 null=「保存后无法运行」的总根）
    return ctl;
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

  dispose(state) {
    const ctl = instances.get(state.container);
    if (!ctl || ctl.disposed) return;
    ctl.disposed = true;
    ctl.ready = false;
    ctl.cancelGripDrag?.();
    ctl.cancelGripDrag = null;
    if (ctl.pendingTextTimer) clearInterval(ctl.pendingTextTimer);
    ctl.pendingTextTimer = null;
    for (const timer of ctl.timers) clearTimeout(timer);
    ctl.timers.clear();
    ctl.debug?.dispose?.();
    ctl.terminal?.dispose?.();
    ctl.themeObserver?.disconnect?.();
    ctl.themeObserver = null;
    for (const disposable of ctl.disposables.splice(0)) {
      try { disposable?.dispose?.(); } catch {}
    }
    try { ctl.editor?.dispose?.(); } catch {}
    try { ctl.model?.dispose?.(); } catch {}
    ctl.editor = null;
    ctl.model = null;
    ctl.monaco = null;
    ctl.root?.remove();
    instances.delete(state.container);
    if (current === ctl) current = null;
    if (window.__activeCodeCtl === ctl) window.__activeCodeCtl = null;
  },

  getContent(state) {
    const ctl = instances.get(state.container);
    return ctl?.editor ? ctl.editor.getValue() : (ctl?._pendingText ?? '');
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    const text = typeof data === 'string' ? data : '';
    if (typeof data !== 'string' && data != null) console.warn('[code] setContent 非字符串输入已忽略（降级 tab 防对象契约连坐）');
    // 语言按文件类型（由外壳经 setLanguage 提前指定，或内容推断）
    const setModel = async () => {
      await getMonaco();
      if (ctl.disposed) return;
      // W58d 程序化装载免脏：setValue 触发 onDidChangeContent=打开即幻影改动（关签弹保存闸实锤）——装载窗内抑制
      const put = (v) => { ctl._loading = true; try { ctl.editor.setValue(v); } finally { ctl._loading = false; } };
      if (ctl.editor) {
        put(text);
        ctl.editor.revealLine(1);
      } else {
        ctl._pendingText = text;
        if (ctl.pendingTextTimer) clearInterval(ctl.pendingTextTimer);
        ctl.pendingTextTimer = setInterval(() => {
          if (ctl.disposed) {
            clearInterval(ctl.pendingTextTimer);
            ctl.pendingTextTimer = null;
            return;
          }
          if (ctl.editor) {
            clearInterval(ctl.pendingTextTimer);
            ctl.pendingTextTimer = null;
            put(ctl._pendingText || '');
          }
        }, 100);
      }
    };
    setModel();
  },
  langOfPath(p) { return langOf(p); },
  setLanguage(lang, state) {
    const ctl = instances.get(state.container);
    if (ctl) ctl.language = lang;
    if (ctl?.model) {
      getMonaco().then(monaco => monaco.editor.setModelLanguage(ctl.model, lang));
    }
    // W58⑥：语言按钮文本同步 + 表外语动态插项（扩展名同步出表外语时 UI 不错乱）
    const known = LANGUAGE_CATALOG.some(x => x.id === lang);
    const name = languageName(lang);
    for (const t of document.querySelectorAll('#code-lang-text')) t.textContent = name;
    if (!known) {
      import('../../core/menu-service.js').then(({ menus }) => {
        menus.contribute('code/langMenu', [{ command: 'code.lang.' + lang, title: lang, group: 'lang', source: 'code-lang' }]);
      }).catch(() => {});
      import('../../core/command-registry.js').then(({ commands }) => {
        const cmdId = 'code.lang.' + lang;
        if (!commands.get(cmdId)) commands.register(cmdId, { title: '语言：' + lang, group: '编程', when: "module=='code'", run: () => window.MazzCommands.execute('code.setLanguage', { language: lang }) });
      }).catch(() => {});
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
  captureProgress(state) {
    const ctl = instances.get(state.container);
    const sel = ctl?.editor?.getSelection?.();
    if (!sel) return null;
    return {
      startLine: sel.startLineNumber, startColumn: sel.startColumn,
      endLine: sel.endLineNumber, endColumn: sel.endColumn,
      scrollTop: ctl.editor.getScrollTop?.() || 0,
    };
  },
  async applyProgress(value, state) {
    const ctl = instances.get(state.container);
    if (!ctl || !value) return;
    for (let i = 0; i < 30 && !ctl.editor; i++) await new Promise(r => setTimeout(r, 50));
    if (!ctl.editor) return;
    const model = ctl.editor.getModel();
    const line = (n) => Math.max(1, Math.min(model.getLineCount(), Number(n) || 1));
    const sl = line(value.startLine), el = line(value.endLine || value.startLine);
    const col = (ln, n) => Math.max(1, Math.min(model.getLineMaxColumn(ln), Number(n) || 1));
    ctl.editor.setSelection({ startLineNumber: sl, startColumn: col(sl, value.startColumn), endLineNumber: el, endColumn: col(el, value.endColumn || value.startColumn) });
    ctl.editor.revealPositionInCenter({ lineNumber: sl, column: col(sl, value.startColumn) });
    if (Number.isFinite(Number(value.scrollTop))) ctl.editor.setScrollTop(Math.max(0, Number(value.scrollTop)));
  },

  toolbarHTML: `
    <div class="rb-group" data-label="语言">
      <button class="rb-btn" id="code-lang-btn" title="编程语言（点击切换——子窗格选择格，分屏不被压）"><i class="ico">≣</i><span id="code-lang-text">JavaScript</span><i class="ico">▾</i></button>
      <select class="rb-select" id="code-lang" title="编程语言" style="display:none">
        ${LANGUAGE_CATALOG.map(x => `<option value="${x.id}">${x.label}</option>`).join('')}
      </select>
    </div>
    <div class="rb-group" data-label="运行">
      <button class="rb-btn" data-command="code.runFile"><i class="ico">▶</i><span>运行文件</span></button>
      <button class="rb-btn" data-command="code.runSelection"><i class="ico">⏎</i><span>运行选区</span></button>
      <button class="rb-btn" data-command="code.format"><i class="ico">${iconHtml('⌨')}</i><span>格式化</span></button>
    </div>
    <div class="rb-group" data-label="终端">
      <button class="rb-btn" data-command="code.toggleTerminal"><i class="ico">▗</i><span>切换终端</span></button>
      <button class="rb-btn" data-command="code.newTerminal"><i class="ico">＋</i><span>新建终端</span></button>
    </div>`,
  async bindToolbar(panel) { // async（W58 B12 菜单贡献 await import 需要）
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
    // W58 B12：语言下拉子窗格化（select 弹出层分屏被压——按钮+ctxmenu 选择格；select 留暗桩兼容）
    const LANG_MENU = LANGUAGE_CATALOG.map(x => [x.id, x.label, x.tier]);
    const langBtn = panel.querySelector('#code-lang-btn');
    const langText = panel.querySelector('#code-lang-text');
    const curName = (id) => (LANG_MENU.find(x => x[0] === id) || [null, id])[1] || id;
    if (langText && current) langText.textContent = curName(current.language || 'javascript');
    const { menus } = await import('../../core/menu-service.js');
    menus.removeBySource?.('code-lang');
    const tierItems = LANGUAGE_TIERS.flatMap(tier => {
      const rows = LANG_MENU.filter(([, , rowTier]) => rowTier === tier.id);
      return [
        { command: `code.lang.header.${tier.id}`, title: `${tier.code} · ${tier.label}（${rows.length}）`, type: 'heading', group: tier.group, order: -1, source: 'code-lang' },
        ...rows.map(([id, name], order) => ({ command: 'code.lang.' + id, title: name, group: tier.group, order, source: 'code-lang' })),
      ];
    });
    menus.contribute('code/langMenu', tierItems);
    const { commands } = await import('../../core/command-registry.js');
    for (const [id] of LANG_MENU) {
      const cmdId = 'code.lang.' + id;
      if (!commands.get(cmdId)) commands.register(cmdId, { title: '语言：' + curName(id), group: '编程', when: "module=='code'", run: () => {
        window.MazzCommands.execute('code.setLanguage', { language: id });
      } });
    }
    langBtn?.addEventListener('click', (e) => {
      const r = langBtn.getBoundingClientRect();
      menus.show('code/langMenu', { x: r.left, y: r.bottom + 4 });
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
          const ext = PRIMARY_EXT_BY_LANGUAGE[lang] || 'txt';
          const tabName = document.querySelector('.tab.on .t-name')?.textContent || '';
          if (tabName.startsWith('未命名.')) {
            window.MazzHost?.setTabTitle(ctl.container, `未命名.${ext}`);
          }
          // W58 按钮文本同步统一出口（菜单/code.setLanguage 命令双通道都过这层——def.setLanguage 的同步是 API 层另一半）
          for (const t of document.querySelectorAll('#code-lang-text')) t.textContent = languageName(lang);
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
