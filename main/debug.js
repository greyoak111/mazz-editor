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
  constructor({ bus, windowManager, resourceLedger = null, spawnProcess = spawn, requestTimeout = 15000 }) {
    this.wm = windowManager;
    this.session = null; // {proc, seq, pending: Map, buffer}
    this.seq = 1;
    this.sessionSeq = 1;
    this.resourceLedger = resourceLedger;
    this.spawnProcess = spawnProcess;
    this.requestTimeout = requestTimeout;

    bus.handle('debug:start', async (config) => this.start(config));
    bus.handle('debug:stop', async () => { this.kill('user-stop'); return true; });
    bus.handle('debug:request', async ({ command, args }) => this.request(command, args));
    bus.handle('debug:status', async () => ({ active: !!this.session }));
  }

  broadcast(channel, payload) { this.wm.broadcast('debug:event', { channel, ...payload }); }

  async start(config) {
    if (this.session) this.kill('session-replaced');
    const adapter = ADAPTERS[config.type];
    if (!adapter) return { error: `不支持的调试类型: ${config.type}` };
    const [cmd, args] = adapter.cmd(config);
    try {
      const proc = this.spawnProcess(cmd, args, { cwd: config.cwd || process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      const id = `dap-${this.sessionSeq++}`;
      const session = {
        id, proc, pending: new Map(), buffer: Buffer.alloc(0),
        eventWaiters: new Map(), launchPromise: null,
        resourceKey: this.resourceLedger?.register({
          type: 'debug-process', id, owner: 'debug-service', state: 'running',
          meta: { adapter: config.type, cwd: config.cwd || process.cwd() },
        }) || null,
      };
      this.session = session;
      proc.stdout.on('data', (d) => this.onData(d, session));
      proc.stderr.on('data', (d) => {
        if (this.session === session) this.broadcast('output', { category: 'stderr', output: d.toString() });
      });
      proc.once('exit', (code, signal) => this._endSession(session, 'process-exit', { code, signal }, true));
      proc.once('error', (error) => this._endSession(session, 'process-error', { error: error.message }, true));
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
      }, session);
      if (initRes.error) {
        this.kill('initialize-failed', session);
        return initRes;
      }
      // launch
      // DAP 的标准顺序是 launch request → initialized event → 客户端配置断点/
      // configurationDone → launch response。若在这里直接 await launch response，
      // renderer 永远拿不到控制权发送 configurationDone，会与真实 debugpy 死锁。
      const initialized = this.waitForEvent('initialized', session);
      const launchPromise = this.request('launch', {
        program: config.program,
        args: config.args || [],
        cwd: config.cwd || path.dirname(config.program || '.'),
        stopOnEntry: !!config.stopOnEntry,
        console: 'internalConsole',
        justMyCode: config.justMyCode !== false,
      }, session);
      session.launchPromise = launchPromise;
      const ready = await Promise.race([
        initialized.then(result => ({ source: 'initialized', result })),
        launchPromise.then(result => ({ source: 'launch', result })),
      ]);
      if (ready.result?.error) {
        this.kill('launch-failed', session);
        return ready.result;
      }
      // 某些 adapter 在 configurationDone 前就回复 launch；真实 debugpy 则先发 initialized。
      // 对后一种情况继续观察迟到的 launch 失败，但不阻塞 renderer 配置断点。
      if (ready.source === 'initialized') launchPromise.then((result) => {
        if (!result?.error || this.session !== session) return;
        this.broadcast('output', { category: 'stderr', output: `${result.error}\n` });
        this.kill('launch-failed', session);
      });
      return { ok: true, capabilities: initRes.body || {} };
    } catch (e) {
      this.kill('start-failed');
      return { error: `调试适配器启动失败: ${e.message}（请确认已安装 Python 与 debugpy：pip install debugpy）` };
    }
  }

  onData(chunk, s = this.session) {
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
      try { this.onMessage(JSON.parse(body), s); } catch (e) { console.error('[dap] 解析失败:', e.message); }
    }
  }

  onMessage(msg, s = this.session) {
    if (!s) return;
    if (msg.type === 'response') {
      const pending = s.pending.get(msg.request_seq);
      if (pending) {
        s.pending.delete(msg.request_seq);
        clearTimeout(pending.timer);
        pending.resolve(msg);
      }
    } else if (msg.type === 'event') {
      const waiters = s.eventWaiters?.get(msg.event);
      if (waiters?.size) {
        s.eventWaiters.delete(msg.event);
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.resolve({ body: msg.body || {} });
        }
      }
      if (this.session === s) {
        this.broadcast('dapEvent', { event: msg.event, body: msg.body || {} });
        // debugpy 在被调试程序结束后会发送 terminated，但 adapter 本身仍可能等待客户端断开。
        // 该事件已经是会话终态；若只等子进程自行退出，最后一轮会一直留着 adapter 与资源账。
        if (msg.event === 'terminated') this.kill('adapter-terminated', s);
      }
    }
  }

  waitForEvent(event, s = this.session, timeout = this.requestTimeout) {
    return new Promise((resolve) => {
      if (!s) return resolve({ error: '无活动调试会话' });
      if (!s.eventWaiters.has(event)) s.eventWaiters.set(event, new Set());
      const waiter = {
        timer: null,
        resolve: (result) => resolve(result),
      };
      waiter.timer = setTimeout(() => {
        s.eventWaiters.get(event)?.delete(waiter);
        if (!s.eventWaiters.get(event)?.size) s.eventWaiters.delete(event);
        resolve({ error: `DAP 事件超时: ${event}` });
      }, timeout);
      s.eventWaiters.get(event).add(waiter);
    });
  }

  request(command, args = {}, s = this.session) {
    return new Promise((resolve) => {
      if (!s) return resolve({ error: '无活动调试会话' });
      const seq = this.seq++;
      const timer = setTimeout(() => {
        if (s.pending.has(seq)) { s.pending.delete(seq); resolve({ error: 'DAP 请求超时: ' + command }); }
      }, this.requestTimeout);
      s.pending.set(seq, { timer, resolve: (msg) => {
        if (msg.success === false) resolve({ error: msg.message || '请求失败' });
        else resolve({ body: msg.body || {} });
      } });
      const body = JSON.stringify({ seq, type: 'request', command, arguments: args });
      try {
        s.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      } catch (e) {
        const pending = s.pending.get(seq);
        if (pending) clearTimeout(pending.timer);
        s.pending.delete(seq);
        resolve({ error: e.message });
      }
    });
  }

  _endSession(session, reason, meta = {}, fromProcess = false) {
    if (!session) return false;
    const wasCurrent = this.session === session;
    if (wasCurrent) this.session = null;
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ success: false, message: `调试会话已结束：${reason}` });
    }
    session.pending.clear();
    for (const waiters of session.eventWaiters?.values() || []) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve({ error: `调试会话已结束：${reason}` });
      }
    }
    session.eventWaiters?.clear();
    if (!fromProcess) { try { session.proc.kill(); } catch {} }
    if (session.resourceKey) {
      this.resourceLedger?.release(session.resourceKey, { reason, state: 'stopped', meta });
      session.resourceKey = null;
    }
    if (fromProcess && wasCurrent) this.broadcast('terminated', meta);
    return true;
  }

  kill(reason = 'user-kill', session = this.session) {
    return this._endSession(session, reason);
  }
}
module.exports = DebugService;
