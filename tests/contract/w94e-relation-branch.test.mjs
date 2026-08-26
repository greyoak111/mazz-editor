import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const branch = require('../../main/foundation/branch-effective-state.js');
const { BranchEffectiveStateService } = require('../../main/branch-effective-state-service.js');
const { RelationRetrievalService } = require('../../main/relation-retrieval-service.js');
const events = require('../../main/foundation/workspace-events.js');
const context = require('../../main/foundation/context-relations.js');
const lanFacts = require('../../main/foundation/lan-state-facts.js');
const { capabilityDomain, captureDomainEvent } = require('../../main/foundation/domain-event-capture.js');
const { LibraryAcquisitionService } = require('../../main/library-acquisition-service.js');

function manifest(workspaceId, branchId, revision = 'rev:a', extra = {}) {
  return branch.normalizeManifest({ workspaceId, branchId, revisions: [{ domain: 'calc', artifactRef: 'artifact:sheet-1', revision, status: 'current' }], provenance: { source: 'test' }, ...extra });
}

test('W94E Branch Manifest is strict, identity-bound, and path/secret free', () => {
  const row = manifest('workspace:test', 'branch:base');
  assert.equal(row.schema, branch.BRANCH_MANIFEST_SCHEMA);
  assert.equal(row.revisions[0].schema, branch.BRANCH_REVISION_SCHEMA);
  assert.throws(() => branch.normalizeManifest({ ...row, apiKey: 'x' }), /apiKey|secret|未冻结/);
  assert.throws(() => branch.normalizeManifest({ ...row, contextRefs: ['C:\\private\\note'] }), /路径/);
  assert.throws(() => branch.normalizeManifest({ ...row, revisions: [{ ...row.revisions[0], domain: 'unknown' }] }), /非法/);
  assert.equal(branch.normalizeManifest({ workspaceId: 'workspace:test', revisions: [], provenance: { source: 'test' } }).branchId,
    branch.normalizeManifest({ workspaceId: 'workspace:test', revisions: [], provenance: { source: 'test' } }).branchId);
});

test('W94E reducer preserves linear supersession, concurrent parents, unknown, and domain isolation', () => {
  const ws = 'workspace:test';
  const parent = manifest(ws, 'branch:p', 'rev:a');
  const child = manifest(ws, 'branch:c', 'rev:b', { parentBranchIds: ['branch:p'], supersedes: ['rev:a'] });
  const linear = branch.computeEffectiveState({ manifest: child, parents: [parent] });
  assert.deepEqual(linear.facts.map(row => [row.key, row.revision]), [['calc:sheet-1', 'rev:b']]);
  assert.equal(linear.conflicts.length, 0);

  const left = manifest(ws, 'branch:left', 'rev:left');
  const right = manifest(ws, 'branch:right', 'rev:right');
  const merge = manifest(ws, 'branch:merge', '', { revisions: [], parentBranchIds: ['branch:left', 'branch:right'] });
  const conflict = branch.computeEffectiveState({ manifest: merge, parents: [left, right] });
  assert.equal(conflict.conflicts[0].key, 'calc:sheet-1');
  assert.deepEqual(conflict.conflicts[0].revisions, ['rev:left', 'rev:right']);
  assert.equal(conflict.resolutionRequired, true);
  const resolved = branch.computeEffectiveState({ manifest: merge, parents: [left, right], resolutions: [{ key: 'calc:sheet-1', resolvedRevision: 'rev:right', previousRevisions: ['rev:left', 'rev:right'], authorityRef: 'human:test', reason: '人工确认', sourceRefs: ['branch:merge'] }] });
  assert.deepEqual(resolved.facts.map(row => row.revision), ['rev:right']);
  assert.equal(resolved.conflicts.length, 0);

  const unknown = manifest(ws, 'branch:unknown', 'rev:pending', { revisions: [{ domain: 'canvas', artifactRef: 'artifact:doc', revision: 'rev:pending', status: 'pending' }] });
  assert.equal(branch.computeEffectiveState({ manifest: unknown }).unknown[0].key, 'canvas:doc');
  const domains = manifest(ws, 'branch:domains', '', { revisions: [
    { domain: 'calc', artifactRef: 'artifact:x', revision: 'rev:calc', status: 'current' },
    { domain: 'chart', artifactRef: 'artifact:x', revision: 'rev:chart', status: 'current' },
  ] });
  assert.deepEqual(branch.computeEffectiveState({ manifest: domains }).facts.map(row => row.key), ['calc:x', 'chart:x']);
});

test('W94E Branch Store persists CAS mutations and rebuilds effective state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94e-branch-'));
  try {
    const service = new BranchEffectiveStateService({ rootProvider: () => root, now: () => 0 });
    const base = service.create({ branchId: 'branch:base', revisions: [{ domain: 'calc', artifactRef: 'artifact:sheet', revision: 'rev:a', status: 'current' }], provenance: { source: 'test' } });
    assert.equal(base.revision, 1);
    const child = service.create({ branchId: 'branch:child', parentBranchIds: ['branch:base'], revisions: [], provenance: { source: 'test' }, expectedRevision: 1 });
    service.setRevision({ branchId: 'branch:child', revision: { domain: 'calc', artifactRef: 'artifact:sheet', revision: 'rev:b', status: 'current' }, expectedRevision: child.revision });
    assert.throws(() => service.create({ branchId: 'branch:other', expectedRevision: 1 }), /CAS/);
    const snapshot = service.rebuild();
    const effective = snapshot.effectiveStates.find(row => row.branchId === 'branch:child');
    assert.equal(effective.facts[0].revision, 'rev:b');
    assert.equal(snapshot.workspaceId.startsWith('workspace:'), true);
    assert.equal(fs.existsSync(path.join(root, '.mazz', 'branches', 'store.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('W94E Relation Retrieval is explainable, durable-negative, and workspace scoped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w94e-relation-'));
  try {
    const ws = `workspace:${require('node:crypto').createHash('sha256').update(path.resolve(root).toLocaleLowerCase('en-US')).digest('hex')}`;
    const event = events.normalizeWorkspaceEvent({ workspaceId: ws, idempotencyKey: 'test:1', occurredAt: '2026-08-26T00:00:00Z', actorType: 'human', sourceModule: 'calc', action: 'save', subjectRefs: ['artifact:sheet'], objectRefs: [], contextRefs: ['context:test'], outcome: 'success', provenance: { source: 'test' }, summary: 'operational save' });
    const eventService = { list: () => [event] };
    const contextService = { read: () => context.emptyGraph() };
    const service = new RelationRetrievalService({ rootProvider: () => root, eventService, contextService });
    const query = { schema: 'mazz.recollection-query/v0', queryId: 'query:test', semanticHints: ['save'], limit: 5 };
    const first = service.query({ query });
    assert.equal(first.schema, 'mazz.relation-retrieval/v1');
    assert.equal(first.workspaceId, ws);
    assert.equal(first.candidates.length, 1);
    assert.ok(first.explanations[0].reasons.some(reason => reason.startsWith('semantic:')));
    assert.ok(first.sourceRefs.includes(event.eventId));
    assert.throws(() => service.query({ workspaceId: 'workspace:other', query }), /identity/);
    assert.throws(() => service.rejectCandidate({ queryId: query.queryId, candidateRef: event.eventId, authorityRef: 'agent:no', reason: 'no' }), /human/);
    service.rejectCandidate({ queryId: query.queryId, candidateRef: event.eventId, authorityRef: 'human:test', reason: '人工拒绝' });
    const replay = service.query({ query });
    assert.equal(replay.candidates.length, 0);
    assert.equal(service.rebuild().rejectedCandidateCount, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('W94E LAN state facts stay separate from file frames and merge deterministically', () => {
  const ws = 'workspace:test';
  const a = lanFacts.createStateFact({ workspaceId: ws, factKind: 'branch', factId: 'branch:a', revision: 'rev:a', payloadRef: 'artifact:local-a' });
  assert.equal(a.type, 'state-fact');
  assert.throws(() => lanFacts.normalizeStateFact({ ...a, payloadRef: 'C:\\secret' }), /路径/);
  assert.throws(() => lanFacts.normalizeStateFact({ ...a, workspaceId: 'workspace:other' }, { workspaceId: ws }), /identity/);
  const duplicate = lanFacts.mergeStateFacts([a], [a], { workspaceId: ws });
  assert.equal(duplicate.duplicates.length, 1);
  const b = lanFacts.createStateFact({ ...a, revision: 'rev:b', payloadRef: 'artifact:local-b', signature: null });
  const conflict = lanFacts.mergeStateFacts([a], [b], { workspaceId: ws });
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.facts.length, 2);
  const replay = lanFacts.mergeStateFacts(conflict.facts, [...conflict.facts].reverse(), { workspaceId: ws });
  assert.equal(replay.duplicates.length, 2, '乱序重复重放应保持 duplicate，不升级为二次冲突');
  assert.equal(replay.conflicts.length, 0);
  const badSignature = lanFacts.mergeStateFacts([], [{ ...a, signature: 'sig:deadbeef' }], { workspaceId: ws });
  assert.equal(badSignature.rejected.length, 1, '非法签名必须拒绝');
});

test('W94E IPC/preload wiring exposes narrow relation, branch, and state-fact channels', () => {
  const main = fs.readFileSync(path.join(process.cwd(), 'main', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(process.cwd(), 'preload', 'bridge.js'), 'utf8');
  for (const channel of ['relation:query', 'relation:snapshot', 'relation:rejectCandidate', 'relation:rebuild', 'branch:create', 'branch:setRevision', 'branch:resolveConflict']) {
    assert.match(main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(preload, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(preload, /sync:stateFactPut/);
});

test('W94E domain event producer helper is metadata-only and stable across capability domains', () => {
  const captured = [];
  const eventService = { capture: input => { captured.push(input); return { recorded: true }; } };
  for (const [capabilityId, expected] of [
    ['mazz.calc.python-expression', 'calc'],
    ['mazz.chart.svg', 'chart'],
    ['mazz.blender.external', 'blender'],
    ['mazz.fixture.echo', 'factory'],
  ]) assert.equal(capabilityDomain(capabilityId), expected);
  const result = captureDomainEvent(eventService, {
    domain: 'calc', action: 'execute', outcome: 'success', subjectId: 'proposal:one', objectId: 'artifact:one',
  });
  assert.equal(result.recorded, true);
  assert.equal(captured.length, 1);
  assert.equal(JSON.stringify(captured[0]).includes('C:\\'), false);
  assert.equal(JSON.stringify(captured[0]).includes('apiKey'), false);
  assert.deepEqual(captured[0].subjectRefs, ['calc:proposal:one']);
  const approval = captureDomainEvent(eventService, {
    domain: 'calc', action: 'approve', outcome: 'approval', actorType: 'human', subjectId: 'proposal:one', objectId: 'artifact:one',
  });
  assert.equal(approval.recorded, true);
  assert.equal(captured[1].outcome, 'approval');
  const rejected = captureDomainEvent(eventService, { domain: 'calc', action: 'execute', subjectId: 'C:\\private' });
  assert.equal(rejected.recorded, false);
  assert.equal(rejected.reason, 'CAPTURE_FAILED');
});

test('W94E Library durable transport settlement records terminal outcome without payload data', () => {
  const captured = [];
  const service = new LibraryAcquisitionService({ eventService: { capture: input => { captured.push(input); return { recorded: true }; } } });
  const result = service._event({
    workspaceIdentity: 'workspace:test', jobId: 'job:one', candidateId: 'candidate:one', revision: 7,
  }, 'success');
  assert.equal(result.recorded, true);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].sourceModule, 'domain:library');
  assert.equal(captured[0].outcome, 'success');
  assert.equal(JSON.stringify(captured[0]).includes('payload'), false);
  assert.equal(JSON.stringify(captured[0]).includes('C:\\'), false);
});

test('W94E approval outcome is accepted by the durable Workspace Event contract', () => {
  const row = events.normalizeWorkspaceEvent({
    workspaceId: 'workspace:test', idempotencyKey: 'approval:test', occurredAt: '2026-08-26T00:00:00Z',
    actorType: 'human', sourceModule: 'canvas', action: 'export', subjectRefs: ['canvas:doc'],
    objectRefs: ['canvas:export'], contextRefs: ['domain:canvas'], outcome: 'approval',
    provenance: { producer: 'test' }, summary: 'human export approval', retentionClass: '1y',
  });
  assert.equal(row.outcome, 'approval');
});
