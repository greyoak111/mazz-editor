// renderer/modules/slide/render.js —— 幻灯片渲染（预览/放映/画布共用）
export function renderSlideHTML(slide, theme, { scale = 1, canvasMode = false } = {}) {
  const sections = (slide.sections || []).map(sec => `
    ${sec.heading ? `<div class="sl-sec-h" style="color:${theme.accent}">${escapeHtml(sec.heading)}</div>` : ''}
    <ul class="sl-bullets">
      ${(sec.bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}
    </ul>`).join('');

  const elements = (slide.elements || []).map((el, i) => {
    const common = `left:${el.x}%;top:${el.y}%;width:${el.w}%;height:${el.h}%;`;
    if (el.type === 'text') {
      const st = el.style || {};
      const css = [
        `color:${st.color || el.color || theme.fg}`,
        `font-size:${st.size || el.fontSize || 1.4}em`,
        st.family ? `font-family:'${st.family}'` : '',
        st.bold ? 'font-weight:700' : '',
        st.italic ? 'font-style:italic' : '',
        st.align ? `text-align:${st.align}` : '',
        `line-height:${st.lineHeight || 1.4}`,
      ].filter(Boolean).join(';');
      return `<div class="sl-el sl-el-text" data-el="${i}" style="${common}${css}">${escapeHtml(el.text || '')}</div>`;
    }
    if (el.type === 'rect') {
      return `<div class="sl-el" data-el="${i}" style="${common}background:${el.fill || theme.accent};border-radius:4px"></div>`;
    }
    if (el.type === 'ellipse') {
      return `<div class="sl-el" data-el="${i}" style="${common}background:${el.fill || theme.accent};border-radius:50%"></div>`;
    }
    if (el.type === 'image') {
      return `<img class="sl-el" data-el="${i}" style="${common}object-fit:contain" src="${el.src}" alt="">`;
    }
    return '';
  }).join('');

  const slideBg = slide.bg || theme.bg;
  return `
  <div class="sl-slide ${canvasMode ? 'canvas-mode' : ''}" style="
    background:${slideBg};color:${theme.fg};font-family:${theme.font};
    transform:scale(${scale});transform-origin:top center;">
    ${slide.title ? `<div class="sl-title" style="color:${theme.titleColor};font-size:${theme.titleSize / 16}em;border-bottom-color:${theme.accent}">${escapeHtml(slide.title)}</div>` : ''}
    <div class="sl-content" style="font-size:${theme.bodySize / 16}em">${sections}</div>
    <div class="sl-elements">${elements}</div>
  </div>`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
