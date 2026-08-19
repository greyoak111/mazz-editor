// main/factory-sse.js —— Factory OpenAI-compatible SSE 增量解码与完整性判定
'use strict';

const MAX_SSE_LINE_CHARS = 2 * 1024 * 1024;

const extractText = (message) => {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : (part?.text || ''))).join('');
  }
  return typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
};

class FactorySseDecoder {
  constructor({ onDelta = () => {}, onUsage = () => {} } = {}) {
    this.onDelta = onDelta;
    this.onUsage = onUsage;
    this.decoder = new TextDecoder('utf-8');
    this.buffer = '';
    this.completed = false;
    this.completionKind = '';
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
    return {
      completed: this.completed,
      completionKind: this.completionKind,
      deltaCount: this.deltaCount,
      usage: this.usage,
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
      this.completionKind = 'done-marker';
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
    if (choice && choice.finish_reason != null) {
      this.completed = true;
      if (!this.completionKind) this.completionKind = 'finish-reason';
    }
  }
}

module.exports = { FactorySseDecoder, MAX_SSE_LINE_CHARS, extractText };
