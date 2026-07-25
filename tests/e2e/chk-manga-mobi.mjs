// tests/e2e/chk-manga-mobi.mjs —— 图片型 mobi（漫画）提取实证
import { extractMobiImages, imageBytesToDataUrl } from '../../renderer/modules/library/mobi.js';
import { makePng } from './fixtures.mjs';

function w32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; }
function w16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; }

// 造图片型 mobi：r0 + 1 条文本记录 + 3 张 PNG 记录
const title = '测试漫画';
const textBytes = Buffer.from('<html><body><img src="1"/><img src="2"/><img src="3"/></body></html>', 'utf8');
const pngs = [makePng(200, 300, [200, 60, 60]), makePng(200, 300, [60, 200, 60]), makePng(200, 300, [60, 60, 200])];
const numRecords = 1 + 1 + pngs.length;
const headLen = 78 + numRecords * 8;
const head = Buffer.alloc(headLen);
head.write(title, 0, 'utf8');
head.write('BOOK', 60); head.write('MOBI', 64);
head.writeUInt16BE(numRecords, 76);
const titleBytes = Buffer.from(title, 'utf8');
const mobiHeaderLen = 200;
const r0 = Buffer.alloc(16 + mobiHeaderLen + titleBytes.length);
r0.writeUInt16BE(1, 0);
r0.writeUInt32BE(textBytes.length, 4);
r0.writeUInt16BE(1, 8); // textRecCount=1
r0.write('MOBI', 16);
r0.writeUInt32BE(mobiHeaderLen, 20);
r0.writeUInt32BE(65001, 28);
r0.writeUInt32BE(16 + mobiHeaderLen, 84);
r0.writeUInt32BE(titleBytes.length, 88);
titleBytes.copy(r0, 16 + mobiHeaderLen);
const records = [r0, textBytes, ...pngs];
let off = headLen;
for (let i = 0; i < numRecords; i++) { head.writeUInt32BE(off, 78 + i * 8); off += records[i].length; }
const buf = Buffer.concat([head, ...records]);

const imgs = extractMobiImages(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
console.log('提取图片数:', imgs.length, '（应=3）');
console.log('魔数:', imgs.map(i => i.mime).join(', '));
const url = imageBytesToDataUrl(imgs[0].mime, imgs[0].bytes);
console.log('dataURL 头部:', url.slice(0, 30), '长度:', url.length);
const ok = imgs.length === 3 && imgs.every(i => i.mime === 'image/png') && url.startsWith('data:image/png;base64,');
console.log(ok ? '✅ 图片型 mobi 提取实证通过' : '❌ 实证失败');
process.exit(ok ? 0 : 1);
