// main/adapters/kimi-code-adapter.js —— W66-R2 Kimi Code ACP Adapter
'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const { LineJsonRpcPeer } = require('../agent-jsonrpc');
const {
  adapterError, requireRulePack, composeInstruction, sessionHandle, assertSession,
  eventHub, redactedRawMetadata,
  installedNativeExecutable,
} = require('../agent-adapter-common');

function acpEvent(update = {}) {
  const kind = String(update.sessionUpdate || update.type || update.kind || 'unknown');
  const content = update.content || update.message?.content || {};
  const text = typeof content === 'string' ? content : String(content.text || update.text || '');
  if (/agent_message|message_chunk/i.test(kind)) return ['message', { role: 'assistant', text }];
  if (/thought|plan/i.test(kind)) return ['progress', { kind, text }];
  if (/tool_call/i.test(kind)) return ['tool', { kind, title: String(update.title || update.name || ''), status: String(update.status || '') }];
  if (/usage/i.test(kind)) return ['usage', { inputTokens: Number(update.inputTokens || 0), outputTokens: Number(update.outputTokens || 0) }];
  return ['progress', { kind, text }];
}

class KimiCodeAdapter {
  constructor({ supervisor, executablePath = '', launchArgs = ['acp'], idFactory = randomUUID, approvalResolver = null } = {}) {
    if (!supervisor) throw new Error('KimiCodeAdapter 需要 CliSupervisor');
    this.id = 'kimi-code';
    this.displayName = 'Kimi Code';
    this.supervisor = supervisor;
    this.executablePath = executablePath || installedNativeExecutable(this.id);
    this.launchArgs = [...launchArgs];
    this.idFactory = idFactory;
    this.approvalResolver = approvalResolver;
    this.sessions = new Map();
    this.detection = null;
  }

  descriptor() {
    return { transport: 'ACP/stdio JSON-RPC', minimumVersion: 'current official Kimi Code', modelControl: 'ACP config option when advertised', permissionControl: 'ACP request_permission', resume: 'ACP session/load', structuredOutput: true, health: 'detect + initialize' };
  }

  async capabilities() {
    return { workspace: true, fileEdit: true, terminal: true, toolUse: true, imageInput: true, resume: true, checkpoint: true, approval: true, computerUse: false, structuredOutput: true };
  }

  async detect() {
    this.detection = await this.supervisor.detect({ id: this.id, names: this.executablePath ? [] : ['kimi', 'kimi-code'], explicitPaths: this.executablePath ? [this.executablePath] : [], versionArgs: ['--version'] });
    return this.detection;
  }

  async openProcess({ owner = 'kimi-code:acp', cwd = process.cwd(), eventHub: hub = null } = {}) {
    const detection = this.detection?.available ? this.detection : await this.detect();
    if (!detection.available) throw adapterError(detection.reason || 'CLI_NOT_INSTALLED', 'Kimi Code CLI 不可用');
    let peer;
    const processHandle = await this.supervisor.start({
      command: detection.command,
      args: this.launchArgs,
      cwd,
      keepStdinOpen: true,
      timeoutMs: 0,
      owner,
      onStdout: chunk => peer?.feed(chunk),
      onStderr: chunk => hub?.emit('stderr', { text: String(chunk) }),
    });
    peer = new LineJsonRpcPeer({
      write: value => this.supervisor.write(processHandle, value),
      onNotification: (method, params) => {
        if (method === 'session/update') {
          const [type, payload] = acpEvent(params.update || params);
          hub?.emit(type, payload, redactedRawMetadata({ method, ...(params.update || {}) }));
        } else if (method === 'transport/invalid_json') hub?.emit('warning', { code: 'ACP_INVALID_JSON', ...params });
      },
      onRequest: async (method, params) => {
        if (method !== 'session/request_permission') throw adapterError('ACP_REVERSE_METHOD_DENIED', `未授权的 ACP 反向调用: ${method}`);
        const request = { sessionId: String(params.sessionId || ''), toolCallId: String(params.toolCall?.toolCallId || params.toolCallId || ''), options: Array.isArray(params.options) ? params.options : [] };
        hub?.emit('approval', { status: 'requested', ...request });
        const selected = typeof this.approvalResolver === 'function' ? await this.approvalResolver(request) : null;
        const option = request.options.find(row => String(row.optionId || row.id) === String(selected || '')) || request.options.find(row => /reject|deny/i.test(String(row.kind || row.name || '')));
        if (!option) return { outcome: { outcome: 'cancelled' } };
        return { outcome: { outcome: 'selected', optionId: String(option.optionId || option.id) } };
      },
    });
    this.supervisor.wait(processHandle).then(run => peer.close(adapterError(run.result.error?.code || 'ACP_PROCESS_EXITED', 'Kimi ACP 进程已退出'))).catch(error => peer.close(error));
    const initialized = await peer.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'Mazz Editor', version: '0.2.0' },
    });
    return { processHandle, peer, initialized };
  }

  async probe() {
    const opened = await this.openProcess({ owner: 'kimi-code:probe' });
    try {
      const authMethods = Array.isArray(opened.initialized?.authMethods) ? opened.initialized.authMethods : [];
      return { ok: true, protocolVersion: opened.initialized?.protocolVersion ?? 1, auth: { status: authMethods.length ? 'unknown' : 'authenticated', methods: authMethods.map(row => String(row.id || row.name || '')) }, descriptor: this.descriptor() };
    } finally {
      opened.peer.close();
      await this.supervisor.terminate(opened.processHandle, 'probe-complete').catch(() => {});
      await this.supervisor.wait(opened.processHandle).catch(() => {});
    }
  }

  async createSession(input = {}) {
    requireRulePack(input);
    const workspace = path.resolve(String(input.workspace || process.cwd()));
    const hub = eventHub();
    const opened = await this.openProcess({ cwd: workspace, eventHub: hub });
    try {
      const vendorResumeId = String(input.context?.vendorSessionId || input.modelTarget?.resumeSessionId || '');
      const sessionResult = vendorResumeId
        ? await opened.peer.request('session/load', { sessionId: vendorResumeId, cwd: workspace, mcpServers: [] })
        : await opened.peer.request('session/new', { cwd: workspace, mcpServers: [] });
      const vendorSessionId = String(sessionResult?.sessionId || vendorResumeId || '');
      if (!vendorSessionId) throw adapterError('ACP_SESSION_ID_MISSING', 'Kimi ACP 未返回 sessionId');
      const requestedModel = String(input.modelTarget?.requestedModel || input.modelTarget?.resolvedModel || '').trim();
      const configOptions = Array.isArray(sessionResult?.configOptions) ? sessionResult.configOptions : [];
      const modelOption = configOptions.find(option => /model/i.test(String(option.id || option.configId || option.name || '')));
      if (requestedModel && modelOption) {
        await opened.peer.request('session/set_config_option', { sessionId: vendorSessionId, configId: String(modelOption.id || modelOption.configId), value: requestedModel });
      }
      const id = String(this.idFactory());
      const handle = sessionHandle(id, this.id, { vendorSessionId, transport: 'acp' });
      this.sessions.set(id, {
        handle, hub, ...opened, input, vendorSessionId,
        activePrompt: false, cancelRequested: false,
        resolvedModel: requestedModel || String(modelOption?.currentValue || ''),
      });
      return handle;
    } catch (error) {
      opened.peer.close();
      await this.supervisor.terminate(opened.processHandle, 'session-create-failed').catch(() => {});
      await this.supervisor.wait(opened.processHandle).catch(() => {});
      throw error;
    }
  }

  session(handle, action) {
    assertSession(handle, this.id, action);
    const row = this.sessions.get(handle.id);
    if (!row) throw adapterError('ADAPTER_SESSION_NOT_FOUND', 'Kimi Session 不存在');
    return row;
  }

  async send(handle, input) {
    const row = this.session(handle, 'send');
    if (row.activePrompt) throw adapterError('ADAPTER_TURN_IN_FLIGHT', 'Kimi 当前仍有 turn 在执行');
    row.activePrompt = true;
    row.cancelRequested = false;
    row.hub.emit('state', { state: 'running' });
    try {
      const text = composeInstruction(row.input, typeof input === 'string' ? input : input?.text || '');
      const result = await row.peer.request('session/prompt', { sessionId: row.vendorSessionId, prompt: [{ type: 'text', text }] }, 0x7fffffff);
      if (row.cancelRequested || /cancel/i.test(String(result?.stopReason || ''))) {
        throw adapterError('CLI_CANCELLED', 'Kimi turn 已取消');
      }
      row.hub.emit('result', { stopReason: String(result?.stopReason || 'end_turn'), complete: true });
      row.hub.emit('state', { state: 'waiting' });
      return { accepted: true, stopReason: String(result?.stopReason || 'end_turn') };
    } finally { row.activePrompt = false; }
  }

  async interrupt(handle) {
    const row = this.session(handle, 'interrupt');
    row.cancelRequested = true;
    await row.peer.notify('session/cancel', { sessionId: row.vendorSessionId });
    row.hub.emit('completed', { status: 'cancelled' });
    return true;
  }

  async dispose(handle) {
    const row = this.session(handle, 'dispose');
    row.peer.close();
    await this.supervisor.terminate(row.processHandle, 'session-dispose').catch(() => {});
    await this.supervisor.wait(row.processHandle).catch(() => {});
    row.hub.clear();
    this.sessions.delete(handle.id);
    return true;
  }

  async events(handle, listener) {
    const row = this.session(handle, 'events');
    return row.hub.subscribe(listener);
  }
}

module.exports = { KimiCodeAdapter, acpEvent };
