'use strict';

const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  optionalString,
  requiredString,
} = require('./plain-value');

const EXTERNAL_TOOL_ADAPTER_PROTOCOL = 'mazz.external-tool-adapter/v0';
const EXTERNAL_TOOL_PROBE_SCHEMA = 'mazz.external-tool-probe/v0';
const EXTERNAL_TOOL_RUN_REQUEST_SCHEMA = 'mazz.external-tool-run-request/v0';
const EXTERNAL_TOOL_RUN_RESULT_SCHEMA = 'mazz.external-tool-run-result/v0';
const EXTERNAL_TOOL_CANCEL_RESULT_SCHEMA = 'mazz.external-tool-cancel-result/v0';
const EXTERNAL_TOOL_DISPOSE_RESULT_SCHEMA = 'mazz.external-tool-dispose-result/v0';

const RUN_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled']);
const CANCEL_STATUSES = Object.freeze(['accepted', 'cancelled', 'already-terminal', 'not-found']);

function requirePlain(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function requireSchema(value, expected, label) {
  if (value != null && value !== expected) throw new Error(`不支持的 ${label} schema: ${value}`);
}

function requireList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function normalizeInputAsset(value, index) {
  requirePlain(value, `inputs[${index}]`);
  assertKnownKeys(value, ['role', 'id', 'path', 'type', 'version'], `inputs[${index}]`);
  return {
    role: requiredString(value.role, `inputs[${index}].role`),
    id: requiredString(value.id, `inputs[${index}].id`),
    path: requiredString(value.path, `inputs[${index}].path`),
    type: requiredString(value.type, `inputs[${index}].type`),
    version: requiredString(value.version, `inputs[${index}].version`),
  };
}

function normalizeOutputTarget(value, index) {
  requirePlain(value, `outputs[${index}]`);
  assertKnownKeys(value, ['role', 'path', 'type'], `outputs[${index}]`);
  return {
    role: requiredString(value.role, `outputs[${index}].role`),
    path: requiredString(value.path, `outputs[${index}].path`),
    type: requiredString(value.type, `outputs[${index}].type`),
  };
}

function normalizeProducedAsset(value, index) {
  requirePlain(value, `outputs[${index}]`);
  assertKnownKeys(value, ['role', 'id', 'path', 'type', 'version'], `outputs[${index}]`);
  return {
    role: requiredString(value.role, `outputs[${index}].role`),
    id: requiredString(value.id, `outputs[${index}].id`),
    path: requiredString(value.path, `outputs[${index}].path`),
    type: requiredString(value.type, `outputs[${index}].type`),
    version: requiredString(value.version, `outputs[${index}].version`),
  };
}

function normalizeExternalToolProbe(input) {
  requirePlain(input, 'Tool Probe');
  assertKnownKeys(input, [
    'schema', 'adapterId', 'available', 'executablePath', 'version', 'reason', 'provenance',
  ], 'Tool Probe');
  requireSchema(input.schema, EXTERNAL_TOOL_PROBE_SCHEMA, 'Tool Probe');
  if (typeof input.available !== 'boolean') throw new Error('available 必须是布尔值');
  requirePlain(input.provenance, 'provenance');
  const available = input.available;
  const executablePath = available
    ? requiredString(input.executablePath, 'executablePath')
    : optionalString(input.executablePath);
  const version = available ? requiredString(input.version, 'version') : optionalString(input.version);
  const reason = optionalString(input.reason);
  if (!available && !reason) throw new Error('不可用的 Tool Probe 必须给出 reason');
  return deepFreeze({
    schema: EXTERNAL_TOOL_PROBE_SCHEMA,
    adapterId: requiredString(input.adapterId, 'adapterId'),
    available,
    executablePath,
    version,
    reason,
    provenance: clonePlain(input.provenance, 'provenance'),
  });
}

function normalizeExternalToolRunRequest(input) {
  requirePlain(input, 'Tool Run Request');
  assertKnownKeys(input, [
    'schema', 'runId', 'operation', 'workdir', 'inputs', 'outputs', 'provenance',
  ], 'Tool Run Request');
  requireSchema(input.schema, EXTERNAL_TOOL_RUN_REQUEST_SCHEMA, 'Tool Run Request');
  requirePlain(input.provenance, 'provenance');
  return deepFreeze({
    schema: EXTERNAL_TOOL_RUN_REQUEST_SCHEMA,
    runId: requiredString(input.runId, 'runId'),
    operation: requiredString(input.operation, 'operation'),
    workdir: requiredString(input.workdir, 'workdir'),
    inputs: requireList(input.inputs, 'inputs').map(normalizeInputAsset),
    outputs: requireList(input.outputs, 'outputs').map(normalizeOutputTarget),
    provenance: clonePlain(input.provenance, 'provenance'),
  });
}

function normalizeExit(input) {
  requirePlain(input, 'exit');
  assertKnownKeys(input, ['code', 'signal', 'reason'], 'exit');
  const code = input.code == null ? null : input.code;
  if (code != null && !Number.isInteger(code)) throw new Error('exit.code 必须是整数或 null');
  return {
    code,
    signal: optionalString(input.signal),
    reason: optionalString(input.reason),
  };
}

function normalizeCapturedText(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
  return value;
}

function normalizeExternalToolRunResult(input) {
  requirePlain(input, 'Tool Run Result');
  assertKnownKeys(input, [
    'schema', 'runId', 'status', 'stdout', 'stderr', 'exit', 'durationMs', 'outputs', 'provenance',
  ], 'Tool Run Result');
  requireSchema(input.schema, EXTERNAL_TOOL_RUN_RESULT_SCHEMA, 'Tool Run Result');
  const status = requiredString(input.status, 'status');
  if (!RUN_STATUSES.includes(status)) throw new Error(`不支持的 run status: ${status}`);
  const exit = normalizeExit(input.exit);
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new Error('durationMs 必须是非负有限数');
  if (status === 'succeeded' && exit.code !== 0) throw new Error('succeeded 必须对应 exit.code=0');
  if (status === 'failed' && exit.code === 0 && !exit.signal && !exit.reason) {
    throw new Error('failed 必须给出非零 exit.code、signal 或 reason');
  }
  if (status === 'cancelled' && !exit.reason) throw new Error('cancelled 必须给出 exit.reason');
  requirePlain(input.provenance, 'provenance');
  return deepFreeze({
    schema: EXTERNAL_TOOL_RUN_RESULT_SCHEMA,
    runId: requiredString(input.runId, 'runId'),
    status,
    stdout: normalizeCapturedText(input.stdout, 'stdout'),
    stderr: normalizeCapturedText(input.stderr, 'stderr'),
    exit,
    durationMs: input.durationMs,
    outputs: requireList(input.outputs, 'outputs').map(normalizeProducedAsset),
    provenance: clonePlain(input.provenance, 'provenance'),
  });
}

function normalizeExternalToolCancelResult(input) {
  requirePlain(input, 'Tool Cancel Result');
  assertKnownKeys(input, ['schema', 'runId', 'status', 'reason'], 'Tool Cancel Result');
  requireSchema(input.schema, EXTERNAL_TOOL_CANCEL_RESULT_SCHEMA, 'Tool Cancel Result');
  const status = requiredString(input.status, 'status');
  if (!CANCEL_STATUSES.includes(status)) throw new Error(`不支持的 cancel status: ${status}`);
  return deepFreeze({
    schema: EXTERNAL_TOOL_CANCEL_RESULT_SCHEMA,
    runId: requiredString(input.runId, 'runId'),
    status,
    reason: optionalString(input.reason),
  });
}

function normalizeExternalToolDisposeResult(input) {
  requirePlain(input, 'Tool Dispose Result');
  assertKnownKeys(input, ['schema', 'adapterId', 'status', 'activeRuns', 'reason'], 'Tool Dispose Result');
  requireSchema(input.schema, EXTERNAL_TOOL_DISPOSE_RESULT_SCHEMA, 'Tool Dispose Result');
  if (input.status !== 'disposed') throw new Error('dispose status 必须是 disposed');
  if (input.activeRuns !== 0) throw new Error('dispose 完成时 activeRuns 必须为 0');
  return deepFreeze({
    schema: EXTERNAL_TOOL_DISPOSE_RESULT_SCHEMA,
    adapterId: requiredString(input.adapterId, 'adapterId'),
    status: 'disposed',
    activeRuns: 0,
    reason: optionalString(input.reason),
  });
}

function defineExternalToolAdapter(input) {
  requirePlain(input, 'External Tool Adapter');
  assertKnownKeys(input, [
    'protocol', 'id', 'toolId', 'displayName', 'provenance', 'probe', 'run', 'cancel', 'dispose',
  ], 'External Tool Adapter');
  requireSchema(input.protocol, EXTERNAL_TOOL_ADAPTER_PROTOCOL, 'External Tool Adapter');
  requirePlain(input.provenance, 'provenance');
  for (const name of ['probe', 'run', 'cancel', 'dispose']) {
    if (typeof input[name] !== 'function') throw new Error(`${name} 必须是函数`);
  }
  return Object.freeze({
    protocol: EXTERNAL_TOOL_ADAPTER_PROTOCOL,
    id: requiredString(input.id, 'id'),
    toolId: requiredString(input.toolId, 'toolId'),
    displayName: optionalString(input.displayName) || requiredString(input.id, 'id'),
    provenance: deepFreeze(clonePlain(input.provenance, 'provenance')),
    probe: input.probe,
    run: input.run,
    cancel: input.cancel,
    dispose: input.dispose,
  });
}

module.exports = {
  CANCEL_STATUSES,
  EXTERNAL_TOOL_ADAPTER_PROTOCOL,
  EXTERNAL_TOOL_CANCEL_RESULT_SCHEMA,
  EXTERNAL_TOOL_DISPOSE_RESULT_SCHEMA,
  EXTERNAL_TOOL_PROBE_SCHEMA,
  EXTERNAL_TOOL_RUN_REQUEST_SCHEMA,
  EXTERNAL_TOOL_RUN_RESULT_SCHEMA,
  RUN_STATUSES,
  defineExternalToolAdapter,
  normalizeExternalToolCancelResult,
  normalizeExternalToolDisposeResult,
  normalizeExternalToolProbe,
  normalizeExternalToolRunRequest,
  normalizeExternalToolRunResult,
};
