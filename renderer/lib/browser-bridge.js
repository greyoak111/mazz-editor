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

export function installBrowserBridge() {
  const listeners = new Map();
  let snapFlag = sessionStorage.getItem('mazz.running') === '1';
  sessionStorage.setItem('mazz.running', '1');

  const api = {
    platform: 'web', isElectron: false,
    versions: { electron: 'preview', chrome: navigator.userAgent },

    async invoke(channel, payload = {}) {
      const vfs = loadVFS();
      const settings = loadJSON(SETTINGS_KEY, {});
      switch (channel) {
        // —— 文件系统 ——
        case 'workspace:get': return '/workspace';
        case 'fs:listDir': {
          const dir = normalizePath(payload.path);
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
        }
        case 'fs:readFile': {
          const n = normalizePath(payload.path);
          if (vfs[n]?.type !== 'file') throw new Error('文件不存在: ' + n);
          return vfs[n].content;
        }
        case 'fs:readFileBase64': {
          const n = normalizePath(payload.path);
          if (vfs[n]?.type !== 'file') throw new Error('文件不存在: ' + n);
          return vfs[n].binary ? vfs[n].content : btoa(unescape(encodeURIComponent(vfs[n].content)));
        }
        case 'fs:writeFileBase64': {
          const n = normalizePath(payload.path);
          const parent = n.split('/').slice(0, -1).join('/') || '/';
          if (parent !== '/' && !vfs[parent]) vfs[parent] = { type: 'dir', mtime: Date.now() };
          vfs[n] = { type: 'file', binary: true, content: String(payload.base64 || ''), mtime: Date.now() };
          saveJSON(VFS_KEY, vfs);
          return true;
        }
        case 'fs:writeFile': {
          const n = normalizePath(payload.path);
          const parent = n.split('/').slice(0, -1).join('/') || '/';
          if (parent !== '/' && !vfs[parent]) vfs[parent] = { type: 'dir', mtime: Date.now() };
          vfs[n] = { type: 'file', content: String(payload.content ?? ''), mtime: Date.now() };
          saveJSON(VFS_KEY, vfs);
          emit('file:changed', { event: 'change', path: n, at: Date.now() });
          return true;
        }
        case 'fs:stat': {
          const n = normalizePath(payload.path);
          return vfs[n] ? { exists: true, isDir: vfs[n].type === 'dir', size: (vfs[n].content || '').length, mtime: vfs[n].mtime } : { exists: false };
        }
        case 'fs:mkdir': { vfs[normalizePath(payload.path)] = { type: 'dir', mtime: Date.now() }; saveJSON(VFS_KEY, vfs); return true; }
        case 'fs:rename': {
          const from = normalizePath(payload.from), to = normalizePath(payload.to);
          for (const p of Object.keys(vfs)) {
            if (p === from || p.startsWith(from + '/')) {
              vfs[to + p.slice(from.length)] = vfs[p];
              delete vfs[p];
            }
          }
          saveJSON(VFS_KEY, vfs); return true;
        }
        case 'fs:delete': { delete vfs[normalizePath(payload.path)]; saveJSON(VFS_KEY, vfs); return true; }
        case 'fs:watch': case 'fs:unwatch': return true;

        // —— 对话框 ——
        case 'dialog:openFile': return browserPickFile();
        case 'dialog:saveFile': return normalizePath('/workspace/' + (payload.defaultPath || '未命名.md').split(/[\\/]/).pop());
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
          const cur = vfs[p]?.content || '';
          vfs[p] = { type: 'file', mtime: Date.now(), content: cur + `\n- ${new Date().toTimeString().slice(0, 5)} ${payload.text}\n` };
          saveJSON(VFS_KEY, vfs);
          return p;
        }
        case 'quicknote:close': return true;

        // —— 搜索（浏览器预览受 CORS 限制，无法直连自签实例）——
        case 'searx:search':
          return { ok: false, error: '浏览器预览无法直连搜索实例（跨域限制），请在桌面版使用搜索', results: [] };
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

  function browserPickFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.txt,.mazz,text/plain,text/markdown';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return resolve(null);
        const text = await f.text();
        const p = '/workspace/' + f.name;
        const vfs = loadVFS();
        vfs[p] = { type: 'file', content: text, mtime: Date.now() };
        saveJSON(VFS_KEY, vfs);
        resolve(p);
      };
      input.click();
    });
  }

  window.mazz = api;
  console.log('[mazz] 浏览器预览桥已安装（localStorage 虚拟工作区）');
}
