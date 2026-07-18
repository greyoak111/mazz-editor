// main/main.js —— Mazz Editor 主进程总装配
// 单实例 · mazz:// 协议 · 文件关联参数转发 · 白名单 IPC · 托盘 · 全局快捷键 · 崩溃恢复 · 打印双路径
'use strict';
const {
  app, Menu, dialog, clipboard, nativeTheme, Notification,
  shell, powerSaveBlocker, powerMonitor, session, safeStorage,
} = require('electron');
const fs = require('fs');
const path = require('path');

const Store = require('./store');
const IpcBus = require('./ipc-bus');
const WindowManager = require('./window-manager');
const TrayService = require('./tray-service');
const GlobalShortcuts = require('./global-shortcuts');
const CrashRecovery = require('./crash-recovery');
const FileWatcher = require('./file-watcher');
const SearxService = require('./searx');
const TranslateService = require('./translate');
const LanSync = require('./lansync');
const Updater = require('./updater');
const BrowserSession = require('./browser-session');
const TerminalService = require('./terminal');

const PROTOCOL = 'mazz';

// ---------- 单实例：第二实例的命令行文件参数转发给主实例开新标签 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); return; }

const store = new Store(path.join(app.getPath('userData'), 'mazz-settings.json'), {
  recentFiles: [],
  workspace: path.join(app.getPath('documents'), 'MazzWorkspace'),
  closeBehavior: 'ask', // ask | quit | tray
  themeSource: 'system',
  spellcheckEnabled: true,
  spellcheckLanguages: ['en-US', 'zh-CN'],
  quickNoteTarget: 'daily', // daily | inbox
});

const bus = new IpcBus();
const wm = new WindowManager({ store, iconPath: path.join(__dirname, '..', 'resources', 'icons', 'app.png') });
const tray = new TrayService({
  windowManager: wm, store,
  onCommand: (id, payload) => wm.broadcast('command:invoke', { id, payload }),
});
const globalShortcuts = new GlobalShortcuts({ windowManager: wm, store });

let pendingOpenFiles = []; // 主实例未就绪前收到的文件参数

function extractOpenFiles(argv) {
  return (argv || []).slice(1).filter(a => {
    if (a.startsWith('-') || a.startsWith(PROTOCOL + '://')) return false;
    try { return fs.existsSync(a) && fs.statSync(a).isFile(); } catch { return false; }
  }).map(a => path.resolve(a));
}

app.on('second-instance', (_e, argv) => {
  const files = extractOpenFiles(argv);
  if (wm.main) { wm.main.show(); wm.main.focus(); }
  else wm.createMain();
  files.forEach(f => wm.broadcast('file:open', { path: f }));
});

// ---------- mazz:// 自定义协议（笔记互链跳转 / 浏览器模块唤回主窗）----------
app.setAsDefaultProtocolClient(PROTOCOL);
app.on('open-url', (e, url) => { e.preventDefault(); handleProtocol(url); });
function handleProtocol(url) {
  if (wm.main) { wm.main.show(); wm.main.focus(); }
  wm.broadcast('protocol:open', { url });
}

// ---------- 关闭行为：退出 / 最小化到托盘（默认询问一次后记住）----------
wm.onCloseRequest = (win) => {
  const behavior = store.get('closeBehavior', 'ask');
  if (behavior === 'tray') { win.hide(); return 'prevent'; }
  if (behavior === 'quit') { wm.forceClose = true; return 'allow'; }
  // ask：询问一次，勾选记住后写入设置
  const r = dialog.showMessageBoxSync(win, {
    type: 'question', buttons: ['最小化到托盘', '退出', '取消'], defaultId: 0, cancelId: 2,
    title: '关闭 Mazz Editor', message: '关闭窗口后：',
    detail: '选择将记住，可在设置中更改。',
  });
  if (r === 2) return 'prevent';
  if (r === 0) { store.set('closeBehavior', 'tray'); win.hide(); return 'prevent'; }
  store.set('closeBehavior', 'quit'); wm.forceClose = true; return 'allow';
};

// ---------- 最近文件（Jump List / Dock 同步）----------
function addRecent(filePath) {
  const list = store.get('recentFiles', []).filter(f => f !== filePath);
  list.unshift(filePath);
  store.set('recentFiles', list.slice(0, 30));
  app.addRecentDocument(filePath);
  tray.refreshMenu();
}

// ---------- 白名单通道注册 ----------
function registerChannels() {
  // —— 文件系统 ——
  bus.handle('fs:readFile', async ({ path: p, encoding }) => fs.readFileSync(p, encoding || 'utf8'));
  bus.handle('fs:readFileBase64', async ({ path: p }) => fs.readFileSync(p).toString('base64'));
  bus.handle('fs:writeFileBase64', async ({ path: p, base64 }) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.mazztmp';
    fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
    fs.renameSync(tmp, p);
    return true;
  });
  bus.handle('fs:writeFile', async ({ path: p, content, encoding }) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.mazztmp';
    fs.writeFileSync(tmp, content, encoding || 'utf8');
    fs.renameSync(tmp, p); // 原子写
    return true;
  });
  bus.handle('fs:listDir', async ({ path: p }) => {
    const entries = fs.readdirSync(p, { withFileTypes: true });
    return entries.filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(p, e.name) }))
      .sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh-CN'));
  });
  bus.handle('fs:stat', async ({ path: p }) => {
    try { const s = fs.statSync(p); return { exists: true, isDir: s.isDirectory(), size: s.size, mtime: s.mtimeMs }; }
    catch { return { exists: false }; }
  });
  bus.handle('fs:mkdir', async ({ path: p }) => { fs.mkdirSync(p, { recursive: true }); return true; });
  bus.handle('fs:rename', async ({ from, to }) => { fs.renameSync(from, to); return true; });
  bus.handle('fs:delete', async ({ path: p }) => { await shell.trashItem(p); return true; }); // 进回收站

  // —— 原生对话框 ——
  bus.handle('dialog:openFile', async ({ filters, multi }) => {
    const r = await dialog.showOpenDialog(wm.main, {
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: filters || [
        { name: 'Mazz 全部支持', extensions: ['md', 'markdown', 'txt', 'mazz', 'csv', 'tsv', 'mazzsheet', 'xlsx'] },
        { name: '文档', extensions: ['md', 'markdown', 'txt', 'mazz'] },
        { name: '表格', extensions: ['csv', 'tsv', 'mazzsheet', 'xlsx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (r.canceled) return null;
    return multi ? r.filePaths : r.filePaths[0];
  });
  bus.handle('dialog:saveFile', async ({ defaultPath, filters }) => {
    const r = await dialog.showSaveDialog(wm.main, {
      defaultPath,
      filters: filters || [{ name: 'Markdown', extensions: ['md'] }, { name: '所有文件', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePath;
  });
  bus.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(wm.main, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  bus.handle('dialog:confirm', async ({ title, message, detail, buttons }) => {
    const r = await dialog.showMessageBox(wm.main, {
      type: 'warning', title, message, detail, buttons: buttons || ['确定', '取消'],
      cancelId: (buttons || ['确定', '取消']).length - 1,
    });
    return r.response;
  });

  // —— 最近文件 ——
  bus.handle('recent:list', async () => store.get('recentFiles', []));
  bus.handle('recent:add', async ({ path: p }) => { addRecent(p); return true; });
  bus.handle('recent:clear', async () => { store.set('recentFiles', []); app.clearRecentDocuments(); tray.refreshMenu(); return true; });

  // —— 工作区 / 设置 ——
  bus.handle('settings:get', async ({ key }) => store.get(key));
  bus.handle('settings:set', async ({ key, value }) => { store.set(key, value); return true; });

  // —— 密码管理器（safeStorage 系统级加密：Windows DPAPI / macOS Keychain / Linux keyring） ——
  // 红线：密文落盘，明文只在主进程内存中瞬时存在；渲染进程拿不到加密密钥
  const pwEncrypt = (text) => {
    if (safeStorage.isEncryptionAvailable()) {
      return { enc: true, data: safeStorage.encryptString(String(text ?? '')).toString('base64') };
    }
    return { enc: false, data: Buffer.from(String(text ?? ''), 'utf8').toString('base64') };
  };
  const pwDecrypt = (payload) => {
    try {
      if (payload?.enc) return safeStorage.decryptString(Buffer.from(payload.data, 'base64'));
      return Buffer.from(payload?.data || '', 'base64').toString('utf8');
    } catch { return ''; }
  };
  bus.handle('pw:available', async () => safeStorage.isEncryptionAvailable());
  bus.handle('pw:list', async () =>
    (store.get('passwords', [])).map(e => ({
      id: e.id, site: e.site, username: e.username, note: e.note,
      updatedAt: e.updatedAt, enc: !!e.password?.enc,
      password: pwDecrypt(e.password),
    })));
  bus.handle('pw:save', async ({ entry }) => {
    if (!entry || typeof entry !== 'object') return null;
    const list = store.get('passwords', []);
    const item = {
      id: entry.id || 'pw' + Date.now().toString(36),
      site: String(entry.site || '').trim(),
      username: String(entry.username || '').trim(),
      note: String(entry.note || ''),
      updatedAt: Date.now(),
      password: pwEncrypt(entry.password || ''),
    };
    const idx = list.findIndex(x => x.id === item.id);
    if (idx >= 0) list[idx] = item; else list.push(item);
    store.set('passwords', list);
    return item.id;
  });
  bus.handle('pw:delete', async ({ id }) => {
    store.set('passwords', (store.get('passwords', [])).filter(x => x.id !== id));
    return true;
  });
  bus.handle('workspace:get', async () => {
    const ws = store.get('workspace');
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(path.join(ws, '\u6BCF\u65E5\u7B14\u8BB0'), { recursive: true });
    return ws;
  });

  // —— 窗口 ——
  bus.handle('window:minimize', async () => wm.main?.minimize());
  bus.handle('window:toggleMaximize', async () => {
    if (!wm.main) return false;
    wm.main.isMaximized() ? wm.main.unmaximize() : wm.main.maximize();
    return wm.main.isMaximized();
  });
  bus.handle('window:close', async () => wm.main?.close());
  bus.handle('window:setTitle', async ({ title }) => wm.main?.setTitle(title));
  bus.handle('window:isMaximized', async () => !!wm.main?.isMaximized());
  bus.handle('window:toggleFullScreen', async () => wm.main?.setFullScreen(!wm.main.isFullScreen()));
  // 分窗：开新窗口并交接标签快照
  bus.handle('window:openChild', async ({ handoff }) => {
    const child = wm.createChild();
    child.webContents.once('did-finish-load', () => {
      child.webContents.send('mazz:event', { channel: 'window:role', payload: { role: 'child' } });
      setTimeout(() => {
        child.webContents.send('mazz:event', { channel: 'window:handoff', payload: handoff });
      }, 600);
    });
    return true;
  });
  // 移回主窗口：子窗标签快照转发主窗
  bus.handle('window:toMain', async ({ handoff }) => {
    if (wm.main && !wm.main.isDestroyed()) {
      wm.main.show(); wm.main.focus();
      wm.main.webContents.send('mazz:event', { channel: 'window:handoff', payload: handoff });
      return true;
    }
    return false;
  });

  // —— 主题跟随（nativeTheme）——
  bus.handle('theme:setSource', async ({ source }) => {
    nativeTheme.themeSource = source || 'system';
    store.set('themeSource', source);
    return nativeTheme.shouldUseDarkColors;
  });
  bus.handle('theme:isDark', async () => nativeTheme.shouldUseDarkColors);

  // —— 打印双路径 ——
  bus.handle('print:print', async () => {
    if (!wm.main) return false;
    return new Promise((resolve) => {
      wm.main.webContents.print({ printBackground: true, silent: false }, (ok, reason) => {
        if (!ok) console.warn('[print] failed:', reason);
        resolve(ok);
      });
    });
  });
  bus.handle('print:toPDF', async ({ savePath, pageSize }) => {
    if (!wm.main) return null;
    const data = await wm.main.webContents.printToPDF({ printBackground: true, pageSize: pageSize || 'A4' });
    let target = savePath;
    if (!target) {
      const r = await dialog.showSaveDialog(wm.main, {
        defaultPath: '未命名.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (r.canceled) return null;
      target = r.filePath;
    }
    fs.writeFileSync(target, data);
    shell.showItemInFolder(target);
    return target;
  });

  // —— 多格式剪贴板 ——
  bus.handle('clipboard:write', async ({ text, html, imagePath }) => {
    const payload = {};
    if (text != null) payload.text = text;
    if (html != null) payload.html = html;
    if (imagePath) { try { payload.image = require('electron').nativeImage.createFromPath(imagePath); } catch {} }
    clipboard.write(payload);
    return true;
  });
  bus.handle('clipboard:read', async () => ({
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    hasImage: !clipboard.readImage().isEmpty(),
    formats: clipboard.availableFormats(),
  }));
  bus.handle('clipboard:readImagePNG', async () => {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toPNG().toString('base64');
  });

  // —— 系统通知 ——
  bus.handle('notify:show', async ({ title, body }) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
    return true;
  });

  // —— shell ——
  bus.handle('shell:showItemInFolder', async ({ path: p }) => { shell.showItemInFolder(p); return true; });
  bus.handle('shell:openExternal', async ({ url }) => { await shell.openExternal(url); return true; });

  // —— 拼写检查 ——
  bus.handle('spell:setLanguages', async ({ langs }) => {
    try { wm.main?.webContents.session.setSpellCheckerLanguages(langs); store.set('spellcheckLanguages', langs); } catch (e) { return e.message; }
    return true;
  });
  bus.handle('spell:setEnabled', async ({ enabled }) => {
    wm.main?.webContents.session.setSpellCheckerEnabled(enabled);
    store.set('spellcheckEnabled', enabled);
    return true;
  });

  // —— 快速笔记 ——
  bus.handle('quicknote:save', async ({ text }) => {
    const ws = store.get('workspace');
    const target = store.get('quickNoteTarget', 'daily');
    const file = target === 'daily'
      ? path.join(ws, '\u6BCF\u65E5\u7B14\u8BB0', new Date().toISOString().slice(0, 10) + '.md')
      : path.join(ws, 'inbox.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const stamp = new Date().toTimeString().slice(0, 5);
    fs.appendFileSync(file, `\n- ${stamp} ${String(text).replace(/\n/g, '\n  ')}\n`);
    wm.broadcast('file:changed', { event: 'change', path: file, at: Date.now() });
    return file;
  });
  bus.handle('quicknote:close', async () => { wm.quickNote?.hide(); return true; });

  // —— 系统字体库（主进程读本机字体，三件套字体选择器取数）——
  bus.handle('app:fonts', async () => {
    const families = new Set();
    try {
      if (process.platform === 'win32') {
        // 写临时 ps1 执行（避开引号/编码坑）：InstalledFontCollection 全量读取（系统+用户+OT/TTC）
        const { execSync } = require('child_process');
        const os = require('os');
        const ps1 = path.join(os.tmpdir(), 'mazz-fonts.ps1');
        fs.writeFileSync(ps1,
          "Add-Type -AssemblyName System.Drawing\r\n" +
          "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\r\n" +
          "(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }\r\n",
          'utf8');
        try {
          const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`,
            { encoding: 'utf8', timeout: 10000 });
          for (const line of out.split(/\r?\n/)) {
            const name = line.trim();
            if (name) families.add(name);
          }
        } catch (e1) {
          // 兜底：扫字体目录（文件名近似家族名）
          try {
            const windir = process.env.WINDIR || 'C:\\Windows';
            for (const dir of [path.join(windir, 'Fonts'), path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts')]) {
              if (!fs.existsSync(dir)) continue;
              for (const f of fs.readdirSync(dir)) {
                if (/\.(ttf|otf|ttc)$/i.test(f)) {
                  families.add(f.replace(/\.(ttf|otf|ttc)$/i, '').replace(/[-_]/g, ' '));
                }
              }
            }
          } catch {}
        }
      } else {
        const { execSync } = require('child_process');
        const out = execSync('fc-list : family 2>/dev/null | sort -u', { encoding: 'utf8', timeout: 5000 });
        for (const line of out.split('\n')) {
          const fam = line.split(',')[0].trim();
          if (fam) families.add(fam);
        }
      }
    } catch (e) { console.warn('[fonts] 系统字体读取失败:', e.message); }
    const common = ['微软雅黑', '黑体', '宋体', '仿宋', '楷体', '等线', '苹方-简', 'PingFang SC',
      'Segoe UI', 'Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Consolas', 'Courier New'];
    for (const c of common) families.add(c);
    return [...families].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  });

  // —— 电源管理 ——
  let powerBlockerId = null;
  bus.handle('power:block', async ({ block }) => {
    if (block && powerBlockerId == null) powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    if (!block && powerBlockerId != null) { powerSaveBlocker.stop(powerBlockerId); powerBlockerId = null; }
    return true;
  });
  powerMonitor.on('resume', () => wm.broadcast('power:resumed', {}));

  // —— 原生右键菜单（拼写建议由主进程置顶注入）——
  bus.handle('menu:context', async ({ items, context }) => {
    if (!wm.main) return null;
    return new Promise((resolve) => {
      const toNative = (it) => {
        if (it.type === 'separator') return { type: 'separator' };
        const base = {
          label: it.label, enabled: it.enabled !== false,
          submenu: it.submenu ? it.submenu.map(toNative) : undefined,
          click: () => resolve(it.id),
        };
        if (it.submenu) delete base.click;
        return base;
      };
      const menu = Menu.buildFromTemplate(items.map(toNative));
      menu.popup({ window: wm.main, callback: () => resolve(null) });
    });
  });

  // —— 应用菜单栏同步（渲染进程命令注册表 → 原生 Menu）——
  bus.handle('appmenu:sync', async ({ template }) => { buildAppMenu(template || []); return true; });

  // —— 编辑器上下文菜单模型（渲染进程从命令注册表解析后推送；主进程拼写菜单消费）——
  bus.handle('menu:setModel', async ({ items }) => { editorMenuModel.items = items || []; return true; });
}

// ---------- 证书异常处理：默认验证；实例主机放行；其他站点失败时询问「继续访问」（记忆选择）----------
function hookCertificateErrors() {
  const trusted = new Set(store.get('trustedHosts', []));
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    let host = '';
    try { host = new URL(url).host; } catch {}
    if (!host) { event.preventDefault(); callback(false); return; }
    const instHost = (() => { try { return new URL(store.get('searx', {}).url || '').host; } catch { return ''; } })();
    if (trusted.has(host) || host === instHost) {
      event.preventDefault();
      callback(true);
      return;
    }
    const choice = dialog.showMessageBoxSync(wm.main, {
      type: 'warning',
      title: '证书验证失败',
      message: `「${host}」的证书无法验证（${error}）`,
      detail: '可能是网络代理/安全软件拦截了 HTTPS。你可以：信任此站点（记住选择）/ 仅本次继续 / 拒绝。',
      buttons: ['信任此站点', '仅本次继续', '拒绝'],
      defaultId: 0, cancelId: 2,
    });
    if (choice === 0) {
      trusted.add(host);
      store.set('trustedHosts', [...trusted]);
      event.preventDefault(); callback(true);
    } else if (choice === 1) {
      event.preventDefault(); callback(true);
    } else {
      callback(false);
    }
  });
}

// 编辑器右键原生菜单：拼写建议置顶（Electron 内置 spellchecker）+ 编辑角色 + 命令注册表模型
let editorMenuModel = { items: [] };
function hookEditorContextMenu() {
  const wc = wm.main.webContents;
  wc.on('context-menu', (_e, params) => {
    const template = [];
    if (params.misspelledWord && params.isEditable) {
      const sugg = params.dictionarySuggestions.slice(0, 5);
      if (sugg.length) sugg.forEach(w => template.push({ label: w, click: () => wc.replaceMisspelling(w) }));
      else template.push({ label: '无拼写建议', enabled: false });
      template.push({ label: `将“${params.misspelledWord}”加入词典`, click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      template.push({ type: 'separator' });
    }
    const ef = params.editFlags || {};
    template.push(
      { label: '剪切', role: 'cut', enabled: !!ef.canCut },
      { label: '复制', role: 'copy', enabled: !!ef.canCopy },
      { label: '粘贴', role: 'paste', enabled: !!ef.canPaste },
      { label: '全选', role: 'selectAll', enabled: !!ef.canSelectAll },
    );
    const model = editorMenuModel.items || [];
    if (model.length) {
      template.push({ type: 'separator' });
      for (const it of model) {
        if (it.type === 'separator') { template.push({ type: 'separator' }); continue; }
        template.push({
          label: it.label, enabled: it.enabled !== false,
          click: () => wm.broadcast('command:invoke', { id: it.id }),
        });
      }
    }
    Menu.buildFromTemplate(template).popup({ window: wm.main });
  });
}

// 应用菜单栏：macOS 专属应用菜单 / 角色键位适配
function buildAppMenu(template) {
  const items = template.map(group => ({
    label: group.label,
    submenu: group.items.map(it => it.type === 'separator'
      ? { type: 'separator' }
      : {
          label: it.label,
          accelerator: it.accelerator,
          enabled: it.enabled !== false,
          click: () => wm.broadcast('command:invoke', { id: it.id }),
        }),
  }));
  if (process.platform === 'darwin') {
    items.unshift({
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => wm.broadcast('command:invoke', { id: 'app.openSettings' }) },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
      ],
    });
    items.push({ role: 'windowMenu' });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}

// ---------- 应用设置应用 ----------
function applySettings() {
  nativeTheme.themeSource = store.get('themeSource', 'system');
  const ses = wm.main?.webContents.session;
  if (ses) {
    ses.setSpellCheckerEnabled(store.get('spellcheckEnabled', true));
    try { ses.setSpellCheckerLanguages(store.get('spellcheckLanguages', ['en-US'])); } catch {}
  }
}

// ---------- 启动 ----------
// GPU 异常环境（远程桌面/老显卡/虚拟机）可用 --disable-gpu 兜底
if (process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
  console.log('[mazz] 已禁用硬件加速（--disable-gpu）');
}
app.whenReady().then(() => {
  bus.start();
  registerChannels();
  new CrashRecovery({ app, bus });
  const watcher = new FileWatcher({ bus, windowManager: wm });

  wm.createMain();
  // 默认搜索实例持久化（证书白名单/实例识别依赖 store 中有值）
  if (!store.get('searx')) store.set('searx', { url: 'https://107.174.37.27', user: 'mazz', pass: '737037sxf' });
  hookCertificateErrors();
  tray.create();
  globalShortcuts.registerAll();

  // —— 隐私浏览器：独立会话 + 搜索服务（主进程专属，实例凭据不出主进程）——
  const browserSess = session.fromPartition('persist:mazz-browser');
  new SearxService({ bus, store, session: browserSess });
  new TranslateService({ bus, store });
  // —— 局域网同步 + 自动更新入口 ——
  new LanSync({ bus, store, workspace: () => store.get('workspace') });
  new Updater({ bus, store, version: require('../package.json').version });
  const bs = new BrowserSession({ session: browserSess, bus });
  bs.hookWindow(wm.main);

  // —— 集成终端：node-pty 终端池 ——
  const terminal = new TerminalService({ bus, windowManager: wm });
  app.on('before-quit', () => terminal.killAll());

  // —— Python 计算内核（math.js 后端）——
  const PythonKernel = require('./python-kernel');
  const pyKernel = new PythonKernel({ bus, windowManager: wm });
  app.on('before-quit', () => pyKernel.kill());

  // —— DAP 调试适配器池 ——
  const DebugService = require('./debug');
  const debugService = new DebugService({ bus, windowManager: wm });
  app.on('before-quit', () => debugService.kill());
  wm.main.webContents.on('did-finish-load', () => {
    applySettings();
    hookEditorContextMenu();
    // 主实例就绪后回放待打开文件（文件关联双击冷启动）
    pendingOpenFiles.forEach(f => wm.broadcast('file:open', { path: f }));
    pendingOpenFiles = [];
    tray.refreshMenu();
  });

  app.on('before-quit', async () => { watcher.close(); });
  app.on('will-quit', () => globalShortcuts.unregisterAll());
  app.on('window-all-closed', () => { /* 托盘常驻：不关应用，除非显式退出 */ });
  app.on('activate', () => { if (!wm.main) wm.createMain(); else wm.main.show(); });
});

// 文件关联双击（Windows/Linux 冷启动：参数带文件路径）
pendingOpenFiles = extractOpenFiles(process.argv);

// 未捕获异常不杀进程
process.on('uncaughtException', (e) => console.error('[main] uncaught:', e));
