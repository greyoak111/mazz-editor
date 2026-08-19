// main/adapters/claude-code-adapter.js —— W66-R3 Claude Code stream-json Adapter
'use strict';

const { StreamCliAdapter } = require('./stream-cli-adapter');
const { installedNativeExecutable } = require('../agent-adapter-common');

class ClaudeCodeAdapter extends StreamCliAdapter {
  constructor(options = {}) {
    super({ id: 'claude-code', displayName: 'Claude Code', names: ['claude'], versionArgs: ['--version'], authArgs: ['auth', 'status'], executablePath: options.executablePath || installedNativeExecutable('claude-code'), ...options });
  }

  descriptor() {
    return { transport: 'claude -p stream-json', minimumVersion: 'current official Claude Code', modelControl: '--model', permissionControl: '--permission-mode + user-only settings', resume: '--resume', structuredOutput: true, health: 'detect + auth status' };
  }

  buildArgs(row) {
    const model = String(row.input.modelTarget?.requestedModel || row.input.modelTarget?.resolvedModel || '').trim();
    const permission = /accept-edits/i.test(String(row.input.permissionProfileRef || '')) ? 'acceptEdits' : 'default';
    const args = ['-p', '--input-format', 'text', '--output-format', 'stream-json', '--verbose', '--permission-mode', permission, '--setting-sources', 'user'];
    if (model) args.push('--model', model);
    if (row.vendorSessionId) args.push('--resume', row.vendorSessionId);
    else args.push('--session-id', row.handle.id);
    return args;
  }

  parseEvent(value, row) {
    const type = String(value.type || '');
    if (type === 'system' && value.subtype === 'init') {
      row.vendorSessionId = String(value.session_id || row.vendorSessionId || '');
      return ['started', { vendorSessionId: row.vendorSessionId, model: String(value.model || '') }];
    }
    if (type === 'assistant') {
      const blocks = Array.isArray(value.message?.content) ? value.message.content : [];
      return blocks.map(block => block.type === 'tool_use'
        ? ['tool', { kind: 'tool_use', name: String(block.name || ''), toolCallId: String(block.id || '') }]
        : ['message', { role: 'assistant', text: String(block.text || '') }]);
    }
    if (type === 'result') {
      row.vendorSessionId = String(value.session_id || row.vendorSessionId || '');
      const usage = value.usage || {};
      return [['usage', { inputTokens: Number(usage.input_tokens || 0), outputTokens: Number(usage.output_tokens || 0) }], ['progress', { kind: 'vendor-result', subtype: String(value.subtype || '') }]];
    }
    if (type === 'transport.invalid_json') return ['warning', { code: 'CLAUDE_INVALID_JSON', byteLength: value.byteLength }];
    return null;
  }
}

module.exports = { ClaudeCodeAdapter };
