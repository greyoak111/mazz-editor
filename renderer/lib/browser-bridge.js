// renderer/lib/browser-bridge.js —— 浏览器预览桥：与 window.mazz 同 API 的纯浏览器实现
// 虚拟文件系统（localStorage 持久化）+ 下载/上传回退，让渲染进程脱离 Electron 也能完整运行
const VFS_KEY = 'mazz.vfs.v1';
const SETTINGS_KEY = 'mazz.settings.v1';
const RECENT_KEY = 'mazz.recent.v1';
const SNAP_KEY = 'mazz.snapshots.v1';

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function browserSettingsCasEqual(left, right) {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

// —— 极简虚拟文件系统：{ [path]: {type:'file'|'dir', content?, mtime} } ——
function loadVFS() {
  let vfs = loadJSON(VFS_KEY, null);
  if (!vfs) {
    const now = Date.now();
    vfs = {
      '/workspace': { type: 'dir', mtime: now },
      '/workspace/每日笔记': { type: 'dir', mtime: now },
      '/workspace/欢迎使用 Mazz Editor.md': { type: 'file', mtime: now, content:
`# 欢迎使用 Mazz Editor ◆

这是一份 **Markdown** 文档——在 Mazz 里，Markdown 是源代码，Office 格式是编译产物。

## 试试这些

- 输入 \`#\` + 空格 → 标题；\`>\` + 空格 → 引用；\`-\` + 空格 → 列表
- 输入 **加粗**、*斜体*、\`行内代码\`、~~删除线~~ 即时渲染
- 按 **Ctrl+Shift+P** 唤起命令面板（命令/文件模糊搜索）
- 按 **Ctrl+Alt+T** 轮换五套主题
- 右键唤出上下文菜单；**Ctrl+F** 查找替换（含正则）

## 一切操作皆命令

右键选单、快捷键、命令面板、菜单栏——全部从同一个命令注册表取数，单一事实源。

> 浏览器预览模式：文件保存在 localStorage 虚拟工作区；桌面版（Electron）享有托盘/全局快捷键/打印/崩溃恢复等完整系统能力。

---

现在开始，随便写点什么吧。
` },
    };
    saveJSON(VFS_KEY, vfs);
  }
  return vfs;
}

function normalizePath(p) {
  if (!p) return '/workspace';
  return ('/' + String(p).replace(/\\/g, '/').replace(/^\/+/, '')).replace(/\/+$/, '') || '/';
}

function browserPositionKey(kind, p) {
  kind = String(kind || '').toLowerCase();
  if (!['library', 'player', 'editor'].includes(kind) || !p) return null;
  const n = normalizePath(p).normalize('NFC').toLowerCase();
  const rel = n === '/workspace' ? '.' : n.startsWith('/workspace/') ? n.slice('/workspace/'.length) : n;
  return `${kind}:${n.startsWith('/workspace') ? 'workspace:' : 'absolute:'}${rel}`;
}

function mergeBrowserPositions(settings, entries) {
  const all = settings['sync.positions'] && typeof settings['sync.positions'] === 'object' ? settings['sync.positions'] : {};
  const changed = [];
  for (const raw of Array.isArray(entries) ? entries : []) {
    if (!raw?.key || !raw?.kind || !raw?.updatedAt || !raw?.deviceId) continue;
    const prev = all[raw.key];
    if (prev && (Number(prev.updatedAt) > Number(raw.updatedAt)
      || (Number(prev.updatedAt) === Number(raw.updatedAt) && String(prev.deviceId) >= String(raw.deviceId)))) continue;
    let value; try { value = JSON.parse(JSON.stringify(raw.value ?? null)); } catch { continue; }
    all[raw.key] = { key: String(raw.key), kind: String(raw.kind), value, updatedAt: Number(raw.updatedAt), deviceId: String(raw.deviceId) };
    changed.push(all[raw.key]);
  }
  settings['sync.positions'] = Object.fromEntries(Object.entries(all).sort((a,b)=>Number(b[1]?.updatedAt||0)-Number(a[1]?.updatedAt||0)).slice(0,2000));
  return changed;
}

// ==================== 工作区存储后端（双实现） ====================
// Capacitor（Android/iOS）：真·文件系统（应用私有目录，无容量上限、无需权限弹窗）
// 纯浏览器：localStorage 虚拟文件系统（约 5MB，预览够用）
// 统一异步接口，返回形状与桌面 fs:* 通道一致
function createLocalBackend() {
  return {
    native: false,
    async listDir(dir) {
      const vfs = loadVFS();
      const prefix = dir === '/' ? '/' : dir + '/';
      const seen = new Map();
      for (const p of Object.keys(vfs)) {
        if (p === dir || !p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!name || seen.has(name)) continue;
        const childPath = prefix + name;
        const isDir = rest.includes('/') || vfs[childPath]?.type === 'dir';
        seen.set(name, { name, isDir, path: childPath });
      }
      return [...seen.values()].sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'zh-CN'));
    },
    async readFile(n) {
      const vfs = loadVFS();
      if (vfs[n]?.type !== 'file') throw new Error('文件不存在: ' + n);
      return vfs[n].content;
    },
    async readFileBase64(n) {
      const vfs = loadVFS();
      if (vfs[n]?.type !== 'file') throw new Error('文件不存在: ' + n);
      return vfs[n].binary ? vfs[n].content : btoa(unescape(encodeURIComponent(vfs[n].content)));
    },
    async writeFileBase64(n, b64) {
      const vfs = loadVFS();
      const parent = n.split('/').slice(0, -1).join('/') || '/';
      if (parent !== '/' && !vfs[parent]) vfs[parent] = { type: 'dir', mtime: Date.now() };
      const raw = String(b64 || '');
      // 能按 UTF-8 解码的按文本存（同步来的 .md/.txt 编辑器可直接打开），否则按二进制
      let text = null;
      try {
        const decoded = decodeURIComponent(escape(atob(raw)));
        if (!decoded.includes('�')) text = decoded;
      } catch {}
      vfs[n] = text !== null
        ? { type: 'file', content: text, mtime: Date.now() }
        : { type: 'file', binary: true, content: raw, mtime: Date.now() };
      saveJSON(VFS_KEY, vfs);
    },
    async writeFile(n, content) {
      const vfs = loadVFS();
      const parent = n.split('/').slice(0, -1).join('/') || '/';
      if (parent !== '/' && !vfs[parent]) vfs[parent] = { type: 'dir', mtime: Date.now() };
      vfs[n] = { type: 'file', content: String(content ?? ''), mtime: Date.now() };
      saveJSON(VFS_KEY, vfs);
    },
    async stat(n) {
      const vfs = loadVFS();
      return vfs[n] ? { exists: true, isDir: vfs[n].type === 'dir', size: (vfs[n].content || '').length, mtime: vfs[n].mtime } : { exists: false };
    },
    async mkdir(n) { const vfs = loadVFS(); vfs[n] = { type: 'dir', mtime: Date.now() }; saveJSON(VFS_KEY, vfs); },
    async rename(from, to) {
      const vfs = loadVFS();
      for (const p of Object.keys(vfs)) {
        if (p === from || p.startsWith(from + '/')) {
          vfs[to + p.slice(from.length)] = vfs[p];
          delete vfs[p];
        }
      }
      saveJSON(VFS_KEY, vfs);
    },
    async delete(n) { const vfs = loadVFS(); delete vfs[n]; saveJSON(VFS_KEY, vfs); },
  };
}

function createCapBackend(FS) {
  const DIR = 'DATA'; // Directory.Data：应用私有目录，Android 10+ 无需任何运行时权限
  const rel = (p) => normalizePath(p).replace(/^\//, ''); // '/workspace/a.md' → 'workspace/a.md'
  const parentOf = (n) => n.split('/').slice(0, -1).join('/') || '/workspace';

  // 首次使用播种欢迎文件（与 localStorage 后端同内容）
  const ready = (async () => {
    try { await FS.mkdir({ path: 'workspace/每日笔记', directory: DIR, recursive: true }); } catch {}
    try {
      await FS.stat({ path: 'workspace/欢迎使用 Mazz Editor.md', directory: DIR });
    } catch {
      const tmp = createLocalBackend();
      try {
        const welcome = (await tmp.readFile('/workspace/欢迎使用 Mazz Editor.md').catch(() => null));
        if (welcome) await FS.writeFile({ path: 'workspace/欢迎使用 Mazz Editor.md', directory: DIR, data: welcome, encoding: 'utf8', recursive: true });
      } catch {}
    }
  })();
  const b = {
    native: true,
    async listDir(dir) {
      await ready;
      try {
        const r = await FS.readdir({ path: rel(dir), directory: DIR });
        return (r.files || []).map(f => ({
          name: f.name,
          isDir: f.type === 'directory',
          path: (dir === '/' ? '' : dir) + '/' + f.name,
        })).sort((x, y) => (y.isDir - x.isDir) || x.name.localeCompare(y.name, 'zh-CN'));
      } catch { return []; }
    },
    async readFile(n) {
      await ready;
      try {
        const r = await FS.readFile({ path: rel(n), directory: DIR, encoding: 'utf8' });
        return typeof r.data === 'string' ? r.data : await r.data.text();
      } catch { throw new Error('文件不存在: ' + n); }
    },
    async readFileBase64(n) {
      await ready;
      try {
        const r = await FS.readFile({ path: rel(n), directory: DIR }); // 无 encoding → base64
        return typeof r.data === 'string' ? r.data : await r.data.text();
      } catch { throw new Error('文件不存在: ' + n); }
    },
    async writeFile(n, content) {
      await ready;
      await FS.writeFile({ path: rel(n), directory: DIR, data: String(content ?? ''), encoding: 'utf8', recursive: true });
    },
    async writeFileBase64(n, b64) {
      await ready;
      await FS.writeFile({ path: rel(n), directory: DIR, data: String(b64 || ''), recursive: true });
    },
    async stat(n) {
      await ready;
      try {
        const r = await FS.stat({ path: rel(n), directory: DIR });
        return { exists: true, isDir: r.type === 'directory', size: r.size || 0, mtime: r.mtime || Date.now() };
      } catch { return { exists: false }; }
    },
    async mkdir(n) { await ready; await FS.mkdir({ path: rel(n), directory: DIR, recursive: true }).catch(() => {}); },
    async rename(from, to) {
      await ready;
      try { await FS.mkdir({ path: rel(parentOf(to)), directory: DIR, recursive: true }); } catch {}
      await FS.rename({ from: rel(from), to: rel(to), directory: DIR, toDirectory: DIR });
    },
    async delete(n) {
      await ready;
      const st = await b.stat(n);
      if (!st.exists) return;
      if (st.isDir) await FS.rmdir({ path: rel(n), directory: DIR, recursive: true }).catch(() => {});
      else await FS.deleteFile({ path: rel(n), directory: DIR }).catch(() => {});
    },
  };
  return b;
}

function createBackend() {
  const cap = window.Capacitor;
  const FS = cap?.isNativePlatform?.() ? cap?.Plugins?.Filesystem : null;
  if (FS) return createCapBackend(FS);
  return createLocalBackend();
}

// 测试钩子：允许注入伪 Filesystem 插件验证 Capacitor 后端
export { createCapBackend as createCapBackendForTest };

export function installBrowserBridge() {
  const listeners = new Map();
  let snapFlag = sessionStorage.getItem('mazz.running') === '1';
  sessionStorage.setItem('mazz.running', '1');

  const backend = createBackend(); // 工作区存储：Capacitor 真文件 / localStorage 兜底

  const api = {
    // Capacitor 容器内识别为 android/ios，纯浏览器为 web（移动端 CSS 依此区分）
    platform: window.Capacitor?.getPlatform?.() || 'web', isElectron: false,
    versions: { electron: 'preview', chrome: navigator.userAgent },
    storage: backend.native ? 'filesystem' : 'localStorage',

    async invoke(channel, payload = {}) {
      const settings = loadJSON(SETTINGS_KEY, {});
      switch (channel) {
        // —— 文件系统（双后端：Capacitor 真文件 / localStorage 虚拟区）——
        case 'workspace:get': return '/workspace';
        // 多工作区（网页桥：虚拟单工作区兜底，界面不空）
        case 'workspace:list': return { current: '/workspace', list: [{ path: '/workspace', name: '浏览器工作区' }] };
        case 'workspace:add': case 'workspace:rename': return { current: '/workspace', list: [{ path: '/workspace', name: '浏览器工作区' }] };
        case 'workspace:remove': throw new Error('浏览器预览只有一个虚拟工作区');
        case 'workspace:setCurrent': return '/workspace';
        case 'fs:closeAll': return true;
        case 'fs:listDir': return backend.listDir(normalizePath(payload.path));
        case 'fs:readFile': return backend.readFile(normalizePath(payload.path));
        case 'fs:readFileBase64': return backend.readFileBase64(normalizePath(payload.path));
        case 'fs:writeFileBase64': {
          await backend.writeFileBase64(normalizePath(payload.path), payload.base64);
          return true;
        }
        case 'fs:writeFile': {
          const n = normalizePath(payload.path);
          await backend.writeFile(n, payload.content);
          emit('file:changed', { event: 'change', path: n, at: Date.now() });
          return true;
        }
        case 'fs:stat': return backend.stat(normalizePath(payload.path));
        case 'fs:mkdir': await backend.mkdir(normalizePath(payload.path)); return true;
        case 'fs:rename': await backend.rename(normalizePath(payload.from), normalizePath(payload.to)); return true;
        case 'fs:delete': await backend.delete(normalizePath(payload.path)); return true;
        case 'fs:watch': case 'fs:unwatch': return true;

        // —— 对话框 ——
        case 'dialog:openFile': return browserPickFile(payload);
        case 'dialog:saveFile': {
          // 无系统对话框：按格式首选后缀自动补齐（命名框不带后缀）
          let name = (payload.defaultPath || '未命名').split(/[\\/]/).pop();
          const firstExt = payload.filters?.[0]?.[1]?.[0];
          if (firstExt && !name.toLowerCase().endsWith('.' + firstExt.toLowerCase())) name += '.' + firstExt;
          return normalizePath('/workspace/' + name);
        }
        case 'dialog:openFolder': return '/workspace';
        case 'dialog:confirm': {
          const ok = confirm(`${payload.title || ''}\n${payload.message || ''}\n${payload.detail || ''}`);
          return ok ? 0 : (payload.buttons?.length || 2) - 1;
        }

        // —— 最近/设置 ——
        case 'recent:list': return loadJSON(RECENT_KEY, []);
        case 'recent:add': {
          const list = loadJSON(RECENT_KEY, []).filter(f => f !== payload.path);
          list.unshift(payload.path);
          saveJSON(RECENT_KEY, list.slice(0, 30));
          return true;
        }
        case 'recent:clear': saveJSON(RECENT_KEY, []); return true;
        case 'settings:get': return settings[payload.key];
        case 'settings:set': { settings[payload.key] = payload.value; saveJSON(SETTINGS_KEY, settings); return true; }
        case 'settings:compareAndSet': {
          const entries = Array.isArray(payload.entries)
            ? payload.entries
            : [{ key: payload.key, expected: payload.expected, value: payload.value }];
          const seen = new Set();
          for (const entry of entries) {
            const key = String(entry?.key || '');
            if (!key || seen.has(key)) throw new TypeError('settings:compareAndSet requires unique non-empty keys');
            seen.add(key);
            if (!browserSettingsCasEqual(settings[key], entry.expected)) {
              return { ok: false, key, current: settings[key] };
            }
          }
          for (const entry of entries) settings[entry.key] = entry.value;
          saveJSON(SETTINGS_KEY, settings);
          return { ok: true };
        }
        case 'sync:positionPut': {
          const key = browserPositionKey(payload.kind, payload.path);
          if (!key) throw new Error('进度对象缺少有效 kind/path');
          const all = settings['sync.positions'] || {};
          const deviceId = settings['sync.deviceId'] || (settings['sync.deviceId'] = 'mazz-mobile-' + Math.random().toString(16).slice(2, 8));
          const updatedAt = Math.max(Date.now(), Number(all[key]?.updatedAt || 0) + 1);
          const entry = { key, kind: payload.kind, value: payload.value, updatedAt, deviceId };
          mergeBrowserPositions(settings, [entry]); saveJSON(SETTINGS_KEY, settings); return entry;
        }
        case 'sync:positionGet': { const key = browserPositionKey(payload.kind, payload.path); return key ? (settings['sync.positions'] || {})[key] || null : null; }
        case 'sync:positions': return Object.values(settings['sync.positions'] || {});
        case 'sync:positionsMerge': { const changed = mergeBrowserPositions(settings, payload.entries); saveJSON(SETTINGS_KEY, settings); for (const entry of changed) emit('sync:positionChanged', entry); return changed; }

        // —— 主题/窗口 ——
        case 'theme:isDark': return matchMedia('(prefers-color-scheme: dark)').matches;
        case 'theme:setSource': return matchMedia('(prefers-color-scheme: dark)').matches;
        case 'window:toggleFullScreen':
          document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
          return true;
        case 'window:openChild': {
          // 浏览器预览：交接快照走 localStorage，开新标签页
          localStorage.setItem('mazz.handoff', JSON.stringify(payload.handoff || null));
          window.open(location.href, '_blank');
          return true;
        }
        case 'window:toMain': {
          // 浏览器预览：经 storage 事件通知主标签页接收
          localStorage.setItem('mazz.handoff.main', JSON.stringify(payload.handoff || null));
          return true;
        }
        case 'window:setTitle': document.title = payload.title; return true;
        case 'window:minimize': case 'window:toggleMaximize': case 'window:close':
        case 'window:isMaximized':
          return true;

        // —— 打印/剪贴板/通知 ——
        case 'print:print': window.print(); return true;
        case 'print:toPDF': window.print(); return null;
        case 'print:html': {
          // 网页端：开新窗口承载分页 HTML 后打印（@page 由 CSS 保证纸张/边距）
          const w = window.open('', '_blank', 'width=900,height=1200');
          if (!w) throw new Error('弹窗被拦截——请允许弹窗后重试');
          w.document.write(payload.html || '');
          w.document.close();
          setTimeout(() => { w.focus(); w.print(); }, 400);
          return payload.toPdf ? null : { ok: true };
        }
        case 'clipboard:write': {
          if (payload.html && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
            await navigator.clipboard.write([new ClipboardItem({
              'text/plain': new Blob([payload.text || ''], { type: 'text/plain' }),
              'text/html': new Blob([payload.html], { type: 'text/html' }),
            })]).catch(() => navigator.clipboard.writeText(payload.text || ''));
          } else await navigator.clipboard.writeText(payload.text ?? '').catch(() => {});
          return true;
        }
        case 'clipboard:read':
          return { text: await navigator.clipboard.readText().catch(() => ''), html: '', hasImage: false, formats: ['text/plain'] };
        case 'clipboard:readImagePNG': return null;
        case 'notify:show': {
          if ('Notification' in window && Notification.permission === 'granted') new Notification(payload.title, { body: payload.body });
          return true;
        }

        // —— 快照（崩溃恢复的浏览器版演示）——
        case 'snapshot:write': {
          const snaps = loadJSON(SNAP_KEY, {});
          snaps[payload.tabId] = { ...payload, savedAt: Date.now() };
          saveJSON(SNAP_KEY, snaps); return true;
        }
        case 'snapshot:list': return Object.values(loadJSON(SNAP_KEY, {})).sort((a, b) => b.savedAt - a.savedAt);
        case 'snapshot:clear': { const s = loadJSON(SNAP_KEY, {}); delete s[payload.tabId]; saveJSON(SNAP_KEY, s); return true; }
        case 'snapshot:clearAll': saveJSON(SNAP_KEY, {}); return true;
        case 'crash:lastExitUnclean': { const r = snapFlag; snapFlag = false; return r; }

        // —— 快速笔记 ——
        case 'quicknote:save': {
          const d = new Date().toISOString().slice(0, 10);
          const p = `/workspace/每日笔记/${d}.md`;
          const cur = await backend.readFile(p).catch(() => '');
          await backend.writeFile(p, cur + `\n- ${new Date().toTimeString().slice(0, 5)} ${payload.text}\n`);
          return p;
        }
        case 'quicknote:close': return true;

        // —— 搜索（浏览器预览受 CORS 限制，无法直连自签实例）——
        case 'searx:search':
          return { ok: false, error: '浏览器预览无法直连搜索实例（跨域限制），请在桌面版使用搜索', results: [] };
        case 'searx:extract':
          return { ok: false, error: '浏览器预览不能代抓网页正文，请在桌面版使用研究检索', text: '' };
        case 'searx:selfcheck':
          return { ok: false, checks: [{ name: '预览限制', pass: false, detail: '桌面版可用' }] };
        case 'searx:getMaskedConfig': return { masked: '（桌面版配置）', user: '', hasPass: false };
        case 'searx:setConfig': return { ok: false };

        // —— 其余：安全空操作 ——
        case 'menu:context': case 'menu:setModel': case 'appmenu:sync': return null;
        case 'spell:setLanguages': case 'spell:setEnabled': return true;
        case 'shell:showItemInFolder': return true;
        case 'shell:openExternal': window.open(payload.url, '_blank', 'noopener'); return true;
        case 'power:block': return true;

        // —— 移动端/浏览器暂不具备的能力：安全降级（不抛错，UI 自行提示）——
        case 'term:create': case 'term:list': return { id: null, unsupported: true };
        case 'term:write': case 'term:resize': case 'term:kill': return true;
        case 'py:exec': return { ok: false, error: 'Python 内核仅桌面版可用' };
        case 'py:status': return { available: false };
        case 'py:restart': return { ok: false };
        case 'debug:start': case 'debug:stop': case 'debug:request': return { ok: false, error: '调试器仅桌面版可用' };
        case 'debug:status': return { running: false };
        case 'app:fonts': return [];
        case 'pw:list': return [];
        case 'pw:save': case 'pw:delete': return { ok: false, error: '密码管理仅桌面版可用' };
        case 'pw:available': return false;
        case 'tr:translate': return { ok: false, error: '翻译仅桌面版可用' };
        case 'tr:getConfig': return { provider: 'mymemory', hasKey: false };
        case 'tr:setConfig': return { ok: true };
        case 'sync:identity': case 'sync:status': return { running: false, peers: [] };
        case 'sync:host': case 'sync:stopHost': case 'sync:join': return { ok: false, error: '局域网同步仅桌面版可用' };
        case 'sync:discover': return [];
        case 'update:check': return { hasUpdate: false };
        case 'update:getConfig': return { auto: false };
        case 'update:setConfig': return { ok: true };
        case 'share:targets': return []; // 桌面客户端检测仅 Electron 可用
        case 'share:sendFile': throw new Error('发送到工作软件仅桌面版/移动端可用');
        case 'dialog:openImport': { const p = await browserPickFile(); return p ? [p] : []; }
        case 'import:external': return { imported: payload.sources || [], skipped: [], workspace: '/workspace' }; // 网页端经选择器已落工作区
        case 'explorermenu:status': return { registered: false, unsupported: true };
        case 'explorermenu:register': return { ok: false, reason: 'unsupported' };
        case 'explorermenu:unregister': return { ok: false, reason: 'unsupported' };
        case 'apps:quickLaunch': return { apps: [], cachedAt: 0, unsupported: true };
        case 'apps:launch': return { ok: false, reason: 'unsupported' };
        case 'rec:sources': return [];
        case 'rec:useSource': return true;
        default: throw new Error(`[browser-bridge] 未实现的通道: ${channel}`);
      }
    },

    on(channel, cb) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
      return () => listeners.get(channel)?.delete(cb);
    },
  };

  function emit(channel, payload) {
    for (const cb of [...(listeners.get(channel) || [])]) { try { cb(payload); } catch {} }
  }

  function browserPickFile(payload = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      // 优先使用调用方 filters（如 player.open 的音视频列表），否则用默认文档集
      const exts = payload.filters?.flatMap(f => f.extensions || []).filter(e => e && e !== '*');
      input.accept = exts?.length
        ? exts.map(e => '.' + e.toLowerCase()).join(',')
        : '.md,.markdown,.txt,.mazz,.csv,.tsv,.mazzsheet,.xlsx,.docx,.pptx,.mazzslide,.mindmap,.mazzdraw,.js,.ts,.py,.css,.html,.json,.sh,.xml,.yml,.yaml,.epub,.cbz,text/plain,text/markdown';
      // 取消选择也必须收尾：onchange 不会触发，Promise 挂起会把 await 它的命令永久卡死
      // （实机破坏猴抓到：player.open 连按后执行上下文被回收）
      const done = (v) => { input.remove(); resolve(v); };
      input.addEventListener('cancel', () => done(null));
      // 部分引擎（Safari）要求 input 挂载在 DOM 上才能打开选择器
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return done(null);
        const p = '/workspace/' + f.name;
        const ext = f.name.split('.').pop().toLowerCase();
        // 二进制格式按 base64 存（办公文档/电子书等），文本按文本存
        if (/^(docx|xlsx|pptx|epub|cbz|pdf|png|jpe?g|gif|webp|mp4|webm|ogv|mov|m4v|mkv|avi|wmv|flv|mp3|wav|oga|m4a|aac|flac|opus|ogg|mobi|azw3?)$/.test(ext)) {
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
          await backend.writeFileBase64(p, btoa(bin)).catch(() => {});
        } else {
          await backend.writeFile(p, await f.text()).catch(() => {});
        }
        done(p);
      };
      input.click();
    });
  }

  window.mazz = api;
  console.log('[mazz] 浏览器预览桥已安装（localStorage 虚拟工作区）');
}
