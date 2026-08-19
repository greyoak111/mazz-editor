// renderer/modules/factory/provider.js —— AI Provider：OpenAI 兼容端点（DeepSeek/Kimi/OpenAI/Ollama）
// Key 用 safeStorage 加密落盘（secret 通道），配置在 settings，Key 不明文存储
const CFG_KEY = 'factory.provider'; // 旧默认配置镜像，迁移期保留
const PROVIDERS_KEY = 'factory.providers';
const ROUTING_KEY = 'factory.routing';
const KEYS_SECRET = 'factory.keys';
const LEGACY_SECRET_KEYS = ['factory.apiKey', 'factory.providerKey'];

export const PROVIDER_CARDS = Object.freeze([
  { id: 'reasoning', label: '推理', desc: '规划、裁决与复杂分析' },
  { id: 'fast', label: '快速', desc: '低延迟批处理' },
  { id: 'vision', label: '视觉', desc: '图片与视频理解' },
  { id: 'long-context', label: '长上下文', desc: '长篇、资料包与连续创作' },
  { id: 'embedding', label: '向量', desc: '语义索引与检索' },
  { id: 'privacy', label: '隐私', desc: '本机或私有端点' },
]);

export const AI_ROLES = Object.freeze([
  { id: 'blueprint', label: '智能创作·蓝图', card: 'reasoning' },
  { id: 'chapter', label: '智能创作·章节', card: 'long-context' },
  { id: 'snapshot', label: '智能创作·快照', card: 'fast' },
  { id: 'factory_skeleton', label: '专业流程·总纲席 M1', card: 'reasoning' },
  { id: 'factory_writer', label: '专业流程·执笔席 M3', card: 'long-context' },
  { id: 'factory_point', label: '专业流程·节点验收席 M2', card: 'reasoning' },
  { id: 'factory_review_a', label: '专业流程·审校席 M4', card: 'long-context' },
  { id: 'factory_review_b', label: '专业流程·反向核查席 M5', card: 'reasoning' },
  { id: 'factory_arbiter', label: '专业流程·仲裁席 M6', card: 'reasoning' },
  { id: 'factory_polish', label: '专业流程·润色席', card: 'long-context' },
  { id: 'translation', label: '翻译', card: 'fast' },
  { id: 'style', label: '文风分析', card: 'long-context' },
  { id: 'search', label: '检索摘要', card: 'fast' },
  { id: 'research', label: '证据合成', card: 'reasoning' },
  { id: 'mindmap_distill', label: '导图·层级提炼', card: 'reasoning' },
  { id: 'vision', label: '视觉识别', card: 'vision' },
  { id: 'companion', label: '陪看', card: 'reasoning' },
  { id: 'companion_1', label: '陪看·席位 1', card: 'reasoning' },
  { id: 'companion_2', label: '陪看·席位 2', card: 'reasoning' },
  { id: 'companion_3', label: '陪看·席位 3', card: 'reasoning' },
  { id: 'companion_4', label: '陪看·席位 4', card: 'reasoning' },
  { id: 'video', label: '视频剖析', card: 'vision' },
  { id: 'agent', label: '指令台', card: 'reasoning' },
  { id: 'embedding', label: '语义索引', card: 'embedding' },
]);

/** 主流 AI 服务商预置（2026 版库：国内外前排厂商全收编，模型选单 + /v1/models 自动拉取） */
export const PRESETS = [
  // —— 国内 ——
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash', models: ['deepseek-v4-flash', 'deepseek-v4-pro'], cards: ['reasoning', 'fast', 'long-context'] },
  { id: 'kimi', name: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn', model: 'kimi-k3', models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'moonshot-v1-128k'], cards: ['reasoning', 'fast', 'long-context'] },
  { id: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2', models: ['glm-5.2', 'glm-5.2-fast-preview', 'glm-5.1', 'glm-5', 'glm-5v-turbo', 'glm-4.7'], cards: ['reasoning', 'fast', 'vision', 'long-context'] },
  { id: 'qwen', name: '阿里通义 Qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen3.8-max-preview', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.6-flash', 'qwen-max', 'qwen-turbo', 'qwen-vl-max'], cards: ['reasoning', 'fast', 'vision', 'long-context', 'embedding'] },
  { id: 'doubao', name: '字节豆包', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1.6', models: ['doubao-seed-1.6', 'doubao-seed-1.6-flash', 'doubao-seed-2.0-pro', 'doubao-vision-pro-32k'], cards: ['reasoning', 'fast', 'vision', 'long-context'] },
  { id: 'minimax', name: 'MiniMax', baseURL: 'https://api.minimax.chat/v1', model: 'MiniMax-M3', models: ['MiniMax-M3', 'MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat'], cards: ['reasoning', 'fast', 'long-context'] },
  { id: 'spark', name: '讯飞星火', baseURL: 'https://spark-api-open.xf-yun.com/v1', model: 'generalv3.5', models: ['generalv3.5', 'generalv3', '4.0Ultra'], cards: ['fast', 'long-context'] },
  { id: 'baidu', name: '百度文心', baseURL: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.0-turbo-8k', models: ['ernie-4.0-turbo-8k', 'ernie-speed-128k', 'ernie-lite-8k'], cards: ['reasoning', 'fast', 'long-context'] },
  { id: 'stepfun', name: '阶跃星辰', baseURL: 'https://api.stepfun.com/v1', model: 'step-2-16k', models: ['step-2-16k', 'step-1-128k', 'step-1v-32k'], cards: ['reasoning', 'vision', 'long-context'] },
  { id: 'hunyuan', name: '腾讯混元', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-hy3', models: ['hunyuan-hy3', 'hunyuan-turbo', 'hunyuan-pro', 'hunyuan-lite'], cards: ['reasoning', 'fast', 'long-context'] },
  // —— 国外 ——
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com', model: 'gpt-5.5', models: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'], cards: ['reasoning', 'fast', 'vision', 'long-context', 'embedding'] },
  { id: 'anthropic', name: 'Anthropic（OpenAI 兼容网关）', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-4.8', models: ['claude-fable-5', 'claude-opus-4.8', 'claude-opus-4.7', 'claude-sonnet-5', 'claude-opus-4.6'], cards: ['reasoning', 'fast', 'vision', 'long-context'] },
  { id: 'gemini', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'], cards: ['reasoning', 'fast', 'vision', 'long-context', 'embedding'] },
  { id: 'xai', name: 'xAI Grok', baseURL: 'https://api.x.ai/v1', model: 'grok-4.5', models: ['grok-4.5', 'grok-4', 'grok-3', 'grok-3-mini'], cards: ['reasoning', 'fast', 'long-context'] },
  { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b'], cards: ['fast'] },
  { id: 'openrouter', name: 'OpenRouter（聚合）', baseURL: 'https://openrouter.ai/api/v1', model: 'auto', models: ['auto'], cards: ['reasoning', 'fast', 'vision', 'long-context', 'embedding'] },
  { id: 'siliconflow', name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct', models: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3', 'Pro/deepseek-ai/DeepSeek-R1'], cards: ['reasoning', 'fast', 'embedding'] },
  { id: 'ollama', name: 'Ollama（本地）', baseURL: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'], cards: ['privacy', 'fast', 'embedding'] },
  { id: 'custom', name: '自定义端点', baseURL: '', model: '', models: [], cards: ['reasoning', 'fast', 'vision', 'long-context', 'embedding', 'privacy'] },
];

const presetById = (id) => PRESETS.find(p => p.id === id);
export function inferProviderId(baseURL = '') {
  const url = String(baseURL).replace(/\/+$/, '').toLowerCase();
  return PRESETS.find(p => p.id !== 'custom' && p.baseURL.replace(/\/+$/, '').toLowerCase() === url)?.id || 'custom';
}
const safeObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const normalizeTarget = (value) => value?.providerId && value?.model ? { providerId: String(value.providerId), model: String(value.model) } : null;

export function normalizeRouting(raw, fallback = null) {
  const source = safeObject(raw);
  const routes = {};
  for (const role of AI_ROLES) {
    const target = normalizeTarget(source.routes?.[role.id]);
    if (target) routes[role.id] = target;
  }
  return { version: 1, default: normalizeTarget(source.default) || normalizeTarget(fallback), routes };
}

function connectionOf(providerId, providers = {}) {
  const custom = safeObject(providers)[providerId];
  const preset = presetById(providerId);
  if (!custom && !preset) return null;
  return {
    id: providerId,
    name: custom?.name || preset?.name || providerId,
    baseURL: custom?.baseURL || preset?.baseURL || '',
    model: custom?.model || preset?.model || '',
    models: [...new Set([...(custom?.models || []), ...(preset?.models || []), custom?.model, preset?.model].filter(Boolean))],
    cards: [...new Set([...(custom?.cards || []), ...(preset?.cards || [])])],
  };
}

function parseKeys(raw) {
  try { return safeObject(typeof raw === 'string' ? JSON.parse(raw) : raw); }
  catch { return {}; }
}

async function readStore() {
  const [providerRows, routingRaw, keyRaw, legacyCfg, legacyApiKey, legacyPanelKey] = await Promise.all([
    window.mazz.invoke('settings:get', { key: PROVIDERS_KEY }).catch(() => null),
    window.mazz.invoke('settings:get', { key: ROUTING_KEY }).catch(() => null),
    window.mazz.invoke('secret:get', { key: KEYS_SECRET }).catch(() => null),
    window.mazz.invoke('settings:get', { key: CFG_KEY }).catch(() => null),
    window.mazz.invoke('secret:get', { key: LEGACY_SECRET_KEYS[0] }).catch(() => null),
    window.mazz.invoke('secret:get', { key: LEGACY_SECRET_KEYS[1] }).catch(() => null),
  ]);
  const providers = { ...safeObject(providerRows) };
  const keys = { ...parseKeys(keyRaw) };
  const legacy = safeObject(legacyCfg);
  let fallback = null, migrated = false;
  if (legacy.baseURL && legacy.model) {
    const providerId = legacy.providerId || inferProviderId(legacy.baseURL);
    const preset = presetById(providerId);
    providers[providerId] = {
      ...(providers[providerId] || {}), id: providerId,
      name: providers[providerId]?.name || preset?.name || (providerId === 'custom' ? '自定义端点' : providerId),
      baseURL: legacy.baseURL, model: legacy.model,
      models: [...new Set([...(providers[providerId]?.models || []), legacy.model])],
      cards: providers[providerId]?.cards || preset?.cards || [],
    };
    const legacyKey = legacyApiKey || legacyPanelKey || '';
    if (legacyKey && !keys[providerId]) keys[providerId] = legacyKey;
    fallback = { providerId, model: legacy.model };
    migrated = !providerRows || !keyRaw || !routingRaw;
  }
  const routing = normalizeRouting(routingRaw, fallback || { providerId: PRESETS[0].id, model: PRESETS[0].model });
  if (migrated) {
    await Promise.all([
      window.mazz.invoke('settings:set', { key: PROVIDERS_KEY, value: providers }).catch(() => {}),
      window.mazz.invoke('settings:set', { key: ROUTING_KEY, value: routing }).catch(() => {}),
      Object.keys(keys).length ? window.mazz.invoke('secret:set', { key: KEYS_SECRET, value: JSON.stringify(keys) }).catch(() => {}) : null,
    ]);
  }
  return { providers, keys, routing };
}

export function connectedProviderModels({ providers = {}, keys = {} } = {}) {
  const ids = new Set([...PRESETS.map(p => p.id), ...Object.keys(safeObject(providers))]);
  const rows = [];
  for (const providerId of ids) {
    const provider = connectionOf(providerId, providers);
    if (!provider?.baseURL || !keys[providerId]) continue;
    for (const model of provider.models.length ? provider.models : [provider.model]) {
      if (model) rows.push({ value: `${providerId}::${model}`, providerId, model, label: `${provider.name} · ${model}`, cards: provider.cards });
    }
  }
  return rows;
}

export function resolveProviderRoute({ role = '', routing, providers = {}, keys = {} } = {}) {
  const table = normalizeRouting(routing);
  const candidates = [role && table.routes[role], table.default].filter(Boolean);
  for (const target of candidates) {
    const provider = connectionOf(target.providerId, providers);
    const apiKey = keys[target.providerId] || '';
    if (provider?.baseURL && target.model && apiKey) {
      return { providerId: target.providerId, baseURL: provider.baseURL, model: target.model, apiKey, role: role || 'default' };
    }
  }
  const target = candidates[0] || table.default;
  const provider = target ? connectionOf(target.providerId, providers) : PRESETS[0];
  return { providerId: target?.providerId || provider?.id || '', baseURL: provider?.baseURL || '', model: target?.model || provider?.model || '', apiKey: '', role: role || 'default' };
}

export async function getProviderAdminSnapshot() {
  const state = await readStore();
  const connected = connectedProviderModels(state);
  const allIds = new Set([...PRESETS.map(p => p.id), ...Object.keys(state.providers)]);
  return {
    routing: state.routing,
    roles: AI_ROLES.map(role => ({ ...role, target: state.routing.routes[role.id] || null })),
    cards: PROVIDER_CARDS,
    connected,
    providers: [...allIds].map(id => {
      const provider = connectionOf(id, state.providers);
      return provider ? { ...provider, keySet: !!state.keys[id] } : null;
    }).filter(Boolean),
  };
}

export async function saveProviderConfig({ providerId, name, baseURL, model, models, cards, apiKey, makeDefault = true }) {
  if (!String(baseURL || '').trim() || !String(model || '').trim()) throw new Error('接口地址和模型不能为空');
  const state = await readStore();
  const id = providerId || inferProviderId(baseURL);
  const preset = presetById(id);
  state.providers[id] = {
    id, name: name || preset?.name || (id === 'custom' ? '自定义端点' : id), baseURL, model,
    models: [...new Set([...(models || []), model].filter(Boolean))], cards: cards || preset?.cards || [],
  };
  if (apiKey) state.keys[id] = apiKey;
  if (apiKey === null) delete state.keys[id];
  if (makeDefault) state.routing.default = { providerId: id, model };
  await Promise.all([
    window.mazz.invoke('settings:set', { key: PROVIDERS_KEY, value: state.providers }),
    window.mazz.invoke('settings:set', { key: ROUTING_KEY, value: state.routing }),
    window.mazz.invoke('secret:set', { key: KEYS_SECRET, value: JSON.stringify(state.keys) }),
    // 旧版读取口只镜像默认连接，密钥真相源仍是 factory.keys。
    makeDefault ? window.mazz.invoke('settings:set', { key: CFG_KEY, value: { providerId: id, baseURL, model } }) : null,
    makeDefault && state.keys[id] ? window.mazz.invoke('secret:set', { key: LEGACY_SECRET_KEYS[0], value: state.keys[id] }) : null,
  ]);
  return await getProviderAdminSnapshot();
}

export async function saveProviderRoute(role, target) {
  const state = await readStore();
  if (role === 'default') {
    const next = normalizeTarget(target);
    if (!next) throw new Error('全局默认必须指向已接入模型');
    state.routing.default = next;
  } else {
    if (!AI_ROLES.some(r => r.id === role)) throw new Error('未知 AI 岗位');
    const next = normalizeTarget(target);
    if (next) state.routing.routes[role] = next;
    else delete state.routing.routes[role];
  }
  const allowed = new Set(connectedProviderModels(state).map(x => x.value));
  const chosen = role === 'default' ? state.routing.default : state.routing.routes[role];
  if (chosen && !allowed.has(`${chosen.providerId}::${chosen.model}`)) throw new Error('只能指派已接入且有 Key 的模型');
  await window.mazz.invoke('settings:set', { key: ROUTING_KEY, value: state.routing });
  if (role === 'default') {
    const cfg = resolveProviderRoute(state);
    await Promise.all([
      window.mazz.invoke('settings:set', { key: CFG_KEY, value: { providerId: cfg.providerId, baseURL: cfg.baseURL, model: cfg.model } }),
      // 兼容仍直接读取旧 secret 名的扩展；新代码只认 factory.keys。
      cfg.apiKey ? window.mazz.invoke('secret:set', { key: LEGACY_SECRET_KEYS[0], value: cfg.apiKey }) : null,
    ]);
  }
  return await getProviderAdminSnapshot();
}

/** 拉取端点模型列表（GET /v1/models；失败返回 null 走预置选单） */
export async function fetchModels(cfg) {
  const url = String(cfg.baseURL || '').replace(/\/+$/, '') + '/models';
  try {
    let resp;
    if (window.mazz?.isElectron) {
      resp = await window.mazz.invoke('factory:aiModels', { baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    } else {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + cfg.apiKey } });
      if (!r.ok) return null;
      resp = await r.json();
    }
    const ids = (resp?.data || []).map(m => m.id).filter(Boolean);
    return ids.length ? ids : null;
  } catch { return null; }
}

export async function getProviderConfig(role = '') {
  return resolveProviderRoute({ ...(await readStore()), role });
}

export function providerReady(cfg) {
  return !!(cfg?.baseURL && cfg?.model && cfg?.apiKey);
}

/** Chat Completions（非流式；Electron 走主进程代理避开 CORS，网页桥直连） */
async function routedConfig(cfg, role = '') {
  const resolved = role ? await getProviderConfig(role) : (cfg || await getProviderConfig());
  if (!providerReady(resolved)) {
    const label = AI_ROLES.find(r => r.id === role)?.label || '全局默认';
    throw new Error(`${label}没有可用 AI：请到「AI 服务 → AI 分工」接入并指派模型`);
  }
  return resolved;
}

function aiRequestId(prefix = 'ai') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function abortError(reason = 'AI 请求已取消') {
  const error = new Error(String(reason || 'AI 请求已取消'));
  error.name = 'AbortError';
  return error;
}

function cancelRemote(requestId, reason) {
  return window.mazz?.invoke?.('factory:aiCancel', { requestId, reason }).catch(() => ({ cancelled: false }));
}

function invokeCancelable(channel, payload, signal) {
  if (!signal) return window.mazz.invoke(channel, payload);
  if (signal.aborted) return Promise.reject(abortError(signal.reason?.message || signal.reason));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      cancelRemote(payload.requestId, 'renderer-abort');
      finish(reject, abortError(signal.reason?.message || signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    window.mazz.invoke(channel, payload).then(
      value => finish(resolve, value),
      error => finish(reject, error),
    );
  });
}

function createAbortScope({ signal, timeoutMs, shouldStop } = {}) {
  const controller = new AbortController();
  let stopReason = '';
  const stop = reason => {
    if (controller.signal.aborted) return;
    stopReason = String(reason || 'cancelled');
    try { controller.abort(abortError(stopReason)); } catch { controller.abort(); }
  };
  const onAbort = () => stop(signal?.reason?.message || signal?.reason || 'renderer-abort');
  if (signal?.aborted) onAbort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => stop('timeout'), timeoutMs) : null;
  const poll = shouldStop ? setInterval(() => { if (shouldStop()) stop('stopped'); }, 75) : null;
  return {
    signal: controller.signal,
    get stopped() { return stopReason !== 'timeout' && !!stopReason; },
    stop,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      signal?.removeEventListener?.('abort', onAbort);
    },
  };
}

export async function chat({ cfg, role = '', system, user, temperature = 0.7, maxTokens = 8192, signal }) {
  cfg = await routedConfig(cfg, role);
  if (window.mazz?.isElectron) {
    const requestId = aiRequestId('chat');
    return await invokeCancelable('factory:aiChat', {
      requestId,
      baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model,
      system, user, temperature, maxTokens,
    }, signal);
  }
  return await chatDirect({ cfg, system, user, temperature, maxTokens, signal });
}

/** 网页预览直连（受目标 API CORS 限制，桌面端不走这里） */
async function chatDirect({ cfg, system, user, temperature = 0.7, maxTokens = 8192, signal }) {
  const url = cfg.baseURL.replace(/\/+$/, '') + '/v1/chat/completions';
  const scope = createAbortScope({ signal, timeoutMs: 180000 });
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: scope.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}：${text.slice(0, 300)}`);
    }
    const data = await resp.json();
    if (data.error) throw new Error('API 报错：' + String(data.error.message || JSON.stringify(data.error)).slice(0, 300));
    const m = data.choices?.[0]?.message || {};
    let content = typeof m.content === 'string' && m.content.trim() ? m.content
      : Array.isArray(m.content) ? m.content.map((p) => (typeof p === 'string' ? p : (p?.text || ''))).join('')
      : (m.reasoning_content || m.content || '');
    if (!content || !String(content).trim()) {
      throw new Error(`AI 返回为空（finish_reason=${data.choices?.[0]?.finish_reason || '未知'}；原始片段：${JSON.stringify(data).slice(0, 200)}）`);
    }
    return String(content).trim();
  } finally {
    scope.cleanup();
  }
}

/** Chat Completions 流式（SSE）：onChunk 逐 token 回调，返回全文；shouldStop() 返回 true 时中止 */
export async function chatStream({ cfg, role = '', system, user, temperature = 0.7, maxTokens = 8192, onChunk, shouldStop, signal }) {
  cfg = await routedConfig(cfg, role);
  if (window.mazz?.isElectron) {
    if (signal?.aborted || shouldStop?.()) return '';
    // 主进程代理流式：factory:aiChunk 事件逐 delta 推流
    const requestId = aiRequestId('stream');
    return await new Promise((resolve, reject) => {
      let full = '';
      let settled = false;
      let off = () => {};
      let poll = null;
      const cleanup = () => {
        off();
        if (poll) clearInterval(poll);
        signal?.removeEventListener?.('abort', onAbort);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const stop = reason => {
        cancelRemote(requestId, reason);
        finish(resolve, full.trim());
      };
      const onAbort = () => stop('renderer-abort');
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (shouldStop) poll = setInterval(() => { if (shouldStop()) stop('task-stop'); }, 75);
      off = window.mazz.on('factory:aiChunk', (payload) => {
        if (payload?.requestId !== requestId) return;
        if (payload.error) { finish(reject, new Error(payload.error)); return; }
        if (payload.done) {
          if (!full) finish(reject, new Error('AI 返回为空'));
          else finish(resolve, full.trim());
          return;
        }
        if (payload.delta) {
          if (signal?.aborted || shouldStop?.()) { stop('task-stop'); return; }
          full += payload.delta;
          onChunk?.(payload.delta, full);
        }
      });
      window.mazz.invoke('factory:aiChatStream', {
        requestId, baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model,
        system, user, temperature, maxTokens,
      }).then(result => {
        if (!settled && result?.ok === false) {
          if (result.cancelled && result.reason !== 'timeout') finish(resolve, full.trim());
          else if (result.reason === 'timeout') finish(reject, new Error('AI 流式请求超时'));
          else finish(reject, new Error('AI 流式请求失败'));
        }
      }).catch(error => finish(reject, error));
    });
  }
  return await chatStreamDirect({ cfg, system, user, temperature, maxTokens, onChunk, shouldStop, signal });
}

/** 网页预览直连流式 */
async function chatStreamDirect({ cfg, system, user, temperature = 0.7, maxTokens = 8192, onChunk, shouldStop, signal }) {
  const url = cfg.baseURL.replace(/\/+$/, '') + '/v1/chat/completions';
  const scope = createAbortScope({ signal, timeoutMs: 300000, shouldStop });
  let reader = null;
  let full = '';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        temperature, max_tokens: maxTokens, stream: true,
      }),
      signal: scope.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}：${text.slice(0, 300)}`);
    }
    reader = resp.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      if (scope.signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) { full += delta; onChunk?.(delta, full); }
        } catch { /* 半行 JSON 留到下轮 */ }
      }
    }
    if (scope.stopped) return full.trim();
    if (!full) throw new Error('AI 返回为空');
    return full.trim();
  } catch (error) {
    if (scope.stopped) return full.trim();
    throw error;
  } finally {
    if (scope.signal.aborted) { try { await reader?.cancel?.(); } catch {} }
    try { reader?.releaseLock?.(); } catch {}
    scope.cleanup();
  }
}

/** 多模态识别（vision）：图片 + 提示词 → 文本（OpenAI 兼容 vision 消息格式） */
export async function visionChat({ cfg, role = 'vision', prompt, imageDataUrl, temperature = 0.2, maxTokens = 4096, signal }) {
  cfg = await routedConfig(cfg, role);
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  }];
  if (window.mazz?.isElectron) {
    const requestId = aiRequestId('vision');
    return await invokeCancelable('factory:aiChat', {
      requestId,
      baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model,
      messages, temperature, maxTokens,
    }, signal);
  }
  // 网页桥直连
  const url = cfg.baseURL.replace(/\/+$/, '') + '/v1/chat/completions';
  const scope = createAbortScope({ signal, timeoutMs: 180000 });
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens, stream: false }),
      signal: scope.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}：${(await resp.text().catch(() => '')).slice(0, 300)}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 返回为空');
    return content.trim();
  } finally { scope.cleanup(); }
}

/** 竹筒倒豆子 → 字段智能填充（无 Provider 时退回基础启发式） */
export async function extractFields({ cfg, tpl, dump }) {
  if (providerReady(cfg)) {
    const schema = tpl.input_fields.map(f => `- ${f.id}（${f.label}${f.required ? '，必填' : ''}）`).join('\n');
    const sys = '你是需求分析助手。从用户的原始想法中提取要素，只输出 JSON 对象，键为字段 id，值为字符串。不确定的字段留空字符串。不要输出其他内容。';
    const usr = `字段清单：\n${schema}\n\n用户想法：\n${dump}`;
    const text = await chat({ cfg, role: 'blueprint', system: sys, user: usr, temperature: 0.2, maxTokens: 2000 });
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    throw new Error('智能填充解析失败，请手动填写');
  }
  // 启发式兜底：第一段短文本 → 第一个 text 字段；其余全部 → 第一个必填 textarea
  const out = {};
  const lines = dump.split('\n').map(l => l.trim()).filter(Boolean);
  const firstText = tpl.input_fields.find(f => f.type === 'text');
  const firstArea = tpl.input_fields.find(f => f.type === 'textarea' && f.required) || tpl.input_fields.find(f => f.type === 'textarea');
  if (firstText && lines[0] && lines[0].length <= 60) { out[firstText.id] = lines[0]; lines.shift(); }
  if (firstArea) out[firstArea.id] = lines.join('\n') || dump.trim();
  return out;
}
