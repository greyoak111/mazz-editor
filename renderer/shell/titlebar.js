// renderer/shell/titlebar.js —— 自绘标题栏（macOS 保留红绿灯 inset）
// Caption buttons are not ordinary toolbar icons.  Their Windows geometry is a
// 10 px optical primitive inside a 46 x 36 hit target; routing them through the
// generic 24 x 24 semantic icon map made the maximize glyph look like a tiny
// calendar after the W87h icon migration.
const captionIcon = (action) => {
  const shapes = {
    min: '<path d="M2 8.5h8"/>',
    max: '<rect x="2.25" y="2.25" width="7.5" height="7.5"/>',
    close: '<path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/>',
  };
  return `<svg class="tb-caption-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${shapes[action]}</svg>`;
};

export function createTitlebar(root) {
  const el = document.createElement('div');
  el.className = 'titlebar';
  el.innerHTML = `
    <span class="tb-logo">◆ Mazz</span>
    <span class="tb-title" id="tb-title">Mazz Editor</span>
    <div class="tb-actions tb-win-controls">
      <button class="tb-btn" data-act="min" title="最小化" aria-label="最小化">${captionIcon('min')}</button>
      <button class="tb-btn" data-act="max" title="最大化/还原" aria-label="最大化/还原">${captionIcon('max')}</button>
      <button class="tb-btn close" data-act="close" title="关闭" aria-label="关闭">${captionIcon('close')}</button>
    </div>`;
  root.appendChild(el);
  document.body.classList.add(`platform-${window.mazz?.platform === 'darwin' ? 'mac' : 'other'}`);

  el.querySelector('[data-act=min]').addEventListener('click', () => window.mazz?.invoke('window:minimize'));
  el.querySelector('[data-act=max]').addEventListener('click', () => window.mazz?.invoke('window:toggleMaximize'));
  el.querySelector('[data-act=close]').addEventListener('click', () => window.mazz?.invoke('window:close'));
  el.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.tb-btn')) window.mazz?.invoke('window:toggleMaximize');
  });

  return {
    setTitle(t) {
      el.querySelector('#tb-title').textContent = t;
      document.title = t;
      window.mazz?.invoke('window:setTitle', { title: t }).catch(() => {});
    },
  };
}
