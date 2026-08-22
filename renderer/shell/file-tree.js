// renderer/shell/file-tree.js —— 目录树：工作区浏览 + 资源管理器式操作
// 能力：选中态驱动新建落点 · 拖拽移动/排序 · 剪切/复制/粘贴（Ctrl+X/C/V）· F2 重命名 · F5 刷新 · 触屏 ⋯ 菜单
import { menus } from '../core/menu-service.js';
import { contextKeys } from '../core/contextkey-service.js';
import { bus } from '../core/events.js';
import { commands } from '../core/command-registry.js';
import { toast } from './shell.js';
import { iconHtml } from '../lib/svg-icons.js';

const ORDER_KEY = 'tree.order';

// —— 路径工具：正反斜杠通吃，输出统一 '/'（Windows 下主进程已归一化，防御性兜底）——
const pnorm = (p) => String(p || '').replace(/\\/g, '/');
const pdir = (p) => pnorm(p).split('/').slice(0, -1).join('/');
const pbase = (p) => pnorm(p).split('/').pop();
const pjoin = (a, b) => pnorm(a).replace(/\/+$/, '') + '/' + b;

export class FileTree {
  constructor(root, {
    onOpenFile, onNewFile, onNewFolder, getWorkspace,
    shouldDeferExternalRefresh = () => false,
    externalRefreshDelay = 350,
    deferredRefreshPoll = 500,
  }) {
    this.el = root;
    this.onOpenFile = onOpenFile;
    this.getWorkspace = getWorkspace;
    this.shouldDeferExternalRefresh = shouldDeferExternalRefresh;
    this.externalRefreshDelay = externalRefreshDelay;
    this.deferredRefreshPoll = deferredRefreshPoll;
    this.expanded = new Set();
    this.selected = null;           // { path, isDir } —— 点击即选中（新建/粘贴的落点依据）
    this.clip = null;               // { mode:'cut'|'copy', path, isDir }
    this.dragPath = null;
    this.order = {};                // dirPath -> [name,...]（手动排序）
    this.orderLoaded = false;
    this.selectedPath = null;       // 兼容旧引用（shell.markActive）
    this.el.innerHTML = `
      <div class="sidebar-head"><span>工作区</span>
        <span class="acts">
          <button data-a="newFile" title="新建文件" aria-label="新建文件">${iconHtml('＋')}</button>
          <button data-a="newFolder" title="新建文件夹" aria-label="新建文件夹">${iconHtml('🗀')}</button>
          <button data-a="reindex" title="重建索引（全量重扫）" aria-label="重建索引">${iconHtml('⟳')}</button>
          <button data-a="collapse-all" title="全部折叠" aria-label="全部折叠">${iconHtml('⇤')}</button>
          <button data-a="sortmenu" title="排序方式" aria-label="选择排序方式">${iconHtml('⇅')}</button>
        </span></div>
      <div class="filetree" role="tree" tabindex="-1" aria-label="工作区文件树"></div>`;
    this.treeEl = this.el.querySelector('.filetree');
    // B13b「..st」窄列观感根治：侧栏过窄时隐藏父路径后缀（rtl+ellipsis 在窄列只剩两字符=视觉垃圾实锤）——
    // ResizeObserver 看树容器真实宽度，比阈值即挂 ft-narrow 类整族隐藏（无 RO 环境=一次性判定+resize 兜底）
    const ckNarrow = () => this.treeEl.classList.toggle('ft-narrow', this.treeEl.getBoundingClientRect().width < 210);
    if (typeof ResizeObserver !== 'undefined') {
      this._narrowRO = new ResizeObserver((es) => {
        for (const e of es) e.target.classList.toggle('ft-narrow', e.contentRect.width < 210);
      });
      this._narrowRO.observe(this.treeEl);
    } else { ckNarrow(); window.addEventListener('resize', ckNarrow); }
    this.el.querySelector('[data-a=newFile]').addEventListener('click', () => onNewFile());
    this.el.querySelector('[data-a=newFolder]').addEventListener('click', () => onNewFolder());
    this.el.querySelector('[data-a=refresh]')?.remove();
    this.el.querySelector('[data-a=reindex]').addEventListener('click', () => this.reindex());
    this.el.querySelector('[data-a=collapse-all]').addEventListener('click', () => {
      this.expanded.clear();
      this.refresh();
      toast('已全部折叠');
    });
    this.el.querySelector('[data-a=sortmenu]').addEventListener('click', (e) => {
      const btn = e.currentTarget.getBoundingClientRect();
      import('../lib/dom-menu.js').then(({ showDomMenu }) => {
        const cur = this.sortMode;
        const mk = (label, mode) => ({ label: (cur === mode ? '当前 · ' : '') + label, fn: () => this.setSortMode(mode) });
        showDomMenu([
          mk('名称字母升序', 'name-asc'), mk('名称字母降序', 'name-desc'),
          mk('名称自然升序', 'natural-asc'), mk('名称自然降序', 'natural-desc'),
          '-',
          mk('创建时间升序', 'ctime-asc'), mk('创建时间降序', 'ctime-desc'),
          mk('更新时间升序', 'mtime-asc'), mk('更新时间降序', 'mtime-desc'),
          '-',
          mk('手动排序（拖拽自定）', 'manual'),
        ], btn.left, btn.bottom + 4);
      });
    });

    // 空白区：左键 = 取消选中（新建/粘贴落点回到工作区根）；右键 = 根目录菜单；拖放 = 移到根目录
    this.treeEl.addEventListener('click', (e) => {
      if (e.target.closest('.ft-node')) return;
      this.select(null);
      this.treeEl.focus({ preventScroll: true });
    });
    this.treeEl.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.ft-node')) return;
      e.preventDefault();
      this.select(null);
      menus.show('fileTree/blank', { x: e.clientX, y: e.clientY, preferDom: true });
    });
    this.treeEl.addEventListener('dragover', (e) => {
      if (!e.target.closest('.ft-node') && this.dragPath) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    this.treeEl.addEventListener('drop', (e) => {
      if (e.target.closest('.ft-node')) return;
      e.preventDefault();
      this.dropTo(null);
    });
    this.treeEl.addEventListener('keydown', (e) => this.onKey(e));

    this.sortMode = 'manual';
    this.loadSortMode();

    // 磁盘变更 → 自动刷新（防抖）；批量生成落盘期间只记脏，收口后补刷一次。
    if (window.mazz?.isElectron) {
      window.mazz.on('file:changed', ({ path }) => this.queueExternalRefresh(path));
    }
    // 目录自动识别：窗口重新聚焦 / 定时巡检（外部程序改动也能看到）
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
    window.addEventListener('focus', () => this.refresh());
    if (!window.mazz?.isElectron) {
      const t = setInterval(() => { if (!document.hidden) this.refresh(); }, 10000);
      t.unref?.(); // 不阻塞进程退出（测试环境/Node）
    }
  }

  queueExternalRefresh(path = '') {
    this._pendingExternalRefreshPath = path || this._pendingExternalRefreshPath || '';
    clearTimeout(this._externalRefreshTimer);
    const flush = () => {
      this._externalRefreshTimer = null;
      if (this.shouldDeferExternalRefresh?.()) {
        this._externalRefreshTimer = setTimeout(flush, this.deferredRefreshPoll);
        return;
      }
      const changedPath = this._pendingExternalRefreshPath;
      this._pendingExternalRefreshPath = '';
      this.refresh();
      bus.emit('filetree:externallyChanged', changedPath);
    };
    this._externalRefreshTimer = setTimeout(flush, this.externalRefreshDelay);
  }

  // ==================== 排序方式（思源式） ====================
  setSortMode(mode) {
    this.sortMode = mode;
    this._sortModeDirty = true; // 手动设置优先：异步 loadSortMode 完成时不得覆盖（竞态实测）
    window.mazz?.invoke('settings:set', { key: 'mazz.filetree.sortMode', value: mode }).catch(() => {});
    this.refresh();
  }

  async loadSortMode() {
    const v = await window.mazz?.invoke('settings:get', { key: 'mazz.filetree.sortMode' }).catch(() => null);
    if (v && !this._sortModeDirty) this.sortMode = v;
  }

  /** 重建索引：清排序缓存全量重扫（外部改动异常时的一键复位） */
  async reindex() {
    this.orderLoaded = false;
    await this.loadOrder();
    await this.loadSortMode();
    this.expanded.clear();
    await this.refresh();
    toast('索引已重建');
  }

  /** 自然排序（数字按数值：p1<p2<p10）；name 先 String 化——watcher/索引来的条目 name 可能非字符串 */
  naturalCmp(a, b) {
    const ax = String(a ?? '').split(/(\d+)/), bx = String(b ?? '').split(/(\d+)/);
    for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
      const x = ax[i] ?? '', y = bx[i] ?? '';
      const nx = +x, ny = +y;
      if (!isNaN(nx) && !isNaN(ny) && x !== '' && y !== '') { if (nx !== ny) return nx - ny; continue; }
      const c = x.localeCompare(y, 'zh-CN');
      if (c) return c;
    }
    return 0;
  }

  // ==================== 选中 ====================
  select(sel) {
    this.selected = sel;
    this.selectedPath = sel?.path || null;
    contextKeys.set('treePath', sel?.path || '');
    contextKeys.set('treeIsDir', !!sel?.isDir);
    // W58b：压缩包选中态（右键菜单显隐凭据——扩展名白名单，魔数在 list/extract 才动）
    contextKeys.set('treeArchive', !!sel && !sel.isDir && /^(zip|rar|7z|tar|gz|tgz|bz2|xz|jar|apk|7zip|cab)$/i.test((sel.path.split('.').pop() || '')));
    const treeItems = [...this.treeEl.querySelectorAll('.ft-node[role="treeitem"]')];
    treeItems.forEach(n => {
      const selected = !!sel && n.dataset.path === sel.path;
      n.classList.toggle('on', selected);
      n.setAttribute('aria-selected', String(selected));
      n.tabIndex = selected ? 0 : -1;
    });
    if (!sel && treeItems[0]) treeItems[0].tabIndex = 0;
  }

  /** 新建落点：选中文件夹 → 其内；未选中 → 工作区根；选中文件 → 报错文案 */
  resolveTargetDir() {
    if (!this.selected) return { dir: null };
    if (this.selected.isDir) return { dir: this.selected.path };
    return { error: '文件下无法新建内容，请选中文件夹' };
  }

  /** 粘贴落点：选中文件夹 → 其内；选中文件 → 其父目录；未选中 → 工作区根 */
  resolvePasteDir() {
    if (!this.selected) return null;
    if (this.selected.isDir) return this.selected.path;
    return pdir(this.selected.path) || null;
  }

  // ==================== 新建（自动命名 + 行内改名） ====================
  /** 生成不重名的子项名：新建文件夹 / 新建文件夹 (1) / (2)… */
  async uniqueChildName(dir, base, ext = '') {
    for (let i = 0; ; i++) {
      const name = i === 0 ? base + ext : `${base} (${i})${ext}`;
      const st = await window.mazz.invoke('fs:stat', { path: `${dir}/${name}` }).catch(() => ({ exists: false }));
      if (!st.exists) return name;
    }
  }

  /**
   * 资源管理器式新建：先以自动名落位 → 行内改名条（文件名框不含后缀，后缀下拉调整）
   * Enter 确认（含改名后确认）/ Esc 保留自动名
   */
  async startInlineCreate(dir, kind, ext = 'md') {
    const ws = dir ?? await this.getWorkspace();
    if (!ws) return;
    let autoName;
    try {
      if (kind === 'folder') {
        autoName = await this.uniqueChildName(ws, '新建文件夹');
        await window.mazz.invoke('fs:mkdir', { path: pjoin(ws, autoName) });
      } else {
        autoName = await this.uniqueChildName(ws, '新建文件', '.' + ext);
        if (this.defaults?.BINARY_EXTS?.has(ext)) {
          // 二进制办公格式（docx/xlsx/pptx）：生成合法空文档
          const b64 = await this.defaults.makeBinaryDoc(ext);
          await window.mazz.invoke('fs:writeFileBase64', { path: pjoin(ws, autoName), base64: b64 });
        } else {
          const content = (this.defaults?.NEW_FILE_DEFAULTS?.[ext] ?? (() => ''))();
          await window.mazz.invoke('fs:writeFile', { path: pjoin(ws, autoName), content });
        }
      }
    } catch (e) { toast('新建失败：' + e.message); return; }
    this.expanded.add(pnorm(ws));
    await this.refresh();
    const newPath = pjoin(ws, autoName);
    this.select({ path: newPath, isDir: kind === 'folder' });
    this.beginInlineEdit(newPath, kind, autoName);
  }

  /**
   * 行内改名条：输入框（不含后缀）
   * rename=false（新建）：文件带后缀下拉，Esc 保留自动名
   * rename=true（重命名）：后缀固定保留，Esc 取消改名
   */
  beginInlineEdit(path, kind, autoName, { rename = false } = {}) {
    const node = [...this.treeEl.querySelectorAll('.ft-node')].find(n => n.dataset.path === path);
    if (!node) return;
    this.editing = true; // 刷新守卫：改名期间 refresh 一律推迟（防输入框被重渲染销毁）
    const dot = autoName.lastIndexOf('.');
    const isFile = kind === 'file';
    const oldExt = isFile ? autoName.slice(dot) : '';
    const oldStem = isFile ? autoName.slice(0, dot) : autoName;
    const nameEl = node.querySelector('.ft-name');
    nameEl.innerHTML = '';
    nameEl.classList.add('ft-editing');

    const input = document.createElement('input');
    input.className = 'ft-rename-input';
    input.value = oldStem;
    input.spellcheck = false;
    nameEl.appendChild(input);

    let sel = null;
    if (isFile && !rename) {
      sel = document.createElement('select');
      sel.className = 'ft-rename-ext';
      for (const t of (this.defaults?.NEW_FILE_TYPES || [{ ext: 'md' }])) {
        const o = document.createElement('option');
        o.value = '.' + t.ext;
        o.textContent = o.value;
        if (o.value === oldExt) o.selected = true;
        sel.appendChild(o);
      }
      nameEl.appendChild(sel);
    }
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      this.editing = false;
      const dir = pdir(path);
      if (commit) {
        const stem = (input.value.trim() || oldStem).replace(/[\\/:*?"<>|]/g, '-');
        const ext = sel ? sel.value : oldExt;
        const finalName = stem + ext;
        if (finalName !== autoName) {
          const to = `${dir}/${finalName}`;
          const st = await window.mazz.invoke('fs:stat', { path: to }).catch(() => ({ exists: false }));
          if (st.exists) {
            toast('同名项已存在，请换一个名字');
            done = false;
            input.focus();
            return;
          }
          // 新建流程：后缀变更且目标为二进制办公格式 → 重新生成合法空文档
          if (!rename && isFile && ext !== oldExt && this.defaults?.BINARY_EXTS?.has(ext.slice(1))) {
            try {
              const b64 = await this.defaults.makeBinaryDoc(ext.slice(1));
              await window.mazz.invoke('fs:writeFileBase64', { path, base64: b64 });
            } catch (e) { toast('格式转换失败：' + e.message); }
          }
          await window.mazz.invoke('fs:rename', { from: path, to });
          bus.emit('filetree:renamed', { from: path, to }); // 让打开中的标签同步新路径
          await this.refresh();
          this.select({ path: to, isDir: !isFile });
          if (isFile && !rename) this.onOpenFile(to);
          return;
        }
        // 未改名直接确认：新建文件默认打开；重命名直接结束
        await this.refresh();
        if (isFile && !rename) this.onOpenFile(path);
      } else {
        await this.refresh(); // Esc：新建保留自动名；重命名维持原名
      }
      // 改名期间被推迟的刷新补一轮
      if (this._refreshPending) { this._refreshPending = false; this.refresh(); }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    // 焦点在输入框与后缀下拉之间往返不算完成（点击下拉不提前提交）
    input.addEventListener('blur', (e) => { if (sel && e.relatedTarget === sel) return; finish(true); });
    sel?.addEventListener('blur', (e) => { if (e.relatedTarget === input) return; finish(true); });
    sel?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    sel?.addEventListener('change', () => input.focus());
  }

  // ==================== 手动排序 ====================
  async loadOrder() {
    const o = await window.mazz?.invoke('settings:get', { key: ORDER_KEY }).catch(() => null);
    this.order = (o && typeof o === 'object') ? o : {};
    this.orderLoaded = true;
  }
  persistOrder() {
    window.mazz?.invoke('settings:set', { key: ORDER_KEY, value: this.order }).catch(() => {});
  }
  applyOrder(entries, dirPath) {
    const mode = this.sortMode || 'manual';
    const dirFirst = (a, b) => (b.isDir - a.isDir);
    if (mode !== 'manual') {
      const s = (v) => String(v?.name ?? ''); // String 化：非字符串 name 不得炸 comparator
      const cmp = {
        'name-asc': (a, b) => s(a).localeCompare(s(b), 'zh-CN'),
        'name-desc': (a, b) => s(b).localeCompare(s(a), 'zh-CN'),
        'natural-asc': (a, b) => this.naturalCmp(a.name, b.name),
        'natural-desc': (a, b) => this.naturalCmp(b.name, a.name),
        'ctime-asc': (a, b) => (a.ctimeMs || 0) - (b.ctimeMs || 0),
        'ctime-desc': (a, b) => (b.ctimeMs || 0) - (a.ctimeMs || 0),
        'mtime-asc': (a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0),
        'mtime-desc': (a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0),
      }[mode];
      if (cmp) return [...entries].sort((a, b) => dirFirst(a, b) || cmp(a, b));
    }
    // 手动排序（拖拽自定，未设置的按名称排尾）
    const list = this.order[dirPath];
    if (!list?.length) return entries;
    const pos = new Map(list.map((n, i) => [n, i]));
    return [...entries].sort((a, b) => {
      const pa = pos.has(a.name) ? pos.get(a.name) : 1e9;
      const pb = pos.has(b.name) ? pos.get(b.name) : 1e9;
      if (pa !== pb) return pa - pb;
      return dirFirst(a, b) || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-CN');
    });
  }

  // ==================== 已关闭文件夹（思源「已关闭的笔记本」；按工作区隔离存储） ====================
  /** 存储 key 按工作区隔离：换工作区必须换对应的已关闭列表（此前全局共享一份，换区不跟随） */
  async _closedKey() {
    const ws = ((await this.getWorkspace?.()) || '').toString();
    let h = 0;
    for (let i = 0; i < ws.length; i++) h = (h * 31 + ws.charCodeAt(i)) >>> 0;
    return 'mazz.sidebar.closedDirs.' + h.toString(36);
  }

  async getClosedDirs() {
    if (this._closedDirs) return this._closedDirs;
    const key = await this._closedKey();
    let list = await window.mazz?.invoke('settings:get', { key }).catch(() => null);
    if (!list) {
      // 迁移：旧全局 key 中属于当前工作区的项并入本区（一次性，旧 key 保留不删，防多区互相偷）
      const legacy = (await window.mazz?.invoke('settings:get', { key: 'mazz.sidebar.closedDirs' }).catch(() => [])) || [];
      const ws = ((await this.getWorkspace?.()) || '').toString();
      list = ws ? legacy.filter(d => (d.path || '').startsWith(ws)) : legacy;
      await window.mazz?.invoke('settings:set', { key, value: list }).catch(() => {});
    }
    this._closedDirs = list || [];
    return this._closedDirs;
  }

  async closeDir(dirPath) {
    const list = await this.getClosedDirs();
    if (!list.some(d => d.path === dirPath)) {
      list.unshift({ path: dirPath, name: dirPath.split(/[\/]/).pop(), at: Date.now() });
      await window.mazz?.invoke('settings:set', { key: await this._closedKey(), value: list });
    }
    this.expanded.delete(dirPath);
    this.select(null);
    await this.refresh();
    toast(`已关闭「${dirPath.split(/[\/]/).pop()}」（底部已关闭组可恢复）`);
  }

  async reopenDir(dirPath) {
    const list = await this.getClosedDirs();
    const i = list.findIndex(d => d.path === dirPath);
    if (i >= 0) {
      list.splice(i, 1);
      await window.mazz?.invoke('settings:set', { key: await this._closedKey(), value: list });
    }
    this.expanded.add(dirPath);
    await this.refresh();
  }

  /** 已关闭组渲染（树根底部，可展开收起） */
  async renderClosedDirs() {
    const list = await this.getClosedDirs();
    if (!list.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'ft-closed';
    const open = this._closedOpen !== false;
    // 箭头独立 span：展收只换箭头字符，绝不吃标题文字（此前替换整个文本节点，点一次「已关闭的文件夹」就消失）
    wrap.innerHTML = `<div class="ft-closed-head" role="button" tabindex="0" aria-expanded="${open}" aria-controls="ft-closed-body"><span class="ft-closed-arrow" aria-hidden="true">${iconHtml(open ? '▾' : '▸')}</span> 已关闭的文件夹 <span class="ft-closed-count">${list.length}</span></div>`;
    const body = document.createElement('div');
    body.className = 'ft-closed-body';
    body.id = 'ft-closed-body';
    body.style.display = open ? '' : 'none';
    for (const d of list) {
      const row = document.createElement('div');
      row.className = 'ft-node ft-closed-item';
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-label', `重新打开文件夹 ${d.name}`);
      row.innerHTML = `<span class="ft-ico">${iconHtml('🗂')}</span><span class="ft-name">${d.name}</span>`;
      row.title = d.path;
      const reopen = document.createElement('span');
      reopen.className = 'ft-more ft-reopen';
      reopen.title = '重新打开（移回主树）';
      reopen.setAttribute('aria-hidden', 'true');
      reopen.innerHTML = iconHtml('⇱');
      row.appendChild(reopen);
      // 整行可点 = 重新打开（此前只有小图标能点，窄栏字没了就点不动）
      row.style.cursor = 'pointer';
      row.title = d.path + '\n点击重新打开';
      row.addEventListener('click', () => this.reopenDir(d.path));
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        row.click();
      });
      body.appendChild(row);
    }
    const head = wrap.querySelector('.ft-closed-head');
    head.addEventListener('click', () => {
      // 读当前态取反（不用渲染闭包 open——旧值让第二次点击恒定赋回同值=「点完卡住，点别处刷新回来才好」实锤）
      this._closedOpen = !(this._closedOpen !== false);
      body.style.display = this._closedOpen ? '' : 'none';
      wrap.querySelector('.ft-closed-arrow').innerHTML = iconHtml(this._closedOpen ? '▾' : '▸'); // 只换箭头，标题永驻
      head.setAttribute('aria-expanded', String(this._closedOpen));
    });
    head.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      head.click();
    });
    wrap.appendChild(body);
    return wrap;
  }

  // ==================== 渲染 ====================
  async refresh() {
    // 行内改名进行中：不刷新（刷新会销毁输入框），改名结束后补刷
    if (this.editing) { this._refreshPending = true; return; }
    // 刷新竞态守卫：只让最后一次刷新落地（聚焦/可见性/监听器会并发触发，旧帧丢弃——否则出现重复目录树的伪表象）
    const seq = (this._refreshSeq = (this._refreshSeq || 0) + 1);
    if (!this.orderLoaded) await this.loadOrder();
    const ws = await this.getWorkspace();
    if (seq !== this._refreshSeq || this.editing) { if (this.editing) this._refreshPending = true; return; }
    this.treeEl.innerHTML = '';
    if (!ws) {
      const empty = document.createElement('div');
      empty.className = 'ft-empty';
      empty.innerHTML = '尚未选择工作区<br>点击「文件 → 打开工作区」';
      this.treeEl.appendChild(empty);
      return;
    }
    const frag = await this.renderDir(ws, 0);
    if (seq !== this._refreshSeq || this.editing) { if (this.editing) this._refreshPending = true; return; }
    this.treeEl.appendChild(frag);
    // 「已关闭的文件夹」组（思源已关闭笔记本）：收在树根底部
    const closed = await this.renderClosedDirs();
    if (closed && seq === this._refreshSeq) this.treeEl.appendChild(closed);
    const treeItems = [...this.treeEl.querySelectorAll('.ft-node[role="treeitem"]')];
    if (treeItems.length && !treeItems.some(item => item.tabIndex === 0)) treeItems[0].tabIndex = 0;
  }

  async renderDir(dirPath, depth) {
    const frag = document.createDocumentFragment();
    let entries = [];
    try { entries = await window.mazz.invoke('fs:listDir', { path: dirPath }); }
    catch (e) { console.warn('[filetree]', e.message); return frag; }
    entries = this.applyOrder(entries, dirPath);
    // 已关闭文件夹：从主树过滤（归入底部已关闭组）
    if (this._closedDirs?.length) {
      const closedSet = new Set(this._closedDirs.map(d => d.path));
      entries = entries.filter(e => !closedSet.has(e.path));
    }
    for (const entry of entries) {
      const node = document.createElement('div');
      node.className = 'ft-node' + (this.selected?.path === entry.path ? ' on' : '');
      node.dataset.path = entry.path;
      node.dataset.isdir = entry.isDir ? '1' : '';
      node.setAttribute('role', 'treeitem');
      node.setAttribute('aria-selected', String(this.selected?.path === entry.path));
      node.setAttribute('aria-level', String(depth + 1));
      node.tabIndex = this.selected?.path === entry.path ? 0 : -1;
      node.draggable = true;
      const isOpen = this.expanded.has(entry.path);
      if (entry.isDir) node.setAttribute('aria-expanded', String(isOpen));
      const ico = document.createElement('span');
      ico.className = 'ft-ico';
      ico.setAttribute('aria-hidden', 'true');
      if (entry.isDir) ico.innerHTML = iconHtml(isOpen ? '▾' : '▸');
      else ico.innerHTML = iconFor(entry.name);
      const name = document.createElement('span');
      name.className = 'ft-name';
      name.textContent = entry.name;
      node.append(ico, name);
      // 右侧淡色标注所在目录（思源式路径提示）
      const dir = document.createElement('span');
      dir.className = 'ft-dir';
      const parent = entry.path.split('/').slice(0, -1).join('/');
      dir.textContent = parent;
      node.appendChild(dir);
      node.title = entry.path;
      if (entry.isDir) {
        // 文件夹行内按钮：添加文件夹（左）+ 添加文件（右）+ ⋯（与顶部按钮同逻辑）
        const mkBtn = (text, title, fn, rightPx) => {
          const b = document.createElement('button');
          b.className = 'ft-more';
          b.style.right = rightPx + 'px';
          b.innerHTML = iconHtml(text);
          b.title = title;
          b.setAttribute('aria-label', title);
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            this.select({ path: entry.path, isDir: true });
            this.expanded.add(entry.path);
            fn();
          });
          node.appendChild(b);
          return b;
        };
        mkBtn('🗀', '在此文件夹内新建文件夹', () => this.startInlineCreate(entry.path, 'folder'), 50);
        mkBtn('＋', '在此文件夹内新建文件', () => this.startInlineCreate(entry.path, 'file'), 27);
      }
      // 触屏 ⋯ 按钮（桌面端 hover 显示，触屏常显）
      const more = document.createElement('button');
      more.className = 'ft-more';
      more.innerHTML = iconHtml('⋯');
      more.title = '更多操作';
      more.setAttribute('aria-label', `${entry.name} 的更多操作`);
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select({ path: entry.path, isDir: entry.isDir });
        const r = node.getBoundingClientRect();
        menus.show(entry.isDir ? 'fileTree/folder' : 'fileTree/file', { x: r.right - 8, y: r.bottom, preferDom: true });
      });
      node.appendChild(more);
      frag.appendChild(node);

      node.addEventListener('click', async (e) => {
        if (e.detail > 1) return; // 双击的第二击交给 dblclick（改名），避免二次展开/打开打断编辑
        this.treeEl.focus({ preventScroll: true }); // 保持键盘焦点：F2/Delete/Ctrl+XCV 始终可用
        this.select({ path: entry.path, isDir: entry.isDir });
        if (entry.isDir) {
          this.expanded.has(entry.path) ? this.expanded.delete(entry.path) : this.expanded.add(entry.path);
          await this.refresh();
        } else {
          await this.onOpenFile(entry.path);
          this.treeEl.focus({ preventScroll: true }); // 打开后焦点留在树上（资源管理器习惯；点编辑区再输入）
        }
      });
      node.addEventListener('focus', () => this.select({ path: entry.path, isDir: entry.isDir }));
      // 双击已选中行 → 行内重命名（触屏长按同效）
      node.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (this.selected?.path !== entry.path) return;
        this.beginInlineEdit(entry.path, entry.isDir ? 'folder' : 'file', entry.name, { rename: true });
      });
      // 触屏长按 → 选中并重命名（550ms，移动超 10px 取消）
      node.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        const startX = e.clientX, startY = e.clientY;
        const timer = setTimeout(() => {
          this.select({ path: entry.path, isDir: entry.isDir });
          this.beginInlineEdit(entry.path, entry.isDir ? 'folder' : 'file', entry.name, { rename: true });
        }, 550);
        const cancel = (ev) => {
          if (ev.type === 'pointermove' && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 10) return;
          clearTimeout(timer);
          node.removeEventListener('pointerup', cancel);
          node.removeEventListener('pointercancel', cancel);
          node.removeEventListener('pointermove', cancel);
        };
        node.addEventListener('pointerup', cancel);
        node.addEventListener('pointercancel', cancel);
        node.addEventListener('pointermove', cancel);
      }, { once: false });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.select({ path: entry.path, isDir: entry.isDir });
        menus.show(entry.isDir ? 'fileTree/folder' : 'fileTree/file', { x: e.clientX, y: e.clientY, preferDom: true });
      });
      this.bindDrag(node, entry);

      if (entry.isDir && isOpen) {
        const childWrap = document.createElement('div');
        childWrap.className = 'ft-children';
        childWrap.appendChild(await this.renderDir(entry.path, depth + 1));
        frag.appendChild(childWrap);
      }
    }
    if (!entries.length && depth === 0) {
      const empty = document.createElement('div');
      empty.className = 'ft-empty';
      empty.textContent = '空文件夹 — 右键新建文件开始';
      frag.appendChild(empty);
    }
    return frag;
  }

  // ==================== 拖拽移动 / 排序 ====================
  bindDrag(node, entry) {
    node.addEventListener('dragstart', (e) => {
      this.dragPath = entry.path;
      e.dataTransfer.setData('text/plain', entry.path);
      e.dataTransfer.effectAllowed = 'move';
    });
    node.addEventListener('dragend', () => { this.dragPath = null; this.clearDropMarks(); });
    node.addEventListener('dragover', (e) => {
      if (!this.dragPath || this.dragPath === entry.path) return;
      if (entry.isDir) {
        // 目标是文件夹：禁止落入自身/后代
        if (entry.path === this.dragPath || entry.path.startsWith(this.dragPath + '/')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        node.classList.add('ft-drop');
      } else {
        // 目标是文件：排序到其前（同目录）或移入其父目录
        const destParent = pdir(entry.path);
        if (destParent === this.dragPath || destParent.startsWith(this.dragPath + '/')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        node.classList.add('ft-drop-before');
      }
    });
    node.addEventListener('dragleave', () => node.classList.remove('ft-drop', 'ft-drop-before'));
    node.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const src = this.dragPath;
      node.classList.remove('ft-drop', 'ft-drop-before');
      if (!src || src === entry.path) return;
      if (entry.isDir) await this.dropTo(entry.path);
      else await this.dropTo(pdir(entry.path), entry.name);
    });
  }
  clearDropMarks() {
    this.treeEl.querySelectorAll('.ft-drop,.ft-drop-before').forEach(n => n.classList.remove('ft-drop', 'ft-drop-before'));
  }

  /** 落点处理：targetDir=null → 工作区根；beforeName → 同级排序到该名前 */
  async dropTo(targetDir, beforeName) {
    const src = pnorm(this.dragPath);
    this.dragPath = null;
    if (!src) return;
    const ws = await this.getWorkspace();
    const destDir = pnorm(targetDir ?? ws);
    if (!destDir) return;
    const srcName = pbase(src);
    const srcParent = pdir(src);
    if (destDir === src || destDir.startsWith(src + '/')) { toast('不能移动到自身内部'); return; }

    if (destDir === srcParent) {
      // 同目录：仅更新手动排序
      if (beforeName && beforeName !== srcName) {
        const list = (this.order[destDir] || (await window.mazz.invoke('fs:listDir', { path: destDir })).map(f => f.name)).filter(n => n !== srcName);
        list.splice(list.indexOf(beforeName), 0, srcName);
        this.order[destDir] = list;
        this.persistOrder();
        await this.refresh();
      }
      return;
    }
    const dest = pjoin(destDir, srcName);
    const st = await window.mazz.invoke('fs:stat', { path: dest });
    if (st.exists) { toast('目标位置已存在同名项'); return; }
    try {
      await window.mazz.invoke('fs:rename', { from: src, to: dest });
    } catch (e2) { toast('移动失败：' + e2.message); return; }
    this.expanded.add(destDir);
    await this.refresh();
    toast('已移动');
  }

  // ==================== 剪切 / 复制 / 粘贴 ====================
  cutCopy(mode) {
    if (!this.selected) { toast('先选中一个文件或文件夹'); return; }
    this.clip = { mode, path: this.selected.path, isDir: this.selected.isDir };
    contextKeys.set('treeClip', true);
    this.treeEl.querySelectorAll('.ft-node').forEach(n =>
      n.classList.toggle('ft-cut', n.dataset.path === this.clip.path && mode === 'cut'));
    toast((mode === 'cut' ? '已剪切：' : '已复制：') + this.clip.path.split('/').pop());
  }

  async paste() {
    if (!this.clip) { toast('剪贴板为空——先剪切或复制'); return; }
    const ws = await this.getWorkspace();
    const destDir = this.resolvePasteDir() ?? ws;
    if (!destDir) return;
    const src = this.clip;
    if (src.isDir && (destDir === src.path || destDir.startsWith(src.path + '/'))) {
      toast('不能粘贴到自身内部');
      return;
    }
    const name = pbase(src.path);
    try {
      if (src.mode === 'cut') {
        const dest = pjoin(destDir, name);
        const st = await window.mazz.invoke('fs:stat', { path: dest });
        if (st.exists) { toast('目标位置已存在同名项'); return; }
        await window.mazz.invoke('fs:rename', { from: src.path, to: dest });
        this.clip = null;
        contextKeys.set('treeClip', false);
      } else {
        const dest = await this.uniquePath(pjoin(destDir, name));
        await this.copyRecursive(src.path, dest, src.isDir);
      }
    } catch (e) { toast('粘贴失败：' + e.message); return; }
    this.expanded.add(destDir);
    await this.refresh();
    toast('已粘贴');
  }

  async copyRecursive(from, to, isDir) {
    if (!isDir) {
      const b64 = await window.mazz.invoke('fs:readFileBase64', { path: from });
      await window.mazz.invoke('fs:writeFileBase64', { path: to, base64: b64 });
      return;
    }
    await window.mazz.invoke('fs:mkdir', { path: to });
    const entries = await window.mazz.invoke('fs:listDir', { path: from }).catch(() => []);
    for (const e of entries) await this.copyRecursive(e.path, pjoin(to, e.name), e.isDir);
  }

  /** 重名避让：名称 (2).ext */
  async uniquePath(p) {
    p = pnorm(p);
    const st = await window.mazz.invoke('fs:stat', { path: p }).catch(() => ({ exists: false }));
    if (!st.exists) return p;
    const dir = pdir(p);
    const name = pbase(p);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const cand = `${dir}/${stem} (${i})${ext}`;
      const s = await window.mazz.invoke('fs:stat', { path: cand }).catch(() => ({ exists: true }));
      if (!s.exists) return cand;
    }
  }

  // ==================== 键盘（资源管理器习惯） ====================
  onKey(e) {
    if (e.target.closest('button,input,select,textarea')) return;
    const sel = this.selected;
    const exec = (id) => { e.preventDefault(); e.stopPropagation(); commands.execute(id); };
    if (e.key === 'F2' && sel) return exec('fileTree.rename');
    if (e.key === 'F5') return exec('fileTree.refresh');
    if (e.key === 'Delete' && sel) return exec('fileTree.delete');
    if ((e.key === 'Enter' || e.key === ' ') && sel) {
      e.preventDefault(); e.stopPropagation();
      if (sel.isDir) {
        this.expanded.has(sel.path) ? this.expanded.delete(sel.path) : this.expanded.add(sel.path);
        this.refresh();
      } else this.onOpenFile(sel.path);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'x' && sel) { e.preventDefault(); e.stopPropagation(); this.cutCopy('cut'); }
      else if (k === 'c' && sel) { e.preventDefault(); e.stopPropagation(); this.cutCopy('copy'); }
      else if (k === 'v') { e.preventDefault(); e.stopPropagation(); this.paste(); }
      else if (k === 'shift') { /* noop */ }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
      return exec('fileTree.newFolder');
    }
  }

  markActive(filePath) {
    // 仅视觉高亮「当前打开的文件」，不改变新建/粘贴的落点选择
    this.selectedPath = filePath;
    this.treeEl.querySelectorAll('.ft-node').forEach(n =>
      n.classList.toggle('on', n.dataset.path === filePath));
  }
}

const FT_ICONS = {
  md: 'Ⓜ', markdown: 'Ⓜ', txt: '🄣', mazz: '◆', pdf: '📕',
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', svg: '🖼', bmp: '🖼',
  mp4: '🎬', webm: '🎬', ogv: '🎬', mov: '🎬', m4v: '🎬', mkv: '🎬', avi: '🎬', wmv: '🎬', flv: '🎬', ts: '🎬', mts: '🎬', m2ts: '🎬',
  mp3: '🎵', wav: '🎵', ogg: '🎵', oga: '🎵', m4a: '🎵', aac: '🎵', flac: '🎵', opus: '🎵',
  xlsx: '📊', csv: '📊', tsv: '📊', mazzsheet: '📊',
  docx: '📄', pptx: '📽', mazzslide: '📽', epub: '📚', cbz: '📚', mobi: '📚', azw3: '📚', fb2: '📚',
  mazzmap: '🧠', mm: '🧠', opml: '🧠', xmind: '🧠', mazzdraw: '🎨', ora: '🎨',
  js: '📜', py: '🐍', json: '🔧', html: '🌐', css: '🎨',
};
function iconFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  // ts 专判：.ts 可能是 TypeScript（代码）或 MPEG-TS（视频）——.mts/.m2ts 已归视频，裸 .ts 归代码（v33 定案）
  const glyph = FT_ICONS[ext] || '🄵';
  return iconHtml(glyph);
}
