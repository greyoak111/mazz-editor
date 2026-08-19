// main/archive.js —— W58b 解压缩服务：魔数识别 + JSZip 主力（零新依赖）+ 7zip-bin 兜底 + GBK 文件名修复
// + 压缩打包 + 进度取消 + 2 并发作业队列
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ZIP_MAG = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const RAR_MAG = Buffer.from('Rar!\x1a\x07', 'latin1');
const SZ_MAG = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]); // 7z\xbc\xaf'\x1c
const GZ_MAG = Buffer.from([0x1f, 0x8b]);
const ARCHIVE_LIMITS = Object.freeze({ maxEntries: 20_000, maxArchiveBytes: 512 * 1024 * 1024, maxFileBytes: 512 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024, maxRatio: 500, maxPathChars: 1_024 });

function safeRelativePath(raw) {
  const value = String(raw || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!value || value.includes('\0') || value.length > ARCHIVE_LIMITS.maxPathChars) throw new Error('压缩包包含空路径、NUL 或超长路径');
  if (/^(?:\/|[a-z]:|\\\\)/i.test(value)) throw new Error(`压缩包包含绝对路径：${value}`);
  const parts = value.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..' || /[:<>"|?*]/.test(part))) throw new Error(`压缩包包含不安全路径：${value}`);
  return parts.join(path.sep);
}

function isZipSymlink(file) {
  const permissions = Number(file?.unixPermissions || file?.dosPermissions || 0);
  return (permissions & 0o170000) === 0o120000;
}

function assertBudget(entries, archiveBytes = 0, dest = '') {
  if (entries.length > ARCHIVE_LIMITS.maxEntries) throw new Error(`压缩包条目超过 ${ARCHIVE_LIMITS.maxEntries} 上限`);
  if (archiveBytes > ARCHIVE_LIMITS.maxArchiveBytes) throw new Error('压缩包超过 512 MiB 内存解包上限');
  let total = 0;
  for (const entry of entries) {
    safeRelativePath(entry.name);
    const size = Math.max(0, Number(entry.size) || 0);
    const packed = Math.max(0, Number(entry.packed) || 0);
    if (size > ARCHIVE_LIMITS.maxFileBytes) throw new Error(`单文件超过 512 MiB 上限：${entry.name}`);
    if (packed > 0 && size / packed > ARCHIVE_LIMITS.maxRatio) throw new Error(`可疑压缩比（>${ARCHIVE_LIMITS.maxRatio}×）：${entry.name}`);
    total += size;
    if (total > ARCHIVE_LIMITS.maxTotalBytes) throw new Error('解压后总量超过 2 GiB 上限');
  }
  if (dest && typeof fs.statfsSync === 'function') {
    try {
      const stat = fs.statfsSync(path.dirname(path.resolve(dest)));
      const available = Number(stat.bavail) * Number(stat.bsize);
      if (total && Number.isFinite(available) && available < total * 1.15 + 64 * 1024 * 1024) throw new Error('目标磁盘可用空间不足');
    } catch (error) { if (/可用空间不足/.test(error.message)) throw error; }
  }
  return total;
}

function stagingPath(dest, jobId) { return `${path.resolve(dest)}.mazz-${String(jobId).replace(/[^a-z0-9-]/gi, '')}.partial`; }

function auditTree(root) {
  let total = 0;
  let count = 0;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`解压结果包含符号链接：${path.relative(root, target)}`);
      if (entry.isDirectory()) walk(target);
      else {
        count += 1;
        total += stat.size;
        if (count > ARCHIVE_LIMITS.maxEntries || stat.size > ARCHIVE_LIMITS.maxFileBytes || total > ARCHIVE_LIMITS.maxTotalBytes) throw new Error('解压结果超过安全预算');
      }
    }
  };
  walk(root);
  return { count, total };
}

function commitStaging(stage, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const files = [];
  const directories = [];
  const collect = (current, relative = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) { directories.push(rel); collect(path.join(current, entry.name), rel); }
      else files.push(rel);
    }
  };
  collect(stage);
  for (const rel of files) if (fs.existsSync(path.join(dest, rel))) throw new Error(`目标已存在，未覆盖：${rel}`);
  const createdDirectories = [];
  const moved = [];
  try {
    for (const rel of directories.sort((a, b) => a.length - b.length)) {
      const target = path.join(dest, rel);
      if (!fs.existsSync(target)) { fs.mkdirSync(target); createdDirectories.push(target); }
    }
    for (const rel of files) {
      const target = path.join(dest, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(stage, rel), target);
      moved.push(target);
    }
  } catch (error) {
    for (const target of moved.reverse()) { try { fs.rmSync(target, { force: true }); } catch {} }
    for (const target of createdDirectories.sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(target); } catch {} }
    throw error;
  }
  fs.rmSync(stage, { recursive: true, force: true });
}

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
  constructor({ bus, win, resourceLedger = null }) {
    this.bus = bus;
    this.win = win; // () => 主窗（进度广播落点）
    this.jobs = new Map(); // jobId -> {kind, cancelled, proc?}
    this.running = new Set(); // 2 并发闸
    this.queue = [];
    this.seq = 0;
    this.resourceLedger = resourceLedger;
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
    if (job?.ledgerKey) this.resourceLedger?.release(job.ledgerKey, { reason: ok ? 'completed' : 'failed', meta: { info: String(info || '').slice(0, 200) } });
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
    job.ledgerKey = this.resourceLedger?.register({ type: 'archive-job', id, owner: 'archive-service', meta: { kind } });
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

  destroy(reason = 'app-quit') {
    for (const job of this.jobs.values()) {
      job.cancelled = true;
      try { job.proc?.kill('SIGKILL'); } catch {}
      const target = job.payload?.dest || job.payload?.out || '';
      if (target) { try { fs.rmSync(stagingPath(target, job.id), { recursive: true, force: true }); } catch {} }
      if (job.ledgerKey) this.resourceLedger?.release(job.ledgerKey, { reason });
    }
    this.jobs.clear();
    this.queue = [];
    this.running.clear();
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
        assertBudget(entries, buf.length);
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
    if (!fmt) return { ok: false, info: '压缩包魔数不受支持' };
    const stage = stagingPath(dest, job.id);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    const finish = result => {
      if (result.ok) {
        auditTree(stage);
        commitStaging(stage, dest);
      } else fs.rmSync(stage, { recursive: true, force: true });
      return result;
    };
    if (fmt === 'zip') {
      try {
        const stat = fs.statSync(p);
        if (stat.size > ARCHIVE_LIMITS.maxArchiveBytes) throw new Error('zip 超过 512 MiB 内存解包上限');
        const JSZip = await this._jszip();
        const buf = fs.readFileSync(p);
        const zip = await JSZip.loadAsync(buf);
        const values = Object.values(zip.files);
        const names = rawNames(buf);
        const entries = values.map((f, index) => ({ name: names[index] || f.name, dir: f.dir, size: f._data?.uncompressedSize ?? 0, packed: f._data?.compressedSize ?? 0 }));
        assertBudget(entries, buf.length, dest);
        const files = values.filter(f => !f.dir);
        let i = 0;
        for (const f of files) {
          if (job.cancelled) return finish({ ok: false, info: '已取消' });
          if (isZipSymlink(f)) throw new Error(`zip 包含符号链接：${f.name}`);
          const fixed = names[values.indexOf(f)] || f.name;
          const rel = safeRelativePath(fixed);
          const data = await f.async('uint8array');
          if (data.byteLength > ARCHIVE_LIMITS.maxFileBytes) throw new Error(`单文件超过 512 MiB：${fixed}`);
          const out = path.join(stage, rel);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, data, { flag: 'wx' });
          this._progress(job.id, 'extract', ++i, files.length, fixed);
        }
        return finish({ ok: true, info: `${files.length} 项已安全解压` });
      } catch (error) {
        fs.rmSync(stage, { recursive: true, force: true });
        return { ok: false, info: /ENOSPC/.test(error.code || '') ? '磁盘空间不足，暂存已清理' : error.message };
      }
    }
    // 7za 兜底（rar/7z/gz/tar）
    const bin = this._sevenZa();
    if (!bin) return finish({ ok: false, info: '此格式需 7zip-bin，未在位' });
    const listing = await this._list7za(p, fmt);
    if (listing.error) return finish({ ok: false, info: listing.error });
    try { assertBudget(listing.entries.filter(entry => entry.name !== p), fs.statSync(p).size, dest); }
    catch (error) { return finish({ ok: false, info: error.message }); }
    try { fs.chmodSync(bin, 0o755); } catch {} // 挂载丢执行位补丁（Linux/mac）
    return new Promise((resolve) => {
      const proc = spawn(bin, ['x', '-y', '-spf-', `-o${stage}`, p], { windowsHide: true });
      job.proc = proc;
      let err = '';
      let settled = false;
      const complete = result => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      proc.stdout.on('data', d => {
        for (const ln of d.toString('utf8').split(/\r?\n/)) {
          const m = /(\d+)%/.exec(ln);
          if (m) this._progress(job.id, 'extract', parseInt(m[1], 10), 100, path.basename(p), parseInt(m[1], 10));
        }
      });
      proc.stderr.on('data', d => { err += d.toString('utf8'); });
      proc.on('error', error => { fs.rmSync(stage, { recursive: true, force: true }); complete({ ok: false, info: error.message }); });
      proc.on('close', code => {
        if (settled) return;
        try {
          if (job.cancelled) complete(finish({ ok: false, info: '已取消' }));
          else if (code === 0) { this._progress(job.id, 'extract', 100, 100, '', 100); complete(finish({ ok: true, info: '安全解压完成' })); }
          else complete(finish({ ok: false, info: err.trim() || ('7za 退出码 ' + code) }));
        } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); complete({ ok: false, info: error.message }); }
      });
    });
  }

  /** 打包（JSZip DEFLATE：逐件加=取消即停；进度直推） */
  async _pack(job, { sources, out }) {
    const JSZip = await this._jszip();
    const zip = new JSZip();
    const walk = (abs, rel) => {
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`拒绝打包符号链接：${abs}`);
      safeRelativePath(rel);
      if (st.isDirectory()) {
        for (const c of fs.readdirSync(abs)) walk(path.join(abs, c), rel + '/' + c);
      } else {
        if (st.size > ARCHIVE_LIMITS.maxFileBytes) throw new Error(`单文件超过 512 MiB：${abs}`);
        job._totalBytes = (job._totalBytes || 0) + st.size;
        if (job._totalBytes > ARCHIVE_LIMITS.maxTotalBytes || (job._added || 0) >= ARCHIVE_LIMITS.maxEntries) throw new Error('打包输入超过安全预算');
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
      (meta) => { if (job.cancelled) throw new Error('已取消'); this._progress(job.id, 'pack', 0, 100, path.basename(out), meta.percent); }
    );
    if (job.cancelled) return { ok: false, info: '已取消' };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const temporary = stagingPath(out, job.id);
    fs.writeFileSync(temporary, buf, { flag: 'wx' });
    try { fs.renameSync(temporary, out); } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
    return { ok: true, info: `已打包 ${out.split(/[\\/]/).pop()}（${(buf.length / 1024).toFixed(0)}KB）` };
  }
}

module.exports = ArchiveService;
ArchiveService.ARCHIVE_LIMITS = ARCHIVE_LIMITS;
ArchiveService.assertBudget = assertBudget;
ArchiveService.auditTree = auditTree;
ArchiveService.commitStaging = commitStaging;
ArchiveService.isZipSymlink = isZipSymlink;
ArchiveService.safeRelativePath = safeRelativePath;
ArchiveService.stagingPath = stagingPath;
