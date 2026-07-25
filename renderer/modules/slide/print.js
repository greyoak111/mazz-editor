// renderer/modules/slide/print.js —— 演示打印预览：每页一张幻灯片（主题色渲染）
import { openPrintPreview } from '../../lib/print-preview.js';

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

/** 入口：演示打印预览（默认横向） */
export function openSlidePrintPreview(ctl, title) {
  const setup = ctl.printSetup || (ctl.printSetup = { size: 'A4', orientation: 'landscape', margins: { top: 8, right: 8, bottom: 8, left: 8 }, pageno: false });
  const theme = ctl.theme;
  openPrintPreview({
    title: title || '演示文稿',
    setup,
    buildPages: (s) => { Object.assign(setup, s); return buildSlidePages(ctl.slides, theme); },
  });
}

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
