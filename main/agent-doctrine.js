// main/agent-doctrine.js —— W66-R0 AgentRulePack / Doctrine Compiler foundation
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const RAW_SOURCE_SCHEMA = 'mazz.canonical-rule-source/v0';
const RULE_REGISTRY_SCHEMA = 'mazz.stable-rule-registry/v0';
const INCIDENT_LINEAGE_SCHEMA = 'mazz.incident-lineage/v0';
const RULE_STATUSES = new Set(['CURRENT', 'SUPERSEDED', 'HISTORICAL', 'PROPOSED', 'REJECTED']);
const RULE_SCOPES = new Set(['universal', 'host', 'domain', 'project', 'current-policy']);
const ENFORCEMENT_LEVELS = new Set(['ADVICE', 'POLICY', 'GATE', 'INVARIANT']);
const SEVERITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const RULE_ID = /^(CORE|STATE|SOURCE|TOOL|GIT|RELEASE|SECRET|SANDBOX|WINDOWS|ELECTRON|REMOTE|MAZZ)-[A-Z0-9-]+-\d{3}$/;
const INCIDENT_ID = /^[A-Z0-9][A-Z0-9-]{2,127}$/;

class DoctrineError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DoctrineError';
    this.code = code;
    this.retryable = false;
  }
}

function fail(code, message, cause = null) {
  throw new DoctrineError(code, message, cause);
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
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DOCTRINE_SCHEMA_INVALID', `${label} 必须是对象`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail('DOCTRINE_SCHEMA_INVALID', `${label} 含未知字段: ${unknown.join(', ')}`);
}

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('DOCTRINE_SCHEMA_INVALID', `${label} 必填`);
  return normalized;
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('RULE_PACK_ENCODING_INVALID', 'Canonical Rule Source 不是有效 UTF-8', error);
  }
}

function readCanonicalRuleSource({ sourcePath, fsImpl = fs } = {}) {
  const resolved = path.resolve(requiredString(sourcePath, 'sourcePath'));
  let bytes;
  try {
    bytes = fsImpl.readFileSync(resolved);
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'RULE_PACK_REQUIRED' : 'RULE_PACK_UNREADABLE';
    fail(code, `无法读取 Canonical Rule Source: ${resolved}`, error);
  }
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const text = decodeUtf8(bytes);
  if (!text.trim()) fail('RULE_PACK_REQUIRED', 'Canonical Rule Source 不能为空');
  return Object.freeze({
    schemaVersion: RAW_SOURCE_SCHEMA,
    sourcePath: resolved,
    bytes,
    text,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  });
}

function atomicWrite(targetPath, bytes, fsImpl = fs) {
  const dir = path.dirname(targetPath);
  fsImpl.mkdirSync(dir, { recursive: true });
  if (fsImpl.existsSync(targetPath)) {
    const current = fsImpl.readFileSync(targetPath);
    if (!Buffer.from(current).equals(Buffer.from(bytes))) {
      fail('DOCTRINE_IMMUTABLE_CONFLICT', `不可变 Doctrine 工件发生内容漂移: ${targetPath}`);
    }
    return false;
  }
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fsImpl.writeFileSync(tempPath, bytes, { flag: 'wx' });
    fsImpl.renameSync(tempPath, targetPath);
    return true;
  } catch (error) {
    try { if (fsImpl.existsSync(tempPath)) fsImpl.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

function validateRuleRegistry(registry) {
  exactKeys(registry, ['schemaVersion', 'registryId', 'version', 'authorityRef', 'generatedAt', 'rules'], 'Rule Registry');
  if (registry.schemaVersion !== RULE_REGISTRY_SCHEMA) fail('RULE_REGISTRY_INVALID', `Rule Registry schema 必须是 ${RULE_REGISTRY_SCHEMA}`);
  requiredString(registry.registryId, 'registryId');
  requiredString(registry.version, 'version');
  requiredString(registry.authorityRef, 'authorityRef');
  requiredString(registry.generatedAt, 'generatedAt');
  if (!Array.isArray(registry.rules) || registry.rules.length === 0) fail('RULE_REGISTRY_INVALID', 'rules 必须是非空数组');
  const ids = new Set();
  for (const [index, rule] of registry.rules.entries()) {
    const label = `rules[${index}]`;
    exactKeys(rule, ['id', 'legacyRef', 'title', 'statement', 'status', 'scope', 'applicableWhen', 'severity', 'enforcement', 'evidence', 'failure', 'origin', 'supersedes'], label);
    if (!RULE_ID.test(requiredString(rule.id, `${label}.id`))) fail('RULE_REGISTRY_INVALID', `${label}.id 不是 Stable Rule ID`);
    if (ids.has(rule.id)) fail('RULE_REGISTRY_INVALID', `Rule ID 重复: ${rule.id}`);
    ids.add(rule.id);
    requiredString(rule.title, `${label}.title`);
    requiredString(rule.statement, `${label}.statement`);
    if (!RULE_STATUSES.has(rule.status)) fail('RULE_REGISTRY_INVALID', `${label}.status 非法`);
    if (!Array.isArray(rule.scope) || !rule.scope.length || rule.scope.some(item => !RULE_SCOPES.has(item))) fail('RULE_REGISTRY_INVALID', `${label}.scope 非法`);
    if (!SEVERITIES.has(rule.severity)) fail('RULE_REGISTRY_INVALID', `${label}.severity 非法`);
    exactKeys(rule.enforcement, ['level', 'gateIds'], `${label}.enforcement`);
    if (!ENFORCEMENT_LEVELS.has(rule.enforcement.level)) fail('RULE_REGISTRY_INVALID', `${label}.enforcement.level 非法`);
    if (!Array.isArray(rule.enforcement.gateIds)) fail('RULE_REGISTRY_INVALID', `${label}.enforcement.gateIds 必须是数组`);
    exactKeys(rule.evidence, ['required'], `${label}.evidence`);
    if (!Array.isArray(rule.evidence.required)) fail('RULE_REGISTRY_INVALID', `${label}.evidence.required 必须是数组`);
    exactKeys(rule.failure, ['code'], `${label}.failure`);
    requiredString(rule.failure.code, `${label}.failure.code`);
    exactKeys(rule.origin, ['incidents', 'introducedAt'], `${label}.origin`);
    if (!Array.isArray(rule.origin.incidents)) fail('RULE_REGISTRY_INVALID', `${label}.origin.incidents 必须是数组`);
    if (!Array.isArray(rule.supersedes)) fail('RULE_REGISTRY_INVALID', `${label}.supersedes 必须是数组`);
  }
  return registry;
}

function validateIncidentLineage(lineage) {
  exactKeys(lineage, ['schemaVersion', 'lineageId', 'version', 'authorityRef', 'generatedAt', 'incidents'], 'Incident Lineage');
  if (lineage.schemaVersion !== INCIDENT_LINEAGE_SCHEMA) fail('INCIDENT_LINEAGE_INVALID', `Incident Lineage schema 必须是 ${INCIDENT_LINEAGE_SCHEMA}`);
  requiredString(lineage.lineageId, 'lineageId');
  requiredString(lineage.version, 'version');
  requiredString(lineage.authorityRef, 'authorityRef');
  requiredString(lineage.generatedAt, 'generatedAt');
  if (!Array.isArray(lineage.incidents) || lineage.incidents.length === 0) fail('INCIDENT_LINEAGE_INVALID', 'incidents 必须是非空数组');
  const ids = new Set();
  for (const [index, incident] of lineage.incidents.entries()) {
    const label = `incidents[${index}]`;
    exactKeys(incident, ['id', 'timestamp', 'symptom', 'rootCause', 'regressionIds', 'postmortemRef'], label);
    if (!INCIDENT_ID.test(requiredString(incident.id, `${label}.id`))) fail('INCIDENT_LINEAGE_INVALID', `${label}.id 非法`);
    if (ids.has(incident.id)) fail('INCIDENT_LINEAGE_INVALID', `Incident ID 重复: ${incident.id}`);
    ids.add(incident.id);
    requiredString(incident.timestamp, `${label}.timestamp`);
    requiredString(incident.symptom, `${label}.symptom`);
    requiredString(incident.rootCause, `${label}.rootCause`);
    if (!Array.isArray(incident.regressionIds)) fail('INCIDENT_LINEAGE_INVALID', `${label}.regressionIds 必须是数组`);
    requiredString(incident.postmortemRef, `${label}.postmortemRef`);
  }
  return lineage;
}

function validateCatalogLinkage(registry, lineage) {
  validateRuleRegistry(registry);
  validateIncidentLineage(lineage);
  const incidentIds = new Set(lineage.incidents.map(incident => incident.id));
  for (const rule of registry.rules) {
    for (const incidentId of rule.origin.incidents) {
      if (!incidentIds.has(incidentId)) fail('INCIDENT_LINEAGE_INVALID', `${rule.id} 引用了不存在的 Incident: ${incidentId}`);
    }
  }
  return true;
}

function snapshotCanonicalRuleSource({ sourcePath, doctrineRoot, authorityRef, clock = () => new Date(), fsImpl = fs } = {}) {
  const root = path.resolve(requiredString(doctrineRoot, 'doctrineRoot'));
  const authority = requiredString(authorityRef, 'authorityRef');
  const source = readCanonicalRuleSource({ sourcePath, fsImpl });
  const relativeRoot = path.join('raw', source.sha256);
  const snapshotPath = path.join(root, relativeRoot, 'raw-rule-pack.md');
  const receiptPath = path.join(root, relativeRoot, 'source-receipt.json');
  const receipt = {
    schemaVersion: RAW_SOURCE_SCHEMA,
    rulePackId: `rule-pack:${source.sha256}`,
    title: path.basename(source.sourcePath),
    sourcePath: source.sourcePath,
    sha256: source.sha256,
    byteLength: source.byteLength,
    capturedAt: clock().toISOString(),
    authorityRef: authority,
    snapshotRef: path.relative(root, snapshotPath).replaceAll('\\', '/'),
  };
  try {
    atomicWrite(snapshotPath, source.bytes, fsImpl);
    atomicWrite(receiptPath, Buffer.from(canonicalJson(receipt), 'utf8'), fsImpl);
  } catch (error) {
    if (error instanceof DoctrineError) throw error;
    fail('RULE_PACK_SNAPSHOT_FAILED', `Rule Pack 快照失败: ${snapshotPath}`, error);
  }
  const persisted = fsImpl.readFileSync(snapshotPath);
  if (!Buffer.from(persisted).equals(source.bytes) || sha256(persisted) !== source.sha256) {
    fail('RULE_PACK_HASH_MISMATCH', 'Rule Pack 快照与 Canonical Source 不一致');
  }
  return Object.freeze({ ...receipt, receiptRef: path.relative(root, receiptPath).replaceAll('\\', '/') });
}

function snapshotR0aFoundation({ sourcePath, doctrineRoot, authorityRef, ruleRegistry, incidentLineage, clock = () => new Date(), fsImpl = fs } = {}) {
  validateCatalogLinkage(ruleRegistry, incidentLineage);
  const root = path.resolve(requiredString(doctrineRoot, 'doctrineRoot'));
  const sourceReceipt = snapshotCanonicalRuleSource({ sourcePath, doctrineRoot: root, authorityRef, clock, fsImpl });
  const registryBytes = Buffer.from(canonicalJson(ruleRegistry), 'utf8');
  const lineageBytes = Buffer.from(canonicalJson(incidentLineage), 'utf8');
  const registryHash = sha256(registryBytes);
  const lineageHash = sha256(lineageBytes);
  const registryPath = path.join(root, 'catalogs', 'rules', `${registryHash}.json`);
  const lineagePath = path.join(root, 'catalogs', 'incidents', `${lineageHash}.json`);
  try {
    atomicWrite(registryPath, registryBytes, fsImpl);
    atomicWrite(lineagePath, lineageBytes, fsImpl);
  } catch (error) {
    if (error instanceof DoctrineError) throw error;
    fail('RULE_PACK_SNAPSHOT_FAILED', 'Rule Registry / Incident Lineage 快照失败', error);
  }
  return Object.freeze({
    schemaVersion: 'mazz.doctrine-r0a-foundation/v0',
    sourceReceipt,
    ruleRegistryHash: registryHash,
    ruleRegistryRef: path.relative(root, registryPath).replaceAll('\\', '/'),
    incidentLineageHash: lineageHash,
    incidentLineageRef: path.relative(root, lineagePath).replaceAll('\\', '/'),
  });
}

module.exports = {
  RAW_SOURCE_SCHEMA,
  RULE_REGISTRY_SCHEMA,
  INCIDENT_LINEAGE_SCHEMA,
  RULE_STATUSES,
  RULE_SCOPES,
  ENFORCEMENT_LEVELS,
  DoctrineError,
  sha256,
  canonicalJson,
  readCanonicalRuleSource,
  validateRuleRegistry,
  validateIncidentLineage,
  validateCatalogLinkage,
  snapshotCanonicalRuleSource,
  snapshotR0aFoundation,
};
