// main/toolchain.js —— 工具链探测（W58 全语言运行体系核心新件）：
// win `where <exe>` / unix `which <exe>`，候选数组取首中，结果缓存 30s——缺失人话提示（绝不静默）
'use strict';
const { execFile } = require('child_process');

class Toolchain {
  constructor({ bus }) {
    this.cache = new Map(); // key -> { exe: string|null, at: number }
    this.TTL = 30 * 1000;

    bus.handle('toolchain:detect', async ({ exe }) => {
      const candidates = Array.isArray(exe) ? exe : [exe];
      const key = candidates.join('|');
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < this.TTL) return { exe: hit.exe };
      const found = await this.findFirst(candidates);
      this.cache.set(key, { exe: found, at: Date.now() });
      return { exe: found };
    });
    bus.handle('toolchain:detectAll', async ({ exes }) => {
      const out = {};
      for (const e of (exes || [])) {
        const r = await this.detect(e);
        out[Array.isArray(e) ? e.join('|') : e] = r;
      }
      return out;
    });
  }

  async detect(exe) {
    const candidates = Array.isArray(exe) ? exe : [exe];
    const key = candidates.join('|');
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.TTL) return hit.exe;
    const found = await this.findFirst(candidates);
    this.cache.set(key, { exe: found, at: Date.now() });
    return found;
  }

  findFirst(candidates) {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'where' : 'which';
    return new Promise((resolve) => {
      let i = 0;
      const tryNext = () => {
        if (i >= candidates.length) return resolve(null);
        const name = candidates[i++];
        execFile(cmd, [name], { windowsHide: true, timeout: 5000 }, (e, stdout) => {
          const out = (stdout || '').split('\n')[0].trim();
          if (!e && out) return resolve(name);
          tryNext();
        });
      };
      tryNext();
    });
  }
}

module.exports = Toolchain;
