// renderer/modules/slide/print.js —— 演示打印预览：每页一张幻灯片（主题色渲染）
import { openPrintPreview } from '../../lib/print-preview.js';
import { renderPageCanvas } from './canvas.js';
import { DESIGN } from './doc.js';

/** 单页幻灯片 HTML（按主题渲染标题/小节/要点） */
export function slidePageHtml(slide, theme, idx, total) {
  const sections = (slide.sections || []).map(s => `
    ${s.heading ? `<div style="font-size:${Math.round(theme.bodySize * 1.1)}px;font-weight:600;color:${theme.accent};margin:10px 0 4px">${esc(s.heading)}</div>` : ''}
    ${(s.bullets || []).map(b => `<div style="font-size:${theme.bodySize}px;line-height:1.7;color:${theme.fg};padding-left:${(b.lvl || 0) * 18}px">• ${esc(b.text)}</div>`).join('')}
  `).join('');
  return `<div style="width:100%;height:100%;background:${theme.bg};border-radius:6px;padding:26px 30px;box-sizing:border-box;display:flex;flex-direction:column">
    <div style="font-size:${theme.titleSize}px;font-weight:700;color:${theme.titleColor};font-family:${theme.font};line-height:1.3">${esc(slide.title || '')}</div>
    <div style="width:64px;height:4px;background:${theme.accent};border-radius:2px;margin:12px 0 6px"></div>
    <div style="flex:1;font-family:${theme.font}">${sections}</div>
    <div style="text-align:right;font-size:11px;color:${theme.fg};opacity:.55;font-family:${theme.font}">${idx + 1} / ${total}</div>
  </div>`;
}

export function buildSlidePages(slides, theme) {
  return (slides || []).map((s, i) => slidePageHtml(s, theme, i, slides.length));
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function safeCssColor(value, fallback = '#1a1a1e') {
  const valid = candidate => /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(\s*[-+0-9.,%/\s]+\)|[a-z]{1,32})$/i.test(String(candidate || '').trim());
  if (valid(value)) return String(value).trim();
  if (valid(fallback)) return String(fallback).trim();
  return '#1a1a1e';
}

/** V2 对象页打印 HTML：直接消费 Item 模型，不降级成 V1 大纲。 */
export function slideDocPageHtml(slide, theme, idx, total) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${DESIGN.w} ${DESIGN.h}`,
    preserveAspectRatio: 'xMidYMid meet',
    xmlns: 'http://www.w3.org/2000/svg',
  });
  svg.style.cssText = 'display:block;width:100%;height:100%';
  const viewport = svgEl('g');
  svg.appendChild(viewport);
  const printSlide = slide ? { ...slide, bg: safeCssColor(slide.bg, theme?.bg) } : slide;
  renderPageCanvas(svgEl, viewport, printSlide, theme, { outW: DESIGN.w, outH: DESIGN.h });
  // 不把文档内的 bg/font 直接拼进 HTML 属性：.mazzslide 是可导入文件，
  // DOM style API 会拒绝非法 CSS，outerHTML 会完成属性转义。
  const page = document.createElement('div');
  page.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden;border-radius:6px;box-sizing:border-box';
  page.style.background = printSlide?.bg || safeCssColor(theme?.bg);
  page.appendChild(svg);
  const counter = document.createElement('div');
  counter.style.cssText = 'position:absolute;right:12px;bottom:8px;font-size:11px;opacity:.55';
  counter.style.color = safeCssColor(theme?.fg, '#eeeeee');
  counter.style.fontFamily = theme?.font || 'sans-serif';
  counter.textContent = `${idx + 1} / ${total}`;
  page.appendChild(counter);
  return page.outerHTML;
}

export function buildSlideDocPages(doc, theme) {
  const slides = (doc?.layouts?.main?.frames || []).map(frame => doc?.slides?.[frame.slideId]).filter(Boolean);
  return slides.map((slide, i) => slideDocPageHtml(slide, theme, i, slides.length));
}

/** 打印与 PDF 的单一取数口：V2 读 doc2，仅旧档回落 slides。 */
export function buildSlidePagesForController(ctl) {
  if (ctl?.isV2 && ctl.doc2) return buildSlideDocPages(ctl.doc2, ctl.theme);
  return buildSlidePages(ctl?.slides, ctl?.theme);
}

/** 入口：演示打印预览（默认横向） */
export function openSlidePrintPreview(ctl, title) {
  const setup = ctl.printSetup || (ctl.printSetup = { size: 'A4', orientation: 'landscape', margins: { top: 8, right: 8, bottom: 8, left: 8 }, pageno: false });
  openPrintPreview({
    title: title || '演示文稿',
    setup,
    buildPages: (s) => { Object.assign(setup, s); return buildSlidePagesForController(ctl); },
  });
}

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
