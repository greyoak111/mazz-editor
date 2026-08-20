// main/slide-remote.js —— 手机遥控伺服（W40：单端口单页面+WebSocket 指令道+心跳即在线+扫码即连）
// FreeShow servers.ts 思路简化版：1 端口（而非 4 端口）——HTTP 伺服遥控页 + /ws 升级 WebSocket 双工
// 安全模型：仅局域网监听（0.0.0.0 但页内地址即门槛）+指令白名单（next/prev/black 三枚，其余丢）+心跳 15s 僵死即清
'use strict';
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CMDS = new Set(['next', 'prev', 'black']); // 指令白名单

// ---------- 极简 RFC6455 编解码（文本帧+ping/pong+close；客户端帧必须带掩码） ----------
function wsEncodeText(str) {
  const p = Buffer.from(str, 'utf8');
  const len = p.length;
  let head;
  if (len < 126) { head = Buffer.from([0x81, len]); }
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, p]);
}
function wsDecode(buf) {
  // 返回 { msgs: [{op, text}], rest }——支持粘包
  const msgs = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const op = buf[off] & 0x0f;
    const masked = !!(buf[off + 1] & 0x80);
    let len = buf[off + 1] & 0x7f;
    let p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const maskLen = masked ? 4 : 0;
    if (p + maskLen + len > buf.length) break;
    let payload = buf.subarray(p + maskLen, p + maskLen + len);
    if (masked) {
      const mask = buf.subarray(p, p + 4);
      payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    }
    msgs.push({ op, text: payload.toString('utf8') });
    off = p + maskLen + len;
  }
  return { msgs, rest: buf.subarray(off) };
}

// ---------- 遥控页（单文件无依赖：大按钮+当前帧+进度+计时+在线点+本地走字） ----------
const REMOTE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Mazz 遥控</title>
<style>
  * { margin: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { background: #0b0b10; color: #eee; font-family: system-ui, sans-serif; height: 100dvh; display: flex; flex-direction: column; user-select: none; }
  .top { padding: 14px 16px 8px; display: flex; align-items: center; gap: 8px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #f43f5e; flex: none; transition: background .3s; }
  .dot.on { background: #22c55e; }
  .title { font-size: 15px; opacity: .9; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { padding: 0 16px 10px; display: flex; justify-content: space-between; font-size: 13px; opacity: .65; }
  .pad { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px; padding: 10px 14px 18px; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid #2e2e3a; background: #17171f; color: #eee; border-radius: 14px; font-size: 22px; font-weight: 600; }
  button:active { background: #26263a; transform: scale(.98); }
  .next { grid-row: span 2; background: #232347; font-size: 26px; }
  .black { font-size: 18px; }
  .black.on { background: #000; border-color: #4f46e5; color: #818cf8; }
</style></head><body>
  <div class="top"><span class="dot" id="dot"></span><span class="title" id="title">Mazz 手机遥控</span></div>
  <div class="meta"><span id="pos">— / —</span><span id="clock">00:00</span></div>
  <div class="pad">
    <button id="prev"><svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5L7 12l9 7V5z"/></svg> 上一帧</button>
    <button class="next" id="next">下一帧 <svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5l9 7-9 7V5z"/></svg></button>
    <button class="black" id="black">黑屏</button>
  </div>
<script>
  const $ = (id) => document.getElementById(id);
  let ws, clockSec = 0, clockAt = 0, hbTimer, staleTimer;
  function connect() {
    ws = new WebSocket('ws://' + location.host + '/ws');
    ws.onopen = () => { $('dot').classList.add('on'); hbTimer = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'hb' })), 3000); };
    ws.onclose = () => { $('dot').classList.remove('on'); clearInterval(hbTimer); setTimeout(connect, 1500); }; // 掉线自动重连（心跳即在线的另一半）
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'state') {
        $('title').textContent = m.title || 'Mazz 手机遥控';
        $('pos').textContent = m.presenting ? (m.pos + ' / ' + m.total) : '未在放映';
        clockSec = m.clockSec | 0; clockAt = Date.now();
        $('black').classList.toggle('on', !!m.black);
      }
    };
  }
  setInterval(() => { const s = clockSec + (clockAt ? Math.floor((Date.now() - clockAt) / 1000) : 0);
    $('clock').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000);
  const cmd = (c) => ws && ws.readyState === 1 && ws.send(JSON.stringify({ type: 'cmd', cmd: c }));
  $('next').addEventListener('click', () => cmd('next'));
  $('prev').addEventListener('click', () => cmd('prev'));
  $('black').addEventListener('click', () => cmd('black'));
  connect();
</script></body></html>`;

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of (list || [])) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return '127.0.0.1';
}

class SlideRemote {
  constructor({ bus, win }) {
    this.bus = bus;
    this.win = win;
    this.server = null;
    this.clients = new Map(); // sock -> { lastSeen, buf }
    this.url = null;
    this.lastState = null;
    this._hbSweeper = null;

    bus.handle('slideRemote:start', async () => this.start());
    bus.handle('slideRemote:stop', async () => { await this.stop(); return true; });
    bus.handle('slideRemote:state', async (s) => { this.lastState = { type: 'state', ...s }; this.broadcast(this.lastState); return true; });
    bus.handle('slideRemote:status', async () => ({ running: !!this.server, url: this.url, clients: [...this.clients.values()].filter(c => Date.now() - c.lastSeen < 15000).length }));
  }

  async start() {
    if (this.server) {
      const qr = await this.makeQr();
      return { url: this.url, port: this.port, qr, already: true };
    }
    this.server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(REMOTE_HTML); }
      else { res.writeHead(404); res.end(); }
    });
    this.server.on('upgrade', (req, sock) => {
      if (!req.url.startsWith('/ws')) { sock.destroy(); return; }
      const key = req.headers['sec-websocket-key'];
      if (!key) { sock.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      sock.setNoDelay(true);
      const rec = { lastSeen: Date.now(), buf: Buffer.alloc(0) };
      this.clients.set(sock, rec);
      this.pushClientCount();
      if (this.lastState) sock.write(wsEncodeText(JSON.stringify(this.lastState))); // 补发最新态（晚连手机立即可用）
      sock.on('data', (chunk) => {
        rec.buf = Buffer.concat([rec.buf, chunk]);
        const { msgs, rest } = wsDecode(rec.buf);
        rec.buf = rest;
        for (const m of msgs) {
          if (m.op === 0x8) { this.dropClient(sock); return; }
          if (m.op === 0x9) { sock.write(Buffer.from([0x8a, 0])); continue; } // ping→pong
          if (m.op !== 0x1) continue;
          rec.lastSeen = Date.now();
          let j; try { j = JSON.parse(m.text); } catch { continue; }
          if (j?.type === 'hb') continue; // 应用层心跳：记活即可
          if (j?.type === 'cmd' && CMDS.has(j.cmd)) {
            const w = this.win?.();
            if (w && !w.isDestroyed()) this.bus.send(w, 'slideRemote:cmd', { cmd: j.cmd });
          }
        }
      });
      sock.on('error', () => this.dropClient(sock));
      sock.on('close', () => this.dropClient(sock));
    });
    await new Promise((res, rej) => { this.server.once('error', rej); this.server.listen(0, () => res()); });
    this.port = this.server.address().port;
    this.url = `http://${lanIp()}:${this.port}/`;
    // 心跳清扫：15s 僵死即清（心跳即在线——在线表只数活口）
    this._hbSweeper = setInterval(() => {
      for (const [sock, rec] of [...this.clients]) if (Date.now() - rec.lastSeen > 15000) this.dropClient(sock);
    }, 5000);
    const qr = await this.makeQr();
    return { url: this.url, port: this.port, qr };
  }
  async makeQr() {
    try { const qrcode = require('qrcode'); return await qrcode.toDataURL(this.url, { margin: 1, width: 240 }); }
    catch { return null; }
  }
  broadcast(obj) {
    const buf = wsEncodeText(JSON.stringify(obj));
    for (const [sock] of [...this.clients]) { try { sock.write(buf); } catch { this.dropClient(sock); } }
  }
  pushClientCount() {
    const w = this.win?.();
    if (w && !w.isDestroyed()) this.bus.send(w, 'slideRemote:client', { clients: this.clients.size });
  }
  dropClient(sock) {
    if (!this.clients.has(sock)) return;
    this.clients.delete(sock);
    try { sock.destroy(); } catch {}
    this.pushClientCount();
  }
  async stop() {
    clearInterval(this._hbSweeper); this._hbSweeper = null;
    for (const [sock] of [...this.clients]) this.dropClient(sock);
    try { this.server?.close(); } catch {}
    this.server = null; this.url = null; this.lastState = null;
  }
}
module.exports = SlideRemote;
