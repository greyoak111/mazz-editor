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
  constructor({ bus, windowManager }) {
    this.proc = null;
    this.pythonPath = null;
    this.queue = [];
    this.busy = false;
    this.wm = windowManager;
    this.driverPath = null;

    bus.handle('py:exec', async ({ code, timeout = 30000 }) => this.exec(code, timeout));
    bus.handle('py:status', async () => ({
      available: !!this.proc && !this.proc.killed,
      python: this.pythonPath,
    }));
    bus.handle('py:restart', async () => { this.kill(); await this.ensure(); return true; });
  }

  async detect() {
    if (this.pythonPath) return this.pythonPath;
    for (const cmd of PYTHON_CANDIDATES) {
      const ok = await new Promise((resolve) => {
        try {
          const p = spawn(cmd, ['-c', 'import sys;print(sys.version_info[0])'], { stdio: ['ignore', 'pipe', 'ignore'] });
          let out = '';
          p.stdout.on('data', d => out += d);
          p.on('close', (code) => resolve(code === 0 && out.trim().startsWith('3')));
          p.on('error', () => resolve(false));
          setTimeout(() => { try { p.kill(); } catch {} resolve(false); }, 4000);
        } catch { resolve(false); }
      });
      if (ok) { this.pythonPath = cmd; return cmd; }
    }
    return null;
  }

  async ensure() {
    if (this.proc && !this.proc.killed) return true;
    const cmd = await this.detect();
    if (!cmd) throw new Error('未检测到 Python。请安装 Python 3 并加入 PATH');
    if (!this.driverPath) {
      this.driverPath = path.join(os.tmpdir(), 'mazz_py_driver.py');
      fs.writeFileSync(this.driverPath, DRIVER);
    }
    this.proc = spawn(cmd, ['-u', this.driverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    this.buffer = '';
    this.proc.stdout.on('data', (d) => { this.buffer += d.toString('utf8'); });
    this.proc.stderr.on('data', (d) => { this.buffer += d.toString('utf8'); });
    this.proc.on('exit', () => { this.proc = null; });
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
      this.busy = false;
      job.reject(new Error('执行超时（内核可能卡死，可用「重启内核」恢复）'));
      this.pump();
    }, job.timeout);
    try {
      this.proc.stdin.write(b64 + ' ' + marker + '\n');
    } catch (e) {
      clearTimeout(timer);
      this.busy = false;
      job.reject(e);
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
      job.resolve({ output: out, python: this.pythonPath });
      this.pump();
    }, 40);
  }

  kill() {
    if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; }
  }
}
module.exports = PythonKernel;
