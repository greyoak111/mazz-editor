// renderer/modules/factory/provider.js —— AI Provider：OpenAI 兼容端点（DeepSeek/Kimi/OpenAI/Ollama）
// Key 用 safeStorage 加密落盘（secret 通道），配置在 settings，Key 不明文存储
const CFG_KEY = 'factory.provider';
const SECRET_KEY = 'factory.apiKey';

/** 主流 AI 服务商预置（2026 版库：国内外前排厂商全收编，模型选单 + /v1/models 自动拉取） */
export const PRESETS = [
  // —— 国内 ——
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  { id: 'kimi', name: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn', model: 'kimi-k3', models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'moonshot-v1-128k'] },
  { id: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2', models: ['glm-5.2', 'glm-5.2-fast-preview', 'glm-5.1', 'glm-5', 'glm-5v-turbo', 'glm-4.7'] },
  { id: 'qwen', name: '阿里通义 Qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen3.8-max-preview', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.6-flash', 'qwen-max', 'qwen-turbo', 'qwen-vl-max'] },
  { id: 'doubao', name: '字节豆包', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1.6', models: ['doubao-seed-1.6', 'doubao-seed-1.6-flash', 'doubao-seed-2.0-pro', 'doubao-vision-pro-32k'] },
  { id: 'minimax', name: 'MiniMax', baseURL: 'https://api.minimax.chat/v1', model: 'MiniMax-M3', models: ['MiniMax-M3', 'MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat'] },
  { id: 'spark', name: '讯飞星火', baseURL: 'https://spark-api-open.xf-yun.com/v1', model: 'generalv3.5', models: ['generalv3.5', 'generalv3', '4.0Ultra'] },
  { id: 'baidu', name: '百度文心', baseURL: 'https://qianfan.baidubce.com/v2', model: 'ernie-4.0-turbo-8k', models: ['ernie-4.0-turbo-8k', 'ernie-speed-128k', 'ernie-lite-8k'] },
  { id: 'stepfun', name: '阶跃星辰', baseURL: 'https://api.stepfun.com/v1', model: 'step-2-16k', models: ['step-2-16k', 'step-1-128k', 'step-1v-32k'] },
  { id: 'hunyuan', name: '腾讯混元', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-hy3', models: ['hunyuan-hy3', 'hunyuan-turbo', 'hunyuan-pro', 'hunyuan-lite'] },
  // —— 国外 ——
  { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com', model: 'gpt-5.5', models: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'] },
  { id: 'anthropic', name: 'Anthropic（OpenAI 兼容网关）', baseURL: 'https://api.anthropic.com/v1', model: 'claude-opus-4.8', models: ['claude-fable-5', 'claude-opus-4.8', 'claude-opus-4.7', 'claude-sonnet-5', 'claude-opus-4.6'] },
  { id: 'gemini', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] },
  { id: 'xai', name: 'xAI Grok', baseURL: 'https://api.x.ai/v1', model: 'grok-4.5', models: ['grok-4.5', 'grok-4', 'grok-3', 'grok-3-mini'] },
  { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b'] },
  { id: 'openrouter', name: 'OpenRouter（聚合）', baseURL: 'https://openrouter.ai/api/v1', model: 'auto', models: ['auto'] },
  { id: 'siliconflow', name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct', models: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3', 'Pro/deepseek-ai/DeepSeek-R1'] },
  { id: 'ollama', name: 'Ollama（本地）', baseURL: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', models: ['qwen2.5:7b', 'llama3.1:8b', 'deepseek-r1:7b'] },
  { id: 'custom', name: '自定义端点', baseURL: '', model: '', models: [] },
];

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

export async function getProviderConfig() {
  const cfg = (await window.mazz.invoke('settings:get', { key: CFG_KEY }).catch(() => null)) || null;
  const key = (await window.mazz.invoke('secret:get', { key: SECRET_KEY }).catch(() => null)) || '';
  return cfg ? { ...cfg, apiKey: key } : { ...PRESETS[0], apiKey: key };
}

export async function saveProviderConfig({ baseURL, model, apiKey }) {
  await window.mazz.invoke('settings:set', { key: CFG_KEY, value: { baseURL, model } });
  await window.mazz.invoke('secret:set', { key: SECRET_KEY, value: apiKey || '' });
  return true;
}

export function providerReady(cfg) {
  return !!(cfg?.baseURL && cfg?.model && cfg?.apiKey);
}

/** Chat Completions（非流式；Electron 走主进程代理避开 CORS，网页桥直连） */
export async function chat({ cfg, system, user, temperature = 0.7, maxTokens = 8192 }) {
  if (window.mazz?.isElectron) {
    return await window.mazz.invoke('factory:aiChat', {
      baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model,
      system, user, temperature, maxTokens,
    });
  }
  return await chatDirect({ cfg, system, user, temperature, maxTokens });
}

/** 网页预览直连（受目标 API CORS 限制，桌面端不走这里） */
async function chatDirect({ cfg, system, user, temperature = 0.7, maxTokens = 8192 }) {
  const url = cfg.baseURL.replace(/\/+$/, '') + '/v1/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
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
      signal: ctrl.signal,
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
    clearTimeout(timer);
  }
}

/** Chat Completions 流式（SSE）：onChunk 逐 token 回调，返回全文；shouldStop() 返回 true 时中止 */
export async function chatStream({ cfg, system, user, temperature = 0.7, maxTokens = 8192, onChunk, shouldStop }) {
  if (window.mazz?.isElectron) {
    // 主进程代理流式：factory:aiChunk 事件逐 delta 推流
    const requestId = 'ai' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return await new Promise((resolve, reject) => {
      let full = '';
      const off = window.mazz.on('factory:aiChunk', (payload) => {
        if (payload?.requestId !== requestId) return;
        if (payload.error) { off(); reject(new Error(payload.error)); return; }
        if (payload.done) {
          off();
          if (!full) reject(new Error('AI 返回为空'));
          else resolve(full.trim());
          return;
        }
        if (payload.delta) {
          if (shouldStop?.()) { off(); resolve(full.trim()); return; }
          full += payload.delta;
          onChunk?.(payload.delta, full);
        }
      });
      window.mazz.invoke('factory:aiChatStream', {
        requestId, baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model,
        system, user, temperature, maxTokens,
      }).catch((e) => { off(); reject(e); });
    });
  }
  return await chatStreamDirect({ cfg, system, user, temperature, maxTokens, onChunk, shouldStop });
}

/** 网页预览直连流式 */
async function chatStreamDirect({ cfg, system, user, temperature = 0.7, maxTokens = 8192, onChunk, shouldStop }) {
  const url = cfg.baseURL.replace(/\/+$/, '') + '/v1/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
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
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}：${text.slice(0, 300)}`);
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '', full = '';
    for (;;) {
      if (shouldStop?.()) { try { await reader.cancel(); } catch {} break; }
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
    if (!full) throw new Error('AI 返回为空');
    return full.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** 多模态识别（vision）：图片 + 提示词 → 文本（OpenAI 兼容 vision 消息格式） */
export async function visionChat({ cfg, prompt, imageDataUrl, temperature = 0.2, maxTokens = 4096 }) {
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  }];
  if (window.mazz?.isElectron) {
    return await window.mazz.invoke('factory:aiChat', {
      baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model,
      messages, temperature, maxTokens,
    });
  }
  // 网页桥直连
  const url = cfg.baseURL.replace(/\/+$/, '') + '/v1/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens, stream: false }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}：${(await resp.text().catch(() => '')).slice(0, 300)}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回为空');
  return content.trim();
}

/** 竹筒倒豆子 → 字段智能填充（无 Provider 时退回基础启发式） */
export async function extractFields({ cfg, tpl, dump }) {
  if (providerReady(cfg)) {
    const schema = tpl.input_fields.map(f => `- ${f.id}（${f.label}${f.required ? '，必填' : ''}）`).join('\n');
    const sys = '你是需求分析助手。从用户的原始想法中提取要素，只输出 JSON 对象，键为字段 id，值为字符串。不确定的字段留空字符串。不要输出其他内容。';
    const usr = `字段清单：\n${schema}\n\n用户想法：\n${dump}`;
    const text = await chat({ cfg, system: sys, user: usr, temperature: 0.2, maxTokens: 2000 });
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
