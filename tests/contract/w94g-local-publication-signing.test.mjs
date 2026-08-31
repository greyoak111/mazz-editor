import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PublicationSigningService } = require('../../main/publication-signing-service.js');
const { WorldHubPublicationService, _forTests } = require('../../main/world-hub-publication-service.js');

function workspace() { return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94g-signing-'))); }
function protector(mask = 0xa5) {
  const convert = bytes => Buffer.from(bytes).map(value => value ^ mask);
  return { protect: convert, unprotect: convert };
}
function fixture() {
  const createdAt = '2026-08-31T00:00:00.000Z';
  const manifestBody = {
    schema: 'mazz.public-content-manifest/v1', manifestId: 'manifest:local-signed',
    blocks: [{ contentId: 'content:local-signed', mediaType: 'text/plain', size: 17, contentHash: `sha256:${'c'.repeat(64)}`, encrypted: false }], createdAt,
  };
  const manifest = { ...manifestBody, contentRoot: `root:${_forTests.digest(manifestBody)}` };
  const grant = _forTests.normalizeGrant({
    schema: 'mazz.publication-grant/v1', grantId: 'grant:local-signed', publicationId: 'publication:local-signed', subjectId: 'creator:local',
    scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'], authorityRef: 'human:local-owner',
    sourceArtifactRefs: ['artifact:local-final'], rightsRef: 'license:user-owned', issuedAt: createdAt, status: 'active',
  }, createdAt);
  const envelope = {
    schema: 'mazz.publication-envelope/v1', publicationId: 'publication:local-signed', workId: 'work:local-signed', creatorId: 'creator:local',
    editionType: 'text', version: 'v1', title: 'Local Signed', summary: 'Explicit local publication fixture', visibility: 'public',
    contentManifestRef: manifest.manifestId, contentIds: manifest.blocks.map(row => row.contentId), licenseRef: grant.rightsRef,
    provenance: { producer: 'W94G-local-signing-contract' }, publicationGrantRef: grant.grantId, signatureRef: 'signature:pending', createdAt,
  };
  return { envelope, manifest, grant };
}

test('W94G local Ed25519 identity stays protected at rest and signs a strict fake-Hub lifecycle', () => {
  const root = workspace();
  try {
    const protection = protector();
    const signer = new PublicationSigningService({ rootProvider: () => root, ...protection, now: () => 0 });
    const identity = signer.ensureIdentity();
    assert.equal(identity.protectedAtRest, true);
    assert.equal(identity.privateKeyExposed, false);
    const stored = fs.readFileSync(path.join(root, '.mazz', 'identity', 'publication-signing.json'), 'utf8');
    assert.doesNotMatch(stored, /PRIVATE KEY|BEGIN PRIVATE|pkcs8/i);

    const input = fixture();
    const signed = signer.signPublication({ envelope: input.envelope, grant: input.grant });
    assert.match(signed.envelope.signatureRef, /^signature:ed25519:[0-9a-f]{64}$/);
    assert.equal(signer.verifyPublication({ envelope: signed.envelope, grant: input.grant, signature: signed.signature }).valid, true);

    const hub = new WorldHubPublicationService({ rootProvider: () => root, signatureVerifier: signer, allowDigestReference: false, now: () => 0 });
    const packageValue = { envelope: signed.envelope, manifest: input.manifest, grant: input.grant, signature: signed.signature };
    const prepared = hub.prepare({ ...packageValue, expectedRevision: 0 });
    assert.equal(prepared.projection.signatureVerified, true);
    assert.equal(prepared.projection.signatureKeyId, identity.keyId);
    assert.equal(hub.publish({ ...packageValue, expectedRevision: 1 }).projection.status, 'published');
    assert.equal(hub.withdraw({ ...packageValue, expectedRevision: 2 }).projection.status, 'withdrawn');

    const restartedSigner = new PublicationSigningService({ rootProvider: () => root, ...protection, now: () => 0 });
    assert.equal(restartedSigner.ensureIdentity().keyId, identity.keyId);
    const tampered = { ...signed.envelope, summary: 'tampered' };
    assert.equal(restartedSigner.verifyPublication({ envelope: tampered, grant: input.grant, signature: signed.signature }).valid, false);
    assert.throws(() => hub.prepare({ ...packageValue, envelope: tampered, expectedRevision: 3 }), /签名校验失败/);

    const legacy = fixture();
    legacy.envelope.signatureRef = _forTests.expectedSignatureRef(legacy.envelope, legacy.grant);
    assert.throws(() => hub.prepare({ ...legacy, expectedRevision: 3 }), /signatureRef|签名/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('W94G desktop exposes signing and proposal withdrawal through existing narrow IPC surfaces', () => {
  const main = fs.readFileSync(path.resolve('main/main.js'), 'utf8');
  const preload = fs.readFileSync(path.resolve('preload/bridge.js'), 'utf8');
  assert.match(main, /hub:signPublication/);
  assert.match(main, /world:withdrawProposal/);
  assert.match(preload, /hub:signPublication/);
  assert.match(preload, /world:withdrawProposal/);
  assert.doesNotMatch(preload, /privateKey|protectedPrivateKey/);
});
