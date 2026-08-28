import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BranchEffectiveStateService } = require('../../main/branch-effective-state-service.js');
const { WorldRuntimeService } = require('../../main/world-runtime-service.js');

function workspace(prefix) { return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); }

test('W94Ga World Store reuses Branch service for fork, review, partial Canon merge and restart', () => {
  const root = workspace('mazz-w94ga-world-');
  const events = [];
  try {
    const branchService = new BranchEffectiveStateService({ rootProvider: () => root, now: () => 0 });
    const service = new WorldRuntimeService({ rootProvider: () => root, branchService, eventService: { capture: input => { events.push(input); return { recorded: true }; } }, now: () => 0 });
    const created = service.create({ worldId: 'world:harbor', name: 'Harbor', description: 'local world', expectedRevision: 0 });
    assert.equal(created.revision, 1);
    assert.equal(created.branch.branchId, created.world.rootBranchId);
    const forked = service.fork({ worldId: 'world:harbor', sourceBranchId: created.world.rootBranchId, branchId: 'branch:harbor-community', forkPoint: 'canon:0', expectedRevision: 1 });
    assert.equal(forked.revision, 2);
    const proposed = service.propose({
      worldId: 'world:harbor', branchId: 'branch:harbor-community',
      changes: [{ domain: 'world', artifactRef: 'artifact:harbor-character', revision: 'rev:community-1', status: 'current' }],
      evidenceRefs: ['artifact:harbor-evidence'], proposedBy: 'human:author', expectedRevision: 2,
    });
    assert.equal(proposed.proposal.status, 'proposed');
    const reviewed = service.review({ proposalId: proposed.proposal.proposalId, action: 'accept', authorityRef: 'human:reviewer', reason: 'evidence checked', expectedRevision: 3 });
    assert.equal(reviewed.proposal.status, 'accepted');
    const merged = service.merge({ proposalId: proposed.proposal.proposalId, acceptedRevisions: ['rev:community-1'], authorityRef: 'human:owner', reason: 'partial canon adoption', expectedRevision: 4 });
    assert.equal(merged.merge.status, 'merged');
    assert.match(merged.world.canonVersion, /^canon:/);
    assert.equal(service.snapshot().effectiveStates.find(row => row.branchId === created.world.rootBranchId).facts[0].revision, 'rev:community-1');
    assert.equal(events.length, 5);
    assert.throws(() => service.create({ worldId: 'world:other', name: 'Other', expectedRevision: 0 }), /CAS/);
    assert.throws(() => service.propose({ worldId: 'world:harbor', branchId: 'branch:harbor-community', changes: [{ domain: 'world', artifactRef: 'artifact:x', revision: 'rev:x', status: 'current' }], evidenceRefs: ['C:\\private\\evidence'], proposedBy: 'human:x', expectedRevision: 5 }), /非法|路径|引用/);

    const restarted = new WorldRuntimeService({ rootProvider: () => root, branchService: new BranchEffectiveStateService({ rootProvider: () => root, now: () => 0 }), now: () => 0 });
    const restored = restarted.snapshot({ worldId: 'world:harbor' });
    assert.equal(restored.worlds.length, 1);
    assert.equal(restored.proposals[0].status, 'merged');
    assert.equal(restored.localOnly, true);
    assert.equal(JSON.stringify(restored).includes('C:\\'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('W94Ga World Store follows Workspace A/B identity and rejects private fields', () => {
  const first = workspace('mazz-w94ga-a-');
  const second = workspace('mazz-w94ga-b-');
  let current = first;
  try {
    const branchService = new BranchEffectiveStateService({ rootProvider: () => current, now: () => 0 });
    const service = new WorldRuntimeService({ rootProvider: () => current, branchService, now: () => 0 });
    service.create({ worldId: 'world:a', name: 'A', expectedRevision: 0 });
    current = second;
    assert.equal(service.snapshot().worlds.length, 0);
    current = first;
    assert.equal(service.snapshot().worlds.length, 1);
    assert.throws(() => service.create({ worldId: 'world:bad', name: 'Bad', apiKey: 'x', expectedRevision: 1 }), /未冻结|apiKey|私有/);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
