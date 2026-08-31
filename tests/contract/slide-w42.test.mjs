// tests/contract/slide-w42.test.mjs —— 波次四十二「pptx 互通」契约
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (p) => fs.readFileSync(path.resolve(p), 'utf8');

describe('导出对象级（pptx2.js）', () => {
  test('Item→OOXML 映射表', () => {
    const src = readSrc('renderer/modules/slide/pptx2.js');
    assert.ok(src.includes('exportPptxV2'), 'v2 导出必须有');
    assert.ok(/SHAPE_MAP[\s\S]{0,140}roundRect[\s\S]{0,200}parallelogram[\s\S]{0,120}'can'/.test(src), '六符映射必须有（roundRect/diamond/parallelogram/can）');
    assert.ok(src.includes('slide.addText') && src.includes('slide.addImage') && src.includes('slide.addShape') && src.includes('slide.addTable'), '四类 add 必须有');
    assert.ok(src.includes("v / 100 * 10") && src.includes("v / 100 * 5.625"), '百分比必须转 inches');
    assert.ok(src.includes('inkToPng'), 'ink 必须 PNG 渲染嵌入');
    assert.ok(src.includes('fmtCountdown'), 'timer 必须静态文本降级');
  });
  test('帧属性随迁', () => {
    const src = readSrc('renderer/modules/slide/pptx2.js');
    assert.ok(src.includes('slide.hidden = true'), '禁用帧必须转隐藏页');
    assert.ok(src.includes('slide.addNotes'), '备注必须随迁');
  });
  test('reveal→Animation 后注入', () => {
    const src = readSrc('renderer/modules/slide/pptx2.js');
    assert.ok(src.includes('injectRevealAnimations'), 'reveal 注入必须有');
    assert.ok(src.includes('p:timing') && src.includes('nodeType="clickEffect"'), '单击序列 mainSeq 必须有');
    assert.ok(src.includes('p:spTgt spid=') || src.includes('spTgt spid="'), 'spid 目标锚必须有');
    assert.ok(src.includes('ids.slice(1)'), '组根占位跳过必须有（插入序回填实锤）');
    assert.ok(src.includes('!== jobs[i].rev.length) continue'), '对不上就不注（降级安全）必须有');
    assert.ok(src.includes('presetClass="entr"'), '入场动画类必须有');
  });
});

describe('导入降级与命令路由', () => {
  test('导入降级文本+图片闭环（现状维持）', () => {
    const src = readSrc('renderer/modules/slide/pptx-import.js');
    assert.ok(src.includes('pptxToOutline'), '导入入口必须在');
    assert.ok(src.includes('slideImages') && src.includes('<!--canvas:'), '图片必须经 canvas 注释随迁（v2 迁移落 image Item）');
    assert.ok(src.includes("/_rels/$1") && !src.includes("/_rels$1"), 'rels 路径必须带斜杠（W42 平反的静默死 bug 不得复活）');
    assert.ok(!src.includes('timing'), '导入不碰动画 XML（降级红线）');
  });
  test('slide.exportPptx 双路由', () => {
    const src = readSrc('renderer/modules/slide/index.js');
    assert.ok(/isV2 \? await exportPptxV2/.test(src), 'v2 必须走对象级导出');
    assert.ok(src.includes('exportPptx(ctl.slides, ctl.theme)'), 'v1 老管线必须保留');
    assert.ok(/async exportAs[\s\S]{0,320}ctl\.isV2 && ctl\.doc2[\s\S]{0,120}exportPptxV2/.test(src), '通用另存 PPTX 也必须走 V2 对象级导出');
    assert.ok(src.includes('payload?.path'), 'path 测试口必须有（save 对话框不阻塞自动化）');
    assert.ok(src.includes("from './pptx2.js'"), 'pptx2 必须引入');
  });
  test('外部 PowerPoint 转换复用模块契约，V2 回传 fail closed 到副本', () => {
    const src = readSrc('renderer/lib/extern-convert.js');
    assert.ok(src.includes("inst?.def?.exportAs?.('.pptx', inst.state)"), '外部打开必须复用 slide.exportAs，不得另造导出链');
    assert.ok(src.includes('migrateFromOutline, serializeDoc'), '外部 PPTX 回传必须迁移并序列化 V2');
    assert.ok(src.includes('slideExternalSidecarPaths(rec.origPath)'), 'V2 回传必须 fail closed 到副本，不得覆盖原生对象档');
    assert.ok(!/rec\.ext === 'mazzslide'[\s\S]{0,500}content: outline/.test(src), '原 .mazzslide 不得再写成 V1 大纲');
  });
  test('外部 PowerPoint 实际往返：V2 对象级导出，原档保留并生成回传副本', async () => {
    window.MazzCommands = window.MazzCommands || { execute: () => {} };
    window.MazzHost = window.MazzHost || { notifyChange: () => {}, openTab: () => {}, toast: () => {} };
    const files = new Map();
    const writes = new Map();
    window.mazz = {
      isElectron: true,
      invoke: async (channel, payload = {}) => {
        if (channel === 'workspace:get') return 'D:/workspace';
        if (channel === 'fs:mkdir') return true;
        if (channel === 'fs:writeFileBase64') { files.set(payload.path, payload.base64); return true; }
        if (channel === 'fs:readFileBase64') return files.get(payload.path);
        if (channel === 'fs:writeFile') { writes.set(payload.path, payload.content); return true; }
        if (channel === 'settings:get') return null;
        return null;
      },
    };
    const [{ default: slideModule }, docMod, external, { default: JSZip }] = await Promise.all([
      import('../../renderer/modules/slide/index.js'),
      import('../../renderer/modules/slide/doc.js'),
      import('../../renderer/lib/extern-convert.js'),
      import('jszip'),
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const state = slideModule.create(container);
    const doc = docMod.createSlideDoc('外部往返', 'paper');
    docMod.addSlideToDoc(doc, docMod.createSlide(null, { notes: '原生备注', items: [
      docMod.createItem('text', { text: 'V2 外部唯一标题', left: 10, top: 18, width: 80, height: 20, style: { size: 40, bold: true }, reveal: { mode: 'click', order: 1 } }),
      docMod.createItem('shape', { shape: 'ellipse', left: 25, top: 50, width: 50, height: 24, reveal: { mode: 'click', order: 2 } }),
    ] }));
    Object.assign(doc.layouts.main.frames[0], { transition: 'zoom', nextAfter: 7, actions: { stopTimer: true } });
    slideModule.setContent(docMod.serializeDoc(doc), state);
    const inst = { def: slideModule, state };
    const origPath = 'D:/workspace/外部往返.mazzslide';
    const prep = await external.prepareForExternalOpen({ filePath: origPath, title: '外部往返.mazzslide' }, inst, { name: 'PowerPoint' });
    assert.equal(prep.converted, true);
    assert.equal(prep.outExt, 'pptx');
    const b64 = files.get(prep.launchPath);
    assert.ok(b64?.length > 200, '必须产生真实 PPTX 二进制');
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    const slideXml = await zip.file('ppt/slides/slide1.xml').async('text');
    assert.ok(slideXml.includes('V2 外部唯一标题'), '外部打开必须消费 V2 doc2');
    assert.ok(slideXml.includes('ellipse'), 'V2 shape 必须进 PPTX，证明未降级成大纲');
    assert.equal(await external.handleExternalSave(prep.launchPath), true);
    const sidecars = external.slideExternalSidecarPaths(origPath);
    assert.equal(writes.has(origPath), false, '反向解析不保真时严禁覆盖原 V2 文件');
    assert.equal(files.get(sidecars.pptx), files.get(prep.launchPath), '外部修改的 PPTX 必须完整留存');
    const imported = JSON.parse(writes.get(sidecars.imported));
    assert.equal(imported.v, 2, '可对照导入副本必须是 V2 JSON');
    assert.equal(imported.theme, 'paper', '导入副本必须保留内部主题标识');
    assert.ok(Object.values(imported.slides).some(slide => slide.items?.some(item => item.type === 'text' && item.lines?.some(line => line.text === 'V2 外部唯一标题'))), '外部文本必须落入导入副本');
    const preserved = window.__activeSlideCtl.doc2;
    const preservedSlide = preserved.slides[preserved.layouts.main.frames[0].slideId];
    assert.equal(preservedSlide.notes, '原生备注');
    assert.ok(preservedSlide.items.some(item => item.type === 'shape' && item.shape === 'ellipse' && item.reveal?.order === 2));
    assert.deepEqual({ transition: preserved.layouts.main.frames[0].transition, nextAfter: preserved.layouts.main.frames[0].nextAfter, actions: preserved.layouts.main.frames[0].actions }, { transition: 'zoom', nextAfter: 7, actions: { stopTimer: true } });
    external.clearConvert(prep.launchPath);
    container.remove();
  });
});
