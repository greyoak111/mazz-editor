// main/agent-activation-gates.js —— W66-R0e Spawn / Completion / Secret / Incident Gate
'use strict';

const crypto = require('crypto');
const { loadDoctrineInjectionBundle } = require('./agent-doctrine');

const SPAWN_RECEIPT_SCHEMA = 'mazz.agent-spawn-gate-receipt/v0';
const COMPLETION_RECEIPT_SCHEMA = 'mazz.completion-receipt/v0';
const SECRET_SCAN_SCHEMA = 'mazz.secret-scan-receipt/v0';
const INCIDENT_CLOSURE_SCHEMA = 'mazz.incident-closure/v0';
const GATE_REGISTRY_SCHEMA = 'mazz.gate-registry/v0';
const REGRESSION_REGISTRY_SCHEMA = 'mazz.regression-registry/v0';
const SHA256 = /^[a-f0-9]{64}$/;

class ActivationGateError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ActivationGateError';
    this.code = code;
    this.retryable = false;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ActivationGateError(code, message, details);
}

function requiredString(value, label, code = 'ACTIVATION_GATE_INVALID') {
  const normalized = String(value || '').trim();
  if (!normalized) fail(code, `${label} 必填`);
  return normalized;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createSpawnGate({ bundleLoader = loadDoctrineInjectionBundle, clock = () => new Date() } = {}) {
  return async function evaluateSpawnGate(activation = {}) {
    const doctrineRoot = requiredString(activation.doctrineRoot, 'activation.doctrineRoot', 'RULE_PACK_REQUIRED');
    const attemptId = requiredString(activation.attemptId, 'activation.attemptId', 'RULE_PACK_REQUIRED');
    const permission = activation.permissionPreview;
    if (!permission || typeof permission !== 'object') fail('PERMISSION_PREVIEW_REQUIRED', '创建 Agent Session 前必须完成权限预览');
    const permissionProfileRef = requiredString(permission.profileRef, 'permissionPreview.profileRef', 'PERMISSION_PREVIEW_REQUIRED');
    if (!['approved', 'restricted'].includes(permission.status)) fail('PERMISSION_PREVIEW_REQUIRED', '权限预览必须是 approved/restricted');
    const bundle = await Promise.resolve(bundleLoader({ doctrineRoot, attemptId }));
    if (!bundle?.manifest || !bundle?.rawSource || !bundle?.compiledView) fail('COMPILED_MANIFEST_INVALID', 'Doctrine Injection Bundle 不完整');
    if (bundle.rawSource.length !== bundle.manifest.canonicalSource?.byteLength) fail('RULE_PACK_HASH_MISMATCH', 'Raw Rule Pack byteLength 不匹配');
    const rawHash = sha256(bundle.rawSource);
    if (rawHash !== bundle.manifest.canonicalSource?.sha256) fail('RULE_PACK_HASH_MISMATCH', 'Raw Rule Pack hash 不匹配');
    if (bundle.compiledView.rawSource?.injection !== 'REQUIRED_FULL_BYTES') fail('COMPILED_MANIFEST_INVALID', 'Compiled View 未要求全文注入');
    const receipt = Object.freeze({
      schemaVersion: SPAWN_RECEIPT_SCHEMA,
      attemptId,
      rulePackId: bundle.manifest.rulePackId,
      rulePackHash: rawHash,
      compiledRulePackHash: bundle.manifest.compiledRulePackHash,
      permissionProfileRef,
      permissionStatus: permission.status,
      evaluatedAt: clock().toISOString(),
      spawnAllowed: true,
      childProcessCreated: false,
    });
    return Object.freeze({ receipt, injection: Object.freeze({ rawSource: bundle.rawSource, rawSourceText: bundle.rawSourceText, compiledView: bundle.compiledView, manifest: bundle.manifest }) });
  };
}

function createCompletionReceipt(input = {}) {
  const status = requiredString(input.status, 'completion.status', 'COMPLETION_EVIDENCE_INCOMPLETE');
  const receipt = {
    schemaVersion: COMPLETION_RECEIPT_SCHEMA,
    status,
    exactGateId: requiredString(input.exactGateId, 'completion.exactGateId', 'COMPLETION_EVIDENCE_INCOMPLETE'),
    artifactRefs: Array.isArray(input.artifactRefs) ? input.artifactRefs : [],
    testsRun: Array.isArray(input.testsRun) ? input.testsRun : [],
    testsNotRun: Array.isArray(input.testsNotRun) ? input.testsNotRun : [],
    acceptancePaths: input.acceptancePaths && typeof input.acceptancePaths === 'object' ? input.acceptancePaths : {},
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
    artifactHashes: input.artifactHashes && typeof input.artifactHashes === 'object' ? input.artifactHashes : {},
    commit: String(input.commit || ''),
    remoteState: String(input.remoteState || ''),
    remainingWork: Array.isArray(input.remainingWork) ? input.remainingWork : [],
    sourceManifest: input.sourceManifest && typeof input.sourceManifest === 'object' ? input.sourceManifest : { required: [], retrieved: [], missing: [] },
  };
  return Object.freeze(receipt);
}

function assertCompletionGate(receipt) {
  if (!receipt || receipt.schemaVersion !== COMPLETION_RECEIPT_SCHEMA) fail('COMPLETION_EVIDENCE_INCOMPLETE', '缺少 Completion Receipt');
  const requiredCollections = ['artifactRefs', 'testsRun', 'testsNotRun', 'evidenceRefs', 'remainingWork'];
  if (requiredCollections.some(key => !Array.isArray(receipt[key]))) fail('COMPLETION_EVIDENCE_INCOMPLETE', 'Completion Receipt 数组字段非法');
  if (!receipt.sourceManifest || !Array.isArray(receipt.sourceManifest.missing)) fail('SOURCE_MANIFEST_INCOMPLETE', '缺少 Source Manifest');
  if (receipt.sourceManifest.missing.length) fail('SOURCE_MANIFEST_INCOMPLETE', '必需来源仍有缺失', { missing: receipt.sourceManifest.missing.map(item => item?.id || String(item)) });
  const completeClaim = ['COMPLETE', 'SEALED', 'FINAL', 'ACCEPTED'].includes(receipt.status);
  if (completeClaim) {
    if (!receipt.artifactRefs.length || !receipt.testsRun.length || !receipt.evidenceRefs.length) fail('COMPLETION_EVIDENCE_INCOMPLETE', '完成状态缺少工件、测试或证据');
    if (!Object.keys(receipt.acceptancePaths || {}).length) fail('COMPLETION_EVIDENCE_INCOMPLETE', '完成状态缺少 Acceptance Path Matrix');
    if (!receipt.commit || !receipt.remoteState) fail('COMPLETION_EVIDENCE_INCOMPLETE', '完成状态缺少 commit/remoteState');
    if (receipt.remainingWork.length) fail('COMPLETION_EVIDENCE_INCOMPLETE', '完成状态仍包含 remainingWork');
    for (const [label, hash] of Object.entries(receipt.artifactHashes || {})) {
      if (!SHA256.test(String(hash))) fail('COMPLETION_EVIDENCE_INCOMPLETE', `${label} artifact hash 非法`);
    }
  }
  return true;
}

const SECRET_PATTERNS = Object.freeze([
  { kind: 'private-key', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { kind: 'password', expression: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{6,}/i },
  { kind: 'token', expression: /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret)\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,}/i },
  { kind: 'cookie', expression: /(?:cookie|session)\s*[:=]\s*["']?[^\s"']{16,}/i },
]);

function stringsIn(value, path = '$', output = []) {
  if (typeof value === 'string') output.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => stringsIn(item, `${path}[${index}]`, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => stringsIn(item, `${path}.${key}`, output));
  return output;
}

function scanOutboundSecrets(payload) {
  const findings = [];
  for (const entry of stringsIn(payload)) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.expression.test(entry.value)) findings.push({ kind: pattern.kind, path: entry.path, valueHash: sha256(Buffer.from(entry.value, 'utf8')) });
      pattern.expression.lastIndex = 0;
    }
  }
  return Object.freeze({ schemaVersion: SECRET_SCAN_SCHEMA, allowed: findings.length === 0, findingCount: findings.length, findings });
}

function assertSecretHygiene(payload) {
  const receipt = scanOutboundSecrets(payload);
  if (!receipt.allowed) fail('SECRET_HYGIENE_BLOCKED', '出站对象包含疑似秘密，默认阻断', { findings: receipt.findings });
  return receipt;
}

function assertIncidentClosure(incident) {
  if (!incident || typeof incident !== 'object') fail('INCIDENT_PROMOTION_INCOMPLETE', '缺少 Incident closure');
  const required = ['id', 'symptom', 'rootCause', 'redFixture', 'fixRef', 'greenEvidence', 'regressionId', 'doctrineDecision', 'gateDecision'];
  for (const key of required) requiredString(incident[key], `incident.${key}`, 'INCIDENT_PROMOTION_INCOMPLETE');
  if (!/^(REG|FIXTURE)-[A-Z0-9-]+$/.test(incident.regressionId)) fail('INCIDENT_PROMOTION_INCOMPLETE', 'regressionId 非法');
  return Object.freeze({ schemaVersion: INCIDENT_CLOSURE_SCHEMA, ...incident, closed: true });
}

function validateGateRegistry(registry) {
  if (!registry || registry.schemaVersion !== GATE_REGISTRY_SCHEMA || !Array.isArray(registry.gates) || !registry.gates.length) fail('GATE_REGISTRY_INVALID', 'Gate Registry 缺失或 schema 非法');
  const ids = new Set();
  for (const gate of registry.gates) {
    const id = requiredString(gate.id, 'gate.id', 'GATE_REGISTRY_INVALID');
    if (ids.has(id)) fail('GATE_REGISTRY_INVALID', `Gate ID 重复: ${id}`);
    ids.add(id);
    requiredString(gate.title, `${id}.title`, 'GATE_REGISTRY_INVALID');
    requiredString(gate.failureCode, `${id}.failureCode`, 'GATE_REGISTRY_INVALID');
    if (!Array.isArray(gate.evidenceRequired)) fail('GATE_REGISTRY_INVALID', `${id}.evidenceRequired 必须是数组`);
  }
  return registry;
}

function validateRegressionRegistry(registry) {
  if (!registry || registry.schemaVersion !== REGRESSION_REGISTRY_SCHEMA || !Array.isArray(registry.regressions) || !registry.regressions.length) fail('REGRESSION_REGISTRY_INVALID', 'Regression Registry 缺失或 schema 非法');
  const ids = new Set();
  for (const item of registry.regressions) {
    const id = requiredString(item.id, 'regression.id', 'REGRESSION_REGISTRY_INVALID');
    if (ids.has(id)) fail('REGRESSION_REGISTRY_INVALID', `Regression ID 重复: ${id}`);
    ids.add(id);
    for (const key of ['incidentId', 'domain', 'redFixture', 'expectedFailure', 'greenCondition', 'owner', 'introducedAt']) requiredString(item[key], `${id}.${key}`, 'REGRESSION_REGISTRY_INVALID');
    if (!Array.isArray(item.applicableProfiles)) fail('REGRESSION_REGISTRY_INVALID', `${id}.applicableProfiles 必须是数组`);
  }
  return registry;
}

module.exports = {
  SPAWN_RECEIPT_SCHEMA,
  COMPLETION_RECEIPT_SCHEMA,
  SECRET_SCAN_SCHEMA,
  INCIDENT_CLOSURE_SCHEMA,
  GATE_REGISTRY_SCHEMA,
  REGRESSION_REGISTRY_SCHEMA,
  ActivationGateError,
  createSpawnGate,
  createCompletionReceipt,
  assertCompletionGate,
  scanOutboundSecrets,
  assertSecretHygiene,
  assertIncidentClosure,
  validateGateRegistry,
  validateRegressionRegistry,
};
