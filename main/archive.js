// main/archive.js —— W58b 解压缩服务：魔数识别 + JSZip 主力（零新依赖）+ 7zip-bin 兜底 + GBK 文件名修复
// + 压缩打包 + 进度取消 + 2 并发作业队列
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ZIP_MAG = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const RAR_MAG = Buffer.from('Rar!\x1a\x07', 'latin1');
const SZ_MAG = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]); // 7z\xbc\xaf'\x1c
const GZ_MAG = Buffer.from([0x1f, 0x8b]);

/** 魔数识别（扩展名不可信——读头几字节定真身） */
function sniff(p) {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(300);
    fs.readSync(fd, buf, 0, 300, 0);
    fs.closeSync(fd);
    if (buf.subarray(0, 4).equals(ZIP_MAG)) return 'zip';
    if (buf.subarray(0, 7).equals(RAR_MAG)) return 'rar';
    if (buf.subarray(0, 6).equals(SZ_MAG)) return '7z';
    if (buf.subarray(0, 2).equals(GZ_MAG)) return 'gz';
    if (buf.subarray(257, 262).toString('latin1') === 'ustar') return 'tar';
  } catch {}
  return null;
}

// ==================== GBK 文件名修复（zip 中央目录原始名直读） ====================
/** zip 规范：通用位 11 置位=UTF-8；未置位时 CP437（国内实为 GBK 九成药）——JSZip 硬按 UTF-8 解必乱码。
 *  这里直读中央目录拿原始字节：位 11→utf-8；否则先试 utf-8 严格校验，过=新式 zip，不过=GBK 兜底 */
function rawNames(buf) {
  const out = [];
  const dec8 = new TextDecoder('utf-8', { fatal: true });
  const decG = new TextDecoder('gbk');
  let i = 0;
  while (i + 46 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x02014b50) { i++; continue; } // PK\x01\x02
    const flag = buf.readUInt16LE(i + 8);
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const cmtLen = buf.readUInt16LE(i + 32);
    const raw = buf.subarray(i + 46, i + 46 + nameLen);
    let name;
    if (flag & 0x0800) name = dec8.decode(raw);
    else {
      try { name = dec8.decode(raw); if (!name) throw 0; }
      catch { name = decG.decode(raw); }
    }
    out.push(name);
    i += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

class ArchiveService {
  constructor({ bus, win }) {
    this.bus = bus;
    this.win = win; // () => 主窗（进度广播落点）
    this.jobs = new Map(); // jobId -> {kind, cancelled, proc?}
    this.running = new Set(); // 2 并发闸
    this.queue = [];
    this.seq = 0;
    bus.handle('archive:sniff', async ({ path: p }) => ({ fmt: sniff(p) }));
    bus.handle('archive:list', async ({ path: p }) => this.list(p));
    bus.handle('archive:extract', async ({ path: p, dest }) => this.enqueue('extract', { path: p, dest }));
    bus.handle('archive:pack', async ({ sources, out }) => this.enqueue('pack', { sources, out }));
    bus.handle('archive:cancel', async ({ jobId }) => this.cancel(jobId));
  }

  _progress(jobId, phase, i, n, name, percent) {
    const w = typeof this.win === 'function' ? this.win() : this.win;
    if (w && !w.isDestroyed()) this.bus.send(w, 'archive:progress', { jobId, phase, i, n, name, percent: Math.round(percent ?? (n ? (i / n) * 100 : 0)) });
  }
  _end(jobId, ok, info) {
    const job = this.jobs.get(jobId);
    this.jobs.delete(jobId);
    this.running.delete(jobId);
    this._pump();
    const w = typeof this.win === 'function' ? this.win() : this.win;
    if (w && !w.isDestroyed()) this.bus.send(w, 'archive:done', {
      jobId, ok, info, kind: job?.kind || '',
      targetPath: job?.kind === 'extract' ? job?.payload?.dest : job?.payload?.out,
      sourcePath: job?.payload?.path || null,
    });
  }
  _pump() {
    while (this.running.size < 2 && this.queue.length) { // 2 并发
      const job = this.queue.shift();
      this.running.add(job.id);
      job.run().then(r => this._end(job.id, r.ok !== false, r.info), e => this._end(job.id, false, e.message));
    }
  }
  enqueue(kind, payload) {
    const id = 'arc-' + (++this.seq);
    const job = { id, kind, payload, cancelled: false, proc: null };
    job.run = () => kind === 'extract' ? this._extractZipFirst(job, payload) : this._pack(job, payload);
    this.jobs.set(id, job);
    this.queue.push(job);
    this._pump();
    return { jobId: id, queued: this.running.size >= 2 };
  }
  cancel(jobId) {
    const j = this.jobs.get(jobId);
    if (j) { j.cancelled = true; try { j.proc?.kill('SIGKILL'); } catch {} return { ok: true }; }
    return { ok: false };
  }

  async _jszip() { const m = await import('jszip'); return m.default || m; }

  /** 列出包内容（zip 族走 JSZip+GBK 修复；rar/7z/gz/tar 走 7za 兜底） */
  async list(p) {
    const fmt = sniff(p);
    if (!fmt) return { error: '不识别的格式（魔数不符 zip/rar/7z/gz/tar）' };
    if (fmt === 'zip') {
      try {
        const JSZip = await this._jszip();
        const buf = fs.readFileSync(p);
        const zip = await JSZip.loadAsync(buf);
        const names = rawNames(buf);
        const entries = Object.values(zip.files).map((f, i) => ({
          name: names[i] || f.name, dir: f.dir, size: f._data?.uncompressedSize ?? null, packed: f._data?.compressedSize ?? null,
        }));
        return { fmt, path: p, entries, engine: 'jszip' };
      } catch (e) { return { error: 'JSZip 读包失败：' + e.message }; }
    }
    return this._list7za(p, fmt);
  }

  _sevenZa() {
    try { return require('7zip-bin').path7za; } catch { return null; }
  }
  _run7za(args, { onLine } = {}) {
    const bin = this._sevenZa();
    if (!bin) return Promise.reject(new Error('7zip-bin 不在位'));
    // 沙箱/部署挂载可能丢执行位（Linux/mac 实锤 EACCES）——先补位再拉（Windows 无此概念，静默跳过）
    try { fs.chmodSync(bin, 0o755); } catch {}
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { windowsHide: true });
      let out = '', err = '';
      proc.stdout.on('data', d => { const s = d.toString('utf8'); out += s; if (onLine) for (const ln of s.split(/\r?\n/)) onLine(ln); });
      proc.stderr.on('data', d => { err += d.toString('utf8'); });
      proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim() || ('7za 退出码 ' + code))));
      this._lastProc = proc;
    });
  }
  async _list7za(p, fmt) {
    try {
      const out = await this._run7za(['l', '-slt', p]);
      const entries = [];
      let cur = null;
      for (const ln of out.split(/\r?\n/)) {
        if (ln.startsWith('Path = ')) {
          const v = ln.slice(7);
          if (cur) entries.push(cur);
          cur = { name: v, size: null, packed: null, dir: false };
        } else if (cur && ln.startsWith('Size = ')) cur.size = parseInt(ln.slice(7), 10) || 0;
        else if (cur && ln.startsWith('Packed Size = ')) cur.packed = parseInt(ln.slice(14), 10) || 0;
        else if (cur && ln.startsWith('Attributes = ')) cur.dir = ln.includes('D');
      }
      if (cur) entries.push(cur);
      return { fmt, path: p, entries: entries.filter(e => e.name !== p.replace(/\\/g, '/')), engine: '7za' };
    } catch (e) { return { error: '7za 读包失败：' + e.message }; }
  }

  /** 解压（zip 族逐条出件=取消即停；其他 7za 整出=信号杀） */
  async _extractZipFirst(job, { path: p, dest }) {
    const fmt = sniff(p);
    fs.mkdirSync(dest, { recursive: true });
    if (fmt === 'zip') {
      const JSZip = await this._jszip();
      const buf = fs.readFileSync(p);
      const zip = await JSZip.loadAsync(buf);
      const names = rawNames(buf);
      const files = Object.values(zip.files).filter(f => !f.dir);
      let i = 0;
      for (const [idx, f] of files.entries()) {
        if (job.cancelled) return { ok: false, info: '已取消' };
        const fixed = names[Object.values(zip.files).indexOf(f)] || f.name;
        const rel = fixed.replace(/\\/g, '/').replace(/^\/+/, '');
        if (rel.includes('..')) continue; // zip-slip 防穿越
        const data = await f.async('uint8array');
        const out = path.join(dest, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, data);
        this._progress(job.id, 'extract', ++i, files.length, rel);
      }
      return { ok: true, info: `${files.length} 项已解压` };
    }
    // 7za 兜底（rar/7z/gz/tar）
    const bin = this._sevenZa();
    if (!bin) return { ok: false, info: '此格式需 7zip-bin，未在位' };
    try { fs.chmodSync(bin, 0o755); } catch {} // 挂载丢执行位补丁（Linux/mac）
    return new Promise((resolve) => {
      const proc = spawn(bin, ['x', '-y', `-o${dest}`, p], { windowsHide: true });
      job.proc = proc;
      let err = '';
      proc.stdout.on('data', d => {
        for (const ln of d.toString('utf8').split(/\r?\n/)) {
          const m = /(\d+)%/.exec(ln);
          if (m) this._progress(job.id, 'extract', parseInt(m[1], 10), 100, path.basename(p), parseInt(m[1], 10));
        }
      });
      proc.stderr.on('data', d => { err += d.toString('utf8'); });
      proc.on('close', code => {
        if (job.cancelled) resolve({ ok: false, info: '已取消' });
        else if (code === 0) { this._progress(job.id, 'extract', 100, 100, '', 100); resolve({ ok: true, info: '解压完成' }); }
        else resolve({ ok: false, info: err.trim() || ('7za 退出码 ' + code) });
      });
    });
  }

  /** 打包（JSZip DEFLATE：逐件加=取消即停；进度直推） */
  async _pack(job, { sources, out }) {
    const JSZip = await this._jszip();
    const zip = new JSZip();
    const walk = (abs, rel) => {
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        for (const c of fs.readdirSync(abs)) walk(path.join(abs, c), rel + '/' + c);
      } else {
        zip.file(rel, fs.readFileSync(abs));
        job._added = (job._added || 0) + 1;
        this._progress(job.id, 'pack-add', job._added, 0, rel, 0);
      }
    };
    for (const s of sources) {
      if (job.cancelled) return { ok: false, info: '已取消' };
      walk(s, path.basename(s));
    }
    if (job.cancelled) return { ok: false, info: '已取消' };
    const buf = await zip.generateAsync(
      { type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => this._progress(job.id, 'pack', 0, 100, path.basename(out), meta.percent)
    );
    if (job.cancelled) return { ok: false, info: '已取消' };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    return { ok: true, info: `已打包 ${out.split(/[\\/]/).pop()}（${(buf.length / 1024).toFixed(0)}KB）` };
  }
}

module.exports = ArchiveService;
