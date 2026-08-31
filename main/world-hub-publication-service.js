'use strict';

// W94Gb: local fake-Hub public projection.  It stores only an explicit,
// public-safe envelope and content manifest; local Workspace facts, bytes,
// grants and private provenance never cross this boundary.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, requiredString, stringList,
} = require('./foundation/plain-value');
const { workspaceId } = require('./workspace-event-service');

const HUB_STORE_SCHEMA = 'mazz.fake-hub-store/v0';
const PUBLIC_ENVELOPE_SCHEMA = 'mazz.publication-envelope/v1';
const PUBLIC_MANIFEST_SCHEMA = 'mazz.public-content-manifest/v1';
const PUBLIC_GRANT_SCHEMA = 'mazz.publication-grant/v1';
const PUBLIC_RECEIPT_SCHEMA = 'mazz.publication-receipt/v1';
const HUB_SNAPSHOT_SCHEMA = 'mazz.fake-hub-snapshot/v0';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const HASH = /^(?:sha256:)?[a-f0-9]{64}$/i;
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key|cookie|transcript|prompt|clipboard|keystroke|draft)/i;
const URL_OR_PATH = /(?:^[A-Za-z]:[\\/]|^\\\\|^\/|(?:https?|file|ws|wss):\/\/|\.\.(?:[\\/]|$))/i;
const ACTION_SCOPES = Object.freeze({
  prepare: 'publication:prepare', publish: 'publication:publish', withdraw: 'publication:withdraw', sync: 'publication:sync',
});

function codedError(code, message) { return Object.assign(new Error(message), { code }); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex'); }

function safeId(value, label, prefix = '') {
  const text = requiredString(value, label);
  if (!ID.test(text) || (prefix && !text.startsWith(prefix))) throw codedError('HUB_INVALID', `${label} 非法`);
  return text;
}

function safeRef(value, label, prefixes = []) {
  const text = safeId(value, label);
  if (prefixes.length && !prefixes.some(prefix => text.startsWith(prefix))) throw codedError('HUB_INVALID', `${label} 引用类型非法`);
  return text;
}

function rejectPrivate(value, label = 'Public value', trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectPrivate(item, label, `${trail}[${index}]`));
  if (!isPlainObject(value)) {
    if (typeof value === 'string' && URL_OR_PATH.test(value)) throw codedError('HUB_PRIVATE_VALUE', `${label} 不得包含路径或网络定位器`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const at = trail ? `${trail}.${key}` : key;
    if (SECRET_KEY.test(key)) throw codedError('HUB_PRIVATE_VALUE', `${label} 禁止私有字段: ${at}`);
    rejectPrivate(child, label, at);
  }
}

function nowIso(now) { return new Date(typeof now === 'function' ? now() : now || Date.now()).toISOString(); }

function atomicWrite(filePath, value, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try { fsImpl.renameSync(temporary, filePath); }
  catch (error) { try { fsImpl.unlinkSync(temporary); } catch {} throw error; }
}

function normalizeManifest(input) {
  if (!isPlainObject(input)) throw codedError('HUB_INVALID', 'content manifest 必须是对象');
  assertKnownKeys(input, ['schema', 'manifestId', 'contentRoot', 'blocks', 'createdAt'], 'content manifest');
  if (input.schema !== PUBLIC_MANIFEST_SCHEMA) throw codedError('HUB_INVALID', 'content manifest schema 不支持');
  const manifestId = safeRef(input.manifestId, 'manifestId', ['manifest:']);
  const blocks = Array.isArray(input.blocks) ? input.blocks.map((block, index) => {
    if (!isPlainObject(block)) throw codedError('HUB_INVALID', `manifest.blocks[${index}] 必须是对象`);
    assertKnownKeys(block, ['contentId', 'mediaType', 'size', 'contentHash', 'encrypted'], `manifest.blocks[${index}]`);
    const contentId = safeRef(block.contentId, `manifest.blocks[${index}].contentId`, ['content:']);
    const mediaType = requiredString(block.mediaType, `manifest.blocks[${index}].mediaType`);
    if (!/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(mediaType)) throw codedError('HUB_INVALID', 'mediaType 非法');
    if (!Number.isSafeInteger(block.size) || block.size < 0) throw codedError('HUB_INVALID', 'manifest block size 非法');
    const contentHash = requiredString(block.contentHash, `manifest.blocks[${index}].contentHash`);
    if (!HASH.test(contentHash)) throw codedError('HUB_INVALID', 'manifest contentHash 非法');
    if (typeof block.encrypted !== 'boolean') throw codedError('HUB_INVALID', 'manifest encrypted 必须是 boolean');
    return { contentId, mediaType, size: block.size, contentHash: contentHash.toLowerCase(), encrypted: block.encrypted };
  }) : [];
  if (!blocks.length) throw codedError('HUB_INVALID', 'content manifest 至少需要一个 block');
  if (new Set(blocks.map(block => block.contentId)).size !== blocks.length) throw codedError('HUB_INVALID', 'contentId 不能重复');
  const body = { schema: PUBLIC_MANIFEST_SCHEMA, manifestId, blocks, createdAt: nowIso(input.createdAt || Date.now()) };
  const expectedRoot = `root:${digest(body)}`;
  if (input.contentRoot !== expectedRoot) throw codedError('HUB_MANIFEST_MISMATCH', 'contentRoot 与 manifest 不一致');
  const manifest = { ...body, contentRoot: expectedRoot };
  rejectPrivate(manifest, 'content manifest');
  return deepFreeze(manifest);
}

function normalizeEnvelope(input) {
  if (!isPlainObject(input)) throw codedError('HUB_INVALID', 'publication envelope 必须是对象');
  assertKnownKeys(input, [
    'schema', 'publicationId', 'workId', 'creatorId', 'editionType', 'version', 'title', 'summary', 'visibility',
    'worldRef', 'contentManifestRef', 'contentIds', 'licenseRef', 'provenance', 'publicationGrantRef', 'signatureRef',
    'createdAt', 'publishedAt', 'withdrawnAt',
  ], 'publication envelope');
  if (input.schema !== PUBLIC_ENVELOPE_SCHEMA) throw codedError('HUB_INVALID', 'publication envelope schema 不支持');
  const publicationId = safeRef(input.publicationId, 'publicationId', ['publication:']);
  const workId = safeRef(input.workId, 'workId', ['work:']);
  const creatorId = safeRef(input.creatorId, 'creatorId', ['creator:']);
  const editionType = safeId(input.editionType, 'editionType');
  const version = safeId(input.version, 'version');
  const title = requiredString(input.title, 'title');
  const summary = requiredString(input.summary, 'summary');
  const visibility = input.visibility || 'public';
  if (!['public', 'unlisted', 'withdrawn'].includes(visibility)) throw codedError('HUB_INVALID', 'visibility 非法');
  const worldRef = input.worldRef == null ? undefined : safeRef(input.worldRef, 'worldRef', ['world:']);
  const contentManifestRef = safeRef(input.contentManifestRef, 'contentManifestRef', ['manifest:']);
  const contentIds = stringList(input.contentIds, 'contentIds').map((value, index) => safeRef(value, `contentIds[${index}]`, ['content:']));
  if (!contentIds.length) throw codedError('HUB_INVALID', 'contentIds 不能为空');
  const licenseRef = safeRef(input.licenseRef, 'licenseRef', ['license:']);
  const provenance = isPlainObject(input.provenance) ? clonePlain(input.provenance, 'provenance') : {};
  const publicationGrantRef = safeRef(input.publicationGrantRef, 'publicationGrantRef', ['grant:']);
  const signatureRef = safeRef(input.signatureRef, 'signatureRef', ['signature:']);
  const createdAt = nowIso(input.createdAt || Date.now());
  const envelope = {
    schema: PUBLIC_ENVELOPE_SCHEMA, publicationId, workId, creatorId, editionType, version, title, summary, visibility,
    ...(worldRef ? { worldRef } : {}), contentManifestRef, contentIds, licenseRef, provenance, publicationGrantRef, signatureRef,
    createdAt, ...(input.publishedAt ? { publishedAt: nowIso(input.publishedAt) } : {}),
    ...(input.withdrawnAt ? { withdrawnAt: nowIso(input.withdrawnAt) } : {}),
  };
  rejectPrivate(envelope, 'publication envelope');
  return deepFreeze(envelope);
}

function normalizeGrant(input, at = Date.now()) {
  if (!isPlainObject(input)) throw codedError('HUB_GRANT_INVALID', 'publication grant 必须是对象');
  assertKnownKeys(input, ['schema', 'grantId', 'publicationId', 'subjectId', 'scope', 'authorityRef', 'sourceArtifactRefs', 'rightsRef', 'issuedAt', 'expiresAt', 'status'], 'publication grant');
  if (input.schema !== PUBLIC_GRANT_SCHEMA) throw codedError('HUB_GRANT_INVALID', 'publication grant schema 不支持');
  const grantId = safeRef(input.grantId, 'grantId', ['grant:']);
  const publicationId = safeRef(input.publicationId, 'grant.publicationId', ['publication:']);
  const subjectId = safeId(input.subjectId, 'subjectId');
  const scope = stringList(input.scope, 'scope');
  if (!scope.length || scope.some(value => !Object.values(ACTION_SCOPES).includes(value))) throw codedError('HUB_GRANT_INVALID', 'grant scope 非法');
  const authorityRef = safeRef(input.authorityRef, 'authorityRef', ['human:']);
  const sourceArtifactRefs = stringList(input.sourceArtifactRefs || [], 'sourceArtifactRefs').map((value, index) => safeRef(value, `sourceArtifactRefs[${index}]`, ['artifact:', 'receipt:']));
  const rightsRef = safeRef(input.rightsRef, 'rightsRef', ['rights:', 'license:']);
  const issuedAt = nowIso(input.issuedAt || at);
  const expiresAt = input.expiresAt == null ? undefined : nowIso(input.expiresAt);
  const status = input.status || 'active';
  if (!['active', 'revoked', 'expired'].includes(status)) throw codedError('HUB_GRANT_INVALID', 'grant status 非法');
  const grant = { schema: PUBLIC_GRANT_SCHEMA, grantId, publicationId, subjectId, scope, authorityRef, sourceArtifactRefs, rightsRef, issuedAt, ...(expiresAt ? { expiresAt } : {}), status };
  rejectPrivate(grant, 'publication grant');
  return deepFreeze(grant);
}

function unsignedEnvelope(envelope) { return { ...envelope, signatureRef: '' }; }
function expectedSignatureRef(envelope, grant) { return `signature:${digest({ envelope: unsignedEnvelope(envelope), grantId: grant.grantId, publicationId: grant.publicationId })}`; }

function normalizeStore(input, expectedWorkspaceId, expectedHubIdentity = 'fake-hub:local') {
  if (!isPlainObject(input) || input.schema !== HUB_STORE_SCHEMA) throw codedError('HUB_STORE_CORRUPT', 'fake Hub Store schema 非法');
  assertKnownKeys(input, ['schema', 'workspaceId', 'hubIdentity', 'revision', 'previousHash', 'stateHash', 'projections', 'receipts', 'commands'], 'fake Hub Store');
  if (input.workspaceId !== expectedWorkspaceId) throw codedError('HUB_STORE_CORRUPT', 'fake Hub Store Workspace identity 不匹配');
  if (input.hubIdentity !== expectedHubIdentity) throw codedError('HUB_STORE_CORRUPT', 'Hub identity 非法');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw codedError('HUB_STORE_CORRUPT', 'fake Hub revision 非法');
  if (typeof input.previousHash !== 'string' || typeof input.stateHash !== 'string') throw codedError('HUB_STORE_CORRUPT', 'fake Hub hash 不完整');
  for (const key of ['projections', 'receipts', 'commands']) if (!Array.isArray(input[key])) throw codedError('HUB_STORE_CORRUPT', `${key} 必须是数组`);
  const body = { schema: HUB_STORE_SCHEMA, workspaceId: expectedWorkspaceId, hubIdentity: expectedHubIdentity, revision: input.revision, previousHash: input.previousHash, projections: input.projections, receipts: input.receipts, commands: input.commands };
  if (digest(body) !== input.stateHash) throw codedError('HUB_STORE_CORRUPT', 'fake Hub stateHash 校验失败');
  rejectPrivate(body, 'fake Hub Store');
  return deepFreeze({ ...body, stateHash: input.stateHash });
}

class WorldHubPublicationService {
  constructor({ rootProvider, eventService = null, fsImpl = fs, now = () => Date.now(), hubIdentity = 'fake-hub:local', signatureVerifier = null, allowDigestReference = true } = {}) {
    if (typeof rootProvider !== 'function') throw new TypeError('WorldHubPublicationService 需要 rootProvider');
    if (signatureVerifier !== null && typeof signatureVerifier?.verifyPublication !== 'function') throw new TypeError('signatureVerifier 必须实现 verifyPublication');
    this.rootProvider = rootProvider; this.eventService = eventService; this.fs = fsImpl; this.now = now; this.hubIdentity = safeId(hubIdentity, 'hubIdentity');
    this.signatureVerifier = signatureVerifier; this.allowDigestReference = allowDigestReference === true;
  }

  root() { return path.resolve(requiredString(this.rootProvider(), 'workspacePath')); }
  workspaceId() { return workspaceId(this.root()); }
  folder() { return path.join(this.root(), '.mazz', 'hub'); }
  file() { return path.join(this.folder(), 'fake-store.json'); }

  empty() {
    const body = { schema: HUB_STORE_SCHEMA, workspaceId: this.workspaceId(), hubIdentity: this.hubIdentity, revision: 0, previousHash: '', projections: [], receipts: [], commands: [] };
    return { ...body, stateHash: digest(body) };
  }

  read() {
    if (!this.fs.existsSync(this.file())) return this.empty();
    try { return normalizeStore(JSON.parse(this.fs.readFileSync(this.file(), 'utf8')), this.workspaceId(), this.hubIdentity); }
    catch (error) { throw codedError(error.code || 'HUB_STORE_CORRUPT', `fake Hub Store 损坏；原文件保留: ${error.message}`); }
  }

  _assertExpectedRevision(current, expectedRevision) {
    if (expectedRevision == null || Number(expectedRevision) !== current.revision) throw codedError('HUB_CAS_MISMATCH', `fake Hub CAS 冲突：期望 ${expectedRevision}，当前 ${current.revision}`);
  }

  write(next, expectedRevision) {
    const current = this.read();
    this._assertExpectedRevision(current, expectedRevision);
    const body = { schema: HUB_STORE_SCHEMA, workspaceId: this.workspaceId(), hubIdentity: this.hubIdentity, revision: current.revision + 1, previousHash: current.stateHash, projections: next.projections, receipts: next.receipts, commands: next.commands };
    const candidate = normalizeStore({ ...body, stateHash: digest(body) }, this.workspaceId(), this.hubIdentity);
    atomicWrite(this.file(), candidate, this.fs);
    return candidate;
  }

  _event(action, publicationId, receiptId, outcome) {
    if (!this.eventService?.capture) return { recorded: false, reason: 'UNAVAILABLE' };
    try {
      return this.eventService.capture({
        idempotencyKey: `hub:${action}:${publicationId}:${receiptId}`, occurredAt: nowIso(this.now), actorType: 'human',
        sourceModule: 'hub', action, subjectRefs: [publicationId], objectRefs: [receiptId], contextRefs: ['domain:world'],
        outcome, provenance: { producer: 'W94Gb-fake-hub' }, privacyClass: 'operational', retentionClass: 'keep',
        summary: `Hub ${action}`,
      });
    } catch { return { recorded: false, reason: 'CAPTURE_FAILED' }; }
  }

  _validatePackage(input, action) {
    if (!isPlainObject(input)) throw codedError('HUB_INVALID', 'publication payload 必须是对象');
    assertKnownKeys(input, ['envelope', 'manifest', 'grant', 'signature', 'expectedRevision'], 'publication payload');
    const envelope = normalizeEnvelope(input.envelope);
    const manifest = normalizeManifest(input.manifest);
    const grant = normalizeGrant(input.grant, this.now);
    if (grant.publicationId !== envelope.publicationId || envelope.publicationGrantRef !== grant.grantId) throw codedError('HUB_GRANT_MISMATCH', 'publication 与 grant identity 不一致');
    if (manifest.manifestId !== envelope.contentManifestRef) throw codedError('HUB_MANIFEST_MISMATCH', 'publication 与 manifest identity 不一致');
    const manifestContentIds = manifest.blocks.map(block => block.contentId);
    if (JSON.stringify([...envelope.contentIds].sort()) !== JSON.stringify([...manifestContentIds].sort())) throw codedError('HUB_MANIFEST_MISMATCH', 'publication contentIds 与 manifest 不一致');
    if (grant.rightsRef !== envelope.licenseRef) throw codedError('HUB_GRANT_MISMATCH', 'grant rightsRef 与 licenseRef 不一致');
    if (grant.status !== 'active') throw codedError('HUB_GRANT_INACTIVE', 'grant 当前不可用');
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) throw codedError('HUB_GRANT_EXPIRED', 'grant 已过期');
    if (!grant.scope.includes(ACTION_SCOPES[action])) throw codedError('HUB_SCOPE_DENIED', `grant 缺少 ${ACTION_SCOPES[action]}`);
    let signatureVerified = false;
    let signatureKeyId = '';
    if (input.signature !== undefined) {
      if (!this.signatureVerifier) throw codedError('HUB_SIGNATURE_UNSUPPORTED', '当前 Hub adapter 未配置非对称签名验证器');
      const verification = this.signatureVerifier.verifyPublication({ envelope, grant, signature: input.signature });
      if (verification?.valid !== true) throw codedError('HUB_SIGNATURE_MISMATCH', `publication Ed25519 签名校验失败: ${verification?.reason || 'UNKNOWN'}`);
      signatureVerified = true;
      signatureKeyId = safeRef(verification.keyId, 'signatureKeyId', ['signer:']);
    } else {
      if (!this.allowDigestReference || envelope.signatureRef !== expectedSignatureRef(envelope, grant)) throw codedError('HUB_SIGNATURE_MISMATCH', 'publication signatureRef 校验失败');
    }
    return { envelope, manifest, grant, signatureVerified, signatureKeyId };
  }

  _commandHash(action, envelope, manifest, grant) { return digest({ action, envelope, manifest, grant: { grantId: grant.grantId, publicationId: grant.publicationId, scope: grant.scope, authorityRef: grant.authorityRef, status: grant.status } }); }

  _receipt(action, packageValue, commandHash, outcome, status, revision) {
    const at = nowIso(this.now);
    const projectionDigest = digest({ envelope: packageValue.envelope, manifest: packageValue.manifest });
    return { schema: PUBLIC_RECEIPT_SCHEMA, receiptId: `receipt:${digest({ action, commandHash, outcome, projectionDigest })}`, commandHash, action, outcome, status, publicationId: packageValue.envelope.publicationId, projectionDigest, publicationGrantRef: packageValue.grant.grantId, hubIdentity: this.hubIdentity, revision, occurredAt: at };
  }

  _result(store, projection, receipt, event, idempotent = false) {
    return deepFreeze({ schema: HUB_SNAPSHOT_SCHEMA, workspaceId: store.workspaceId, hubIdentity: store.hubIdentity, revision: store.revision, projection: projection ? clonePlain(projection) : null, receipt: receipt ? clonePlain(receipt) : null, event, idempotent, localOnly: this.hubIdentity === 'fake-hub:local', networkCalls: 0, authorityGranted: false });
  }

  prepare(input = {}) {
    const packageValue = this._validatePackage(input, 'prepare');
    const current = this.read();
    const commandHash = this._commandHash('prepare', packageValue.envelope, packageValue.manifest, packageValue.grant);
    const prior = current.commands.find(command => command.commandHash === commandHash);
    if (prior) return this._result(current, current.projections.find(row => row.publicationId === packageValue.envelope.publicationId), current.receipts.find(row => row.receiptId === prior.receiptId), { recorded: true, reason: 'IDEMPOTENT' }, true);
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const existing = current.projections.find(row => row.publicationId === packageValue.envelope.publicationId);
    const projectionDigest = digest({ envelope: packageValue.envelope, manifest: packageValue.manifest });
    if (existing && existing.projectionDigest !== projectionDigest) throw codedError('HUB_PUBLIC_CONFLICT', '同一 publicationId 的内容不可静默替换');
    const projection = {
      publicationId: packageValue.envelope.publicationId, envelope: packageValue.envelope, manifest: packageValue.manifest,
      projectionDigest, status: existing?.status === 'withdrawn' ? 'prepared' : (existing?.status || 'prepared'),
      signatureVerified: packageValue.signatureVerified, ...(packageValue.signatureKeyId ? { signatureKeyId: packageValue.signatureKeyId } : {}),
      preparedAt: nowIso(this.now), updatedAt: nowIso(this.now), lastReceiptId: '',
    };
    const receipt = this._receipt('prepare', packageValue, commandHash, 'prepared', projection.status, current.revision + 1);
    projection.lastReceiptId = receipt.receiptId;
    const next = this.write({ projections: [...current.projections.filter(row => row.publicationId !== projection.publicationId), projection], receipts: [...current.receipts, receipt], commands: [...current.commands, { commandHash, action: 'prepare', receiptId: receipt.receiptId, publicationId: projection.publicationId, outcome: 'prepared' }] }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    return this._result(next, projection, receipt, this._event('publication-prepare', projection.publicationId, receipt.receiptId, 'success'));
  }

  publish(input = {}) {
    const packageValue = this._validatePackage(input, 'publish');
    const current = this.read();
    const commandHash = this._commandHash('publish', packageValue.envelope, packageValue.manifest, packageValue.grant);
    const prior = current.commands.find(command => command.commandHash === commandHash);
    if (prior) return this._result(current, current.projections.find(row => row.publicationId === packageValue.envelope.publicationId), current.receipts.find(row => row.receiptId === prior.receiptId), { recorded: true, reason: 'IDEMPOTENT' }, true);
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const existing = current.projections.find(row => row.publicationId === packageValue.envelope.publicationId);
    const projectionDigest = digest({ envelope: packageValue.envelope, manifest: packageValue.manifest });
    if (!existing || existing.projectionDigest !== projectionDigest || !['prepared', 'published'].includes(existing.status)) throw codedError('HUB_PREPARE_REQUIRED', 'publish 必须先有相同内容的 prepare');
    if (packageValue.envelope.visibility === 'withdrawn') throw codedError('HUB_INVALID', 'withdrawn publication 不能 publish');
    const projection = { ...existing, status: 'published', envelope: { ...existing.envelope, visibility: packageValue.envelope.visibility, publishedAt: nowIso(this.now) }, updatedAt: nowIso(this.now) };
    const receipt = this._receipt('publish', packageValue, commandHash, 'published', projection.status, current.revision + 1);
    projection.lastReceiptId = receipt.receiptId;
    const next = this.write({ projections: [...current.projections.filter(row => row.publicationId !== projection.publicationId), projection], receipts: [...current.receipts, receipt], commands: [...current.commands, { commandHash, action: 'publish', receiptId: receipt.receiptId, publicationId: projection.publicationId, outcome: 'published' }] }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    return this._result(next, projection, receipt, this._event('publication-publish', projection.publicationId, receipt.receiptId, 'approval'));
  }

  withdraw(input = {}) {
    const packageValue = this._validatePackage(input, 'withdraw');
    const current = this.read();
    const commandHash = this._commandHash('withdraw', packageValue.envelope, packageValue.manifest, packageValue.grant);
    const prior = current.commands.find(command => command.commandHash === commandHash);
    if (prior) return this._result(current, current.projections.find(row => row.publicationId === packageValue.envelope.publicationId), current.receipts.find(row => row.receiptId === prior.receiptId), { recorded: true, reason: 'IDEMPOTENT' }, true);
    this._assertExpectedRevision(current, input.expectedRevision == null ? current.revision : input.expectedRevision);
    const existing = current.projections.find(row => row.publicationId === packageValue.envelope.publicationId);
    const projectionDigest = digest({ envelope: packageValue.envelope, manifest: packageValue.manifest });
    if (!existing || existing.projectionDigest !== projectionDigest || existing.status !== 'published') throw codedError('HUB_WITHDRAW_INVALID', '只有已发布且内容一致的 publication 才能 withdraw');
    const projection = { ...existing, status: 'withdrawn', envelope: { ...existing.envelope, visibility: 'withdrawn', withdrawnAt: nowIso(this.now) }, updatedAt: nowIso(this.now) };
    const receipt = this._receipt('withdraw', packageValue, commandHash, 'withdrawn', projection.status, current.revision + 1);
    projection.lastReceiptId = receipt.receiptId;
    const next = this.write({ projections: [...current.projections.filter(row => row.publicationId !== projection.publicationId), projection], receipts: [...current.receipts, receipt], commands: [...current.commands, { commandHash, action: 'withdraw', receiptId: receipt.receiptId, publicationId: projection.publicationId, outcome: 'withdrawn' }] }, input.expectedRevision == null ? current.revision : input.expectedRevision);
    return this._result(next, projection, receipt, this._event('publication-withdraw', projection.publicationId, receipt.receiptId, 'success'));
  }

  sync(input = {}) {
    if (!isPlainObject(input)) throw codedError('HUB_INVALID', 'publication sync payload 必须是对象');
    assertKnownKeys(input, ['publicationId', 'grant'], 'publication sync payload');
    const publicationId = safeRef(input.publicationId, 'publicationId', ['publication:']);
    const grant = normalizeGrant(input.grant, this.now);
    if (grant.publicationId !== publicationId || grant.status !== 'active' || !grant.scope.includes(ACTION_SCOPES.sync)) throw codedError('HUB_SCOPE_DENIED', 'sync grant 不可用');
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) throw codedError('HUB_GRANT_EXPIRED', 'grant 已过期');
    const current = this.read();
    const projection = current.projections.find(row => row.publicationId === publicationId);
    if (!projection) throw codedError('HUB_NOT_FOUND', 'publication 不存在');
    return deepFreeze({ schema: HUB_SNAPSHOT_SCHEMA, workspaceId: current.workspaceId, hubIdentity: current.hubIdentity, revision: current.revision, projection: clonePlain(projection), receipt: null, event: { recorded: false, reason: 'READ_ONLY_SYNC' }, idempotent: false, localOnly: this.hubIdentity === 'fake-hub:local', networkCalls: 0, authorityGranted: false });
  }

  snapshot({ publicationId } = {}) {
    const current = this.read();
    const projections = publicationId ? [current.projections.find(row => row.publicationId === safeRef(publicationId, 'publicationId', ['publication:']))].filter(Boolean) : current.projections;
    return deepFreeze({ schema: HUB_SNAPSHOT_SCHEMA, workspaceId: current.workspaceId, hubIdentity: current.hubIdentity, revision: current.revision, projections: projections.map(row => clonePlain(row)), receipts: current.receipts.map(row => clonePlain(row)), localOnly: this.hubIdentity === 'fake-hub:local', networkCalls: 0, authorityGranted: false });
  }

  rebuild(options = {}) { return this.snapshot(options); }
}

module.exports = {
  WorldHubPublicationService, HUB_STORE_SCHEMA, PUBLIC_ENVELOPE_SCHEMA, PUBLIC_MANIFEST_SCHEMA,
  PUBLIC_GRANT_SCHEMA, PUBLIC_RECEIPT_SCHEMA, HUB_SNAPSHOT_SCHEMA,
  publicationDigest: digest,
  _forTests: { canonical, digest, normalizeManifest, normalizeEnvelope, normalizeGrant, rejectPrivate, expectedSignatureRef, unsignedEnvelope },
};
