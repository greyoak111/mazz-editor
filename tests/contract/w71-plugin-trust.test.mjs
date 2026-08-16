// W71：插件内容哈希授权、默认隔离与变更撤权
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const files = new Map();
const settings = new Map();
const readCounts = new Map();

window.mazz = {
  isElectron: false,
  invoke: async (channel, payload = {}) => {
    if (channel === 'workspace:get') return '/workspace';
    if (channel === 'fs:mkdir') return true;
    if (channel === 'fs:listDir') {
      return [...files.keys()]
        .filter(path => path.startsWith(payload.path + '/'))
        .map(path => ({ name: path.split('/').pop(), path, isDir: false }));
    }
    if (channel === 'fs:readFileBase64') {
      readCounts.set(payload.path, (readCounts.get(payload.path) || 0) + 1);
      const value = files.get(payload.path);
      if (!value) throw new Error('ENOENT: ' + payload.path);
      return value.toString('base64');
    }
    if (channel === 'fs:writeFileBase64') {
      files.set(payload.path, Buffer.from(payload.base64, 'base64'));
      return true;
    }
    if (channel === 'settings:get') return settings.get(payload.key);
    if (channel === 'settings:set') { settings.set(payload.key, payload.value); return true; }
    throw new Error('unexpected channel: ' + channel);
  },
};
window.MazzCommands = { execute: () => {} };
window.MazzHost = { notifyChange: () => {}, setTabTitle: () => {}, openTab: () => {}, toast: () => {} };

const L = await import('../../renderer/plugins/loader.js');
const { modules } = await import('../../renderer/core/module-registry.js');

async function makeMaz({ delta, permissions = ['workspace.read', 'network.fetch'] }) {
  const zip = new JSZip();
  zip.file('plugin.json', JSON.stringify({
    id: 'w71-secure-demo',
    name: 'W71 Secure Demo',
    version: `1.0.${delta}`,
    main: 'main.js',
    permissions,
  }));
  zip.file('main.js', `
    globalThis.__w71PluginRuns = (globalThis.__w71PluginRuns || 0) + ${delta};
    export default {
      displayName: 'W71 Secure Demo', icon: '🧩',
      create(container) { return { container }; },
      activate() {}, deactivate() {},
      getContent() { return ''; }, setContent() {}, newDocument() {},
      contributes: { commands: [], keybindings: [], menus: {}, bridges: [], aiActions: [] },
    };
  `);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('W71 插件安全边界', () => {
  test('新装包默认隔离；即使遗留启用位为真也不会执行未授权内容', async () => {
    globalThis.__w71PluginRuns = 0;
    files.clear();
    settings.clear();
    readCounts.clear();
    const v1 = await makeMaz({ delta: 1 });
    files.set('/incoming/secure-demo.maz', v1);

    const installed = await L.installFromFile('/incoming/secure-demo.maz');
    assert.equal(installed.status, 'untrusted');
    assert.equal(installed.packageHash.length, 64);
    assert.equal(readCounts.get('/incoming/secure-demo.maz'), 1, '安装必须用同一次读取完成校验和复制');
    assert.equal(globalThis.__w71PluginRuns, 0, '安装阶段不得执行插件顶层代码');
    assert.equal(await L.isEnabled(installed.manifest.id), false, '新装包必须默认禁用');

    await L.setEnabled(installed.manifest.id, true); // 模拟历史版本留下的“已启用”状态
    const [result] = await L.loadAllPlugins();
    assert.equal(result.status, 'untrusted');
    assert.equal(globalThis.__w71PluginRuns, 0, '无内容授权时启动扫描不得执行代码');
  });

  test('显式授权绑定精确 SHA-256；审查后替换与内容变化均拒绝执行', async () => {
    const path = '/workspace/plugins/secure-demo.maz';
    const before = await L.inspectPlugin(path);
    await assert.rejects(() => L.trustAndLoad(path, '0'.repeat(64)), /发生变化/);
    assert.equal(globalThis.__w71PluginRuns, 0, '哈希不匹配不得执行');

    const trusted = await L.trustAndLoad(path, before.packageHash);
    assert.equal(globalThis.__w71PluginRuns, 1);
    assert.deepEqual(trusted.permissions, ['network.fetch', 'workspace.read']);
    assert.equal((await L.getTrustState(trusted.manifest.id, trusted.packageHash)).status, 'trusted');

    await L.loadAllPlugins();
    await L.loadAllPlugins();
    assert.equal(globalThis.__w71PluginRuns, 1, '重复扫描必须在 import 前收口，不能重复触发顶层副作用');

    modules.unregister('plugin:w71-secure-demo');
    files.set(path, await makeMaz({ delta: 10 }));
    const [changed] = await L.loadAllPlugins();
    assert.equal(changed.status, 'changed');
    assert.equal(globalThis.__w71PluginRuns, 1, '包内容变化后旧授权必须自动失效');

    const changedInfo = await L.inspectPlugin(path);
    await L.trustAndLoad(path, changedInfo.packageHash);
    assert.equal(globalThis.__w71PluginRuns, 11, '重新审查当前哈希后才允许执行新内容');
  });

  test('撤权同时禁用；权限与入口路径接受严格校验', async () => {
    await L.revokeTrust('w71-secure-demo');
    const info = await L.inspectPlugin('/workspace/plugins/secure-demo.maz');
    assert.equal(info.trustStatus, 'untrusted');
    assert.equal(info.enabled, false);
    assert.throws(() => L.validateManifest({ id: 'x', name: 'x', version: '1', permissions: 'network' }), /字符串数组/);
    assert.throws(() => L.validateManifest({ id: 'x', name: 'x', version: '1', main: '../main.js' }), /入口路径非法/);
    assert.throws(() => L.validateManifest({ id: 'x', name: 'x', version: '1', main: 'C:/main.js' }), /入口路径非法/);
    assert.throws(() => L.validateManifest({ id: 'x', name: 'x', version: '1', main: 'dir\\main.js' }), /入口路径非法/);
    assert.throws(() => L.validateManifest({ id: 'x', name: 'x', version: '1', main: 'dir//main.js' }), /入口路径非法/);
  });
});
