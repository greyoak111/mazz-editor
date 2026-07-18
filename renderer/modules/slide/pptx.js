// renderer/modules/slide/pptx.js —— PptxGenJS 编译器：大纲 + 主题 + 画布元素 → .pptx
export async function exportPptx(slides, theme, { fileName = '演示文稿' } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'MAZZ', width: 10, height: 5.625 });
  pptx.layout = 'MAZZ';
  pptx.theme = { headFontFace: theme.font.split(',')[0].replace(/"/g, ''), bodyFontFace: theme.font.split(',')[0].replace(/"/g, '') };

  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.bg.replace('#', '') };
    let y = 0.3;
    if (s.title) {
      slide.addText(s.title, {
        x: 0.4, y, w: 9.2, h: 0.8, fontSize: theme.titleSize, bold: true,
        color: theme.titleColor.replace('#', ''), fontFace: pptx.theme.headFontFace,
      });
      y += 1.0;
      // 标题下划线
      slide.addShape('line', {
        x: 0.4, y, w: 3.2, h: 0, line: { color: theme.accent.replace('#', ''), width: 2 },
      });
      y += 0.25;
    }
    for (const sec of s.sections || []) {
      if (sec.heading) {
        slide.addText(sec.heading, {
          x: 0.4, y, w: 9.2, h: 0.45, fontSize: Math.round(theme.bodySize * 1.15), bold: true,
          color: theme.accent.replace('#', ''), fontFace: pptx.theme.headFontFace,
        });
        y += 0.5;
      }
      if (sec.bullets?.length) {
        const texts = sec.bullets.map(b => ({ text: b, options: { bullet: { code: '2022' }, breakLine: true } }));
        slide.addText(texts, {
          x: 0.6, y, w: 9.0, h: Math.max(0.5, sec.bullets.length * 0.42),
          fontSize: theme.bodySize, color: theme.fg.replace('#', ''), fontFace: pptx.theme.bodyFontFace,
          paraSpaceAfter: 8,
        });
        y += sec.bullets.length * 0.42 + 0.15;
      }
    }
    // 画布元素（v1 映射原生形状；复杂元素远期降级为 PNG）
    for (const el of s.elements || []) {
      const x = el.x / 100 * 10, yy = el.y / 100 * 5.625, w = el.w / 100 * 10, h = el.h / 100 * 5.625;
      if (el.type === 'text') {
        slide.addText(el.text || '', {
          x, y: yy, w, h, fontSize: (el.fontSize || 1.4) * 14, color: (el.color || theme.fg).replace('#', ''),
        });
      } else if (el.type === 'rect') {
        slide.addShape('rect', { x, y: yy, w, h, fill: { color: (el.fill || theme.accent).replace('#', '') } });
      } else if (el.type === 'ellipse') {
        slide.addShape('ellipse', { x, y: yy, w, h, fill: { color: (el.fill || theme.accent).replace('#', '') } });
      } else if (el.type === 'image' && el.src) {
        try {
          if (el.src.startsWith('data:')) slide.addImage({ data: el.src, x, y: yy, w, h });
          else slide.addImage({ path: el.src.replace(/^file:\/\//, ''), x, y: yy, w, h });
        } catch (e) { console.warn('[pptx] 图片嵌入失败:', e.message); }
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  return pptx.write({ outputType: 'arraybuffer' });
}
