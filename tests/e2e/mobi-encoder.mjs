// tests/e2e/mobi-encoder.mjs —— 最小合法 MOBI 编码器（PalmDB + PalmDOC 头 + 无压缩文本记录）
// 用途：书库 mobi 解析器的真实样本制造（小说 UTF-8 / GBK 虚标两种）

function w32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; }
function w16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; }

/**
 * 生成最小 MOBI（compression=1 无压缩）
 * @param {object} o { title, text, encoding: 65001|936, mislabel?: boolean }
 *   mislabel=true 时 textEnc 写 936 但内容仍是 UTF-8（虚标场景，考验语言命中率嗅探）
 */
export function makeMobi({ title, text, encoding = 65001, mislabel = false }) {
  const textBytes = Buffer.from(text, 'utf8');
  const REC = 4096;
  const nRec = Math.max(1, Math.ceil(textBytes.length / REC));
  const numRecords = 1 + nRec;

  // —— PalmDB 头（78 + 8*numRecords） ——
  const headLen = 78 + numRecords * 8;
  const head = Buffer.alloc(headLen);
  head.write(title.slice(0, 28), 0, 'utf8');
  head.writeUInt16BE(0, 32); head.writeUInt16BE(0, 34);
  head.writeUInt32BE(1700000000, 36); head.writeUInt32BE(1700000000, 40);
  head.write('BOOK', 60); head.write('MOBI', 64);
  head.writeUInt32BE(1, 68); head.writeUInt16BE(numRecords, 76);

  // —— 记录 0（PalmDOC 16B + MOBI 头） ——
  const titleBytes = Buffer.from(title, 'utf8');
  const mobiHeaderLen = 200; // 到 fullName 之前的占位
  const r0 = Buffer.alloc(16 + mobiHeaderLen + titleBytes.length);
  r0.writeUInt16BE(1, 0);                       // compression = 1 无压缩
  r0.writeUInt32BE(textBytes.length, 4);        // textLength
  r0.writeUInt16BE(nRec, 8);                    // textRecCount
  r0.writeUInt16BE(REC, 10);                    // recordSize
  r0.write('MOBI', 16);                         // magic（r0+16）
  r0.writeUInt32BE(mobiHeaderLen, 20);          // headerLength（r0+20）
  r0.writeUInt32BE(0, 24);                      // mobiType
  r0.writeUInt32BE(mislabel ? 936 : encoding, 28); // textEnc（r0+28）
  r0.writeUInt32BE(16 + mobiHeaderLen, 84);     // fullNameOff（r0+84）
  r0.writeUInt32BE(titleBytes.length, 88);      // fullNameLen（r0+88）
  r0.writeUInt32BE(0, 128);                     // exthFlag = 0（r0+128）
  titleBytes.copy(r0, 16 + mobiHeaderLen);

  // —— 文本记录 ——
  const records = [r0];
  for (let i = 0; i < nRec; i++) records.push(textBytes.subarray(i * REC, (i + 1) * REC));

  // —— 记录偏移表 ——
  let off = headLen;
  for (let i = 0; i < numRecords; i++) {
    head.writeUInt32BE(off, 78 + i * 8);
    off += records[i].length;
  }
  return Buffer.concat([head, ...records]);
}
