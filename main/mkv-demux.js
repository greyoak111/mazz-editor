// main/mkv-demux.js —— 轻量 Matroska 解复用（自研 EBML-lite：轨道枚举 + 全编码音轨抽帧自封装）
// 路线判定背景：Chromium 在本代完全不给 audioTracks API（mkv/mp4 全灭实锤）——多音轨只能自解复用。
// 设计：流式游标分片读（GB 级 BDRIP 不整读内存），轨道表枚举（编号/编码/语言/轨名/CodecPrivate），
// 指定音轨抽帧（带 Cluster 绝对时间码）；按编码自封装可播容器：
//   FLAC → STREAMINFO+帧原样拼接（.flac）；Vorbis → Ogg 三段头+帧页（granule=tc×rate/1000）；
//   AAC → AudioSpecificConfig 译 ADTS 7 字节头（.aac）；Opus → OpusHead+自制 OpusTags（granule=tc×48）。
'use strict';
const fs = require('fs');

const IDS = {
  EBML: 0x1A45DFA3, Segment: 0x18538067, Info: 0x1549A966, Tracks: 0x1654AE6B,
  TrackEntry: 0xAE, TrackNumber: 0xD7, TrackUID: 0x73C5, TrackType: 0x83, CodecID: 0x86,
  Language: 0x22B59C, Name: 0x536E, CodecPrivate: 0x63A2,
  Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1,
};

// —— 分片游标（GB 级文件不整读：按 4MB 片滚动，游标前进才补片） ——
class Cursor {
  constructor(fd, fileSize, chunkSize = 4 * 1024 * 1024) {
    this.fd = fd;
    this.size = fileSize;
    this.chunkSize = chunkSize;
    this.buf = Buffer.alloc(0);
    this.bufStart = 0;
    this.pos = 0;
  }
  _fill(to) {
    if (to <= this.bufStart + this.buf.length) return;
    const need = to - this.bufStart;
    const readAt = this.bufStart + this.buf.length;
    const want = Math.max(this.chunkSize, need);
    const len = Math.min(want, this.size - readAt);
    if (len <= 0) return;
    const nb = Buffer.alloc(len);
    fs.readSync(this.fd, nb, 0, len, readAt);
    this.buf = Buffer.concat([this.buf, nb]);
  }
  read(n) {
    if (this.pos + n > this.size) n = this.size - this.pos;
    this._fill(this.pos + n - this.bufStart + 1);
    const off = this.pos - this.bufStart;
    if (off + n > this.buf.length) throw new Error('EOF');
    const out = this.buf.slice(off, off + n);
    this.pos += n;
    // 游标走过半片即释放前段（内存恒定在两片内）
    if (off > this.chunkSize) { this.buf = this.buf.slice(off); this.bufStart = this.pos; }
    return out;
  }
  skip(n) { this.pos = Math.min(this.size, this.pos + n); if (this.pos - this.bufStart > this.chunkSize) { this.buf = this.buf.slice(this.pos - this.bufStart); this.bufStart = this.pos; } }
}

/** EBML varint：首字节前导 1 位定长（1-8 字节）；keepMarker=false 时剥前导位取值 */
function readVint(cur, { keepMarker = false } = {}) {
  const b0 = cur.read(1)[0];
  if (b0 === 0) throw new Error('EBML 非法 varint（首字节为 0）');
  let len = 1;
  while (len <= 8 && !(b0 & (0x80 >>> (len - 1)))) len++;
  if (len > 8) throw new Error('EBML varint 超 8 字节');
  const bytes = Buffer.concat([Buffer.from([b0]), cur.read(len - 1)]);
  let value = 0n;
  if (keepMarker) {
    for (const b of bytes) value = (value << 8n) | BigInt(b);
  } else {
    value = BigInt(b0 & (0xff >>> len));
    for (let i = 1; i < len; i++) value = (value << 8n) | BigInt(bytes[i]);
  }
  // 全 1 = 未知长度（unknown-size）
  const allOnes = (1n << BigInt(7 * len)) - 1n;
  return { value, length: len, unknown: !keepMarker && value === allOnes, raw: bytes };
}

function readId(cur) {
  const b0 = cur.read(1)[0];
  let len = 1;
  while (len <= 4 && !(b0 & (0x80 >>> (len - 1)))) len++;
  const bytes = Buffer.concat([Buffer.from([b0]), cur.read(len - 1)]);
  let value = 0;
  for (const b of bytes) value = (value << 8) | b;
  return value;
}

/** 读一个元素头 → {id, size(null=未知), headerLen}；数据起点随即可读 */
function readElementHeader(cur) {
  const id = readId(cur);
  const sz = readVint(cur);
  return { id, size: sz.unknown ? null : Number(sz.value), headerLen: null };
}

function elementChildren(cur, size, cb) {
  const end = cur.pos + size;
  while (cur.pos < end) {
    const start = cur.pos;
    const h = readElementHeader(cur);
    const dataSize = h.size == null ? end - cur.pos : h.size;
    const keep = cb(h.id, () => cur.read(dataSize), start, dataSize);
    if (keep === false) return;
    if (h.size == null) break;
  }
}

/** 解析轨道表 → [{index(文件内序), trackNumber, type(2=audio/1=video), codecId, language, name, codecPrivate}] */
function parseTracks(fd, fileSize) {
  const cur = new Cursor(fd, fileSize);
  // EBML 头
  const ebml = readElementHeader(cur);
  if (ebml.id !== IDS.EBML) throw new Error('不是 Matroska（EBML 头缺失）');
  cur.skip(ebml.size ?? 0);
  const seg = readElementHeader(cur);
  if (seg.id !== IDS.Segment) throw new Error('不是 Matroska（Segment 缺失）');
  const segEnd = seg.size == null ? fileSize : cur.pos + seg.size;
  const tracks = [];
  let info = null;
  while (cur.pos < segEnd) {
    const h = readElementHeader(cur);
    if (h.id === IDS.Tracks) {
      const data = cur.read(h.size);
      parseTracksSection(data, tracks);
    } else if (h.id === IDS.Info) {
      info = cur.read(h.size);
    } else {
      cur.skip(h.size ?? 0);
      if (h.size == null) break;
    }
    if (tracks.length) break; // 拿到轨道表即停（抽帧阶段再扫 Cluster）
  }
  return tracks;
}

function parseTracksSection(data, tracks) {
  const cur = new Cursor(-1, 0);
  cur.buf = data; cur.bufStart = 0; cur.pos = 0; cur.size = data.length; cur.fd = -1;
  cur._fill = () => {};
  elementChildren(cur, data.length, (id, read) => {
    if (id !== IDS.TrackEntry) { read(); return true; }
    const entry = read();
    const e2 = new Cursor(-1, 0);
    e2.buf = entry; e2.pos = 0; e2.size = entry.length; e2._fill = () => {};
    const t = { index: tracks.length, codecPrivate: null };
    elementChildren(e2, entry.length, (id2, read2) => {
      const d = read2();
      if (id2 === IDS.TrackNumber) t.trackNumber = Number(beInt(d));
      else if (id2 === IDS.TrackType) t.type = Number(beInt(d));
      else if (id2 === IDS.CodecID) t.codecId = d.toString('latin1');
      else if (id2 === IDS.Language) t.language = d.toString('utf8');
      else if (id2 === IDS.Name) t.name = d.toString('utf8');
      else if (id2 === IDS.CodecPrivate) t.codecPrivate = d;
      return true;
    });
    tracks.push(t);
    return true;
  });
}

function beInt(buf) { let v = 0n; for (const b of buf) v = (v << 8n) | BigInt(b); return v; }

/** 从块内剥帧：track(vint) + timecode(2) + flags(1) → 帧组（按 lacing 解） */
function parseBlockFrames(block) {
  let pos = 0;
  const b0 = block[pos];
  let tLen = 1;
  while (tLen <= 8 && !(b0 & (0x80 >>> (tLen - 1)))) tLen++;
  const trackVint = block.slice(0, tLen);
  let track = 0;
  for (const b of trackVint) track = (track << 8) | b;
  // EBML vint 语义：剥长度标记位取值（SimpleBlock 轨号 0x82=轨2——不剥必误成 130（抽帧全空实锤）
  track = track & ((1 << (7 * tLen)) - 1);
  pos = tLen;
  const timecode = block.readInt16BE(pos); pos += 2;
  const flags = block[pos]; pos += 1;
  const lacing = (flags & 0b00000110) >> 1;
  const frames = [];
  if (lacing === 0) {
    frames.push(block.slice(pos));
  } else {
    const count = block[pos] + 1; pos += 1;
    const sizes = [];
    if (lacing === 1) { // Xiph
      let off = pos;
      for (let i = 0; i < count - 1; i++) {
        let sz = 0, b;
        do { b = block[off++]; sz += b; } while (b === 255);
        sizes.push(sz);
      }
      pos = off;
    } else if (lacing === 3) { // EBML lacing
      let off = pos;
      const readSz = () => {
        const b = block[off];
        let l = 1;
        while (l <= 8 && !(b & (0x80 >>> (l - 1)))) l++;
        let v = block[off] & (0xff >>> l);
        for (let i = 1; i < l; i++) v = (v << 8) | block[off + i];
        off += l;
        return v;
      };
      let prev = readSz();
      sizes.push(prev);
      for (let i = 1; i < count - 1; i++) {
        const b = block[off];
        const neg = (b & 0x40) !== 0;
        const mag = b & 0x3f;
        const delta = (neg ? -1 : 1) * mag;
        prev += delta;
        off += 1;
        sizes.push(prev);
      }
      pos = off;
    } else { // lacing === 2 固定长
      const total = block.length - pos;
      const each = Math.floor(total / count);
      for (let i = 0; i < count; i++) sizes.push(each);
    }
    for (const sz of sizes) { frames.push(block.slice(pos, pos + sz)); pos += sz; }
  }
  return { track, timecode, frames };
}

/**
 * 枚举 mkv 轨道
 * @returns {{tracks: Array}}
 */
function listTracks(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    return { tracks: parseTracks(fd, fileSize) };
  } finally { fs.closeSync(fd); }
}

/**
 * 抽指定音轨全部帧（带时间码，封装器要拿 tc 算 granule）
 * @returns {{frames:Array<{buf:Buffer,tc:number}>, codecPrivate:Buffer|null, lastTc:number}|null}
 */
function extractFrames(filePath, trackNumber) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const tracks = parseTracks(fd, fileSize);
    const target = tracks.find(t => t.trackNumber === trackNumber && t.type === 2);
    if (!target) return null;
    const cur = new Cursor(fd, fileSize);
    const ebml = readElementHeader(cur); cur.skip(ebml.size ?? 0);
    const seg = readElementHeader(cur);
    const segEnd = seg.size == null ? fileSize : cur.pos + seg.size;
    const framesOut = [];
    while (cur.pos < segEnd) {
      // 容错：垃圾段/Void/损坏数据读出非法头时跳过该 Cluster 剩余（「EBML 非法 varint（首字节为0）」炸通道实锤）——
      // 已抽到的帧保留，抽轨不该因一个坏 Cluster 全灭
      let h;
      try { h = readElementHeader(cur); } catch { break; }
      if (h.id !== IDS.Cluster) {
        if (h.size == null) break;
        try { cur.skip(h.size ?? 0); } catch { break; }
        continue;
      }
      const cEnd = h.size == null ? segEnd : cur.pos + h.size;
      let clusterTc = 0; // SimpleBlock 时间码是 Cluster 相对值（TimecodeScale 默认 1ms）——granule 要绝对值
      while (cur.pos < cEnd) {
        let bh;
        try { bh = readElementHeader(cur); } catch { cur.pos = cEnd; break; } // 坏块：弃本 Cluster 剩余，续下一 Cluster
        if (bh.id === IDS.Timecode) {
          clusterTc = Number(beInt(cur.read(bh.size)));
        } else if (bh.id === IDS.SimpleBlock) {
          const block = cur.read(bh.size);
          const { track, timecode, frames } = parseBlockFrames(block);
          if (track === trackNumber) for (const f of frames) framesOut.push({ buf: f, tc: clusterTc + timecode });
        } else if (bh.id === IDS.BlockGroup) {
          const bgEnd = cur.pos + bh.size;
          while (cur.pos < bgEnd) {
            let b2;
            try { b2 = readElementHeader(cur); } catch { cur.pos = bgEnd; break; }
            if (b2.id === IDS.Block) {
              const block = cur.read(b2.size);
              const { track, timecode, frames } = parseBlockFrames(block);
              if (track === trackNumber) for (const f of frames) framesOut.push({ buf: f, tc: clusterTc + timecode });
            } else {
              try { cur.skip(b2.size ?? 0); } catch { cur.pos = bgEnd; break; }
            }
          }
        } else {
          try { cur.skip(bh.size ?? 0); } catch { cur.pos = cEnd; break; }
        }
      }
      if (framesOut.length > 4000) break; // 超大文件兜底（防内存爆：单集音轨帧数千级以内正常）
    }
    if (!framesOut.length) return null;
    return { frames: framesOut, codecPrivate: target.codecPrivate, lastTc: framesOut[framesOut.length - 1].tc };
  } finally { fs.closeSync(fd); }
}

// —— Ogg 封装（Vorbis/Opus 共用）：页 = 27B 头 + 段表 + 数据；CRC32 多项式 0x04c11db7，无反射、初值 0、不异或 ——
const OGG_CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();
function oggCrc(buf) {
  let crc = 0;
  for (const b of buf) crc = (((crc << 8) & 0xffffffff) ^ OGG_CRC_T[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}
/** 造一页 Ogg：packets 全量包容（段表 255 切段，恰好整除补 0 长段收尾），granule=样本钟 */
function oggPage({ packets, granule, serial, seq, bos = false, eos = false }) {
  const segs = [];
  for (const p of packets) {
    for (let off = 0; off < p.length; off += 255) segs.push(Math.min(255, p.length - off));
    if (p.length % 255 === 0) segs.push(0);
  }
  if (segs.length > 255) throw new Error('ogg 页段表溢出（单页最多 255 段）');
  const head = Buffer.alloc(27 + segs.length);
  head.write('OggS', 0, 'latin1');
  head[4] = 0;
  head[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
  head.writeBigUInt64LE(BigInt(Math.max(0, Math.round(granule))), 6);
  head.writeUInt32LE(serial >>> 0, 14);
  head.writeUInt32LE(seq >>> 0, 18);
  head.writeUInt32LE(0, 22); // CRC 先置 0 再算
  head[26] = segs.length;
  segs.forEach((s, i) => { head[27 + i] = s; });
  const page = Buffer.concat([head, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

/** MKV Vorbis CodecPrivate：首字节=包数-1（=2），随后两个 Xiph lace 长度，再三包头（识别/注释/配置）拼接 */
function splitVorbisPrivate(cp) {
  let off = 1;
  const readLace = () => { let v = 0, b; do { b = cp[off++]; v += b; } while (b === 255); return v; };
  const l1 = readLace(), l2 = readLace();
  const h1 = cp.slice(off, off + l1); off += l1;
  const h2 = cp.slice(off, off + l2); off += l2;
  return { h1, h2, h3: cp.slice(off) };
}
/** Vorbis → Ogg：h1（BOS 页）→ h2+h3 → 帧页（granule=tc×rate/1000，ms→样本） */
function muxVorbis(frames, cp) {
  const { h1, h2, h3 } = splitVorbisPrivate(cp);
  const rate = h1.length >= 16 ? h1.readUInt32LE(12) : 44100; // 0x01+'vorbis'(6)+ver(4)+ch(1)+rate(4)
  const serial = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const pages = [
    oggPage({ packets: [h1], granule: 0, serial, seq: 0, bos: true }),
    oggPage({ packets: [h2, h3], granule: 0, serial, seq: 1 }),
  ];
  let seq = 2;
  frames.forEach((f, i) => {
    pages.push(oggPage({
      packets: [f.buf],
      granule: Math.round((f.tc || 0) * rate / 1000),
      serial, seq: seq++, eos: i === frames.length - 1,
    }));
  });
  return Buffer.concat(pages);
}
/** Opus → Ogg：CodecPrivate 即完整 OpusHead（含魔法串）；自制 OpusTags；granule=tc×48（恒定 48kHz 钟） */
function muxOpus(frames, cp) {
  const vendor = Buffer.from('mazz-ebml-lite', 'latin1');
  const vlen = Buffer.alloc(4); vlen.writeUInt32LE(vendor.length, 0);
  const tags = Buffer.concat([Buffer.from('OpusTags', 'latin1'), vlen, vendor, Buffer.alloc(4)]);
  const serial = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const pages = [
    oggPage({ packets: [cp], granule: 0, serial, seq: 0, bos: true }),
    oggPage({ packets: [tags], granule: 0, serial, seq: 1 }),
  ];
  let seq = 2;
  frames.forEach((f, i) => {
    pages.push(oggPage({
      packets: [f.buf],
      granule: Math.round((f.tc || 0) * 48),
      serial, seq: seq++, eos: i === frames.length - 1,
    }));
  });
  return Buffer.concat(pages);
}
/** AAC → ADTS：AudioSpecificConfig 译 7 字节头（profile=对象类型-1，无 CRC） */
function muxAac(frames, cp) {
  const objType = cp.length >= 1 ? (cp[0] >> 3) & 0x1f : 2;
  const sfIdx = cp.length >= 2 ? (((cp[0] & 0x07) << 1) | (cp[1] >> 7)) : 4; // 4=44100 兜底
  const chan = cp.length >= 2 ? ((cp[1] >> 3) & 0x0f) : 2;
  const profile = Math.max(0, objType - 1) & 0x03;
  const parts = [];
  for (const f of frames) {
    const len = f.buf.length + 7;
    const h = Buffer.alloc(7);
    h[0] = 0xff; h[1] = 0xf1; // sync12 + ID=0(MPEG-4) + layer00 + protection_absent=1
    h[2] = ((profile << 6) | (sfIdx << 2) | (chan >> 2)) & 0xff;
    h[3] = (((chan & 3) << 6) | ((len >> 11) & 0x03)) & 0xff;
    h[4] = (len >> 3) & 0xff;
    h[5] = (((len & 7) << 5) | 0x1f) & 0xff;
    h[6] = 0xfc;
    parts.push(h, f.buf);
  }
  return Buffer.concat(parts);
}

// —— 编码 → 封装器分派表（FLAC 直通 .flac / Vorbis·Opus 走 Ogg / AAC 走 ADTS） ——
const TRACK_MUXERS = [
  { re: /^A_FLAC/i, ext: 'flac', mux: (frames, cp) => Buffer.concat([cp || Buffer.alloc(0), ...frames.map(f => f.buf)]) },
  { re: /^A_VORBIS/i, ext: 'ogg', mux: muxVorbis },
  { re: /^A_AAC/i, ext: 'aac', mux: muxAac },
  { re: /^A_OPUS/i, ext: 'ogg', mux: muxOpus },
];

/**
 * 抽指定音轨并按编码自封装为可播容器
 * @returns {{ext:string, buf:Buffer, codecId:string}|null} 不支持编码/找不到轨/无帧返回 null
 */
function extractTrack(filePath, trackNumber) {
  const { tracks } = listTracks(filePath);
  const target = tracks.find(t => t.trackNumber === trackNumber && t.type === 2);
  if (!target) return null;
  const mx = TRACK_MUXERS.find(m => m.re.test(target.codecId || ''));
  if (!mx) return null;
  const ex = extractFrames(filePath, trackNumber);
  if (!ex || !ex.frames.length) return null;
  return { ext: mx.ext, buf: mx.mux(ex.frames, ex.codecPrivate || Buffer.alloc(0), ex.lastTc || 0), codecId: target.codecId };
}

/**
 * 抽指定 FLAC 音轨为原始流（STREAMINFO+帧拼接 → .flac）——w24 通道兼容壳
 * @returns {Buffer|null} 不可抽（非 FLAC/找不到轨）返回 null
 */
function extractFlacTrack(filePath, trackNumber) {
  const r = extractTrack(filePath, trackNumber);
  return r && r.ext === 'flac' ? r.buf : null;
}

module.exports = { listTracks, extractFlacTrack, extractTrack, extractFrames, muxVorbis, muxAac, muxOpus, oggPage, oggCrc, IDS };
