// main/python-kernel.js —— Python 计算内核（持久驱动进程，base64+哨兵协议）
// 驱动脚本常驻：stdin 收 base64 编码代码行 → exec 进全局命名空间 → 打印哨兵
// 状态跨执行保留（bridge #1 的 df 复用）；无交互模式的块终止坑
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PYTHON_CANDIDATES = process.platform === 'win32'
  ? ['python', 'py', 'python3'] : ['python3', 'python'];

const DRIVER = `import sys, base64, traceback
_g = {'__name__': '__mazz__'}
while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    try:
        b64, marker = line.split(' ', 1)
        code = base64.b64decode(b64.encode()).decode('utf-8')
        try:
            try:
                # 优先 single 模式（REPL 语义：表达式语句自动打印结果）
                exec(compile(code, '<mazz>', 'single'), _g)
            except SyntaxError:
                # 多语句代码退回 exec 模式
                exec(compile(code, '<mazz>', 'exec'), _g)
        except BaseException:
            traceback.print_exc()
        sys.stdout.write(marker + '\\n')
        sys.stdout.flush()
    except BaseException:
        traceback.print_exc()
        sys.stdout.flush()
`;

class PythonKernel {
  constructor({
    bus, windowManager, resourceLedger = null,
    spawnProcess = spawn, fsApi = fs, tempDir = os.tmpdir(),
  }) {
    this.proc = null;
    this.pythonPath = null;
    this.queue = [];
    this.busy = false;
    this.current = null;
    this.starting = null;
    this.wm = windowManager;
    this.driverPath = null;
    this.resourceLedger = resourceLedger;
    this.spawnProcess = spawnProcess;
    this.fs = fsApi;
    this.tempDir = tempDir;
    this.processResourceKey = null;
    this.driverResourceKey = null;

    bus.handle('py:exec', async ({ code, timeout = 30000 }) => this.exec(code, timeout));
    bus.handle('py:status', async () => ({
      available: !!this.proc && !this.proc.killed,
      python: this.pythonPath,
    }));
    bus.handle('py:restart', async () => { this.kill('restart'); await this.ensure(); return true; });
    if (process.env.NODE_ENV === 'test') {
      bus.handle('py:runtimeReset', async () => { this.kill('runtime-reset'); return true; });
    }
  }

  async detect() {
    if (this.pythonPath) return this.pythonPath;
    for (const cmd of PYTHON_CANDIDATES) {
      const ok = await new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(value);
        };
        try {
          const p = this.spawnProcess(cmd, ['-c', 'import sys;print(sys.version_info[0])'], { stdio: ['ignore', 'pipe', 'ignore'] });
          let out = '';
          p.stdout.on('data', d => out += d);
          p.once('close', (code) => finish(code === 0 && out.trim().startsWith('3')));
          p.once('error', () => finish(false));
          timer = setTimeout(() => { try { p.kill(); } catch {} finish(false); }, 4000);
        } catch { finish(false); }
      });
      if (ok) { this.pythonPath = cmd; return cmd; }
    }
    return null;
  }

  async ensure() {
    if (this.proc && !this.proc.killed) return true;
    if (this.starting) return this.starting;
    this.starting = this._start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async _start() {
    const cmd = await this.detect();
    if (!cmd) throw new Error('未检测到 Python。请安装 Python 3 并加入 PATH');
    if (!this.driverPath) {
      this.driverPath = path.join(this.tempDir, `mazz_py_driver_${process.pid}.py`);
      this.fs.writeFileSync(this.driverPath, DRIVER);
      this.driverResourceKey = this.resourceLedger?.register({
        type: 'temp-file', id: this.driverPath, owner: 'python-kernel', state: 'created',
        meta: { purpose: 'python-driver' },
      }) || null;
    }
    let proc = null;
    try {
      proc = this.spawnProcess(cmd, ['-u', this.driverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      this.processResourceKey = this.resourceLedger?.register({
        type: 'python-process', id: 'kernel', owner: 'python-kernel', state: 'running',
        meta: { command: cmd },
      }) || null;
      this.proc = proc;
    } catch (error) {
      try { proc?.kill(); } catch {}
      this._releaseProcess('start-failed', { error: error.message });
      this._cleanupDriver('start-failed');
      throw error;
    }
    this.buffer = '';
    proc.stdout.on('data', (d) => { if (this.proc === proc) this.buffer += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { if (this.proc === proc) this.buffer += d.toString('utf8'); });
    proc.once('exit', (code, signal) => this._handleProcessExit(proc, code, signal));
    proc.once('error', (error) => this._handleProcessExit(proc, null, null, error));
    return true;
  }

  async exec(code, timeout = 30000) {
    await this.ensure();
    return new Promise((resolve, reject) => {
      this.queue.push({ code, resolve, reject, timeout });
      this.pump();
    });
  }

  pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const job = this.queue.shift();
    const marker = `__MAZZ_DONE_${Date.now()}_${Math.floor(Math.random() * 1e6)}__`;
    this.buffer = '';
    const b64 = Buffer.from(job.code, 'utf8').toString('base64').replace(/\n/g, '');
    const timer = setTimeout(() => {
      if (this.current?.job !== job) return;
      job.reject(new Error('执行超时（Python 内核已终止，可重新执行）'));
      this.current = null;
      this.busy = false;
      this.kill('exec-timeout', { rejectCurrent: false });
    }, job.timeout);
    try {
      this.proc.stdin.write(b64 + ' ' + marker + '\n');
    } catch (e) {
      clearTimeout(timer);
      this.busy = false;
      job.reject(e);
      this.current = null;
      this.pump();
      return;
    }
    const iv = setInterval(() => {
      const idx = this.buffer.indexOf(marker);
      if (idx < 0) return;
      clearInterval(iv);
      clearTimeout(timer);
      const out = this.buffer.slice(0, idx).replace(/\r\n/g, '\n').replace(/\n+$/, '');
      this.busy = false;
      this.current = null;
      job.resolve({ output: out, python: this.pythonPath });
      this.pump();
    }, 40);
    this.current = { job, timer, interval: iv, proc: this.proc };
  }

  _rejectJobs(error, { rejectCurrent = true } = {}) {
    if (this.current) {
      clearTimeout(this.current.timer);
      clearInterval(this.current.interval);
      if (rejectCurrent) this.current.job.reject(error);
      this.current = null;
    }
    for (const job of this.queue.splice(0)) job.reject(error);
    this.busy = false;
  }

  _releaseProcess(reason, meta = {}) {
    if (!this.processResourceKey) return;
    this.resourceLedger?.release(this.processResourceKey, { reason, state: 'stopped', meta });
    this.processResourceKey = null;
  }

  _cleanupDriver(reason) {
    const driverPath = this.driverPath;
    this.driverPath = null;
    if (driverPath) {
      try { if (this.fs.existsSync(driverPath)) this.fs.unlinkSync(driverPath); } catch {}
    }
    if (this.driverResourceKey) {
      this.resourceLedger?.release(this.driverResourceKey, { reason, state: 'deleted' });
      this.driverResourceKey = null;
    }
  }

  _handleProcessExit(proc, code, signal, error = null) {
    if (this.proc !== proc) return;
    this.proc = null;
    this._releaseProcess(error ? 'process-error' : 'process-exit', { code, signal, error: error?.message || '' });
    this._rejectJobs(new Error(error?.message || `Python 内核已退出${code == null ? '' : `（${code}）`}`));
    this._cleanupDriver(error ? 'process-error' : 'process-exit');
  }

  kill(reason = 'user-kill', { rejectCurrent = true } = {}) {
    const proc = this.proc;
    this.proc = null;
    this._rejectJobs(new Error(`Python 内核已停止：${reason}`), { rejectCurrent });
    if (proc) { try { proc.kill(); } catch {} }
    this._releaseProcess(reason);
    this._cleanupDriver(reason);
    return !!proc;
  }
}
module.exports = PythonKernel;
