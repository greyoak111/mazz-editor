// renderer/app.js —— 渲染进程入口：桥安装 → 模块注册 → 外壳启动
import { installBrowserBridge } from './lib/browser-bridge.js';
if (!window.mazz) installBrowserBridge(); // 浏览器预览模式；Electron 由 preload 注入

import { commands } from './core/command-registry.js';
import { keymap } from './core/keymap-service.js';
import { contextKeys } from './core/contextkey-service.js';
import { modules } from './core/module-registry.js';
import { Shell } from './shell/shell.js';
import './bridge.js';            // 无感桥接引擎（window.MazzBridges）
import './ai/index.js';          // AI 扩展层（window.MazzAI，Provider=null）
import markdownModule, { registerSharedEditCommands } from './modules/markdown/index.js';
import textModule from './modules/text/index.js';
import sheetModule from './modules/sheet/index.js';
import slideModule from './modules/slide/index.js';
import browserModule from './modules/browser/index.js';
import codeModule from './modules/code/index.js';
import mathModule from './modules/math/index.js';
import notesModule from './modules/notes/index.js';
import searchModule from './modules/search/index.js';
import mindmapModule from './modules/mindmap/index.js';
import drawModule from './modules/draw/index.js';
import libraryModule from './modules/library/index.js';
import { registerTranslateCommands } from './translate.js';
import { registerOcrCommands } from './ocr.js';
import { registerVoiceCommands } from './voice.js';
import { registerPluginCommands } from './plugins/manager.js';
import { loadAllPlugins } from './plugins/loader.js';
import { registerSyncCommands } from './sync.js';
import { registerHelpCommands } from './help/index.js';
import { initI18n } from './i18n/index.js';
import { registerBridgeCommands } from './bridge.js';

// 全局命令入口（契约文档命名）
window.MazzCommands = commands;

// —— 注册契约模块 ——
modules.register('markdown', markdownModule);
modules.register('text', textModule);
modules.register('sheet', sheetModule);
modules.register('slide', slideModule);
modules.register('browser', browserModule);
modules.register('code', codeModule);
modules.register('math', mathModule);
modules.register('notes', notesModule);
modules.register('search', searchModule);
modules.register('mindmap', mindmapModule);
modules.register('draw', drawModule);
modules.register('library', libraryModule);
registerSharedEditCommands(commands);
registerBridgeCommands(commands);
registerTranslateCommands(commands);
registerOcrCommands(commands);
registerVoiceCommands(commands);
registerPluginCommands(commands);
registerSyncCommands(commands);
registerHelpCommands();

// —— 启动外壳 ——
await initI18n();
const shell = new Shell(document.body);
window.MazzShell = shell; // 调试/测试入口
keymap.attach();
contextKeys.set('module', null);
contextKeys.set('hasSelection', false);

shell.boot().then(() => {
  console.log('%c◆ Mazz Editor%c 已启动 — 一切操作皆命令', 'color:#818cf8;font-weight:bold', '');
  // 后台加载工作区插件（不阻塞启动）
  if (window.mazz?.isElectron) {
    loadAllPlugins().then(rs => {
      const ok = rs.filter(r => r.status === 'loaded').length;
      if (ok) console.log(`[plugins] 已加载 ${ok} 个插件`);
      rs.filter(r => r.status === 'error').forEach(r => console.warn('[plugins]', r.manifest.name, r.error));
    }).catch(() => {});
  }
}).catch(e => {
  console.error('[mazz] 启动失败:', e);
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif">启动失败：${e.message}</div>`;
});
