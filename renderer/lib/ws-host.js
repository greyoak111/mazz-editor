// renderer/lib/ws-host.js —— 移动端同步主机（纯 JS 实现，原生只搬字节）
// 层级：TCP 插件(字节) → HTTP Upgrade → WebSocket 帧 → AES-GCM 加密帧 → 同步会话
// 协议与桌面 main/lansync.js、客户端 sync-web.js 完全同构（hello → manifest/want/files/done）
// 加密与桌面 WS 通道一致：配对码 PBKDF2(10 万次) 派生 AES-GCM-256，密钥即身份，口令错即断开
import {
  encodeFrameU8, makeDecoderU8,
  derivePairKey, encryptBytes, decryptBytes,
  safeRel, diffWant, makeWorkspace,
} from './sync-web.js';

const te = new TextEncoder();
const td = new TextDecoder();
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ==================== 基础工具 ====================
function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function concatU8(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

// ==================== WebSocket 帧编解码（服务器侧：发送不掩码，接收解掩码） ====================
export function wsEncodeU8(payload, op = 1) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = new Uint8Array([0x80 | op, len]);
  } else if (len < 65536) {
    head = new Uint8Array(4);
    head[0] = 0x80 | op; head[1] = 126;
    new DataView(head.buffer).setUint16(2, len);
  } else {
    head = new Uint8Array(10);
    head[0] = 0x80 | op; head[1] = 127;
    new DataView(head.buffer).setBigUint64(2, BigInt(len));
  }
  return concatU8(head, payload);
}

export class WsFrameReader {
  constructor() { this.buf = new Uint8Array(0); }
  /** 喂字节 → 返回完整帧数组 {fin, op, payload} */
  feed(chunk) {
    this.buf = concatU8(this.buf, chunk);
    const out = [];
    for (;;) {
      const f = this.tryRead();
      if (!f) break;
      out.push(f);
    }
    return out;
  }
  tryRead() {
    const buf = this.buf;
    if (buf.length < 2) return null;
    const fin = !!(buf[0] & 0x80);
    const op = buf[0] & 0x0f;
    const masked = !!(buf[1] & 0x80);
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = new DataView(buf.buffer, buf.byteOffset).getUint16(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      len = Number(new DataView(buf.buffer, buf.byteOffset).getBigUint64(2));
      off = 10;
    }
    if (len > 128 * 1024 * 1024) { this.buf = new Uint8Array(0); return null; }
    let mask = null;
    if (masked) {
      if (buf.length < off + 4) return null;
      mask = buf.slice(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return null;
    let payload = buf.slice(off, off + len);
    if (mask) {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    this.buf = buf.slice(off + len);
    return { fin, op, payload };
  }
}

async function sha1Base64(str) {
  const d = await crypto.subtle.digest('SHA-1', te.encode(str));
  return b64(new Uint8Array(d));
}

// ==================== 移动端主机 ====================
/**
 * 在手机/平板上发起局域网共享（对端：手机 App / 桌面版 / 浏览器均可）
 * @param {object} opts
 * @param {object} [opts.transport] 原生 TCP 插件（默认取 window.Capacitor.Plugins.TcpServer；测试可注入伪实现）
 * @param {string} [opts.pairCode] 6 位配对码（默认随机生成）
 * @param {number} [opts.port] 监听端口（默认 47822，被占用则 0=系统分配）
 * @param {(r: object) => void} [opts.onResult] 一次同步完成回调
 * @returns {Promise<{port, addresses, pairCode, fingerprint, stop}>}
 */
export async function startMobileHost({ transport, pairCode, port = 47822, onResult } = {}) {
  const mazz = window.mazz;
  if (!mazz) throw new Error('桥未就绪');
  if (!globalThis.crypto?.subtle) throw new Error('当前 WebView 不支持 WebCrypto，无法建立加密通道');
  const tcp = transport || window.Capacitor?.Plugins?.TcpServer;
  if (!tcp) throw new Error('未找到 TCP 插件（浏览器预览无法当主机，请用桌面版发起共享）');

  pairCode = pairCode || String(Math.floor(100000 + Math.random() * 900000));
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const key = await derivePairKey(pairCode, b64(saltBytes));
  const wsx = makeWorkspace(mazz);
  const deviceId = 'mazz-mobile-' + (await mazz.invoke('settings:get', { key: 'sync.deviceId' }).catch(() => null) || Math.random().toString(16).slice(2, 6));
  const fingerprint = (await mazz.invoke('settings:get', { key: 'sync.deviceFp' }).catch(() => null)) || '---- ---- ---- ----';

  const conns = new Map(); // id -> conn state
  const result = await tcp.start({ port });
  const actualPort = result.port || port;

  const sendText = (id, str) => tcp.send({ id, data: b64(wsEncodeU8(te.encode(str))) });
  const sendEncrypted = async (id, obj) => {
    const enc = await encryptBytes(key, encodeFrameU8(obj));
    await sendText(id, JSON.stringify(enc));
  };

  // —— 单连接会话（与桌面 handleIncoming 同语义：hello 核验 → 对称会话）——
  async function handleMessage(id, msg) {
    const c = conns.get(id);
    if (!c) return;
    if (!c.helloed) {
      if (msg.op !== 'hello' || msg.pairCode !== pairCode) {
        await sendEncrypted(id, { op: 'reject', reason: '配对码错误' }).catch(() => {});
        setTimeout(() => tcp.close({ id }), 300)?.unref?.();
        return;
      }
      c.helloed = true;
      c.session = createSession(id); // 核验通过才建会话（hello 不进会话）
      return;
    }
    await c.session.push(msg);
  }

  function createSession(id) {
    const state = { finished: false, gotFiles: false, sentFiles: false };
    const result = { sent: 0, received: 0, conflicts: [], skipped: 0 };
    let mine = [];
    const baselineNext = new Map();
    // 就绪门闩：清单扫描完成前不处理任何消息（否则会用空清单算出错误的 want）
    let readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });
    const maybeDone = async () => {
      if (state.gotFiles && state.sentFiles && !state.finished) {
        state.finished = true;
        await sendEncrypted(id, { op: 'done', result });
      }
    };
    const timer = setTimeout(() => { if (!state.finished) tcp.close({ id }); }, 60000);
    timer.unref?.();
    (async () => {
      mine = await wsx.scanFiles();
      for (const f of mine) baselineNext.set(f.path, f.hash);
      await sendEncrypted(id, { op: 'manifest', files: mine });
      readyResolve();
    })().catch(() => { readyResolve(); });
    return {
      push: async (msg) => {
        await ready; // 等清单就绪，保证 want 计算基于完整清单
        if (state.finished) return;
        try {
          if (msg.op === 'reject') { state.finished = true; clearTimeout(timer); return; }
          if (msg.op === 'manifest') {
            await sendEncrypted(id, { op: 'want', paths: diffWant(mine, msg.files) });
          } else if (msg.op === 'want') {
            const items = [];
            for (const p of msg.paths) {
              const rel = safeRel(p);
              if (!rel) continue;
              const item = await wsx.readItem(rel);
              if (item) items.push(item);
            }
            result.sent += items.length;
            state.sentFiles = true;
            await sendEncrypted(id, { op: 'files', items });
            await maybeDone();
          } else if (msg.op === 'files') {
            const baseline = (await mazz.invoke('settings:get', { key: 'sync.baseline' }).catch(() => null)) || {};
            for (const item of msg.items) {
              const r = await wsx.writeIncoming(item, baseline);
              if (r.status === 'ok') { result.received++; baselineNext.set(item.path, item.hash); }
              else if (r.status === 'conflict') {
                result.received++;
                result.conflicts.push(item.path);
                baselineNext.set(item.path, item.hash);
                if (r.conflictRel && r.localHash) baselineNext.set(r.conflictRel, r.localHash);
              } else result.skipped++;
            }
            state.gotFiles = true;
            await maybeDone();
          } else if (msg.op === 'done') {
            state.finished = true;
            clearTimeout(timer);
            await mazz.invoke('settings:set', { key: 'sync.baseline', value: Object.fromEntries(baselineNext) }).catch(() => {});
            onResult?.({ ...result, peer: msg.result || null });
            setTimeout(() => tcp.close({ id }), 300)?.unref?.();
          }
        } catch { /* 单条消息失败不断连 */ }
      },
    };
  }

  // —— 连接生命周期 ——
  const listeners = [];
  const on = async (ev, cb) => { const h = await tcp.addListener(ev, cb); listeners.push(h); };

  await on('accept', ({ id }) => {
    conns.set(id, { upgraded: false, buf: new Uint8Array(0), reader: new WsFrameReader(), frags: [], helloed: false, session: null, key });
  });
  await on('closed', ({ id }) => conns.delete(id));
  await on('data', async ({ id, data }) => {
    const c = conns.get(id);
    if (!c) return;
    const bytes = unb64(data);
    if (!c.upgraded) {
      c.buf = concatU8(c.buf, bytes);
      const headEnd = indexOfCRLFCRLF(c.buf);
      if (headEnd < 0) return;
      const headText = td.decode(c.buf.slice(0, headEnd));
      const keyM = /Sec-WebSocket-Key:\s*(\S+)/i.exec(headText);
      const rest = c.buf.slice(headEnd + 4);
      c.buf = new Uint8Array(0);
      if (!keyM) { tcp.close({ id }); return; }
      const accept = await sha1Base64(keyM[1] + WS_GUID);
      const resp = 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n';
      await tcp.send({ id, data: b64(te.encode(resp)) });
      c.upgraded = true;
      await sendText(id, JSON.stringify({
        op: 'ws-hello', salt: b64(saltBytes), deviceId, fingerprint,
      }));
      if (rest.length) await onFrames(id, rest); // 升级包里粘着的帧
      return;
    }
    await onFrames(id, bytes);
  });

  async function onFrames(id, bytes) {
    const c = conns.get(id);
    if (!c) return;
    for (const fr of c.reader.feed(bytes)) {
      if (fr.op === 8) { tcp.close({ id }); return; }
      if (fr.op === 9) { tcp.send({ id, data: b64(wsEncodeU8(fr.payload, 10)) }); continue; }
      if (fr.op !== 0 && fr.op !== 1 && fr.op !== 2) continue;
      c.frags.push(fr.payload);
      if (!fr.fin) continue;
      const whole = c.frags.reduce(concatU8, new Uint8Array(0));
      c.frags = [];
      let msg;
      try { msg = JSON.parse(td.decode(whole)); } catch { continue; }
      if (msg?.op !== 'enc') continue;
      try {
        const plain = await decryptBytes(c.key, msg);
        c.decoder ||= makeDecoderU8((m) => handleMessage(id, m));
        c.decoder(plain);
      } catch {
        // 配对码错误：GCM 校验失败即断开
        tcp.close({ id });
        return;
      }
    }
  }

  function indexOfCRLFCRLF(u8) {
    for (let i = 0; i + 3 < u8.length; i++) {
      if (u8[i] === 13 && u8[i + 1] === 10 && u8[i + 2] === 13 && u8[i + 3] === 10) return i;
    }
    return -1;
  }

  return {
    port: actualPort,
    addresses: result.addresses || [],
    pairCode,
    fingerprint,
    deviceId,
    stop: async () => {
      for (const h of listeners) { try { h.remove(); } catch {} }
      await tcp.stop().catch(() => {});
    },
  };
}
