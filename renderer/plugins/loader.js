// renderer/plugins/loader.js —— 插件系统：.maz 加载器（zip → blob import → 契约 v1 校验 → 注册）
import JSZip from 'jszip';
import { modules } from '../core/module-registry.js';
import { contextKeys } from '../core/contextkey-service.js';

const DISABLED_KEY = 'plugins.disabled';

export async function pluginDir() {
  const ws = await window.mazz.invoke('workspace:get');
  const dir = `${ws}/plugins`;
  await window.mazz.invoke('fs:mkdir', { path: dir }).catch(() => {});
  return dir;
}

export async function listPluginFiles() {
  const dir = await pluginDir();
  const entries = (await window.mazz.invoke('fs:listDir', { path: dir }).catch(() => [])) || [];
  return entries.filter(e => !e.isDir && e.name.toLowerCase().endsWith('.maz'));
}

/** 读取 .maz 包 → {manifest, code} */
export async function readMaz(path) {
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes.buffer);
  const manifestFile = zip.file('plugin.json');
  if (!manifestFile) throw new Error('不是合法的 .maz 插件（缺少 plugin.json）');
  const manifest = JSON.parse(await manifestFile.async('text'));
  const mainName = manifest.main || 'main.js';
  const mainFile = zip.file(mainName);
  if (!mainFile) throw new Error('插件缺少入口文件 ' + mainName);
  const code = await mainFile.async('text');
  return { manifest, code };
}

export function validateManifest(m) {
  for (const k of ['id', 'name', 'version']) {
    if (!m[k]) throw new Error('plugin.json 缺少必填字段：' + k);
  }
  if (!/^[\w][\w.-]*$/.test(m.id)) throw new Error('插件 id 非法：' + m.id);
}

/** contributes 预检（when 表达式严格解析校验，非法即抛） */
export function validateContributes(def) {
  const c = def.contributes || {};
  for (const kb of c.keybindings || []) {
    if (kb.when) contextKeys.validate(kb.when);
  }
  for (const items of Object.values(c.menus || {})) {
    for (const it of items) {
      if (it.when) contextKeys.validate(it.when);
    }
  }
  for (const cmd of c.commands || []) {
    if (cmd.when) contextKeys.validate(cmd.when);
  }
}

/** 加载并注册插件（modules.register 内建契约校验与命令查重） */
export async function loadPlugin(code, manifest) {
  validateManifest(manifest);
  // Electron/浏览器用 blob:（CSP 已放行）；Node 测试环境用 data:（其 ESM loader 不认 blob:）
  const isNode = typeof process !== 'undefined' && !!process.versions?.node && !window.mazz?.isElectron;
  let url, revoke = null;
  if (isNode) {
    url = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code);
  } else {
    url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    revoke = () => URL.revokeObjectURL(url);
  }
  try {
    const mod = await import(/* webpackIgnore: true */ url);
    const def = mod.default;
    if (!def || typeof def !== 'object') throw new Error('插件必须 default export 模块定义对象');
    validateContributes(def);
    const moduleName = 'plugin:' + manifest.id;
    if (modules.defs.has(moduleName)) return moduleName; // 已加载（重载场景）
    modules.register(moduleName, def);
    return moduleName;
  } finally {
    revoke?.();
  }
}

// ==================== 启用状态 ====================
async function getDisabled() {
  return (await window.mazz.invoke('settings:get', { key: DISABLED_KEY }).catch(() => [])) || [];
}
export async function isEnabled(id) {
  return !(await getDisabled()).includes(id);
}
export async function setEnabled(id, enabled) {
  const list = await getDisabled();
  const next = enabled ? list.filter(x => x !== id) : [...new Set([...list, id])];
  await window.mazz.invoke('settings:set', { key: DISABLED_KEY, value: next });
}

/** 启动时加载工作区 plugins/ 下全部启用中的插件 */
export async function loadAllPlugins() {
  const files = await listPluginFiles();
  const results = [];
  for (const f of files) {
    try {
      const { manifest, code } = await readMaz(f.path);
      validateManifest(manifest);
      if (!(await isEnabled(manifest.id))) {
        results.push({ manifest, status: 'disabled', path: f.path });
        continue;
      }
      const moduleName = await loadPlugin(code, manifest);
      results.push({ manifest, status: 'loaded', moduleName, path: f.path });
    } catch (e) {
      results.push({ manifest: { id: f.name.replace(/\.maz$/i, ''), name: f.name, version: '?' }, status: 'error', error: e.message || String(e), path: f.path });
    }
  }
  return results;
}

/** 安装 .maz 文件（复制到工作区 plugins/ 并加载） */
export async function installFromFile(srcPath) {
  const dir = await pluginDir();
  const name = srcPath.split(/[\\/]/).pop();
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path: srcPath });
  const dest = `${dir}/${name}`;
  await window.mazz.invoke('fs:writeFileBase64', { path: dest, base64: b64 });
  const { manifest, code } = await readMaz(dest);
  validateManifest(manifest);
  await setEnabled(manifest.id, true);
  const moduleName = await loadPlugin(code, manifest);
  return { manifest, moduleName };
}
