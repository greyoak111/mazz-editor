// renderer/lib/sync-web.js —— Web 局域网同步客户端（手机/平板/浏览器 → 桌面主机）
// 通道：WebSocket（每消息一帧）· 加密：配对码派生 AES-GCM-256 会话密钥（PBKDF2 10 万次）
// 协议与桌面端 main/lansync.js 完全同构：hello → manifest/want/files/done，冲突保留副本
// 配对码即密钥口令：口令错误 → 首帧 GCM 校验失败即断开，无需明文传输配对码

const te = new TextEncoder();
const td = new TextDecoder();

// ==================== 编解码（与桌面 4 字节长度前缀帧一致，Uint8Array 版） ====================
export function encodeFrameU8(obj) {
  const s = te.encode(JSON.stringify(obj));
  const out = new Uint8Array(4 + s.length);
  new DataView(out.buffer).setUint32(0, s.length);
  out.set(s, 4);
  return out;
}
export function makeDecoderU8(onMsg) {
  let buf = new Uint8Array(0);
  return (chunk) => {
    const merged = new Uint8Array(buf.length + chunk.length);
    merged.set(buf); merged.set(chunk, buf.length);
    buf = merged;
    for (;;) {
      if (buf.length < 4) return;
      const len = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
      if (len > 64 * 1024 * 1024) { buf = new Uint8Array(0); return; } // 防疯
      if (buf.length < 4 + len) return;
      const s = buf.slice(4, 4 + len);
      buf = buf.slice(4 + len);
      try { onMsg(JSON.parse(td.decode(s))); } catch {}
    }
  };
}

// ==================== 加解密（与 Node crypto aes-256-gcm / pbkdf2 对齐） ====================
export async function sha256hex(str) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(str));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
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
/** key = PBKDF2(password=sha256(pairCode), salt, 100000, SHA-256) → AES-GCM-256 */
export async function derivePairKey(pairCode, saltB64) {
  const pwHash = await crypto.subtle.digest('SHA-256', te.encode(String(pairCode)));
  const baseKey = await crypto.subtle.importKey('raw', pwHash, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: 100000, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptBytes(key, u8) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, u8);
  return { op: 'enc', iv: b64(iv), data: b64(new Uint8Array(ct)) };
}
export async function decryptBytes(key, msg) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(msg.iv) }, key, unb64(msg.data));
  return new Uint8Array(pt);
}

// ==================== 路径安全（与桌面 safeRel 一致） ====================
export function safeRel(p) {
  if (!p || typeof p !== 'string') return null;
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').includes('..')) return null;
  return norm;
}

// ==================== 工作区适配（走 window.mazz fs 桥，双后端透明） ====================
async function sha1OfB64(b64str) {
  const d = await crypto.subtle.digest('SHA-1', unb64(b64str));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

export function makeWorkspace(mazz) {
  const WS = '/workspace';

  async function walk(dir, depth, out) {
    if (depth > 8) return;
    const entries = await mazz.invoke('fs:listDir', { path: dir }).catch(() => []);
    for (const e of entries) {
      if (e.isDir) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        await walk(e.path, depth + 1, out);
      } else {
        const rel = e.path.slice(WS.length + 1);
        if (rel.startsWith('.mazz/')) continue; // 临时区不同步
        const st = await mazz.invoke('fs:stat', { path: e.path }).catch(() => null);
        if (!st?.exists || st.size > 50 * 1024 * 1024) continue;
        const data = await mazz.invoke('fs:readFileBase64', { path: e.path }).catch(() => null);
        if (data == null) continue;
        out.push({ path: rel, mtime: Math.floor(st.mtime || 0), size: st.size, hash: await sha1OfB64(data) });
      }
    }
  }

  return {
    async scanFiles() { const out = []; await walk(WS, 0, out); return out; },

    async readItem(rel) {
      const p = WS + '/' + rel;
      const st = await mazz.invoke('fs:stat', { path: p }).catch(() => null);
      if (!st?.exists || st.isDir) return null;
      const data = await mazz.invoke('fs:readFileBase64', { path: p }).catch(() => null);
      if (data == null) return null;
      return { path: rel, mtime: Math.floor(st.mtime || 0), hash: await sha1OfB64(data), data };
    },

    /** 与桌面 writeIncoming 同语义：一致跳过 / 冲突保留本地副本 / 否则覆盖 */
    async writeIncoming(item, baseline) {
      const rel = safeRel(item.path);
      if (!rel) return { status: 'skip' };
      const p = WS + '/' + rel;
      const st = await mazz.invoke('fs:stat', { path: p }).catch(() => ({ exists: false }));
      if (st.exists && !st.isDir) {
        const localB64 = await mazz.invoke('fs:readFileBase64', { path: p }).catch(() => '');
        const localHash = await sha1OfB64(localB64);
        if (localHash === item.hash) return { status: 'skip', localHash };
        const localChanged = baseline[rel] !== localHash; // 无基线保守视为变了，零丢失优先
        if (localChanged) {
          const dot = rel.lastIndexOf('.');
          const ext = dot > 0 ? rel.slice(dot) : '';
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const conflictRel = rel.slice(0, rel.length - ext.length) + `.conflict-${stamp}` + ext;
          await mazz.invoke('fs:rename', { from: p, to: WS + '/' + conflictRel }).catch(() => {});
          await mazz.invoke('fs:writeFileBase64', { path: p, base64: item.data });
          return { status: 'conflict', conflictRel, localHash };
        }
      }
      await mazz.invoke('fs:writeFileBase64', { path: p, base64: item.data });
      return { status: 'ok' };
    },
  };
}

/** 与桌面 LanSync.diffWant 一致：双方必达同一结论 */
export function diffWant(mine, remote) {
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

// ==================== 加入同步（客户端） ====================
/**
 * @param {{host: string, port: number, pairCode: string, deviceId?: string}} opts
 * @returns {Promise<{sent, received, conflicts, skipped, peer}>}
 */
export async function joinSync({ host, port, pairCode, deviceId }) {
  const mazz = window.mazz;
  if (!mazz) throw new Error('桥未就绪');
  if (!globalThis.crypto?.subtle) throw new Error('当前 WebView 不支持 WebCrypto（非安全上下文），同步加密无法初始化');
  const ws = new WebSocket(`ws://${host}:${port}`);
  const pending = [];
  let waiter = null;
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (waiter) { const w = waiter; waiter = null; w(msg); }
    else pending.push(msg);
  };
  const nextMsg = (timeout = 15000) => new Promise((res, rej) => {
    if (pending.length) return res(pending.shift());
    waiter = res;
    setTimeout(() => { if (waiter === res) { waiter = null; rej(new Error('等待对端响应超时')); } }, timeout);
  });
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('无法连接 ' + host + ':' + port + '（确认同一局域网、端口正确）'));
    setTimeout(() => rej(new Error('连接超时')), 8000);
  });

  try {
    // 1) 取盐 → 派生会话密钥（配对码即口令，永不明文传输）
    const hello = await nextMsg();
    if (hello.op !== 'ws-hello' || !hello.salt) throw new Error('对端不是 Mazz 同步服务');
    const key = await derivePairKey(pairCode, hello.salt);
    const send = async (obj) => ws.send(JSON.stringify(await encryptBytes(key, encodeFrameU8(obj))));
    const decoder = makeDecoderU8((m) => { if (waiter) { const w = waiter; waiter = null; w(m); } else pending.push(m); });
    let firstDecryptFailed = false;
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.op !== 'enc') return;
      decryptBytes(key, msg).then(decoder).catch(() => {
        if (!firstDecryptFailed) {
          firstDecryptFailed = true;
          if (waiter) { const w = waiter; waiter = null; }
          pending.length = 0;
          pending.push({ op: 'reject', reason: '配对码错误（或主机已更换配对码）' });
        }
      });
    };

    // 2) 复用桌面 hello 握手（加密通道内核验配对码）
    await send({ op: 'hello', pairCode, deviceId: deviceId || 'mazz-mobile' });

    // 3) 对称会话：manifest/want/files/done
    const wsx = makeWorkspace(mazz);
    const mine = await wsx.scanFiles();
    const baselineNext = new Map(mine.map(f => [f.path, f.hash]));
    const result = { sent: 0, received: 0, conflicts: [], skipped: 0 };
    let gotFiles = false, sentFiles = false, finished = false;
    const maybeDone = async () => {
      if (gotFiles && sentFiles && !finished) { finished = true; await send({ op: 'done', result }); }
    };
    await send({ op: 'manifest', files: mine });

    const final = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('同步超时（60s）')), 60000);
      ws.onclose = () => { if (!finished) { clearTimeout(timer); reject(new Error('连接中断')); } };
      (async () => {
        for (;;) {
          const msg = await nextMsg(60000);
          if (msg.op === 'reject') throw new Error(msg.reason || '被拒绝');
          if (msg.op === 'manifest') {
            await send({ op: 'want', paths: diffWant(mine, msg.files) });
          } else if (msg.op === 'want') {
            const items = [];
            for (const p of msg.paths) {
              const rel = safeRel(p);
              if (!rel) continue;
              const item = await wsx.readItem(rel);
              if (item) items.push(item);
            }
            result.sent += items.length;
            sentFiles = true;
            await send({ op: 'files', items });
            await maybeDone();
          } else if (msg.op === 'files') {
            const st = await mazz.invoke('settings:get', { key: 'sync.baseline' }).catch(() => null);
            const baseline = st || {};
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
            gotFiles = true;
            await maybeDone();
          } else if (msg.op === 'done') {
            finished = true;
            clearTimeout(timer);
            await mazz.invoke('settings:set', { key: 'sync.baseline', value: Object.fromEntries(baselineNext) }).catch(() => {});
            await mazz.invoke('settings:set', { key: 'sync.lastPeer', value: { host, port } }).catch(() => {});
            resolve({ ...result, peer: msg.result || null });
            return;
          }
        }
      })().catch(e => { clearTimeout(timer); reject(e); });
    });
    return final;
  } finally {
    try { ws.close(); } catch {}
  }
}
