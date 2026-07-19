// renderer/modules/markdown/docx-io.js —— docx 进出：Packer 导出（样式映射）/ mammoth 导入
import { PAGE_SIZES } from './paginate.js';

const HEADING = ['HEADING_1', 'HEADING_2', 'HEADING_3', 'HEADING_4', 'HEADING_5', 'HEADING_6'];

// ==================== 导出 ====================
/** 默认样式映射表（可在「Word 样式映射」设置中覆盖；size 单位为半磅） */
export const DEFAULT_STYLE_MAP = {
  h1: { size: 32, bold: true, color: '2E74B5', font: '' },
  h2: { size: 26, bold: true, color: '2E74B5', font: '' },
  h3: { size: 24, bold: true, color: '1F4E79', font: '' },
  h4: { size: 22, bold: true, color: '1F4E79', font: '' },
  h5: { size: 20, bold: true, color: '404040', font: '' },
  h6: { size: 18, bold: true, color: '404040', font: '' },
  body: { size: 21, font: '' },
  code: { size: 20, font: 'Consolas' },
  quote: { size: 21, italics: true, color: '6B7280', font: '' },
};

export async function exportDocx(doc, { setup, title = '文档', styleMap = {} } = {}) {
  const docx = await import('docx');
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    Header, Footer, PageNumber, ExternalHyperlink, ImageRun, ShadingType,
    TableOfContents, PageBreak, LevelFormat, CommentRangeStart, CommentRangeEnd,
  } = docx;
  const sm = Object.fromEntries(Object.entries(DEFAULT_STYLE_MAP).map(([k, v]) => [k, { ...v, ...(styleMap[k] || {}) }]));

  const endnotes = []; // 尾注收集
  const comments = []; // 批注收集（ICommentOptions）
  let footnoteSeq = 0;
  let commentSeq = 0;

  function runsFromInline(node, opts = {}) {
    const runs = [];
    node.forEach((child) => {
      if (child.type.name === 'text') {
        const marks = child.marks || [];
        const link = marks.find(m => m.type.name === 'link');
        const fs = marks.find(m => m.type.name === 'fontStyle')?.attrs || {};
        const rd = opts.runDefaults || {};
        const base = {
          text: child.text,
          bold: marks.some(m => m.type.name === 'strong') || opts.bold || rd.bold || undefined,
          italics: marks.some(m => m.type.name === 'em') || rd.italics || undefined,
          strike: marks.some(m => m.type.name === 'strike'),
          font: marks.some(m => m.type.name === 'code') ? (sm.code.font || 'Consolas') : (fs.family || rd.font || undefined),
          size: fs.size ? Math.round(fs.size * 2) : (rd.size || undefined),
          color: fs.color ? fs.color.replace('#', '') : (rd.color || undefined),
          shading: fs.highlight ? { fill: fs.highlight.replace('#', '') } : undefined,
          superScript: fs.script === 'sup',
          subScript: fs.script === 'sub',
        };
        if (link) {
          runs.push(new ExternalHyperlink({
            children: [new TextRun({ ...base, style: 'Hyperlink' })],
            link: link.attrs.href,
          }));
        } else {
          runs.push(new TextRun(base));
        }
        // 批注 mark → Word CommentRange（样式映射 opts.runDefaults 在 base 已并入）
        const cm = marks.find(m => m.type.name === 'comment');
        if (cm) {
          const cid = ++commentSeq;
          comments.push({ id: cid, author: 'Mazz', date: new Date(), children: [new Paragraph(cm.attrs.text || '')] });
          const startIdx = runs.length - 1;
          runs.splice(startIdx, 0, new CommentRangeStart(cid));
          runs.push(new CommentRangeEnd(cid));
        }
      } else if (child.type.name === 'hard_break') {
        runs.push(new TextRun({ break: 1 }));
      } else if (child.type.name === 'footnote') {
        footnoteSeq++;
        endnotes.push({ id: footnoteSeq, note: child.attrs.note });
        runs.push(new TextRun({ text: `[${footnoteSeq}]`, superScript: true }));
      } else if (child.type.name === 'image') {
        // 图片在段级处理（ImageRun 可直接内联）
        runs.push({ __image: child });
      }
    });
    return runs;
  }

  const ALIGN_MAP = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED, distributed: AlignmentType.JUSTIFIED };
  function blockProps(node) {
    const a = node.attrs || {};
    const props = {};
    if (a.align && ALIGN_MAP[a.align]) props.alignment = ALIGN_MAP[a.align];
    if (a.indent) props.indent = { firstLine: Math.round(a.indent * 240) };
    if (a.lineHeight) props.spacing = { line: Math.round(a.lineHeight * 240) };
    if (a.spacingBefore != null) props.spacing = { ...(props.spacing || {}), before: Math.round(a.spacingBefore * 240) };
    if (a.spacingAfter != null) props.spacing = { ...(props.spacing || {}), after: Math.round(a.spacingAfter * 240) };
    return props;
  }

  async function resolveImages(runs) {
    const out = [];
    for (const r of runs) {
      if (r && r.__image) {
        const src = r.__image.attrs.src || '';
        try {
          if (src.startsWith('file://') && window.mazz?.isElectron) {
            const b64 = await window.mazz.invoke('fs:readFileBase64', { path: src.replace('file://', '') });
            out.push(new ImageRun({
              data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)),
              transformation: { width: 480, height: 320 },
            }));
          } else if (src.startsWith('data:')) {
            out.push(new ImageRun({
              data: Uint8Array.from(atob(src.split(',')[1]), c => c.charCodeAt(0)),
              transformation: { width: 480, height: 320 },
            }));
          } else {
            out.push(new TextRun({ text: `[图片: ${src}]`, italics: true }));
          }
        } catch {
          out.push(new TextRun({ text: `[图片加载失败: ${src}]`, italics: true }));
        }
      } else out.push(r);
    }
    return out;
  }

  const children = [];

  // 目录页
  if (setup?.toc) {
    children.push(new Paragraph({ text: '目录', heading: HeadingLevel.HEADING_1, pageBreakBefore: false }));
    children.push(new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-3' }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  async function addList(node, level, ordered) {
    for (const li of node.content.content) {
      const para = li.content.content[0];
      const runs = para ? await resolveImages(runsFromInline(para)) : [];
      children.push(new Paragraph({
        children: runs,
        ...(ordered
          ? { numbering: { reference: 'mazz-num', level } }
          : { bullet: { level } }),
        spacing: { after: 60 },
      }));
      // 嵌套列表
      li.content.content.forEach(sub => {
        if (sub.type.name === 'bullet_list' || sub.type.name === 'ordered_list') {
          addList(sub, level + 1, sub.type.name === 'ordered_list');
        }
      });
    }
  }

  for (const node of doc.content.content) {
    const t = node.type.name;
    if (t === 'heading') {
      const bp = blockProps(node);
      children.push(new Paragraph({
        children: await resolveImages(runsFromInline(node, { runDefaults: sm['h' + node.attrs.level] || {} })),
        heading: HeadingLevel[HEADING[node.attrs.level - 1]],
        ...bp,
        spacing: { before: 240, after: 120, ...(bp.spacing || {}) },
        ...(bp.alignment ? { alignment: bp.alignment } : {}),
        ...(bp.indent ? { indent: bp.indent } : {}),
      }));
    } else if (t === 'paragraph') {
      const bp = blockProps(node);
      children.push(new Paragraph({
        children: await resolveImages(runsFromInline(node, { runDefaults: sm.body })),
        spacing: { after: 120, line: 360, ...(bp.spacing || {}) },
        ...(bp.alignment ? { alignment: bp.alignment } : {}),
        ...(bp.indent ? { indent: bp.indent } : {}),
      }));
    } else if (t === 'blockquote') {
      for (const p of node.content.content) {
        children.push(new Paragraph({
          children: runsFromInline(p, { runDefaults: sm.quote }),
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: '818CF8' } },
          spacing: { after: 120 },
        }));
      }
    } else if (t === 'code_block') {
      for (const line of node.textContent.split('\n')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })],
          shading: { type: ShadingType.SOLID, color: 'F1F5F9' },
          spacing: { after: 0 },
        }));
      }
      children.push(new Paragraph({ spacing: { after: 120 } }));
    } else if (t === 'bullet_list') {
      await addList(node, 0, false);
    } else if (t === 'ordered_list') {
      await addList(node, 0, true);
    } else if (t === 'horizontal_rule') {
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
        spacing: { after: 200 },
      }));
    } else if (t === 'table') {
      const rows = [];
      for (const row of node.content.content) {
        const cells = [];
        for (const cell of row.content.content) {
          const isHeader = cell.type.name === 'table_header';
          const paras = [];
          for (const p of cell.content.content) {
            paras.push(new Paragraph({ children: runsFromInline(p, { bold: isHeader }) }));
          }
          cells.push(new TableCell({
            children: paras,
            shading: isHeader ? { type: ShadingType.SOLID, color: 'E2E8F0' } : undefined,
          }));
        }
        rows.push(new TableRow({ children: cells, tableHeader: row.content.content[0]?.type.name === 'table_header' }));
      }
      children.push(new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
      children.push(new Paragraph({ spacing: { after: 120 } }));
    }
  }

  // 尾注区
  if (endnotes.length) {
    children.push(new Paragraph({ text: '尾注', heading: HeadingLevel.HEADING_2, pageBreakBefore: true }));
    for (const n of endnotes) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `[${n.id}] `, superScript: true }),
          new TextRun({ text: n.note }),
        ],
      }));
    }
  }

  // 页面设置
  const size = PAGE_SIZES[setup?.size || 'A4'];
  const landscape = setup?.orientation === 'landscape';
  const [pw, ph] = landscape ? [size.h, size.w] : [size.w, size.h];
  const marginTwip = Math.round((setup?.margin ?? 25) * 56.7);

  const headers = setup?.header ? {
    default: new Header({
      children: [new Paragraph({ children: [new TextRun(setup.header)], alignment: AlignmentType.CENTER })],
    }),
  } : undefined;
  const footers = (setup?.footer || setup?.pageno) ? {
    default: new Footer({
      children: [new Paragraph({
        children: [
          ...(setup.footer ? [new TextRun(setup.footer + '  ')] : []),
          ...(setup.pageno ? [
            new TextRun('第 '), new TextRun({ children: [PageNumber.CURRENT] }),
            new TextRun(' 页 / 共 '), new TextRun({ children: [PageNumber.TOTAL_PAGES] }), new TextRun(' 页'),
          ] : []),
        ],
        alignment: AlignmentType.CENTER,
      })],
    }),
  } : undefined;

  const document = new Document({
    creator: 'Mazz Editor',
    title,
    ...(comments.length ? { comments: { children: comments } } : {}),
    numbering: {
      config: [{
        reference: 'mazz-num',
        levels: [0, 1, 2, 3].map(level => ({
          level,
          format: LevelFormat.DECIMAL,
          text: '%' + (level + 1) + '.',
          alignment: AlignmentType.START,
        })),
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: Math.round(pw * 56.7), height: Math.round(ph * 56.7), orientation: landscape ? 'landscape' : 'portrait' },
          margin: { top: marginTwip, bottom: marginTwip, left: marginTwip, right: marginTwip },
        },
      },
      headers, footers,
      children,
    }],
  });

  // 浏览器/渲染进程环境无 Node Buffer：用 toBlob 转 ArrayBuffer
  const blob = await Packer.toBlob(document);
  return blob.arrayBuffer();
}

// ==================== 导入（mammoth → HTML → PM DOMParser） ====================
export async function importDocx(schema, arrayBuffer) {
  const mammoth = await import('mammoth');
  // Buffer/Uint8Array → 真正的 ArrayBuffer（mammoth 只认 arrayBuffer 形态）
  const ab = arrayBuffer instanceof ArrayBuffer
    ? arrayBuffer
    : arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
  // Node 环境 mammoth 走 buffer 输入；浏览器/渲染进程走 arrayBuffer
  let result;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(arrayBuffer)) {
    result = await mammoth.convertToHtml({ buffer: arrayBuffer });
  } else {
    result = await mammoth.convertToHtml({ arrayBuffer: ab });
  }
  const html = result.value || '';
  const { DOMParser } = await import('prosemirror-model');
  const div = document.createElement('div');
  div.innerHTML = html;
  const doc = DOMParser.fromSchema(schema).parse(div);
  return { doc, warnings: result.messages?.map(m => m.message) || [] };
}
