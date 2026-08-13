// renderer/shell/statusbar.js —— 状态栏：模块/字数/光标/主题/拼写/缩放
import { commands } from '../core/command-registry.js';

export class StatusBar {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'statusbar';
    this.el.innerHTML = `
      <span class="st plain" id="st-module">—</span>
      <span class="st plain" id="st-count"></span>
      <span class="st plain" id="st-pos"></span>
      <span class="spacer"></span>
      <span class="st" id="st-notif" title="通知中心（被动入账，不抢焦点）">通知</span>
      <span class="st" id="st-spell" title="拼写检查">拼写</span>
      <span class="st" id="st-theme" title="轮换主题（Ctrl+Alt+T）">主题</span>
      <span class="st" id="st-zoom" title="缩放">100%</span>`;
    root.appendChild(this.el);
    this.el.querySelector('#st-theme').addEventListener('click', () => commands.execute('view.cycleTheme'));
    this.el.querySelector('#st-notif').addEventListener('click', () => commands.execute('app.notifications'));
    this.el.querySelector('#st-spell').addEventListener('click', () => commands.execute('app.toggleSpellcheck'));
    this.el.querySelector('#st-zoom').addEventListener('click', () => commands.execute('view.zoomReset'));
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
  setSpell(on) { this.el.querySelector('#st-spell').textContent = on ? '拼写✓' : '拼写○'; }
  setTheme(name) { this.el.querySelector('#st-theme').textContent = name; }
  setZoom(z) { this.el.querySelector('#st-zoom').textContent = Math.round(z * 100) + '%'; }
  setNotifications(count) {
    const el = this.el.querySelector('#st-notif');
    const n = Math.max(0, Number(count) || 0);
    el.textContent = n ? `通知 ${n > 99 ? '99+' : n}` : '通知';
    el.classList.toggle('unread', n > 0);
  }
}
