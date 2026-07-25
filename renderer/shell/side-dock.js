// renderer/shell/side-dock.js —— 右侧工具坞：Ribbon 启动 · 右靠停靠/自由拖动 · 拉伸 · 内容缩放
// 承载未在欢迎页展示的功能：智能创作（Factory）、打开方式
import { commands } from '../core/command-registry.js';
import { toast } from './shell.js';
import { iconHtml } from '../lib/svg-icons.js';

const LS_KEY = 'mazz.sideDock';

export class SideDock {
  constructor(shell) {
    this.shell = shell;
    this.state = { open: false, tab: 'factory', width: 380, height: 560, zoom: 1, float: null }; // float: {x, y} | null = 停靠
    try { Object.assign(this.state, JSON.parse(localStorage.getItem(LS_KEY)) || {}); } catch {}
    this.buildDom();
    this.registerCommands();
    if (this.state.open) this.show();
  }

  persist() { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); }

  buildDom() {
    this.el = document.createElement('div');
    this.el.className = 'side-dock';
    this.el.innerHTML = `
      <div class="sd-bar">
        <span class="sd-tabs">
          <button class="sd-tab" data-t="factory">智能创作</button>
          <button class="sd-tab" data-t="openwith">打开方式</button>
          <button class="sd-tab" data-t="tools">工具</button>
        </span>
        <span class="sd-acts">
          <button class="sd-btn" data-a="zoom-out" title="缩小内容">－</button>
          <span class="sd-zoom">100%</span>
          <button class="sd-btn" data-a="zoom-in" title="放大内容">＋</button>
          <button class="sd-btn" data-a="float" title="停靠/浮动切换（双击标题栏同效）">⇱</button>
          <button class="sd-btn" data-a="close" title="关闭">✕</button>
        </span>
      </div>
      <div class="sd-body"></div>
      <div class="sd-grip" title="拖拽调整宽度"></div>
      <div class="sd-grip-b" title="拖拽调整高度（浮动模式）"></div>
      <div class="sd-grip-c" title="拖拽调整大小（浮动模式）"></div>`;
    document.body.appendChild(this.el);
    this.body = this.el.querySelector('.sd-body');
    this.el.style.display = 'none';

    this.el.querySelector('[data-a=close]').addEventListener('click', () => this.hide());
    this.el.querySelector('[data-a=float]').addEventListener('click', () => this.toggleFloat());
    this.el.querySelector('[data-a=zoom-in]').addEventListener('click', () => this.setZoom(this.state.zoom + 0.1));
    this.el.querySelector('[data-a=zoom-out]').addEventListener('click', () => this.setZoom(this.state.zoom - 0.1));
    this.el.querySelectorAll('.sd-tab').forEach(btn => btn.addEventListener('click', () => this.showTab(btn.dataset.t)));

    // 宽度拖拽（停靠态拉左缘）
    const grip = this.el.querySelector('.sd-grip');
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = this.el.offsetWidth, isFloat = !!this.state.float;
      const move = (ev) => {
        const dw = isFloat ? (ev.clientX - startX) : (startX - ev.clientX);
        const w = Math.min(Math.max(startW + dw, 300), Math.min(760, innerWidth - 60));
        this.state.width = w;
        this.el.style.width = w + 'px';
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.persist(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    // 底缘拉高度 / 右下斜柄宽+高（浮动模式；v35 自由拉伸）
    const gripB = this.el.querySelector('.sd-grip-b');
    gripB.addEventListener('pointerdown', (e) => {
      if (!this.state.float) return;
      e.preventDefault();
      const startY = e.clientY, startH = this.el.offsetHeight;
      const move = (ev) => {
        this.state.height = Math.min(Math.max(startH + ev.clientY - startY, 220), 2000);
        this.el.style.height = this.state.height + 'px';
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.persist(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    const gripC = this.el.querySelector('.sd-grip-c');
    gripC.addEventListener('pointerdown', (e) => {
      if (!this.state.float) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY, startW = this.el.offsetWidth, startH = this.el.offsetHeight;
      const move = (ev) => {
        this.state.width = Math.min(Math.max(startW + ev.clientX - startX, 300), Math.min(900, innerWidth - 40));
        this.state.height = Math.min(Math.max(startH + ev.clientY - startY, 220), 2000);
        this.el.style.width = this.state.width + 'px';
        this.el.style.height = this.state.height + 'px';
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.persist(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    // 标题栏拖动（自由拖动 = 浮动模式）/ 双击切停靠
    const bar = this.el.querySelector('.sd-bar');
    bar.addEventListener('pointerdown', (e) => {
      // 只拦「按钮」本身（页签/操作钮正常点击），标题栏其余一切区域（间隙/padding/文字空档）均可拖——
      // 此前拦 .sd-btn/.sd-tab 类，而页签按钮几乎占满标题栏，用户根本找不到可拖点=「工具坞拖不出去」实锤
      if (e.target.closest('button')) return;
      const rect = this.el.getBoundingClientRect();
      const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
      const wasDocked = !this.state.float;
      const move = (ev) => {
        if (wasDocked) {
          const r = this.el.getBoundingClientRect();
          this.state.float = { x: rect.left, y: rect.top };
          this.state.height = Math.round(r.height);
        }
        // 只保留 80px 在任一屏幕可视区内即可——允许拖到其他屏幕（v35 多屏需求）
        this.state.float.x = Math.max(-this.el.offsetWidth + 80, ev.clientX - ox);
        this.state.float.y = Math.max(-30, ev.clientY - oy);
        this.applyPos();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.persist(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('.sd-btn')) this.toggleFloat(); });

    // 内容 Ctrl+滚轮缩放
    this.body.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });

    // 内容挂载
    import('../modules/factory/index.js').then(({ FactoryPanel }) => {
      // 独立容器：showTab 显隐切换不能碰 sd-body 本体（否则工具/打开方式页签一起被藏）
      this.factoryWrap = document.createElement('div');
      this.factoryWrap.className = 'sd-factory-wrap';
      this.body.appendChild(this.factoryWrap);
      this.factoryPanel = new FactoryPanel(this.factoryWrap, { shell: this.shell });
      this.openWithEl = document.createElement('div');
      this.openWithEl.className = 'sd-openwith';
      this.openWithEl.style.display = 'none';
      this.buildOpenWith();
      this.body.appendChild(this.openWithEl);
      this.toolsEl = document.createElement('div');
      this.toolsEl.className = 'sd-tools';
      this.toolsEl.style.display = 'none';
      this.buildTools();
      this.body.appendChild(this.toolsEl);
      this.showTab(this.state.tab);
    });
  }

  /** 打开方式页：大拖放区 + 2×2 快捷入口 */
  buildOpenWith() {
    const t = (s) => s;
    this.openWithEl.innerHTML = `
      <div class="w-drop" id="sd-dropzone">
        <div class="w-drop-ico">⇩</div>
        <div class="w-drop-t">把文件拖到这里</div>
        <div class="w-drop-d">图片 · PDF · 音视频，立即查看</div>
      </div>
      <div class="w-ow-grid" style="margin-top:10px">
        <button class="w-ow-card" data-cmd="file.openViewer"><div class="t">${iconHtml('🖼')} 查看器预览</div><div class="d">图片/PDF/音视频</div></button>
        <button class="w-ow-card" data-cmd="file.openWithSystem"><div class="t">${iconHtml('🚀')} 系统默认打开</div><div class="d">调起外部程序</div></button>
        <button class="w-ow-card" data-cmd="file.import"><div class="t">${iconHtml('📥')} 导入工作区</div><div class="d">多选文件/文件夹</div></button>
        <button class="w-ow-card" data-cmd="file.quickOpen"><div class="t">⚡ 快速跳转</div><div class="d">最近文件直达</div></button>
      </div>`;
    this.openWithEl.querySelectorAll('[data-cmd]').forEach(b =>
      b.addEventListener('click', () => commands.execute(b.dataset.cmd)));
    const dz = this.openWithEl.querySelector('#sd-dropzone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('on'); e.dataTransfer.dropEffect = 'copy'; });
    dz.addEventListener('dragleave', () => dz.classList.remove('on'));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      dz.classList.remove('on');
      const paths = [...(e.dataTransfer?.files || [])].map(f => f.path).filter(Boolean);
      for (const p of paths) await this.shell.openFile(p);
    });
    dz.addEventListener('click', () => commands.execute('file.openViewer'));
  }

  /** 工具页：收编藏在命令面板里的全部功能（分组 + 说明） */
  buildTools() {
    const GROUPS = [
      ['识别', [
        { cmd: 'ocr.image', ico: '🔤', t: '图片文字识别', d: '截图/照片里的文字抠出来' },
        { cmd: 'translate.panel', ico: '🌐', t: '翻译面板', d: '多语互译' },
        { cmd: 'translate.selection', ico: '⇄', t: '翻译选中文本', d: '编辑器里选一段直接翻' },
        { cmd: 'translate.config', ico: '⚙', t: '翻译引擎设置', d: '换源/密钥' },
      ]],
      ['批注', [
        { cmd: 'annotate.toggle', ico: '✍', t: '全局批注', d: '悬浮手写外套（Ctrl+Alt+Shift+K）' },
        { cmd: 'annotate.clear', ico: '⌫', t: '批注清屏', d: '清空全部笔迹（Ctrl+Alt+Shift+X）' },
      ]],
      ['播放器', [
        { cmd: 'player.open', ico: '🎬', t: '打开播放器', d: '音视频 · 悬停缩略图 · 无边框' },
      ]],
      ['语音与录制', [
        { cmd: 'voice.dictate', ico: '🎙', t: '语音输入', d: '说话变文字（开始/停止）' },
        { cmd: 'rec.screen', ico: '⏺', t: '全局内录', d: '窗口/混音/变速录 mp4' },
      ]],
      ['协同', [
        { cmd: 'sync.host', ico: '📡', t: '发起共享', d: '局域网同步：本机做主机，显示配对码' },
        { cmd: 'sync.join', ico: '🔗', t: '加入共享', d: '输入对方 IP 与配对码加入同步' },
      ]],
      ['系统', [
        { cmd: 'apps.rescanQuickLaunch', ico: '🚀', t: '重扫已装软件', d: '外部打开列表刷新' },
        { cmd: 'browser.passwordManager', ico: '🔑', t: '密码管理器', d: '浏览器主页内打开' },
        { cmd: 'update.check', ico: '⬆', t: '检查更新', d: '版本与更新源' },
        { cmd: 'file.import', ico: '📥', t: '导入工作区', d: '多选文件/文件夹' },
      ]],
      ['界面', [
        { cmd: 'app.openSettings', ico: '⚙', t: '设置', d: '主题/行为/搜索实例' },
        { cmd: 'app.shortcutSheet', ico: '⌨', t: '快捷键速查', d: '全部快捷键一览' },
        { cmd: 'help.open', ico: '❓', t: '使用指南', d: 'F1 帮助文档' },
      ]],
    ];
    this.toolsEl.innerHTML = GROUPS.map(([g, items]) => `
      <div class="sd-tools-group">
        <div class="sd-tools-label">${g}</div>
        <div class="sd-tools-grid">
          ${items.map(it => `
            <button class="sd-tool-card" data-cmd="${it.cmd}">
              <span class="sd-tool-ico">${iconHtml(it.ico)}</span>
              <span class="sd-tool-text"><b>${it.t}</b><i>${it.d}</i></span>
            </button>`).join('')}
        </div>
      </div>`).join('');
    this.toolsEl.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', async () => {
      const cmd = b.dataset.cmd;
      if (cmd === 'browser.passwordManager') {
        // 密码管理器在浏览器模块主页内：先开一个浏览器标签再拉起
        commands.execute('file.newBrowser');
        toast('密码管理器在浏览器主页 ⚙ 里');
        return;
      }
      commands.execute(cmd);
    }));
  }

  registerCommands() {
    commands.register('factory.toggleDock', {
      title: '智能创作面板（开关）', icon: '🔥', group: '智能创作',
      run: () => this.toggle(),
    });
    commands.register('dock.openWith', {
      title: '打开方式面板（开关）', icon: '📂', group: '工具',
      run: () => { this.show(); this.showTab('openwith'); },
    });
    commands.register('dock.tools', {
      title: '工具面板（开关）', icon: '🛠', group: '工具',
      run: () => { this.show(); this.showTab('tools'); },
    });
  }

  setZoom(z) {
    this.state.zoom = Math.min(1.6, Math.max(0.7, Math.round(z * 100) / 100));
    this.body.style.zoom = this.state.zoom;
    this.el.querySelector('.sd-zoom').textContent = Math.round(this.state.zoom * 100) + '%';
    this.persist();
  }

  toggleFloat() {
    if (this.state.float) {
      this.state.float = null;
    } else {
      const r = this.el.getBoundingClientRect();
      this.state.height = Math.round(r.height);
      this.state.float = { x: r.left, y: r.top };
    }
    this.applyPos();
    this.persist();
  }

  applyPos() {
    if (this.state.float) {
      this.el.classList.add('floating');
      this.el.style.left = this.state.float.x + 'px';
      this.el.style.top = this.state.float.y + 'px';
      this.el.style.right = 'auto';
      this.el.style.bottom = 'auto';
      this.el.style.height = this.state.height + 'px';
    } else {
      this.el.classList.remove('floating');
      this.el.style.left = 'auto';
      this.el.style.top = '';
      this.el.style.right = '0';
      this.el.style.bottom = '';
      this.el.style.height = '';
    }
  }

  showTab(tab) {
    this.state.tab = tab;
    this.el.querySelectorAll('.sd-tab').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    if (this.factoryWrap) this.factoryWrap.style.display = tab === 'factory' ? '' : 'none';
    if (this.openWithEl) this.openWithEl.style.display = tab === 'openwith' ? '' : 'none';
    if (this.toolsEl) this.toolsEl.style.display = tab === 'tools' ? '' : 'none';
    if (tab === 'factory') this.factoryPanel?.reload();
    this.persist();
  }

  show() {
    this.state.open = true;
    this.el.style.display = 'flex';
    this.el.style.width = this.state.width + 'px';
    this.setZoom(this.state.zoom);
    this.applyPos();
    this.showTab(this.state.tab);
    this.persist();
  }
  hide() {
    this.state.open = false;
    this.el.style.display = 'none';
    this.persist();
  }
  toggle() { this.state.open ? this.hide() : this.show(); }
}
