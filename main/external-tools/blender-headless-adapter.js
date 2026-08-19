'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveExecutable } = require('../agent-cli-supervisor');
const {
  defineExternalToolAdapter,
  normalizeExternalToolCancelResult,
  normalizeExternalToolDisposeResult,
  normalizeExternalToolProbe,
  normalizeExternalToolRunRequest,
  normalizeExternalToolRunResult,
} = require('../foundation/external-tool-adapter');

const ADAPTER_ID = 'blender.headless.v0';
const TOOL_ID = 'org.blender.Blender';
const OPERATION = 'scene.render.frame/v0';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PROVENANCE = Object.freeze({
  kind: 'external-capability-provider',
  project: 'Blender',
  license: 'GPL-3.0-or-later',
  distribution: 'independent-user-installation',
  bundledWithMazz: false,
});

class BlenderAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BlenderAdapterError';
    this.code = code;
  }
}

function fail(code, message) { throw new BlenderAdapterError(code, message); }
function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function candidatePaths(explicitPath = '', platform = process.platform, fsImpl = fs) {
  const candidates = [explicitPath, 'blender'];
  if (platform === 'win32') {
    const base = 'C:\\Program Files\\Blender Foundation';
    try {
      for (const entry of fsImpl.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(base, entry.name, 'blender.exe'));
      }
    } catch {}
  }
  return [...new Set(candidates.filter(Boolean))];
}

function resolveExistingInput(workdir, relativePath, fsImpl = fs) {
  if (path.isAbsolute(relativePath)) fail('TOOL_PATH_ABSOLUTE_FORBIDDEN', '输入路径必须相对 workdir');
  const resolved = path.resolve(workdir, relativePath);
  if (!isInside(workdir, resolved)) fail('TOOL_PATH_OUTSIDE_WORKDIR', '输入路径越出 workdir');
  let stat;
  try { stat = fsImpl.lstatSync(resolved); } catch { fail('TOOL_INPUT_MISSING', `输入不存在: ${relativePath}`); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('TOOL_INPUT_UNSAFE', `输入必须是普通文件且不能是符号链接: ${relativePath}`);
  const real = fsImpl.realpathSync(resolved);
  if (!isInside(workdir, real)) fail('TOOL_INPUT_REPARSE_ESCAPE', `输入真实路径越出 workdir: ${relativePath}`);
  return real;
}

function resolveNewOutput(workdir, relativePath, fsImpl = fs, createParent = false) {
  if (path.isAbsolute(relativePath)) fail('TOOL_PATH_ABSOLUTE_FORBIDDEN', '输出路径必须相对 workdir');
  const resolved = path.resolve(workdir, relativePath);
  if (!isInside(workdir, resolved)) fail('TOOL_PATH_OUTSIDE_WORKDIR', '输出路径越出 workdir');
  if (fsImpl.existsSync(resolved)) fail('TOOL_OUTPUT_ALREADY_EXISTS', `拒绝覆盖已有输出: ${relativePath}`);
  const parent = path.dirname(resolved);
  let ancestor = parent;
  while (!fsImpl.existsSync(ancestor)) {
    const next = path.dirname(ancestor);
    if (next === ancestor) fail('TOOL_OUTPUT_PARENT_INVALID', '无法确定安全输出目录');
    ancestor = next;
  }
  const ancestorStat = fsImpl.lstatSync(ancestor);
  if (ancestorStat.isSymbolicLink()) fail('TOOL_OUTPUT_REPARSE_ESCAPE', '输出父目录不能是符号链接');
  const realAncestor = fsImpl.realpathSync(ancestor);
  if (!isInside(workdir, realAncestor)) fail('TOOL_OUTPUT_REPARSE_ESCAPE', '输出父目录真实路径越出 workdir');
  if (createParent) fsImpl.mkdirSync(parent, { recursive: true });
  return resolved;
}

function sha256File(filePath, fsImpl = fs) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(filePath)).digest('hex');
}

function validatePng(filePath, fsImpl = fs) {
  let stat;
  try { stat = fsImpl.statSync(filePath); } catch { fail('TOOL_OUTPUT_MISSING', 'Blender 成功退出但输出不存在'); }
  if (!stat.isFile() || stat.size <= PNG_MAGIC.length) fail('TOOL_OUTPUT_INVALID', 'Blender 输出不是有效非空文件');
  const fd = fsImpl.openSync(filePath, 'r');
  try {
    const magic = Buffer.alloc(PNG_MAGIC.length);
    fsImpl.readSync(fd, magic, 0, magic.length, 0);
    if (!magic.equals(PNG_MAGIC)) fail('TOOL_OUTPUT_TYPE_MISMATCH', 'Blender 输出不是 PNG');
  } finally { fsImpl.closeSync(fd); }
  return { byteLength: stat.size, sha256: sha256File(filePath, fsImpl) };
}

class BlenderHeadlessRuntime {
  constructor({
    supervisor, executablePath = '', commandPrefix = [], scriptPath, fsImpl = fs,
    allowedRootsProvider = () => [], clock = () => Date.now(),
  } = {}) {
    if (!supervisor) throw new Error('Blender Adapter 需要外部工具 Supervisor');
    this.supervisor = supervisor;
    this.executablePath = String(executablePath || '');
    this.commandPrefix = Array.isArray(commandPrefix) ? commandPrefix.map(String) : [];
    this.scriptPath = path.resolve(scriptPath || path.join(__dirname, '..', '..', 'resources', 'tools', 'blender', 'mazz_render_frame.py'));
    this.fs = fsImpl;
    this.allowedRootsProvider = allowedRootsProvider;
    this.clock = clock;
    this.active = new Map();
    this.terminal = new Map();
  }

  remember(runId, status) {
    this.terminal.set(runId, status);
    if (this.terminal.size > 200) this.terminal.delete(this.terminal.keys().next().value);
  }

  async probe() {
    const command = resolveExecutable(candidatePaths(this.executablePath, process.platform, this.fs));
    if (!command) return normalizeExternalToolProbe({
      adapterId: ADAPTER_ID, available: false, reason: 'BLENDER_NOT_INSTALLED', provenance: PROVENANCE,
    });
    const captured = await this.supervisor.capture({
      command,
      args: [...this.commandPrefix, '--version'],
      timeoutMs: 10000,
      owner: `${ADAPTER_ID}:probe`,
    });
    const version = `${captured.result.stdout}\n${captured.result.stderr}`.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
    if (!captured.result.ok || !version) return normalizeExternalToolProbe({
      adapterId: ADAPTER_ID, available: false, executablePath: command,
      reason: captured.result.error?.code || 'BLENDER_VERSION_PROBE_FAILED', provenance: PROVENANCE,
    });
    return normalizeExternalToolProbe({
      adapterId: ADAPTER_ID, available: true, executablePath: command, version, reason: '', provenance: PROVENANCE,
    });
  }

  failureResult(runId, reason, {
    stdout = '', stderr = '', durationMs = 0, code = null, signal = '', partialOutputPath = '', toolVersion = '',
  } = {}) {
    return normalizeExternalToolRunResult({
      runId, status: 'failed', stdout, stderr, exit: { code, signal, reason }, durationMs,
      outputs: [], provenance: {
        ...PROVENANCE, adapterId: ADAPTER_ID, operation: OPERATION, toolVersion,
        partialOutputPolicy: 'retained-with-partial-suffix', partialOutputPath,
      },
    });
  }

  retainPartial(outputPath, runId, workdir) {
    if (!this.fs.existsSync(outputPath)) return '';
    const safeRunId = String(runId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const partialPath = `${outputPath}.partial-${safeRunId}`;
    try {
      this.fs.renameSync(outputPath, partialPath);
      return path.relative(workdir, partialPath).replace(/\\/g, '/');
    } catch {
      return path.relative(workdir, outputPath).replace(/\\/g, '/');
    }
  }

  validateRequest(input) {
    const request = normalizeExternalToolRunRequest(input);
    if (request.operation !== OPERATION) fail('TOOL_OPERATION_NOT_ALLOWED', `Blender operation 不允许: ${request.operation}`);
    if (request.inputs.length !== 1 || request.inputs[0].role !== 'scene' || request.inputs[0].type !== 'application/x-blender') {
      fail('TOOL_INPUT_CONTRACT_INVALID', 'scene.render.frame/v0 只接受一个 application/x-blender scene');
    }
    if (request.outputs.length !== 1 || request.outputs[0].role !== 'frame' || request.outputs[0].type !== 'image/png') {
      fail('TOOL_OUTPUT_CONTRACT_INVALID', 'scene.render.frame/v0 只产生一个 image/png frame');
    }
    const workdir = path.resolve(request.workdir);
    let workdirStat;
    try { workdirStat = this.fs.lstatSync(workdir); } catch { fail('TOOL_WORKDIR_MISSING', 'workdir 不存在'); }
    if (!workdirStat.isDirectory() || workdirStat.isSymbolicLink()) fail('TOOL_WORKDIR_UNSAFE', 'workdir 必须是真实目录且不能是符号链接');
    const realWorkdir = this.fs.realpathSync(workdir);
    const allowedRoots = (typeof this.allowedRootsProvider === 'function' ? this.allowedRootsProvider() : [])
      .filter(Boolean)
      .map(root => {
        try { return this.fs.realpathSync(path.resolve(String(root))); } catch { return ''; }
      })
      .filter(Boolean);
    if (!allowedRoots.length) fail('TOOL_ALLOWED_ROOT_REQUIRED', '外部工具未配置允许的工作区根目录');
    if (!allowedRoots.some(root => isInside(root, realWorkdir))) fail('TOOL_WORKDIR_NOT_ALLOWED', 'workdir 不在允许的工作区根目录内');
    const scenePath = resolveExistingInput(realWorkdir, request.inputs[0].path, this.fs);
    if (path.extname(scenePath).toLowerCase() !== '.blend') fail('TOOL_INPUT_TYPE_MISMATCH', 'scene 文件扩展名必须是 .blend');
    const outputPath = resolveNewOutput(realWorkdir, request.outputs[0].path, this.fs, false);
    if (path.extname(outputPath).toLowerCase() !== '.png') fail('TOOL_OUTPUT_TYPE_MISMATCH', 'frame 输出扩展名必须是 .png');
    return { request, workdir: realWorkdir, scenePath, outputPath };
  }

  async run(input) {
    const prepared = this.validateRequest(input);
    const { request, workdir, scenePath, outputPath } = prepared;
    if (this.active.has(request.runId) || this.terminal.has(request.runId)) fail('TOOL_RUN_ID_REUSED', `runId 已使用: ${request.runId}`);
    const probe = await this.probe();
    if (!probe.available) {
      const result = this.failureResult(request.runId, probe.reason);
      this.remember(request.runId, result.status);
      return result;
    }
    if (!this.fs.existsSync(this.scriptPath)) fail('TOOL_ADAPTER_SCRIPT_MISSING', `Blender Adapter 脚本不存在: ${this.scriptPath}`);
    resolveNewOutput(workdir, request.outputs[0].path, this.fs, true);
    const handle = await this.supervisor.start({
      command: probe.executablePath,
      args: [...this.commandPrefix, '--background', scenePath, '--python', this.scriptPath, '--', outputPath],
      cwd: workdir,
      timeoutMs: 10 * 60 * 1000,
      owner: `${ADAPTER_ID}:${request.runId}`,
    });
    const record = { handle, outputPath, cancelRequested: false, done: null };
    this.active.set(request.runId, record);
    record.done = this.supervisor.wait(handle).then(outcome => {
      const cancelled = record.cancelRequested || outcome.result.error?.code === 'CLI_CANCELLED';
      let result;
      if (cancelled) {
        const partialOutputPath = this.retainPartial(outputPath, request.runId, workdir);
        result = normalizeExternalToolRunResult({
          runId: request.runId, status: 'cancelled', stdout: outcome.result.stdout, stderr: outcome.result.stderr,
          exit: { code: outcome.result.exitCode, signal: outcome.result.structured?.signal || '', reason: 'USER_CANCELLED' },
          durationMs: outcome.durationMs, outputs: [],
          provenance: {
            ...PROVENANCE, adapterId: ADAPTER_ID, toolVersion: probe.version, operation: OPERATION,
            partialOutputPolicy: 'retained-with-partial-suffix', partialOutputPath,
          },
        });
      } else if (!outcome.result.ok) {
        const partialOutputPath = this.retainPartial(outputPath, request.runId, workdir);
        result = this.failureResult(request.runId, outcome.result.error?.code || 'BLENDER_RUN_FAILED', {
          stdout: outcome.result.stdout, stderr: outcome.result.stderr,
          durationMs: outcome.durationMs, code: outcome.result.exitCode, signal: outcome.result.structured?.signal || '',
          partialOutputPath, toolVersion: probe.version,
        });
      } else {
        try {
          const output = validatePng(outputPath, this.fs);
          result = normalizeExternalToolRunResult({
            runId: request.runId, status: 'succeeded', stdout: outcome.result.stdout, stderr: outcome.result.stderr,
            exit: { code: 0, signal: '', reason: '' }, durationMs: outcome.durationMs,
            outputs: [{
              role: 'frame', id: `asset:sha256:${output.sha256}`, path: request.outputs[0].path,
              type: 'image/png', version: `sha256:${output.sha256}`,
            }],
            provenance: { ...PROVENANCE, adapterId: ADAPTER_ID, toolVersion: probe.version, operation: OPERATION, byteLength: output.byteLength },
          });
        } catch (error) {
          const partialOutputPath = this.retainPartial(outputPath, request.runId, workdir);
          result = this.failureResult(request.runId, error.code || 'TOOL_OUTPUT_INVALID', {
            stdout: outcome.result.stdout, stderr: `${outcome.result.stderr}${error.message ? `\n${error.message}` : ''}`,
            durationMs: outcome.durationMs, code: null, signal: '', partialOutputPath, toolVersion: probe.version,
          });
        }
      }
      this.remember(request.runId, result.status);
      return result;
    }).finally(() => this.active.delete(request.runId));
    return record.done;
  }

  async cancel(runId) {
    const id = String(runId || '').trim();
    const record = this.active.get(id);
    if (!record) return normalizeExternalToolCancelResult({
      runId: id || 'missing', status: this.terminal.has(id) ? 'already-terminal' : 'not-found',
      reason: this.terminal.get(id) || 'run-not-found',
    });
    record.cancelRequested = true;
    await this.supervisor.terminate(record.handle, 'external-tool-cancel');
    return normalizeExternalToolCancelResult({ runId: id, status: 'accepted', reason: 'cancel-requested' });
  }

  async dispose(reason = 'app-quit') {
    const records = [...this.active.entries()];
    await Promise.allSettled(records.map(([runId]) => this.cancel(runId)));
    await Promise.allSettled(records.map(([, record]) => record.done));
    return normalizeExternalToolDisposeResult({ adapterId: ADAPTER_ID, status: 'disposed', activeRuns: 0, reason });
  }
}

function createBlenderHeadlessAdapter(options = {}) {
  const runtime = new BlenderHeadlessRuntime(options);
  return defineExternalToolAdapter({
    id: ADAPTER_ID,
    toolId: TOOL_ID,
    displayName: 'Blender Headless',
    provenance: PROVENANCE,
    probe: () => runtime.probe(),
    run: request => runtime.run(request),
    cancel: runId => runtime.cancel(runId),
    dispose: reason => runtime.dispose(reason),
  });
}

module.exports = {
  ADAPTER_ID,
  OPERATION,
  PROVENANCE,
  BlenderAdapterError,
  createBlenderHeadlessAdapter,
};
