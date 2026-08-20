// renderer/modules/math/index.js —— 数学计算内核（Python+JS 双后端 REPL）
import { contextKeys } from '../../core/contextkey-service.js';
import { iconHtml } from '../../lib/svg-icons.js';
import { toast } from '../../shell/shell.js';

const MODULE = 'math';
const instances = new Map();
let current = null;

// ==================== JS 沙箱后端 ====================
// 注意：页面 CSP 禁用 eval/new Function——JS 后端走自研安全表达式求值器（数值计算全覆盖）
// 纯表达式求值器：数字/四则/幂/取余/括号/一元正负/常用函数与常数
const EXPR_FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  exp: Math.exp, log: Math.log, ln: Math.log, log2: Math.log2, log10: Math.log10, lg: Math.log10,
  pow: Math.pow, min: Math.min, max: Math.max, hypot: Math.hypot,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  random: Math.random,
};
const EXPR_CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity, infinity: Infinity };

function evalExpr(src) {
  const s = String(src).replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  const eat = (ch) => { if (ch === undefined || s[i] === ch) { i++; return true; } return false; };
  const expect = (ch) => { if (!eat(ch)) throw new SyntaxError('在 ' + i + ' 处需要 ' + ch); };

  function parseNum() {
    const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return +m[0];
  }
  function parseIdent() {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  }
  function parseAtom() {
    if (eat('(')) { const v = parseAdd(); expect(')'); return v; }
    const num = parseNum();
    if (num !== null) return num;
    const id = parseIdent();
    if (id) {
      const key = id.toLowerCase().replace(/^math\./, '');
      if (eat('(')) {
        const args = [];
        if (!eat(')')) {
          for (;;) {
            args.push(parseAdd());
            if (eat(')')) break;
            expect(',');
          }
        }
        const fn = EXPR_FUNCS[key];
        if (!fn) throw new ReferenceError('未知函数: ' + id);
        return fn(...args);
      }
      if (Object.hasOwn(EXPR_CONSTS, key)) return EXPR_CONSTS[key];
      throw new ReferenceError('未知标识: ' + id);
    }
    throw new SyntaxError('无法解析: ' + s.slice(i, i + 8));
  }
  function parseSigned() {
    if (eat('+')) return parseSigned();
    if (eat('-')) return -parseSigned(); // 一元负号优先级低于幂（-2^2 = -4）
    return parsePow();
  }
  function parsePow() {
    const base = parseAtom();
    // 幂右结合；指数可带符号（2^-3）
    if (eat('^')) return Math.pow(base, parseSigned());
    if (s.startsWith('**', i)) { i += 2; return Math.pow(base, parseSigned()); }
    return base;
  }
  function parseMul() {
    let v = parseSigned();
    for (;;) {
      if (s.startsWith('**', i)) return v; // ** 是幂不是乘
      if (eat('*')) v *= parseSigned();
      else if (eat('/')) v /= parseSigned();
      else if (eat('%')) v %= parseSigned();
      else return v;
    }
  }
  function parseAdd() {
    let v = parseMul();
    for (;;) {
      if (eat('+')) v += parseMul();
      else if (eat('-')) v -= parseMul();
      else return v;
    }
  }
  const v = parseAdd();
  if (i < s.length) throw new SyntaxError('多余内容: ' + s.slice(i));
  return v;
}

function createJsSandbox() {
  const logs = [];
  function fmt(v) {
    if (typeof v === 'object' && v !== null) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
    return String(v);
  }
  return {
    exec(code) {
      logs.length = 0;
      // 语句/复杂 JS 超出表达式范畴：给出明确指引（CSP 禁用 eval，绝不静默失败）
      if (/console\.|=>|\bfunction\b|\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\b|\bwhile\b|\bif\b|\bclass\b|\bimport\b|\bnew\b|=[^=]/.test(code.replace(/\s+/g, ' '))) {
        return {
          output: 'JS 后端仅支持纯数学表达式（如 1+2*3、sqrt(2)、pow(2,10)、log(e^2)）。\n复杂脚本请用 Python 内核，或在代码模块中运行。',
          error: true,
        };
      }
      try {
        const v = evalExpr(code.replace(/\*\*/g, '^'));
        logs.push('⇒ ' + fmt(v));
        return { output: logs.join('\n') };
      } catch (e) {
        return { output: e.name + ': ' + e.message, error: true };
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
      <button class="rb-btn" data-a="restart" title="重启内核">${iconHtml('↻')}<span>重启内核</span></button>
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
  // B12b 收编：后端选择子窗格化（select 隐藏保留作状态单源，change 联动照旧）
  import('../../lib/select-menu.js').then(({ selectProxy }) => selectProxy(backendSel));
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
    // 计算器习惯：结尾单等号剥离（100+200= → 100+200；不影响 ==/>=/<=/!= 比较与 x=1 赋值）
    code = code.trim();
    if (/[^=!<>+\-*/%&|^~\s]=$/.test(code)) code = code.slice(0, -1);
    append('»', code, 'in');
    ctl.history.unshift(code);
    if (ctl.history.length > 50) ctl.history.length = 50;
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
  // 右键选单：运行/复制/清屏/重启（计算模块此前没有右键逻辑）
  ctl.root?.addEventListener?.('contextmenu', async (e) => {
    e.preventDefault();
    const { showDomMenu } = await import('../../lib/dom-menu.js');
    const sel = (window.getSelection()?.toString() || '').trim();
    showDomMenu([
      { label: '运行', fn: () => ctl.exec(ctl.inputEl.value) },
      { label: '复制选中', fn: () => sel && navigator.clipboard?.writeText(sel), disabled: !sel },
      { label: '复制全部输出', fn: () => navigator.clipboard?.writeText(ctl.logEl?.innerText || '') },
      '-',
      { label: '清屏', fn: () => window.MazzCommands.execute('math.clear') },
      { label: '重启内核', fn: () => window.MazzCommands.execute('math.restart') },
    ], e.clientX, e.clientY);
  });

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
      <button class="rb-btn" data-command="math.run"><i class="ico">${iconHtml('▶')}</i><span>运行</span></button>
      <button class="rb-btn" data-command="math.restart"><i class="ico">${iconHtml('↻')}</i><span>重启内核</span></button>
      <button class="rb-btn" data-command="math.clear"><i class="ico">${iconHtml('⌫')}</i><span>清屏</span></button>
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
