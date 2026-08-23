'use strict';

// W74c-1/2/3：显式本地 Promotion。候选可以由系统生成，但只有 human:* 决定能改变状态。
// 本账只引用 W72 Asset Envelope，不保存正文，也不取得 Publication / Hub / Canon 权力。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isAssetEnvelope } = require('./foundation/asset-envelope');
const { assertKnownKeys, clonePlain, deepFreeze, isPlainObject, requiredString } = require('./foundation/plain-value');

const CONVERSATION_PROMOTION_REQUEST_SCHEMA = 'mazz.conversation-promotion-request/v0';
const STRUCTURED_PROMOTION_REVIEW_REQUEST_SCHEMA = 'mazz.structured-promotion-review-request/v0';
const PROMOTION_COMMAND_SCHEMA = 'mazz.local-promotion-command/v0';
const PROMOTION_EVENT_SCHEMA = 'mazz.local-promotion-event/v0';
const PROMOTION_CATALOG_SCHEMA = 'mazz.local-promotion-catalog/v0';
const PROMOTION_CONFLICT_SCHEMA = 'mazz.local-promotion-conflict/v0';
const PROMOTION_MANAGEMENT_QUERY_SCHEMA = 'mazz.promotion-management-query/v0';
const PROMOTION_REVOKE_REQUEST_SCHEMA = 'mazz.promotion-revoke-request/v0';
const EVIDENCE_PROJECTION_REQUEST_SCHEMA = 'mazz.evidence-projection-request/v0';
const EVIDENCE_PROJECTION_EVENT_SCHEMA = 'mazz.evidence-projection-event/v0';
const EVIDENCE_PROJECTION_CATALOG_SCHEMA = 'mazz.evidence-projection-catalog/v0';
const EVIDENCE_PROJECTION_CONFLICT_SCHEMA = 'mazz.evidence-projection-conflict/v0';
const PUBLIC_EVIDENCE_PROJECTION_SCHEMA = 'mazz.public-evidence-projection/v0';
const PROMOTION_KINDS = Object.freeze(['asset', 'stage-summary', 'decision', 'method', 'finding']);
const STRUCTURED_PROMOTION_KINDS = Object.freeze(PROMOTION_KINDS.filter(kind => kind !== 'asset'));
const PROMOTION_ACTIONS = Object.freeze(['approve', 'reject', 'revoke']);
const ACTIVE_STATUS = new Set(['active']);
const REQUEST_FIELDS = Object.freeze([
  'schema', 'projectId', 'projectPath', 'title', 'markdown', 'sourceRef', 'capturedAt',
  'authorityRef', 'reason', 'decidedAt', 'supersedes',
]);
const STRUCTURED_REVIEW_FIELDS = Object.freeze([
  'schema', 'projectId', 'projectPath', 'kind', 'title', 'markdown', 'sourceRef',
  'proposedBy', 'proposedAt', 'action', 'authorityRef', 'reason', 'decidedAt', 'supersedes',
]);
const COMMAND_FIELDS = Object.freeze([
  'schema', 'commandId', 'promotionId', 'projectId', 'projectPath', 'action', 'candidate',
  'authorityRef', 'reason', 'decidedAt', 'supersedes',
]);
const CANDIDATE_FIELDS = Object.freeze([
  'candidateId', 'kind', 'assetRef', 'sourceRef', 'proposedBy', 'proposedAt',
]);
const ASSET_REF_FIELDS = Object.freeze(['id', 'path', 'type', 'version']);
const EVENT_FIELDS = Object.freeze([
  'schema', 'sequence', 'previousHash', 'commandId', 'commandHash', 'promotionId', 'projectId',
  'action', 'candidate', 'authorityRef', 'reason', 'decidedAt', 'supersedes',
  'automaticPromotion', 'publicationGranted', 'eventHash',
]);
const MANAGEMENT_QUERY_FIELDS = Object.freeze(['schema', 'projectId', 'projectPath']);
const REVOKE_REQUEST_FIELDS = Object.freeze([
  'schema', 'projectId', 'projectPath', 'promotionId', 'authorityRef', 'reason', 'decidedAt',
]);
const PROJECTION_REQUEST_FIELDS = Object.freeze([
  'schema', 'projectId', 'projectPath', 'action', 'promotionId', 'projectionId',
  'authorityRef', 'reason', 'decidedAt',
]);
const PROJECTION_EVENT_FIELDS = Object.freeze([
  'schema', 'sequence', 'previousHash', 'commandId', 'commandHash', 'projectionId',
  'projectId', 'promotionId', 'action', 'projection', 'authorityRef', 'reason',
  'decidedAt', 'automaticPublication', 'publicationGranted', 'eventHash',
]);
const PROJECTION_ACTIONS = Object.freeze(['project', 'withdraw']);
const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken', 'credential', 'cookie',
]);
const BODY_KEYS = new Set(['body', 'content', 'markdown', 'prompt', 'response', 'reasoning']);

const slash = value => String(value || '').replace(/\\/g, '/');
const sha256 = value => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) { return JSON.stringify(stableValue(value)); }

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`W74c 禁止 secret 字段：${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function rejectEmbeddedBody(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectEmbeddedBody(item, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (BODY_KEYS.has(canonical)) throw new Error(`Promotion 引用不得夹带正文：${trail ? `${trail}.` : ''}${key}`);
    rejectEmbeddedBody(item, trail ? `${trail}.${key}` : key);
  }
}

function iso(value, label) {
  const raw = requiredString(value, label);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`${label} 必须是 ISO 时间`);
  return new Date(ms).toISOString();
}

function safeId(value, label) {
  const id = requiredString(value, label);
  if (id.length > 300 || /[\u0000-\u001f]/.test(id)) throw new Error(`${label} 非法`);
  return id;
}

function normalizeAssetRef(value) {
  if (!isPlainObject(value)) throw new Error('candidate.assetRef 必须是对象');
  assertKnownKeys(value, ASSET_REF_FIELDS, 'candidate.assetRef');
  return deepFreeze({
    id: safeId(value.id, 'candidate.assetRef.id'),
    path: path.resolve(requiredString(value.path, 'candidate.assetRef.path')),
    type: requiredString(value.type, 'candidate.assetRef.type'),
    version: requiredString(value.version, 'candidate.assetRef.version'),
  });
}

function normalizeCandidate(value) {
  if (!isPlainObject(value)) throw new Error('candidate 必须是对象');
  assertKnownKeys(value, CANDIDATE_FIELDS, 'candidate');
  const kind = requiredString(value.kind, 'candidate.kind');
  if (!PROMOTION_KINDS.includes(kind)) throw new Error(`非法 Promotion kind：${kind}`);
  if (!isPlainObject(value.sourceRef)) throw new Error('candidate.sourceRef 必须是对象');
  rejectEmbeddedBody(value.sourceRef, 'candidate.sourceRef');
  const candidate = {
    candidateId: safeId(value.candidateId, 'candidate.candidateId'),
    kind,
    assetRef: normalizeAssetRef(value.assetRef),
    sourceRef: clonePlain(value.sourceRef, 'candidate.sourceRef'),
    proposedBy: safeId(value.proposedBy, 'candidate.proposedBy'),
    proposedAt: iso(value.proposedAt, 'candidate.proposedAt'),
  };
  if (!/^(?:system|human):/.test(candidate.proposedBy)) throw new Error('candidate.proposedBy 必须是 system:* 或 human:*');
  return deepFreeze(candidate);
}

function normalizeCommand(input) {
  if (!isPlainObject(input)) throw new Error('Promotion command 必须是对象');
  assertKnownKeys(input, COMMAND_FIELDS, 'Promotion command');
  rejectSecrets(input);
  if (input.schema != null && input.schema !== PROMOTION_COMMAND_SCHEMA) throw new Error(`不支持的 Promotion schema：${input.schema}`);
  const action = requiredString(input.action, 'action');
  if (!PROMOTION_ACTIONS.includes(action)) throw new Error(`非法 Promotion action：${action}`);
  const authorityRef = safeId(input.authorityRef, 'authorityRef');
  if (!authorityRef.startsWith('human:')) throw new Error('Promotion 决定必须由 human:* Authority 作出');
  const supersedes = [...new Set((Array.isArray(input.supersedes) ? input.supersedes : []).map((item, index) => safeId(item, `supersedes[${index}]`)))];
  const candidate = input.candidate == null ? null : normalizeCandidate(input.candidate);
  if (action === 'approve' && !candidate) throw new Error('approve 必须携带 candidate');
  if (action === 'reject' && !candidate) throw new Error('reject 必须携带 candidate');
  if (action === 'revoke' && candidate) throw new Error('revoke 不得替换 candidate');
  if (action !== 'approve' && supersedes.length) throw new Error('只有 approve 可以声明 supersedes');
  const command = {
    schema: PROMOTION_COMMAND_SCHEMA,
    commandId: safeId(input.commandId, 'commandId'),
    promotionId: safeId(input.promotionId, 'promotionId'),
    projectId: safeId(input.projectId, 'projectId'),
    projectPath: path.resolve(requiredString(input.projectPath, 'projectPath')),
    action,
    candidate,
    authorityRef,
    reason: requiredString(input.reason, 'reason'),
    decidedAt: iso(input.decidedAt, 'decidedAt'),
    supersedes,
  };
  if (supersedes.includes(command.promotionId)) throw new Error('Promotion 不能 supersede 自己');
  command.commandHash = sha256(stableJson({ ...command, projectPath: slash(command.projectPath), decidedAt: undefined }));
  return deepFreeze(command);
}

function promotionPaths(projectPath) {
  const root = path.resolve(projectPath, '.mazz', 'promotions');
  return Object.freeze({
    root,
    events: path.join(root, 'events.ndjson'),
    catalog: path.join(root, 'catalog.json'),
    conflicts: path.join(root, 'conflicts'),
    recovery: path.join(root, 'recovery'),
  });
}

function projectionPaths(projectPath) {
  const root = path.resolve(projectPath, '.mazz', 'promotions', 'evidence-projections');
  return Object.freeze({
    root,
    events: path.join(root, 'events.ndjson'),
    catalog: path.join(root, 'catalog.json'),
    artifacts: path.join(root, 'artifacts'),
    conflicts: path.join(root, 'conflicts'),
    recovery: path.join(root, 'recovery'),
  });
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temp, content, 'utf8');
  try { fs.renameSync(temp, filePath); }
  catch (error) {
    try { fs.copyFileSync(temp, filePath); fs.unlinkSync(temp); }
    catch { try { fs.unlinkSync(temp); } catch {} throw error; }
  }
}

function parseEventLog(text) {
  const lines = String(text || '').split(/\r?\n/);
  const events = [];
  let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (!isPlainObject(event)) throw new Error('event 必须是对象');
      assertKnownKeys(event, EVENT_FIELDS, 'Promotion event');
      if (event.schema !== PROMOTION_EVENT_SCHEMA || event.sequence !== events.length + 1) throw new Error('schema/sequence 不连续');
      if (!PROMOTION_ACTIONS.includes(event.action)) throw new Error('action 非法');
      if (!String(event.authorityRef || '').startsWith('human:')) throw new Error('Authority 非 human:*');
      if (event.automaticPromotion !== false || event.publicationGranted !== false) throw new Error('Promotion 权力边界漂移');
      const expectedPrevious = events.at(-1)?.eventHash || '';
      if (event.previousHash !== expectedPrevious) throw new Error('hash chain 不连续');
      const expectedHash = sha256(stableJson({ ...event, eventHash: undefined }));
      if (event.eventHash !== expectedHash) throw new Error('eventHash 不匹配');
      rejectSecrets(event);
      events.push(event);
    } catch (error) {
      const later = lines.slice(index + 1).some(value => value.trim());
      if (later) throw new Error(`Promotion ledger 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line;
      break;
    }
  }
  return { events, corruptTail };
}

function stateFromEvents(events) {
  const states = new Map();
  for (const event of events) {
    if (event.action === 'approve') {
      states.set(event.promotionId, {
        promotionId: event.promotionId, status: 'active', candidate: event.candidate,
        authorityRef: event.authorityRef, decidedAt: event.decidedAt, reason: event.reason,
        supersedes: event.supersedes, supersededBy: '', lastSequence: event.sequence,
        lastEventHash: event.eventHash,
      });
      for (const targetId of event.supersedes) {
        const target = states.get(targetId);
        if (target) states.set(targetId, {
          ...target, status: 'superseded', supersededBy: event.promotionId,
          lastSequence: event.sequence, lastEventHash: event.eventHash,
        });
      }
    } else if (event.action === 'reject') {
      states.set(event.promotionId, {
        promotionId: event.promotionId, status: 'rejected', candidate: event.candidate,
        authorityRef: event.authorityRef, decidedAt: event.decidedAt, reason: event.reason,
        supersedes: [], supersededBy: '', lastSequence: event.sequence,
        lastEventHash: event.eventHash,
      });
    } else if (event.action === 'revoke') {
      const current = states.get(event.promotionId);
      states.set(event.promotionId, {
        ...current, status: 'revoked', authorityRef: event.authorityRef,
        decidedAt: event.decidedAt, reason: event.reason, lastSequence: event.sequence,
        lastEventHash: event.eventHash,
      });
    }
  }
  return states;
}

function validateTransition(command, states) {
  const current = states.get(command.promotionId);
  if (command.action === 'approve' || command.action === 'reject') {
    if (current) throw new Error(`Promotion 已存在：${command.promotionId} (${current.status})`);
  } else if (command.action === 'revoke') {
    if (!current || !ACTIVE_STATUS.has(current.status)) throw new Error(`只有 active Promotion 可以撤销：${command.promotionId}`);
  }
  for (const targetId of command.supersedes) {
    const target = states.get(targetId);
    if (!target || !ACTIVE_STATUS.has(target.status)) throw new Error(`supersedes 目标不是 active：${targetId}`);
    if (command.candidate?.kind !== target.candidate?.kind) throw new Error(`supersedes 目标类型不一致：${targetId}`);
  }
}

function verifyCandidateEnvelope(command) {
  if (!command.candidate) return;
  const ref = command.candidate.assetRef;
  const relative = path.relative(command.projectPath, ref.path);
  const expectedRoot = path.resolve(command.projectPath, '.mazz', 'materials');
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.resolve(ref.path).startsWith(expectedRoot + path.sep)) {
    throw new Error('Promotion 只接受当前项目材料区内的 W72 Asset Envelope');
  }
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(ref.path, 'utf8')); }
  catch (error) { throw new Error(`Promotion Asset Envelope 不可读：${error.message}`); }
  if (!isAssetEnvelope(envelope) || envelope.id !== ref.id || envelope.type !== ref.type || envelope.version !== ref.version) {
    throw new Error('Promotion Asset Envelope 身份/类型/版本不匹配');
  }
}

function catalogFromEvents(projectId, events) {
  const states = stateFromEvents(events);
  const entries = [...states.values()].sort((a, b) => a.promotionId.localeCompare(b.promotionId, 'en'));
  const catalog = {
    schema: PROMOTION_CATALOG_SCHEMA,
    projectId,
    generatedFrom: 'promotion-events',
    lastSequence: events.length,
    entryCount: entries.length,
    entries,
  };
  catalog.catalogHash = sha256(stableJson(catalog));
  return catalog;
}

function normalizeManagementQuery(input) {
  if (!isPlainObject(input)) throw new Error('Promotion management query 必须是对象');
  assertKnownKeys(input, MANAGEMENT_QUERY_FIELDS, 'Promotion management query');
  rejectSecrets(input);
  if (input.schema != null && input.schema !== PROMOTION_MANAGEMENT_QUERY_SCHEMA) {
    throw new Error(`不支持的 Promotion management schema：${input.schema}`);
  }
  return deepFreeze({
    schema: PROMOTION_MANAGEMENT_QUERY_SCHEMA,
    projectId: safeId(input.projectId, 'projectId'),
    projectPath: path.resolve(requiredString(input.projectPath, 'projectPath')),
  });
}

function readPromotionCatalogSync(input) {
  const query = normalizeManagementQuery(input);
  const paths = promotionPaths(query.projectPath);
  const parsed = parseEventLog(fs.existsSync(paths.events) ? fs.readFileSync(paths.events, 'utf8') : '');
  if (parsed.events.some(event => event.projectId !== query.projectId)) throw new Error('Promotion ledger projectId 与项目不一致');
  const recoveryPath = recoverTail(paths, parsed);
  const catalog = catalogFromEvents(query.projectId, parsed.events);
  if (parsed.events.length || fs.existsSync(paths.root)) atomicWrite(paths.catalog, JSON.stringify(catalog, null, 2));
  return deepFreeze({
    ok: true, catalog, recoveryPath,
    paths: { events: slash(paths.events), catalog: slash(paths.catalog) },
  });
}

function normalizeRevokeRequest(input) {
  if (!isPlainObject(input)) throw new Error('Promotion revoke request 必须是对象');
  assertKnownKeys(input, REVOKE_REQUEST_FIELDS, 'Promotion revoke request');
  rejectSecrets(input);
  if (input.schema != null && input.schema !== PROMOTION_REVOKE_REQUEST_SCHEMA) {
    throw new Error(`不支持的 Promotion revoke schema：${input.schema}`);
  }
  const authorityRef = safeId(input.authorityRef, 'authorityRef');
  if (!authorityRef.startsWith('human:')) throw new Error('Promotion 撤销必须由 human:* Authority 作出');
  return deepFreeze({
    schema: PROMOTION_REVOKE_REQUEST_SCHEMA,
    projectId: safeId(input.projectId, 'projectId'),
    projectPath: path.resolve(requiredString(input.projectPath, 'projectPath')),
    promotionId: safeId(input.promotionId, 'promotionId'),
    authorityRef,
    reason: requiredString(input.reason, 'reason'),
    decidedAt: iso(input.decidedAt, 'decidedAt'),
  });
}

function revokeCommandFromRequest(input) {
  const request = normalizeRevokeRequest(input);
  const fingerprint = sha256(stableJson({ projectId: request.projectId, promotionId: request.promotionId }));
  return {
    schema: PROMOTION_COMMAND_SCHEMA,
    commandId: `command:revoke:${fingerprint.slice(0, 32)}`,
    promotionId: request.promotionId,
    projectId: request.projectId,
    projectPath: request.projectPath,
    action: 'revoke',
    candidate: null,
    authorityRef: request.authorityRef,
    reason: request.reason,
    decidedAt: request.decidedAt,
    supersedes: [],
  };
}

function recoverTail(paths, parsed) {
  if (!parsed.corruptTail) return '';
  fs.mkdirSync(paths.recovery, { recursive: true });
  const recoveryPath = path.join(paths.recovery, `corrupt-tail-${Date.now()}-${sha256(parsed.corruptTail).slice(0, 12)}.txt`);
  fs.writeFileSync(recoveryPath, parsed.corruptTail + '\n', 'utf8');
  atomicWrite(paths.events, parsed.events.map(row => JSON.stringify(row)).join('\n') + (parsed.events.length ? '\n' : ''));
  return slash(recoveryPath);
}

function writeConflict(paths, command, message) {
  const row = {
    schema: PROMOTION_CONFLICT_SCHEMA,
    commandId: command.commandId,
    promotionId: command.promotionId,
    commandHash: command.commandHash,
    reason: message,
    automaticMutation: false,
  };
  fs.mkdirSync(paths.conflicts, { recursive: true });
  const conflictPath = path.join(paths.conflicts, `${sha256(command.commandId).slice(0, 24)}-${command.commandHash.slice(0, 12)}.json`);
  atomicWrite(conflictPath, JSON.stringify(row, null, 2));
  return slash(conflictPath);
}

function normalizeProjectionRequest(input) {
  if (!isPlainObject(input)) throw new Error('Evidence projection request 必须是对象');
  assertKnownKeys(input, PROJECTION_REQUEST_FIELDS, 'Evidence projection request');
  rejectSecrets(input);
  if (input.schema != null && input.schema !== EVIDENCE_PROJECTION_REQUEST_SCHEMA) {
    throw new Error(`不支持的 Evidence projection schema：${input.schema}`);
  }
  const action = requiredString(input.action, 'action');
  if (!PROJECTION_ACTIONS.includes(action)) throw new Error(`非法 Evidence projection action：${action}`);
  const authorityRef = safeId(input.authorityRef, 'authorityRef');
  if (!authorityRef.startsWith('human:')) throw new Error('证据投影决定必须由 human:* Authority 作出');
  const projectId = safeId(input.projectId, 'projectId');
  const promotionId = safeId(input.promotionId, 'promotionId');
  const derivedId = `projection:${sha256(`${projectId}\n${promotionId}`).slice(0, 40)}`;
  const projectionId = input.projectionId == null ? derivedId : safeId(input.projectionId, 'projectionId');
  if (projectionId !== derivedId) throw new Error('projectionId 必须由 projectId + promotionId 确定性派生');
  const request = {
    schema: EVIDENCE_PROJECTION_REQUEST_SCHEMA,
    projectId,
    projectPath: path.resolve(requiredString(input.projectPath, 'projectPath')),
    action,
    promotionId,
    projectionId,
    authorityRef,
    reason: requiredString(input.reason, 'reason'),
    decidedAt: iso(input.decidedAt, 'decidedAt'),
  };
  request.commandId = `command:${action}:${sha256(stableJson({ projectId, promotionId, projectionId })).slice(0, 32)}`;
  request.commandHash = sha256(stableJson({
    ...request, projectPath: slash(request.projectPath), decidedAt: undefined,
  }));
  return deepFreeze(request);
}

function parseProjectionEventLog(text) {
  const lines = String(text || '').split(/\r?\n/);
  const events = [];
  let corruptTail = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (!isPlainObject(event)) throw new Error('event 必须是对象');
      assertKnownKeys(event, PROJECTION_EVENT_FIELDS, 'Evidence projection event');
      if (event.schema !== EVIDENCE_PROJECTION_EVENT_SCHEMA || event.sequence !== events.length + 1) throw new Error('schema/sequence 不连续');
      if (!PROJECTION_ACTIONS.includes(event.action)) throw new Error('action 非法');
      if (!String(event.authorityRef || '').startsWith('human:')) throw new Error('Authority 非 human:*');
      if (event.automaticPublication !== false || event.publicationGranted !== false) throw new Error('Publication 权力边界漂移');
      if (event.action === 'project' && event.projection?.schema !== PUBLIC_EVIDENCE_PROJECTION_SCHEMA) throw new Error('public projection 缺失或 schema 非法');
      if (event.action === 'withdraw' && event.projection != null) throw new Error('withdraw 不得重写 projection');
      rejectSecrets(event);
      rejectEmbeddedBody(event.projection, 'projection');
      const expectedPrevious = events.at(-1)?.eventHash || '';
      if (event.previousHash !== expectedPrevious) throw new Error('hash chain 不连续');
      const expectedHash = sha256(stableJson({ ...event, eventHash: undefined }));
      if (event.eventHash !== expectedHash) throw new Error('eventHash 不匹配');
      events.push(event);
    } catch (error) {
      const later = lines.slice(index + 1).some(value => value.trim());
      if (later) throw new Error(`Evidence projection ledger 中段损坏（第 ${index + 1} 行）：${error.message}`);
      corruptTail = line;
      break;
    }
  }
  return { events, corruptTail };
}

function projectionStateFromEvents(events) {
  const states = new Map();
  for (const event of events) {
    if (event.action === 'project') {
      states.set(event.projectionId, {
        projectionId: event.projectionId,
        promotionId: event.promotionId,
        status: 'active',
        projection: event.projection,
        authorityRef: event.authorityRef,
        reason: event.reason,
        decidedAt: event.decidedAt,
        lastSequence: event.sequence,
        lastEventHash: event.eventHash,
      });
    } else {
      const current = states.get(event.projectionId);
      states.set(event.projectionId, {
        ...current,
        status: 'withdrawn',
        authorityRef: event.authorityRef,
        reason: event.reason,
        decidedAt: event.decidedAt,
        lastSequence: event.sequence,
        lastEventHash: event.eventHash,
      });
    }
  }
  return states;
}

function projectionCatalogFromEvents(projectId, events, paths) {
  const entries = [...projectionStateFromEvents(events).values()]
    .map(entry => ({ ...entry, artifactPath: slash(path.join(paths.artifacts, `${sha256(entry.projectionId).slice(0, 40)}.json`)) }))
    .sort((a, b) => a.projectionId.localeCompare(b.projectionId, 'en'));
  const catalog = {
    schema: EVIDENCE_PROJECTION_CATALOG_SCHEMA,
    projectId,
    generatedFrom: 'evidence-projection-events',
    lastSequence: events.length,
    entryCount: entries.length,
    entries,
    publicationGranted: false,
  };
  catalog.catalogHash = sha256(stableJson(catalog));
  return catalog;
}

function publicProjectionFromPromotion(request, promotion, promotionCatalog) {
  const candidate = promotion?.candidate;
  if (!candidate || promotion.status !== 'active') throw new Error('只有 active Promotion 可以生成证据投影');
  const source = candidate.sourceRef || {};
  const publicSource = {};
  for (const key of ['kind', 'adapterId', 'site', 'capturedAt', 'candidateKind']) {
    if (typeof source[key] === 'string' && source[key]) publicSource[key] = source[key].slice(0, 500);
  }
  const projection = {
    schema: PUBLIC_EVIDENCE_PROJECTION_SCHEMA,
    projectionId: request.projectionId,
    projectFingerprint: sha256(request.projectId),
    sourcePromotionId: promotion.promotionId,
    kind: candidate.kind,
    assetRef: {
      id: candidate.assetRef.id,
      type: candidate.assetRef.type,
      version: candidate.assetRef.version,
    },
    source: publicSource,
    evidence: {
      candidateId: candidate.candidateId,
      promotionSequence: promotion.lastSequence,
      promotionEventHash: promotion.lastEventHash || '',
      promotionCatalogHash: promotionCatalog.catalogHash,
    },
    decision: { authorityClass: 'human', projectedAt: request.decidedAt },
    boundaries: {
      contentIncluded: false,
      localPathIncluded: false,
      sourceUrlIncluded: false,
      messageIdsIncluded: false,
      publicationGranted: false,
      published: false,
      requiresIndependentPublicationGate: true,
    },
  };
  rejectSecrets(projection);
  rejectEmbeddedBody(projection, 'projection');
  return deepFreeze(projection);
}

function recoverProjectionTail(paths, parsed) {
  if (!parsed.corruptTail) return '';
  fs.mkdirSync(paths.recovery, { recursive: true });
  const recoveryPath = path.join(paths.recovery, `corrupt-tail-${Date.now()}-${sha256(parsed.corruptTail).slice(0, 12)}.txt`);
  fs.writeFileSync(recoveryPath, parsed.corruptTail + '\n', 'utf8');
  atomicWrite(paths.events, parsed.events.map(row => JSON.stringify(row)).join('\n') + (parsed.events.length ? '\n' : ''));
  return slash(recoveryPath);
}

function writeProjectionArtifact(paths, projection) {
  if (!projection) return '';
  const artifactPath = path.join(paths.artifacts, `${sha256(projection.projectionId).slice(0, 40)}.json`);
  atomicWrite(artifactPath, JSON.stringify(projection, null, 2));
  return slash(artifactPath);
}

function writeProjectionConflict(paths, request, message) {
  const row = {
    schema: EVIDENCE_PROJECTION_CONFLICT_SCHEMA,
    commandId: request.commandId,
    projectionId: request.projectionId,
    promotionId: request.promotionId,
    commandHash: request.commandHash,
    reason: message,
    automaticMutation: false,
    publicationGranted: false,
  };
  fs.mkdirSync(paths.conflicts, { recursive: true });
  const conflictPath = path.join(paths.conflicts, `${sha256(request.commandId).slice(0, 24)}-${request.commandHash.slice(0, 12)}.json`);
  atomicWrite(conflictPath, JSON.stringify(row, null, 2));
  return slash(conflictPath);
}

function applyEvidenceProjectionSync(input, promotionCatalog) {
  const request = normalizeProjectionRequest(input);
  const paths = projectionPaths(request.projectPath);
  fs.mkdirSync(paths.root, { recursive: true });
  const parsed = parseProjectionEventLog(fs.existsSync(paths.events) ? fs.readFileSync(paths.events, 'utf8') : '');
  if (parsed.events.some(event => event.projectId !== request.projectId)) throw new Error('Evidence projection ledger projectId 与项目不一致');
  const recoveryPath = recoverProjectionTail(paths, parsed);
  const duplicate = parsed.events.find(event => event.commandId === request.commandId);
  if (duplicate) {
    if (duplicate.commandHash !== request.commandHash) {
      const conflictPath = writeProjectionConflict(paths, request, '同 commandId 出现不同投影决定');
      return deepFreeze({ ok: false, code: 'PROJECTION_COMMAND_CONFLICT', conflictPath, recoveryPath });
    }
    if (duplicate.projection) writeProjectionArtifact(paths, duplicate.projection);
    const catalog = projectionCatalogFromEvents(request.projectId, parsed.events, paths);
    atomicWrite(paths.catalog, JSON.stringify(catalog, null, 2));
    return deepFreeze({ ok: true, code: 'ALREADY_APPLIED', event: duplicate, catalog, recoveryPath });
  }
  const states = projectionStateFromEvents(parsed.events);
  const current = states.get(request.projectionId);
  const promotion = promotionCatalog.entries.find(entry => entry.promotionId === request.promotionId);
  try {
    if (request.action === 'project') {
      if (current) throw new Error(`证据投影已存在：${request.projectionId} (${current.status})`);
      if (!promotion || promotion.status !== 'active') throw new Error('只有 active Promotion 可以生成证据投影');
    } else if (!current || current.status !== 'active') {
      throw new Error('只有 active 证据投影可以撤回');
    }
  } catch (error) {
    const conflictPath = writeProjectionConflict(paths, request, error.message);
    return deepFreeze({ ok: false, code: 'PROJECTION_STATE_CONFLICT', message: error.message, conflictPath, recoveryPath });
  }
  const projection = request.action === 'project'
    ? publicProjectionFromPromotion(request, promotion, promotionCatalog)
    : null;
  const event = {
    schema: EVIDENCE_PROJECTION_EVENT_SCHEMA,
    sequence: parsed.events.length + 1,
    previousHash: parsed.events.at(-1)?.eventHash || '',
    commandId: request.commandId,
    commandHash: request.commandHash,
    projectionId: request.projectionId,
    projectId: request.projectId,
    promotionId: request.promotionId,
    action: request.action,
    projection,
    authorityRef: request.authorityRef,
    reason: request.reason,
    decidedAt: request.decidedAt,
    automaticPublication: false,
    publicationGranted: false,
  };
  event.eventHash = sha256(stableJson({ ...event, eventHash: undefined }));
  fs.appendFileSync(paths.events, JSON.stringify(event) + '\n', 'utf8');
  const artifactPath = writeProjectionArtifact(paths, projection);
  const catalog = projectionCatalogFromEvents(request.projectId, [...parsed.events, event], paths);
  atomicWrite(paths.catalog, JSON.stringify(catalog, null, 2));
  return deepFreeze({ ok: true, code: 'APPLIED', event, catalog, artifactPath, recoveryPath });
}

function readProjectionCatalogSync(input) {
  const query = normalizeManagementQuery(input);
  const paths = projectionPaths(query.projectPath);
  const parsed = parseProjectionEventLog(fs.existsSync(paths.events) ? fs.readFileSync(paths.events, 'utf8') : '');
  if (parsed.events.some(event => event.projectId !== query.projectId)) throw new Error('Evidence projection ledger projectId 与项目不一致');
  const recoveryPath = recoverProjectionTail(paths, parsed);
  const catalog = projectionCatalogFromEvents(query.projectId, parsed.events, paths);
  if (parsed.events.length || fs.existsSync(paths.root)) atomicWrite(paths.catalog, JSON.stringify(catalog, null, 2));
  return deepFreeze({ ok: true, catalog, recoveryPath });
}

function applyPromotionCommandSync(input) {
  const command = normalizeCommand(input);
  const paths = promotionPaths(command.projectPath);
  fs.mkdirSync(paths.root, { recursive: true });
  const parsed = parseEventLog(fs.existsSync(paths.events) ? fs.readFileSync(paths.events, 'utf8') : '');
  if (parsed.events.some(event => event.projectId !== command.projectId)) throw new Error('Promotion ledger projectId 与项目不一致');
  const recoveryPath = recoverTail(paths, parsed);
  const duplicate = parsed.events.find(event => event.commandId === command.commandId);
  if (duplicate) {
    if (duplicate.commandHash !== command.commandHash) {
      const conflictPath = writeConflict(paths, command, '同 commandId 出现不同决定内容');
      return deepFreeze({ ok: false, code: 'PROMOTION_COMMAND_CONFLICT', conflictPath, recoveryPath });
    }
    const catalog = catalogFromEvents(command.projectId, parsed.events);
    atomicWrite(paths.catalog, JSON.stringify(catalog, null, 2));
    return deepFreeze({ ok: true, code: 'ALREADY_APPLIED', event: duplicate, catalog, recoveryPath, paths: { events: slash(paths.events), catalog: slash(paths.catalog) } });
  }
  try {
    verifyCandidateEnvelope(command);
    validateTransition(command, stateFromEvents(parsed.events));
  } catch (error) {
    const conflictPath = writeConflict(paths, command, error.message);
    return deepFreeze({ ok: false, code: 'PROMOTION_STATE_CONFLICT', message: error.message, conflictPath, recoveryPath });
  }
  const event = {
    schema: PROMOTION_EVENT_SCHEMA,
    sequence: parsed.events.length + 1,
    previousHash: parsed.events.at(-1)?.eventHash || '',
    commandId: command.commandId,
    commandHash: command.commandHash,
    promotionId: command.promotionId,
    projectId: command.projectId,
    action: command.action,
    candidate: command.candidate,
    authorityRef: command.authorityRef,
    reason: command.reason,
    decidedAt: command.decidedAt,
    supersedes: command.supersedes,
    automaticPromotion: false,
    publicationGranted: false,
  };
  event.eventHash = sha256(stableJson({ ...event, eventHash: undefined }));
  fs.appendFileSync(paths.events, JSON.stringify(event) + '\n', 'utf8');
  const allEvents = [...parsed.events, event];
  const catalog = catalogFromEvents(command.projectId, allEvents);
  atomicWrite(paths.catalog, JSON.stringify(catalog, null, 2));
  return deepFreeze({
    ok: true, code: 'APPLIED', event, catalog, recoveryPath,
    paths: { events: slash(paths.events), catalog: slash(paths.catalog) },
  });
}

function normalizeConversationPromotionRequest(input) {
  if (!isPlainObject(input)) throw new Error('Conversation Promotion Request 必须是对象');
  assertKnownKeys(input, REQUEST_FIELDS, 'Conversation Promotion Request');
  rejectSecrets(input);
  if (input.schema != null && input.schema !== CONVERSATION_PROMOTION_REQUEST_SCHEMA) throw new Error(`不支持的 Conversation Promotion schema：${input.schema}`);
  if (!isPlainObject(input.sourceRef)) throw new Error('sourceRef 必须是对象');
  rejectEmbeddedBody(input.sourceRef, 'sourceRef');
  const markdown = String(input.markdown ?? '').replace(/\r\n?/g, '\n');
  if (!markdown.trim()) throw new Error('对话资产正文不能为空');
  const authorityRef = safeId(input.authorityRef, 'authorityRef');
  if (!authorityRef.startsWith('human:')) throw new Error('对话升格必须由 human:* Authority 明确触发');
  const supersedes = [...new Set((Array.isArray(input.supersedes) ? input.supersedes : [])
    .map((item, index) => safeId(item, `supersedes[${index}]`)))];
  return deepFreeze({
    schema: CONVERSATION_PROMOTION_REQUEST_SCHEMA,
    projectId: safeId(input.projectId, 'projectId'),
    projectPath: path.resolve(requiredString(input.projectPath, 'projectPath')),
    title: requiredString(input.title, 'title'),
    markdown,
    sourceRef: clonePlain(input.sourceRef, 'sourceRef'),
    capturedAt: iso(input.capturedAt, 'capturedAt'),
    authorityRef,
    reason: requiredString(input.reason, 'reason'),
    decidedAt: iso(input.decidedAt, 'decidedAt'),
    supersedes,
  });
}

function normalizeStructuredPromotionReviewRequest(input) {
  if (!isPlainObject(input)) throw new Error('Structured Promotion Review Request 必须是对象');
  assertKnownKeys(input, STRUCTURED_REVIEW_FIELDS, 'Structured Promotion Review Request');
  rejectSecrets(input);
  if (input.schema != null && input.schema !== STRUCTURED_PROMOTION_REVIEW_REQUEST_SCHEMA) {
    throw new Error(`不支持的 Structured Promotion Review schema：${input.schema}`);
  }
  const kind = requiredString(input.kind, 'kind');
  if (!STRUCTURED_PROMOTION_KINDS.includes(kind)) throw new Error(`非法结构化候选类型：${kind}`);
  const action = requiredString(input.action, 'action');
  if (!['approve', 'reject'].includes(action)) throw new Error('结构化候选审阅只允许 approve/reject');
  if (!isPlainObject(input.sourceRef)) throw new Error('sourceRef 必须是对象');
  rejectEmbeddedBody(input.sourceRef, 'sourceRef');
  const markdown = String(input.markdown ?? '').replace(/\r\n?/g, '\n');
  if (!markdown.trim()) throw new Error('结构化候选正文不能为空');
  const proposedBy = safeId(input.proposedBy, 'proposedBy');
  if (!/^(?:system|human):/.test(proposedBy)) throw new Error('proposedBy 必须是 system:* 或 human:*');
  const authorityRef = safeId(input.authorityRef, 'authorityRef');
  if (!authorityRef.startsWith('human:')) throw new Error('结构化候选决定必须由 human:* Authority 作出');
  const supersedes = [...new Set((Array.isArray(input.supersedes) ? input.supersedes : [])
    .map((item, index) => safeId(item, `supersedes[${index}]`)))];
  if (action !== 'approve' && supersedes.length) throw new Error('只有 approve 可以声明 supersedes');
  return deepFreeze({
    schema: STRUCTURED_PROMOTION_REVIEW_REQUEST_SCHEMA,
    projectId: safeId(input.projectId, 'projectId'),
    projectPath: path.resolve(requiredString(input.projectPath, 'projectPath')),
    kind,
    title: requiredString(input.title, 'title'),
    markdown,
    sourceRef: clonePlain(input.sourceRef, 'sourceRef'),
    proposedBy,
    proposedAt: iso(input.proposedAt, 'proposedAt'),
    action,
    authorityRef,
    reason: requiredString(input.reason, 'reason'),
    decidedAt: iso(input.decidedAt, 'decidedAt'),
    supersedes,
  });
}

class PromotionLedger {
  constructor() { this.queues = new Map(); }

  _enqueue(projectPath, operation) {
    projectPath = path.resolve(requiredString(projectPath, 'projectPath'));
    const key = process.platform === 'win32' ? projectPath.toLocaleLowerCase('en-US') : projectPath;
    const previous = this.queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.queues.set(key, current);
    return current.finally(() => { if (this.queues.get(key) === current) this.queues.delete(key); });
  }

  apply(input) {
    return this._enqueue(input?.projectPath, () => applyPromotionCommandSync(input));
  }

  listManagement(input) {
    const query = normalizeManagementQuery(input);
    return this._enqueue(query.projectPath, () => {
      const promotions = readPromotionCatalogSync(query);
      const projections = readProjectionCatalogSync(query);
      return deepFreeze({
        ok: true,
        promotions: promotions.catalog,
        projections: projections.catalog,
        boundaries: {
          automaticPromotion: false,
          publicationGranted: false,
          publicProjectionContainsBody: false,
          independentPublicationGateRequired: true,
        },
        recoveryPaths: [promotions.recoveryPath, projections.recoveryPath].filter(Boolean),
      });
    });
  }

  revokePromotion(input) {
    const command = revokeCommandFromRequest(input);
    return this.apply(command);
  }

  manageEvidenceProjection(input) {
    const request = normalizeProjectionRequest(input);
    return this._enqueue(request.projectPath, () => {
      const promotions = readPromotionCatalogSync({
        schema: PROMOTION_MANAGEMENT_QUERY_SCHEMA,
        projectId: request.projectId,
        projectPath: request.projectPath,
      });
      return applyEvidenceProjectionSync(input, promotions.catalog);
    });
  }

  async promoteConversation(input, ingestionPipeline) {
    const request = normalizeConversationPromotionRequest(input);
    const fingerprint = sha256(stableJson({
      projectId: request.projectId, title: request.title, markdown: request.markdown, sourceRef: request.sourceRef,
    }));
    const assetId = `asset:conversation:${fingerprint.slice(0, 32)}`;
    const promotionId = `promotion:conversation:${fingerprint.slice(0, 32)}`;
    const ingestion = await ingestionPipeline.register({
      schema: 'mazz.ingestion-request/v0', assetId, projectId: request.projectId,
      projectPath: request.projectPath, title: request.title, mediaType: 'text/markdown; charset=utf-8',
      layer: 'derived', text: request.markdown, sourceRef: request.sourceRef,
      provenance: { kind: 'derived', source: 'w62f.ai-conversation', protocol: 'W74c-1' },
      importedAt: request.capturedAt,
    });
    if (!ingestion?.ok) return deepFreeze({ ok: false, code: ingestion.code || 'INGESTION_FAILED', ingestion });
    const promotion = await this.apply({
      schema: PROMOTION_COMMAND_SCHEMA,
      commandId: `command:approve:${fingerprint.slice(0, 32)}`,
      promotionId,
      projectId: request.projectId,
      projectPath: request.projectPath,
      action: 'approve',
      candidate: {
        candidateId: `candidate:conversation:${fingerprint.slice(0, 32)}`,
        kind: 'asset',
        assetRef: { id: assetId, path: ingestion.paths.envelope, type: 'text/markdown; charset=utf-8', version: ingestion.manifest.version },
        sourceRef: request.sourceRef,
        proposedBy: 'system:w62f-ai-conversation',
        proposedAt: request.capturedAt,
      },
      authorityRef: request.authorityRef,
      reason: request.reason,
      decidedAt: request.decidedAt,
      supersedes: request.supersedes,
    });
    return deepFreeze({ ok: promotion.ok, code: promotion.code, assetId, promotionId, ingestion, promotion });
  }

  async reviewStructuredConversationCandidate(input, ingestionPipeline) {
    const request = normalizeStructuredPromotionReviewRequest(input);
    const fingerprint = sha256(stableJson({
      projectId: request.projectId, kind: request.kind, title: request.title,
      markdown: request.markdown, sourceRef: request.sourceRef,
    }));
    const assetId = `asset:conversation-${request.kind}:${fingerprint.slice(0, 32)}`;
    const promotionId = `promotion:${request.kind}:${fingerprint.slice(0, 32)}`;
    const ingestion = await ingestionPipeline.register({
      schema: 'mazz.ingestion-request/v0', assetId, projectId: request.projectId,
      projectPath: request.projectPath, title: request.title, mediaType: 'text/markdown; charset=utf-8',
      layer: 'derived', text: request.markdown, sourceRef: request.sourceRef,
      provenance: {
        kind: 'derived', source: 'w62f.structured-promotion-candidate',
        protocol: 'W74c-2', candidateKind: request.kind,
      },
      importedAt: request.proposedAt,
    });
    if (!ingestion?.ok) return deepFreeze({ ok: false, code: ingestion.code || 'INGESTION_FAILED', ingestion });
    const promotion = await this.apply({
      schema: PROMOTION_COMMAND_SCHEMA,
      commandId: `command:${request.action}:${fingerprint.slice(0, 32)}`,
      promotionId,
      projectId: request.projectId,
      projectPath: request.projectPath,
      action: request.action,
      candidate: {
        candidateId: `candidate:${request.kind}:${fingerprint.slice(0, 32)}`,
        kind: request.kind,
        assetRef: {
          id: assetId, path: ingestion.paths.envelope,
          type: 'text/markdown; charset=utf-8', version: ingestion.manifest.version,
        },
        sourceRef: request.sourceRef,
        proposedBy: request.proposedBy,
        proposedAt: request.proposedAt,
      },
      authorityRef: request.authorityRef,
      reason: request.reason,
      decidedAt: request.decidedAt,
      supersedes: request.supersedes,
    });
    return deepFreeze({ ok: promotion.ok, code: promotion.code, assetId, promotionId, ingestion, promotion });
  }

  healthSnapshot() { return Object.freeze({ activeProjects: this.queues.size }); }
}

module.exports = {
  CONVERSATION_PROMOTION_REQUEST_SCHEMA,
  EVIDENCE_PROJECTION_CATALOG_SCHEMA,
  EVIDENCE_PROJECTION_EVENT_SCHEMA,
  EVIDENCE_PROJECTION_REQUEST_SCHEMA,
  PUBLIC_EVIDENCE_PROJECTION_SCHEMA,
  PROMOTION_ACTIONS,
  PROMOTION_CATALOG_SCHEMA,
  PROMOTION_COMMAND_SCHEMA,
  PROMOTION_CONFLICT_SCHEMA,
  PROMOTION_EVENT_SCHEMA,
  PROMOTION_KINDS,
  PROMOTION_MANAGEMENT_QUERY_SCHEMA,
  PROMOTION_REVOKE_REQUEST_SCHEMA,
  STRUCTURED_PROMOTION_KINDS,
  STRUCTURED_PROMOTION_REVIEW_REQUEST_SCHEMA,
  PromotionLedger,
  applyEvidenceProjectionSync,
  applyPromotionCommandSync,
  normalizeCommand,
  normalizeConversationPromotionRequest,
  normalizeManagementQuery,
  normalizeProjectionRequest,
  normalizeRevokeRequest,
  normalizeStructuredPromotionReviewRequest,
  parseEventLog,
  parseProjectionEventLog,
  promotionPaths,
  projectionPaths,
  readPromotionCatalogSync,
  readProjectionCatalogSync,
};
