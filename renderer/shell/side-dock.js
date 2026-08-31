// renderer/shell/side-dock.js —— 右侧工具坞：Ribbon 启动 · 右靠停靠/自由拖动 · 拉伸 · 内容缩放
// 承载未在欢迎页展示的功能：智能创作（Factory）、打开方式
import { commands } from '../core/command-registry.js';
import { toast } from './shell.js';
import { iconHtml } from '../lib/svg-icons.js';

const LS_KEY = 'mazz.sideDock';

export class SideDock {
  constructor(shell) {
    this.shell = shell;
    this._toolsReady = false;
    this._toolsReadyPromise = new Promise(resolve => { this._resolveToolsReady = resolve; });
    this._factoryReady = false;
    this._factoryReadyPromise = new Promise(resolve => { this._resolveFactoryReady = resolve; });
    this.state = { open: false, tab: 'factory', width: 380, height: 560, zoom: 1, float: null, collapsed: false }; // float: {x, y} | null = 停靠；collapsed: 折叠轨
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY)) || {};
      // W52f 迁移（_v<2）：margin hack 时代的 float 记忆一律回停靠——真推拉升级后老坞不该再浮着（真机实锤）
      if (saved._v !== 2) { saved.float = null; saved._v = 2; }
      Object.assign(this.state, saved);
    } catch {}
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
          <button class="sd-btn" data-a="collapse" title="折叠为细轨（再点展开）">${iconHtml('›')}</button>
          <button class="sd-btn" data-a="zoom-out" title="缩小内容">${iconHtml('－')}</button>
          <span class="sd-zoom">100%</span>
          <button class="sd-btn" data-a="zoom-in" title="放大内容">${iconHtml('＋')}</button>
          <button class="sd-btn" data-a="float" title="停靠/浮动切换（双击标题栏同效）">${iconHtml('⇱')}</button>
          <button class="sd-btn" data-a="close" title="关闭">${iconHtml('✕')}</button>
        </span>
      </div>
      <div class="sd-body"></div>
      <button class="sd-rail" data-a="expand" title="展开工具坞">${iconHtml('‹')}</button>
      <div class="sd-grip" title="拖拽调整宽度"></div>
      <div class="sd-grip-b" title="拖拽调整高度（浮动模式）"></div>
      <div class="sd-grip-c" title="拖拽调整大小（浮动模式）"></div>`;
    this.mount(); // W52e③ 真推拉：停靠态塞 .workspace 当 flex 兄弟（布局成员），浮动/关闭才挂 body 浮层
    this.body = this.el.querySelector('.sd-body');
    this.el.style.display = 'none';

    this.el.querySelector('[data-a=close]').addEventListener('click', () => this.hide());
    this.el.querySelector('[data-a=float]').addEventListener('click', () => this.toggleFloat());
    this.el.querySelector('[data-a=collapse]').addEventListener('click', () => this.setCollapsed(true));
    this.el.querySelector('[data-a=expand]').addEventListener('click', () => this.setCollapsed(false));
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
        const w = Math.min(Math.max(startW + dw, 300), Math.min(760, Math.round(innerWidth * 0.6))); // 限位钳（窗宽 60% 封顶——全屏钮区不被挤掉同款纪律）
        this.state.width = w;
        this.el.style.width = w + 'px';
        // 真推拉：width 一改 flex 自动让位（零 JS 推挤——布局引擎干活）
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

    // 标题栏拖动（W54 手势三态①：停靠态按住拽出=直接开 dockfloat 子窗格并跟手——老浮动路径退役）/ 双击切停靠
    const bar = this.el.querySelector('.sd-bar');
    bar.addEventListener('pointerdown', (e) => {
      // 只拦「按钮」本身（页签/操作钮正常点击），标题栏其余一切区域（间隙/padding/文字空档）均可拖——
      // 此前拦 .sd-btn/.sd-tab 类，而页签按钮几乎占满标题栏，用户根本找不到可拖点=「工具坞拖不出去」实锤
      if (e.target.closest('button')) return;
      if (!this.state.float && window.mazz?.isElectron) {
        e.preventDefault();
        try { bar.setPointerCapture(e.pointerId); } catch {}
        // 停靠态拽出：超阈值即浮（dockfloat 子窗格），子窗先落在原工具坞的抓手位，再交给主进程跟手。
        // 旧路径只 open 不传 x/y，Electron 把窗居中；首个 move 又以“居中后 bounds”补建 offset，
        // 数学上等于永远停在屏幕中央。这里必须把原坞位置+抓手偏移一起交给 panel owner。
        let floated = false;
        let ended = false;
        let latest = { sx: e.screenX, sy: e.screenY };
        let floatReady = null;
        const dockRect = this.el.getBoundingClientRect();
        const grabX = e.clientX - dockRect.left;
        const grabY = e.clientY - dockRect.top;
        const move = (ev) => {
          latest = { sx: ev.screenX, sy: ev.screenY };
          if (!floated) {
            if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 8) return;
            floated = true;
            floatReady = Promise.resolve(this.toggleFloat({
              anchor: {
                x: Math.round(ev.screenX - grabX),
                y: Math.round(ev.screenY - grabY),
                sx: ev.screenX,
                sy: ev.screenY,
              },
              width: Math.round(dockRect.width),
              height: Math.round(dockRect.height),
            }));
          }
          // open/dragStart 未就绪时只保留最新指针；就绪后立即追上，不把中间过期坐标排队。
          floatReady?.then(() => {
            if (!ended) return window.mazz.invoke('panel:move', { kind: 'dockfloat', origin: 'host', ...latest });
          }).catch(() => {});
        };
        const cleanup = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('blur', cancel);
          try { if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId); } catch {}
        };
        const finish = (cancelled) => {
          if (ended) return;
          ended = true;
          cleanup();
          if (floated) floatReady?.then(async () => {
            if (cancelled) {
              await window.mazz.invoke('panel:dragCancel', { kind: 'dockfloat', origin: 'host' }).catch(() => {});
              return;
            }
            await window.mazz.invoke('panel:move', { kind: 'dockfloat', origin: 'host', ...latest }).catch(() => {});
            await window.mazz.invoke('panel:dragEnd', { kind: 'dockfloat', origin: 'host' }).catch(() => {}); // 拽回热区=自动停靠
          }).catch(() => {});
        };
        const up = () => finish(false);
        const cancel = () => finish(true);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
        return;
      }
      // 非 Electron 预览/已浮动态：老 body 浮层拖拽兜底
      const rect = this.el.getBoundingClientRect();
      const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
      const wasDocked = !this.state.float;
      const move = (ev) => {
        if (wasDocked) {
          const r = this.el.getBoundingClientRect();
          this.state.float = { x: rect.left, y: rect.top };
          this.state.height = Math.round(r.height);
        }
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
      Promise.resolve(this.factoryPanel.ready).then(() => {
        this._factoryReady = true;
        this._resolveFactoryReady?.(true);
        this._resolveFactoryReady = null;
      }).catch(error => {
        console.error('[side-dock] 智能创作 owner 初始化失败:', error?.message || error);
        this._resolveFactoryReady?.(false);
        this._resolveFactoryReady = null;
      });
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
      this._toolsReady = true;
      this._resolveToolsReady?.(true);
      this._resolveToolsReady = null;
      // persisted-float 冷启动时，面板的第一次 query 可能早于本动态 import。
      // owner 构建完成必须主动补推，不能指望用户再切一次页签。
      this.pushToolsSnapshot();
      this.showTab(this.state.tab);
    }).catch(error => {
      console.error('[side-dock] 内容 owner 初始化失败:', error?.message || error);
      this._resolveFactoryReady?.(false);
      this._resolveFactoryReady = null;
      this._resolveToolsReady?.(false);
      this._resolveToolsReady = null;
    });
  }

  /** 打开方式页：大拖放区 + 2×2 快捷入口 */
  buildOpenWith() {
    const t = (s) => s;
    this.openWithEl.innerHTML = `
      <div class="w-drop" id="sd-dropzone">
        <div class="w-drop-ico">${iconHtml('⇩')}</div>
        <div class="w-drop-t">把文件拖到这里</div>
        <div class="w-drop-d">图片 · PDF · 音视频，立即查看</div>
      </div>
      <div class="w-ow-grid" style="margin-top:10px">
        <button class="w-ow-card" data-cmd="file.openViewer"><div class="t">${iconHtml('🖼')} 查看器预览</div><div class="d">图片/PDF/音视频</div></button>
        <button class="w-ow-card" data-cmd="file.openWithSystem"><div class="t">${iconHtml('🚀')} 系统默认打开</div><div class="d">调起外部程序</div></button>
        <button class="w-ow-card" data-cmd="file.import"><div class="t">${iconHtml('📥')} 导入工作区</div><div class="d">多选文件/文件夹</div></button>
        <button class="w-ow-card" data-cmd="file.quickOpen"><div class="t">${iconHtml('⚡')} Quick Switcher</div><div class="d">文件 / 命令 / 最近 / 全文直达</div></button>
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
    const GROUPS = this._toolsGroups = [
      ['文件', [
        // W66：压缩包面板入坞可发现（图标 iconHtml 统一风格——「压根找不到」实锤平反）
        { cmd: 'archive.openPanel', ico: '📦', t: '压缩包', d: '查看清单/安全解压/打包 zip（完整 7-Zip 多格式兜底）' },
      ]],
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
        { cmd: 'file.newViewer', ico: '🎬', t: '打开播放器', d: '空手起播：媒体库/网络资源选源即播 · 悬停缩略图 · 无边框' },
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
    ].map(([group, items]) => [group, items.filter(item => commands.has(item.cmd))]).filter(([, items]) => items.length);
    this.toolsEl.innerHTML = GROUPS.map(([g, items]) => `
      <div class="sd-tools-group">
        <div class="sd-tools-label">${g}</div>
        <div class="sd-tools-grid">
          ${items.map(it => `
            <button class="sd-tool-card" data-cmd="${it.cmd}">
              <span class="sd-tool-ico">${iconHtml(it.ico)}</span>
              <span class="sd-tool-text"><b>${it.t}${commands.get(it.cmd)?.maturity === 'preview' ? '（预览）' : ''}</b><i>${it.d}</i></span>
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

  async toggleFloat({ anchor = null, width = null, height = null } = {}) {
    if (this.state.float) {
      // 浮 → 停：关 dockfloat 子窗格，坞回 workspace
      this.state.float = null;
      if (window.mazz?.isElectron) await window.mazz.invoke('panel:close', { kind: 'dockfloat' }).catch(() => {});
    } else {
      // 停 → 浮（W53：纯原生圆角独立子窗格——body 浮层时代退役，再重也迁移）
      if (window.mazz?.isElectron) {
        this.state.float = { x: 0, y: 0 }; // 记忆语义：浮动中（位置由子窗格自管）
        this.state.open = false;
        this.mount();
        this.el.style.display = 'none';
        const opts = anchor ? {
          x: anchor.x,
          y: anchor.y,
          w: Math.max(360, Number(width) || this.state.width || 400),
          h: Math.max(420, Number(height) || this.state.height || 620),
        } : undefined;
        await window.mazz.invoke('panel:open', opts ? { kind: 'dockfloat', opts } : { kind: 'dockfloat' }).catch(() => {});
        if (anchor) {
          // 明确开启拖拽会话；不再让 panel:move 在一个未定位的居中窗上猜 offset。
          await window.mazz.invoke('panel:dragStart', { kind: 'dockfloat', origin: 'host', sx: anchor.sx, sy: anchor.sy }).catch(() => {});
        }
        this.persist();
        return;
      }
      const r = this.el.getBoundingClientRect();
      this.state.height = Math.round(r.height);
      this.state.float = { x: r.left, y: r.top };
    }
    this.applyPos();
    this.mount(); // 停靠/浮动换位即搬家（flex 兄弟 ⇄ body 浮层）
    this.persist();
  }

  /** 坞浮动子窗格关闭/回停靠联动：坞重新上岗（panel:changed 与 dockFloatBack 双通道） */
  backFromFloat() {
    if (!this.state.float) { if (!this.state.open) this.show(); return; }
    this.state.float = null;
    this.persist();
    this.show();
  }

  /** 工具页卡片数据出口（dockfloat 子窗格镜像用——GROUPS 单源不复制） */
  toolsGroups() { return this._toolsReady ? (this._toolsGroups || []) : null; }

  async whenToolsReady(timeoutMs = 5000) {
    if (this._toolsReady) return true;
    let timer = 0;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const ready = await Promise.race([this._toolsReadyPromise, timeout]);
    clearTimeout(timer);
    return !!ready && this._toolsReady;
  }

  async whenFactoryReady(timeoutMs = 10000) {
    if (this._factoryReady && this.factoryPanel) return true;
    let timer = 0;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const ready = await Promise.race([this._factoryReadyPromise, timeout]);
    clearTimeout(timer);
    return !!ready && this._factoryReady && !!this.factoryPanel;
  }

  pushToolsSnapshot() {
    const groups = this.toolsGroups();
    if (!groups?.some(([, items]) => items?.length) || !window.mazz?.isElectron) return false;
    const svgGroups = groups.map(([group, items]) => [group, items.map(item => ({
      ...item,
      ico: item.ico ? iconHtml(item.ico) : '',
    }))]);
    window.mazz.invoke('panel:push', { kind: 'dockfloat', payload: { type: 'dockTools', groups: svgGroups } }).catch(() => {});
    return true;
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
      this.el.style.left = '';
      this.el.style.top = '';
      this.el.style.right = '';
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
    if (tab === 'factory' && this._factoryReady) this.factoryPanel?.reload();
    this.persist();
  }

  show() {
    this.state.open = true;
    // 复活路线修正（新窗格下旧浮层坞复活实锤）：Electron 下 float 非空永远走 dockfloat 子窗格——
    // 老 body 浮层路径只配在非 Electron 兜底；dockfloat 单例聚焦（panel-windows open 幂等）
    if (this.state.float && window.mazz?.isElectron) {
      this.mount(); // docked=false：坞本体挂 body 但不显示
      this.el.style.display = 'none';
      window.mazz.invoke('panel:open', { kind: 'dockfloat' }).catch(() => {});
      this.persist();
      return;
    }
    this.mount();
    this.el.style.display = 'flex';
    this.el.style.width = this.state.width + 'px';
    this.setZoom(this.state.zoom);
    this.applyPos();
    this.showTab(this.state.tab);
    this.setCollapsed(this.state.collapsed, true);
    this.mount();
    this.persist();
  }
  hide() {
    this.state.open = false;
    this.el.style.display = 'none';
    this.mount();
    this.persist();
  }

  /** 折叠轨（W52②：‹/› SVG 钮——折叠成 36px 细轨只留展开钮/展开复宽；记忆在 state.collapsed） */
  setCollapsed(on, silent = false) {
    this.state.collapsed = !!on;
    this.el.classList.toggle('collapsed', this.state.collapsed);
    if (!this.state.collapsed) this.el.style.width = this.state.width + 'px';
    this.mount();
    if (!silent) this.persist();
  }

  /** 真推拉布局（W52e③）：停靠态坞是 .workspace 的 flex 兄弟——宽度即布局，让位由 flex 自动完成
   *  （margin hack 平反：效果近似冒充结构同构=返工案）；浮动/关闭搬回 body 浮层不占位 */
  mount() {
    const ws = this.shell?.panesEl?.closest?.('.workspace');
    const docked = this.state.open && !this.state.float;
    if (docked && ws && this.el.parentElement !== ws) ws.appendChild(this.el);
    else if (!docked && this.el.parentElement !== document.body) document.body.appendChild(this.el);
  }
  toggle() { this.state.open ? this.hide() : this.show(); }
}
