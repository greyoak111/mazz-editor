// renderer/shell/statusbar.js —— 状态栏：模块/字数/光标/主题/拼写/缩放
import { commands } from '../core/command-registry.js';
import { iconHtml } from '../lib/svg-icons.js';

export class StatusBar {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'statusbar';
    this.el.innerHTML = `
      <span class="st plain" id="st-module">—</span>
      <span class="st plain" id="st-count"></span>
      <span class="st plain" id="st-pos"></span>
      <span class="spacer"></span>
      <span class="st" id="st-memory" role="button" tabindex="0" aria-label="重置内存观测基线" title="进程工作集 / 资源账本；点击重置观测基线" hidden>内存 —</span>
      <span class="st" id="st-notif" role="button" tabindex="0" aria-label="打开通知中心" title="通知中心（被动入账，不抢焦点）">通知</span>
      <span class="st" id="st-spell" role="button" tabindex="0" aria-label="切换拼写检查" aria-pressed="false" title="拼写检查">拼写</span>
      <span class="st" id="st-theme" role="button" tabindex="0" aria-label="轮换主题" title="轮换主题（Ctrl+Alt+T）">主题</span>
      <span class="st" id="st-zoom" role="button" tabindex="0" aria-label="重置缩放" title="缩放">100%</span>`;
    root.appendChild(this.el);
    this.el.querySelector('#st-theme').addEventListener('click', () => commands.execute('view.cycleTheme'));
    this.el.querySelector('#st-notif').addEventListener('click', () => commands.execute('app.notifications'));
    this.el.querySelector('#st-spell').addEventListener('click', () => commands.execute('app.toggleSpellcheck'));
    this.el.querySelector('#st-zoom').addEventListener('click', () => commands.execute('view.zoomReset'));
    this.el.querySelector('#st-memory').addEventListener('click', () => window.mazz?.invoke('memory:resetBaseline').then(() => this.refreshMemory()).catch(() => {}));
    this.el.addEventListener('keydown', (event) => {
      const control = event.target.closest('.st[role="button"]');
      if (!control || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      control.click();
    });
    this.memoryTimer = null;
    window.mazz?.invoke('settings:get', { key: 'memory.monitor.enabled' }).then(enabled => this.setMemoryMonitor(!!enabled)).catch(() => {});
  }
  set(module, count, pos) {
    if (module != null) {
      const slot = this.el.querySelector('#st-module');
      // 含 SVG 图标的走 innerHTML（状态栏模块图标 SVG 化后的正确打开方式，纯文本仍走 textContent）
      if (module.includes('<svg')) slot.innerHTML = module;
      else slot.textContent = module;
    }
    if (count != null) this.el.querySelector('#st-count').textContent = count;
    if (pos != null) this.el.querySelector('#st-pos').textContent = pos;
  }
  setSpell(on) {
    const slot = this.el.querySelector('#st-spell');
    slot.innerHTML = `<span>拼写</span>${iconHtml(on ? '✓' : '○')}`;
    slot.setAttribute('aria-pressed', String(!!on));
    slot.setAttribute('aria-label', `拼写检查：${on ? '已开启' : '已关闭'}；按下切换`);
  }
  setTheme(name) { this.el.querySelector('#st-theme').textContent = name; }
  setZoom(z) { this.el.querySelector('#st-zoom').textContent = Math.round(z * 100) + '%'; }
  setNotifications(count) {
    const el = this.el.querySelector('#st-notif');
    const n = Math.max(0, Number(count) || 0);
    el.textContent = n ? `通知 ${n > 99 ? '99+' : n}` : '通知';
    el.classList.toggle('unread', n > 0);
  }
  async refreshMemory() {
    const slot = this.el.querySelector('#st-memory');
    if (slot.hidden) return;
    const summary = await window.mazz?.invoke('memory:summary').catch(() => null);
    if (!summary?.current) { slot.textContent = '内存 —'; return; }
    const mib = Math.round(summary.current.totalWorkingSetBytes / 1024 / 1024);
    slot.textContent = `内存 ${mib}M · ${summary.current.resources.activeCount}`;
    slot.dataset.state = summary.current.state;
    slot.title = `总工作集 ${mib} MiB；主进程 RSS ${Math.round(summary.current.main.rssBytes / 1024 / 1024)} MiB；活动资源 ${summary.current.resources.activeCount}；趋势 ${Math.round(summary.trend.workingSetBytesPerMinute / 1024 / 1024)} MiB/min。点击重置基线。`;
  }
  setMemoryMonitor(enabled) {
    const slot = this.el.querySelector('#st-memory');
    slot.hidden = !enabled;
    clearInterval(this.memoryTimer);
    this.memoryTimer = enabled ? setInterval(() => this.refreshMemory(), 5000) : null;
    if (enabled) this.refreshMemory();
    window.mazz?.invoke('settings:set', { key: 'memory.monitor.enabled', value: !!enabled }).catch(() => {});
  }
}
