// tests/contract/library.test.mjs —— 第四阶段波次3：epub/cbz 解析、html→md、翻译工具函数
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const { parseEpub, htmlToMarkdown } = await import('../../renderer/modules/library/epub.js');
const { parseCbz } = await import('../../renderer/modules/library/cbz.js');

/** 构造最小合法 epub */
async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
    <package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata>
        <dc:title>测试之书</dc:title>
        <dc:creator>张三</dc:creator>
      </metadata>
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="img" href="pic.png" media-type="image/png"/>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
    </package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0"?>
    <ncx><navMap>
      <navPoint id="n1"><navLabel><text>第一章 开始</text></navLabel><content src="ch1.xhtml"/></navPoint>
      <navPoint id="n2"><navLabel><text>第二章 继续</text></navLabel><content src="ch2.xhtml"/></navPoint>
    </navMap></ncx>`);
  zip.file('OEBPS/ch1.xhtml',
    '<html><body><h1>第一章 开始</h1><p>正文一<script>alert(1)</script></p><img src="pic.png"/></body></html>');
  zip.file('OEBPS/ch2.xhtml',
    '<html><body><h2>小节</h2><p>正文二</p></body></html>');
  // 1x1 PNG
  zip.file('OEBPS/pic.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function makeCbz() {
  const zip = new JSZip();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  zip.file('page10.png', png);
  zip.file('page2.png', png);
  zip.file('page1.png', png);
  zip.file('readme.txt', 'not an image');
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('epub 解析器', () => {
  test('元数据 / spine / 目录 / 章节 sanitize / 封面', async () => {
    const epub = await parseEpub(await makeEpub());
    assert.equal(epub.title, '测试之书');
    assert.equal(epub.author, '张三');
    assert.equal(epub.spine.length, 2, 'spine 两章');
    assert.equal(epub.toc.length, 2, '目录两条');
    assert.equal(epub.toc[0].label, '第一章 开始');
    assert.ok(epub.cover?.startsWith('data:image/png;base64,'), '封面 dataURL');
    // 章节：script 被剥除、图片重写为 dataURL
    const ch1 = await epub.loadChapter(epub.spine[0]);
    assert.ok(ch1.html.includes('正文一'));
    assert.ok(!ch1.html.includes('<script'), 'script 应被剥除');
    assert.ok(ch1.html.includes('data:image/png;base64,'), '图片应重写为 dataURL');
    assert.ok(!ch1.html.includes('src="pic.png"'), '原始相对路径不应残留');
    const ch2 = await epub.loadChapter(epub.spine[1]);
    assert.ok(ch2.html.includes('正文二'));
  });
});

describe('cbz 解析器', () => {
  test('自然排序 + 仅图片 + 页面加载', async () => {
    const cbz = await parseCbz(await makeCbz());
    assert.equal(cbz.count, 3, '只计图片页');
    assert.deepEqual(cbz.names, ['page1.png', 'page2.png', 'page10.png'], '自然排序 page2 < page10');
    const p0 = await cbz.loadPage(0);
    assert.ok(p0.startsWith('data:image/png;base64,'));
  });
});

describe('htmlToMarkdown', () => {
  test('标题/段落/列表/引用转换', () => {
    const md = htmlToMarkdown('<h2>标题</h2><p>第一段 落</p><ul><li>甲</li><li>乙</li></ul><blockquote><p>引文</p></blockquote>');
    assert.ok(md.includes('## 标题'));
    assert.ok(md.includes('- 甲'));
    assert.ok(md.includes('> 引文'));
  });
});

describe('翻译工具函数', () => {
  const { looksChinese, chunkText } = require('../../main/translate.js');
  test('looksChinese 中文比例判定', () => {
    assert.ok(looksChinese('这是一段中文文本'));
    assert.ok(!looksChinese('This is an English sentence.'));
  });
  test('chunkText 按句切且每块不超长', () => {
    const long = '句子一。'.repeat(300); // 1200 字
    const parts = chunkText(long, 450);
    assert.ok(parts.length >= 3, '应切多块');
    for (const p of parts) assert.ok(p.length <= 460, '每块不超长');
    assert.equal(parts.join('').length, long.length, '拼接后文本守恒');
  });
  test('chunkText 短文本原样', () => {
    assert.deepEqual(chunkText('短文本'), ['短文本']);
  });
});
