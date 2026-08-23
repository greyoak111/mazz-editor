// main/factory-sse.js —— Factory OpenAI-compatible SSE 增量解码与完整性判定
'use strict';

const MAX_SSE_LINE_CHARS = 2 * 1024 * 1024;

// DeepSeek v4 enables thinking by default.  For the professional Factory seats
// the requested artifact is already a tightly-scoped final manuscript or JSON
// decision. Leaving implicit thinking enabled can spend the provider's output
// window in reasoning_content and return finish_reason=length with empty
// content. Keep
// the policy deliberately narrow so ordinary chat/research calls retain the
// provider default, while every governed Factory seat gets a direct final
// answer.  reasoning_content remains private and is never used as a fallback.
const FACTORY_DIRECT_OUTPUT_ROLES = new Set([
  'factory_skeleton',
  'factory_writer',
  'factory_point',
  'factory_review_a',
  'factory_review_b',
  'factory_arbiter',
  'factory_polish',
]);

const isDeepSeekV4Connection = ({ providerId = '', baseURL = '', model = '' } = {}) => {
  const provider = String(providerId || '').trim().toLowerCase();
  const url = String(baseURL || '').trim().toLowerCase();
  const modelId = String(model || '').trim().toLowerCase();
  let officialOrigin = false;
  try { officialOrigin = new URL(url).origin === 'https://api.deepseek.com'; } catch {}
  return provider === 'deepseek'
    && officialOrigin
    && /^deepseek-v4(?:-|$)/.test(modelId);
};

const factoryProviderGenerationOptions = ({ providerId = '', baseURL = '', model = '', role = '' } = {}) => {
  const roleId = String(role || '').trim();
  if (!FACTORY_DIRECT_OUTPUT_ROLES.has(roleId)) return {};
  if (!isDeepSeekV4Connection({ providerId, baseURL, model })) return {};
  return { thinking: { type: 'disabled' } };
};

const normalizeFinishReason = (value) => {
  if (value == null) return null;
  const reason = String(value).trim();
  return reason || null;
};

/**
 * Fail-closed completion classifier shared by the main-process SSE decoder and
 * renderer contracts. A provider's explicit stop or a bare protocol DONE marker
 * is committable; truncation, filtering, null final reasons and interruption are
 * never promoted to a finished artifact.
 */
const classifyFactoryCompletion = ({ finishReason = null, completionKind = '', interrupted = false } = {}) => {
  const reason = normalizeFinishReason(finishReason);
  const kind = String(completionKind || '').trim().toLowerCase();
  if (interrupted || kind === 'interrupted' || kind === 'transport-end') {
    return { safeToCommit: false, reason: 'interrupted' };
  }
  if (reason != null) {
    if (reason.toLowerCase() === 'stop') return { safeToCommit: true, reason: 'stop' };
    return { safeToCommit: false, reason: reason.toLowerCase() };
  }
  if (kind.includes('null-finish-reason')) {
    return { safeToCommit: false, reason: 'null-finish-reason' };
  }
  if (kind === 'done-marker') return { safeToCommit: true, reason: 'done-marker' };
  return { safeToCommit: false, reason: 'missing-finish-reason' };
};

/** Join an OpenAI-compatible endpoint without ever duplicating an existing API version. */
const joinFactoryAiEndpoint = (baseURL, endpoint = 'chat/completions') => {
  const base = String(baseURL || '').trim().replace(/\/+$/, '');
  const suffix = String(endpoint || '').trim().replace(/^\/+/, '');
  if (!base) return '';
  if (!suffix) return base;
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`/${escapedSuffix}$`, 'i').test(base)) return base;
  if (/\/v(?:\d+|1beta)(?:\/openai)?$/i.test(base)) return `${base}/${suffix}`;
  return `${base}/v1/${suffix}`;
};

/** Normalize provider-specific model payloads to the OpenAI list envelope. */
const normalizeFactoryModelsResponse = (raw) => {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.models)
        ? raw.models
        : [];
  const seen = new Set();
  const data = [];
  for (const row of rows) {
    const rawId = typeof row === 'string' ? row : (row?.id ?? row?.name ?? row?.model);
    const id = String(rawId || '').trim().replace(/^models\//i, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    data.push({ ...(row && typeof row === 'object' && !Array.isArray(row) ? row : {}), id, object: row?.object || 'model' });
  }
  return { object: 'list', data };
};

const extractText = (message) => {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      return typeof part?.text === 'string' ? part.text : '';
    }).join('');
  }
  // Reasoning models expose private scratch work separately from the final
  // assistant content.  It is never an artifact fallback: mixing it into the
  // manuscript leaks chain-of-thought and invalidates the model-native length
  // declaration used by the Factory commit gate.
  return '';
};

class FactorySseDecoder {
  constructor({ onDelta = () => {}, onUsage = () => {} } = {}) {
    this.onDelta = onDelta;
    this.onUsage = onUsage;
    this.decoder = new TextDecoder('utf-8');
    this.buffer = '';
    this.completed = false;
    this.completionKind = '';
    this.finishReason = null;
    this.unsafeFinishReason = null;
    this.sawFinishReasonField = false;
    this.sawDoneMarker = false;
    this.deltaCount = 0;
    this.usage = null;
  }

  push(chunk) {
    if (chunk == null) return this.snapshot();
    this.buffer += typeof chunk === 'string'
      ? chunk
      : this.decoder.decode(chunk, { stream: true });
    if (this.buffer.length > MAX_SSE_LINE_CHARS && !/[\r\n]/.test(this.buffer)) {
      this.buffer = '';
      throw new Error('AI 流式响应单行超过 2 MiB 上限');
    }
    this._drainLines();
    return this.snapshot();
  }

  finish() {
    this.buffer += this.decoder.decode();
    this._drainLines();
    if (this.buffer.length) {
      const trailing = this.buffer;
      this.buffer = '';
      this._processLine(trailing);
    }
    if (!this.completed) {
      throw new Error('AI 流式响应意外中断（未收到完成标记）');
    }
    return this.snapshot();
  }

  snapshot() {
    const classified = classifyFactoryCompletion({
      finishReason: this.unsafeFinishReason || this.finishReason,
      completionKind: this.completionKind,
    });
    return {
      completed: this.completed,
      completionKind: this.completionKind,
      finishReason: this.unsafeFinishReason || this.finishReason,
      deltaCount: this.deltaCount,
      usage: this.usage,
      // A native stop without any string delta is metadata, not an artifact.
      safeToCommit: this.deltaCount > 0 && classified.safeToCommit,
    };
  }

  _drainLines() {
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) this._processLine(line);
  }

  _processLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      this.completed = true;
      this.sawDoneMarker = true;
      if (this.finishReason != null) this.completionKind = 'finish-reason+done-marker';
      else this.completionKind = this.sawFinishReasonField ? 'null-finish-reason+done-marker' : 'done-marker';
      return;
    }

    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error('AI 流式响应包含损坏的 SSE JSON');
    }
    if (data?.error) {
      const message = data.error.message || data.error.type || '未知错误';
      throw new Error(`AI 流式响应报错：${String(message).slice(0, 300)}`);
    }
    const choice = data?.choices?.[0];
    if (data?.usage && typeof data.usage === 'object') {
      const inputTokens = Math.max(0, Number(data.usage.prompt_tokens ?? data.usage.input_tokens) || 0);
      const outputTokens = Math.max(0, Number(data.usage.completion_tokens ?? data.usage.output_tokens) || 0);
      const totalTokens = Math.max(0, Number(data.usage.total_tokens) || inputTokens + outputTokens);
      if (totalTokens) {
        this.usage = { inputTokens, outputTokens, totalTokens };
        this.onUsage(this.usage);
      }
    }
    const delta = extractText(choice?.delta);
    if (delta) {
      this.deltaCount++;
      this.onDelta(delta);
    }
    if (choice && Object.prototype.hasOwnProperty.call(choice, 'finish_reason')) {
      this.sawFinishReasonField = true;
      const finishReason = normalizeFinishReason(choice.finish_reason);
      if (finishReason != null) {
        if (finishReason.toLowerCase() !== 'stop' && this.unsafeFinishReason == null) {
          this.unsafeFinishReason = finishReason;
        }
        this.finishReason = this.unsafeFinishReason || finishReason;
        this.completed = true;
        this.completionKind = this.sawDoneMarker ? 'finish-reason+done-marker' : 'finish-reason';
      }
    }
  }
}

module.exports = {
  FactorySseDecoder,
  MAX_SSE_LINE_CHARS,
  FACTORY_DIRECT_OUTPUT_ROLES,
  isDeepSeekV4Connection,
  factoryProviderGenerationOptions,
  extractText,
  classifyFactoryCompletion,
  joinFactoryAiEndpoint,
  normalizeFactoryModelsResponse,
};
