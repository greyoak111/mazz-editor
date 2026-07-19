// preload/bridge.js —— 白名单 IPC 桥（contextIsolation 安全基线）
// 渲染进程唯一入口 window.mazz；任何新通道必须在白名单显式登记
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 白名单：invoke 通道
const INVOKE_CHANNELS = new Set([
  'fs:readFile', 'fs:writeFile', 'fs:listDir', 'fs:stat', 'fs:mkdir', 'fs:rename', 'fs:delete',
  'fs:readFileBase64', 'fs:writeFileBase64',
  'fs:watch', 'fs:unwatch',
  'dialog:openFile', 'dialog:saveFile', 'dialog:openFolder', 'dialog:confirm',
  'recent:list', 'recent:add', 'recent:clear',
  'settings:get', 'settings:set', 'workspace:get',
  'window:minimize', 'window:toggleMaximize', 'window:close', 'window:setTitle',
  'window:isMaximized', 'window:toggleFullScreen', 'window:openChild', 'window:toMain',
  'theme:setSource', 'theme:isDark',
  'print:print', 'print:toPDF',
  'clipboard:write', 'clipboard:read', 'clipboard:readImagePNG',
  'notify:show',
  'shell:showItemInFolder', 'shell:openExternal',
  'spell:setLanguages', 'spell:setEnabled',
  'quicknote:save', 'quicknote:close',
  'snapshot:write', 'snapshot:list', 'snapshot:clear', 'snapshot:clearAll', 'crash:lastExitUnclean',
  'power:block',
  'menu:context', 'menu:setModel', 'appmenu:sync',
  'searx:search', 'searx:selfcheck', 'searx:getMaskedConfig', 'searx:setConfig',
  'term:create', 'term:write', 'term:resize', 'term:kill', 'term:list',
  'py:exec', 'py:status', 'py:restart',
  'debug:start', 'debug:stop', 'debug:request', 'debug:status',
  'app:fonts',
  'pw:list', 'pw:save', 'pw:delete', 'pw:available',
  'tr:translate', 'tr:getConfig', 'tr:setConfig',
  'sync:identity', 'sync:host', 'sync:stopHost', 'sync:join', 'sync:discover', 'sync:status',
  'update:check', 'update:getConfig', 'update:setConfig',
]);

// 白名单：主进程 -> 渲染进程 事件
const EVENT_CHANNELS = new Set([
  'file:open', 'file:changed', 'command:invoke', 'menu:clicked',
  'protocol:open', 'power:resumed', 'quicknote:focus', 'theme:changed', 'window:handoff', 'window:role',
  'browser:openUrl', 'term:data', 'term:exit', 'debug:event',
]);

const listeners = new Map(); // channel -> Set<callback>

contextBridge.exposeInMainWorld('mazz', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  isElectron: true,

  async invoke(channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) throw new Error(`[bridge] 通道未在白名单: ${channel}`);
    const res = await ipcRenderer.invoke('mazz:invoke', { channel, payload, requestId: Date.now() });
    if (!res.ok) throw new Error(res.error || 'IPC 调用失败');
    return res.data;
  },

  on(channel, callback) {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`[bridge] 事件未在白名单: ${channel}`);
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);
    return () => listeners.get(channel)?.delete(callback);
  },
});

ipcRenderer.on('mazz:event', (_e, { channel, payload }) => {
  const set = listeners.get(channel);
  if (set) for (const cb of [...set]) { try { cb(payload); } catch (e) { console.error('[bridge] listener error:', e); } }
});
