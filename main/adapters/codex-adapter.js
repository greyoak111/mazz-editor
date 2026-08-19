// main/adapters/codex-adapter.js —— W66-R4 Codex exec --json Adapter
'use strict';

const { StreamCliAdapter } = require('./stream-cli-adapter');
const { installedNativeExecutable } = require('../agent-adapter-common');

class CodexAdapter extends StreamCliAdapter {
  constructor(options = {}) {
    super({ id: 'codex', displayName: 'Codex', names: ['codex'], versionArgs: ['--version'], authArgs: ['login', 'status'], executablePath: options.executablePath || installedNativeExecutable('codex'), ...options });
  }

  descriptor() {
    return { transport: 'codex exec --json', minimumVersion: 'current official Codex CLI', modelControl: '--model', permissionControl: '--sandbox + --ask-for-approval', resume: 'codex exec resume', structuredOutput: true, health: 'detect + login status' };
  }

  buildArgs(row) {
    const model = String(row.input.modelTarget?.requestedModel || row.input.modelTarget?.resolvedModel || '').trim();
    const sandbox = /read-only|restricted/i.test(String(row.input.permissionProfileRef || '')) ? 'read-only' : 'workspace-write';
    const common = ['--json', '--ignore-user-config', '--ignore-rules'];
    if (model) common.push('--model', model);
    if (row.vendorSessionId) return ['exec', 'resume', ...common, row.vendorSessionId, '-'];
    return ['exec', ...common, '--sandbox', sandbox, '-'];
  }

  parseEvent(value, row) {
    const type = String(value.type || '');
    if (type === 'thread.started') {
      row.vendorSessionId = String(value.thread_id || row.vendorSessionId || '');
      return ['started', { vendorSessionId: row.vendorSessionId }];
    }
    if (type === 'item.completed' || type === 'item.started' || type === 'item.updated') {
      const item = value.item || {};
      if (item.type === 'agent_message') return ['message', { role: 'assistant', text: String(item.text || '') }];
      return ['tool', { kind: String(item.type || 'item'), status: type.split('.')[1], toolCallId: String(item.id || '') }];
    }
    if (type === 'turn.completed') {
      const usage = value.usage || {};
      return ['usage', { inputTokens: Number(usage.input_tokens || 0), outputTokens: Number(usage.output_tokens || 0), cachedInputTokens: Number(usage.cached_input_tokens || 0) }];
    }
    if (type === 'error' || type === 'turn.failed') return ['error', { code: 'CODEX_VENDOR_ERROR', message: String(value.message || value.error?.message || 'Codex turn 失败'), terminal: false }];
    if (type === 'transport.invalid_json') return ['warning', { code: 'CODEX_INVALID_JSON', byteLength: value.byteLength }];
    return null;
  }
}

module.exports = { CodexAdapter };
