// W94A strict, portable contracts for durable capability execution facts.
'use strict';

const crypto = require('crypto');

const CAPABILITY_DESCRIPTOR_SCHEMA = 'mazz.capability-descriptor/v1';
const EXECUTION_PROPOSAL_SCHEMA = 'mazz.execution-proposal/v1';
const EXECUTION_LEASE_SCHEMA = 'mazz.execution-lease/v1';
const EXECUTION_RECEIPT_SCHEMA = 'mazz.execution-receipt/v1';
const ARTIFACT_SCHEMA = 'mazz.artifact/v1';
const CAPABILITY_ADAPTER_PROTOCOL = 'mazz.capability-adapter/v1';
const CAPABILITY_STORE_SCHEMA = 'mazz.capability-execution-store/v1';

const CAPABILITY_KINDS = Object.freeze([
  'fixture', 'compute', 'chart', 'canvas', 'blender', 'retrieval', 'transport', 'publish',
]);
const EXECUTION_PLANES = Object.freeze(['main', 'isolated-worker', 'external-process', 'remote-service']);
const DETERMINISM_STATES = Object.freeze(['deterministic', 'seeded', 'nondeterministic', 'external']);
const SAFETY_CLASSES = Object.freeze(['local-safe', 'isolated', 'external-read', 'external-write', 'public-effect']);
const AVAILABILITY_STATES = Object.freeze(['unknown', 'available', 'degraded', 'unavailable']);
const CANCEL_MODES = Object.freeze(['none', 'cooperative', 'process-tree']);
const RESUME_MODES = Object.freeze(['none', 'restart', 'checkpoint']);
const PROPOSAL_STATES = Object.freeze(['proposed', 'queued', 'running', 'paused', 'failed', 'completed', 'cancelled']);
const LEASE_STATES = Object.freeze(['active', 'cancel-requested', 'released']);
const RECEIPT_STATES = Object.freeze(['completed', 'paused', 'cancelled', 'failed', 'quarantined']);

const SECRET_KEY = /(?:password|passwd|secret|token|api[-_]?key|authorization|cookie|credential|access[-_]?key|private[-_]?key)/i;
const SECRET_TEXT = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]{12,}|\bsk-[A-Za-z0-9_-]{16,}|(?:access_token|refresh_token|api_key|apikey|client_secret|password)\s*[:=]\s*[^\s,;]{8,})/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_.-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PRIVATE_LOCATOR = /(?:^|[\s"'(=\[])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|etc|var|tmp|mnt|opt|Volumes)(?:\/|$)|(?:data|file|https?|ftp|wss?|mailto|magnet):)/i;

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed, label) {
  if (!isPlainRecord(value)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是普通对象`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 含未冻结字段: ${unknown.join(', ')}`);
  return value;
}

function exactText(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim() || CONTROL.test(value)) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是精确非空字符串`);
  }
  return value;
}

function optionalExactText(value, label) {
  if (value === undefined || value === null || value === '') return '';
  return exactText(value, label);
}

function safeId(value, label) {
  const text = exactText(value, label);
  if (!SAFE_ID.test(text) || text === '.' || text === '..') {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 不是安全标识`);
  }
  return text;
}

function safeCode(value, label) {
  const text = exactText(value, label);
  if (!SAFE_CODE.test(text)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 不是稳定错误码`);
  return text;
}

function opaqueRef(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  const text = exactText(value, label);
  if (text.includes('\\') || text.startsWith('/') || /(^|\/)\.\.?($|\/)/.test(text)
      || /^[A-Za-z]:/.test(text) || /^\\\\/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是无路径、无 URL 的不透明引用`);
  }
  if (/^(?:data|file|https?|ftp|wss?|mailto|magnet):/i.test(text)) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 不得携带外部 URI`);
  }
  return text;
}

function iso(value, label) {
  const text = exactText(value, label);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是规范 ISO 时间`);
  }
  return text;
}

function positiveRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是正整数`);
  }
  return value;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeHash(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  const text = exactText(value, label);
  const hex = text.startsWith('sha256-') ? text.slice(7) : text;
  if (!SHA256.test(hex)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是完整 SHA-256`);
  return `sha256-${hex}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function clonePortable(value, label = 'value', seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 不能包含 NaN/Infinity`);
    return value;
  }
  if (typeof value !== 'object') throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是可移植 JSON 值`);
  if (seen.has(value)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 不能循环引用`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => clonePortable(item, `${label}[${index}]`, seen));
    if (!isPlainRecord(value)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是普通对象`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePortable(item, `${label}.${key}`, seen)]));
  } finally {
    seen.delete(value);
  }
}

function assertNoSecrets(value, trail = 'value') {
  if (typeof value === 'string') {
    if (SECRET_TEXT.test(value)) throw codedError('CAPABILITY_SECRET_FORBIDDEN', `${trail} 含疑似凭据`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${trail}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw codedError('CAPABILITY_SECRET_FORBIDDEN', `${trail}.${key} 是 secret 字段`);
    assertNoSecrets(item, `${trail}.${key}`);
  }
}

function decodedDetectionViews(value) {
  const views = [value];
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    const decoded = current.replace(/(?:%[0-9a-f]{2})+/gi, run => {
      try { return decodeURIComponent(run); } catch { return run; }
    });
    if (decoded === current) break;
    views.push(decoded);
    current = decoded;
  }
  return views;
}

function assertNoPrivateLocators(value, trail = 'value') {
  if (typeof value === 'string') {
    if (decodedDetectionViews(value).some(view => PRIVATE_LOCATOR.test(view))) {
      throw codedError('CAPABILITY_PRIVATE_LOCATOR_FORBIDDEN', `${trail} 含绝对路径或外部 URI`);
    }
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoPrivateLocators(item, `${trail}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) assertNoPrivateLocators(item, `${trail}.${key}`);
}

function portableRecord(value, label) {
  const result = clonePortable(value ?? {}, label);
  if (!isPlainRecord(result)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是普通对象`);
  assertNoSecrets(result, label);
  assertNoPrivateLocators(result, label);
  return result;
}

function exactStringList(value, label) {
  if (!Array.isArray(value)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 必须是数组`);
  const rows = value.map((item, index) => exactText(item, `${label}[${index}]`));
  if (new Set(rows).size !== rows.length) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 不能重复`);
  return rows;
}

function enumValue(value, allowed, label) {
  const text = exactText(value, label);
  if (!allowed.includes(text)) throw codedError('CAPABILITY_CONTRACT_INVALID', `${label} 不支持: ${text}`);
  return text;
}

function normalizeAvailability(value) {
  exactKeys(value, ['state', 'checkedAt', 'reason', 'evidenceRef'], 'availability');
  return Object.freeze({
    state: enumValue(value.state, AVAILABILITY_STATES, 'availability.state'),
    checkedAt: value.checkedAt ? iso(value.checkedAt, 'availability.checkedAt') : '',
    reason: optionalExactText(value.reason, 'availability.reason'),
    evidenceRef: opaqueRef(value.evidenceRef, 'availability.evidenceRef', { optional: true }),
  });
}

function normalizeCapabilityDescriptor(input) {
  exactKeys(input, [
    'schema', 'capabilityId', 'version', 'adapterId', 'displayName', 'kind', 'executionPlane',
    'inputSchemas', 'outputSchemas', 'determinism', 'safetyClass', 'availability',
    'cancelMode', 'resumeMode', 'provenance',
  ], 'Capability Descriptor');
  if (input.schema !== CAPABILITY_DESCRIPTOR_SCHEMA) throw codedError('CAPABILITY_CONTRACT_INVALID', 'Capability Descriptor schema 不支持');
  const descriptor = {
    schema: CAPABILITY_DESCRIPTOR_SCHEMA,
    capabilityId: safeId(input.capabilityId, 'capabilityId'),
    version: safeId(input.version, 'version'),
    adapterId: safeId(input.adapterId, 'adapterId'),
    displayName: exactText(input.displayName, 'displayName'),
    kind: enumValue(input.kind, CAPABILITY_KINDS, 'kind'),
    executionPlane: enumValue(input.executionPlane, EXECUTION_PLANES, 'executionPlane'),
    inputSchemas: exactStringList(input.inputSchemas, 'inputSchemas'),
    outputSchemas: exactStringList(input.outputSchemas, 'outputSchemas'),
    determinism: enumValue(input.determinism, DETERMINISM_STATES, 'determinism'),
    safetyClass: enumValue(input.safetyClass, SAFETY_CLASSES, 'safetyClass'),
    availability: normalizeAvailability(input.availability),
    cancelMode: enumValue(input.cancelMode, CANCEL_MODES, 'cancelMode'),
    resumeMode: enumValue(input.resumeMode, RESUME_MODES, 'resumeMode'),
    provenance: portableRecord(input.provenance, 'provenance'),
  };
  assertNoSecrets(descriptor, 'Capability Descriptor');
  assertNoPrivateLocators(descriptor.provenance, 'Capability Descriptor.provenance');
  return Object.freeze(descriptor);
}

function descriptorKey(capabilityId, version, adapterId) {
  return canonicalJson([
    safeId(capabilityId, 'capabilityId'), safeId(version, 'version'), safeId(adapterId, 'adapterId'),
  ]);
}

function normalizeArtifactInputRef(input, index = 0) {
  exactKeys(input, ['artifactId', 'contentHash', 'role', 'schema'], `inputs[${index}]`);
  return Object.freeze({
    artifactId: safeId(input.artifactId, `inputs[${index}].artifactId`),
    contentHash: normalizeHash(input.contentHash, `inputs[${index}].contentHash`),
    role: safeId(input.role, `inputs[${index}].role`),
    schema: exactText(input.schema, `inputs[${index}].schema`),
  });
}

function proposalIdentityView(input) {
  return {
    workspaceIdentity: input.workspaceIdentity,
    taskId: input.taskId,
    seatId: input.seatId,
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion,
    adapterId: input.adapterId,
    determinism: input.determinism,
    inputs: input.inputs,
    parameters: input.parameters,
    expectedOutputs: input.expectedOutputs,
    constraints: input.constraints,
    authorityRef: input.authorityRef,
  };
}

function deriveProposalId(input) {
  const view = proposalIdentityView(input);
  return `proposal-sha256-${sha256Hex(canonicalJson(view))}`;
}

function normalizeProposal(input, { now = '', durable = false } = {}) {
  exactKeys(input, [
    'schema', 'proposalId', 'workspaceIdentity', 'taskId', 'seatId', 'capabilityId',
    'capabilityVersion', 'adapterId', 'inputs', 'parameters', 'expectedOutputs', 'constraints',
    'authorityRef', 'determinism', 'state', 'revision', 'createdAt', 'updatedAt', 'activeLeaseId',
    'receiptIds', 'artifactIds', 'failureCode',
  ], 'Execution Proposal');
  if (input.schema !== EXECUTION_PROPOSAL_SCHEMA) throw codedError('CAPABILITY_CONTRACT_INVALID', 'Execution Proposal schema 不支持');
  if (!Array.isArray(input.inputs)) throw codedError('CAPABILITY_CONTRACT_INVALID', 'inputs 必须是数组');
  const createdAt = durable ? iso(input.createdAt, 'createdAt') : (input.createdAt ? iso(input.createdAt, 'createdAt') : iso(now, 'now'));
  const normalized = {
    schema: EXECUTION_PROPOSAL_SCHEMA,
    workspaceIdentity: safeId(input.workspaceIdentity, 'workspaceIdentity'),
    taskId: safeId(input.taskId, 'taskId'),
    seatId: safeId(input.seatId, 'seatId'),
    capabilityId: safeId(input.capabilityId, 'capabilityId'),
    capabilityVersion: safeId(input.capabilityVersion, 'capabilityVersion'),
    adapterId: safeId(input.adapterId, 'adapterId'),
    determinism: enumValue(input.determinism, DETERMINISM_STATES, 'determinism'),
    inputs: input.inputs.map(normalizeArtifactInputRef),
    parameters: portableRecord(input.parameters, 'parameters'),
    expectedOutputs: exactStringList(input.expectedOutputs, 'expectedOutputs'),
    constraints: portableRecord(input.constraints, 'constraints'),
    authorityRef: opaqueRef(input.authorityRef, 'authorityRef'),
  };
  normalized.proposalId = deriveProposalId(normalized);
  if (input.proposalId !== undefined && input.proposalId !== normalized.proposalId) {
    throw codedError('CAPABILITY_PROPOSAL_ID_MISMATCH', 'proposalId 与规范请求不一致');
  }
  const proposal = {
    schema: EXECUTION_PROPOSAL_SCHEMA,
    proposalId: normalized.proposalId,
    ...proposalIdentityView(normalized),
    state: enumValue(input.state || 'proposed', PROPOSAL_STATES, 'state'),
    revision: durable ? positiveRevision(input.revision) : 1,
    createdAt,
    updatedAt: durable ? iso(input.updatedAt, 'updatedAt') : createdAt,
    activeLeaseId: opaqueRef(input.activeLeaseId, 'activeLeaseId', { optional: true }),
    receiptIds: exactStringList(input.receiptIds || [], 'receiptIds').map((value, index) => safeId(value, `receiptIds[${index}]`)),
    artifactIds: exactStringList(input.artifactIds || [], 'artifactIds').map((value, index) => safeId(value, `artifactIds[${index}]`)),
    failureCode: input.failureCode ? safeCode(input.failureCode, 'failureCode') : '',
  };
  if (['running', 'queued'].includes(proposal.state) && !proposal.activeLeaseId) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${proposal.state} proposal 缺 activeLeaseId`);
  }
  if (!['running', 'queued'].includes(proposal.state) && proposal.activeLeaseId) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', `${proposal.state} proposal 不得携带 activeLeaseId`);
  }
  assertNoSecrets(proposal, 'Execution Proposal');
  assertNoPrivateLocators(proposal.parameters, 'Execution Proposal.parameters');
  assertNoPrivateLocators(proposal.constraints, 'Execution Proposal.constraints');
  return Object.freeze(proposal);
}

function normalizeLease(input, { durable = false } = {}) {
  exactKeys(input, [
    'schema', 'leaseId', 'workspaceIdentity', 'proposalId', 'ownerKind', 'ownerId', 'state',
    'acquiredAt', 'heartbeatAt', 'cancelRequestedAt', 'releasedAt', 'releaseReason', 'revision',
  ], 'Execution Lease');
  if (input.schema !== EXECUTION_LEASE_SCHEMA) throw codedError('CAPABILITY_CONTRACT_INVALID', 'Execution Lease schema 不支持');
  const lease = {
    schema: EXECUTION_LEASE_SCHEMA,
    leaseId: safeId(input.leaseId, 'leaseId'),
    workspaceIdentity: safeId(input.workspaceIdentity, 'workspaceIdentity'),
    proposalId: safeId(input.proposalId, 'proposalId'),
    ownerKind: safeId(input.ownerKind, 'ownerKind'),
    ownerId: opaqueRef(input.ownerId, 'ownerId'),
    state: enumValue(input.state, LEASE_STATES, 'state'),
    acquiredAt: iso(input.acquiredAt, 'acquiredAt'),
    heartbeatAt: iso(input.heartbeatAt, 'heartbeatAt'),
    cancelRequestedAt: input.cancelRequestedAt ? iso(input.cancelRequestedAt, 'cancelRequestedAt') : '',
    releasedAt: input.releasedAt ? iso(input.releasedAt, 'releasedAt') : '',
    releaseReason: input.releaseReason ? safeCode(input.releaseReason, 'releaseReason') : '',
    revision: durable ? positiveRevision(input.revision) : 1,
  };
  if (lease.state === 'released' && (!lease.releasedAt || !lease.releaseReason)) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', 'released lease 缺 releasedAt/releaseReason');
  }
  if (lease.state !== 'released' && (lease.releasedAt || lease.releaseReason)) {
    throw codedError('CAPABILITY_CONTRACT_INVALID', '活动 lease 不得携带 release 事实');
  }
  return Object.freeze(lease);
}

function normalizeArtifact(input, { durable = false, createdByReceiptId = '' } = {}) {
  exactKeys(input, [
    'schema', 'artifactId', 'workspaceIdentity', 'kind', 'mediaType', 'contentSchema', 'contentHash',
    'definitionHash', 'storageRef', 'createdByReceiptId', 'sourceArtifacts', 'rightsRef',
    'mutableHead', 'revision', 'createdAt',
  ], 'Artifact');
  if (input.schema !== ARTIFACT_SCHEMA) throw codedError('CAPABILITY_CONTRACT_INVALID', 'Artifact schema 不支持');
  const contentHash = normalizeHash(input.contentHash, 'contentHash');
  const artifactId = `artifact-${contentHash}`;
  if (input.artifactId !== undefined && input.artifactId !== artifactId) {
    throw codedError('CAPABILITY_ARTIFACT_ID_MISMATCH', 'artifactId 与 contentHash 不一致');
  }
  const artifact = {
    schema: ARTIFACT_SCHEMA,
    artifactId,
    workspaceIdentity: safeId(input.workspaceIdentity, 'workspaceIdentity'),
    kind: safeId(input.kind, 'kind'),
    mediaType: exactText(input.mediaType, 'mediaType'),
    contentSchema: exactText(input.contentSchema, 'contentSchema'),
    contentHash,
    definitionHash: normalizeHash(input.definitionHash, 'definitionHash', { optional: true }),
    storageRef: opaqueRef(input.storageRef, 'storageRef'),
    createdByReceiptId: safeId(input.createdByReceiptId || createdByReceiptId, 'createdByReceiptId'),
    sourceArtifacts: exactStringList(input.sourceArtifacts || [], 'sourceArtifacts').map((value, index) => safeId(value, `sourceArtifacts[${index}]`)),
    rightsRef: opaqueRef(input.rightsRef, 'rightsRef', { optional: true }),
    mutableHead: input.mutableHead === true,
    revision: durable ? positiveRevision(input.revision) : 1,
    createdAt: iso(input.createdAt, 'createdAt'),
  };
  return Object.freeze(artifact);
}

function normalizeReceipt(input, { durable = false } = {}) {
  exactKeys(input, [
    'schema', 'receiptId', 'proposalId', 'leaseId', 'workspaceIdentity', 'capability', 'state',
    'inputFacts', 'outputFacts', 'environment', 'determinism', 'seed', 'startedAt', 'finishedAt',
    'diagnostics', 'resourceFinal', 'provenance', 'revision',
  ], 'Execution Receipt');
  if (input.schema !== EXECUTION_RECEIPT_SCHEMA) throw codedError('CAPABILITY_CONTRACT_INVALID', 'Execution Receipt schema 不支持');
  exactKeys(input.capability, ['id', 'version', 'adapterId'], 'receipt.capability');
  exactKeys(input.diagnostics, ['code', 'summaryRef'], 'receipt.diagnostics');
  const receipt = {
    schema: EXECUTION_RECEIPT_SCHEMA,
    receiptId: safeId(input.receiptId, 'receiptId'),
    proposalId: safeId(input.proposalId, 'proposalId'),
    leaseId: safeId(input.leaseId, 'leaseId'),
    workspaceIdentity: safeId(input.workspaceIdentity, 'workspaceIdentity'),
    capability: {
      id: safeId(input.capability.id, 'capability.id'),
      version: safeId(input.capability.version, 'capability.version'),
      adapterId: safeId(input.capability.adapterId, 'capability.adapterId'),
    },
    state: enumValue(input.state, RECEIPT_STATES, 'receipt.state'),
    inputFacts: input.inputFacts.map(normalizeArtifactInputRef),
    outputFacts: exactStringList(input.outputFacts || [], 'outputFacts').map((value, index) => safeId(value, `outputFacts[${index}]`)),
    environment: portableRecord(input.environment, 'environment'),
    determinism: enumValue(input.determinism, DETERMINISM_STATES, 'receipt.determinism'),
    seed: input.seed === undefined || input.seed === null ? null : clonePortable(input.seed, 'seed'),
    startedAt: iso(input.startedAt, 'startedAt'),
    finishedAt: iso(input.finishedAt, 'finishedAt'),
    diagnostics: {
      code: safeCode(input.diagnostics.code, 'diagnostics.code'),
      summaryRef: opaqueRef(input.diagnostics.summaryRef, 'diagnostics.summaryRef', { optional: true }),
    },
    resourceFinal: portableRecord(input.resourceFinal, 'resourceFinal'),
    provenance: portableRecord(input.provenance, 'provenance'),
    revision: durable ? positiveRevision(input.revision) : 1,
  };
  assertNoSecrets(receipt, 'Execution Receipt');
  assertNoPrivateLocators(receipt.environment, 'Execution Receipt.environment');
  assertNoPrivateLocators(receipt.resourceFinal, 'Execution Receipt.resourceFinal');
  assertNoPrivateLocators(receipt.provenance, 'Execution Receipt.provenance');
  return Object.freeze(receipt);
}

function normalizeStoreState(input, { workspaceIdentity, durable = false, now = '' } = {}) {
  exactKeys(input, ['schema', 'workspaceIdentity', 'revision', 'createdAt', 'updatedAt', 'proposals', 'leases', 'receipts', 'artifacts'], 'Capability Store');
  if (input.schema !== CAPABILITY_STORE_SCHEMA) throw codedError('CAPABILITY_STORE_CORRUPT', 'Capability Store schema 不支持');
  const identity = safeId(input.workspaceIdentity, 'workspaceIdentity');
  if (workspaceIdentity && identity !== workspaceIdentity) throw codedError('CAPABILITY_STORE_WORKSPACE_MISMATCH', 'Capability Store Workspace identity 不一致');
  for (const field of ['proposals', 'leases', 'receipts', 'artifacts']) {
    if (!Array.isArray(input[field])) throw codedError('CAPABILITY_STORE_CORRUPT', `Capability Store ${field} 必须是数组`);
  }
  const createdAt = durable ? iso(input.createdAt, 'createdAt') : iso(input.createdAt || now, 'createdAt');
  const state = {
    schema: CAPABILITY_STORE_SCHEMA,
    workspaceIdentity: identity,
    revision: durable ? positiveRevision(input.revision) : 1,
    createdAt,
    updatedAt: durable ? iso(input.updatedAt, 'updatedAt') : createdAt,
    proposals: input.proposals.map(value => normalizeProposal(value, { durable: true })),
    leases: input.leases.map(value => normalizeLease(value, { durable: true })),
    receipts: input.receipts.map(value => normalizeReceipt(value, { durable: true })),
    artifacts: input.artifacts.map(value => normalizeArtifact(value, { durable: true })),
  };
  for (const [field, key] of [['proposals', 'proposalId'], ['leases', 'leaseId'], ['receipts', 'receiptId'], ['artifacts', 'artifactId']]) {
    const ids = state[field].map(row => row[key]);
    if (new Set(ids).size !== ids.length) throw codedError('CAPABILITY_STORE_CORRUPT', `Capability Store ${field} 身份重复`);
  }
  const proposalIds = new Set(state.proposals.map(row => row.proposalId));
  const leaseIds = new Set(state.leases.map(row => row.leaseId));
  const receiptIds = new Set(state.receipts.map(row => row.receiptId));
  const artifactIds = new Set(state.artifacts.map(row => row.artifactId));
  for (const lease of state.leases) if (!proposalIds.has(lease.proposalId)) throw codedError('CAPABILITY_STORE_CORRUPT', 'Lease 引用未知 Proposal');
  for (const receipt of state.receipts) {
    if (!proposalIds.has(receipt.proposalId) || !leaseIds.has(receipt.leaseId)) throw codedError('CAPABILITY_STORE_CORRUPT', 'Receipt 引用未知 Proposal/Lease');
    if (receipt.outputFacts.some(id => !artifactIds.has(id))) throw codedError('CAPABILITY_STORE_CORRUPT', 'Receipt 引用未知 Artifact');
  }
  for (const artifact of state.artifacts) if (!receiptIds.has(artifact.createdByReceiptId)) throw codedError('CAPABILITY_STORE_CORRUPT', 'Artifact 引用未知 Receipt');
  for (const proposal of state.proposals) {
    if (proposal.activeLeaseId && !leaseIds.has(proposal.activeLeaseId)) throw codedError('CAPABILITY_STORE_CORRUPT', 'Proposal 引用未知 active Lease');
    if (proposal.receiptIds.some(id => !receiptIds.has(id))) throw codedError('CAPABILITY_STORE_CORRUPT', 'Proposal 引用未知 Receipt');
    if (proposal.artifactIds.some(id => !artifactIds.has(id))) throw codedError('CAPABILITY_STORE_CORRUPT', 'Proposal 引用未知 Artifact');
  }
  return Object.freeze(state);
}

function normalizeAdapter(adapter) {
  if (!isPlainRecord(adapter) && (typeof adapter !== 'object' || adapter === null)) {
    throw codedError('CAPABILITY_ADAPTER_INVALID', 'Capability Adapter 必须是对象');
  }
  if (adapter.protocol !== CAPABILITY_ADAPTER_PROTOCOL) throw codedError('CAPABILITY_ADAPTER_INVALID', 'Capability Adapter protocol 不兼容');
  const descriptor = normalizeCapabilityDescriptor(adapter.descriptor);
  if (typeof adapter.execute !== 'function') throw codedError('CAPABILITY_ADAPTER_INVALID', 'Capability Adapter 缺 execute');
  if (adapter.cancel !== undefined && typeof adapter.cancel !== 'function') throw codedError('CAPABILITY_ADAPTER_INVALID', 'Capability Adapter cancel 非函数');
  if (adapter.dispose !== undefined && typeof adapter.dispose !== 'function') throw codedError('CAPABILITY_ADAPTER_INVALID', 'Capability Adapter dispose 非函数');
  return Object.freeze({
    protocol: CAPABILITY_ADAPTER_PROTOCOL,
    descriptor,
    execute: adapter.execute.bind(adapter),
    cancel: typeof adapter.cancel === 'function' ? adapter.cancel.bind(adapter) : null,
    dispose: typeof adapter.dispose === 'function' ? adapter.dispose.bind(adapter) : null,
  });
}

module.exports = {
  CAPABILITY_DESCRIPTOR_SCHEMA,
  EXECUTION_PROPOSAL_SCHEMA,
  EXECUTION_LEASE_SCHEMA,
  EXECUTION_RECEIPT_SCHEMA,
  ARTIFACT_SCHEMA,
  CAPABILITY_ADAPTER_PROTOCOL,
  CAPABILITY_STORE_SCHEMA,
  CAPABILITY_KINDS,
  EXECUTION_PLANES,
  DETERMINISM_STATES,
  SAFETY_CLASSES,
  AVAILABILITY_STATES,
  CANCEL_MODES,
  RESUME_MODES,
  PROPOSAL_STATES,
  LEASE_STATES,
  RECEIPT_STATES,
  codedError,
  isPlainRecord,
  exactKeys,
  exactText,
  optionalExactText,
  safeId,
  safeCode,
  opaqueRef,
  iso,
  positiveRevision,
  sha256Hex,
  normalizeHash,
  canonicalJson,
  clonePortable,
  assertNoSecrets,
  assertNoPrivateLocators,
  portableRecord,
  exactStringList,
  normalizeCapabilityDescriptor,
  descriptorKey,
  normalizeArtifactInputRef,
  deriveProposalId,
  normalizeProposal,
  normalizeLease,
  normalizeArtifact,
  normalizeReceipt,
  normalizeStoreState,
  normalizeAdapter,
};
