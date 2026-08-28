import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PlayerTransportSessionStore = require('../../main/player-transport-session-store.js');
const PlayerTransportW93Bridge = require('../../main/player-transport-w93-bridge.js');
const TorrentDaemon = require('../../main/torrent-daemon.js');

const INFO_HASH = '0123456789abcdef0123456789abcdef01234567';

function ws(prefix) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fakeSurface(calls) {
  return {
    async describeTorrentBridge(workspacePath, input) {
      calls.describe.push({ workspacePath, input });
      return {
        candidateId: input.candidateId,
        candidateFingerprint: input.candidateFingerprint,
        title: 'W94Fb Candidate',
        editionId: 'edition-1',
        offerId: input.offerId,
        infoHash: INFO_HASH,
        selectedFile: input.selectedFile,
        declaredSize: 123,
        rightsStatus: 'user-owned',
      };
    },
    async acquireTorrent(workspacePath, input) {
      calls.acquire.push({ workspacePath, input });
      return {
        decision: { outcome: 'pass', reasonCode: 'RIGHTS_PASS', receipt: { evidenceRef: 'evidence-1' } },
        job: {
          jobId: 'job-w94fb-1', state: 'queued',
          candidateId: input.candidateId, candidateFingerprint: input.candidateFingerprint,
          offerId: input.offerId, transport: 'magnet', revision: 1,
        },
      };
    },
  };
}

test('W94Fb bridge only links an existing W93 Candidate/Offer and preserves durable refs', async () => {
  const root = ws('mazz-w94fb-bridge-');
  const calls = { describe: [], acquire: [] };
  try {
    const store = new PlayerTransportSessionStore({ workspacePath: root });
    const bridge = new PlayerTransportW93Bridge({
      resourceSurface: fakeSurface(calls), sessionStore: store, workspacePath: root,
    });
    const result = await bridge.acquire({
      candidateId: 'candidate-1', candidateFingerprint: 'candidate-sha256-test',
      offerId: 'offer-1', selectedFile: 'books/one.txt',
      p2pConsent: true, rightsConfirmed: true,
    });
    assert.equal(calls.describe.length, 1);
    assert.equal(calls.acquire.length, 1);
    assert.match(result.transport.transportRef, /^transport:[a-f0-9]{64}$/);
    assert.match(result.transport.selectedFileRef, /^file:[a-f0-9]{64}$/);
    assert.deepEqual(result.session.sourceRefs, [
      'candidate:candidate-1', 'offer:offer-1', 'job:job-w94fb-1', 'rights:evidence-1',
    ]);
    assert.equal(result.session.workspaceId, store.workspaceId);
    assert.equal(store.list()[0].selectedFileRef, result.transport.selectedFileRef);
    await assert.rejects(() => bridge.acquire({
      candidateId: 'candidate-1', candidateFingerprint: 'candidate-sha256-test',
      offerId: 'offer-1', selectedFile: 'books/one.txt', magnet: 'magnet:?xt=urn:btih:bad',
      p2pConsent: true, rightsConfirmed: true,
    }), error => error.code === 'PLAYER_TRANSPORT_W93_BRIDGE_INVALID');
    await assert.rejects(() => bridge.acquire({
      candidateId: 'candidate-1', candidateFingerprint: 'candidate-sha256-test',
      offerId: 'offer-1', selectedFile: 'books/one.txt', p2pConsent: false, rightsConfirmed: true,
    }), error => error.code === 'PLAYER_TRANSPORT_W93_CONFIRMATION_REQUIRED');
    await assert.rejects(() => bridge.acquire({
      candidateId: 'candidate-1', candidateFingerprint: 'candidate-sha256-test',
      offerId: 'offer-1', selectedFile: 'books/one.txt', p2pConsent: true, rightsConfirmed: true,
    }), error => error.code === 'PLAYER_TRANSPORT_W93_BRIDGE_ALREADY_LINKED');
    assert.equal(calls.acquire.length, 1, 'duplicate bridge must not create a second W93 Job');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('W94Fb Workspace A/B switch rebinds the durable Player session root', async () => {
  const first = ws('mazz-w94fb-a-');
  const second = ws('mazz-w94fb-b-');
  const bus = { handlers: new Map(), handle(name, fn) { this.handlers.set(name, fn); }, invoke(name, input) { return this.handlers.get(name)(input); } };
  try {
    const daemon = new TorrentDaemon({ bus, workspace: () => first, session: null, loadWebTorrent: async () => ({ default: class {} }) });
    daemon.sessionStore.create({ infoHash: INFO_HASH, title: 'A', state: 'paused', files: [] });
    assert.equal((await bus.invoke('tor:sessions')).length, 1);
    await daemon.switchWorkspace(second);
    assert.equal((await bus.invoke('tor:sessions')).length, 0);
    await daemon.switchWorkspace(first);
    const restored = await bus.invoke('tor:sessions');
    assert.equal(restored.length, 1);
    assert.equal(restored[0].workspaceId, daemon.sessionStore.workspaceId);
    await daemon.destroy('w94fb-test');
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
