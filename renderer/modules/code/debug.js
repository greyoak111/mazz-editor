// renderer/modules/code/debug.js —— DAP 调试客户端（断点/单步/变量/监视/调用栈/调试控制台）
import { toast, modal } from '../../shell/shell.js';
import { inputModal } from '../../shell/shell.js';

export class DebugService {
  constructor(ctl) {
    this.ctl = ctl;
    this.breakpoints = new Set(); // Set<line>
    this.bpDeco = [];
    this.stopDeco = [];
    this.active = false;
    this.threads = [];
    this.currentThreadId = null;
    this.watches = [];
    this.panel = null;
    this._wireGutter();
    this._wireEvents();
  }

  get editor() { return this.ctl.editor; }

  // ==================== 断点（边距点击切换） ====================
  _wireGutter() {
    const iv = setInterval(() => {
      if (!this.editor) { clearInterval(iv); return; }
      clearInterval(iv);
      this.editor.updateOptions({ glyphMargin: true });
      this.editor.onMouseDown((e) => {
        if (e.target.type === 2 /* GUTTER_GLYPH_MARGIN */ || e.target.type === 3 /* GUTTER_LINE_NUMBERS */) {
          this.toggleBreakpoint(e.target.position.lineNumber);
        }
      });
    }, 300);
  }

  toggleBreakpoint(line) {
    if (this.breakpoints.has(line)) this.breakpoints.delete(line);
    else this.breakpoints.add(line);
    this.renderBreakpoints();
  }

  renderBreakpoints() {
    if (!this.editor) return;
    this.bpDeco = this.editor.deltaDecorations(this.bpDeco, [...this.breakpoints].map(line => ({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { glyphMarginClassName: 'debug-bp' },
    })));
  }

  async syncBreakpoints() {
    if (!this.ctl.filePath) return;
    await this.req('setBreakpoints', {
      source: { path: this.ctl.filePath },
      breakpoints: [...this.breakpoints].map(line => ({ line })),
    });
  }

  // ==================== 会话 ====================
  async start() {
    if (!window.mazz?.isElectron) { toast('调试需要桌面版'); return; }
    if (!this.ctl.filePath) { toast('请先保存文件再调试'); return; }
    if (this.ctl.language !== 'python') { toast('当前支持 Python 调试（JS 调试适配器随后接入）'); return; }
    await window.MazzCommands.execute('file.save');

    const cfg = await openLaunchDialog(this.ctl);
    if (!cfg) return;

    const res = await window.mazz.invoke('debug:start', {
      type: 'python', program: cfg.program, args: cfg.args, cwd: cfg.cwd,
      stopOnEntry: cfg.stopOnEntry, pythonPath: cfg.pythonPath,
    });
    if (res.error) { toast(res.error); return; }

    this.active = true;
    await this.syncBreakpoints();
    await this.req('configurationDone');
    this.showPanel(true);
    toast('调试会话已启动');
  }

  async stop() {
    await window.mazz.invoke('debug:stop');
    this.active = false;
    this.clearStopMark();
    this.showPanel(false);
  }

  async req(command, args) {
    const r = await window.mazz.invoke('debug:request', { command, args });
    if (r.error) throw new Error(r.error);
    return r.body;
  }

  async continue_() { try { await this.req('continue', { threadId: this.currentThreadId }); this.clearStopMark(); } catch (e) { toast(e.message); } }
  async stepOver() { try { await this.req('next', { threadId: this.currentThreadId }); } catch (e) { toast(e.message); } }
  async stepIn() { try { await this.req('stepIn', { threadId: this.currentThreadId }); } catch (e) { toast(e.message); } }
  async stepOut() { try { await this.req('stepOut', { threadId: this.currentThreadId }); } catch (e) { toast(e.message); } }

  // ==================== 事件 ====================
  _wireEvents() {
    if (!window.mazz?.isElectron) return;
    window.mazz.on('debug:event', ({ channel, ...payload }) => {
      if (channel === 'dapEvent') this.onDapEvent(payload.event, payload.body);
      if (channel === 'output') this.appendConsole(payload.output, 'stderr');
      if (channel === 'terminated') {
        this.active = false;
        this.clearStopMark();
        toast(`调试会话结束（${payload.code}）`);
        this.showPanel(false);
      }
    });
  }

  async onDapEvent(event, body) {
    if (event === 'stopped') {
      this.currentThreadId = body.threadId;
      await this.refreshStack();
      this.showPanel(true);
    } else if (event === 'continued') {
      this.clearStopMark();
    } else if (event === 'output') {
      this.appendConsole(body.output || '', body.category || 'stdout');
    } else if (event === 'thread') {
      // 线程创建/退出（简化：用 stopped 时的 threadId）
    }
  }

  async refreshStack() {
    try {
      const stack = await this.req('stackTrace', { threadId: this.currentThreadId, startFrame: 0, levels: 20 });
      this.frames = stack.stackFrames || [];
      if (this.frames.length) {
        const top = this.frames[0];
        this.markStopped(top.line);
        await this.loadVariables(top.id);
      }
      this.renderPanel();
    } catch (e) { console.warn('[debug] stack:', e.message); }
  }

  markStopped(line) {
    this.clearStopMark();
    this.stopDeco = this.editor.deltaDecorations([], [{
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { isWholeLine: true, className: 'debug-stop-line', glyphMarginClassName: 'debug-stop-arrow' },
    }]);
    this.editor.revealLineInCenter(line);
  }
  clearStopMark() {
    if (this.editor) this.stopDeco = this.editor.deltaDecorations(this.stopDeco, []);
  }

  async loadVariables(frameId) {
    this.variables = [];
    const scopes = await this.req('scopes', { frameId });
    for (const scope of scopes.scopes || []) {
      const vars = await this.req('variables', { variablesReference: scope.variablesReference });
      this.variables.push({ name: scope.name, variables: vars.variables || [], ref: scope.variablesReference });
    }
  }

  async expandVariable(ref, container) {
    const vars = await this.req('variables', { variablesReference: ref });
    return vars.variables || [];
  }

  async evaluate(expr) {
    try {
      const r = await this.req('evaluate', { expression: expr, frameId: this.frames?.[0]?.id, context: 'repl' });
      return r.result || '';
    } catch (e) { return e.message; }
  }

  // ==================== 面板 UI ====================
  showPanel(show) {
    if (show) {
      if (!this.panel) this.buildPanel();
      this.panel.classList.add('on');
      this.renderPanel();
    } else {
      this.panel?.classList.remove('on');
    }
  }

  buildPanel() {
    this.panel = document.createElement('div');
    this.panel.className = 'debug-panel';
    this.panel.innerHTML = `
      <div class="debug-controls">
        <button data-a="continue" title="继续 (F5)">▶</button>
        <button data-a="over" title="单步跳过 (F10)">↷</button>
        <button data-a="in" title="单步进入 (F11)">↓</button>
        <button data-a="out" title="单步跳出 (Shift+F11)">↑</button>
        <button data-a="stop" title="停止 (Shift+F5)">■</button>
      </div>
      <div class="debug-sections">
        <div class="debug-sec"><div class="debug-sec-title">调用栈</div><div class="debug-stack"></div></div>
        <div class="debug-sec"><div class="debug-sec-title">变量</div><div class="debug-vars"></div></div>
        <div class="debug-sec"><div class="debug-sec-title">监视 <button data-a="addwatch">＋</button></div><div class="debug-watch"></div></div>
        <div class="debug-sec debug-sec-console"><div class="debug-sec-title">调试控制台</div>
          <div class="debug-console"></div>
          <input class="debug-eval" placeholder="回车求值（断点上下文）" spellcheck="false" />
        </div>
      </div>`;
    this.ctl.root.appendChild(this.panel);

    this.panel.querySelector('[data-a=continue]').addEventListener('click', () => this.continue_());
    this.panel.querySelector('[data-a=over]').addEventListener('click', () => this.stepOver());
    this.panel.querySelector('[data-a=in]').addEventListener('click', () => this.stepIn());
    this.panel.querySelector('[data-a=out]').addEventListener('click', () => this.stepOut());
    this.panel.querySelector('[data-a=stop]').addEventListener('click', () => this.stop());
    this.panel.querySelector('[data-a=addwatch]').addEventListener('click', async () => {
      const expr = await inputModal('监视表达式');
      if (expr?.trim()) { this.watches.push(expr.trim()); this.renderPanel(); }
    });
    const evalInput = this.panel.querySelector('.debug-eval');
    evalInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const expr = evalInput.value.trim();
      if (!expr) return;
      evalInput.value = '';
      this.appendConsole('> ' + expr, 'input');
      const result = await this.evaluate(expr);
      this.appendConsole(result, 'result');
    });
  }

  renderPanel() {
    if (!this.panel) return;
    // 调用栈
    const stackEl = this.panel.querySelector('.debug-stack');
    stackEl.innerHTML = (this.frames || []).map((f, i) =>
      `<div class="debug-frame ${i === 0 ? 'top' : ''}">${escapeHtml(f.name)} <span class="debug-frame-pos">${escapeHtml(f.source?.name || '')}:${f.line}</span></div>`).join('') || '<div class="debug-empty">（未暂停）</div>';
    // 变量
    const varsEl = this.panel.querySelector('.debug-vars');
    varsEl.innerHTML = (this.variables || []).map(scope => `
      <div class="debug-scope">${escapeHtml(scope.name)}</div>
      ${scope.variables.map(v => `<div class="debug-var" data-ref="${v.variablesReference}" data-expand="${v.variablesReference > 0 ? 1 : 0}">
        <span class="dv-name">${escapeHtml(v.name)}</span><span class="dv-value">${escapeHtml(v.value)}</span>
        ${v.type ? `<span class="dv-type">${escapeHtml(v.type)}</span>` : ''}</div>`).join('')}`).join('') || '<div class="debug-empty">（无变量）</div>';
    // 监视
    const watchEl = this.panel.querySelector('.debug-watch');
    watchEl.innerHTML = this.watches.map((w, i) =>
      `<div class="debug-var" data-watch="${i}"><span class="dv-name">${escapeHtml(w)}</span><span class="dv-value" id="watch-${i}">…</span></div>`).join('') || '<div class="debug-empty">（＋ 添加监视）</div>';
    this.watches.forEach(async (w, i) => {
      const el = this.panel.querySelector(`#watch-${i}`);
      if (el) el.textContent = await this.evaluate(w);
    });
    // 变量展开
    varsEl.querySelectorAll('[data-expand="1"]').forEach(el => {
      el.addEventListener('click', async () => {
        const ref = +el.dataset.ref;
        const children = await this.expandVariable(ref);
        el.querySelector('.dv-value').textContent = children.map(c => `${c.name}=${c.value}`).join(', ').slice(0, 200);
      });
    });
  }

  appendConsole(text, cls = '') {
    if (!this.panel) this.buildPanel();
    const el = this.panel.querySelector('.debug-console');
    const line = document.createElement('div');
    line.className = 'debug-console-line ' + cls;
    line.textContent = text.replace(/\n$/, '');
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
}

// ==================== 可视化 launch 配置 ====================
export function openLaunchDialog(ctl) {
  return new Promise((resolve) => {
    const m = modal('调试配置 (launch)');
    const program = ctl.filePath || '';
    m.body.innerHTML = `
      <div class="set-row"><label>程序</label><input id="lc-program" class="rb-input" style="width:70%" value="${escapeAttr(program)}"></div>
      <div class="set-row"><label>参数（空格分隔）</label><input id="lc-args" class="rb-input" style="width:70%" placeholder="arg1 arg2"></div>
      <div class="set-row"><label>工作目录</label><input id="lc-cwd" class="rb-input" style="width:70%" value="${escapeAttr(program.replace(/[\\/][^\\/]*$/, ''))}"></div>
      <div class="set-row"><label>Python 路径（可空=自动探测）</label><input id="lc-python" class="rb-input" style="width:70%" placeholder="python"></div>
      <div class="set-row"><label>入口暂停</label><input id="lc-stop" type="checkbox"></div>
      <div class="set-row"><label></label><button id="lc-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">启动调试 (F5)</button></div>
      <div style="color:var(--fg-dim);font-size:11.5px">需要本机 Python + debugpy（pip install debugpy）。配置自动记忆在本文件中。</div>`;
    m.body.querySelector('#lc-go').addEventListener('click', () => {
      m.close();
      resolve({
        program: m.body.querySelector('#lc-program').value.trim(),
        args: m.body.querySelector('#lc-args').value.trim().split(/\s+/).filter(Boolean),
        cwd: m.body.querySelector('#lc-cwd').value.trim(),
        pythonPath: m.body.querySelector('#lc-python').value.trim() || undefined,
        stopOnEntry: m.body.querySelector('#lc-stop').checked,
      });
    });
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
