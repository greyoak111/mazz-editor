// main/adapters/stream-cli-adapter.js —— W66-R3/R4 非交互 JSONL CLI Adapter 基座
'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const {
  adapterError, requireRulePack, composeInstruction, sessionHandle, assertSession,
  eventHub, resultFromRun, redactedRawMetadata,
} = require('../agent-adapter-common');

class JsonLineDecoder {
  constructor(onValue) { this.buffer = ''; this.onValue = onValue; }
  feed(chunk) {
    this.buffer += String(chunk || '');
    let at;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const row = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!row) continue;
      try { this.onValue(JSON.parse(row)); }
      catch { this.onValue({ type: 'transport.invalid_json', byteLength: Buffer.byteLength(row) }); }
    }
  }
}

class StreamCliAdapter {
  constructor({ id, displayName, supervisor, names, executablePath = '', commandPrefix = [], versionArgs = ['--version'], authArgs = [], idFactory = randomUUID } = {}) {
    if (!supervisor) throw new Error(`${id} 需要 CliSupervisor`);
    this.id = id;
    this.displayName = displayName;
    this.supervisor = supervisor;
    this.names = names;
    this.executablePath = executablePath;
    this.commandPrefix = [...commandPrefix];
    this.versionArgs = [...versionArgs];
    this.authArgs = [...authArgs];
    this.idFactory = idFactory;
    this.sessions = new Map();
    this.detection = null;
  }

  async capabilities() {
    return { workspace: true, fileEdit: true, terminal: true, toolUse: true, imageInput: true, resume: true, checkpoint: true, approval: false, computerUse: false, structuredOutput: true };
  }

  async detect() {
    this.detection = await this.supervisor.detect({
      id: this.id,
      names: this.executablePath ? [] : this.names,
      explicitPaths: this.executablePath ? [this.executablePath] : [],
      versionArgs: [...this.commandPrefix, ...this.versionArgs],
      rejectPatterns: this.id === 'codex' ? [/\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\resources\\codex(?:\.exe)?$/i] : [],
    });
    return this.detection;
  }

  async probe() {
    const detection = this.detection?.available ? this.detection : await this.detect();
    if (!detection.available) return { ok: false, auth: { status: 'unknown' }, reason: detection.reason };
    let auth = { status: 'unknown', reason: 'AUTH_STATE_UNKNOWN' };
    if (this.authArgs.length) {
      const checked = await this.supervisor.probeAuth({ command: detection.command, args: [...this.commandPrefix, ...this.authArgs], timeoutMs: 10000 });
      auth = { status: checked.status, reason: checked.reason };
    }
    return { ok: true, auth, descriptor: this.descriptor() };
  }

  async createSession(input = {}) {
    requireRulePack(input);
    const detection = this.detection?.available ? this.detection : await this.detect();
    if (!detection.available) throw adapterError(detection.reason || 'CLI_NOT_INSTALLED', `${this.displayName} CLI 不可用`);
    const id = String(this.idFactory());
    const handle = sessionHandle(id, this.id, { transport: 'jsonl-cli' });
    this.sessions.set(id, {
      handle, input, command: detection.command, workspace: path.resolve(String(input.workspace || process.cwd())),
      hub: eventHub(), activeProcess: null, vendorSessionId: String(input.context?.vendorSessionId || input.modelTarget?.resumeSessionId || ''), turnNo: 0,
    });
    return handle;
  }

  session(handle, action) {
    assertSession(handle, this.id, action);
    const row = this.sessions.get(handle.id);
    if (!row) throw adapterError('ADAPTER_SESSION_NOT_FOUND', `${this.displayName} Session 不存在`);
    return row;
  }

  async send(handle, input) {
    const row = this.session(handle, 'send');
    if (row.activeProcess) throw adapterError('ADAPTER_TURN_IN_FLIGHT', `${this.displayName} 当前仍有 turn 在执行`);
    const prompt = composeInstruction(row.input, typeof input === 'string' ? input : input?.text || '');
    const args = [...this.commandPrefix, ...this.buildArgs(row)];
    const decoder = new JsonLineDecoder(value => {
      const parsed = this.parseEvent(value, row);
      if (!parsed) return;
      const events = Array.isArray(parsed[0]) ? parsed : [parsed];
      for (const [type, payload] of events) row.hub.emit(type, payload, redactedRawMetadata(value));
    });
    row.hub.emit('state', { state: 'running' });
    row.activeProcess = await this.supervisor.start({
      command: row.command,
      args,
      cwd: row.workspace,
      stdin: prompt,
      timeoutMs: 30 * 60 * 1000,
      owner: `${this.id}:turn`,
      onStdout: chunk => decoder.feed(chunk),
      onStderr: chunk => row.hub.emit('stderr', { text: String(chunk) }),
    });
    const processHandle = row.activeProcess;
    const run = await this.supervisor.wait(processHandle);
    row.activeProcess = null;
    row.turnNo += 1;
    const normalized = resultFromRun(run, { vendorSessionId: row.vendorSessionId, turnNo: row.turnNo });
    if (!normalized.result.ok) {
      const error = adapterError(normalized.result.error?.code || 'ADAPTER_TURN_FAILED', normalized.result.error?.message || `${this.displayName} turn 失败`);
      row.hub.emit('error', { code: error.code, message: error.message, terminal: false });
      throw error;
    }
    row.hub.emit('result', { complete: normalized.result.complete, vendorSessionId: row.vendorSessionId, outputReceipt: normalized.outputReceipt });
    row.hub.emit('state', { state: 'waiting' });
    return { accepted: true, result: normalized.result, outputReceipt: normalized.outputReceipt, vendorSessionId: row.vendorSessionId };
  }

  async interrupt(handle) {
    const row = this.session(handle, 'interrupt');
    if (row.activeProcess) {
      await this.supervisor.terminate(row.activeProcess, 'session-interrupt').catch(() => {});
      await this.supervisor.wait(row.activeProcess).catch(() => {});
      row.activeProcess = null;
    }
    row.hub.emit('completed', { status: 'cancelled' });
    return true;
  }

  async dispose(handle) {
    const row = this.session(handle, 'dispose');
    if (row.activeProcess) {
      await this.supervisor.terminate(row.activeProcess, 'session-dispose').catch(() => {});
      await this.supervisor.wait(row.activeProcess).catch(() => {});
    }
    row.hub.clear();
    this.sessions.delete(handle.id);
    return true;
  }

  async events(handle, listener) { return this.session(handle, 'events').hub.subscribe(listener); }
}

module.exports = { JsonLineDecoder, StreamCliAdapter };
