import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CapabilityArtifactStore } = require('../../main/capability-artifact-store.js');
const { PublicationSigningService } = require('../../main/publication-signing-service.js');
const { WorldHubPublicationService } = require('../../main/world-hub-publication-service.js');
const { LocalPublicationBridgeService } = require('../../main/local-publication-bridge-service.js');

function services(root, artifact) {
  const protect = bytes => Buffer.from(bytes).map(byte => byte ^ 0xa5);
  const signing = new PublicationSigningService({ rootProvider: () => root, protect, unprotect: protect, now: () => '2026-08-31T08:00:00.000Z' });
  const hub = new WorldHubPublicationService({ rootProvider: () => root, signatureVerifier: signing, allowDigestReference: false, now: () => '2026-08-31T08:00:00.000Z' });
  const capability = { workspaceSnapshot: selected => {
    assert.equal(path.resolve(selected), path.resolve(root));
    return { schema: 'mazz.capability-workspace-snapshot/v1', artifacts: [artifact] };
  } };
  return { signing, hub, bridge: new LocalPublicationBridgeService({ rootProvider: () => root, capabilityService: capability, signingService: signing, hubService: hub, now: () => '2026-08-31T08:00:00.000Z' }) };
}

test('W94G local bridge carries immutable Artifact through Grant, Ed25519 and fake Hub without leaking private plane', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94g-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactStore = new CapabilityArtifactStore({ workspacePath: root });
  const publishedArtifact = await artifactStore.publishBytes(Buffer.from('immutable W94G artifact', 'utf8'));
  const artifact = {
    artifactId: `artifact-${publishedArtifact.contentHash}`, kind: 'document', mediaType: 'text/plain',
    contentSchema: 'mazz.document/v1', contentHash: publishedArtifact.contentHash, definitionHash: '',
    storageRef: publishedArtifact.storageRef, rightsRef: '', mutableHead: false,
    createdAt: '2026-08-31T08:00:00.000Z',
  };
  const first = services(root, artifact);
  const prepared = await first.bridge.prepare({
    artifactId: artifact.artifactId, title: 'W94G local artifact', summary: 'Explicitly granted local publication',
    authorityRef: 'human:maintainer', creatorId: 'creator:maintainer', licenseRef: 'license:user-owned', visibility: 'unlisted',
  });
  assert.equal(prepared.projection.status, 'prepared');
  assert.equal(prepared.projection.signatureVerified, true);
  assert.equal(prepared.privateKeyExposed, false);

  const snapshot = first.bridge.snapshot();
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.drafts[0].status, 'prepared');
  assert.equal(snapshot.publicEffectAuthorized, false);
  const safeJson = JSON.stringify(snapshot);
  assert.doesNotMatch(safeJson, /capability-blob:|sourceArtifactRefs|protectedPrivateKey|"signature"\s*:/);
  assert.doesNotMatch(safeJson, /[A-Z]:\\|https?:\/\//i);

  const publicationId = snapshot.drafts[0].publicationId;
  assert.equal(first.bridge.publish({ publicationId }).projection.status, 'published');
  assert.equal(first.bridge.withdraw({ publicationId }).projection.status, 'withdrawn');

  const restarted = services(root, artifact).bridge.snapshot();
  assert.equal(restarted.drafts[0].status, 'withdrawn');
  assert.equal(restarted.hub.projections[0].status, 'withdrawn');
  assert.equal(restarted.networkCalls, 0);
});

test('W94G product bridge IPC is explicit and renderer module is registered', () => {
  const preload = fs.readFileSync(path.resolve('preload/bridge.js'), 'utf8');
  const main = fs.readFileSync(path.resolve('main/main.js'), 'utf8');
  const app = fs.readFileSync(path.resolve('renderer/app.js'), 'utf8');
  for (const channel of ['publicationBridge:snapshot', 'publicationBridge:prepare', 'publicationBridge:publish', 'publicationBridge:withdraw']) {
    assert.match(preload, new RegExp(channel.replace(':', '\\:')));
    assert.match(main, new RegExp(channel.replace(':', '\\:')));
  }
  assert.match(app, /modules\.register\('world'/);
});
