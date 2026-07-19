// renderer/modules/code/terminal-view.js —— 集成终端（xterm.js 多标签 + 右键 11 号上下文）
import { toast, inputModal } from '../../shell/shell.js';
import xtermCss from '@xterm/xterm/css/xterm.css';

let seq = 1;
let cssInjected = false;
function injectXtermCss() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = xtermCss;
  document.head.appendChild(style);
}

export class TerminalPanel {
  constructor(container, { onCountChange }) {
    this.container = container;
    this.terms = new Map(); // id -> {xterm, fitAddon, proc, title}
    this.activeId = null;
    this.onCountChange = onCountChange;
    this.el = document.createElement('div');
    this.el.className = 'term-panel';
    this.el.innerHTML = `<div class="term-tabs"><button class="term-new" title="新建终端（Ctrl+Shift+\`）">＋ 终端</button></div><div class="term-body"></div>`;
    container.appendChild(this.el);
    this.tabsEl = this.el.querySelector('.term-tabs');
    this.bodyEl = this.el.querySelector('.term-body');
    this.el.querySelector('.term-new').addEventListener('click', () => this.create());

    // 主进程 → 渲染进程 数据流
    if (window.mazz?.isElectron) {
      window.mazz.on('term:data', ({ id, data }) => {
        this.terms.get(id)?.xterm.write(data);
      });
      window.mazz.on('term:exit', ({ id, exitCode }) => {
        const t = this.terms.get(id);
        if (t) {
          t.xterm.write(`\r\n\x1b[90m[进程已退出，代码 ${exitCode}]\x1b[0m\r\n`);
          toast(`终端 ${id} 已退出（${exitCode}）`);
        }
      });
    }
  }

  async create({ shell, cwd } = {}) {
    if (!window.mazz?.isElectron) { toast('终端需要桌面版'); return null; }
    injectXtermCss();
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]);

    const id = 'term-' + seq++;
    const res = await window.mazz.invoke('term:create', { id, shell, cwd });
    if (res.error) { toast('终端创建失败：' + res.error); return null; }

    const xterm = new Terminal({
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: themeByBody(),
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);

    const wrap = document.createElement('div');
    wrap.className = 'term-view';
    wrap.dataset.termId = id;
    this.bodyEl.appendChild(wrap);
    xterm.open(wrap);
    fitAddon.fit();

    const rec = { xterm, fitAddon, id, title: res.title || '终端' };
    this.terms.set(id, rec);

    // 输入 → 主进程
    xterm.onData((data) => window.mazz.invoke('term:write', { id, data }));
    xterm.onResize(({ cols, rows }) => window.mazz.invoke('term:resize', { id, cols, rows }));
    // 右键 11 号上下文
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.activeId = id;
      const hasSel = xterm.hasSelection();
      const menu = document.createElement('div');
      menu.className = 'mazz-menu';
      menu.innerHTML = `
        <div class="mazz-menu-item" data-a="copy">复制</div>
        <div class="mazz-menu-item" data-a="paste">粘贴</div>
        <div class="mazz-menu-item" data-a="clear">清屏</div>
        <div class="mazz-menu-sep"></div>
        <div class="mazz-menu-item" data-a="rename">重命名</div>
        <div class="mazz-menu-item" data-a="close">关闭终端</div>`;
      document.body.appendChild(menu);
      menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight - 180) + 'px';
      const close = () => menu.remove();
      setTimeout(() => window.addEventListener('mousedown', close, { once: true }), 0);
      menu.querySelector('[data-a=copy]').addEventListener('click', async () => {
        const sel = xterm.getSelection();
        if (sel) await window.mazz.invoke('clipboard:write', { text: sel });
        close();
      });
      menu.querySelector('[data-a=paste]').addEventListener('click', async () => {
        const clip = await window.mazz.invoke('clipboard:read');
        if (clip.text) window.mazz.invoke('term:write', { id, data: clip.text });
        close();
      });
      menu.querySelector('[data-a=clear]').addEventListener('click', () => { xterm.clear(); close(); });
      menu.querySelector('[data-a=rename]').addEventListener('click', async () => {
        const name = await inputModal('终端名称', rec.title);
        if (name?.trim()) { rec.title = name.trim(); this.renderTabs(); }
        close();
      });
      menu.querySelector('[data-a=close]').addEventListener('click', () => { this.kill(id); close(); });
    });

    this.activate(id);
    this.renderTabs();
    this.onCountChange?.(this.terms.size);
    return rec;
  }

  activate(id) {
    this.activeId = id;
    for (const [tid, rec] of this.terms) {
      const el = this.bodyEl.querySelector(`[data-term-id="${tid}"]`);
      if (el) el.style.display = tid === id ? 'block' : 'none';
      if (tid === id) setTimeout(() => rec.fitAddon.fit(), 0);
    }
    this.renderTabs();
  }

  kill(id) {
    const rec = this.terms.get(id);
    if (!rec) return;
    window.mazz.invoke('term:kill', { id });
    rec.xterm.dispose();
    this.bodyEl.querySelector(`[data-term-id="${id}"]`)?.remove();
    this.terms.delete(id);
    const next = this.terms.keys().next().value;
    if (next) {
      this.activate(next);
    } else {
      // 最后一个终端：清空激活态并重绘标签栏（清掉残留死标签）
      this.activeId = null;
      this.renderTabs();
    }
    this.onCountChange?.(this.terms.size);
  }

  renderTabs() {
    this.tabsEl.querySelectorAll('.term-tab').forEach(e => e.remove());
    for (const [id, rec] of this.terms) {
      const el = document.createElement('div');
      el.className = 'term-tab' + (id === this.activeId ? ' on' : '');
      el.innerHTML = `<span>${rec.title}</span><button class="term-tab-x">✕</button>`;
      el.addEventListener('click', (e) => { if (!e.target.closest('.term-tab-x')) this.activate(id); });
      el.querySelector('.term-tab-x').addEventListener('click', () => this.kill(id));
      this.tabsEl.insertBefore(el, this.tabsEl.querySelector('.term-new'));
    }
  }

  resize() {
    if (this.activeId) {
      const rec = this.terms.get(this.activeId);
      rec?.fitAddon.fit();
    }
  }

  count() { return this.terms.size; }
}

function themeByBody() {
  const dark = document.documentElement.dataset.theme !== 'paper' && document.documentElement.dataset.theme !== 'sand';
  return dark
    ? { background: '#16181d', foreground: '#e2e4e9', cursor: '#818cf8', selectionBackground: '#312e5f' }
    : { background: '#ffffff', foreground: '#2c2c2a', cursor: '#4f46e5', selectionBackground: '#e0e7ff' };
}
