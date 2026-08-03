// main/torrent-daemon.js —— P2P 边下边播守护（webtorrent 主进程实例 + HTTP range 流端点）
// 核心链：magnet → client.add（fs-chunk-store 落盘到工作区 媒体库/.download/{种子名}/）
// → createServer(127.0.0.1) → file.streamURL（range 206 按需取块=边下边播原生机制）
'use strict';

// node-datachannel（WebRTC 原生，cmake 构建不可用）打桩绕过——主进程只走 TCP/UDP 传统 BT 网，
// WebRTC 桥在本架构里无意义（import 链会同步拉起它，不桩则 import 即死实锤）
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'node-datachannel' || request.includes('node_datachannel.node')) {
    return { RTCPeerConnection: class { constructor() { throw new Error('webrtc-disabled'); } }, default: {} };
  }
  return origLoad.apply(this, arguments);
};

const path = require('path');
const fs = require('fs');

// 公共 tracker 兜底表（实证过可达）：dmhy 系 magnet 全系裸 btih（详情页 grep tr= 为 0 实锤）——
// 纯 DHT 发现在受限网络 60s 拿不到元数据（奈叶新种实锤），注入后同种 70s 内元数据+下载全通
const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.empire-js.us:1337/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
];
/** 裸 magnet 注入公共 tracker；自带 tr= 的不干预 */
function enrichMagnet(magnet) {
  if (!magnet || !magnet.startsWith('magnet:')) return magnet;
  if (/[?&]tr=/.test(magnet)) return magnet;
  return magnet + PUBLIC_TRACKERS.map(t => '&tr=' + encodeURIComponent(t)).join('');
}

class TorrentDaemon {
  constructor({ bus, workspace, session }) {
    this.bus = bus;
    this.workspace = workspace; // () => 当前工作区路径
    this.session = session;
    this.client = null;
    this.server = null;
    this.port = 0;
    this.torrents = new Map(); // infoHash -> { t, addedAt }
    // 启动即过一遍 storeRoot（内含旧 .download→download 一次性合并迁移——不能只等 tor:add，
    // 否则用户不加种子迁移永不触发，工作区树/媒体库扫描继续瞎（真机实锤））
    try { this.storeRoot(); } catch {}
    this.register();
  }

  storeRoot() {
    // 明面化（W44：旧 .download 点目录在工作区树/媒体库扫描里全隐身——用户找不到下载物实锤）。
    // 旧目录一次性合并迁移（rename 同卷零拷贝；.audcache 抽轨缓存不在此列，继续隐身）
    const base = path.join(this.workspace(), '媒体库');
    const legacy = path.join(base, '.download');
    const dir = path.join(base, 'download');
    try {
      if (fs.existsSync(legacy)) {
        fs.mkdirSync(dir, { recursive: true });
        for (const name of fs.readdirSync(legacy)) {
          const from = path.join(legacy, name), to = path.join(dir, name);
          if (!fs.existsSync(to)) { try { fs.renameSync(from, to); } catch {} }
        }
        try { fs.rmSync(legacy, { recursive: true, force: true }); } catch {}
      }
    } catch {}
    return dir;
  }

  async ensureClient() {
    if (this.client) return;
    const { default: WebTorrent } = await import('webtorrent');
    this.client = new WebTorrent({
      dht: true, lsd: true, tracker: true,
      uploadLimit: 100 * 1024, // 上行默认限流（做种本性要说清，全速上行是带宽刺客）
    });
    this.server = this.client.createServer();
    // webtorrent@2.8.5 的 NodeServer 不继承 EventEmitter.once（once is not a function 实锤）——listen 回调即唯一时序锚
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = this.server.address().port;
  }

  streamUrlOf(file) {
    return `http://127.0.0.1:${this.port}${file.streamURL}`;
  }
  statsOf(t) {
    return {
      progress: +(t.progress || 0).toFixed(4),
      downloaded: t.downloaded || 0,
      length: t.length || 0,
      downSpeed: Math.round(t.downloadSpeed || 0),
      upSpeed: Math.round(t.uploadSpeed || 0),
      numPeers: t.numPeers || 0,
      done: !!t.done,
    };
  }
  filesOf(t) {
    return (t.files || []).map(f => ({ path: f.path, name: f.name, length: f.length, streamUrl: this.streamUrlOf(f) }));
  }

  register() {
    const bus = this.bus;
    bus.handle('tor:add', async ({ magnet, name }) => {
      await this.ensureClient();
      if (!magnet || !magnet.startsWith('magnet:')) throw new Error('不是合法的 magnet 链接');
      try { fs.mkdirSync(this.storeRoot(), { recursive: true }); } catch {}
      // 不预查 client.get()：2.8.5 的 get() 对未知 id 也会返回空壳 Torrent（metadata 未启动=files:0 实锤）——
      // add() 本身幂等（同 infoHash 复用），直接 add 才是唯一活口
      const t = this.client.add(enrichMagnet(magnet), { path: this.storeRoot() });
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('元数据获取超时（60s，种子可能无热度）')), 60000);
        // 同 infoHash 复用时元数据已在手——'metadata'/'ready' 不再重发（重复添加挂 60s 实锤），先查即态再挂耳
        if (t.ready || t.info) { clearTimeout(to); resolve(); return; }
        const done = () => { clearTimeout(to); resolve(); };
        t.once('metadata', done);
        t.once('ready', done);
        t.once('error', (e) => { clearTimeout(to); reject(e); });
      });
      this.torrents.set(t.infoHash, { t, addedAt: Date.now(), alias: name || t.name });
      return { infoHash: t.infoHash, name: t.name, files: this.filesOf(t) };
    });
    bus.handle('tor:stats', async ({ infoHash }) => {
      const rec = this.torrents.get(infoHash);
      if (!rec) return null;
      return { infoHash, name: rec.t.name, ...this.statsOf(rec.t) };
    });
    bus.handle('tor:list', async () => {
      return [...this.torrents.values()].map(rec => ({ infoHash: rec.t.infoHash, name: rec.t.name, ...this.statsOf(rec.t) }));
    });
    bus.handle('tor:streamUrl', async ({ infoHash, filePath }) => {
      const rec = this.torrents.get(infoHash);
      if (!rec) return null;
      const f = rec.t.files.find(x => x.path === filePath) || rec.t.files[0];
      return f ? this.streamUrlOf(f) : null;
    });
    bus.handle('tor:filePath', async ({ infoHash, filePath }) => {
      const rec = this.torrents.get(infoHash);
      if (!rec) return null;
      const f = rec.t.files.find(x => x.path === filePath) || rec.t.files[0];
      // f.path 自带种子顶层目录（"Big Buck Bunny/xxx.en.srt"）——再拼 t.name 必双套娃（ENOENT 实锤）
      return f ? path.join(this.storeRoot(), f.path) : null;
    });
    // 按需取文件字节（种子内字幕场景：asyncIterator 逐 piece 拉，小块下完即收，不拖全种）
    bus.handle('tor:fileBytes', async ({ infoHash, filePath }) => {
      const rec = this.torrents.get(infoHash);
      if (!rec) return null;
      const f = rec.t.files.find(x => x.path === filePath);
      if (!f) return null;
      const chunks = [];
      for await (const chunk of f) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    });
    bus.handle('tor:remove', async ({ infoHash, deleteFiles }) => {
      const rec = this.torrents.get(infoHash);
      if (rec) {
        this.torrents.delete(infoHash);
        try { rec.t.destroy({ destroyStore: !!deleteFiles }); } catch {}
      }
      if (deleteFiles && rec?.t?.name) {
        try { fs.rmSync(path.join(this.storeRoot(), rec.t.name), { recursive: true, force: true }); } catch {}
      }
      return true;
    });
  }
}

module.exports = TorrentDaemon;
