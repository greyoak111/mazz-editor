// renderer/modules/markdown/paginate.js —— 分页预览（纸张模式）+ 页面设置 + 目录面板
import { modal } from '../../shell/shell.js';

export const PAGE_SIZES = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  A6: { w: 105, h: 148 },
  B4: { w: 250, h: 353 },
  B5: { w: 176, h: 250 },
  Letter: { w: 216, h: 279 },
  Legal: { w: 216, h: 356 },
  Executive: { w: 184, h: 267 },
  '16K': { w: 184, h: 260 },
};
export const DEFAULT_SETUP = {
  size: 'A4', orientation: 'portrait',
  margins: { top: 25, right: 25, bottom: 25, left: 25 },
  header: '', footer: '', pageno: true, toc: false,
};

/** 页边距规整：兼容旧的单值 margin → 四边对象 */
export function normalizeMargins(setup) {
  const m = setup?.margins;
  if (m && typeof m === 'object') {
    const n = (v, d) => Math.max(0, Math.min(80, Number.isFinite(+v) ? +v : d));
    return { top: n(m.top, 25), right: n(m.right, 25), bottom: n(m.bottom, 25), left: n(m.left, 25) };
  }
  const v = Math.max(0, Math.min(80, +setup?.margin || 25));
  return { top: v, right: v, bottom: v, left: v };
}
const MM = 96 / 25.4; // mm → px

/** 从 markdown 文本提取页面配置注释 <!--page:{...}--> */
export function extractPageSetup(text) {
  const m = /^\s*<!--page:(\{.*?\})-->/m.exec(text || '');
  if (!m) return { setup: { ...DEFAULT_SETUP }, body: text };
  try { return { setup: { ...DEFAULT_SETUP, ...JSON.parse(m[1]) }, body: text.replace(m[0], '').replace(/^\s*\n/, '') }; }
  catch { return { setup: { ...DEFAULT_SETUP }, body: text }; }
}
export function serializePageSetup(setup) {
  if (JSON.stringify(setup) === JSON.stringify(DEFAULT_SETUP)) return '';
  return `<!--page:${JSON.stringify(setup)}-->\n`;
}

/** 提取文档标题（目录/导出用） */
export function extractHeadings(doc) {
  const heads = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      heads.push({ level: node.attrs.level, text: node.textContent, pos });
    }
    return true;
  });
  return heads;
}

// ==================== 分页预览（应用内浮动窗口：可拖动/拉伸/最大化/Esc 关闭） ====================
export async function openPagePreview(view, setup, { title = '文档' } = {}) {
  const { openAppWindow } = await import('../../lib/app-window.js');
  const wrap = document.createElement('div');
  wrap.className = 'page-preview-wrap';
  wrap.style.flex = '1';
  const win = openAppWindow({
    title: `分页预览 · ${escapeHtml(setup.size)} · ${setup.orientation === 'portrait' ? '纵向' : '横向'} · ${title}`,
    widthRatio: 0.8, heightRatio: 0.88,
    onClose: () => view.focus(),
  });
  win.body.appendChild(wrap);

  // —— 测量：克隆编辑内容到离屏容器 ——
  const size = PAGE_SIZES[setup.size] || PAGE_SIZES.A4;
  const [pw, ph] = setup.orientation === 'portrait' ? [size.w, size.h] : [size.h, size.w];
  const mg = normalizeMargins(setup);
  const contentW = (pw - mg.left - mg.right) * MM;
  const contentH = (ph - mg.top - mg.bottom) * MM;
  const headerH = setup.header ? 0 : 0;
  const measure = document.createElement('div');
  measure.className = 'pm-page page-measure';
  measure.style.cssText = `position:fixed;left:-10000px;top:0;width:${contentW}px;visibility:hidden`;
  const clone = view.dom.cloneNode(true);
  clone.removeAttribute('contenteditable');
  measure.appendChild(clone);
  document.body.appendChild(measure);

  // 逐块测量并装箱
  const blocks = [...measure.children[0].children];
  const pages = [[]];
  let used = 0;
  for (const b of blocks) {
    const h = b.offsetHeight || 20;
    if (used + h > contentH && pages[pages.length - 1].length) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(b);
    used += h;
  }
  // 目录页
  if (setup.toc) {
    const heads = extractHeadings(view.state.doc);
    if (heads.length) {
      const tocPage = document.createElement('div');
      tocPage.innerHTML = `<h2 style="margin-bottom:12px">目录</h2>` + heads.map(h =>
        `<div style="padding-left:${(h.level - 1) * 18}px;line-height:2;font-size:14px">${escapeHtml(h.text)}</div>`).join('');
      pages.unshift([tocPage]);
    }
  }

  pages.forEach((blocks, i) => {
    const page = document.createElement('div');
    page.className = 'page-sheet';
    page.style.cssText = `width:${pw}mm;height:${ph}mm;padding:${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm;`;
    if (setup.header) page.innerHTML += `<div class="page-header">${escapeHtml(setup.header)}</div>`;
    const body = document.createElement('div');
    body.className = 'page-body';
    body.style.height = `calc(100% - ${(setup.header ? 20 : 0) + (setup.footer || setup.pageno ? 20 : 0)}px)`;
    for (const b of blocks) body.appendChild(b);
    page.appendChild(body);
    const foot = document.createElement('div');
    foot.className = 'page-footer';
    foot.textContent = setup.footer || (setup.pageno ? `第 ${i + 1} 页 / 共 ${pages.length} 页` : '');
    if (setup.footer && setup.pageno) foot.textContent = `${setup.footer} · 第 ${i + 1} 页 / 共 ${pages.length} 页`;
    if (setup.footer || setup.pageno) page.appendChild(foot);
    wrap.appendChild(page);
  });
  measure.remove();
}

// ==================== 页面设置面板 ====================
export function openPageSetupDialog(setup, onSave) {
  const mg = normalizeMargins(setup);
  const m = modal('页面设置');
  m.body.innerHTML = `
    <div class="set-row"><label>纸张大小</label><select id="ps-size" class="rb-select">
      ${Object.keys(PAGE_SIZES).map(s => `<option value="${s}">${s}（${PAGE_SIZES[s].w}×${PAGE_SIZES[s].h}mm）</option>`).join('')}</select></div>
    <div class="set-row"><label>方向</label><select id="ps-orient" class="rb-select">
      <option value="portrait">纵向</option><option value="landscape">横向</option></select></div>
    <div class="set-row"><label>页边距 (mm)</label>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;flex:1">
        <input id="ps-mt" class="rb-input" type="number" min="0" max="80" value="${mg.top}" title="上">
        <input id="ps-mr" class="rb-input" type="number" min="0" max="80" value="${mg.right}" title="右">
        <input id="ps-mb" class="rb-input" type="number" min="0" max="80" value="${mg.bottom}" title="下">
        <input id="ps-ml" class="rb-input" type="number" min="0" max="80" value="${mg.left}" title="左">
      </div></div>
    <div class="set-row"><label></label><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;flex:1;font-size:11px;color:var(--fg-dim)"><span>上</span><span>右</span><span>下</span><span>左</span></div></div>
    <div class="set-row"><label>页眉文本</label><input id="ps-header" class="rb-input" value="${escapeAttr(setup.header)}" placeholder="（留空则无页眉）"></div>
    <div class="set-row"><label>页脚文本</label><input id="ps-footer" class="rb-input" value="${escapeAttr(setup.footer)}" placeholder="（留空则无页脚）"></div>
    <div class="set-row"><label>页码</label><select id="ps-pageno" class="rb-select">
      <option value="1">显示</option><option value="0">隐藏</option></select></div>
    <div class="set-row"><label>目录页</label><select id="ps-toc" class="rb-select">
      <option value="0">不生成</option><option value="1">文档首页生成目录</option></select></div>
    <div class="set-row"><label></label><button id="ps-go" class="rb-btn" style="flex-direction:row;background:var(--accent);color:var(--accent-fg)">保存设置</button></div>
    <div style="color:var(--fg-dim);font-size:11.5px">设置随文档保存（写入文件头注释），并用于分页预览与 docx 导出。</div>`;
  m.body.querySelector('#ps-size').value = setup.size;
  m.body.querySelector('#ps-orient').value = setup.orientation;
  m.body.querySelector('#ps-pageno').value = setup.pageno ? '1' : '0';
  m.body.querySelector('#ps-toc').value = setup.toc ? '1' : '0';
  m.body.querySelector('#ps-go').addEventListener('click', () => {
    const num = (id, d) => Math.max(0, Math.min(80, +m.body.querySelector(id).value || d));
    onSave({
      size: m.body.querySelector('#ps-size').value,
      orientation: m.body.querySelector('#ps-orient').value,
      margins: {
        top: num('#ps-mt', 25), right: num('#ps-mr', 25),
        bottom: num('#ps-mb', 25), left: num('#ps-ml', 25),
      },
      header: m.body.querySelector('#ps-header').value.trim(),
      footer: m.body.querySelector('#ps-footer').value.trim(),
      pageno: m.body.querySelector('#ps-pageno').value === '1',
      toc: m.body.querySelector('#ps-toc').value === '1',
    });
    m.close();
  });
}

// ==================== 目录面板 ====================
export class TocPanel {
  constructor(view, host) {
    this.view = view;
    this.el = document.createElement('div');
    this.el.className = 'toc-panel';
    host.appendChild(this.el);
    this.render();
  }
  render() {
    const heads = extractHeadings(this.view.state.doc);
    this.el.innerHTML = `<div class="toc-title">目录</div>` + (heads.length
      ? heads.map(h => `<div class="toc-item lv${h.level}" data-pos="${h.pos}">${escapeHtml(h.text)}</div>`).join('')
      : '<div class="toc-empty">（无标题）</div>');
    this.el.querySelectorAll('.toc-item').forEach(item => {
      item.addEventListener('click', () => {
        const pos = +item.dataset.pos;
        const tr = this.view.state.tr.setSelection(this.view.state.selection.constructor.near(this.view.state.doc.resolve(pos + 1)));
        this.view.dispatch(tr.scrollIntoView());
        this.view.focus();
      });
    });
  }
  update() { this.render(); }
  destroy() { this.el.remove(); }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
