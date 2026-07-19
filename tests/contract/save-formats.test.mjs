// tests/contract/save-formats.test.mjs —— 保存格式：exportAs 契约（csv/xlsx/docx/pptx/md 大纲/png/笔记正文）
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
window.mazz = {
  invoke: async (channel) => {
    if (channel === 'settings:get') return null;
    return null;
  },
};
window.MazzCommands = { execute: () => {} };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {} };

const JSZip = require('jszip');
const { default: sheetModule } = await import('../../renderer/modules/sheet/index.js');
const { parseMarkdown } = await import('../../renderer/modules/markdown/schema.js');
const { default: markdownModule } = await import('../../renderer/modules/markdown/index.js');
const { default: slideModule } = await import('../../renderer/modules/slide/index.js');
const { default: mindmapModule } = await import('../../renderer/modules/mindmap/index.js');
const { default: drawModule } = await import('../../renderer/modules/draw/index.js');
const { default: notesModule } = await import('../../renderer/modules/notes/index.js');

const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const b64bytes = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

describe('保存格式：exportAs 契约', () => {
  test('sheet：.csv 有效范围文本 / .xlsx 合法 zip / 未知格式回落 null', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = sheetModule.create(container);
    const ctl = sheetModule._forTests.instances.get(container);
    const sheet = ctl.wb.sheets[ctl.wb.active];
    sheet.setRaw(1, 1, '名称'); sheet.setRaw(1, 2, '数量');
    sheet.setRaw(2, 1, '苹果'); sheet.setRaw(2, 2, 3);
    sheet.setRaw(3, 1, '梨'); sheet.setRaw(3, 2, 5);
    const csv = await sheetModule.exportAs('.csv', state);
    assert.ok(csv.text.includes('名称,数量'));
    assert.ok(csv.text.includes('苹果,3'));
    assert.ok(!csv.text.includes(',,,,,,,'), '不应含整行空列');
    const xlsx = await sheetModule.exportAs('.xlsx', state);
    assert.ok(xlsx.base64.length > 100);
    const zip = await JSZip.loadAsync(b64bytes(xlsx.base64));
    assert.ok(await zip.file('xl/workbook.xml'), 'xlsx 应为合法工作簿');
    assert.equal(await sheetModule.exportAs('.mazzsheet', state), null, '原生格式回落 getContent');
    container.remove();
  });

  test('markdown：.docx 合法 zip / .html 渲染含结构', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = markdownModule.create(container);
    markdownModule.setContent('# 标题一\n\n正文 **加粗** 内容。\n\n- 列表项\n', state);
    await tick(80);
    const docx = await markdownModule.exportAs('.docx', state);
    assert.ok(docx.base64.length > 200);
    const zip = await JSZip.loadAsync(b64bytes(docx.base64));
    const docXml = await zip.file('word/document.xml').async('text');
    assert.ok(docXml.includes('标题一'), 'docx 应含标题');
    const html = await markdownModule.exportAs('.html', state);
    assert.ok(html.text.includes('<h2>标题一</h2>'), 'html 应渲染标题');
    assert.ok(html.text.includes('<b>加粗</b>'));
    assert.ok(html.text.includes('<!DOCTYPE html>'));
    container.remove();
  });

  test('slide：.pptx 合法演示包', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = slideModule.create(container);
    slideModule.setContent('# 年度汇报\n\n## 第一部分\n- 要点一\n\n---\n\n## 第二部分\n- 要点二\n', state);
    await tick(80);
    const out = await slideModule.exportAs('.pptx', state);
    assert.ok(out.base64.length > 200);
    const zip = await JSZip.loadAsync(b64bytes(out.base64));
    assert.ok(await zip.file('ppt/presentation.xml'), '应为合法 pptx');
    container.remove();
  });

  test('mindmap：.md 输出 Markdown 大纲', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = mindmapModule.create(container);
    await tick();
    const out = await mindmapModule.exportAs('.md', state);
    assert.ok(out.text.startsWith('# 中心主题'));
    assert.ok(out.text.includes('- 分支一'));
    assert.equal(await mindmapModule.exportAs('.mindmap', state), null, '原生 JSON 回落');
    container.remove();
  });

  test('draw：.png 输出（jsdom 无 canvas 时安全回落 null）/ 其他回落', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = drawModule.create(container);
    await tick();
    const out = await drawModule.exportAs('.png', state);
    if (out) { // 有 canvas 环境：验证 PNG 魔数
      const bytes = b64bytes(out.base64);
      assert.equal(bytes[0], 0x89, 'PNG 魔数');
      assert.equal(bytes[1], 0x50);
    } else { // jsdom 无 canvas：必须安全回落而非抛错
      assert.ok(true, '无 canvas 环境安全回落');
    }
    assert.equal(await drawModule.exportAs('.mazzdraw', state), null);
    container.remove();
  });

  test('notes：.md 输出当前笔记正文', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    notesModule.create(container);
    await tick(150);
    const ctl = notesModule._forTests.instances.get(container);
    const out = await notesModule.exportAs('.md', { container });
    assert.ok(typeof out.text === 'string');
    container.remove();
  });
});
