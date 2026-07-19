// main/debug.js —— 调试适配器池（DAP 协议：debugpy / 可插拔）
// 渲染进程做 UI（断点/变量/监视/调用栈/调试控制台），主进程管适配器进程
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const ADAPTERS = {
  python: {
    cmd: (config) => [config.pythonPath || 'python', ['-m', 'debugpy.adapter']],
  },
  // javascript: vscode-js-debug（随包锁版本，后续接入）
};

class DebugService {
  constructor({ bus, windowManager }) {
    this.wm = windowManager;
    this.session = null; // {proc, seq, pending: Map, buffer}
    this.seq = 1;

    bus.handle('debug:start', async (config) => this.start(config));
    bus.handle('debug:stop', async () => { this.kill(); return true; });
    bus.handle('debug:request', async ({ command, args }) => this.request(command, args));
    bus.handle('debug:status', async () => ({ active: !!this.session }));
  }

  broadcast(channel, payload) { this.wm.broadcast('debug:event', { channel, ...payload }); }

  async start(config) {
    if (this.session) this.kill();
    const adapter = ADAPTERS[config.type];
    if (!adapter) return { error: `不支持的调试类型: ${config.type}` };
    const [cmd, args] = adapter.cmd(config);
    try {
      const proc = spawn(cmd, args, { cwd: config.cwd || process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      this.session = { proc, pending: new Map(), buffer: Buffer.alloc(0) };
      proc.stdout.on('data', (d) => this.onData(d));
      proc.stderr.on('data', (d) => this.broadcast('output', { category: 'stderr', output: d.toString() }));
      proc.on('exit', (code) => {
        this.broadcast('terminated', { code });
        this.session = null;
      });
      // DAP 初始化握手
      const initRes = await this.request('initialize', {
        clientID: 'mazz-editor',
        clientName: 'Mazz Editor',
        adapterID: 'debugpy',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsVariablePaging: false,
        supportsRunInTerminalRequest: false,
        supportsProgressReporting: false,
      });
      if (initRes.error) return initRes;
      // launch
      await this.request('launch', {
        program: config.program,
        args: config.args || [],
        cwd: config.cwd || path.dirname(config.program || '.'),
        stopOnEntry: !!config.stopOnEntry,
        console: 'internalConsole',
        justMyCode: config.justMyCode !== false,
      });
      return { ok: true, capabilities: initRes.body || {} };
    } catch (e) {
      this.kill();
      return { error: `调试适配器启动失败: ${e.message}（请确认已安装 Python 与 debugpy：pip install debugpy）` };
    }
  }

  onData(chunk) {
    const s = this.session;
    if (!s) return;
    s.buffer = Buffer.concat([s.buffer, chunk]);
    while (true) {
      const headerEnd = s.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = s.buffer.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length: (\d+)/i.exec(header);
      if (!m) { s.buffer = s.buffer.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      if (s.buffer.length < headerEnd + 4 + len) return;
      const body = s.buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
      s.buffer = s.buffer.slice(headerEnd + 4 + len);
      try { this.onMessage(JSON.parse(body)); } catch (e) { console.error('[dap] 解析失败:', e.message); }
    }
  }

  onMessage(msg) {
    const s = this.session;
    if (msg.type === 'response') {
      const pending = s.pending.get(msg.request_seq);
      if (pending) {
        s.pending.delete(msg.request_seq);
        pending(msg);
      }
    } else if (msg.type === 'event') {
      this.broadcast('dapEvent', { event: msg.event, body: msg.body || {} });
    }
  }

  request(command, args = {}) {
    return new Promise((resolve) => {
      const s = this.session;
      if (!s) return resolve({ error: '无活动调试会话' });
      const seq = this.seq++;
      s.pending.set(seq, (msg) => {
        if (msg.success === false) resolve({ error: msg.message || '请求失败' });
        else resolve({ body: msg.body || {} });
      });
      const body = JSON.stringify({ seq, type: 'request', command, arguments: args });
      try {
        s.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      } catch (e) {
        s.pending.delete(seq);
        resolve({ error: e.message });
      }
      setTimeout(() => {
        if (s.pending.has(seq)) { s.pending.delete(seq); resolve({ error: 'DAP 请求超时: ' + command }); }
      }, 15000);
    });
  }

  kill() {
    if (this.session) {
      try { this.session.proc.kill(); } catch {}
      this.session = null;
    }
  }
}
module.exports = DebugService;
