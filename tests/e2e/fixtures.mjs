// tests/e2e/fixtures.mjs —— 真实测试文件制造间（内容量足够真，拒绝三行玩具）
// 产物：md/txt/csv/docx(真OOXML)/wav(3s)/mm/opml/epub(真包)/漫画文件夹(PNG)/电子书长文
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// —— 最小 PNG 编码器（无依赖，Node zlib 直出合法 PNG） ——
export function makePng(width, height, rgb, { stripe = null } = {}) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 3;
      const c = stripe && Math.floor(y / 24) % 2 === 0 ? stripe : rgb;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function crc32(buf) { // 兜底（老 Node 无 zlib.crc32）
  let t = crc32.t;
  if (!t) {
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  }
  let c = -1;
  for (const b of buf) c = (c >>> 8) ^ t[(c ^ b) & 255];
  return (c ^ -1) >>> 0;
}

// —— 真 OOXML docx（mammoth 可解：标题/段落/表格） ——
export function makeDocx() {
  const paras = [
    ['Heading1', '项目立项报告'], ['Heading2', '一、背景与目标'],
    ['Normal', '本项目旨在建设一套覆盖研发全流程的协同平台，解决信息孤岛、流程断点与资产沉淀三大顽疾。'],
    ['Normal', '第一阶段范围包括需求管理、任务跟踪与文档库三部分，预计八周交付可用版本。'],
    ['Heading2', '二、关键指标'],
    ['Normal', '需求吞吐量提升百分之三十；文档检索平均耗时控制在两秒以内；跨团队评审周期缩短一半。'],
    ['Heading2', '三、风险与对策'],
    ['Normal', '主要风险集中在历史数据迁移与组织惯性，对策为双轨并行两周与高频次小步发布。'],
  ];
  const pXml = paras.map(([st, tx]) =>
    `<w:p><w:pPr><w:pStyle w:val="${st}"/></w:pPr><w:r><w:t xml:space="preserve">${tx}</w:t></w:r></w:p>`).join('');
  const tbl = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>
    ${['阶段|里程碑|时间', '一期|平台上线|第4周', '二期|全员切换|第8周'].map(r =>
      `<w:tr>${r.split('|').map(c => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${pXml}${tbl}</w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`;
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': documentXml,
    'word/styles.xml': stylesXml,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  };
}

// —— 真 EPUB（两章，spine/toc 齐全） ——
export function makeEpubFiles() {
  const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;
  const c1 = `<h1>第一章 起风</h1>${'<p>夜色从河面上升起来，老城在潮声里缓慢翻了个身。他沿着堤岸走了很久，直到灯塔第三次掠过他的影子。</p>'.repeat(30)}`;
  const c2 = `<h1>第二章 回声</h1>${'<p>信箱里没有信，只有一张被雨水泡皱的车票。她把它摊平在桌上，像摊开一段不肯干掉的往事。</p>'.repeat(30)}`;
  return {
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>潮声集</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh-CN</dc:language><dc:identifier id="bid">mazz-e2e-epub-001</dc:identifier></metadata>
<manifest>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
</manifest>
<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="mazz-e2e-epub-001"/></head>
<docTitle><text>潮声集</text></docTitle>
<navMap>
<navPoint id="n1" playOrder="1"><navLabel><text>第一章 起风</text></navLabel><content src="c1.xhtml"/></navPoint>
<navPoint id="n2" playOrder="2"><navLabel><text>第二章 回声</text></navLabel><content src="c2.xhtml"/></navPoint>
</navMap></ncx>`,
    'OEBPS/c1.xhtml': xhtml('第一章 起风', c1),
    'OEBPS/c2.xhtml': xhtml('第二章 回声', c2),
  };
}

export function makeWav(seconds = 3, freq = 440) {
  const sr = 8000, n = sr * seconds, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / sr * freq * 2 * Math.PI) * 8000), 44 + i * 2);
  return buf;
}

/** 布置全部夹具到工作区目录（幂等） */
export async function seedFixtures(WS, WS2) {
  const W = (rel, content) => { fs.mkdirSync(path.dirname(path.join(WS, rel)), { recursive: true }); fs.writeFileSync(path.join(WS, rel), content); };

  // 1. 长 Markdown（三级标题树 + 表格 + 代码块 + 列表）
  const md = ['# Mazz 平台设计白皮书', '', '## 第一章 总体设计', ''];
  for (let i = 1; i <= 8; i++) {
    md.push(`### 1.${i} 设计原则 ${i === 1 ? '：本地优先' : ''}`, '', i === 1 ? '所有数据默认留在本机，熵增只在本地发生，液冷般的安静。' : `第 ${i} 条原则的展开论述，包含边界条件、反例与折中说明，确保评审时有据可查。`, '');
  }
  md.push('## 第二章 架构拆解', '', '### 2.1 进程模型', '', '主进程负责系统能力，渲染进程负责界面呈现，两者以白名单通道通信。', '');
  md.push('### 2.2 数据流', '', '| 层 | 职责 | 技术 |', '| --- | --- | --- |', '| 壳 | 布局与命令 | 自研 |', '| 模块 | 业务能力 | 插件 |', '', '```js\nconst answer = 42;\n```', '');
  md.push('## 第三章 路线图', '', '- [x] 基座', '- [ ] 生态', '');
  W('长文档.md', md.join('\n'));

  // 2. 较长纯文本（可分页多屏）
  const txt = [];
  for (let i = 1; i <= 40; i++) txt.push(`第${i}行：量子涨落与液冷服务器的对照实验记录，编号 ${String(i).padStart(3, '0')}，结论待复核。`);
  W('实验记录.txt', txt.join('\n'));

  // 3. CSV 数据表
  const csv = ['月份,产量,合格率,备注'];
  for (let i = 1; i <= 24; i++) csv.push(`2025-${String((i % 12) + 1).padStart(2, '0')},${900 + i * 13},${(97.2 - i * 0.1).toFixed(1)}%,${i % 5 === 0 ? '检修' : '正常'}`);
  W('产量表.csv', csv.join('\n'));

  // 4. 长电子书 txt（阅读室翻页）
  const book = ['《夜航西飞》测试样章', ''];
  for (let c = 1; c <= 6; c++) {
    book.push(`第${c}章 ${['风', '潮', '灯', '岸', '雪', '归'][c - 1]}`, '');
    for (let i = 0; i < 12; i++) book.push(`飞机越过第 ${i + 1} 片云层时，仪表盘上的光像一小片不肯熄灭的湖。他想起地面的人说过的话：每一次降落，都是一次被允许的坠落。`);
    book.push('');
  }
  W('电子书/夜航西飞.txt', book.join('\n'));
  W('书库/夜航西飞.txt', book.join('\n')); // 书库扫描目录（阅读室场景从书架进）

  // 5. docx 真包
  {
    const files = makeDocx();
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [k, v] of Object.entries(files)) zip.file(k, v);
    W('立项报告.docx', await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
  }

  // 6. epub 真包
  {
    const files = makeEpubFiles();
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file('mimetype', files['mimetype'], { compression: 'STORE' }); // epub 规范：mimetype 必须首个且不压缩
    for (const [k, v] of Object.entries(files)) if (k !== 'mimetype') zip.file(k, v);
    W('电子书/潮声集.epub', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  }

  // 7. wav
  W('测试音.wav', makeWav(3));

  // 8. FreeMind 导图（三级）
  W('外部导图.mm', `<map version="1.0.1">
<node TEXT="产品战略">
  <node TEXT="市场"><node TEXT="国内"/><node TEXT="海外"/></node>
  <node TEXT="研发"><node TEXT="平台"><node TEXT="编辑器"/><node TEXT="同步"/></node><node TEXT="算法"/></node>
  <node TEXT="运营"/>
</node>
</map>`);

  // 9. OPML
  W('外部大纲.opml', `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>研究计划</title></head><body>
<outline text="研究计划">
  <outline text="文献综述"><outline text="国内研究"/><outline text="国外研究"/></outline>
  <outline text="实验设计"><outline text="变量控制"/></outline>
  <outline text="结论"/>
</outline>
</body></opml>`);

  // 10. 漫画文件夹（2 话 × 3 页，色块+条纹可分辨）
  const colors = [[[200, 60, 60], [240, 200, 60]], [[60, 120, 220], [120, 220, 160]]];
  for (let ch = 0; ch < 2; ch++) {
    for (let pg = 0; pg < 3; pg++) {
      W(`漫画/第${ch + 1}话/${String(pg + 1).padStart(2, '0')}.png`,
        makePng(360, 540, colors[ch][0], { stripe: colors[ch][1] }));
    }
  }

  // 11. 第二工作区
  fs.writeFileSync(path.join(WS2, '另一区的文件.md'), '# 第二工作区\n\n这里是另一个区，用来验证工作区切换。\n');
  fs.writeFileSync(path.join(WS2, '第二区笔记.txt'), '第二区的文本内容，量子液冷。');

  // 11.5 mobi 小说（UTF-8 正文 + GBK 虚标各一，自研编码器直出）+ cbz 漫画包
  {
    const { makeMobi } = await import('./mobi-encoder.mjs');
    const novel = ['第一章 渡口', ''];
    for (let i = 0; i < 6; i++) novel.push(`暮色压着水面，渡船在第 ${i + 1} 声钟响里离岸。他说这条河的上游没有桥，只有一群不肯靠岸的人。`);
    novel.push('', '第二章 灯火', '');
    for (let i = 0; i < 6; i++) novel.push(`她把灯举过头顶，光落在信纸上，像落在很多年以前的雪上。`);
    W('书库/渡口集.mobi', makeMobi({ title: '渡口集', text: novel.join('\n') }));
    W('书库/虚标集.mobi', makeMobi({ title: '虚标集', text: novel.join('\n'), encoding: 65001, mislabel: true }));
    // cbz 漫画包（3 页 PNG zip）
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const cols = [[220, 80, 80], [80, 140, 220], [90, 200, 140]];
    for (let i = 0; i < 3; i++) zip.file(`page_${i + 1}.png`, makePng(400, 600, cols[i], { stripe: [240, 230, 200] }));
    W('书库/三色漫画.cbz', await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
  }

  // 12. 深层目录（删除多层文件夹回归）
  W('深层/一层/二层/三层/深文件.txt', '深层目录测试文件，删除我请整个带走。');
}
