// renderer/plugins/loader.js —— 插件系统：.maz 加载器（内容哈希授权 → zip → blob import → 契约 v1 校验 → 注册）
import JSZip from 'jszip';
import { modules } from '../core/module-registry.js';
import { contextKeys } from '../core/contextkey-service.js';

const DISABLED_KEY = 'plugins.disabled';
const TRUST_KEY = 'plugins.trust.v1';
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_CODE_BYTES = 4 * 1024 * 1024;

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

function bytesFromBase64(b64) {
  if (typeof b64 !== 'string') throw new Error('插件文件读取失败');
  if (b64.length > Math.ceil(MAX_PACKAGE_BYTES / 3) * 4 + 4) {
    throw new Error(`插件包超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MiB 上限`);
  }
  const bin = atob(b64);
  if (bin.length > MAX_PACKAGE_BYTES) throw new Error(`插件包超过 ${MAX_PACKAGE_BYTES / 1024 / 1024} MiB 上限`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(bytes) {
  const cryptoApi = globalThis.crypto || globalThis.window?.crypto;
  if (!cryptoApi?.subtle) throw new Error('当前运行环境不支持插件内容哈希校验');
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const exact = view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? view.buffer
    : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', exact));
  return [...digest].map(x => x.toString(16).padStart(2, '0')).join('');
}

function declaredSize(file) {
  const size = file?._data?.uncompressedSize;
  return Number.isFinite(size) ? size : null;
}

async function parseMazBytes(bytes) {
  const packageHash = await sha256Hex(bytes);
  const zip = await JSZip.loadAsync(bytes.buffer);
  const manifestFile = zip.file('plugin.json');
  if (!manifestFile) throw new Error('不是合法的 .maz 插件（缺少 plugin.json）');
  if ((declaredSize(manifestFile) || 0) > MAX_MANIFEST_BYTES) throw new Error('plugin.json 过大');
  const manifestText = await manifestFile.async('text');
  if (manifestText.length > MAX_MANIFEST_BYTES) throw new Error('plugin.json 过大');
  const manifest = JSON.parse(manifestText);
  validateManifest(manifest);
  const mainName = manifest.main || 'main.js';
  const mainFile = zip.file(mainName);
  if (!mainFile) throw new Error('插件缺少入口文件 ' + mainName);
  if ((declaredSize(mainFile) || 0) > MAX_CODE_BYTES) throw new Error('插件入口文件过大');
  const code = await mainFile.async('text');
  if (code.length > MAX_CODE_BYTES) throw new Error('插件入口文件过大');
  return { manifest, code, packageHash, permissions: normalizePermissions(manifest.permissions) };
}

/** 读取 .maz 包 → {manifest, code, packageHash, permissions} */
export async function readMaz(path) {
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path });
  return parseMazBytes(bytesFromBase64(b64));
}

export function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('plugin.json 必须是对象');
  for (const k of ['id', 'name', 'version']) {
    if (typeof m[k] !== 'string' || !m[k].trim()) throw new Error('plugin.json 缺少必填字段：' + k);
  }
  if (!/^[\w][\w.-]*$/.test(m.id)) throw new Error('插件 id 非法：' + m.id);
  if (m.id.length > 128) throw new Error('插件 id 过长');
  if (m.main != null) {
    if (typeof m.main !== 'string' || !m.main || m.main.length > 512 || m.main.includes('\\') || m.main.includes('\0')) {
      throw new Error('插件入口路径非法');
    }
    const segments = m.main.split('/');
    if (m.main.startsWith('/') || /^[A-Za-z]:/.test(m.main) || segments.some(part => !part || part === '.' || part === '..')) {
      throw new Error('插件入口路径非法');
    }
  }
  normalizePermissions(m.permissions);
}

export function normalizePermissions(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 64 || value.some(x => typeof x !== 'string' || !x.trim() || x.length > 128)) {
    throw new Error('plugin.json permissions 必须是字符串数组');
  }
  return [...new Set(value.map(x => x.trim()))].sort();
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
  const moduleName = 'plugin:' + manifest.id;
  // 重载/同 ID 包必须在执行代码前收口，否则顶层副作用会被重复执行。
  if (modules.defs.has(moduleName)) return moduleName;
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

async function getTrustEntries() {
  const raw = await window.mazz.invoke('settings:get', { key: TRUST_KEY }).catch(() => null);
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  return entries.filter(x => x && typeof x.id === 'string' && /^[a-f0-9]{64}$/.test(x.sha256 || ''));
}

async function setTrustEntries(entries) {
  await window.mazz.invoke('settings:set', {
    key: TRUST_KEY,
    value: { version: 1, entries },
  });
}

export async function getTrustState(id, packageHash) {
  const entry = (await getTrustEntries()).find(x => x.id === id);
  if (!entry) return { status: 'untrusted', entry: null };
  if (entry.sha256 !== packageHash) return { status: 'changed', entry };
  return { status: 'trusted', entry };
}

async function rememberTrust(manifest, packageHash, permissions) {
  const entries = (await getTrustEntries()).filter(x => x.id !== manifest.id);
  entries.push({
    id: manifest.id,
    sha256: packageHash,
    name: manifest.name,
    version: manifest.version,
    permissions: [...permissions],
    approvedAt: new Date().toISOString(),
  });
  await setTrustEntries(entries);
}

export async function revokeTrust(id) {
  const entries = (await getTrustEntries()).filter(x => x.id !== id);
  await setTrustEntries(entries);
  await setEnabled(id, false);
}

export async function inspectPlugin(path) {
  const pkg = await readMaz(path);
  const trust = await getTrustState(pkg.manifest.id, pkg.packageHash);
  const enabled = await isEnabled(pkg.manifest.id);
  return {
    ...pkg,
    trustStatus: trust.status,
    trustEntry: trust.entry,
    enabled,
    loaded: modules.defs.has('plugin:' + pkg.manifest.id),
  };
}

/** 显式授权当前精确内容并加载；expectedHash 防止审查与执行之间被替换。 */
export async function trustAndLoad(path, expectedHash) {
  const pkg = await readMaz(path);
  if (!expectedHash || pkg.packageHash !== expectedHash) {
    throw new Error('插件内容已在审查后发生变化，请重新审查');
  }
  const wasLoaded = modules.defs.has('plugin:' + pkg.manifest.id);
  const moduleName = await loadPlugin(pkg.code, pkg.manifest);
  await rememberTrust(pkg.manifest, pkg.packageHash, pkg.permissions);
  await setEnabled(pkg.manifest.id, true);
  return { ...pkg, moduleName, requiresRestart: wasLoaded };
}

/** 重新启用已经授权且内容未变化的插件，不扩大授权边界。 */
export async function enableTrusted(path, expectedHash) {
  const pkg = await readMaz(path);
  if (!expectedHash || pkg.packageHash !== expectedHash) {
    throw new Error('插件内容已发生变化，请重新审查');
  }
  const trust = await getTrustState(pkg.manifest.id, pkg.packageHash);
  if (trust.status !== 'trusted') throw new Error('插件尚未获得当前内容版本的授权');
  const moduleName = await loadPlugin(pkg.code, pkg.manifest);
  await setEnabled(pkg.manifest.id, true);
  return { ...pkg, moduleName };
}

/** 启动时加载工作区 plugins/ 下全部启用中的插件 */
export async function loadAllPlugins() {
  const files = await listPluginFiles();
  const results = [];
  for (const f of files) {
    try {
      const { manifest, code, packageHash, permissions } = await readMaz(f.path);
      if (!(await isEnabled(manifest.id))) {
        results.push({ manifest, packageHash, permissions, status: 'disabled', path: f.path });
        continue;
      }
      const trust = await getTrustState(manifest.id, packageHash);
      if (trust.status !== 'trusted') {
        results.push({ manifest, packageHash, permissions, status: trust.status, path: f.path });
        continue;
      }
      const moduleName = await loadPlugin(code, manifest);
      results.push({ manifest, packageHash, permissions, status: 'loaded', moduleName, path: f.path });
    } catch (e) {
      results.push({ manifest: { id: f.name.replace(/\.maz$/i, ''), name: f.name, version: '?' }, status: 'error', error: e.message || String(e), path: f.path });
    }
  }
  return results;
}

/** 安装 .maz 文件：先校验再复制，默认隔离且不执行。 */
export async function installFromFile(srcPath) {
  const dir = await pluginDir();
  const name = srcPath.split(/[\\/]/).pop();
  const b64 = await window.mazz.invoke('fs:readFileBase64', { path: srcPath });
  // 校验和复制使用同一次读取的字节，避免两次读取之间源包被替换。
  const source = await parseMazBytes(bytesFromBase64(b64));
  const dest = `${dir}/${name}`;
  await window.mazz.invoke('fs:writeFileBase64', { path: dest, base64: b64 });
  await setEnabled(source.manifest.id, false);
  const trust = await getTrustState(source.manifest.id, source.packageHash);
  return { ...source, path: dest, status: trust.status === 'trusted' ? 'disabled' : trust.status };
}
