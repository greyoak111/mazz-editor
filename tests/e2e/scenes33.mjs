// tests/e2e/scenes33.mjs —— 波次四十二「pptx 互通」实证批
// 对象级导出（六类型齐+禁用页隐藏+备注+reveal timing 注入+spid 对齐） / LibreOffice 开卷冒烟 / 导入降级文本+图片闭环
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import JSZip from 'jszip';

export async function scenes33({ win, human, WS, scenario }) {
  const evaluate = (fn, arg) => win.evaluate(fn, arg);
  const wait = (ms) => win.waitForTimeout(ms);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-pptx-'));

  // ==================== 0：造档（页1 六类型齐 / 页2 reveal 两序 / 页3 禁用） ====================
  await evaluate(() => window.MazzCommands?.execute('file.newSlide'));
  await human.until(() => window.__activeSlideCtl?.isV2 === true, { timeout: 9000, msg: 'v2 就绪' });
  await evaluate(async () => {
    const ctl = window.__activeSlideCtl;
    const m = await import('./modules/slide/doc.js');
    const doc = ctl.doc2;
    const F = doc.layouts.main.frames;
    const s1 = doc.slides[F[0].slideId];
    s1.notes = '首页备注';
    s1.items.push(
      m.createItem('shape', { left: 60, top: 55, width: 16, height: 20, shape: 'diamond', style: { bg: '#4f46e5', stroke: '#a5b4fc' } }),
      m.createItem('table', { left: 5, top: 58, width: 40, height: 24, table: { rows: [{ cells: [{ text: '表头A' }, { text: '表头B' }] }, { cells: [{ text: '1' }, { text: '2' }] }] } }),
      m.createItem('image', { left: 80, top: 55, width: 15, height: 22, src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }),
      m.createItem('timer', { left: 80, top: 82, width: 14, height: 10, timer: { kind: 'countdown', target: 300 } }),
      m.createItem('variable', { left: 60, top: 84, width: 14, height: 8, variable: { key: 'page' } }),
      m.createItem('ink', { left: 30, top: 80, width: 24, height: 14, ink: { strokes: [{ color: '#ffcc00', width: 3, points: [{ x: 5, y: 80 }, { x: 30, y: 50 }, { x: 60, y: 70 }, { x: 95, y: 20 }] }] } }),
    );
    // 页2：reveal 两序
    const s2 = m.createSlide(null, { items: [
      m.createItem('text', { text: '首现', left: 10, top: 20, width: 40, height: 12 }),
      m.createItem('text', { text: '一揭', left: 10, top: 40, width: 40, height: 12, reveal: { mode: 'click', order: 1 } }),
      m.createItem('text', { text: '二揭', left: 10, top: 60, width: 40, height: 12, reveal: { mode: 'click', order: 2 } }),
    ] });
    doc.slides[s2.id] = s2;
    F.push(m.createFrame(s2.id));
    // 页3：禁用
    const s3 = m.createSlide(null, { items: [m.createItem('text', { text: '隐藏页', left: 10, top: 40, width: 60, height: 14 })] });
    doc.slides[s3.id] = s3;
    F.push(m.createFrame(s3.id, { disabled: true }));
    ctl.renderV2All();
  });
  await wait(300);

  // ==================== 1：对象级导出 ====================
  await scenario('pptx·对象级导出六类型齐', async () => {
    const out = path.join(outDir, '对象级.pptx');
    await evaluate((p) => window.MazzCommands?.execute('slide.exportPptx', { path: p }), out);
    await wait(1500);
    const ok = fs.existsSync(out) && fs.statSync(out).size > 5000;
    await human.assert(ok, `pptx 必须出档（${fs.existsSync(out) ? fs.statSync(out).size : '无'}B）`);
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const s1 = await zip.file('ppt/slides/slide1.xml').async('text');
    const s2 = await zip.file('ppt/slides/slide2.xml').async('text');
    const s3 = await zip.file('ppt/slides/slide3.xml').async('text');
    const media = Object.keys(zip.files).filter(n => n.startsWith('ppt/media/'));
    const r = {
      diamond: s1.includes('prst="diamond"'), table: s1.includes('graphicFrame') && s1.includes('表头A'),
      timer: s1.includes('05:00'), variable: s1.includes('{page}'),
      mediaN: media.length, // 图片+ink PNG=2
      notes1: (await zip.file('ppt/notesSlides/notesSlide1.xml')?.async('text').catch(() => ''))?.includes('首页备注'),
      hidden3: /<p:sld[^>]*show="0"/.test(s3) || /show="0"/.test(s3),
      timing: s2.includes('<p:timing>') && s2.includes('clickEffect'),
      clickN: (s2.match(/nodeType="clickEffect"/g) || []).length,
      spidN: (s2.match(/<p:spTgt spid="/g) || []).length,
      noTiming1: !s1.includes('<p:timing>'),
    };
    human.log('导出:', JSON.stringify(r));
    await human.assert(r.diamond, 'shape 必须映射 diamond');
    await human.assert(r.table, 'table 必须映射 graphicFrame 且保文本');
    await human.assert(r.timer && r.variable, 'timer/variable 必须静态文本降级');
    await human.assert(r.mediaN >= 2, `图片+ink PNG 必须双嵌（media=${r.mediaN}）`);
    await human.assert(r.notes1, '备注必须随迁');
    await human.assert(r.hidden3, '禁用帧必须转隐藏页');
    await human.assert(r.timing && r.clickN === 2 && r.spidN === 2, `reveal 必须两序单击（click=${r.clickN},spid=${r.spidN}）`);
    await human.assert(r.noTiming1, '无 reveal 页不得注 timing');
    // LibreOffice 开卷冒烟（OOXML 合法性实证）
    let lo = 'skip';
    try {
      execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, out], { timeout: 90000 });
      lo = fs.existsSync(out.replace(/\.pptx$/, '.pdf')) ? 'pdf-ok' : 'pdf-miss';
    } catch (e) { lo = 'err:' + String(e.message).slice(0, 60); }
    human.log('LO 冒烟:', lo);
    await human.assert(lo === 'pdf-ok', `LibreOffice 必须开卷不炸（${lo}——timing 注入合法性实锤）`);
  });

  // ==================== 2：导入降级闭环 ====================
  await scenario('pptx·导入降级文本图片', async () => {
    // runner 侧造外部 pptx（pptxgenjs Node 直跑——渲染层裸说明符进不去）
    const { default: PptxGenJS } = await import('pptxgenjs');
    const px = new PptxGenJS();
    px.defineLayout({ name: 'M', width: 10, height: 5.625 }); px.layout = 'M';
    const s0 = px.addSlide();
    s0.addText('外部标题', { x: 0.4, y: 0.3, w: 9, h: 0.8, placeholder: 'title' });
    s0.addText([{ text: '外部要点一', options: { bullet: { code: '2022' }, breakLine: true } }, { text: '外部要点二', options: { bullet: { code: '2022' }, breakLine: true } }], { x: 0.6, y: 1.4, w: 9, h: 1 });
    s0.addImage({ data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', x: 1, y: 3, w: 2, h: 1.5 });
    const srcBuf = await px.write({ outputType: 'base64' });
    // renderer 侧 pptxToOutline 直喂（S2 链已被 run3 覆盖，本场景验降级映射本体）
    const r = await evaluate(async (b64) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const outline = await window.__externConvert.pptxToOutline(buf.buffer);
      // 大纲进 v2（S2 链同款 parseDoc 迁移）
      const m = await import('./modules/slide/doc.js');
      const doc = m.parseDoc(outline);
      const F = doc?.layouts?.main?.frames || [];
      const sl = doc?.slides?.[F[0]?.slideId];
      return {
        outlineHead: outline.split('\n')[0],
        hasBullet: outline.includes('- 外部要点一'),
        hasCanvas: outline.includes('<!--canvas:'),
        v: doc?.v,
        imgItem: sl?.items?.find(i => i.type === 'image')?.src?.slice(0, 22),
        title: sl?.items?.find(i => i.type === 'text')?.lines?.[0]?.text,
      };
    }, srcBuf);
    human.log('导入:', JSON.stringify(r));
    await human.assert(r.outlineHead === '# 外部标题', `标题必须还原（${r.outlineHead}）`);
    await human.assert(r.hasBullet, '要点必须还原');
    await human.assert(r.hasCanvas, '图片必须走 canvas 注释随迁');
    await human.assert(r.v === 2 && r.imgItem?.startsWith('data:image/png'), `迁移 v2 必须落 image Item（${r.imgItem}——S2 链闭环实锤）`);
    await human.assert(r.title === '外部标题', 'v2 标题 Item 必须落');
  });
}
