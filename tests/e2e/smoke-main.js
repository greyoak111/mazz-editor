// tests/e2e/smoke-main.js —— 冒烟测试主进程：真 Electron + 最小 IPC 宿主 + 加载外壳执行关键命令
'use strict';
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const results = { checks: {}, errors: [] };

// —— 最小 IPC 宿主（与 main/main.js 同信封协议；仅冒烟所需通道）——
const handlers = {
  'workspace:get': async () => {
    const ws = path.join(os.tmpdir(), 'mazz-smoke-workspace');
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(path.join(ws, '每日笔记'), { recursive: true });
    return ws;
  },
  'fs:readFile': async ({ path: p }) => fs.readFileSync(p, 'utf8'),
  'fs:writeFile': async ({ path: p, content }) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return true;
  },
  'fs:delete': async ({ path: p }) => { try { fs.unlinkSync(p); } catch {} return true; },
  'fs:listDir': async ({ path: p }) => fs.readdirSync(p, { withFileTypes: true })
    .map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(p, e.name) })),
  'fs:watch': async () => true,
  'fs:unwatch': async () => true,
  'settings:get': async () => undefined,
  'settings:set': async () => true,
  'theme:isDark': async () => true,
  'theme:setSource': async () => true,
  'recent:list': async () => [],
  'recent:add': async () => true,
  'spell:setEnabled': async () => true,
  'menu:setModel': async () => true,
  'appmenu:sync': async () => true,
  'snapshot:write': async () => true,
  'snapshot:list': async () => [],
  'snapshot:clear': async () => true,
  'snapshot:clearAll': async () => true,
  'crash:lastExitUnclean': async () => false,
  'notify:show': async () => true,
  'power:block': async () => true,
  // —— 密码管理器（与 main/main.js 同一实现：safeStorage 真机加解密） ——
  'pw:available': async () => safeStorage.isEncryptionAvailable(),
  'pw:list': async () => smokePw.map(e => ({
    ...e, enc: !!e.password?.enc,
    password: (() => { try { return e.password?.enc ? safeStorage.decryptString(Buffer.from(e.password.data, 'base64')) : Buffer.from(e.password?.data || '', 'base64').toString('utf8'); } catch { return ''; } })(),
  })),
  'pw:save': async ({ entry }) => {
    const enc = safeStorage.isEncryptionAvailable();
    const item = {
      id: entry.id || 'pw' + Date.now().toString(36),
      site: entry.site || '', username: entry.username || '', note: entry.note || '', updatedAt: Date.now(),
      password: { enc, data: enc ? safeStorage.encryptString(String(entry.password ?? '')).toString('base64') : Buffer.from(String(entry.password ?? ''), 'utf8').toString('base64') },
    };
    const i = smokePw.findIndex(x => x.id === item.id);
    if (i >= 0) smokePw[i] = item; else smokePw.push(item);
    return item.id;
  },
  'pw:delete': async ({ id }) => { const i = smokePw.findIndex(x => x.id === id); if (i >= 0) smokePw.splice(i, 1); return true; },
};
const smokePw = [];

app.whenReady().then(async () => {
  ipcMain.handle('mazz:invoke', async (_e, { channel, payload }) => {
    const fn = handlers[channel];
    if (!fn) return { ok: false, error: `channel not allowed: ${channel}` };
    try { return { ok: true, data: await fn(payload || {}) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'bridge.js'),
      contextIsolation: true, sandbox: false, nodeIntegration: false, spellcheck: true,
    },
  });
  win.webContents.on('console-message', (_e, _l, msg) => {
    if (/error/i.test(msg) && !/net::|Autofill|dbus|GPU|Context isolation/i.test(msg)) results.errors.push(msg.slice(0, 200));
  });
  try {
    await win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
    await new Promise(r => setTimeout(r, 1500));

    const r1 = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.bridge = !!window.mazz?.isElectron;
      out.modules = window.MazzModules.list().map(m => m.name);
      out.commandCount = window.MazzCommands.list({ includeDisabled: true }).length;
      await window.MazzCommands.execute('file.new');
      await new Promise(r => setTimeout(r, 400));
      out.tabsAfterNew = document.querySelectorAll('.tab').length;
      out.editorMounted = !!document.querySelector('.ProseMirror');
      const tabId = document.querySelector('.module-view.on')?.dataset.tabId;
      const inst = window.MazzModules.instances.get(tabId);
      inst.def.setContent('# 冒烟测试\\n\\n**加粗** 与 ~~删除线~~', inst.state);
      out.roundtrip = inst.def.getContent(inst.state).includes('**加粗**');
      await window.MazzCommands.execute('app.commandPalette');
      out.paletteMounted = !!document.querySelector('.mazz-palette');
      document.querySelector('.mazz-palette-mask')?.remove();
      const ws = await window.mazz.invoke('workspace:get');
      await window.mazz.invoke('fs:writeFile', { path: ws + '/smoke.md', content: 'smoke' });
      out.ipcReadback = (await window.mazz.invoke('fs:readFile', { path: ws + '/smoke.md' })) === 'smoke';
      await window.mazz.invoke('fs:delete', { path: ws + '/smoke.md' });
      try { await window.mazz.invoke('evil:hack', {}); out.whitelistBlocked = false; }
      catch { out.whitelistBlocked = true; }
      // 密码管理器全链路：加密落盘 → 解密回读 → 删除（safeStorage 真机）
      try {
        const id = await window.mazz.invoke('pw:save', { entry: { site: 'smoke.test', username: 'u', password: 'p@ss', note: '' } });
        const list = await window.mazz.invoke('pw:list');
        const found = list.find(x => x.id === id);
        await window.mazz.invoke('pw:delete', { id });
        const gone = !(await window.mazz.invoke('pw:list')).some(x => x.id === id);
        out.pwRoundtrip = !!(found && found.password === 'p@ss' && gone);
      } catch (e) { out.pwRoundtrip = false; out.pwError = String(e).slice(0, 200); }

      // 思维导图键盘路由 e2e：点选根节点 → Tab 建子节点 → Delete 删除
      try {
        await window.MazzCommands.execute('file.newMindmap');
        await new Promise(r => setTimeout(r, 900));
        const count = () => document.querySelectorAll('.mm-node').length;
        const n0 = count();
        const rootNode = document.querySelector('.mm-node');
        rootNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 100));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 400));
        const n1 = count();
        // 编辑态退出
        const ed = document.querySelector('.mm-editor');
        if (ed) ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 150));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 300));
        const n2 = count();
        out.mindmapKeys = n1 > n0 && n2 < n1;
      } catch (e) { out.mindmapKeys = false; out.mmError = String(e).slice(0, 200); }

      // 分屏场景：markdown + mindmap 双窗格，切来切去后导图键盘仍可用
      try {
        await window.MazzCommands.execute('file.new');
        await new Promise(r => setTimeout(r, 700));
        await window.MazzCommands.execute('view.splitRight');
        await new Promise(r => setTimeout(r, 400));
        await window.MazzCommands.execute('file.newMindmap');
        await new Promise(r => setTimeout(r, 900));
        // 模拟：先点 markdown 窗格，再点导图画布节点，再按 Tab
        const mmNode = document.querySelector('.mm-node');
        mmNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 100));
        const count = () => document.querySelectorAll('.mm-node').length;
        const n0 = count();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 400));
        out.mindmapSplitKeys = count() > n0;
      } catch (e) { out.mindmapSplitKeys = false; out.mmsError = String(e).slice(0, 200); }
      return out;
    })()`);
    Object.assign(results.checks, r1);
  } catch (e) {
    results.errors.push(String(e).slice(0, 300));
  }
  console.log('SMOKE_RESULT ' + JSON.stringify(results));
  app.exit(0);
});

setTimeout(() => { console.log('SMOKE_TIMEOUT ' + JSON.stringify(results)); app.exit(2); }, 30000);
