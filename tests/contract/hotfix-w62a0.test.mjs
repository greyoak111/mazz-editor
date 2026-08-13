// tests/contract/hotfix-w62a0.test.mjs —— W62a-0 AI 分工路由契约
import fs from 'fs';
import './_setup.mjs';
import { describe, test, assert } from '../harness.mjs';
import {
  AI_ROLES, PRESETS, connectedProviderModels, getProviderAdminSnapshot, getProviderConfig,
  normalizeRouting, resolveProviderRoute, saveProviderConfig, saveProviderRoute,
} from '../../renderer/modules/factory/provider.js';
import { aiRoleOptions } from '../../renderer/lib/ai-role-picker.js';

const src = rel => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const providerSrc = src('renderer/modules/factory/provider.js');
const factorySrc = src('renderer/modules/factory/index.js');
const configSrc = src('renderer/panels/factorycfg.html');
const shellSrc = src('renderer/shell/shell.js');
const pickerSrc = src('renderer/lib/ai-role-picker.js');

let settings, secrets;
function resetStore() {
  settings = new Map(); secrets = new Map();
  window.mazz = {
    isElectron: true,
    invoke: async (channel, payload = {}) => {
      if (channel === 'settings:get') return settings.get(payload.key) ?? null;
      if (channel === 'settings:set') { settings.set(payload.key, payload.value); return true; }
      if (channel === 'secret:get') return secrets.get(payload.key) ?? '';
      if (channel === 'secret:set') { secrets.set(payload.key, payload.value); return true; }
      throw new Error('unexpected IPC: ' + channel);
    },
  };
}

describe('W62a-0 分仓密钥与旧配置迁移', () => {
  test('旧双名密钥可一次迁入 factory.keys，且旧调用仍取到默认模型', async () => {
    resetStore();
    settings.set('factory.provider', { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro' });
    secrets.set('factory.providerKey', 'legacy-panel-key');
    const cfg = await getProviderConfig();
    assert.equal(cfg.providerId, 'deepseek');
    assert.equal(cfg.apiKey, 'legacy-panel-key');
    assert.equal(JSON.parse(secrets.get('factory.keys')).deepseek, 'legacy-panel-key');
    assert.deepEqual(settings.get('factory.routing').default, { providerId: 'deepseek', model: 'deepseek-v4-pro' });
  });

  test('服务商按 id 分仓保存，管理快照只给状态点不泄露 Key', async () => {
    resetStore();
    await saveProviderConfig({ providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKey: 'key-d' });
    await saveProviderConfig({ providerId: 'kimi', baseURL: 'https://api.moonshot.cn', model: 'kimi-k3', apiKey: 'key-k', makeDefault: false });
    const state = await getProviderAdminSnapshot();
    assert.equal(JSON.parse(secrets.get('factory.keys')).kimi, 'key-k');
    assert.equal(state.providers.find(x => x.id === 'kimi').keySet, true);
    assert.equal(state.providers.some(x => 'apiKey' in x), false);
    assert.equal(JSON.stringify(state).includes('key-k'), false);
  });
});

describe('W62a-0 三级路由与岗位角色卡', () => {
  test('岗位改派优先于全局，取消改派恢复跟随全局', async () => {
    resetStore();
    await saveProviderConfig({ providerId: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKey: 'key-d' });
    await saveProviderConfig({ providerId: 'kimi', baseURL: 'https://api.moonshot.cn', model: 'kimi-k3', apiKey: 'key-k', makeDefault: false });
    await saveProviderRoute('chapter', { providerId: 'kimi', model: 'kimi-k3' });
    assert.equal((await getProviderConfig('chapter')).providerId, 'kimi');
    assert.equal((await getProviderConfig('blueprint')).providerId, 'deepseek');
    await saveProviderRoute('chapter', null);
    assert.equal((await getProviderConfig('chapter')).providerId, 'deepseek');
  });

  test('岗位目标失去 Key 时自动回落全局默认', () => {
    const providers = {
      deepseek: { id: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
      kimi: { id: 'kimi', baseURL: 'https://api.moonshot.cn', model: 'kimi-k3' },
    };
    const routing = normalizeRouting({ default: { providerId: 'deepseek', model: 'deepseek-v4-pro' }, routes: { chapter: { providerId: 'kimi', model: 'kimi-k3' } } });
    const cfg = resolveProviderRoute({ role: 'chapter', routing, providers, keys: { deepseek: 'key-d' } });
    assert.equal(cfg.providerId, 'deepseek');
    assert.equal(cfg.apiKey, 'key-d');
  });

  test('六张角色卡与十一处业务岗位齐全', () => {
    const cards = new Set(PRESETS.flatMap(x => x.cards || []));
    for (const id of ['reasoning', 'fast', 'vision', 'long-context', 'embedding', 'privacy']) assert(cards.has(id), `缺角色卡 ${id}`);
    const roles = new Set(AI_ROLES.map(x => x.id));
    for (const id of ['blueprint', 'chapter', 'snapshot', 'translation', 'style', 'search', 'vision', 'companion', 'video', 'agent', 'embedding']) assert(roles.has(id), `缺岗位 ${id}`);
  });
});

describe('W62a-0 中央登记与就地指派', () => {
  test('选单固定跟随全局置顶且只消费已有 Key 的 provider×model', () => {
    const connected = connectedProviderModels({ providers: {}, keys: { deepseek: 'key-d' } });
    const options = aiRoleOptions({ connected });
    assert.equal(options[0].label, '跟随全局');
    assert(options.slice(1).every(x => x.v.startsWith('deepseek::')), '无 Key 服务商混入选单');
    assert(!options.some(x => x.v.startsWith('kimi::')), '未接入 Kimi 不应出现');
  });

  test('配置窗只拿脱敏状态，岗位指派复用唯一 picklist', () => {
    for (const pin of ['AI 分工', 'factoryProviderQuery', 'factoryProviderSave', 'factoryRolePickOpen', 'key-dot']) assert(configSrc.includes(pin), `配置窗缺 ${pin}`);
    assert(!configSrc.includes("invoke('secret:get'"), '配置窗仍在直读 Key');
    assert(!configSrc.includes("invoke('secret:set'"), '配置窗仍在直写 Key');
    for (const pin of ['getProviderAdminSnapshot', 'saveProviderRoute', 'window.__picklistPending']) assert(shellSrc.includes(pin), `主窗桥缺 ${pin}`);
    assert(pickerSrc.includes("kind: 'picklist'") && !pickerSrc.includes("createElement('select')"), '公共件必须只复用 picklist');
  });

  test('chat/chatStream 保留零破坏 cfg 形参并新增 role 穿针', () => {
    assert(providerSrc.includes("chat({ cfg, role = ''") && providerSrc.includes("chatStream({ cfg, role = ''"), 'chat 双入口未增 role');
    assert(providerSrc.includes('role ? await getProviderConfig(role) : (cfg || await getProviderConfig())'), '旧 cfg 调用兼容门缺失');
    assert(providerSrc.includes('请到「AI 服务 → AI 分工」'), '无路由没有人话管理入口');
    for (const role of ['blueprint', 'chapter', 'snapshot', 'style']) assert(factorySrc.includes(`role: '${role}'`), `工厂缺 ${role} 穿针`);
  });
});
