// renderer/modules/math/index.js —— 数学计算内核（Python+JS 双后端 REPL）
import { contextKeys } from '../../core/contextkey-service.js';
import { toast } from '../../shell/shell.js';

const MODULE = 'math';
const instances = new Map();
let current = null;

// ==================== JS 沙箱后端 ====================
function createJsSandbox() {
  const logs = [];
  const sandbox = {
    console: {
      log: (...a) => logs.push(a.map(fmt).join(' ')),
      error: (...a) => logs.push('[错误] ' + a.map(fmt).join(' ')),
      warn: (...a) => logs.push('[警告] ' + a.map(fmt).join(' ')),
    },
  };
  function fmt(v) {
    if (typeof v === 'object' && v !== null) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
    return String(v);
  }
  return {
    exec(code) {
      logs.length = 0;
      try {
        const fn = new Function('console', 'Math', 'JSON', 'Date', ...Object.keys(sandbox),
          `"use strict";\nlet __result__;\n${code.includes('return') ? code : `__result__ = (${code});`}\nreturn __result__;`);
        const result = fn(sandbox.console, Math, JSON, Date, ...Object.values(sandbox));
        if (result !== undefined) logs.push('⇒ ' + fmt(result));
        return { output: logs.join('\n') || '（无输出）' };
      } catch (e) {
        return { output: logs.join('\n') + (logs.length ? '\n' : '') + e.name + ': ' + e.message, error: true };
      }
    },
  };
}

// ==================== REPL 模块 ====================
function createMath(container) {
  const root = document.createElement('div');
  root.className = 'math-root';
  root.innerHTML = `
    <div class="math-bar">
      <select class="rb-select" id="math-backend">
        <option value="python">Python</option><option value="js">JavaScript</option>
      </select>
      <button class="rb-btn" data-a="restart" title="重启内核">↻ 重启内核</button>
      <button class="rb-btn" data-a="clear" title="清屏">清屏</button>
      <span class="math-status"></span>
    </div>
    <div class="math-log"></div>
    <div class="math-input-row">
      <span class="math-prompt">»</span>
      <textarea class="math-input" rows="2" placeholder="输入表达式，Ctrl+Enter 执行；Shift+Enter 换行" spellcheck="false"></textarea>
      <button class="rb-btn" data-a="run" style="flex-direction:row">运行</button>
    </div>`;
  container.appendChild(root);

  const ctl = {
    container, root,
    backend: 'python',
    jsSandbox: createJsSandbox(),
    logEl: root.querySelector('.math-log'),
    inputEl: root.querySelector('.math-input'),
    statusEl: root.querySelector('.math-status'),
    history: [],
    hIdx: -1,
  };

  const backendSel = root.querySelector('#math-backend');
  backendSel.addEventListener('change', () => {
    ctl.backend = backendSel.value;
    updateStatus();
    ctl.inputEl.focus();
  });

  async function updateStatus() {
    if (ctl.backend === 'python') {
      if (window.mazz?.isElectron) {
        const st = await window.mazz.invoke('py:status');
        ctl.statusEl.textContent = st.python ? `内核: ${st.python}` : '内核: 未启动（首次执行自动拉起）';
      } else ctl.statusEl.textContent = 'Python 内核需要桌面版';
    } else {
      ctl.statusEl.textContent = '内核: 内置 JS 沙箱';
    }
  }
  updateStatus();

  function append(role, text, cls = '') {
    const el = document.createElement('div');
    el.className = `math-entry ${cls}`;
    el.innerHTML = `<div class="math-role">${role}</div><pre class="math-text"></pre>`;
    el.querySelector('.math-text').textContent = text;
    ctl.logEl.appendChild(el);
    ctl.logEl.scrollTop = ctl.logEl.scrollHeight;
  }

  async function run(code) {
    if (!code.trim()) return;
    append('»', code, 'in');
    ctl.history.unshift(code);
    ctl.hIdx = -1;
    ctl.inputEl.value = '';
    if (ctl.backend === 'js') {
      const r = ctl.jsSandbox.exec(code);
      append('⇐', r.output, r.error ? 'err' : 'out');
      return;
    }
    // Python
    if (!window.mazz?.isElectron) { append('⇐', 'Python 内核需要桌面版', 'err'); return; }
    append('…', '执行中…', 'pending');
    const pending = ctl.logEl.lastChild;
    try {
      const r = await window.mazz.invoke('py:exec', { code });
      pending.remove();
      append('⇐', r.output || '（无输出）', 'out');
    } catch (e) {
      pending.remove();
      append('⇐', e.message, 'err');
    }
  }

  root.querySelector('[data-a=run]').addEventListener('click', () => run(ctl.inputEl.value));
  root.querySelector('[data-a=clear]').addEventListener('click', () => { ctl.logEl.innerHTML = ''; });
  root.querySelector('[data-a=restart]').addEventListener('click', async () => {
    if (window.mazz?.isElectron) {
      await window.mazz.invoke('py:restart');
      toast('Python 内核已重启');
      updateStatus();
    }
  });
  ctl.inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(ctl.inputEl.value); }
    if (e.key === 'ArrowUp' && !ctl.inputEl.value.includes('\n')) {
      if (ctl.hIdx < ctl.history.length - 1) { ctl.hIdx++; ctl.inputEl.value = ctl.history[ctl.hIdx]; e.preventDefault(); }
    }
    if (e.key === 'ArrowDown' && ctl.hIdx > 0) { ctl.hIdx--; ctl.inputEl.value = ctl.history[ctl.hIdx]; e.preventDefault(); }
  });
  ctl.inputEl.addEventListener('focus', () => { current = ctl; contextKeys.set('module', MODULE); });

  ctl.exec = run;
  ctl.setBackend = (b) => { backendSel.value = b; ctl.backend = b; updateStatus(); };
  return ctl;
}

// ==================== 模块契约 ====================
export default {
  displayName: '计算',
  icon: '🧮',

  create(container) {
    const ctl = createMath(container);
    instances.set(container, ctl);
    return { container };
  },
  activate(container) {
    const ctl = instances.get(container);
    if (!ctl) return;
    current = ctl;
    contextKeys.set('module', MODULE);
    ctl.inputEl.focus();
  },
  deactivate(container) {
    if (current === instances.get(container)) current = null;
  },
  getContent(state) {
    const ctl = instances.get(state.container);
    return ctl ? JSON.stringify({ mark: 'mazz-math-v1', backend: ctl.backend, history: ctl.history.slice(0, 50) }) : '';
  },
  setContent(data, state) {
    const ctl = instances.get(state.container);
    if (!ctl) return;
    try {
      const obj = JSON.parse(data);
      if (obj.backend) ctl.setBackend(obj.backend);
      ctl.history = obj.history || [];
    } catch {}
  },
  newDocument(state) {
    const ctl = instances.get(state.container);
    if (ctl) { ctl.logEl.innerHTML = ''; ctl.history = []; }
  },
  getCharCount(state) {
    const ctl = instances.get(state.container);
    return ctl ? ctl.history.length : 0;
  },
  getCursorPos(state) { return 'REPL'; },

  toolbarHTML: `
    <div class="rb-group" data-label="内核">
      <button class="rb-btn" data-command="math.run"><i class="ico">▶</i><span>运行</span></button>
      <button class="rb-btn" data-command="math.restart"><i class="ico">↻</i><span>重启内核</span></button>
      <button class="rb-btn" data-command="math.clear"><i class="ico">⌫</i><span>清屏</span></button>
    </div>`,
  bindToolbar(panel) {
    panel.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => window.MazzCommands.execute(btn.dataset.command));
    });
  },

  contributes: {
    commands: [
      { id: 'math.run', title: '运行', group: '计算', when: "module=='math'",
        run: () => current?.exec(current.inputEl.value) },
      { id: 'math.restart', title: '重启内核', group: '计算', when: "module=='math'",
        run: () => current?.root.querySelector('[data-a=restart]').click() },
      { id: 'math.clear', title: '清屏', group: '计算', when: "module=='math'",
        run: () => current?.root.querySelector('[data-a=clear]').click() },
    ],
    keybindings: [],
    menus: {},
    bridges: [],
    aiActions: [],
  },
};
