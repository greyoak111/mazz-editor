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

// ==================== WebSocket 通道（手机/平板端；零依赖 RFC6455 极简实现） ====================
// 设计：手机 WebView 无法裸 TLS（自签证书被系统拒绝），改走 WebSocket；
// 加密不降格——配对码派生 AES-GCM-256 会话密钥（PBKDF2 10 万次），密钥即身份：
// 口令错误 → 首帧 GCM 校验失败即断开，配对码永不明文上传。会话逻辑与 TLS 通道完全复用。
const http = require('http');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsEncode(payload, op = 1) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.from([0x80 | op, len]); }
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

function wsTryRead(adapter) {
  const buf = adapter.buf;
  if (buf.length < 2) return null;
  const fin = !!(buf[0] & 0x80);
  const op = buf[0] & 0x0f;
  const masked = !!(buf[1] & 0x80);
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  if (len > 128 * 1024 * 1024) { adapter.buf = Buffer.alloc(0); return null; }
  const maskOff = off;
  if (masked) off += 4;
  if (buf.length < off + len) return null;
  let payload = buf.slice(off, off + len);
  if (masked) {
    const mask = buf.slice(maskOff, maskOff + 4);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
    payload = out;
  }
  adapter.buf = buf.slice(off + len);
  return { fin, op, payload };
}

function encBuf(key, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return { op: 'enc', iv: iv.toString('base64'), data: Buffer.concat([ct, c.getAuthTag()]).toString('base64') };
}
function decBuf(key, msg) {
  const raw = Buffer.from(msg.data, 'base64');
  const tag = raw.slice(raw.length - 16);
  const ct = raw.slice(0, raw.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(msg.iv, 'base64'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]); // GCM 校验失败抛错 → 配对码错误
}

/** 把 WebSocket 连接包装成 tls.Socket 的接口子集（on/write/end），会话层零改动复用 */
class WsAdapter {
  constructor(sock) {
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.key = null;
    this.listeners = { data: [], error: [], close: [] };
    sock.on('data', (c) => this.feed(c));
    sock.on('error', () => this.emit('error'));
    sock.on('close', () => this.emit('close'));
  }
  on(ev, cb) { (this.listeners[ev] || (this.listeners[ev] = [])).push(cb); }
  emit(ev, ...args) { for (const cb of this.listeners[ev] || []) { try { cb(...args); } catch {} } }
  sendJson(obj) { try { this.sock.write(wsEncode(Buffer.from(JSON.stringify(obj), 'utf8'))); } catch {} }
  attachCrypto(key) { this.key = key; }
  write(buf) { if (this.key) this.sendJson(encBuf(this.key, buf)); }
  end(buf) { if (buf) { try { this.write(buf); } catch {} } this.close(); }
  close() { try { this.sock.end(); } catch {} }
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const fr = wsTryRead(this);
      if (!fr) return;
      if (fr.op === 8) { this.close(); this.emit('close'); return; }
      if (fr.op === 9) { try { this.sock.write(wsEncode(fr.payload, 10)); } catch {} continue; }
      if (fr.op !== 0 && fr.op !== 1 && fr.op !== 2) continue;
      this.frags.push(fr.payload);
      if (!fr.fin) continue;
      const msg = Buffer.concat(this.frags);
      this.frags = [];
      let obj;
      try { obj = JSON.parse(msg.toString('utf8')); } catch { continue; }
      if (obj?.op === 'enc' && this.key) {
        try { this.emit('data', decBuf(this.key, obj)); }
        catch { this.close(); this.emit('close'); return; }
      }
    }
  }
}

class WsServer {
  constructor(onConn) { this.onConn = onConn; this.adapters = new Set(); this.server = null; this._port = null; }
  listen(port) {
    return new Promise((res, rej) => {
      this.server = http.createServer((_, r) => { r.writeHead(426); r.end(); });
      this.server.on('upgrade', (req, sock) => {
        const k = req.headers['sec-websocket-key'];
        if (!k) { sock.destroy(); return; }
        const acc = crypto.createHash('sha1').update(k + WS_GUID).digest('base64');
        sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
        const adapter = new WsAdapter(sock);
        this.adapters.add(adapter);
        adapter.on('close', () => this.adapters.delete(adapter));
        try { this.onConn(adapter); } catch {}
      });
      this.server.once('error', rej);
      this.server.listen(port, () => { this._port = this.server.address().port; res(); });
    });
  }
  port() { return this._port; }
  close() { for (const a of [...this.adapters]) a.end(); try { this.server?.close(); } catch {} }
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
    // 浏览器状态虚拟项：合并写回（收藏夹/历史/主页），不走文件落盘
    if (item.path === LanSync.SETTINGS_REL) {
      const ok = this.mergeBrowserState(Buffer.from(item.data || '', 'base64').toString('utf8'));
      return ok ? { status: 'ok' } : { status: 'skip' };
    }
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
    // —— 移动端 WebSocket 通道（端口 +1；失败静默，不影响桌面通道）——
    this.webSync = null;
    let wsPort = null;
    try {
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(crypto.createHash('sha256').update(pairCode).digest(), salt, 100000, 32, 'sha256');
      const srv = new WsServer((adapter) => {
        adapter.sendJson({ op: 'ws-hello', salt: salt.toString('base64'), deviceId, fingerprint: this.fingerprint() });
        adapter.attachCrypto(key);
        this.handleIncoming(adapter, pairCode);
      });
      await srv.listen(actualPort + 1);
      this.webSync = srv;
      wsPort = srv.port();
    } catch {}
    return { port: actualPort, wsPort, pairCode, fingerprint: this.fingerprint(), deviceId };
  }

  async stopHost() {
    this.mdnsStop?.();
    this.mdnsStop = null;
    if (this.webSync) { try { this.webSync.close(); } catch {} this.webSync = null; }
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
            this.setProgress({ phase: 'transfer', want: want.length, total: want.length });
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
            this.setProgress({ sent: (this.progress?.sent || 0) + items.length });
            sentFilesMsg = true;
            sock.write(encodeFrame({ op: 'files', items }));
            maybeDone();
          } else if (msg.op === 'files') {
            const baseline = this.store.get('sync.baseline', {});
            for (const item of msg.items) {
              const r = this.writeIncoming(item, baseline);
              if (r.status === 'ok') {
                result.received++;
                this.setProgress({ received: (this.progress?.received || 0) + 1 });
                baselineNext.set(item.path, item.hash);
              } else if (r.status === 'conflict') {
                result.received++;
                this.setProgress({ received: (this.progress?.received || 0) + 1 });
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
      // 实时进度：{phase, sent, received, want, total}（sync.js 进度条/计数用）
      progress: this.progress || null,
    };
  }

  setProgress(patch) {
    this.progress = { phase: 'idle', sent: 0, received: 0, want: 0, total: 0, ...(this.progress || {}), ...patch };
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
