'use strict';

// W94G desktop bridge: a durable Capability Artifact can be explicitly
// granted, signed and projected into the local fake Hub without exposing its
// storage path, private signing key or bytes to the renderer/public plane.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { CapabilityArtifactStore } = require('./capability-artifact-store');
const { publicationDigest } = require('./world-hub-publication-service');
const { workspaceId } = require('./workspace-event-service');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString, requiredString,
} = require('./foundation/plain-value');

const STORE_SCHEMA = 'mazz.local-publication-bridge-store/v1';
const SNAPSHOT_SCHEMA = 'mazz.local-publication-bridge-snapshot/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function codedError(code, message) { return Object.assign(new Error(message), { code }); }
function safeId(value, label, prefix = '') {
  const text = requiredString(value, label);
  if (!ID.test(text) || (prefix && !text.startsWith(prefix))) throw codedError('LOCAL_PUBLICATION_INVALID', `${label} 非法`);
  return text;
}
function nowIso(value) {
  const date = new Date(typeof value === 'function' ? value() : value || Date.now());
  if (!Number.isFinite(date.getTime())) throw codedError('LOCAL_PUBLICATION_INVALID', 'Publication 时间非法');
  return date.toISOString();
}
function hash(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function contentHex(artifact) {
  const match = /^sha256-([a-f0-9]{64})$/.exec(String(artifact?.contentHash || ''));
  if (!match) throw codedError('LOCAL_PUBLICATION_ARTIFACT_INVALID', 'Capability Artifact contentHash 非法');
  return match[1];
}
function atomicWrite(filePath, value, fsImpl) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fsImpl.openSync(temporary, 'wx');
    fsImpl.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd); fd = undefined;
    fsImpl.renameSync(temporary, filePath);
  } catch (error) {
    if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch {} }
    try { if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary); } catch {}
    throw error;
  }
}

class LocalPublicationBridgeService {
  constructor({ rootProvider, capabilityService, signingService, hubService, fsImpl = fs, now = () => Date.now() } = {}) {
    if (typeof rootProvider !== 'function' || !capabilityService || !signingService || !hubService) {
      throw new TypeError('LocalPublicationBridgeService 需要 rootProvider/capabilityService/signingService/hubService');
    }
    this.rootProvider = rootProvider;
    this.capabilityService = capabilityService;
    this.signingService = signingService;
    this.hubService = hubService;
    this.fs = fsImpl;
    this.now = now;
  }

  root() { return path.resolve(requiredString(this.rootProvider(), 'workspacePath')); }
  file() { return path.join(this.root(), '.mazz', 'publication-drafts', 'store.json'); }
  workspaceId() { return workspaceId(this.root()); }
  empty() { return { schema: STORE_SCHEMA, workspaceId: this.workspaceId(), revision: 0, drafts: [] }; }

  read() {
    if (!this.fs.existsSync(this.file())) return this.empty();
    let value;
    try { value = JSON.parse(this.fs.readFileSync(this.file(), 'utf8')); }
    catch (error) { throw codedError('LOCAL_PUBLICATION_STORE_CORRUPT', `本地 Publication draft 损坏；原文件保留: ${error.message}`); }
    if (!isPlainObject(value) || value.schema !== STORE_SCHEMA || value.workspaceId !== this.workspaceId()
        || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.drafts)) {
      throw codedError('LOCAL_PUBLICATION_STORE_CORRUPT', '本地 Publication draft schema/workspace/revision 非法');
    }
    return value;
  }

  write(drafts, expectedRevision) {
    const current = this.read();
    if (current.revision !== expectedRevision) throw codedError('LOCAL_PUBLICATION_CAS_MISMATCH', `Publication draft CAS 冲突：期望 ${expectedRevision}，当前 ${current.revision}`);
    const next = { schema: STORE_SCHEMA, workspaceId: this.workspaceId(), revision: current.revision + 1, drafts: clonePlain(drafts) };
    atomicWrite(this.file(), next, this.fs);
    return next;
  }

  artifacts() {
    const snapshot = this.capabilityService.workspaceSnapshot(this.root());
    return snapshot.artifacts.map(row => ({
      artifactId: row.artifactId, kind: row.kind, mediaType: row.mediaType, contentSchema: row.contentSchema,
      contentHash: row.contentHash, definitionHash: row.definitionHash, rightsRef: row.rightsRef,
      mutableHead: row.mutableHead, createdAt: row.createdAt,
    }));
  }

  publicDraft(draft) {
    return {
      publicationId: draft.package.envelope.publicationId,
      artifactId: draft.artifactId,
      title: draft.package.envelope.title,
      version: draft.package.envelope.version,
      visibility: draft.package.envelope.visibility,
      status: draft.status,
      signatureRef: draft.package.envelope.signatureRef,
      keyId: draft.package.signature.keyId,
      preparedAt: draft.preparedAt,
      updatedAt: draft.updatedAt,
    };
  }

  snapshot() {
    const store = this.read();
    return deepFreeze({
      schema: SNAPSHOT_SCHEMA, workspaceId: store.workspaceId, revision: store.revision,
      artifacts: this.artifacts(), drafts: store.drafts.map(row => this.publicDraft(row)),
      hub: this.hubService.snapshot(), localOnly: true, networkCalls: 0, privateKeyExposed: false,
      publicEffectAuthorized: false,
    });
  }

  async artifactSize(artifact) {
    const store = new CapabilityArtifactStore({ workspacePath: this.root(), fsApi: this.fs });
    const opened = await store.open(artifact.storageRef, { expectedHash: artifact.contentHash });
    const closed = once(opened.stream, 'close').catch(() => []);
    opened.stream.destroy();
    await closed;
    return opened.size;
  }

  async prepare(input = {}) {
    if (!isPlainObject(input)) throw codedError('LOCAL_PUBLICATION_INVALID', 'Publication prepare payload 必须是对象');
    assertKnownKeys(input, [
      'artifactId', 'publicationId', 'workId', 'creatorId', 'editionType', 'version', 'title', 'summary',
      'visibility', 'worldRef', 'licenseRef', 'authorityRef',
    ], 'Publication prepare payload');
    const capability = this.capabilityService.workspaceSnapshot(this.root());
    const artifactId = requiredString(input.artifactId, 'artifactId');
    const artifact = capability.artifacts.find(row => row.artifactId === artifactId);
    if (!artifact) throw codedError('LOCAL_PUBLICATION_ARTIFACT_NOT_FOUND', 'Capability Artifact 不存在于当前 Workspace');
    if (artifact.mutableHead) throw codedError('LOCAL_PUBLICATION_MUTABLE_ARTIFACT', '可变 Artifact head 不可直接发布；请先固化不可变产物');
    const hex = contentHex(artifact);
    const publicationId = safeId(input.publicationId || `publication:${hex}`, 'publicationId', 'publication:');
    const current = this.read();
    const existing = current.drafts.find(row => row.package?.envelope?.publicationId === publicationId);
    if (existing) {
      if (existing.artifactId !== artifactId) throw codedError('LOCAL_PUBLICATION_CONFLICT', 'publicationId 已绑定另一 Artifact');
      return deepFreeze({ draft: this.publicDraft(existing), projection: this.hubService.snapshot({ publicationId }).projections[0] || null, idempotent: true, authorityGranted: false });
    }
    const createdAt = nowIso(this.now);
    const mediaType = requiredString(artifact.mediaType, 'artifact.mediaType');
    const size = await this.artifactSize(artifact);
    const contentId = `content:sha256:${hex}`;
    const manifestId = `manifest:${hex}`;
    const manifestBody = {
      schema: 'mazz.public-content-manifest/v1', manifestId,
      blocks: [{ contentId, mediaType, size, contentHash: `sha256:${hex}`, encrypted: false }], createdAt,
    };
    const manifest = { ...manifestBody, contentRoot: `root:${publicationDigest(manifestBody)}` };
    const creatorId = safeId(input.creatorId || 'creator:local-owner', 'creatorId', 'creator:');
    const authorityRef = safeId(input.authorityRef || 'human:local-owner', 'authorityRef', 'human:');
    const licenseRef = safeId(input.licenseRef || artifact.rightsRef || 'license:user-owned', 'licenseRef');
    if (!licenseRef.startsWith('license:') && !licenseRef.startsWith('rights:')) throw codedError('LOCAL_PUBLICATION_INVALID', 'licenseRef 必须是 license:/rights: 引用');
    const grantId = `grant:${hash(`${publicationId}\u0000${artifactId}\u0000${authorityRef}`)}`;
    const grant = {
      schema: 'mazz.publication-grant/v1', grantId, publicationId, subjectId: creatorId,
      scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'],
      authorityRef, sourceArtifactRefs: [`artifact:sha256:${hex}`], rightsRef: licenseRef, issuedAt: createdAt, status: 'active',
    };
    const envelope = {
      schema: 'mazz.publication-envelope/v1', publicationId,
      workId: safeId(input.workId || `work:${hex}`, 'workId', 'work:'), creatorId,
      editionType: safeId(input.editionType || artifact.kind || 'artifact', 'editionType'),
      version: safeId(input.version || 'v1', 'version'), title: requiredString(input.title, 'title'),
      summary: requiredString(input.summary, 'summary'), visibility: input.visibility || 'unlisted',
      ...(optionalString(input.worldRef) ? { worldRef: safeId(input.worldRef, 'worldRef', 'world:') } : {}),
      contentManifestRef: manifestId, contentIds: [contentId], licenseRef,
      provenance: { producer: 'mazz-local-publication-bridge', contentSchema: artifact.contentSchema },
      publicationGrantRef: grantId, signatureRef: 'signature:pending', createdAt,
    };
    const signed = this.signingService.signPublication({ envelope, grant });
    const packageValue = { envelope: signed.envelope, manifest, grant, signature: signed.signature };
    const hubRevision = this.hubService.snapshot().revision;
    const prepared = this.hubService.prepare({ ...packageValue, expectedRevision: hubRevision });
    const at = nowIso(this.now);
    const draft = { artifactId, package: packageValue, status: 'prepared', preparedAt: at, updatedAt: at };
    this.write([...current.drafts, draft], current.revision);
    return deepFreeze({ draft: this.publicDraft(draft), projection: prepared.projection, receipt: prepared.receipt, idempotent: false, authorityGranted: false, privateKeyExposed: false });
  }

  transition(input, action) {
    if (!isPlainObject(input)) throw codedError('LOCAL_PUBLICATION_INVALID', `Publication ${action} payload 必须是对象`);
    assertKnownKeys(input, ['publicationId'], `Publication ${action} payload`);
    const publicationId = safeId(input.publicationId, 'publicationId', 'publication:');
    const current = this.read();
    const index = current.drafts.findIndex(row => row.package?.envelope?.publicationId === publicationId);
    if (index < 0) throw codedError('LOCAL_PUBLICATION_DRAFT_NOT_FOUND', 'Publication draft 不存在于当前 Workspace');
    const draft = current.drafts[index];
    const hubRevision = this.hubService.snapshot().revision;
    const result = this.hubService[action]({ ...draft.package, expectedRevision: hubRevision });
    const nextDraft = { ...draft, status: result.projection.status, updatedAt: nowIso(this.now) };
    const drafts = current.drafts.slice(); drafts[index] = nextDraft;
    this.write(drafts, current.revision);
    return deepFreeze({ draft: this.publicDraft(nextDraft), projection: result.projection, receipt: result.receipt, authorityGranted: false, privateKeyExposed: false });
  }

  publish(input = {}) { return this.transition(input, 'publish'); }
  withdraw(input = {}) { return this.transition(input, 'withdraw'); }
}

module.exports = { LocalPublicationBridgeService, STORE_SCHEMA, SNAPSHOT_SCHEMA };
