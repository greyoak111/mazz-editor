// renderer/lib/print-preview.js —— 通用打印预览：纸张全谱 + 四边页边距 + 打印/导出 PDF
// 三件套共用：文档（markdown/paginate 传入分页结果）、表格、演示
import { toast } from '../shell/shell.js';
import { openAppWindow } from './app-window.js';
import { PAGE_SIZES, normalizeMargins } from '../modules/markdown/paginate.js';
import { iconHtml } from './svg-icons.js';

export { PAGE_SIZES };

const MM_IN = 1 / 25.4;

/** 生成交付打印的独立 HTML 文档（@page 精确纸张与边距） */
export function buildPrintDocument({ title, setup, pagesHtml }) {
  const size = PAGE_SIZES[setup.size] || PAGE_SIZES.A4;
  const [pw, ph] = setup.orientation === 'portrait' ? [size.w, size.h] : [size.h, size.w];
  const mg = normalizeMargins(setup);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: ${pw}mm ${ph}mm; margin: ${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.sheet { width: ${pw - mg.left - mg.right}mm; min-height: ${ph - mg.top - mg.bottom}mm; page-break-after: always; overflow: hidden; position: relative; }
.sheet:last-child { page-break-after: auto; }
table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
td, th { border: 0.5pt solid #999; padding: 2pt 4pt; overflow: hidden; }
th { background: #f0efe9; font-weight: 600; }
</style></head><body>${pagesHtml}</body></html>`;
}

/** 预览窗内的页面框样式（屏幕端等比缩放） */
const PREVIEW_CSS = `
.pp-wrap { display: block; padding: 22px; overflow: auto; height: 100%; background: var(--bg-active, #e3e1da); }
.pp-frame { margin: 0 auto 18px; overflow: hidden; position: relative; }
.pp-sheet { background: #fff; color: #222; box-shadow: 0 2px 14px rgba(0,0,0,.18); position: relative; overflow: hidden; }
.pp-sheet .pp-head { position: absolute; top: 4mm; left: 10mm; right: 10mm; font-size: 10px; color: #888; border-bottom: .5pt solid #ddd; padding-bottom: 1mm; }
.pp-sheet .pp-foot { position: absolute; bottom: 4mm; left: 10mm; right: 10mm; font-size: 10px; color: #888; border-top: .5pt solid #ddd; padding-top: 1mm; text-align: center; }
`;

/**
 * 打开打印预览
 * @param {object} o
 * @param {string} o.title 标题
 * @param {object} o.setup {size, orientation, margins, header?, footer?, pageno?}
 * @param {(setup)=>string[]} o.buildPages 返回每页 innerHTML（屏幕端以纸张比例框展示）
 * @param {(setup)=>void} [o.onSetupChange] 纸张/边距改动回调（持久化用）
 */
export function openPrintPreview({ title, setup, buildPages, onSetupChange }) {
  setup = { ...setup };
  // 应用内浮动窗口：可拖动/可拉伸/可最大化/Esc 关闭（不再是挡主窗口的暴力最大化弹层）
  const m = openAppWindow({ title: `打印预览 · ${title}`, widthRatio: 0.78, heightRatio: 0.86 });
  const st = document.createElement('style');
  st.textContent = PREVIEW_CSS;

  const render = () => {
    const size = PAGE_SIZES[setup.size] || PAGE_SIZES.A4;
    const [pw, ph] = setup.orientation === 'portrait' ? [size.w, size.h] : [size.h, size.w];
    const mg = normalizeMargins(setup);
    const pages = buildPages(setup) || [];
    const scale = Math.min(1, (m.body.clientWidth - 140) / (pw * 96 / 25.4));
    m.body.querySelector('.pp-wrap').innerHTML = pages.map((inner, i) => `
      <div class="pp-frame" style="width:${pw * scale}mm;height:${ph * scale}mm;overflow:hidden;flex:none;position:relative">
        <div class="pp-sheet" style="width:${pw}mm;height:${ph}mm;transform:scale(${scale});transform-origin:top left">
          ${setup.header ? `<div class="pp-head">${esc(setup.header)}</div>` : ''}
          <div style="position:absolute;inset:${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm;overflow:hidden">${inner}</div>
          ${(setup.footer || setup.pageno) ? `<div class="pp-foot">${setup.footer ? esc(setup.footer) + (setup.pageno ? ' · ' : '') : ''}${setup.pageno ? `第 ${i + 1} 页 / 共 ${pages.length} 页` : ''}</div>` : ''}
        </div>
      </div>`).join('') || '<div style="color:#888">（无内容）</div>';
  };

  m.body.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;padding:10px 14px 8px;flex:none">
      <label>纸张 <select id="pp-size" class="rb-select">${Object.keys(PAGE_SIZES).map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
      <label>方向 <select id="pp-orient" class="rb-select"><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
      <span style="color:var(--fg-dim)">边距 mm</span>
      ${['top:上', 'right:右', 'bottom:下', 'left:左'].map(x => { const [k, lb] = x.split(':'); return `<input class="rb-input pp-mg" data-k="${k}" type="number" min="0" max="80" title="${lb}" style="width:56px">`; }).join('')}
      <span style="flex:1"></span>
      <button id="pp-print" class="rb-btn" style="flex-direction:row">${iconHtml('🖨')} 打印</button>
      <button id="pp-pdf" class="rb-btn" style="flex-direction:row">${iconHtml('📄')} 导出 PDF</button>
    </div>
    <div class="pp-wrap" style="flex:1"></div>`;
  m.body.prepend(st);
  // 窗口尺寸变化时重排预览页
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => render()).observe(m.body);

  const mg = normalizeMargins(setup);
  m.body.querySelector('#pp-size').value = setup.size;
  m.body.querySelector('#pp-orient').value = setup.orientation;
  m.body.querySelectorAll('.pp-mg').forEach(inp => { inp.value = mg[inp.dataset.k]; });

  const applySetup = () => {
    setup.size = m.body.querySelector('#pp-size').value;
    setup.orientation = m.body.querySelector('#pp-orient').value;
    setup.margins = {};
    m.body.querySelectorAll('.pp-mg').forEach(inp => { setup.margins[inp.dataset.k] = Math.max(0, Math.min(80, +inp.value || 0)); });
    onSetupChange?.(setup);
    render();
  };
  m.body.querySelector('#pp-size').addEventListener('change', applySetup);
  m.body.querySelector('#pp-orient').addEventListener('change', applySetup);
  m.body.querySelectorAll('.pp-mg').forEach(inp => inp.addEventListener('change', applySetup));

  const pagesForPrint = () => {
    const pages = buildPages(setup) || [];
    return pages.map(inner => `<div class="sheet">${inner}</div>`).join('');
  };
  m.body.querySelector('#pp-print').addEventListener('click', async () => {
    if (!window.mazz?.isElectron) { window.print(); return; }
    toast('正在发送打印…');
    const r = await window.mazz.invoke('print:html', {
      html: buildPrintDocument({ title, setup, pagesHtml: pagesForPrint() }), setup, toPdf: false,
    }).catch(e => ({ ok: false, reason: e.message }));
    toast(r?.ok === false ? '打印未完成：' + (r.reason || '') : '已发送打印');
  });
  m.body.querySelector('#pp-pdf').addEventListener('click', async () => {
    const target = await window.mazz.invoke('dialog:saveFile', {
      defaultPath: (title || '文档').replace(/\.[^.]*$/, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }).catch(() => null);
    if (!target) return;
    const p = await window.mazz.invoke('print:html', {
      html: buildPrintDocument({ title, setup, pagesHtml: pagesForPrint() }), setup, toPdf: true,
      defaultPath: target,
    }).catch(e => { toast('PDF 导出失败：' + e.message); return null; });
    if (p) toast(`PDF 已导出：${p.split(/[\\/]/).pop()}`);
  });

  render();
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
