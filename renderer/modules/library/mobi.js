// renderer/modules/library/mobi.js —— MOBI / AZW3 解析（自研：PalmDB + PalmDOC LZ77 + KF8 文本提取）
// 覆盖：经典 mobi（PalmDOC 无压缩/LZ77）；azw3/KF8 走记录文本抽取（新版复杂流建议转 epub）

function rU16(v, o) { return (v[o] << 8) | v[o + 1]; }
function rU32(v, o) { return ((v[o] << 24) | (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3]) >>> 0; }
function rStr(v, o, len, dec) {
  const bytes = v.subarray(o, o + len);
  return dec.decode(bytes).replace(/\0.*$/g, '');
}

/** PalmDOC LZ77 解压 */
export function lz77(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i++];
    if (c >= 0x01 && c <= 0x08) {
      // 直接复制 c 个字节
      for (let j = 0; j < c && i < src.length; j++) out.push(src[i++]);
    } else if (c < 0x80) {
      out.push(c);
    } else if (c >= 0xc0) {
      // 0xC0-0xFF：空格 + (c & 0x7f) 字面字符（不再多消费字节）
      out.push(0x20);
      out.push(c & 0x7f);
    } else {
      // 0x80-0xbf：距离+长度
      if (i >= src.length) break;
      const c2 = src[i++];
      let dist = ((c & 0x3f) << 8) | c2;
      dist = (dist & 0x3fff) >>> 2;
      let len = (c2 & 0x07) + 3;
      const from = out.length - dist;
      for (let j = 0; j < len; j++) out.push(out[from + j]);
    }
  }
  return new Uint8Array(out);
}

const decUtf8 = new TextDecoder('utf-8');
const dec1252 = (() => { try { return new TextDecoder('windows-1252'); } catch { return decUtf8; } })();
const mkDec = (label) => { try { return new TextDecoder(label); } catch { return null; } };
// MOBI textEnc → 解码器（国产老书常见 GBK=936/54936，此前一律 1252 导致乱码）
function decoderFor(textEnc) {
  switch (textEnc) {
    case 65001: return decUtf8;
    case 1252: return dec1252;
    case 936: case 54936: return mkDec('gbk') || dec1252;
    case 950: return mkDec('big5') || dec1252;
    case 932: return mkDec('shift-jis') || dec1252;
    default: return dec1252;
  }
}
/** 编码嗅探：FFFD 只是初筛——GBK 解 UTF-8 几乎不产生 U+FFFD 但通篇生僻字（v33 后残存乱码的真凶），
 *  必须用常用汉字命中率定胜负：真实文本高频字成串，错解文本全是生僻字 */
const COMMON_HAN = '的一是不了人我在有他这中大来上国个说们为子和你地出道也时年得就那都要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与新高意进法此月正世点';
const COMMON_PUNCT = '，。！？；：、“”‘’（）《》…—';
function langScore(sample) {
  let han = 0, punct = 0;
  for (const ch of COMMON_HAN) han += sample.split(ch).length - 1;
  for (const ch of COMMON_PUNCT) punct += sample.split(ch).length - 1;
  return han + punct * 2;
}
function sniffDecode(bytes, preferred) {
  const candidates = [preferred, decUtf8, mkDec('gbk'), dec1252].filter((d, i, a) => d && a.indexOf(d) === i);
  let best = null, bestScore = -Infinity;
  for (const d of candidates) {
    const sample = d.decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    const fffd = (sample.match(/�/g) || []).length;
    const score = langScore(sample) - fffd * 200; // FFFD 重罚，语言命中定胜负
    if (score > bestScore) { bestScore = score; best = sample; }
  }
  return best ?? decUtf8.decode(bytes);
}

/** 剥 KF8/HTML 标签为纯文本 */
export function stripMarkup(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 解析 MOBI/AZW3 二进制 → {title, author, text}（自研经典 MOBI 内核）
 * @param {ArrayBuffer} buf
 */
export function parseMobiClassic(buf) {
  const v = new Uint8Array(buf);
  if (v.length < 78) throw new Error('文件太小，不是合法 MOBI');
  const numRec = rU16(v, 76);
  if (!numRec || numRec > 40000) throw new Error('记录数异常，不是合法 MOBI');
  // 记录偏移表
  const recOff = [];
  for (let i = 0; i < numRec; i++) {
    const o = 78 + i * 8;
    if (o + 4 > v.length) break;
    recOff.push(rU32(v, o));
  }
  if (!recOff.length || recOff[0] + 16 > v.length) throw new Error('记录表损坏');
  // MOBI 头（记录 0）
  const r0 = recOff[0];
  const magic = rStr(v, r0 + 16, 4, decUtf8);
  if (magic !== 'MOBI') throw new Error('缺少 MOBI 头（可能是纯 PalmDOC）');
  const textEnc = rU32(v, r0 + 28);
  const dec = decoderFor(textEnc);
  // fullName 在 MOBI 头内偏移 0x54/0x58（从 'MOBI' magic 起）= 记录 0 内 r0+16+0x54/0x58
  // 此前误用 r0+84/88（=MOBI 头内 0x44/0x48 huffman 字段）——真实 mobi 标题全乱码的根因
  const fullNameOff = rU32(v, r0 + 100);
  const fullNameLen = rU32(v, r0 + 104);
  // 标题同样过嗅探：textEnc 虚标时声明解码器必乱码（虚标集实锤）
  let title = fullNameOff && fullNameLen && r0 + fullNameOff + fullNameLen <= v.length
    ? sniffDecode(v.subarray(r0 + fullNameOff, r0 + fullNameOff + fullNameLen), dec).replace(/\0.*$/g, '') : '';
  // PalmDOC 头
  const compression = rU16(v, r0);
  const textLength = rU32(v, r0 + 4);
  const textRecCount = rU16(v, r0 + 8);
  // EXTH 作者/标题（若存在；EXTH 的 503=书名比 fullName 更可靠）
  let author = '';
  const exthFlag = rU32(v, r0 + 128);
  if (exthFlag & 0x40) {
    const mobiHeaderLen = rU32(v, r0 + 20);
    const exthOff = r0 + 16 + mobiHeaderLen;
    if (rStr(v, exthOff, 4, decUtf8) === 'EXTH') {
      const exthLen = rU32(v, exthOff + 4);
      const exthCount = rU32(v, exthOff + 8);
      let p = exthOff + 12;
      for (let i = 0; i < exthCount && p + 8 < exthOff + exthLen; i++) {
        const type = rU32(v, p), len = rU32(v, p + 4);
        if (type === 100 && len > 8 && !author) author = rStr(v, p + 8, len - 8, dec);
        if (type === 503 && len > 8) { // EXTH 书名：真书以此为正（fullName 字段错位乱码实锤）
          const t = sniffDecode(v.subarray(p + 8, p + len), dec).replace(/\0.*$/g, '').trim();
          if (t) title = t;
        }
        if (author && title) break;
        p += len;
      }
    }
  }
  // 文本记录：1..textRecCount
  if (compression !== 1 && compression !== 2) throw new Error('不支持的压缩格式（' + compression + '，HUFF/CDIC 建议转 epub）');
  // 先拼字节再统一解码：多字节字符（UTF-8/GBK）可能跨 4KB 记录边界，
  // 逐条 decode 会把边界字符切成 U+FFFD（v33 实测乱码根因之一）
  const chunks = [];
  let total = 0;
  for (let i = 1; i <= textRecCount && i < recOff.length; i++) {
    const s = recOff[i], e = i + 1 < recOff.length ? recOff[i + 1] : v.length;
    if (s >= e || s >= v.length) break;
    let rec = v.subarray(s, Math.min(e, v.length));
    // 去尾部多余字节（压缩记录尾部有标记位）
    if (compression === 2) rec = lz77(rec);
    chunks.push(rec);
    total += rec.length;
  }
  if (!chunks.length) throw new Error('未解析到文本记录');
  let allBytes = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { allBytes.set(c, pos); pos += c.length; }
  // 先按 PalmDOC 声明的 textLength 在**字节域**截断再解码——
  // 文本记录之后的索引/KF8 碎片记录绝不能进解码器（真实 azw3 正文残渣的总根；
  // 此前先解码再按字符数 slice：垃圾全混进正文 + UTF-8 字节数≠字符数双重错位）
  if (textLength && textLength < allBytes.length) allBytes = allBytes.slice(0, textLength);
  // textEnc 可能虚标：乱码率嗅探取最优解码
  let text = sniffDecode(allBytes, dec);
  text = text.replace(/[\0\x00-\x08\x0b\x0c\x0e-\x1f]+$/g, '');
  return { title: title || '未命名', author, text: stripMarkup(text) };
}

/**
 * 残渣率嗅探：正文是 HTML 碎片（KF8 拆碎原始流）还是可读文本。
 * KF8 未按 skeleton/fragment 拼装时，正文全是 `body>` `4444854"/>` 式碎渣——
 * 特征：`>`/引号/超长数字串密度异常（真实文本这些极少成串出现）。
 */
function junkScore(text) {
  if (!text) return 1;
  const sample = text.slice(0, 20000);
  const gt = (sample.match(/>/g) || []).length;
  const quot = (sample.match(/"/g) || []).length;
  const digits = (sample.match(/\d{6,}/g) || []).length; // 6 位以上数字串（碎片指纹）
  return (gt + quot + digits * 4) / Math.max(sample.length, 1);
}

/**
 * 解析 MOBI/AZW3 二进制 → {title, author, text}（三级防线）
 * ① 自研经典 MOBI 内核（快，经典格式已验证）；② 残渣超标/失败 → @lingo-reader/mobi-parser（KF8/AZW3 标准 kindle 文件骨架碎片拼装）；
 * ③ 全灭 → 优雅拒绝（比乱码残渣强一百倍）
 */
export async function parseMobi(buf) {
  // ① 自研经典内核
  try {
    const r = parseMobiClassic(buf);
    if (r?.text && junkScore(r.text) < 0.006) return r;
  } catch {}
  // ② lingo 现成解析器（MOBI 先试，不行 KF8）
  for (const init of ['initMobiFile', 'initKf8File']) {
    try {
      const mod = await import('@lingo-reader/mobi-parser');
      const book = await mod[init](new Uint8Array(buf));
      const meta = book.getMetadata?.() || {};
      const spine = book.getSpine?.() || [];
      if (spine.length) {
        let text = '';
        for (const ch of spine) {
          const c = book.loadChapter?.(ch.id);
          if (c?.html) text += stripMarkup(c.html) + '\n\n';
        }
        text = text.trim();
        if (text && junkScore(text) < 0.006) {
          return { title: meta.title || '未命名', author: meta.author || '', text };
        }
      }
      book.destroy?.();
    } catch {}
  }
  // ③ 优雅拒绝
  throw new Error('此 mobi 为 KF8/AZW3 混合格式，暂未能解析（建议用 Calibre 转 epub 后入库）');
}

/**
 * 图片型 mobi（漫画）正文提取：图片记录（文本记录之后，JPEG/PNG/GIF/BMP 原始字节，无压缩）。
 * 漫画型 mobi 的文本记录只是 HTML 骨架（含 <img> 引用），正文是图片——
 * 此前只提文本，得到的全是骨架碎片（「乱码」真相），图片一张没提。
 */
export function extractMobiImages(buf) {
  const v = new Uint8Array(buf);
  if (v.length < 78) return [];
  const numRec = rU16(v, 76);
  if (!numRec || numRec > 40000) return [];
  const recOff = [];
  for (let i = 0; i < numRec; i++) {
    const o = 78 + i * 8;
    if (o + 4 > v.length) break;
    recOff.push(rU32(v, o));
  }
  if (!recOff.length || recOff[0] + 16 > v.length) return [];
  const r0 = recOff[0];
  if (rStr(v, r0 + 16, 4, decUtf8) !== 'MOBI') return [];
  const textRecCount = rU16(v, r0 + 8);
  const mimeOf = (rec) => {
    if (rec.length > 3 && rec[0] === 0xFF && rec[1] === 0xD8 && rec[2] === 0xFF) return 'image/jpeg';
    if (rec.length > 4 && rec[0] === 0x89 && rec[1] === 0x50 && rec[2] === 0x4E && rec[3] === 0x47) return 'image/png';
    if (rec.length > 3 && rec[0] === 0x47 && rec[1] === 0x49 && rec[2] === 0x46) return 'image/gif';
    if (rec.length > 2 && rec[0] === 0x42 && rec[1] === 0x4D) return 'image/bmp';
    return null;
  };
  const images = [];
  // 图片记录必在文本记录之后（textRecCount+1 起全扫，魔数判定即停非图）
  for (let i = textRecCount + 1; i < recOff.length; i++) {
    const s = recOff[i], e = i + 1 < recOff.length ? recOff[i + 1] : v.length;
    if (s >= e || s >= v.length) break;
    const rec = v.subarray(s, Math.min(e, v.length));
    const mime = mimeOf(rec);
    if (mime) images.push({ mime, bytes: rec });
  }
  return images;
}

/** 图片字节 → dataURL（分块编码防栈溢出） */
export function imageBytesToDataUrl(mime, bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** 纯文本分页（按段落边界，约 2600 字/页） */
export function paginateText(text, pageChars = 2600) {
  const pages = [];
  let rest = String(text || '').replace(/\r\n?/g, '\n');
  while (rest.length > pageChars) {
    let cut = rest.lastIndexOf('\n\n', pageChars);
    if (cut < pageChars * 0.5) cut = rest.lastIndexOf('\n', pageChars);
    if (cut < pageChars * 0.3) cut = pageChars;
    pages.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.trim()) pages.push(rest.trim());
  return pages.length ? pages : ['（空）'];
}

/** 文本页 → HTML（安全转义） */
export function textPageToHtml(page) {
  return page.split(/\n{2,}/).map(p =>
    `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`).join('');
}
