'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveExecutable } = require('../agent-cli-supervisor');
const contract = require('../capability-execution-contract');
const {
  ADAPTER_ID: TOOL_ADAPTER_ID,
  OPERATION_SPECS,
  PROVENANCE: TOOL_PROVENANCE,
  candidatePaths,
  createBlenderHeadlessAdapter,
} = require('../external-tools/blender-headless-adapter');

const CAPABILITY_ID = 'mazz.blender.external';
const CAPABILITY_VERSION = '1.0.0';
const CAPABILITY_ADAPTER_ID = 'mazz.blender.external-process';
const SCENE_SCHEMA = 'mazz.blender-scene/v1';
const OUTPUT_SPECS = Object.freeze({
  'scene.render.frame/v0': Object.freeze({
    role: 'frame', type: 'image/png', extension: '.png', kind: 'blender-render',
    mediaType: 'image/png', contentSchema: 'mazz.blender-render/v1',
  }),
  'scene.inspect/v0': Object.freeze({
    role: 'report', type: 'application/json', extension: '.json', kind: 'blender-inspection',
    mediaType: 'application/json; charset=utf-8', contentSchema: 'mazz.blender-inspection/v1',
  }),
  'scene.export.obj/v0': Object.freeze({
    role: 'model', type: 'model/obj', extension: '.obj', kind: 'blender-export',
    mediaType: 'text/plain; charset=utf-8', contentSchema: 'mazz.blender-export/v1',
  }),
});
const OPERATIONS = Object.freeze(Object.keys(OUTPUT_SPECS));

function fail(code, message, details = {}) {
  throw contract.codedError(code, message, details);
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensurePhysicalDirectory(directory, root) {
  const resolved = path.resolve(directory);
  if (!inside(root, resolved)) fail('CAPABILITY_BLENDER_STAGING_ESCAPE', 'Blender staging 越出 Workspace');
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('CAPABILITY_BLENDER_STAGING_UNSAFE', 'Blender staging 必须是物理目录');
    if (path.resolve(fs.realpathSync(resolved)) !== resolved) fail('CAPABILITY_BLENDER_STAGING_UNSAFE', 'Blender staging 不能含 reparse/link');
    return resolved;
  }
  const parent = path.dirname(resolved);
  ensurePhysicalDirectory(parent, root);
  fs.mkdirSync(resolved);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('CAPABILITY_BLENDER_STAGING_UNSAFE', 'Blender staging 创建后不是物理目录');
  return resolved;
}

function createStaging(workspacePath) {
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) fail('CAPABILITY_BLENDER_WORKSPACE_REQUIRED', 'Blender Capability 缺 Workspace');
  const root = path.resolve(workspacePath);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
    fail('CAPABILITY_BLENDER_WORKSPACE_INVALID', 'Blender Capability Workspace 必须是物理目录');
  }
  const realRoot = path.resolve(fs.realpathSync(root));
  const staging = ensurePhysicalDirectory(path.join(realRoot, '.mazz', 'capability-blender', 'staging'), realRoot);
  const runDir = fs.mkdtempSync(path.join(staging, 'run-'));
  const realRunDir = path.resolve(fs.realpathSync(runDir));
  if (!inside(staging, realRunDir)) fail('CAPABILITY_BLENDER_STAGING_ESCAPE', 'Blender run staging 越界');
  return { root: realRoot, staging, runDir: realRunDir };
}

function removeStaging(staging, runDir) {
  const resolvedStaging = path.resolve(staging);
  const resolvedRun = path.resolve(runDir);
  if (path.dirname(resolvedRun) !== resolvedStaging || !path.basename(resolvedRun).startsWith('run-')) {
    fail('CAPABILITY_BLENDER_STAGING_CLEANUP_REFUSED', '拒绝清理非 Blender run staging');
  }
  fs.rmSync(resolvedRun, { recursive: true, force: true });
}

async function materializeArtifact(artifacts, input, target, signal) {
  if (!artifacts || typeof artifacts.getArtifact !== 'function' || typeof artifacts.open !== 'function') {
    fail('CAPABILITY_BLENDER_ARTIFACT_CONTEXT_MISSING', 'Blender Capability 缺 Artifact Store context');
  }
  const metadata = artifacts.getArtifact(input.artifactId);
  if (!metadata) fail('CAPABILITY_BLENDER_INPUT_NOT_FOUND', `Blender scene Artifact 不存在: ${input.artifactId}`);
  if (metadata.contentHash !== input.contentHash) fail('CAPABILITY_BLENDER_INPUT_HASH_MISMATCH', 'Blender scene Artifact hash 不一致');
  if (metadata.mediaType !== 'application/x-blender') fail('CAPABILITY_BLENDER_INPUT_TYPE_MISMATCH', 'Blender scene Artifact mediaType 不支持');
  const opened = await artifacts.open(metadata.storageRef, { expectedHash: metadata.contentHash });
  let fd;
  let hash = crypto.createHash('sha256');
  let size = 0;
  try {
    fd = fs.openSync(target, 'wx');
    for await (const chunk of opened.stream) {
      if (signal?.aborted) fail('CAPABILITY_CANCELLED', 'Blender Capability cancelled');
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
      hash.update(buffer);
      size += buffer.length;
    }
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    opened.stream.destroy();
  }
  const actual = `sha256-${hash.digest('hex')}`;
  if (actual !== input.contentHash) fail('CAPABILITY_BLENDER_INPUT_HASH_MISMATCH', 'Blender staging 输入 hash 不一致');
  return { contentHash: actual, byteLength: size };
}

function syncAvailability({ executablePath = '', fsImpl = fs } = {}) {
  const executable = resolveExecutable(candidatePaths(executablePath, process.platform, fsImpl));
  return executable
    ? { state: 'available', reason: 'BLENDER_EXECUTABLE_RESOLVED', evidenceRef: 'runtime:blender-probe' }
    : { state: 'unavailable', reason: 'BLENDER_NOT_INSTALLED', evidenceRef: 'runtime:blender-unavailable' };
}

function createBlenderExternalCapabilityAdapter(options = {}) {
  const {
    supervisor,
    executablePath = '',
    commandPrefix = [],
    scriptPath,
    fsImpl = fs,
    allowedRootsProvider = () => [],
    clock = () => Date.now(),
    toolAdapter = null,
  } = options;
  if (!supervisor && !toolAdapter) throw new TypeError('Blender Capability 需要 External Tool Supervisor');
  const runtimeAdapter = toolAdapter || createBlenderHeadlessAdapter({
    supervisor, executablePath, commandPrefix, scriptPath, fsImpl, allowedRootsProvider, clock, operations: OPERATIONS,
  });
  const availability = syncAvailability({ executablePath: executablePath || commandPrefix[0], fsImpl });
  const descriptor = contract.normalizeCapabilityDescriptor({
    schema: contract.CAPABILITY_DESCRIPTOR_SCHEMA,
    capabilityId: CAPABILITY_ID,
    version: CAPABILITY_VERSION,
    adapterId: CAPABILITY_ADAPTER_ID,
    displayName: 'Blender External Capability',
    kind: 'blender',
    executionPlane: 'external-process',
    inputSchemas: [SCENE_SCHEMA],
    outputSchemas: OPERATIONS.map(operation => OUTPUT_SPECS[operation].contentSchema),
    determinism: 'external',
    safetyClass: 'external-write',
    availability: { ...availability, checkedAt: new Date().toISOString() },
    cancelMode: 'process-tree',
    resumeMode: 'restart',
    provenance: {
      adapter: CAPABILITY_ADAPTER_ID,
      externalTool: TOOL_ADAPTER_ID,
      toolId: 'org.blender.Blender',
      license: TOOL_PROVENANCE.license,
      bundledWithMazz: false,
      network: false,
      shell: false,
      scriptPolicy: 'mazz-owned-fixed-mode',
      supportedOperations: OPERATIONS,
    },
  });
  const activeRuns = new Map();
  const cancelInFlight = new Map();
  const requestCancel = runId => {
    const id = String(runId || '');
    const existing = cancelInFlight.get(id);
    if (existing) return existing;
    const pending = Promise.resolve(runtimeAdapter.cancel(id)).catch(() => null);
    cancelInFlight.set(id, pending);
    pending.finally(() => {
      if (cancelInFlight.get(id) === pending) cancelInFlight.delete(id);
    }).catch(() => {});
    return pending;
  };

  return Object.freeze({
    protocol: contract.CAPABILITY_ADAPTER_PROTOCOL,
    descriptor,
    async execute({ proposal, signal, artifacts }) {
      contract.exactKeys(proposal.parameters, ['operation'], 'Blender Capability parameters');
      contract.exactKeys(proposal.constraints, [], 'Blender Capability constraints');
      const operation = proposal.parameters.operation;
      const outputSpec = OUTPUT_SPECS[operation];
      if (!outputSpec || !OPERATION_SPECS[operation]) fail('CAPABILITY_BLENDER_OPERATION_NOT_ALLOWED', `Blender operation 不允许: ${operation}`);
      if (proposal.inputs.length !== 1 || proposal.inputs[0].role !== 'scene' || proposal.inputs[0].schema !== SCENE_SCHEMA) {
        fail('CAPABILITY_BLENDER_INPUT_CONTRACT_INVALID', 'Blender Capability 需要一个 mazz.blender-scene/v1 scene');
      }
      if (signal.aborted) fail('CAPABILITY_CANCELLED', 'Blender Capability cancelled');
      const stage = createStaging(artifacts.workspacePath);
      const scenePath = path.join(stage.runDir, 'inputs', 'scene.blend');
      const outputPath = path.join(stage.runDir, 'outputs', `result${outputSpec.extension}`);
      ensurePhysicalDirectory(path.dirname(scenePath), stage.root);
      ensurePhysicalDirectory(path.dirname(outputPath), stage.root);
      const runId = `w94d-${crypto.randomUUID()}`;
      activeRuns.set(proposal.proposalId, runId);
      // The service aborts its controller and then calls adapter.cancel().
      // Share one cancellation promise so those two paths cannot race two
      // process-tree terminations (which is especially brittle on Windows).
      const abort = () => { void requestCancel(runId); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        await materializeArtifact(artifacts, proposal.inputs[0], scenePath, signal);
        // Cancellation can win while the Artifact Ref is being materialized,
        // before the external runtime has registered its runId. Do not start
        // Blender after that boundary; this also closes the pre-spawn race.
        if (signal.aborted) fail('CAPABILITY_CANCELLED', 'Blender Capability cancelled');
        const external = await runtimeAdapter.run({
          runId,
          operation,
          workdir: stage.runDir,
          inputs: [{ role: 'scene', id: proposal.inputs[0].artifactId, path: 'inputs/scene.blend', type: 'application/x-blender', version: proposal.inputs[0].contentHash }],
          outputs: [{ role: outputSpec.role, path: `outputs/result${outputSpec.extension}`, type: outputSpec.type }],
          provenance: { requestedBy: 'mazz-capability-execution', capabilityId: CAPABILITY_ID, operation },
        });
        if (external.status !== 'succeeded') {
          if (external.status === 'cancelled' || signal.aborted) fail('CAPABILITY_CANCELLED', 'Blender Capability cancelled');
          const reason = external.exit?.reason || `BLENDER_${external.status.toUpperCase()}`;
          const code = /^[A-Z][A-Z0-9_.-]*$/.test(reason) ? `CAPABILITY_${reason}` : 'CAPABILITY_BLENDER_RUN_FAILED';
          fail(code, 'Blender external execution failed');
        }
        const output = await artifacts.publishReadable({ readable: fs.createReadStream(outputPath), signal });
        const externalHash = external.outputs[0]?.version ? `sha256-${external.outputs[0].version.replace(/^sha256:/, '')}` : '';
        if (externalHash && externalHash !== output.contentHash) fail('CAPABILITY_BLENDER_OUTPUT_HASH_MISMATCH', 'Blender output hash 在 Artifact 发布时改变');
        const probe = await runtimeAdapter.probe();
        return Object.freeze({
          status: 'completed',
          outputs: Object.freeze([Object.freeze({
            schema: contract.ARTIFACT_SCHEMA,
            kind: outputSpec.kind,
            mediaType: outputSpec.mediaType,
            contentSchema: outputSpec.contentSchema,
            contentHash: output.contentHash,
            definitionHash: '',
            storageRef: output.storageRef,
            sourceArtifacts: [proposal.inputs[0].artifactId],
            rightsRef: '',
            mutableHead: false,
          })]),
          environment: {
            runtime: 'blender', toolVersion: probe.version || 'unknown', operation,
            executionPlane: 'external-process', graphics: 'external-tool-reported',
          },
          diagnostics: { summaryRef: `diagnostic:w94d-blender-${operation.replace(/[^a-z0-9]+/gi, '-')}-complete` },
          resourceFinal: { activeProcesses: 0, stagingCount: artifacts.snapshot().stagingCount },
          provenance: {
            adapter: CAPABILITY_ADAPTER_ID, externalToolAdapter: TOOL_ADAPTER_ID,
            toolId: 'org.blender.Blender', operation, license: TOOL_PROVENANCE.license,
            bundledWithMazz: false, networkCalls: 0,
          },
          seed: null,
        });
      } finally {
        signal.removeEventListener('abort', abort);
        activeRuns.delete(proposal.proposalId);
        cancelInFlight.delete(runId);
        try { removeStaging(stage.staging, stage.runDir); } catch (cleanupError) {
          if (!signal.aborted) throw cleanupError;
        }
      }
    },
    async cancel({ proposalId }) {
      const runId = activeRuns.get(proposalId);
      if (!runId) return false;
      const result = await requestCancel(runId);
      return result?.status === 'accepted' || result?.status === 'already-terminal';
    },
    async dispose(reason) {
      activeRuns.clear();
      return runtimeAdapter.dispose(reason || 'app-quit');
    },
  });
}

module.exports = {
  CAPABILITY_ID,
  CAPABILITY_VERSION,
  CAPABILITY_ADAPTER_ID,
  SCENE_SCHEMA,
  OUTPUT_SPECS,
  OPERATIONS,
  createBlenderExternalCapabilityAdapter,
  _forTests: { createStaging, removeStaging, materializeArtifact, syncAvailability },
};
