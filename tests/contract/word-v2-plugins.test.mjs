// tests/contract/word-v2-plugins.test.mjs —— 第四阶段波次4：批注内核/docx 映射/样式映射/插件系统/桥接二期
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
window.mazz = {
  invoke: async (channel, payload) => {
    if (channel === 'settings:get') return null;
    if (channel === 'settings:set') return true;
    if (channel === 'workspace:get') return '/mock-ws';
    if (channel === 'fs:mkdir') return true;
    if (channel === 'fs:writeFileBase64') { window.__lastWrite = payload; return true; }
    if (channel === 'fs:writeFile') { window.__lastWriteText = payload; return true; }
    if (channel === 'fs:readFile') throw new Error('ENOENT');
    return null;
  },
};
window.MazzCommands = { execute: () => {} };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {} };

const { parseMarkdown, serializeMarkdown, schema } = await import('../../renderer/modules/markdown/schema.js');
const { scanComments } = await import('../../renderer/modules/markdown/comments.js');
const pluginLoader = await import('../../renderer/plugins/loader.js');
const { validateManifest, validateContributes, readMaz, loadPlugin } = pluginLoader;
const { modules } = await import('../../renderer/core/module-registry.js');
const { bridges } = await import('../../renderer/bridge.js');

describe('批注内核：{==..==}{>>..<<} 解析与序列化', () => {
  test('解析为 comment mark 且文本自足', () => {
    const doc = parseMarkdown('这是{==被批注的话>> <<}{>>写错了<<}。');
    // 上面写法不规范，用标准格式
    const doc2 = parseMarkdown('这是{==被批注的话==}{>>写错了<<}结尾');
    const found = [];
    doc2.descendants((node) => {
      const m = node.marks.find(x => x.type.name === 'comment');
      if (m) found.push({ text: node.text, comment: m.attrs.text });
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].text, '被批注的话');
    assert.equal(found[0].comment, '写错了');
  });

  test('序列化往返守恒', () => {
    const md = '前文{==重点内容==}{>>需要核对数据来源<<}后文';
    const doc = parseMarkdown(md);
    const out = serializeMarkdown(doc);
    assert.ok(out.includes('{==重点内容==}{>>需要核对数据来源<<}'), '批注应原样序列化');
  });

  test('scanComments 扫描并合并相邻片段', () => {
    const doc = parseMarkdown('{==第一句==}{>>批注A<<}普通文本{==第二句==}{>>批注B<<}');
    const list = scanComments(doc);
    assert.equal(list.length, 2);
    assert.equal(list[0].text, '批注A');
    assert.equal(list[0].quote, '第一句');
    assert.equal(list[1].text, '批注B');
  });

  test('fontStyle HTML 解析路径回归（span/sup/sub → mark attrs）', () => {
    const doc = parseMarkdown('<span style="color:#ff0000;font-size:18pt">红字</span> 与 <sup>上标</sup> 和 <sub>下标</sub>');
    const hits = [];
    doc.descendants((node) => {
      const fs = node.marks.find(m => m.type.name === 'fontStyle');
      if (fs) hits.push({ text: node.text, ...fs.attrs });
    });
    assert.equal(hits.length, 3, '三处 fontStyle 均应解析');
    assert.equal(hits[0].color, '#ff0000');
    assert.equal(hits[0].size, 18); // parseFloat 数字磅值
    assert.equal(hits[1].script, 'sup');
    assert.equal(hits[2].script, 'sub');
    // 序列化回 sup/sub 形式
    const out = serializeMarkdown(doc);
    assert.ok(out.includes('<sup>上标</sup>'), 'sup 应序列化回标签');
  });
});

describe('docx 导出：批注与样式映射', () => {
  test('批注映射为 Word Comments', async () => {
    const { exportDocx } = await import('../../renderer/modules/markdown/docx-io.js');
    const doc = parseMarkdown('这是{==被批注文本==}{>>批注内容在此<<}。');
    const buf = await exportDocx(doc, {});
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);
    const commentsXml = await zip.file('word/comments.xml')?.async('text');
    assert.ok(commentsXml, '应生成 comments.xml');
    assert.ok(commentsXml.includes('批注内容在此'), '批注文本应写入');
    const docXml = await zip.file('word/document.xml').async('text');
    assert.ok(docXml.includes('commentRangeStart'), '正文应有 CommentRange');
  });

  test('样式映射表覆盖默认样式', async () => {
    const { exportDocx } = await import('../../renderer/modules/markdown/docx-io.js');
    const doc = parseMarkdown('# 标题一\n\n正文段落。');
    const buf = await exportDocx(doc, { styleMap: { h1: { size: 56, color: 'FF0000' }, body: { size: 30 } } });
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file('word/document.xml').async('text');
    assert.ok(docXml.includes('w:val="56"'), 'h1 字号应覆盖为 56 半磅');
    assert.ok(docXml.includes('FF0000'), 'h1 颜色应覆盖');
    assert.ok(docXml.includes('w:val="30"'), '正文字号应覆盖为 30 半磅');
  });
});

describe('插件系统', () => {
  test('validateManifest 校验必填与 id 合法性', () => {
    assert.throws(() => validateManifest({ name: 'x', version: '1' }), /id/);
    assert.throws(() => validateManifest({ id: 'x' }), /name/);
    assert.throws(() => validateManifest({ id: '非法 id!', name: 'x', version: '1' }), /非法/);
    validateManifest({ id: 'ok-plugin.v2', name: 'x', version: '1.0.0' }); // 不抛
  });

  test('validateContributes 拒绝非法 when 表达式', () => {
    assert.throws(() => validateContributes({
      contributes: { keybindings: [{ command: 'x', key: 'ctrl+a', when: '(((' }] },
    }));
    validateContributes({ contributes: { keybindings: [{ command: 'x', key: 'ctrl+a', when: "module=='markdown'" }] } });
  });

  test('readMaz 解析示例插件包', async () => {
    const fs = require('fs');
    const path = require('path');
    const mazPath = path.join(process.cwd(), 'samples', 'wordcount.maz');
    assert.ok(fs.existsSync(mazPath), '示例插件应已构建');
    // readMaz 走 fs:readFileBase64——mock 之
    const b64 = fs.readFileSync(mazPath).toString('base64');
    const oldInvoke = window.mazz.invoke;
    window.mazz.invoke = async (channel, payload) => {
      if (channel === 'fs:readFileBase64') return b64;
      return oldInvoke(channel, payload);
    };
    const { manifest, code } = await readMaz('/fake/wordcount.maz');
    assert.equal(manifest.id, 'wordcount');
    assert.ok(code.includes('displayName'));
    window.mazz.invoke = oldInvoke;
  });

  test('loadPlugin：blob 动态导入 + 契约注册', async () => {
    const code = `
      export default {
        displayName: '测试插件', icon: '🧩',
        create(c) { return { container: c }; },
        activate() {}, deactivate() {},
        getContent() { return ''; }, setContent() {}, newDocument() {},
        getCharCount() { return 0; }, getCursorPos() { return ''; },
        contributes: { commands: [], keybindings: [], menus: {}, bridges: [], aiActions: [] },
      };`;
    const name = await loadPlugin(code, { id: 'ut-plug', name: '测试插件', version: '1.0.0' });
    assert.equal(name, 'plugin:ut-plug');
    assert.ok(modules.defs.has('plugin:ut-plug'), '应注册进模块表');
    // 契约不全的应拒绝
    let threw = false;
    try {
      await loadPlugin('export default { displayName: "残缺" }', { id: 'bad-plug', name: 'x', version: '1' });
    } catch (e) { threw = true; }
    assert.ok(threw, '契约不全的插件应被拒绝');
  });
});

describe('桥接二期', () => {
  test('#7 书库→笔记：摘录落盘并含来源', async () => {
    const file = await bridges.execute('lib.toNote', { text: '好记性不如烂笔头。', book: '测试书', where: '第 3 章' });
    assert.ok(file.includes('书摘'));
    const written = window.__lastWriteText;
    assert.ok(written.content.includes('> 好记性不如烂笔头。'), '摘录应引用格式写入');
    assert.ok(written.content.includes('《测试书》'), '应含书名');
    assert.ok(written.content.includes('第 3 章'), '应含位置');
  });

  test('#3 文稿→PPT：后台编译产出 pptx 文件', async () => {
    const file = await bridges.execute('md.toPptx', {
      markdown: '# 年度总结\n\n## 第一部分\n- 要点一\n- 要点二\n\n---\n\n## 第二部分\n- 要点三\n',
      title: '年度总结',
    });
    assert.ok(file.endsWith('.pptx'));
    assert.ok(window.__lastWrite?.base64?.length > 100, '应写入 pptx 数据');
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(Buffer.from(window.__lastWrite.base64, 'base64'));
    assert.ok(await zip.file('ppt/presentation.xml'), '产物应为合法 pptx');
  });
});
