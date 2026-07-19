// renderer/shell/titlebar.js —— 自绘标题栏（macOS 保留红绿灯 inset）
export function createTitlebar(root) {
  const el = document.createElement('div');
  el.className = 'titlebar';
  el.innerHTML = `
    <span class="tb-logo">◆ Mazz</span>
    <span class="tb-title" id="tb-title">Mazz Editor</span>
    <div class="tb-actions tb-win-controls">
      <button class="tb-btn" data-act="min" title="最小化">–</button>
      <button class="tb-btn" data-act="max" title="最大化/还原">▢</button>
      <button class="tb-btn close" data-act="close" title="关闭">✕</button>
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
