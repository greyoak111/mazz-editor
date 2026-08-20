// renderer/lib/app-window.js —— 应用内浮动窗口：可拖动 / 可拉伸 / 可最大化 / Esc 关闭
// 用途：打印预览、分页预览等需要大空间的弹层（不再暴力最大化，关闭钮不再和主窗口控件叠位）
import { t } from '../i18n/index.js';
import { iconHtml } from './svg-icons.js';
import { visualComposition } from '../core/visual-composition.js';

/**
 * 打开一个应用内窗口
 * @param {object} o
 * @param {string} o.title 标题
 * @param {number} [o.widthRatio=0.72] 初始宽（视口比）
 * @param {number} [o.heightRatio=0.8] 初始高（视口比）
 * @param {(body:HTMLElement, win:object)=>void} o.build 填充内容
 * @returns {object} win {el, body, close, toggleMax}
 */
export function openAppWindow({ title, widthRatio = 0.72, heightRatio = 0.8, build, onClose }) {
  document.querySelector('.appwin-mask')?.remove();
  const mask = document.createElement('div');
  mask.className = 'appwin-mask';
  const win = document.createElement('div');
  win.className = 'appwin';
  win.style.width = Math.round(innerWidth * widthRatio) + 'px';
  win.style.height = Math.round(innerHeight * heightRatio) + 'px';
  win.innerHTML = `
    <div class="appwin-bar">
      <span class="appwin-title"></span>
      <span class="appwin-acts">
        <button class="appwin-btn" data-a="max" title="最大化/还原" aria-label="最大化/还原">${iconHtml('▢')}</button>
        <button class="appwin-btn" data-a="close" title="关闭（Esc）" aria-label="关闭">${iconHtml('✕')}</button>
      </span>
    </div>
    <div class="appwin-body"></div>
    <div class="appwin-resize" title="拖拽调整大小"></div>`;
  mask.appendChild(win);
  let visualHandle = null;
  win.querySelector('.appwin-title').textContent = title || '';
  const body = win.querySelector('.appwin-body');

  const api = {
    el: mask, win, body, maximized: false,
    close() { visualHandle?.release('app-window-close'); mask.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); },
    toggleMax() {
      api.maximized = !api.maximized;
      win.classList.toggle('max', api.maximized);
      win.querySelector('[data-a=max]').innerHTML = iconHtml(api.maximized ? '❐' : '▢');
    },
  };
  visualHandle = visualComposition.mountOverlay(mask, { kind: 'app-window', onDismiss: () => api.close() });
  win.querySelector('[data-a=close]').addEventListener('click', () => api.close());
  win.querySelector('[data-a=max]').addEventListener('click', () => api.toggleMax());
  win.querySelector('.appwin-bar').addEventListener('dblclick', (e) => {
    if (!e.target.closest('.appwin-btn')) api.toggleMax();
  });
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } };
  document.addEventListener('keydown', onKey, true);

  // 标题栏拖动（最大化时禁用）
  const bar = win.querySelector('.appwin-bar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.appwin-btn') || api.maximized) return;
    const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
    const move = (ev) => {
      win.style.left = Math.min(innerWidth - 120, Math.max(-win.offsetWidth + 160, ev.clientX - sx)) + 'px';
      win.style.top = Math.max(0, Math.min(innerHeight - 60, ev.clientY - sy)) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  });
  // 右下角拉伸
  const grip = win.querySelector('.appwin-resize');
  grip.addEventListener('pointerdown', (e) => {
    if (api.maximized) return;
    e.preventDefault();
    grip.setPointerCapture?.(e.pointerId);
    const sw = win.offsetWidth, sh = win.offsetHeight, sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      win.style.width = Math.min(innerWidth - 20, Math.max(420, sw + ev.clientX - sx)) + 'px';
      win.style.height = Math.min(innerHeight - 10, Math.max(300, sh + ev.clientY - sy)) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // 点遮罩不关闭（防误触；关窗走 ✕ / Esc）
  build?.(body, api);
  return api;
}
