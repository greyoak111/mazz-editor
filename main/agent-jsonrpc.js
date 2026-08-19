// main/agent-jsonrpc.js —— W66 ACP 逐行 JSON-RPC transport
'use strict';

class JsonRpcError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.details = details;
  }
}

class LineJsonRpcPeer {
  constructor({ write, onNotification = () => {}, onRequest = null, timeoutMs = 30000 } = {}) {
    if (typeof write !== 'function') throw new JsonRpcError('JSONRPC_WRITE_REQUIRED', 'JSON-RPC transport 缺少 write');
    this.write = write;
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.closed = false;
  }

  async send(value) {
    if (this.closed) throw new JsonRpcError('JSONRPC_CLOSED', 'JSON-RPC transport 已关闭');
    await this.write(`${JSON.stringify(value)}\n`);
  }

  async request(method, params = {}, timeoutMs = this.timeoutMs) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JsonRpcError('JSONRPC_TIMEOUT', `${method} 超时`));
      }, Math.max(100, Number(timeoutMs) || 0));
      this.pending.set(id, { resolve, reject, timer, method });
    });
    await this.send({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  async notify(method, params = {}) {
    await this.send({ jsonrpc: '2.0', method, params });
  }

  feed(chunk) {
    if (this.closed) return;
    this.buffer += String(chunk || '');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const row = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!row) continue;
      let message;
      try { message = JSON.parse(row); }
      catch { this.onNotification('transport/invalid_json', { byteLength: Buffer.byteLength(row) }); continue; }
      this.handle(message).catch(() => {});
    }
  }

  async handle(message) {
    if (message.id != null && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new JsonRpcError(String(message.error.code || 'JSONRPC_REMOTE_ERROR'), String(message.error.message || '远端 JSON-RPC 错误'), message.error.data));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && message.id != null) {
      try {
        if (typeof this.onRequest !== 'function') throw new JsonRpcError('JSONRPC_METHOD_NOT_SUPPORTED', `不支持反向请求: ${message.method}`);
        const result = await this.onRequest(message.method, message.params || {});
        await this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
      } catch (error) {
        await this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: String(error?.message || error) } });
      }
      return;
    }
    if (message.method) this.onNotification(message.method, message.params || {});
  }

  close(error = new JsonRpcError('JSONRPC_CLOSED', 'JSON-RPC transport 已关闭')) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

module.exports = { JsonRpcError, LineJsonRpcPeer };
