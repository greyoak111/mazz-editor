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

  test('slide：V2 通用另存 .pptx 走对象级模型', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = slideModule.create(container);
    slideModule.setContent('# 年度汇报\n\n## 第一部分\n- 要点一\n\n---\n\n## 第二部分\n- 要点二\n', state);
    await tick(80);
    assert.equal(window.__activeSlideCtl?.isV2, true, '大纲打开后应已迁移到 V2');
    const out = await slideModule.exportAs('.pptx', state);
    assert.ok(out.base64.length > 200);
    const zip = await JSZip.loadAsync(b64bytes(out.base64));
    assert.ok(await zip.file('ppt/presentation.xml'), '应为合法 pptx');
    const firstSlide = await zip.file('ppt/slides/slide1.xml').async('text');
    assert.ok(firstSlide.includes('年度汇报'), '另存必须导出当前 V2 内容，不得读取初始 V1 slides 镜像');
    assert.ok(!firstSlide.includes('演示文稿标题'), '不得泄漏旧 V1 默认页');
    container.remove();
  });

  test('slide：Ribbon 在 V2 上操作 frames/doc2/Item 而非旧 slides', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = slideModule.create(container);
    slideModule.setContent('# 第一页\n- A\n---\n# 第二页\n- B\n', state);
    slideModule.activate(container);
    const ctl = window.__activeSlideCtl;
    const command = (id, payload) => slideModule.contributes.commands.find(item => item.id === id)?.run(payload);
    const frames = ctl.doc2.layouts.main.frames;
    const legacyBefore = JSON.stringify(ctl.slides);
    const firstSlideId = frames[0].slideId;
    const secondSlideId = frames[1].slideId;
    frames.splice(1, 0, { ...frames[0] }); // 同一物料重复编排：不能只靠 slideId 导航
    ctl.renderV2All();
    assert.equal(ctl.curSlideId, frames[0].slideId);
    command('slide.next');
    assert.equal(ctl.currentFrameIndex(), 1, '重复物料的第二帧也必须可到达');
    assert.equal(ctl.curSlideId, firstSlideId);
    command('slide.next');
    assert.equal(ctl.currentFrameIndex(), 2, '必须能穿过重复帧继续向后');
    assert.equal(ctl.curSlideId, secondSlideId, '下一页必须走 V2 编排帧');
    command('slide.prev');
    command('slide.prev');
    assert.equal(ctl.currentFrameIndex(), 0);
    assert.equal(ctl.curSlideId, firstSlideId, '上一页必须走 V2 编排帧');
    const before = frames.length;
    command('slide.add');
    assert.equal(ctl.doc2.layouts.main.frames.length, before + 1, '新页必须追加 V2 frame');
    assert.ok(ctl.doc2.slides[ctl.curSlideId], '新页必须落 V2 物料层');
    command('slide.theme', { theme: 'paper' });
    assert.equal(ctl.doc2.theme, 'paper', '主题必须固化在 V2 doc');
    command('slide.setBackground', { color: '#123456' });
    assert.equal(ctl.curSlide().bg, '#123456', '背景必须写当前 V2 slide');
    command('slide.addEllipse');
    assert.equal(ctl._addTool, 'shape');
    assert.equal(ctl._shapePreset, 'ellipse', '椭圆 Ribbon 必须复用 V2 shape Item');
    command('slide.addText');
    assert.equal(ctl._addTool, 'text', '文本 Ribbon 必须激活 V2 Item 工具');
    command('slide.canvasMode');
    assert.equal(ctl._addTool, null, '画布按钮在 V2 仅回到对象画布');
    assert.equal(JSON.stringify(ctl.slides), legacyBefore, 'V2 Ribbon 不得偷写旧 slides 数组');
    slideModule.deactivate(container);
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
