// main/agent-execution-contracts.js —— W66-R0d 执行结果、句柄、重试、CAS 与完整性合同
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HANDLE_SCHEMA = 'mazz.typed-handle/v0';
const RESULT_SCHEMA = 'mazz.result-envelope/v0';
const OUTPUT_RECEIPT_SCHEMA = 'mazz.output-completeness-receipt/v0';
const PATCH_BASE_SCHEMA = 'mazz.patch-base/v0';
const HANDLE_KINDS = Object.freeze({
  AgentSessionHandle: ['send', 'interrupt', 'dispose', 'events'],
  ProcessSessionHandle: ['write', 'wait', 'terminate', 'dispose'],
  ExecCellHandle: ['wait', 'terminate'],
  ToolCallHandle: ['wait', 'cancel'],
  ArtifactRef: ['read', 'verify'],
});
const RESULT_TAGS = new Set(['SUCCESS', 'ERROR', 'PARTIAL', 'TRUNCATED', 'EMPTY', 'BLOCKED']);

class ExecutionContractError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ExecutionContractError';
    this.code = code;
    this.retryable = false;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ExecutionContractError(code, message, details);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('EXECUTION_CONTRACT_INVALID', `${label} 必填`);
  return normalized;
}

function createTypedHandle({ kind, id, ownerTool, continuations = null, lifecycle = 'active', metadata = {} } = {}) {
  const normalizedKind = requiredString(kind, 'handle.kind');
  if (!Object.hasOwn(HANDLE_KINDS, normalizedKind)) fail('HANDLE_KIND_INVALID', `未知 Handle kind: ${normalizedKind}`);
  const allowed = continuations == null ? HANDLE_KINDS[normalizedKind] : continuations;
  if (!Array.isArray(allowed) || allowed.some(item => !HANDLE_KINDS[normalizedKind].includes(item))) {
    fail('HANDLE_CONTINUATION_INVALID', `${normalizedKind} continuations 超出允许集合`);
  }
  return Object.freeze({
    schemaVersion: HANDLE_SCHEMA,
    kind: normalizedKind,
    id: requiredString(id, 'handle.id'),
    ownerTool: requiredString(ownerTool, 'handle.ownerTool'),
    continuations: [...new Set(allowed.map(item => requiredString(item, 'continuation')))].sort(),
    lifecycle: requiredString(lifecycle, 'handle.lifecycle'),
    metadata: stableValue(metadata && typeof metadata === 'object' ? metadata : {}),
  });
}

function assertTypedContinuation(handle, { kind, ownerTool = '', continuation } = {}) {
  if (!handle || handle.schemaVersion !== HANDLE_SCHEMA) fail('TYPED_HANDLE_REQUIRED', 'Continuation 必须使用 Typed Handle');
  if (kind && handle.kind !== kind) fail('HANDLE_KIND_MISMATCH', `需要 ${kind}，实际 ${handle.kind}`);
  if (ownerTool && handle.ownerTool !== ownerTool) fail('HANDLE_OWNER_MISMATCH', `Handle owner 应为 ${ownerTool}`);
  const action = requiredString(continuation, 'continuation');
  if (!handle.continuations.includes(action)) fail('HANDLE_CONTINUATION_INVALID', `${handle.kind} 不允许 ${action}`);
  if (handle.lifecycle !== 'active') fail('HANDLE_NOT_ACTIVE', `Handle 已处于 ${handle.lifecycle}`);
  return true;
}

function normalizeError(value, fallbackCode = 'EXECUTION_FAILED') {
  if (!value) return null;
  const source = value instanceof Error ? value : value;
  return {
    code: String(source.code || fallbackCode),
    message: String(source.message || source || '执行失败'),
    retryable: !!source.retryable,
  };
}

function normalizeResultEnvelope(input = {}, { intent = 'ACCEPTANCE' } = {}) {
  const source = input && typeof input === 'object' ? input : { structured: input };
  const outerStatus = source.outerStatus === 'error' ? 'error' : 'success';
  const exitCode = Number.isInteger(source.exitCode) ? source.exitCode : null;
  const stdout = String(source.stdout || '');
  const stderr = String(source.stderr || '');
  const truncated = source.truncated === true || source.truncation?.truncated === true;
  const explicitComplete = source.complete !== false;
  const error = normalizeError(source.error || (outerStatus === 'error' ? { code: 'OUTER_FAILURE', message: stderr || '外层调用失败' } : null));
  const innerNonzero = exitCode != null && exitCode !== 0;
  const redExpected = intent === 'RED_EXPECTED';
  const blocked = source.blocked === true || error?.code?.startsWith('BLOCKED') || error?.code === 'PERMISSION_DENIED';
  const ok = !error && !blocked && (!innerNonzero || redExpected) && !truncated && explicitComplete;
  const complete = explicitComplete && !truncated;
  const hasValue = stdout.length > 0 || stderr.length > 0 || source.structured != null;
  let tag = 'SUCCESS';
  if (blocked) tag = 'BLOCKED';
  else if (error || (innerNonzero && !redExpected)) tag = 'ERROR';
  else if (truncated) tag = 'TRUNCATED';
  else if (!complete) tag = 'PARTIAL';
  else if (!hasValue) tag = 'EMPTY';
  if (!RESULT_TAGS.has(tag)) fail('RESULT_TAG_INVALID', `未知结果标签: ${tag}`);
  return Object.freeze({
    schemaVersion: RESULT_SCHEMA,
    tag,
    ok,
    complete,
    outerStatus,
    exitCode,
    stdout,
    stderr,
    structured: source.structured ?? null,
    error: error || (innerNonzero && !redExpected ? { code: 'INNER_EXIT_NONZERO', message: `进程退出码 ${exitCode}`, retryable: false } : null),
    truncation: { truncated, cursor: source.truncation?.cursor ?? source.cursor ?? null },
    intent,
  });
}

function assertResultAcceptable(envelope, { allowEmpty = false } = {}) {
  if (!envelope || envelope.schemaVersion !== RESULT_SCHEMA) fail('RESULT_ENVELOPE_REQUIRED', '必须先规范化 Result Envelope');
  if (!envelope.ok) fail(envelope.error?.code || `RESULT_${envelope.tag}`, envelope.error?.message || `结果不可接受: ${envelope.tag}`);
  if (!envelope.complete) fail('OUTPUT_INCOMPLETE', '结果不完整，不能关闭 Gate');
  if (!allowEmpty && envelope.tag === 'EMPTY') fail('OUTPUT_EMPTY', '空结果不能关闭 Gate');
  return envelope;
}

function failureSignature({ tool, args = {}, error = {}, relevantState = {} } = {}) {
  const normalized = {
    tool: requiredString(tool, 'failure.tool'),
    args: stableValue(args),
    error: { code: String(error.code || ''), name: String(error.name || ''), message: String(error.message || error || '') },
    relevantState: stableValue(relevantState),
  };
  return sha256(Buffer.from(canonicalJson(normalized), 'utf8'));
}

class RetryBudget {
  constructor({ maxAttempts = 3 } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) fail('RETRY_BUDGET_INVALID', 'maxAttempts 必须是正整数');
    this.maxAttempts = maxAttempts;
    this.attemptCount = 0;
    this.lastSignature = '';
  }

  authorize({ signature, changedPrecondition = false } = {}) {
    const normalized = requiredString(signature, 'failureSignature');
    if (this.lastSignature === normalized && !changedPrecondition) {
      fail('UNCHANGED_RETRY_FORBIDDEN', '失败签名与前置条件均未改变，禁止原样重试');
    }
    if (this.attemptCount >= this.maxAttempts) fail('RETRY_BUDGET_EXHAUSTED', '重试预算已耗尽');
    this.attemptCount += 1;
    this.lastSignature = normalized;
    return Object.freeze({ attemptCount: this.attemptCount, remainingBudget: this.maxAttempts - this.attemptCount, failureSignature: normalized, changedPrecondition: !!changedPrecondition });
  }
}

function capturePatchBase(filePath, fsImpl = fs) {
  const resolved = path.resolve(requiredString(filePath, 'patch.path'));
  let bytes;
  let stat;
  try { bytes = fsImpl.readFileSync(resolved); stat = fsImpl.statSync(resolved); }
  catch (error) { fail('PATCH_BASE_UNREADABLE', `无法读取 Patch Base: ${resolved}`, { cause: error?.code || '' }); }
  return Object.freeze({
    schemaVersion: PATCH_BASE_SCHEMA,
    path: resolved,
    sha256: sha256(bytes),
    byteLength: bytes.length,
    mtimeMs: Number(stat.mtimeMs),
  });
}

function assertPatchBase(base, fsImpl = fs) {
  if (!base || base.schemaVersion !== PATCH_BASE_SCHEMA) fail('PATCH_BASE_REQUIRED', 'Patch CAS 缺少 Patch Base');
  const current = capturePatchBase(base.path, fsImpl);
  if (current.sha256 !== base.sha256 || current.byteLength !== base.byteLength || current.mtimeMs !== base.mtimeMs) {
    fail('STALE_PATCH', `Patch Base 已变化，必须重读: ${base.path}`, { expected: base, actual: current });
  }
  return true;
}

function createOutputReceipt({ complete, truncated = false, cursor = null, totalItems = null, lineCount = null, bytes = null } = {}) {
  if (typeof complete !== 'boolean' || typeof truncated !== 'boolean') fail('OUTPUT_RECEIPT_INVALID', 'complete/truncated 必须是 boolean');
  if (complete && truncated) fail('OUTPUT_RECEIPT_INVALID', 'complete=true 与 truncated=true 不能并存');
  const payload = bytes == null ? null : Buffer.from(bytes);
  return Object.freeze({
    schemaVersion: OUTPUT_RECEIPT_SCHEMA,
    complete,
    truncated,
    cursor,
    totalItems: totalItems == null ? null : Number(totalItems),
    lineCount: lineCount == null ? null : Number(lineCount),
    hash: payload == null ? null : sha256(payload),
    byteLength: payload == null ? null : payload.length,
  });
}

function assertOutputComplete(receipt) {
  if (!receipt || receipt.schemaVersion !== OUTPUT_RECEIPT_SCHEMA) fail('OUTPUT_RECEIPT_REQUIRED', '缺少 Output Completeness Receipt');
  if (!receipt.complete || receipt.truncated) fail('OUTPUT_INCOMPLETE', '输出分页/截断未收齐，不能关闭 Gate');
  const hasBound = receipt.hash || receipt.totalItems != null || receipt.lineCount != null;
  if (!hasBound) fail('OUTPUT_RECEIPT_UNBOUNDED', '完整输出必须提供 hash、totalItems 或 lineCount');
  return true;
}

module.exports = {
  HANDLE_SCHEMA,
  RESULT_SCHEMA,
  OUTPUT_RECEIPT_SCHEMA,
  PATCH_BASE_SCHEMA,
  HANDLE_KINDS,
  RESULT_TAGS,
  ExecutionContractError,
  createTypedHandle,
  assertTypedContinuation,
  normalizeResultEnvelope,
  assertResultAcceptable,
  failureSignature,
  RetryBudget,
  capturePatchBase,
  assertPatchBase,
  createOutputReceipt,
  assertOutputComplete,
};
