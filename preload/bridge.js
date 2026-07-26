// preload/bridge.js —— 白名单 IPC 桥（contextIsolation 安全基线）
// 渲染进程唯一入口 window.mazz；任何新通道必须在白名单显式登记
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 白名单：invoke 通道
const INVOKE_CHANNELS = new Set([
  'fs:readFile', 'fs:writeFile', 'fs:listDir', 'fs:stat', 'fs:mkdir', 'fs:rename', 'fs:delete',
  'fs:readFileBase64', 'fs:writeFileBase64',
  'fs:watch', 'fs:unwatch',
  'dialog:openFile', 'dialog:saveFile', 'dialog:openFolder', 'dialog:confirm',
  'recent:list', 'recent:add', 'recent:clear',
  'settings:get', 'settings:set', 'workspace:get',
  'window:minimize', 'window:toggleMaximize', 'window:close', 'window:setTitle',
  'window:isMaximized', 'window:isFullScreen', 'window:toggleFullScreen', 'window:openChild', 'window:toMain',
  'theme:setSource', 'theme:isDark',
  'print:print', 'print:toPDF', 'print:html',
  'clipboard:write', 'clipboard:read', 'clipboard:readImagePNG',
  'notify:show',
  'shell:showItemInFolder', 'shell:openExternal', 'shell:openPath',
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
  'secret:set', 'secret:get',
  'factory:pandocAvailable', 'factory:extractText', 'factory:pandocExport', 'fs:closeAll',
  'factory:aiChat', 'factory:aiChatStream', 'factory:aiModels',
  'app:getAutoLaunch', 'app:setAutoLaunch', 'app:createDesktopShortcut',
  'tr:translate', 'tr:getConfig', 'tr:setConfig',
  'sync:identity', 'sync:host', 'sync:stopHost', 'sync:join', 'sync:discover', 'sync:status',
  'update:check', 'update:getConfig', 'update:setConfig',
  'share:targets', 'share:sendFile', 'share:sendToExe',
  'dialog:openImport', 'import:external',
  'explorermenu:status', 'explorermenu:register', 'explorermenu:unregister',
  'apps:quickLaunch', 'apps:launch',
  'rec:sources', 'rec:useSource', 'rec:selfFrame',
  'player:subAssets',
  'tor:add', 'tor:stats', 'tor:list', 'tor:streamUrl', 'tor:filePath', 'tor:remove', 'tor:fileBytes',
  'sites:list', 'sites:search', 'sites:magnet', 'sites:home',
  'mkv:tracks', 'mkv:extractFlac', 'mkv:extractTrack',
  'bv:create', 'bv:destroy', 'bv:bounds', 'bv:focus', 'bv:nav', 'bv:js', 'bv:zoom', 'bv:find', 'bv:navHistory', 'bv:state',
  'window:childAt', 'window:toChild', 'window:listChildren', 'theme:broadcast',
  'workspace:list', 'workspace:add', 'workspace:remove', 'workspace:rename', 'workspace:setCurrent',
]);

// 白名单：主进程 -> 渲染进程 事件
const EVENT_CHANNELS = new Set([
  'file:open', 'file:changed', 'file:import', 'command:invoke', 'menu:clicked',
  'protocol:open', 'power:resumed', 'quicknote:focus', 'theme:changed', 'window:handoff', 'window:role',
  'browser:openUrl', 'term:data', 'term:exit', 'debug:event', 'factory:aiChunk', 'library:download',
  'workspace:changed', 'window:fullscreen', 'bv:event',
]);

const listeners = new Map(); // channel -> Set<callback>

contextBridge.exposeInMainWorld('mazz', {
  platform: process.platform,
  // Electron 32+ File.path 已移除：拖拽文件取真实路径的唯一通道
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
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
