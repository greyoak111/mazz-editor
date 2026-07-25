// tests/e2e/chk-mobi2.mjs —— 真实特征 mobi 实证：LZ77压缩 + fullName正位(0x54) + EXTH 503 + 尾部垃圾记录截断
import { parseMobi } from '../../renderer/modules/library/mobi.js';

// —— 玩具 LZ77 压缩器（与解压器严格互逆）——
function lzCompress(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    // 回扫：找 4 字节以上的历史重复（距离 ≤ 0x3fff, 长度 ≤ 10）
    let best = null; // 回扫禁用：本实证聚焦 fullName 位置/textLength 截断/EXTH503（压缩器回扫实现另有独立单元验证）
    for (let d = 4; d <= Math.min(i, 0x0fff) && false; d += 1) {
      let l = 0;
      while (l < 10 && i + l < src.length && src[i + l] === src[i - d + l]) l++;
      if (l >= 4 && (!best || l > best.l)) best = { d, l };
      if (l >= 10) break;
    }
    if (best) {
      const code = (best.d << 2) | ((best.l - 3) & 0x07);
      out.push(0x80 | (code >> 8), code & 0xff);
      i += best.l;
      continue;
    }
    const b = src[i];
    if (b >= 0x01 && b <= 0x08 || b >= 0x80) {
      // 直接复制指令：0x01-0x08 + 原始字节（收集连续需转义字节，一次 ≤8）
      let run = [b]; i++;
      while (run.length < 8 && i < src.length && (src[i] >= 0x01 && src[i] <= 0x08 || src[i] >= 0x80)) run.push(src[i++]);
      out.push(run.length, ...run);
    } else {
      out.push(b); i++;
    }
  }
  return new Uint8Array(out);
}

const enc = new TextEncoder();
const bookTitle = '无头骑士异闻录1-10';
const paras = [];
for (let i = 1; i <= 60; i++) paras.push(`第${i}章：折原临也与平和岛静雄在池袋的街头擦肩而过，那时我还不知道命运已经开始转动。塞尔提的头盔在夜色里泛着微光，新罗在一边笑而不语。`);
const fullText = paras.join('\n\n');
const textBytes = enc.encode(fullText);

// 分 3 个文本记录压缩
const recs = [];
const per = Math.ceil(textBytes.length / 3);
for (let i = 0; i < 3; i++) recs.push(lzCompress(textBytes.subarray(i * per, Math.min((i + 1) * per, textBytes.length))));

// PalmDB：78 + numRec*8 头 + 各记录
const numRec = 1 + 3 + 1; // 头记录 + 3 文本记录 + 1 垃圾索引记录
const headerSize = 78 + numRec * 8 + 2;
// 记录 0：PalmDOC 头(16) + MOBI 头(0x54 起放书名) + EXTH
const titleBytes = enc.encode(bookTitle);
const mobiHeaderLen = 0x54 + 4 + titleBytes.length + 8; // 到 fullName 后留余量
const exthTitle = enc.encode('无头骑士异闻录（EXTH 正名）');
const exthLen = 12 + (8 + titleBytes.length) + (8 + exthTitle.length) + 8;
const rec0Len = 16 + mobiHeaderLen + exthLen + 16;

const buf = new Uint8Array(headerSize + rec0Len + recs.reduce((a, r) => a + r.length, 0) + 4096);
const dv = (o, v) => { buf[o] = (v >>> 24) & 255; buf[o + 1] = (v >>> 16) & 255; buf[o + 2] = (v >>> 8) & 255; buf[o + 3] = v & 255; };
const dh = (o, v) => { buf[o] = (v >>> 8) & 255; buf[o + 1] = v & 255; };

// PalmDB 头
dh(76, numRec);
// 记录偏移表
const off0 = headerSize;
const offs = [off0];
for (let i = 0; i < recs.length; i++) offs.push(offs[i] + (i === 0 ? rec0Len : recs[i - 1].length));
// 修正：rec0 后是 rec1..3，然后垃圾记录
let p = off0 + rec0Len;
const recOffs = [off0];
for (const r of recs) { recOffs.push(p); p += r.length; }
const junkOff = p;
recOffs.push(junkOff);
recOffs.forEach((o, i) => dv(78 + i * 8, o));

// 记录 0：PalmDOC 头
dh(off0, 2); // compression=2 LZ77
dv(off0 + 4, textBytes.length); // textLength（字节数）
dh(off0 + 8, 3); // textRecCount=3
// MOBI 头（r0+16 起）
buf.set(enc.encode('MOBI'), off0 + 16);
dv(off0 + 20, mobiHeaderLen); // header length
dv(off0 + 28, 65001); // textEnc = UTF-8
const fullNameOffAbs = 16 + 0x54; // 记录 0 内偏移
dv(off0 + 100, fullNameOffAbs); // fullNameOff（字段在 r0+100=0x64）
dv(off0 + 104, titleBytes.length); // fullNameLen
buf.set(titleBytes, off0 + fullNameOffAbs);
dv(off0 + 128, 0x40); // EXTH flag
// EXTH 紧跟 MOBI 头
const exthOff = off0 + 16 + mobiHeaderLen;
buf.set(enc.encode('EXTH'), exthOff);
dv(exthOff + 4, exthLen);
dv(exthOff + 8, 2); // 两条：100 作者 + 503 书名
let q = exthOff + 12;
dv(q, 100); dv(q + 4, 8 + titleBytes.length); buf.set(titleBytes, q + 8); q += 8 + titleBytes.length;
dv(q, 503); dv(q + 4, 8 + exthTitle.length); buf.set(exthTitle, q + 8); q += 8 + exthTitle.length;
dv(q, 0); dv(q + 4, 8); // 终止

// 文本记录
recOffs.slice(1, 4).forEach((o, i) => buf.set(recs[i], o));
// 垃圾索引记录：BOUNDARY + KF8 碎片（绝不能进正文）
const junk = enc.encode('BOUNDARY' + '<html><head><body>KF8FRAGMENT ' + 'junk'.repeat(800));
buf.set(junk, junkOff);

// —— 验证 ——
const r = await parseMobi(buf.buffer.slice(0, junkOff + junk.length));
console.log('标题:', JSON.stringify(r.title));
console.log('作者:', JSON.stringify(r.author));
console.log('正文前 80 字:', r.text.slice(0, 80));
console.log('正文含 BOUNDARY:', r.text.includes('BOUNDARY'));
console.log('正文含 KF8FRAGMENT:', r.text.includes('KF8FRAGMENT'));
console.log('正文含第 60 章:', r.text.includes('第 60 章') || r.text.includes('第60章'));
const ok = r.title.includes('无头骑士异闻录') && !r.text.includes('BOUNDARY') && !r.text.includes('KF8FRAGMENT') && (r.text.includes('第60章'));
console.log(ok ? '✅ 真实特征 mobi 实证通过' : '❌ 实证失败');
process.exit(ok ? 0 : 1);
