// main/agent-doctrine.js —— W66-R0 AgentRulePack / Doctrine Compiler foundation
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const RAW_SOURCE_SCHEMA = 'mazz.canonical-rule-source/v0';
const RULE_REGISTRY_SCHEMA = 'mazz.stable-rule-registry/v0';
const INCIDENT_LINEAGE_SCHEMA = 'mazz.incident-lineage/v0';
const HOST_FACTS_SCHEMA = 'mazz.host-facts/v0';
const PROFILE_INDEX_SCHEMA = 'mazz.doctrine-profile-index/v0';
const CURRENT_SSOT_SCHEMA = 'mazz.current-ssot/v0';
const TOOL_CAPABILITY_SCHEMA = 'mazz.tool-capability-snapshot/v0';
const DOCTRINE_CONTEXT_SCHEMA = 'mazz.doctrine-context/v0';
const RULE_STATUSES = new Set(['CURRENT', 'SUPERSEDED', 'HISTORICAL', 'PROPOSED', 'REJECTED']);
const RULE_SCOPES = new Set(['universal', 'host', 'domain', 'project', 'current-policy']);
const ENFORCEMENT_LEVELS = new Set(['ADVICE', 'POLICY', 'GATE', 'INVARIANT']);
const SEVERITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const RULE_ID = /^(CORE|STATE|SOURCE|TOOL|GIT|RELEASE|SECRET|SANDBOX|WINDOWS|ELECTRON|REMOTE|MAZZ)-[A-Z0-9-]+-\d{3}$/;
const INCIDENT_ID = /^[A-Z0-9][A-Z0-9-]{2,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HOST_OS = new Set(['windows', 'linux', 'darwin']);
const HOST_SHELLS = new Set(['powershell', 'cmd', 'bash', 'zsh', 'sh']);
const EXECUTION_MODES = new Set(['local', 'cloud', 'remote', 'ci']);
const WORKSPACE_PERSISTENCE = new Set(['durable', 'ephemeral']);
const PACKAGED_RUNTIMES = new Set(['electron', 'node', 'browser', 'none']);
const PROFILE_IDS = Object.freeze([
  'universal-core', 'cloud-sandbox', 'windows-local', 'linux-local',
  'remote-vps', 'electron-desktop', 'mazz-project',
]);

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

function validateHostFacts(hostFacts) {
  exactKeys(hostFacts, [
    'schemaVersion', 'factId', 'capturedAt', 'os', 'shell', 'executionMode',
    'workspacePersistence', 'sandbox', 'packagedRuntime', 'electron', 'network', 'remoteTarget',
  ], 'Host Facts');
  if (hostFacts.schemaVersion !== HOST_FACTS_SCHEMA) fail('HOST_FACTS_INVALID', `Host Facts schema 必须是 ${HOST_FACTS_SCHEMA}`);
  requiredString(hostFacts.factId, 'hostFacts.factId');
  requiredString(hostFacts.capturedAt, 'hostFacts.capturedAt');
  if (!HOST_OS.has(hostFacts.os)) fail('HOST_FACTS_INVALID', 'hostFacts.os 非法');
  if (!HOST_SHELLS.has(hostFacts.shell)) fail('HOST_FACTS_INVALID', 'hostFacts.shell 非法');
  if (!EXECUTION_MODES.has(hostFacts.executionMode)) fail('HOST_FACTS_INVALID', 'hostFacts.executionMode 非法');
  if (!WORKSPACE_PERSISTENCE.has(hostFacts.workspacePersistence)) fail('HOST_FACTS_INVALID', 'hostFacts.workspacePersistence 非法');
  if (!PACKAGED_RUNTIMES.has(hostFacts.packagedRuntime)) fail('HOST_FACTS_INVALID', 'hostFacts.packagedRuntime 非法');
  for (const key of ['sandbox', 'electron', 'network', 'remoteTarget']) {
    if (typeof hostFacts[key] !== 'boolean') fail('HOST_FACTS_INVALID', `hostFacts.${key} 必须是 boolean`);
  }
  if (hostFacts.os === 'windows' && !['powershell', 'cmd'].includes(hostFacts.shell)) fail('HOST_FACTS_INVALID', 'Windows Host 必须声明 powershell/cmd');
  if (hostFacts.remoteTarget && hostFacts.executionMode !== 'remote') fail('HOST_FACTS_INVALID', 'remoteTarget=true 时 executionMode 必须是 remote');
  return hostFacts;
}

function resolveDoctrineProfiles(hostFacts, { projectId = '', domainProfiles = [] } = {}) {
  validateHostFacts(hostFacts);
  if (!Array.isArray(domainProfiles)) fail('PROFILE_RESOLUTION_FAILED', 'domainProfiles 必须是数组');
  const active = [{ id: 'universal-core', layer: 'L0', reason: 'all-hosts' }];
  if (hostFacts.executionMode === 'cloud' && hostFacts.sandbox && hostFacts.workspacePersistence === 'ephemeral') {
    active.push({ id: 'cloud-sandbox', layer: 'L1', reason: 'cloud+sandbox+ephemeral' });
  }
  if (hostFacts.executionMode === 'local' && hostFacts.os === 'windows') {
    active.push({ id: 'windows-local', layer: 'L1', reason: 'windows+local' });
  }
  if (hostFacts.executionMode === 'local' && hostFacts.os === 'linux') {
    active.push({ id: 'linux-local', layer: 'L1', reason: 'linux+local' });
  }
  if (hostFacts.executionMode === 'remote' && hostFacts.remoteTarget) {
    active.push({ id: 'remote-vps', layer: 'L1', reason: 'remote-target' });
  }
  if (hostFacts.electron && hostFacts.packagedRuntime === 'electron') {
    active.push({ id: 'electron-desktop', layer: 'L2', reason: 'electron-runtime' });
  }
  for (const profile of [...new Set(domainProfiles.map(value => requiredString(value, 'domainProfile')))].sort()) {
    active.push({ id: profile, layer: 'L2', reason: 'declared-domain-profile' });
  }
  if (String(projectId || '').trim() === 'mazz-editor') active.push({ id: 'mazz-project', layer: 'L3', reason: 'project-id' });
  const activeIds = new Set(active.map(item => item.id));
  const inactiveRetainedInRawSource = PROFILE_IDS.filter(id => !activeIds.has(id));
  const value = {
    schemaVersion: PROFILE_INDEX_SCHEMA,
    hostFactsHash: sha256(Buffer.from(canonicalJson(hostFacts), 'utf8')),
    active,
    inactiveRetainedInRawSource,
  };
  value.profileIndexHash = sha256(Buffer.from(canonicalJson(value), 'utf8'));
  return Object.freeze(value);
}

function validateCurrentSsot(ssot) {
  exactKeys(ssot, [
    'schemaVersion', 'taskId', 'wave', 'status', 'branch', 'head', 'remoteHead',
    'openItems', 'stopLine', 'authorityRef', 'capturedAt', 'sourceRefs',
  ], 'Current SSoT');
  if (ssot.schemaVersion !== CURRENT_SSOT_SCHEMA) fail('CURRENT_POLICY_INVALID', `Current SSoT schema 必须是 ${CURRENT_SSOT_SCHEMA}`);
  for (const key of ['taskId', 'wave', 'status', 'branch', 'head', 'stopLine', 'authorityRef', 'capturedAt']) requiredString(ssot[key], `ssot.${key}`);
  if (!/^[a-f0-9]{7,40}$/.test(ssot.head)) fail('CURRENT_POLICY_INVALID', 'ssot.head 必须是 Git commit hash');
  if (ssot.remoteHead && !/^[a-f0-9]{7,40}$/.test(ssot.remoteHead)) fail('CURRENT_POLICY_INVALID', 'ssot.remoteHead 必须是 Git commit hash');
  if (!Array.isArray(ssot.openItems)) fail('CURRENT_POLICY_INVALID', 'ssot.openItems 必须是数组');
  if (!Array.isArray(ssot.sourceRefs) || ssot.sourceRefs.length === 0) fail('CURRENT_POLICY_INVALID', 'ssot.sourceRefs 必须是非空数组');
  return ssot;
}

function createToolCapabilitySnapshot({ adapterId, adapterVersion = 'UNKNOWN', capturedAt, tools = [] } = {}) {
  const normalizedTools = tools.map((tool, index) => {
    exactKeys(tool, ['name', 'argsSchemaHash', 'limits', 'resultEnvelope', 'handleKinds', 'continuationApis'], `tools[${index}]`);
    const name = requiredString(tool.name, `tools[${index}].name`);
    if (!SHA256.test(String(tool.argsSchemaHash || ''))) fail('TOOL_CAPABILITY_INVALID', `${name}.argsSchemaHash 必须是 SHA-256`);
    if (!tool.limits || typeof tool.limits !== 'object' || Array.isArray(tool.limits)) fail('TOOL_CAPABILITY_INVALID', `${name}.limits 必须是对象`);
    requiredString(tool.resultEnvelope, `${name}.resultEnvelope`);
    if (!Array.isArray(tool.handleKinds) || !Array.isArray(tool.continuationApis)) fail('TOOL_CAPABILITY_INVALID', `${name} handleKinds/continuationApis 必须是数组`);
    return {
      name,
      argsSchemaHash: tool.argsSchemaHash,
      limits: stableValue(tool.limits),
      resultEnvelope: tool.resultEnvelope,
      handleKinds: [...new Set(tool.handleKinds.map(value => requiredString(value, `${name}.handleKind`)))].sort(),
      continuationApis: [...new Set(tool.continuationApis.map(value => requiredString(value, `${name}.continuationApi`)))].sort(),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(normalizedTools.map(tool => tool.name)).size !== normalizedTools.length) fail('TOOL_CAPABILITY_INVALID', 'Tool name 重复');
  const base = {
    schemaVersion: TOOL_CAPABILITY_SCHEMA,
    adapterId: requiredString(adapterId, 'adapterId'),
    adapterVersion: requiredString(adapterVersion, 'adapterVersion'),
    capturedAt: requiredString(capturedAt, 'capturedAt'),
    tools: normalizedTools,
  };
  return Object.freeze({ ...base, toolsetHash: sha256(Buffer.from(canonicalJson(base), 'utf8')) });
}

function validateToolCapabilitySnapshot(snapshot) {
  exactKeys(snapshot, ['schemaVersion', 'adapterId', 'adapterVersion', 'capturedAt', 'tools', 'toolsetHash'], 'Tool Capability Snapshot');
  if (snapshot.schemaVersion !== TOOL_CAPABILITY_SCHEMA) fail('TOOL_CAPABILITY_INVALID', `Tool Capability schema 必须是 ${TOOL_CAPABILITY_SCHEMA}`);
  const rebuilt = createToolCapabilitySnapshot(snapshot);
  if (rebuilt.toolsetHash !== snapshot.toolsetHash) fail('TOOL_CAPABILITY_INVALID', 'Tool Capability hash 不匹配');
  return snapshot;
}

function contextRecords(doctrineRoot, fsImpl = fs) {
  const root = path.join(path.resolve(doctrineRoot), 'contexts');
  if (!fsImpl.existsSync(root)) return [];
  return fsImpl.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name, 'context.json'))
    .filter(file => fsImpl.existsSync(file))
    .map(file => {
      try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)) || String(a.contextHash).localeCompare(String(b.contextHash)));
}

function readCurrentDoctrineContext(doctrineRoot, fsImpl = fs) {
  const records = contextRecords(doctrineRoot, fsImpl);
  const superseded = new Set(records.map(record => record.supersedesContextHash).filter(Boolean));
  return records.filter(record => !superseded.has(record.contextHash)).at(-1) || null;
}

function snapshotR0bContext({ doctrineRoot, hostFacts, projectId = '', domainProfiles = [], currentSsot, toolCapability, clock = () => new Date(), fsImpl = fs } = {}) {
  const root = path.resolve(requiredString(doctrineRoot, 'doctrineRoot'));
  validateHostFacts(hostFacts);
  validateCurrentSsot(currentSsot);
  validateToolCapabilitySnapshot(toolCapability);
  const profileIndex = resolveDoctrineProfiles(hostFacts, { projectId, domainProfiles });
  const artifacts = [
    ['host-facts', hostFacts],
    ['profile-index', profileIndex],
    ['current-ssot', currentSsot],
    ['tool-capability', toolCapability],
  ].map(([kind, value]) => {
    const bytes = Buffer.from(canonicalJson(value), 'utf8');
    const hash = sha256(bytes);
    const target = path.join(root, 'context-assets', kind, `${hash}.json`);
    atomicWrite(target, bytes, fsImpl);
    return { kind, hash, ref: path.relative(root, target).replaceAll('\\', '/') };
  });
  const previous = readCurrentDoctrineContext(root, fsImpl);
  const base = {
    schemaVersion: DOCTRINE_CONTEXT_SCHEMA,
    recordedAt: clock().toISOString(),
    hostFactsHash: artifacts[0].hash,
    hostFactsRef: artifacts[0].ref,
    profileIndexHash: artifacts[1].hash,
    profileIndexRef: artifacts[1].ref,
    currentSsotHash: artifacts[2].hash,
    currentSsotRef: artifacts[2].ref,
    toolCapabilityHash: artifacts[3].hash,
    toolCapabilityRef: artifacts[3].ref,
    supersedesContextHash: previous?.contextHash || null,
  };
  const contextHash = sha256(Buffer.from(canonicalJson(base), 'utf8'));
  const context = { ...base, contextHash };
  const contextPath = path.join(root, 'contexts', contextHash, 'context.json');
  atomicWrite(contextPath, Buffer.from(canonicalJson(context), 'utf8'), fsImpl);
  return Object.freeze({ ...context, contextRef: path.relative(root, contextPath).replaceAll('\\', '/') });
}

module.exports = {
  RAW_SOURCE_SCHEMA,
  RULE_REGISTRY_SCHEMA,
  INCIDENT_LINEAGE_SCHEMA,
  HOST_FACTS_SCHEMA,
  PROFILE_INDEX_SCHEMA,
  CURRENT_SSOT_SCHEMA,
  TOOL_CAPABILITY_SCHEMA,
  DOCTRINE_CONTEXT_SCHEMA,
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
  validateHostFacts,
  resolveDoctrineProfiles,
  validateCurrentSsot,
  createToolCapabilitySnapshot,
  validateToolCapabilitySnapshot,
  snapshotR0bContext,
  readCurrentDoctrineContext,
};
