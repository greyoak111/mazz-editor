// main/lansync.js —— 局域网同步：mDNS 发现 + TLS（自签证书+配对码）+ 增量同步 + 冲突保留副本
// 安全模型：自签证书加密通道 + 6 位配对码身份核验 + 路径穿越防御 + 指纹展示供人工比对
'use strict';
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const SYNC_PORT = 47820;
const MDNS_TYPE = 'mazz-sync';

// ==================== 帧协议（4 字节长度前缀 + JSON） ====================
function encodeFrame(obj) {
  const s = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(s.length);
  return Buffer.concat([len, s]);
}
function makeDecoder(onMsg) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (len > 64 * 1024 * 1024) { buf = Buffer.alloc(0); return; } // 防疯
      if (buf.length < 4 + len) break;
      const s = buf.slice(4, 4 + len);
      buf = buf.slice(4 + len);
      try { onMsg(JSON.parse(s.toString('utf8'))); } catch {}
    }
  };
}

/** 路径安全：拒绝穿越与绝对路径 */
function safeRel(p) {
  if (!p || typeof p !== 'string') return null;
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').includes('..')) return null;
  return norm;
}

class LanSync {
  /**
   * @param {{bus?: any, store: any, workspace: (() => string) | string}} opts
   * bus 可空（测试时不注册 IPC）
   */
  constructor({ bus, store, workspace }) {
    this.store = store;
    this.workspace = workspace;
    this.server = null;
    this.mdnsStop = null;
    this.state = 'idle'; // idle | hosting | syncing
    this.lastResult = null;
    if (bus) this.registerIpc(bus);
  }

  ws() { return typeof this.workspace === 'function' ? this.workspace() : this.workspace; }

  // ==================== 身份（自签证书，首次生成并持久化） ====================
  identity() {
    let id = this.store.get('sync.identity');
    if (!id) {
      const keys = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date(Date.now() - 864e5);
      cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 864e5);
      const cn = 'mazz-' + crypto.randomBytes(4).toString('hex');
      const attrs = [{ name: 'commonName', value: cn }];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);
      cert.sign(keys.privateKey, forge.md.sha256.create());
      id = {
        cert: forge.pki.certificateToPem(cert),
        key: forge.pki.privateKeyToPem(keys.privateKey),
        deviceId: cn,
      };
      this.store.set('sync.identity', id);
    }
    return id;
  }

  fingerprint() {
    const { cert } = this.identity();
    const hex = crypto.createHash('sha256').update(cert).digest('hex').toUpperCase();
    return hex.slice(0, 16).match(/.{1,4}/g).join('-');
  }

  // ==================== 文件清单 ====================
  scanFiles() {
    const root = this.ws();
    const out = [];
    const walk = (dir, depth) => {
      if (depth > 8) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          walk(p, depth + 1);
        } else {
          const rel = path.relative(root, p).replace(/\\/g, '/');
          if (rel.startsWith('.mazz/')) continue; // 临时区不同步
          let st;
          try { st = fs.statSync(p); } catch { continue; }
          if (st.size > 50 * 1024 * 1024) continue; // 超大文件跳过
          const buf = fs.readFileSync(p);
          out.push({
            path: rel,
            mtime: Math.floor(st.mtimeMs),
            size: st.size,
            hash: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12),
          });
        }
      }
    };
    walk(root, 0);
    return out;
  }

  readFileItem(rel) {
    const p = path.join(this.ws(), rel);
    try {
      const buf = fs.readFileSync(p);
      const st = fs.statSync(p);
      return {
        path: rel,
        mtime: Math.floor(st.mtimeMs),
        hash: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12),
        data: buf.toString('base64'),
      };
    } catch { return null; }
  }

  /** 计算「我想要对方的」路径：我没有的 / 对方更新的 / 同时间戳时 hash 字典序小者胜（双方必达同一结论） */
  static diffWant(mine, remote) {
    const mineMap = new Map(mine.map(f => [f.path, f]));
    const want = [];
    for (const rf of remote) {
      const lf = mineMap.get(rf.path);
      if (!lf) { want.push(rf.path); continue; }
      if (lf.hash === rf.hash) continue;
      if (rf.mtime > lf.mtime) want.push(rf.path);
      else if (rf.mtime === lf.mtime && rf.hash < lf.hash) want.push(rf.path);
    }
    return want;
  }

  /** 写入来件；基线判定冲突（本地偏离上次共识版本）时保留本地副本。返回 {status, conflictRel?, localHash?} */
  writeIncoming(item, baseline = {}) {
    const rel = safeRel(item.path);
    if (!rel) return { status: 'skip' };
    const p = path.join(this.ws(), rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const buf = Buffer.from(item.data, 'base64');
    if (fs.existsSync(p)) {
      const local = fs.readFileSync(p);
      const localHash = crypto.createHash('sha1').update(local).digest('hex').slice(0, 12);
      if (localHash === item.hash) {
        // 内容一致，仅对齐 mtime
        const t = new Date(item.mtime);
        try { fs.utimesSync(p, t, t); } catch {}
        return { status: 'skip', localHash };
      }
      // 冲突判定：本地相对基线也变了（无基线时保守视为变了，零丢失优先）
      const localChanged = baseline[rel] !== localHash;
      if (localChanged) {
        const ext = path.extname(rel);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const conflictRel = rel.slice(0, rel.length - ext.length) + `.conflict-${stamp}` + ext;
        fs.renameSync(p, path.join(this.ws(), conflictRel));
        fs.writeFileSync(p, buf);
        const t2 = new Date(item.mtime);
        try { fs.utimesSync(p, t2, t2); } catch {}
        return { status: 'conflict', conflictRel, localHash };
      }
    }
    fs.writeFileSync(p, buf);
    const t = new Date(item.mtime);
    try { fs.utimesSync(p, t, t); } catch {}
    return { status: 'ok' };
  }

  // ==================== 主机模式 ====================
  async host({ port = SYNC_PORT } = {}) {
    await this.stopHost();
    const { cert, key, deviceId } = this.identity();
    const pairCode = String(crypto.randomInt(100000, 999999));
    this.state = 'hosting';
    this.server = tls.createServer({ cert, key, requestCert: false }, (sock) => {
      this.handleIncoming(sock, pairCode);
    });
    await new Promise((res, rej) => {
      this.server.once('error', rej);
      this.server.listen(port, res);
    });
    const actualPort = this.server.address().port;
    this.mdnsStop = this.publishMdns(actualPort, deviceId);
    return { port: actualPort, pairCode, fingerprint: this.fingerprint(), deviceId };
  }

  async stopHost() {
    this.mdnsStop?.();
    this.mdnsStop = null;
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
    }
    if (this.state === 'hosting') this.state = 'idle';
  }

  handleIncoming(sock, pairCode) {
    let sync = null;
    // 单 decoder 路由：hello 与后续消息可能粘包，认证后必须把剩余消息移交同步会话
    const feed = makeDecoder((msg) => {
      if (!sync) {
        if (msg.op !== 'hello' || msg.pairCode !== pairCode) {
          sock.end(encodeFrame({ op: 'reject', reason: '配对码错误' }));
          return;
        }
        sync = this.createSyncSession(sock,
          (result) => {
            this.lastResult = result;
            this.state = 'hosting';
            try { sock.end(); } catch {}
          },
          (e) => {
            this.lastResult = { error: e.message };
            this.state = 'hosting';
            try { sock.end(); } catch {}
          });
      }
      sync.push(msg);
    });
    sock.on('data', feed);
    sock.on('error', () => {});
  }

  // ==================== 客户端模式 ====================
  async join({ host, port = SYNC_PORT, pairCode }) {
    const { cert, key } = this.identity();
    this.state = 'syncing';
    const sock = tls.connect({ host, port, cert, key, rejectUnauthorized: false });
    await new Promise((res, rej) => {
      sock.once('secureConnect', res);
      sock.once('error', rej);
      setTimeout(() => rej(new Error('连接超时')), 8000);
    });
    sock.write(encodeFrame({ op: 'hello', pairCode, deviceId: this.identity().deviceId }));
    try {
      const result = await new Promise((resolve, reject) => {
        const session = this.createSyncSession(sock, resolve, reject);
        sock.on('data', makeDecoder((msg) => session.push(msg)));
        sock.on('error', reject);
      });
      this.lastResult = result;
      // 记住对端便于下次一键同步
      this.store.set('sync.lastPeer', { host, port });
      return result;
    } finally {
      this.state = 'idle';
      try { sock.end(); } catch {}
    }
  }

  // ==================== 同步会话（双方对称；消息经 push 注入，粘包安全） ====================
  createSyncSession(sock, onDone, onError) {
    const mine = this.scanFiles();
    // 新基线：从会话开始时的清单出发，随写入事件逐项推演（不受会话后本地修改污染）
    const baselineNext = new Map(mine.map(f => [f.path, f.hash]));
    const result = { sent: 0, received: 0, conflicts: [], skipped: 0 };
    let gotFilesMsg = false;
    let sentFilesMsg = false;
    let finished = false;
    const maybeDone = () => {
      if (gotFilesMsg && sentFilesMsg && !finished) {
        finished = true;
        try { sock.write(encodeFrame({ op: 'done', result })); } catch {}
      }
    };
    const timer = setTimeout(() => {
      if (!finished) onError(new Error('同步超时（60s）'));
    }, 60000);
    const settle = (fn, val) => {
      if (settle.done) return;
      settle.done = true;
      clearTimeout(timer);
      fn(val);
    };
    sock.on('close', () => {
      if (!finished) settle(onError, new Error('连接中断'));
    });
    // 开场：发送己方清单
    try { sock.write(encodeFrame({ op: 'manifest', files: mine })); } catch (e) { settle(onError, e); }

    return {
      push: (msg) => {
        if (settle.done) return;
        try {
          if (msg.op === 'reject') {
            settle(onError, new Error(msg.reason || '被拒绝'));
          } else if (msg.op === 'manifest') {
            const want = LanSync.diffWant(mine, msg.files);
            sock.write(encodeFrame({ op: 'want', paths: want }));
          } else if (msg.op === 'want') {
            const items = [];
            for (const p of msg.paths) {
              const rel = safeRel(p);
              if (!rel) continue;
              const item = this.readFileItem(rel);
              if (item) items.push(item);
            }
            result.sent += items.length;
            sentFilesMsg = true;
            sock.write(encodeFrame({ op: 'files', items }));
            maybeDone();
          } else if (msg.op === 'files') {
            const baseline = this.store.get('sync.baseline', {});
            for (const item of msg.items) {
              const r = this.writeIncoming(item, baseline);
              if (r.status === 'ok') {
                result.received++;
                baselineNext.set(item.path, item.hash);
              } else if (r.status === 'conflict') {
                result.received++;
                result.conflicts.push(item.path);
                baselineNext.set(item.path, item.hash);
                // 冲突副本也是本地与对端共有的事实，入基线防二次误判
                if (r.conflictRel && r.localHash) baselineNext.set(r.conflictRel, r.localHash);
              } else {
                result.skipped++;
              }
            }
            gotFilesMsg = true;
            maybeDone();
          } else if (msg.op === 'done') {
            finished = true;
            // 同步完成：以会话推演的新基线落盘（下次冲突判定的共识版本）
            try { this.store.set('sync.baseline', Object.fromEntries(baselineNext)); } catch {}
            settle(onDone, { ...result, peer: msg.result || null });
          }
        } catch (e) {
          settle(onError, e);
        }
      },
    };
  }

  // ==================== mDNS（失败静默降级手动 IP） ====================
  publishMdns(port, deviceId) {
    try {
      const bonjour = require('bonjour-service')();
      const srv = bonjour.publish({
        name: deviceId, type: MDNS_TYPE, port,
        txt: { fp: this.fingerprint(), v: '1' },
      });
      return () => { try { srv.stop(); bonjour.destroy(); } catch {} };
    } catch { return null; }
  }

  async discover({ timeout = 3000 } = {}) {
    try {
      const bonjour = require('bonjour-service')();
      const found = new Map();
      const browser = bonjour.find({ type: MDNS_TYPE }, (s) => {
        const host = (s.addresses && s.addresses[0]) || s.host;
        if (host) found.set(s.name, { name: s.name, host, port: s.port, fp: s.txt?.fp || '' });
      });
      await new Promise(r => setTimeout(r, timeout));
      try { browser.stop(); bonjour.destroy(); } catch {}
      return [...found.values()];
    } catch { return []; }
  }

  status() {
    return {
      state: this.state,
      deviceId: this.identity().deviceId,
      fingerprint: this.fingerprint(),
      lastPeer: this.store.get('sync.lastPeer') || null,
      lastResult: this.lastResult,
    };
  }

  // ==================== IPC ====================
  registerIpc(bus) {
    bus.handle('sync:identity', async () => ({
      deviceId: this.identity().deviceId,
      fingerprint: this.fingerprint(),
    }));
    bus.handle('sync:host', async ({ port } = {}) => this.host({ port }));
    bus.handle('sync:stopHost', async () => { await this.stopHost(); return true; });
    bus.handle('sync:join', async ({ host, port, pairCode }) => this.join({ host, port, pairCode }));
    bus.handle('sync:discover', async () => this.discover());
    bus.handle('sync:status', async () => this.status());
  }
}

module.exports = LanSync;
module.exports.SYNC_PORT = SYNC_PORT;
module.exports.safeRel = safeRel;
module.exports.encodeFrame = encodeFrame;
module.exports.makeDecoder = makeDecoder;
