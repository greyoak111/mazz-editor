// main/archive.js —— W58b 解压缩服务：魔数识别 + JSZip 主力 + bundled 7-Zip 兜底 + GBK 文件名修复
// + 压缩打包 + 进度取消 + 2 并发作业队列
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const ZIP_MAGICS = Object.freeze([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]), // local file header
  Buffer.from([0x50, 0x4b, 0x05, 0x06]), // empty archive
  Buffer.from([0x50, 0x4b, 0x07, 0x08]), // spanning marker
]);
const RAR4_MAG = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const RAR5_MAG = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
const SZ_MAG = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]); // 7z\xbc\xaf'\x1c
const GZ_MAG = Buffer.from([0x1f, 0x8b]);
const BZ2_MAG = Buffer.from([0x42, 0x5a, 0x68]); // BZh
const XZ_MAG = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
const CAB_MAG = Buffer.from([0x4d, 0x53, 0x43, 0x46]); // MSCF
const ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 20_000,
  maxArchiveBytes: 512 * 1024 * 1024,
  maxFileBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxRatio: 500,
  maxPathChars: 1_024,
  maxListingBytes: 20_000 * (1_024 + 512),
});
const STREAM_METADATA_UNSUPPORTED = Object.freeze({
  bz2: 'BZIP2 单流无法在解压前提供完整条目元数据，当前安全门拒绝处理',
  xz: 'XZ 单流无法在解压前提供安全输出路径，当前安全门拒绝处理',
});
const NESTED_GZIP_UNSUPPORTED = 'tar.gz / tgz 是双层容器，当前仅支持普通 gzip 单流；请先拆出 tar 再打开';

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
    if (entry.encrypted) throw new Error(`加密压缩包暂不支持：${entry.name}`);
    if (entry.link) throw new Error(`压缩包包含符号链接：${entry.name}`);
    if (!entry.dir && (!Number.isSafeInteger(entry.size) || entry.size < 0)) throw new Error(`压缩包条目缺少可信大小：${entry.name}`);
    const size = Math.max(0, Number(entry.size) || 0);
    const packed = Math.max(0, Number(entry.packed) || 0);
    if (size > ARCHIVE_LIMITS.maxFileBytes) throw new Error(`单文件超过 512 MiB 上限：${entry.name}`);
    if (packed > 0 && size / packed > ARCHIVE_LIMITS.maxRatio) throw new Error(`可疑压缩比（>${ARCHIVE_LIMITS.maxRatio}×）：${entry.name}`);
    total += size;
    if (total > ARCHIVE_LIMITS.maxTotalBytes) throw new Error('解压后总量超过 2 GiB 上限');
  }
  if (archiveBytes > 0 && total / archiveBytes > ARCHIVE_LIMITS.maxRatio) throw new Error(`压缩包整体压缩比超过 ${ARCHIVE_LIMITS.maxRatio}× 上限`);
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

function stagingPrefix(dest, jobId) { return `${stagingPath(dest, jobId)}-`; }

function ownedStagingPath(job) {
  if (!job?.stageOwned || typeof job.stagePath !== 'string' || typeof job.stagePrefix !== 'string') {
    throw new Error('暂存目录不属于当前归档作业');
  }
  const stage = path.resolve(job.stagePath);
  const prefix = path.resolve(job.stagePrefix);
  if (path.dirname(stage) !== path.dirname(prefix)
    || !path.basename(stage).startsWith(path.basename(prefix))
    || path.basename(stage).length <= path.basename(prefix).length) {
    throw new Error(`拒绝清理非本作业暂存目录：${stage}`);
  }
  return stage;
}

function createOwnedStaging(job, target) {
  if (!job || job.stageOwned) throw new Error('归档作业已持有暂存目录');
  const prefix = stagingPrefix(target, job.id);
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const stage = fs.mkdtempSync(prefix);
  job.stagePrefix = prefix;
  job.stagePath = stage;
  job.stageOwned = true;
  return stage;
}

function releaseOwnedStaging(job) {
  ownedStagingPath(job);
  job.stageOwned = false;
  job.stagePath = null;
  job.stagePrefix = null;
}

function cleanupOwnedStaging(job) {
  if (!job?.stageOwned) return false;
  const stage = ownedStagingPath(job);
  fs.rmSync(stage, { recursive: true, force: true });
  releaseOwnedStaging(job);
  return true;
}

function resolveSevenZipPath(candidate, existsSync = fs.existsSync) {
  const source = String(candidate || '');
  if (!source) return null;
  // 7zip-bin-full 的 USE_SYSTEM_7Z=true（及兼容的旧 USE_SYSTEM_7ZA）可返回 PATH 命令名，
  // 它不是文件路径，不能用 existsSync 误判为缺失。
  if (!path.isAbsolute(source) && !source.includes('/') && !source.includes('\\') && /^[a-z0-9._-]+$/i.test(source)) return source;
  const marker = `${path.sep}app.asar${path.sep}`;
  if (source.includes(marker)) {
    const unpacked = source.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
    if (existsSync(unpacked)) return unpacked;
  }
  return existsSync(source) ? source : null;
}

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
      const source = path.join(stage, rel);
      // COPYFILE_EXCL is the cross-platform no-replace primitive. A separate
      // existsSync + rename can overwrite a file created in the race window on
      // POSIX/macOS.
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      fs.rmSync(source, { force: true });
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
    if (ZIP_MAGICS.some(magic => buf.subarray(0, magic.length).equals(magic))) return 'zip';
    if (buf.subarray(0, RAR4_MAG.length).equals(RAR4_MAG) || buf.subarray(0, RAR5_MAG.length).equals(RAR5_MAG)) return 'rar';
    if (buf.subarray(0, 6).equals(SZ_MAG)) return '7z';
    if (buf.subarray(0, 2).equals(GZ_MAG)) return 'gz';
    if (buf.subarray(0, BZ2_MAG.length).equals(BZ2_MAG)) return 'bz2';
    if (buf.subarray(0, XZ_MAG.length).equals(XZ_MAG)) return 'xz';
    if (buf.subarray(0, CAB_MAG.length).equals(CAB_MAG)) return 'cab';
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

function isNestedGzipPath(filePath) {
  return /(?:\.tar\.gz|\.tgz)$/i.test(String(filePath || ''));
}

function parseSevenZipListing(output) {
  const lines = String(output || '').split(/\r?\n/);
  const bodyAt = lines.findIndex(line => line.trim() === '----------');
  if (bodyAt < 0) throw new Error('7-Zip 未返回可验证的条目清单');
  const entries = [];
  let current = null;
  const push = () => {
    if (!current) return;
    if (current.name) entries.push(current);
    current = null;
  };
  for (const line of lines.slice(bodyAt + 1)) {
    if (line.startsWith('Path = ')) {
      push();
      current = { name: line.slice(7), size: null, packed: null, dir: false, encrypted: false, link: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Size = ')) {
      const raw = line.slice(7).trim();
      current.size = /^\d+$/.test(raw) ? Number(raw) : null;
    } else if (line.startsWith('Packed Size = ')) {
      const raw = line.slice(14).trim();
      current.packed = /^\d+$/.test(raw) ? Number(raw) : null;
    } else if (line.startsWith('Attributes = ')) {
      const attributes = line.slice(13);
      current.dir = /(^|\s)D(\s|$)/i.test(attributes) || /^D/.test(attributes);
      current.link = /(^|\s)l[rwx-]{3}/.test(attributes);
    } else if (line.startsWith('Folder = ')) {
      current.dir = line.slice(9).trim() === '+';
    } else if (line.startsWith('Encrypted = ')) {
      current.encrypted = line.slice(12).trim() === '+';
    } else if (line.startsWith('Symbolic Link = ') || line.startsWith('Hard Link = ')) {
      current.link = !!line.split('=').slice(1).join('=').trim();
    }
  }
  push();
  return entries;
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
    // Defensive finalizer: any error path that escaped its local cleanup may
    // only remove the random staging directory recorded as owned by this job.
    try { cleanupOwnedStaging(job); } catch {}
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
      // Never derive and delete a predictable path here. Only a directory
      // atomically created and recorded by this exact job may be removed.
      try { cleanupOwnedStaging(job); } catch {}
      if (job.ledgerKey) this.resourceLedger?.release(job.ledgerKey, { reason });
    }
    this.jobs.clear();
    this.queue = [];
    this.running.clear();
  }

  async _jszip() { const m = await import('jszip'); return m.default || m; }

  /** 列出包内容（zip 走 JSZip+GBK 修复；7z/rar/gz/cab/tar 走 7-Zip 安全清单） */
  async list(p) {
    const fmt = sniff(p);
    if (!fmt) return { error: '不识别的格式（魔数不符 zip/rar/7z/tar/gz/bz2/xz/cab）' };
    if (fmt === 'gz' && isNestedGzipPath(p)) return { fmt, path: p, error: NESTED_GZIP_UNSUPPORTED };
    if (STREAM_METADATA_UNSUPPORTED[fmt]) return { fmt, path: p, error: STREAM_METADATA_UNSUPPORTED[fmt] };
    if (fmt === 'zip') {
      try {
        const stat = fs.statSync(p);
        if (stat.size > ARCHIVE_LIMITS.maxArchiveBytes) throw new Error('zip 超过 512 MiB 内存解包上限');
        const JSZip = await this._jszip();
        const buf = fs.readFileSync(p);
        const zip = await JSZip.loadAsync(buf);
        const names = rawNames(buf);
        const entries = Object.values(zip.files).map((f, i) => ({
          name: names[i] || f.name, dir: f.dir, size: f._data?.uncompressedSize ?? null, packed: f._data?.compressedSize ?? null,
          link: isZipSymlink(f),
        }));
        assertBudget(entries, buf.length);
        return { fmt, path: p, entries, engine: 'jszip' };
      } catch (e) { return { error: 'JSZip 读包失败：' + e.message }; }
    }
    return this._listSevenZip(p, fmt);
  }

  _sevenZip() {
    if (process.env.USE_SYSTEM_7ZA === 'true' && process.env.USE_SYSTEM_7Z !== 'true') return resolveSevenZipPath('7za');
    try { return resolveSevenZipPath(require('7zip-bin-full').path7z); } catch { return null; }
  }
  _runSevenZip(args, { onLine, maxOutputBytes = ARCHIVE_LIMITS.maxListingBytes } = {}) {
    const bin = this._sevenZip();
    if (!bin) return Promise.reject(new Error('7zip-bin-full 不在位'));
    // 沙箱/部署挂载可能丢执行位（Linux/mac 实锤 EACCES）——先补位再拉（Windows 无此概念，静默跳过）
    try { fs.chmodSync(bin, 0o755); } catch {}
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { windowsHide: true });
      let out = '', err = '';
      let outBytes = 0;
      const decoder = new StringDecoder('utf8');
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      proc.stdout.on('data', d => {
        outBytes += d.length;
        if (outBytes > maxOutputBytes) {
          try { proc.kill('SIGKILL'); } catch {}
          finish(reject, new Error(`7-Zip 清单输出超过 ${maxOutputBytes} 字节安全上限`));
          return;
        }
        const s = decoder.write(d);
        out += s;
        if (onLine) for (const ln of s.split(/\r?\n/)) onLine(ln);
      });
      proc.stderr.on('data', d => { err += d.toString('utf8'); });
      proc.on('error', error => finish(reject, error));
      proc.on('close', code => {
        if (settled) return;
        out += decoder.end();
        code === 0 ? finish(resolve, out) : finish(reject, new Error(err.trim() || ('7-Zip 退出码 ' + code)));
      });
      this._lastProc = proc;
    });
  }
  async _listSevenZip(p, fmt) {
    try {
      // -slt follows the console charset unless explicitly pinned. Always ask
      // for UTF-8 so the path audited here is byte-for-byte the path 7-Zip
      // later extracts, including on non-UTF-8 Windows consoles.
      const out = await this._runSevenZip(['l', '-slt', '-sccUTF-8', '-p-', '--', p]);
      const entries = parseSevenZipListing(out);
      assertBudget(entries, fs.statSync(p).size);
      return { fmt, path: p, entries, engine: '7zip' };
    } catch (e) { return { fmt, path: p, error: '7-Zip 读包失败：' + e.message }; }
  }

  /** 解压（zip 族逐条出件=取消即停；其他 7-Zip 整出=信号杀） */
  async _extractZipFirst(job, { path: p, dest }) {
    const fmt = sniff(p);
    if (!fmt) return { ok: false, info: '压缩包魔数不受支持' };
    if (fmt === 'gz' && isNestedGzipPath(p)) return { ok: false, info: NESTED_GZIP_UNSUPPORTED };
    if (STREAM_METADATA_UNSUPPORTED[fmt]) return { ok: false, info: STREAM_METADATA_UNSUPPORTED[fmt] };
    const finish = result => {
      if (result.ok) {
        const stage = ownedStagingPath(job);
        auditTree(stage);
        commitStaging(stage, dest);
        releaseOwnedStaging(job);
      } else cleanupOwnedStaging(job);
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
        const entries = values.map((f, index) => ({
          name: names[index] || f.name,
          dir: f.dir,
          size: f._data?.uncompressedSize ?? 0,
          packed: f._data?.compressedSize ?? 0,
          link: isZipSymlink(f),
        }));
        assertBudget(entries, buf.length, dest);
        const stage = createOwnedStaging(job, dest);
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
        try { cleanupOwnedStaging(job); } catch {}
        return { ok: false, info: /ENOSPC/.test(error.code || '') ? '磁盘空间不足，暂存已清理' : error.message };
      }
    }
    // bundled full 7-Zip 兜底（7z/rar/gz/cab/tar）
    const bin = this._sevenZip();
    if (!bin) return finish({ ok: false, info: '此格式需 7zip-bin-full，未在位' });
    const listing = await this._listSevenZip(p, fmt);
    if (listing.error) return { ok: false, info: listing.error };
    try { assertBudget(listing.entries.filter(entry => entry.name !== p), fs.statSync(p).size, dest); }
    catch (error) { return { ok: false, info: error.message }; }
    const stage = createOwnedStaging(job, dest);
    try { fs.chmodSync(bin, 0o755); } catch {} // 挂载丢执行位补丁（Linux/mac）
    return new Promise((resolve) => {
      // 条目已在清单阶段 fail closed；默认 extraction 保持相对 staging。
      // -p- 禁止密码交互，避免加密包把后台作业永久挂在 stdin。
      const proc = spawn(bin, ['x', '-y', '-sccUTF-8', '-p-', `-o${stage}`, '--', p], { windowsHide: true });
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
      proc.on('error', error => { try { cleanupOwnedStaging(job); } catch {} complete({ ok: false, info: error.message }); });
      proc.on('close', code => {
        if (settled) return;
        try {
          if (job.cancelled) complete(finish({ ok: false, info: '已取消' }));
          else if (code === 0) { this._progress(job.id, 'extract', 100, 100, '', 100); complete(finish({ ok: true, info: '安全解压完成' })); }
          else complete(finish({ ok: false, info: err.trim() || ('7-Zip 退出码 ' + code) }));
        } catch (error) { try { cleanupOwnedStaging(job); } catch {} complete({ ok: false, info: error.message }); }
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
    let outputCreated = false;
    try {
      const stage = createOwnedStaging(job, out);
      const temporary = path.join(stage, 'archive.tmp');
      fs.writeFileSync(temporary, buf, { flag: 'wx' });
      fs.copyFileSync(temporary, out, fs.constants.COPYFILE_EXCL);
      outputCreated = true;
      // Cleanup failure after the exclusive copy does not invalidate the
      // finished archive; _end() will retry the owned-stage cleanup.
      try { cleanupOwnedStaging(job); } catch {}
    } catch (error) {
      try { cleanupOwnedStaging(job); } catch {}
      throw error;
    }
    if (!outputCreated) throw new Error('归档输出未原子提交');
    return { ok: true, info: `已打包 ${out.split(/[\\/]/).pop()}（${(buf.length / 1024).toFixed(0)}KB）` };
  }
}

module.exports = ArchiveService;
ArchiveService.ARCHIVE_LIMITS = ARCHIVE_LIMITS;
ArchiveService.assertBudget = assertBudget;
ArchiveService.auditTree = auditTree;
ArchiveService.commitStaging = commitStaging;
ArchiveService.createOwnedStaging = createOwnedStaging;
ArchiveService.cleanupOwnedStaging = cleanupOwnedStaging;
ArchiveService.isZipSymlink = isZipSymlink;
ArchiveService.safeRelativePath = safeRelativePath;
ArchiveService.stagingPath = stagingPath;
ArchiveService.resolveSevenZipPath = resolveSevenZipPath;
ArchiveService.STREAM_METADATA_UNSUPPORTED = STREAM_METADATA_UNSUPPORTED;
ArchiveService.NESTED_GZIP_UNSUPPORTED = NESTED_GZIP_UNSUPPORTED;
ArchiveService.parseSevenZipListing = parseSevenZipListing;
ArchiveService.sniff = sniff;
