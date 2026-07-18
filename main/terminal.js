// main/terminal.js —— 终端池（node-pty 多实例，xterm.js 多标签）
'use strict';
const os = require('os');
const pty = require('node-pty');

class TerminalService {
  constructor({ bus, windowManager }) {
    this.terms = new Map(); // id -> {pty, title, cwd}
    let seq = 1;

    bus.handle('term:create', async ({ id, shell, cwd, cols, rows }) => {
      const termId = id || 'term-' + seq++;
      if (this.terms.has(termId)) return { id: termId, existing: true };
      const shellPath = shell || (process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'));
      const workdir = cwd || os.homedir();
      try {
        const proc = pty.spawn(shellPath, [], {
          name: 'xterm-256color',
          cols: cols || 80,
          rows: rows || 24,
          cwd: workdir,
          env: process.env,
        });
        const rec = { proc, title: shellPath.split(/[\\/]/).pop(), cwd: workdir };
        this.terms.set(termId, rec);
        proc.onData((data) => {
          windowManager.broadcast('term:data', { id: termId, data });
        });
        proc.onExit(({ exitCode }) => {
          windowManager.broadcast('term:exit', { id: termId, exitCode });
          this.terms.delete(termId);
        });
        return { id: termId, title: rec.title, cwd: workdir };
      } catch (e) {
        return { error: e.message };
      }
    });

    bus.handle('term:write', async ({ id, data }) => {
      this.terms.get(id)?.proc.write(data);
      return true;
    });
    bus.handle('term:resize', async ({ id, cols, rows }) => {
      try { this.terms.get(id)?.proc.resize(cols, rows); } catch {}
      return true;
    });
    bus.handle('term:kill', async ({ id }) => {
      const rec = this.terms.get(id);
      if (rec) { try { rec.proc.kill(); } catch {} this.terms.delete(id); }
      return true;
    });
    bus.handle('term:list', async () => {
      return [...this.terms.entries()].map(([id, r]) => ({ id, title: r.title, cwd: r.cwd }));
    });
  }

  killAll() {
    for (const rec of this.terms.values()) { try { rec.proc.kill(); } catch {} }
    this.terms.clear();
  }
}
module.exports = TerminalService;
