// main/factory-sse.js —— Factory OpenAI-compatible SSE 增量解码与完整性判定
'use strict';

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
  constructor({ onDelta = () => {} } = {}) {
    this.onDelta = onDelta;
    this.decoder = new TextDecoder('utf-8');
    this.buffer = '';
    this.completed = false;
    this.completionKind = '';
    this.deltaCount = 0;
  }

  push(chunk) {
    if (chunk == null) return this.snapshot();
    this.buffer += typeof chunk === 'string'
      ? chunk
      : this.decoder.decode(chunk, { stream: true });
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

module.exports = { FactorySseDecoder, extractText };
