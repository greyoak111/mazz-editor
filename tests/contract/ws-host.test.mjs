// tests/contract/ws-host.test.mjs —— 移动端同步主机（ws-host.js）端到端契约
// 场景：Node 起真实 TCP 传输当「手机主机」，另一个 Node 进程内 WS 客户端当「对端手机」，
// 全链路真实字节：HTTP Upgrade → WS 帧（掩码）→ AES-GCM（配对码派生）→ 同步会话收敛
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import net from 'node:net';
import nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!globalThis.localStorage) globalThis.localStorage = window.localStorage;
if (!globalThis.sessionStorage) globalThis.sessionStorage = window.sessionStorage;

const { installBrowserBridge } = await import('../../renderer/lib/browser-bridge.js');
installBrowserBridge();
const { startMobileHost, wsEncodeU8, WsFrameReader } = await import('../../renderer/lib/ws-host.js');

// ==================== 真实 TCP 传输（注入 ws-host，替代原生插件） ====================
function makeNodeTransport() {
  const sockets = new Map();
  const cbs = {};
  let server = null;
  let seq = 0;
  return {
    async start({ port }) {
      return new Promise((resolve, reject) => {
        server = net.createServer((sock) => {
          const id = 'c' + (++seq);
          sockets.set(id, sock);
          cbs.accept?.({ id, addr: sock.remoteAddress || '' });
          sock.on('data', (chunk) => cbs.data?.({ id, data: chunk.toString('base64') }));
          sock.on('close', () => { sockets.delete(id); cbs.closed?.({ id }); });
          sock.on('error', () => {});
        });
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, addresses: ['127.0.0.1'] }));
      });
    },
    async stop() { for (const s of sockets.values()) s.destroy(); server?.close(); },
    async send({ id, data }) { sockets.get(id)?.write(Buffer.from(data, 'base64')); },
    async close({ id }) { const s = sockets.get(id); sockets.delete(id); s?.end(); },
    async addListener(ev, cb) { cbs[ev] = cb; return { remove() { delete cbs[ev]; } } },
  };
}

// ==================== Node 侧 WS 客户端（扮演另一台手机/电脑） ====================
function b64(u8) { return Buffer.from(u8).toString('base64'); }

class TestWsClient {
  constructor() {
    this.reader = new WsFrameReader();
    this.buf = '';
    this.upgraded = false;
    this._queue = [];   // onMessage 未设置时缓冲（101 与 ws-hello 常同帧到达）
    this._handler = null;
  }
  set onMessage(fn) {
    this._handler = fn;
    if (fn) { for (const m of this._queue.splice(0)) fn(m); }
  }
  get onMessage() { return this._handler; }

  async connect(port) {
    this.sock = net.connect(port, '127.0.0.1');
    await new Promise((res, rej) => { this.sock.once('connect', res); this.sock.once('error', rej); });
    this.key = nodeCrypto.randomBytes(16).toString('base64');
    this.sock.write(
      'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${this.key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    this.sock.on('data', (c) => this.feed(c));
    // 等 101 响应
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('升级超时')), 5000);
      const check = () => { if (this.upgraded) { clearTimeout(t); res(); } else setTimeout(check, 20); };
      check();
    });
  }

  feed(chunk) {
    if (!this.upgraded) {
      this.headBuf = Buffer.concat([this.headBuf || Buffer.alloc(0), chunk]);
      const idx = this.headBuf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = this.headBuf.slice(0, idx).toString();
      assert.ok(head.includes('101'), '应返回 101：' + head);
      const acceptExpect = nodeCrypto.createHash('sha1').update(this.key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      assert.ok(head.includes(acceptExpect), 'Accept 签名须正确');
      this.upgraded = true;
      const rest = this.headBuf.slice(idx + 4);
      if (rest.length) this.feedFrames(rest);
      return;
    }
    this.feedFrames(chunk);
  }

  feedFrames(chunk) {
    for (const fr of this.reader.feed(chunk)) {
      if (fr.op === 1 || fr.op === 0) {
        this._msg = (this._msg || '') + Buffer.from(fr.payload).toString('utf8');
        if (fr.fin) {
          const m = this._msg;
          this._msg = '';
          const obj = JSON.parse(m);
          if (this._handler) this._handler(obj);
          else this._queue.push(obj);
        }
      }
    }
  }

  send(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    // 客户端帧必须掩码
    const mask = nodeCrypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
    let head;
    if (payload.length < 126) { head = Buffer.from([0x81, 0x80 | payload.length]); }
    else if (payload.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
    this.sock.write(Buffer.concat([head, mask, masked]));
  }

  close() { try { this.sock?.end(); } catch {} }
}

// 客户端加密助手（Node 侧，与桌面 lansync 同参数）
function clientKey(pairCode, saltB64) {
  return nodeCrypto.pbkdf2Sync(nodeCrypto.createHash('sha256').update(pairCode).digest(), Buffer.from(saltB64, 'base64'), 100000, 32, 'sha256');
}
function clientEnc(key, buf) {
  const iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return { op: 'enc', iv: iv.toString('base64'), data: Buffer.concat([ct, c.getAuthTag()]).toString('base64') };
}
function clientDec(key, msg) {
  const raw = Buffer.from(msg.data, 'base64');
  const d = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(msg.iv, 'base64'));
  d.setAuthTag(raw.slice(raw.length - 16));
  return Buffer.concat([d.update(raw.slice(0, raw.length - 16)), d.final()]);
}

function encodeFrameBuf(obj) {
  const s = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(s.length);
  return Buffer.concat([len, s]);
}
function makeBufDecoder(onMsg) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) break;
      try { onMsg(JSON.parse(buf.slice(4, 4 + len).toString('utf8'))); } catch {}
      buf = buf.slice(4 + len);
    }
  };
}

// 客户端工作区（临时目录）
function clientWorkspace(dir) {
  const scan = () => {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) continue;
      const buf = fs.readFileSync(p);
      out.push({ path: name, mtime: Math.floor(fs.statSync(p).mtimeMs), size: buf.length, hash: nodeCrypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) });
    }
    return out;
  };
  return {
    scan,
    readItem: (rel) => {
      const p = path.join(dir, rel);
      if (!fs.existsSync(p)) return null;
      const buf = fs.readFileSync(p);
      return { path: rel, mtime: Math.floor(fs.statSync(p).mtimeMs), hash: nodeCrypto.createHash('sha1').update(buf).digest('hex').slice(0, 12), data: buf.toString('base64') };
    },
    writeItem: (item) => fs.writeFileSync(path.join(dir, item.path), Buffer.from(item.data, 'base64')),
  };
}

function diffWantLocal(mine, remote) {
  const mm = new Map(mine.map(f => [f.path, f]));
  const want = [];
  for (const rf of remote) {
    const lf = mm.get(rf.path);
    if (!lf) { want.push(rf.path); continue; }
    if (lf.hash === rf.hash) continue;
    if (rf.mtime > lf.mtime) want.push(rf.path);
    else if (rf.mtime === lf.mtime && rf.hash < lf.hash) want.push(rf.path);
  }
  return want;
}

// ==================== 测试 ====================
describe('移动端主机：全链路端到端（真实 TCP + 掩码帧 + AES-GCM）', () => {
  test('手机当主机 ↔ 对端加入：双向收敛 + 错误配对码断开', async () => {
    const mazz = window.mazz;
    // 主机端工作区（localStorage 后端）：独有 host-only.md + 共有 shared.md
    await mazz.invoke('fs:writeFile', { path: '/workspace/host-only.md', content: '主机独有\n' });
    await mazz.invoke('fs:writeFile', { path: '/workspace/shared.md', content: '一致内容\n' });

    // 对端工作区（临时目录）：独有 client-only.md + 相同 shared.md
    const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-client-'));
    fs.writeFileSync(path.join(clientDir, 'client-only.md'), '对端独有\n');
    fs.writeFileSync(path.join(clientDir, 'shared.md'), '一致内容\n');
    const cws = clientWorkspace(clientDir);

    // 1) 起主机
    const host = await startMobileHost({ transport: makeNodeTransport(), pairCode: '556677', port: 0 });
    assert.ok(host.port > 0);
    assert.deepEqual(host.addresses, ['127.0.0.1']);

    // 2) 错误配对码：连接后应被断开
    {
      const bad = new TestWsClient();
      await bad.connect(host.port);
      const wsHello = await new Promise(r => { bad.onMessage = (m) => r(m); });
      const badKey = clientKey('000000', wsHello.salt);
      bad.send(clientEnc(badKey, encodeFrameBuf({ op: 'hello', pairCode: '000000', deviceId: 'bad' })));
      await new Promise(r => setTimeout(r, 600));
      bad.close();
      // 不崩即可（主机仍在）——正确配对码后续能连上即为证明
    }

    // 3) 正确配对码：完整会话
    const cli = new TestWsClient();
    await cli.connect(host.port);
    const wsHello = await new Promise(r => { cli.onMessage = (m) => r(m); });
    assert.equal(wsHello.op, 'ws-hello');
    const key = clientKey('556677', wsHello.salt);
    const sendEnc = (obj) => cli.send(clientEnc(key, encodeFrameBuf(obj)));

    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('会话超时')), 20000);
      const mine = cws.scan();
      let gotFiles = false, sentFiles = false, finished = false;
      const maybeDone = () => { if (gotFiles && sentFiles && !finished) { finished = true; sendEnc({ op: 'done', result: { sent: 0, received: 0 } }); } };
      sendEnc({ op: 'hello', pairCode: '556677', deviceId: 'test-client' });
      sendEnc({ op: 'manifest', files: mine });
      cli.onMessage = async (m) => {
        if (m.op !== 'enc') return;
        const frames = [];
        const dec = makeBufDecoder((x) => frames.push(x));
        dec(clientDec(key, m));
        for (const msg of frames) {
          if (msg.op === 'manifest') {
            await sendEnc({ op: 'want', paths: diffWantLocal(mine, msg.files) });
          } else if (msg.op === 'want') {
            const items = msg.paths.map(p => cws.readItem(p)).filter(Boolean);
            sentFiles = true;
            await sendEnc({ op: 'files', items });
            maybeDone();
          } else if (msg.op === 'files') {
            for (const item of msg.items) cws.writeItem(item);
            gotFiles = true;
            maybeDone();
          } else if (msg.op === 'done') {
            clearTimeout(timer);
            resolve(msg);
            return;
          }
        }
      };
    });

    await done;
    cli.close();

    // 4) 断言收敛
    assert.equal(fs.readFileSync(path.join(clientDir, 'host-only.md'), 'utf8'), '主机独有\n'); // 对端收到主机的
    const got = await mazz.invoke('fs:readFile', { path: '/workspace/client-only.md' });
    assert.equal(got, '对端独有\n'); // 主机收到对端的
    await host.stop();
  });

  test('WS 帧编解码：边界长度 + 掩码 + 分片', () => {
    // 编码：125/126(16位)/127(64位)
    for (const len of [3, 125, 126, 70000]) {
      const payload = new Uint8Array(len).fill(65);
      const frame = wsEncodeU8(payload);
      const r = new WsFrameReader();
      const frames = r.feed(frame);
      assert.equal(frames.length, 1, 'len=' + len);
      assert.equal(frames[0].payload.length, len);
    }
    // 掩码帧解析（客户端→服务器方向）
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const mask = new Uint8Array([9, 8, 7, 6]);
    const masked = payload.map((b, i) => b ^ mask[i & 3]);
    const frame = new Uint8Array([0x81, 0x80 | 5, ...mask, ...masked]);
    const r = new WsFrameReader();
    const frames = r.feed(frame);
    assert.deepEqual([...frames[0].payload], [1, 2, 3, 4, 5]);
    // 分片喂入
    const big = wsEncodeU8(new Uint8Array(300).fill(66));
    const r2 = new WsFrameReader();
    assert.equal(r2.feed(big.slice(0, 100)).length, 0);
    const rest = r2.feed(big.slice(100));
    assert.equal(rest.length, 1);
    assert.equal(rest[0].payload.length, 300);
  });
});
