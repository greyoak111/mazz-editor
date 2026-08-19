// main/agent-cli-supervisor.js —— W66-R1 无 shell、可取消、可收尸的 CLI Supervisor
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const {
  createTypedHandle, assertTypedContinuation, normalizeResultEnvelope,
  createOutputReceipt,
} = require('./agent-execution-contracts');

const SAFE_ENV_KEYS = Object.freeze([
  'SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP',
  'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'PROGRAMDATA', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
]);

class CliSupervisorError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CliSupervisorError';
    this.code = code;
    this.retryable = false;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new CliSupervisorError(code, message, details);
}

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('CLI_SPEC_INVALID', `${label} 必填`);
  return normalized;
}

function safeEnvironment(overrides = {}, source = process.env) {
  const output = {};
  for (const key of SAFE_ENV_KEYS) if (source[key] != null) output[key] = String(source[key]);
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!SAFE_ENV_KEYS.includes(key)) fail('CLI_ENV_NOT_ALLOWED', `环境变量不在白名单: ${key}`);
    output[key] = String(value);
  }
  output.NO_COLOR = '1';
  return output;
}

function executableCandidates(name, explicit = [], platform = process.platform) {
  const base = [name, ...(Array.isArray(explicit) ? explicit : [])].filter(Boolean).map(String);
  return [...new Set(base.flatMap(item => {
    if (path.isAbsolute(item) || platform !== 'win32' || /\.(exe|cmd|bat)$/i.test(item)) return [item];
    return [item, `${item}.exe`, `${item}.cmd`];
  }))];
}

function resolveExecutable(candidates, { platform = process.platform, fsImpl = fs, env = process.env } = {}) {
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      try { if (fsImpl.statSync(candidate).isFile()) return path.resolve(candidate); } catch {}
      continue;
    }
    try {
      const finder = platform === 'win32' ? 'where.exe' : 'which';
      const result = execFileSync(finder, [candidate], { encoding: 'utf8', windowsHide: true, timeout: 3000, env: safeEnvironment({}, env), stdio: ['ignore', 'pipe', 'ignore'] });
      const hit = String(result).split(/\r?\n/).map(row => row.trim()).find(Boolean);
      if (hit) return path.resolve(hit);
    } catch {}
  }
  return '';
}

function classifyAuthentication({ stdout = '', stderr = '', exitCode = null } = {}) {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (/"loggedin"\s*:\s*false/.test(text)) return Object.freeze({ status: 'unauthenticated', reason: 'AUTH_REQUIRED' });
  if (/"loggedin"\s*:\s*true/.test(text)) return Object.freeze({ status: 'authenticated', reason: '' });
  if (/not logged in|login required|authentication required|unauthenticated|please (?:run )?login|auth required/.test(text)) return Object.freeze({ status: 'unauthenticated', reason: 'AUTH_REQUIRED' });
  if (/logged in|authenticated|authentication.+valid|credentials.+valid/.test(text)) return Object.freeze({ status: 'authenticated', reason: '' });
  if (Number.isInteger(exitCode) && exitCode !== 0) return Object.freeze({ status: 'error', reason: 'AUTH_PROBE_FAILED' });
  return Object.freeze({ status: 'unknown', reason: 'AUTH_STATE_UNKNOWN' });
}

class CliSupervisor {
  constructor({
    resourceLedger = null,
    idFactory = randomUUID,
    clock = () => Date.now(),
    spawnImpl = spawn,
    maxOutputBytes = 4 * 1024 * 1024,
    resourceType = 'agent-cli-process',
    handleOwnerTool = 'agent-cli-supervisor',
    forceKillTreeOnTerminate = false,
  } = {}) {
    this.resourceLedger = resourceLedger;
    this.idFactory = idFactory;
    this.clock = clock;
    this.spawnImpl = spawnImpl;
    this.maxOutputBytes = Math.max(1024, Number(maxOutputBytes) || 0);
    this.resourceType = requiredString(resourceType, 'resourceType');
    this.handleOwnerTool = requiredString(handleOwnerTool, 'handleOwnerTool');
    this.forceKillTreeOnTerminate = !!forceKillTreeOnTerminate;
    this.processes = new Map();
  }

  activeCount() { return this.processes.size; }

  async start({ command, args = [], cwd = '', stdin = '', keepStdinOpen = false, env = {}, timeoutMs = 120000, owner = 'agent-cli', onStdout = () => {}, onStderr = () => {} } = {}) {
    const executable = requiredString(command, 'command');
    if (!Array.isArray(args)) fail('CLI_SPEC_INVALID', 'args 必须是数组');
    const workdir = path.resolve(requiredString(cwd || process.cwd(), 'cwd'));
    const id = String(this.idFactory());
    let child;
    try {
      child = this.spawnImpl(executable, args.map(String), {
        cwd: workdir,
        env: safeEnvironment(env),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      fail(error?.code || 'CLI_SPAWN_FAILED', `CLI 无法创建进程: ${path.basename(executable)}`, { syscall: error?.syscall || '' });
    }
    const handle = createTypedHandle({ kind: 'ProcessSessionHandle', id, ownerTool: this.handleOwnerTool, metadata: { owner, command: path.basename(executable) } });
    const record = {
      id, handle, child, owner, command: executable, args: args.map(String), cwd: workdir,
      stdout: [], stderr: [], stdoutBytes: 0, stderrBytes: 0, truncated: false,
      startedAt: this.clock(), settled: false, timedOut: false, cancelled: false, timer: null,
      resourceKey: null, onStdout, onStderr,
    };
    this.processes.set(id, record);
    record.resourceKey = this.resourceLedger?.register({ type: this.resourceType, id, owner, state: 'running', meta: { command: path.basename(executable), cwd: workdir } }) || null;
    const append = (stream, chunk) => {
      const bytes = Buffer.from(chunk);
      const countKey = `${stream}Bytes`;
      const next = record.stdoutBytes + record.stderrBytes + bytes.length;
      if (next > this.maxOutputBytes) {
        record.truncated = true;
        this.terminate(handle, 'output-limit').catch(() => {});
        return;
      }
      record[stream].push(bytes);
      record[countKey] += bytes.length;
      try { record[stream === 'stdout' ? 'onStdout' : 'onStderr'](bytes.toString('utf8')); } catch {}
    };
    child.stdout?.on('data', chunk => append('stdout', chunk));
    child.stderr?.on('data', chunk => append('stderr', chunk));
    if (timeoutMs > 0) record.timer = setTimeout(() => {
      record.timedOut = true;
      this.terminate(handle, 'timeout').catch(() => {});
    }, Math.max(100, Number(timeoutMs) || 0));
    if (stdin != null && String(stdin).length) {
      if (keepStdinOpen) child.stdin?.write(String(stdin));
      else child.stdin?.end(String(stdin));
    } else if (!keepStdinOpen) child.stdin?.end();
    record.resultPromise = new Promise(resolve => {
      let spawnError = null;
      child.once('error', error => { spawnError = error; });
      const settle = (exitCode, signal) => {
        if (record.settled) return;
        if (record.timer) clearTimeout(record.timer);
        record.settled = true;
        const stdout = Buffer.concat(record.stdout).toString('utf8');
        const stderr = Buffer.concat(record.stderr).toString('utf8');
        const error = spawnError
          ? { code: spawnError.code || 'CLI_SPAWN_FAILED', message: spawnError.message, retryable: false }
          : record.timedOut
            ? { code: 'CLI_TIMEOUT', message: 'CLI 执行超时并已终止', retryable: true }
            : record.cancelled
              ? { code: 'CLI_CANCELLED', message: 'CLI 已取消', retryable: false }
              : record.truncated
                ? { code: 'CLI_OUTPUT_LIMIT', message: 'CLI 输出超过上限并已终止', retryable: false }
                : null;
        const result = normalizeResultEnvelope({
          outerStatus: error ? 'error' : 'success', exitCode: Number.isInteger(exitCode) ? exitCode : null,
          stdout, stderr, structured: { signal: signal || null, pid: child.pid || null },
          complete: !record.truncated, truncated: record.truncated, error,
        });
        const outputReceipt = createOutputReceipt({
          complete: result.complete, truncated: record.truncated,
          lineCount: stdout.split(/\r?\n/).filter(Boolean).length + stderr.split(/\r?\n/).filter(Boolean).length,
          bytes: Buffer.concat([Buffer.from(stdout), Buffer.from(stderr)]),
        });
        this.resourceLedger?.release(record.resourceKey, { reason: error?.code || 'process-exit', state: result.ok ? 'completed' : 'failed', meta: { exitCode, signal: signal || '' } });
        this.processes.delete(id);
        resolve(Object.freeze({ handle, result, outputReceipt, durationMs: Math.max(0, this.clock() - record.startedAt) }));
      };
      record.forceSettle = settle;
      child.once('close', settle);
    });
    return handle;
  }

  record(handle, continuation) {
    assertTypedContinuation(handle, { kind: 'ProcessSessionHandle', ownerTool: this.handleOwnerTool, continuation });
    const record = this.processes.get(handle.id);
    if (!record) fail('CLI_PROCESS_NOT_FOUND', `CLI Process 不存在: ${handle.id}`);
    return record;
  }

  async wait(handle) {
    return this.record(handle, 'wait').resultPromise;
  }

  async write(handle, value) {
    const record = this.record(handle, 'write');
    if (record.child.stdin?.destroyed) fail('CLI_STDIN_CLOSED', 'CLI stdin 已关闭');
    return new Promise((resolve, reject) => record.child.stdin.write(String(value), error => error ? reject(error) : resolve(true)));
  }

  async terminate(handle, reason = 'cancel') {
    const record = this.record(handle, 'terminate');
    if (record.settled) return false;
    record.cancelled = reason !== 'timeout' && reason !== 'output-limit';
    if (process.platform === 'win32' && record.child.pid && this.forceKillTreeOnTerminate) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(record.child.pid), '/T', '/F'], {
          windowsHide: true, timeout: 5000, stdio: 'ignore',
        });
      } catch {
        try { record.child.kill('SIGKILL'); } catch {}
      }
      setTimeout(() => {
        if (!record.settled) record.forceSettle?.(null, 'SIGKILL');
      }, 1000).unref?.();
      return true;
    }
    try { record.child.kill('SIGTERM'); } catch {}
    if (process.platform === 'win32' && record.child.pid) {
      setTimeout(() => {
        if (record.settled) return;
        try { execFileSync('taskkill.exe', ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); } catch {}
      }, 500).unref?.();
    } else {
      setTimeout(() => { if (!record.settled) { try { record.child.kill('SIGKILL'); } catch {} } }, 500).unref?.();
    }
    return true;
  }

  async capture(spec = {}) {
    const handle = await this.start(spec);
    return this.wait(handle);
  }

  async disposeAll(reason = 'app-quit') {
    const records = [...this.processes.values()];
    await Promise.allSettled(records.map(record => this.terminate(record.handle, reason)));
    await Promise.allSettled(records.map(record => record.resultPromise));
  }

  async detect({ id, names = [], explicitPaths = [], versionArgs = ['--version'], rejectPatterns = [] } = {}) {
    const adapterId = requiredString(id, 'detect.id');
    const candidates = [...new Set([
      ...explicitPaths.flatMap(item => executableCandidates(item)),
      ...names.flatMap(name => executableCandidates(name)),
    ])];
    const command = resolveExecutable(candidates);
    if (!command) return { adapterId, available: false, command: '', version: '', auth: { status: 'unknown' }, reason: 'CLI_NOT_INSTALLED' };
    const rejected = rejectPatterns.map(value => value instanceof RegExp ? value : new RegExp(String(value), 'i')).find(pattern => pattern.test(command));
    if (rejected) return { adapterId, available: false, command, version: '', auth: { status: 'unknown' }, reason: 'CLI_PATH_REJECTED' };
    let probe;
    try { probe = await this.capture({ command, args: versionArgs, timeoutMs: 10000, owner: `${adapterId}:version` }); }
    catch (error) {
      return { adapterId, available: false, command, version: '', auth: { status: 'unknown' }, reason: error?.code || 'VERSION_PROBE_FAILED' };
    }
    const version = `${probe.result.stdout}\n${probe.result.stderr}`.trim().split(/\r?\n/).find(Boolean) || '';
    return { adapterId, available: probe.result.ok, command, version, auth: { status: 'unknown' }, reason: probe.result.ok ? '' : probe.result.error?.code || 'VERSION_PROBE_FAILED', probe: probe.result };
  }

  async probeAuth({ command, args = [], cwd = '', timeoutMs = 10000 } = {}) {
    const probe = await this.capture({ command, args, cwd, timeoutMs, owner: 'agent-cli:auth-probe' });
    return Object.freeze({ ...classifyAuthentication({ stdout: probe.result.stdout, stderr: probe.result.stderr, exitCode: probe.result.exitCode }), result: probe.result });
  }
}

module.exports = {
  SAFE_ENV_KEYS,
  CliSupervisorError,
  safeEnvironment,
  executableCandidates,
  resolveExecutable,
  classifyAuthentication,
  CliSupervisor,
};
