import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WorldHubPublicationService, _forTests } = require('../../main/world-hub-publication-service.js');

function workspace(prefix) { return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); }

function fixturePackage() {
  const createdAt = '2026-08-28T00:00:00.000Z';
  const manifestBody = {
    schema: 'mazz.public-content-manifest/v1', manifestId: 'manifest:harbor',
    blocks: [{ contentId: 'content:harbor-text', mediaType: 'text/plain', size: 42, contentHash: 'sha256:' + 'a'.repeat(64), encrypted: false }], createdAt,
  };
  const manifest = { ...manifestBody, contentRoot: `root:${_forTests.digest(manifestBody)}` };
  const grantInput = {
    schema: 'mazz.publication-grant/v1', grantId: 'grant:harbor-v1', publicationId: 'publication:harbor-v1', subjectId: 'creator:alice',
    scope: ['publication:prepare', 'publication:publish', 'publication:withdraw', 'publication:sync'], authorityRef: 'human:alice',
    sourceArtifactRefs: ['artifact:harbor-final'], rightsRef: 'license:cc-by', issuedAt: createdAt, status: 'active',
  };
  const envelopeBase = {
    schema: 'mazz.publication-envelope/v1', publicationId: 'publication:harbor-v1', workId: 'work:harbor', creatorId: 'creator:alice',
    editionType: 'text', version: 'v1', title: 'Harbor', summary: 'A public fixture', visibility: 'public', worldRef: 'world:harbor',
    contentManifestRef: 'manifest:harbor', contentIds: ['content:harbor-text'], licenseRef: 'license:cc-by', provenance: { producer: 'W94Gb-test' },
    publicationGrantRef: 'grant:harbor-v1', signatureRef: 'signature:placeholder', createdAt,
  };
  const envelope = _forTests.normalizeEnvelope(envelopeBase);
  const grant = _forTests.normalizeGrant(grantInput, createdAt);
  return { manifest, grant, envelope: { ...envelope, signatureRef: _forTests.expectedSignatureRef(envelope, grant) } };
}

test('W94Gb fake Hub requires grant/signature/manifest and replays publish→withdraw→sync', () => {
  const root = workspace('mazz-w94gb-hub-');
  const events = [];
  try {
    const fixture = fixturePackage();
    const service = new WorldHubPublicationService({ rootProvider: () => root, eventService: { capture: event => { events.push(event); return { recorded: true }; } }, now: () => Date.parse('2026-08-28T00:00:00.000Z') });
    const prepared = service.prepare({ ...fixture, expectedRevision: 0 });
    assert.equal(prepared.projection.status, 'prepared');
    assert.equal(prepared.localOnly, true);
    const repeatedPrepare = service.prepare(fixture);
    assert.equal(repeatedPrepare.idempotent, true);
    assert.equal(repeatedPrepare.receipt.receiptId, prepared.receipt.receiptId);
    const published = service.publish({ ...fixture, expectedRevision: 1 });
    assert.equal(published.projection.status, 'published');
    assert.equal(published.receipt.outcome, 'published');
    const synced = service.sync({ publicationId: fixture.envelope.publicationId, grant: fixture.grant });
    assert.equal(synced.projection.status, 'published');
    const withdrawn = service.withdraw({ ...fixture, expectedRevision: 2 });
    assert.equal(withdrawn.projection.status, 'withdrawn');
    assert.equal(withdrawn.projection.envelope.visibility, 'withdrawn');
    assert.equal(service.sync({ publicationId: fixture.envelope.publicationId, grant: fixture.grant }).projection.status, 'withdrawn');
    assert.equal(service.withdraw(fixture).idempotent, true);
    assert.equal(events.length, 3);
    const otherGrant = { ...fixture.grant, grantId: 'grant:other', publicationId: 'publication:other' };
    const otherEnvelope = _forTests.normalizeEnvelope({ ...fixture.envelope, publicationId: 'publication:other', publicationGrantRef: otherGrant.grantId, signatureRef: 'signature:placeholder' });
    const otherSigned = { ...otherEnvelope, signatureRef: _forTests.expectedSignatureRef(otherEnvelope, otherGrant) };
    assert.throws(() => service.prepare({ envelope: otherSigned, manifest: fixture.manifest, grant: otherGrant, expectedRevision: 0 }), /CAS/);
    assert.throws(() => service.prepare({ ...fixture, envelope: { ...fixture.envelope, summary: 'C:\\private\\draft' }, expectedRevision: 3 }), /路径|定位器|私有/);

    const restarted = new WorldHubPublicationService({ rootProvider: () => root, now: () => Date.parse('2026-08-28T00:00:00.000Z') });
    const restored = restarted.snapshot({ publicationId: fixture.envelope.publicationId });
    assert.equal(restored.projections[0].status, 'withdrawn');
    assert.equal(JSON.stringify(restored).includes('artifact:harbor-final'), false);
    assert.equal(JSON.stringify(restored).includes('C:\\private'), false);
    fs.writeFileSync(path.join(root, '.mazz', 'hub', 'fake-store.json'), '{broken', 'utf8');
    assert.throws(() => restarted.snapshot(), /损坏|JSON/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('W94Gb public projection is Workspace isolated and rejects revoked/expired/unsigned grants', () => {
  const first = workspace('mazz-w94gb-a-');
  const second = workspace('mazz-w94gb-b-');
  let current = first;
  try {
    const fixture = fixturePackage();
    const service = new WorldHubPublicationService({ rootProvider: () => current, now: () => Date.parse('2026-08-28T00:00:00.000Z') });
    service.prepare({ ...fixture, expectedRevision: 0 });
    current = second;
    assert.equal(service.snapshot().projections.length, 0);
    current = first;
    assert.equal(service.snapshot().projections.length, 1);
    const revoked = { ...fixture, grant: { ...fixture.grant, status: 'revoked' } };
    assert.throws(() => service.publish({ ...revoked, expectedRevision: 1 }), /不可用|grant/);
    const expired = { ...fixture, grant: { ...fixture.grant, expiresAt: '2020-01-01T00:00:00.000Z' } };
    assert.throws(() => service.publish({ ...expired, expectedRevision: 1 }), /过期|grant/);
    assert.throws(() => service.publish({ ...fixture, envelope: { ...fixture.envelope, signatureRef: 'signature:bad' }, expectedRevision: 1 }), /signature|签名/);
    assert.throws(() => service.sync({ publicationId: fixture.envelope.publicationId, grant: { ...fixture.grant, scope: ['publication:prepare'] } }), /scope|不可用/);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
