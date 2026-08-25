import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contract = require('../../main/library-resource-contract');
const source = require('../../main/library-source-registry');
const rightsPolicy = require('../../main/library-rights-policy');
const LibraryAcquisitionStore = require('../../main/library-acquisition-store');

const NOW = '2026-08-25T08:00:00.000Z';
const JOB_AT = '2026-08-25T09:00:00.000Z';
const POLICY_AT = '2026-08-01T00:00:00.000Z';
const EVIDENCE_AT = '2026-08-20T00:00:00.000Z';

function descriptor(overrides = {}) {
  const policy = {
    policyVersion: 'policy-2026-08',
    checkedAt: POLICY_AT,
    jurisdictions: ['US', 'worldwide'],
    rightsModes: ['public-domain', 'open-license', 'user-owned'],
    termsUrl: 'https://example.org/terms',
    rightsUrl: 'https://example.org/rights',
    ...(overrides.policy || {}),
  };
  return {
    schema: source.DESCRIPTOR_SCHEMA,
    providerId: 'fixture-source',
    displayName: 'Fixture Source',
    adapterVersion: 'fixture-v1',
    capabilities: ['search', 'discover', 'resolve', 'health'],
    ...overrides,
    policy,
  };
}

function rights(status = 'public-domain', overrides = {}) {
  const byStatus = {
    'public-domain': {
      status,
      licenseId: 'PD-US',
      rightsStatement: 'Source states this edition is public domain in the selected jurisdiction.',
      jurisdiction: 'US',
      evidenceUrl: 'https://example.org/rights/public-domain',
      assertedBy: 'fixture-source',
      checkedAt: EVIDENCE_AT,
      confidence: 1,
    },
    'open-license': {
      status,
      licenseId: 'CC-BY-4.0',
      rightsStatement: 'Source states this edition is under CC BY 4.0.',
      jurisdiction: 'worldwide',
      evidenceUrl: 'https://example.org/rights/open-license',
      assertedBy: 'fixture-source',
      checkedAt: EVIDENCE_AT,
      confidence: 1,
    },
    'user-owned': {
      status,
      licenseId: '',
      rightsStatement: 'User-owned copy awaiting explicit user confirmation.',
      jurisdiction: 'US',
      evidenceUrl: '',
      assertedBy: 'user',
      checkedAt: EVIDENCE_AT,
      confidence: 1,
    },
    unknown: {
      status,
      licenseId: '',
      rightsStatement: '',
      jurisdiction: '',
      evidenceUrl: '',
      assertedBy: '',
      checkedAt: '',
      confidence: null,
    },
    restricted: {
      status,
      licenseId: '',
      rightsStatement: 'Source marks this item restricted.',
      jurisdiction: 'US',
      evidenceUrl: '',
      assertedBy: 'fixture-source',
      checkedAt: EVIDENCE_AT,
      confidence: 1,
    },
  };
  return { ...byStatus[status], ...overrides };
}

function candidate(resourceId = 'book-1', options = {}) {
  const providerId = options.providerId || 'fixture-source';
  const adapterVersion = options.adapterVersion || 'fixture-v1';
  const workIdentifiers = { ia: [`${resourceId}-work`] };
  const editionIdentifiers = { ia: [`${resourceId}-edition`] };
  const editionId = contract.deriveEditionId({ identifiers: editionIdentifiers });
  const offerBase = {
    editionId,
    providerId,
    resourceId,
    format: 'epub',
    transport: 'https',
    size: null,
    checksum: '',
    infoHash: '',
    sourceUrl: `https://example.org/books/${resourceId}.epub`,
    acquisitionRef: '',
    selectableFiles: [],
    ...(options.offer || {}),
  };
  const offer = { ...offerBase, offerId: contract.deriveOfferId(offerBase) };
  return {
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: options.candidateId || `candidate-${resourceId}`,
    work: {
      workId: contract.deriveWorkId({ identifiers: workIdentifiers }),
      title: options.title || `Fixture Book ${resourceId}`,
      authors: ['Fixture Author'],
      languages: ['en'],
      subjects: ['fixture'],
      identifiers: workIdentifiers,
    },
    editions: [{
      editionId,
      title: options.title || `Fixture Book ${resourceId}`,
      language: 'en',
      publisher: 'Fixture Press',
      publishedAt: '1900',
      identifiers: editionIdentifiers,
      description: 'Offline fixture candidate.',
    }],
    offers: [offer],
    rights: options.rights || rights('public-domain'),
    provenance: [{
      providerId,
      resourceId,
      pageUrl: `https://example.org/catalog/${resourceId}`,
      observedAt: EVIDENCE_AT,
      adapterVersion,
    }],
  };
}

function page(candidates, nextCursor = null, overrides = {}) {
  return {
    schema: source.PAGE_SCHEMA,
    providerId: 'fixture-source',
    adapterVersion: 'fixture-v1',
    policyVersion: 'policy-2026-08',
    candidates,
    nextCursor,
    ...overrides,
  };
}

function makeAdapter(options = {}) {
  return new source.FixtureLibrarySourceAdapter({
    descriptor: descriptor(options.descriptor || {}),
    searchPages: options.searchPages || [page([candidate('search-1')])],
    discoverPages: options.discoverPages || [page([candidate('discover-1')])],
    resolved: options.resolved || { 'resolved-1': candidate('resolved-1') },
    now: NOW,
  });
}

function evaluate(candidateInput, options = {}) {
  return rightsPolicy.evaluateRights({
    candidate: candidateInput,
    descriptor: options.descriptor || descriptor(),
    jurisdiction: options.jurisdiction || candidateInput.rights.jurisdiction || 'US',
    userAssertion: options.userAssertion,
    now: options.now || NOW,
  });
}

async function withWorkspace(fn) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'mazz-w93c-'));
  const workspace = fs.realpathSync.native(created);
  try {
    return await fn(workspace);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test('descriptor is strict, versioned and rejects secret/private/future policy coordinates', () => {
  const normalized = source.normalizeDescriptor(descriptor(), { now: NOW });
  assert.equal(normalized.providerId, 'fixture-source');
  assert.deepEqual(normalized.capabilities, ['discover', 'health', 'resolve', 'search']);
  assert.deepEqual(normalized.policy.rightsModes, ['open-license', 'public-domain', 'user-owned']);

  for (const bad of [
    descriptor({ providerId: ' fixture-source ' }),
    descriptor({ adapterVersion: { version: 1 } }),
    descriptor({ capabilities: ['search', 'search'] }),
    descriptor({ policy: { termsUrl: 'https://127.0.0.1/terms' } }),
    descriptor({ policy: { rightsUrl: 'https://example.org/a?token=secret-value' } }),
    descriptor({ policy: { checkedAt: '2026-09-01T00:00:00.000Z' } }),
    { ...descriptor(), unknown: true },
  ]) assert.throws(() => source.normalizeDescriptor(bad, { now: NOW }), /policy|字段|opaque|重复|HTTPS|secret|字符串|空白/i);
});

test('registry registration is deterministic and provider replacement is explicit', () => {
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  const adapter = makeAdapter();
  assert.equal(registry.register(adapter).providerId, 'fixture-source');
  assert.equal(registry.register(adapter).providerId, 'fixture-source');
  assert.throws(() => registry.register(makeAdapter()), /已被另一/);
  assert.equal(registry.unregister('fixture-source'), true);
  assert.equal(registry.register(makeAdapter()).providerId, 'fixture-source');
  assert.equal(registry.snapshot().registeredCount, 1);
});

test('search, discover, resolve and health all cross the same frozen descriptor boundary', async () => {
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  const adapter = makeAdapter();
  registry.register(adapter);
  const searched = await registry.search('fixture-source', { query: 'fixture' });
  const discovered = await registry.discover('fixture-source');
  const resolved = await registry.resolve('fixture-source', { resourceId: 'resolved-1' });
  const health = await registry.health('fixture-source');
  assert.equal(searched.candidates.length, 1);
  assert.equal(discovered.candidates.length, 1);
  assert.equal(resolved.candidateId, 'candidate-resolved-1');
  assert.equal(health.status, 'ready');
  assert.deepEqual(adapter.snapshot(), { search: 1, discover: 1, resolve: 1, health: 1, network: 0 });
});

test('candidate provider, adapter and page policy drift fail closed', async () => {
  for (const malformed of [
    page([candidate('wrong-provider', { providerId: 'other-source' })]),
    page([candidate('wrong-version', { adapterVersion: 'fixture-v2' })]),
    page([candidate('page')], null, { policyVersion: 'policy-drift' }),
  ]) {
    const registry = new source.LibrarySourceRegistry({ now: NOW });
    registry.register(makeAdapter({ searchPages: [malformed] }));
    await assert.rejects(registry.search('fixture-source', { query: 'x' }), /Provider|provenance|snapshot|descriptor|冻结|不一致|不属于/i);
  }

  let changed = false;
  const mutable = {
    descriptor: () => descriptor({
      adapterVersion: changed ? 'fixture-v2' : 'fixture-v1',
      capabilities: ['search'],
    }),
    search: async () => {
      changed = true;
      return page([candidate('drift')]);
    },
  };
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  registry.register(mutable);
  await assert.rejects(registry.search('fixture-source', { query: 'x' }), /发生变化|snapshot/i);
});

test('same candidate identity is idempotent but conflicting content is rejected in and across pages', async () => {
  const stable = candidate('same');
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  registry.register(makeAdapter({ searchPages: [page([stable, stable])] }));
  assert.equal((await registry.search('fixture-source', { query: 'same' })).candidates.length, 1);

  const conflicting = candidate('same', { title: 'Changed title', candidateId: stable.candidateId });
  const localConflict = new source.LibrarySourceRegistry({ now: NOW });
  localConflict.register(makeAdapter({ searchPages: [page([stable, conflicting])] }));
  await assert.rejects(localConflict.search('fixture-source', { query: 'same' }), /冲突|不同内容/);

  const across = new source.LibrarySourceRegistry({ now: NOW });
  across.register(makeAdapter({ searchPages: [page([stable], 'next'), page([conflicting], null)] }));
  await assert.rejects(across.collect('fixture-source', 'search', { query: 'same' }), /冲突|不同内容/);
});

test('catalog collection has no fixed page or candidate limit and stops only at natural cursor end', async () => {
  const pages = [];
  for (let index = 0; index < 333; index += 1) {
    pages.push(page([candidate(`catalog-${index}`)], index === 332 ? null : `cursor-${index + 1}`));
  }
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  const adapter = makeAdapter({ discoverPages: pages });
  registry.register(adapter);
  const collected = await registry.collect('fixture-source', 'discover');
  assert.equal(collected.length, 333);
  assert.equal(adapter.snapshot().discover, 333);

  const repeated = new source.LibrarySourceRegistry({ now: NOW });
  const repeatedAdapter = makeAdapter({ discoverPages: [
    page([candidate('repeat-1')], 'same-cursor'),
    page([candidate('repeat-2')], 'same-cursor'),
  ] });
  repeated.register(repeatedAdapter);
  assert.equal((await repeated.collect('fixture-source', 'discover')).length, 2);
  assert.equal(repeatedAdapter.snapshot().discover, 2);
});

test('abort, adapter failure and close settle without background owners or leaked response text', async () => {
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  const adapter = makeAdapter();
  registry.register(adapter);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(registry.search('fixture-source', { query: 'x', signal: controller.signal }), /取消/);
  assert.equal(adapter.snapshot().search, 0);

  const failing = {
    descriptor: () => descriptor({ capabilities: ['search'] }),
    search: async () => {
      const error = new Error('response body token=must-not-enter-health');
      error.code = 'REMOTE_FAILURE';
      throw error;
    },
  };
  const failedRegistry = new source.LibrarySourceRegistry({ now: NOW });
  failedRegistry.register(failing);
  await assert.rejects(failedRegistry.search('fixture-source', { query: 'x' }), /must-not-enter-health/);
  const fact = failedRegistry.lastHealth('fixture-source');
  assert.equal(fact.code, 'REMOTE_FAILURE');
  assert.doesNotMatch(JSON.stringify(fact), /token|response body|must-not/i);
  const closed = failedRegistry.close();
  assert.deepEqual(closed, {
    closed: true, registeredCount: 0, activeCalls: 0, timerCount: 0, listenerCount: 0, networkOwnerCount: 0,
  });
  assert.throws(() => failedRegistry.descriptors(), /已关闭/);

  let release;
  const held = {
    descriptor: () => descriptor({ capabilities: ['search'] }),
    search: () => new Promise(resolve => { release = resolve; }),
  };
  const busyRegistry = new source.LibrarySourceRegistry({ now: NOW });
  busyRegistry.register(held);
  const pending = busyRegistry.search('fixture-source', { query: 'held' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(busyRegistry.snapshot().activeCalls, 1);
  assert.throws(() => busyRegistry.close(), /活动调用/);
  release(page([candidate('held')]));
  await pending;
  assert.equal(busyRegistry.close().activeCalls, 0);
});

test('public-domain and open-license issue minimal receipts only with matching policy and jurisdiction', () => {
  const pdCandidate = candidate('pd');
  const pd = evaluate(pdCandidate);
  assert.equal(pd.outcome, 'pass');
  assert.equal(pd.receipt.decision, 'public-domain');
  assert.equal(pd.receipt.authority, 'adapter-policy-fixture-source');
  assert.match(pd.receipt.evidenceRef, /^rights-evidence-[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(pd.receipt), /example\.org|rightsStatement|sourceUrl/);

  const openCandidate = candidate('open', { rights: rights('open-license') });
  const open = evaluate(openCandidate, { jurisdiction: 'worldwide' });
  assert.equal(open.outcome, 'pass');
  assert.equal(open.receipt.decision, 'open-license');

  assert.equal(evaluate(pdCandidate, { jurisdiction: 'worldwide' }).reasonCode, 'JURISDICTION_UNRESOLVED');
  assert.equal(evaluate(pdCandidate, {
    descriptor: descriptor({ policy: { rightsModes: ['open-license'] } }),
  }).reasonCode, 'POLICY_MODE_UNSUPPORTED');
  assert.equal(evaluate(candidate('old', { rights: rights('public-domain', { checkedAt: '2026-07-01T00:00:00.000Z' }) })).reasonCode, 'EVIDENCE_PRECEDES_POLICY');
  assert.throws(() => evaluate(candidate('future', {
    rights: rights('public-domain', { checkedAt: '2026-08-26T00:00:00.000Z' }),
  })), /晚于裁决/);
});

test('unknown waits and restricted blocks without any passing receipt or parameter upgrade', () => {
  const unknownCandidate = candidate('unknown', { rights: rights('unknown') });
  const restrictedCandidate = candidate('restricted', { rights: rights('restricted') });
  const unknown = evaluate(unknownCandidate);
  const restricted = evaluate(restrictedCandidate);
  assert.deepEqual([unknown.outcome, unknown.receipt, unknown.reasonCode], ['awaiting-rights', null, 'RIGHTS_UNKNOWN']);
  assert.deepEqual([restricted.outcome, restricted.receipt, restricted.reasonCode], ['blocked', null, 'RIGHTS_RESTRICTED']);
  assert.throws(() => rightsPolicy.normalizeRightsDecision({ ...restricted, outcome: 'pass' }), /Receipt|restricted/);
  assert.throws(() => rightsPolicy.normalizeRightsDecision({ ...unknown, sourceStatus: 'public-domain' }), /reasonCode|Receipt/);
});

test('user-owned requires an exact current-user assertion bound to candidate, jurisdiction and time', () => {
  const ownedCandidate = candidate('owned', { rights: rights('user-owned') });
  assert.equal(evaluate(ownedCandidate).reasonCode, 'USER_ASSERTION_REQUIRED');
  const fingerprint = contract.deriveCandidateFingerprint(ownedCandidate);
  const assertion = {
    schema: rightsPolicy.USER_ASSERTION_SCHEMA,
    authority: 'user',
    candidateFingerprint: fingerprint,
    jurisdiction: 'US',
    declarationId: 'declaration-owned-1',
    confirmedAt: EVIDENCE_AT,
  };
  const decision = evaluate(ownedCandidate, { userAssertion: assertion });
  assert.equal(decision.outcome, 'pass');
  assert.equal(decision.receipt.authority, 'user');
  for (const invalid of [
    { ...assertion, authority: 'adapter' },
    { ...assertion, candidateFingerprint: `candidate-sha256-${'0'.repeat(64)}` },
    { ...assertion, jurisdiction: 'worldwide' },
    { ...assertion, confirmedAt: '2026-08-26T00:00:00.000Z' },
    { ...assertion, token: 'secret' },
  ]) assert.throws(() => evaluate(ownedCandidate, { userAssertion: invalid }), /authority|绑定|字段|法域|时间|secret|当前用户|确认/i);
});

test('rights decision prepares a W93A job and survives durable reopen without widening authority', async () => {
  await withWorkspace(async workspace => {
    const store = new LibraryAcquisitionStore({ workspacePath: workspace, recoverOnOpen: false, now: () => NOW });
    const pdCandidate = candidate('durable');
    const decision = evaluate(pdCandidate);
    const prepared = rightsPolicy.prepareAcquisitionJob({
      jobId: 'job-durable',
      intentId: 'intent-durable',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: pdCandidate,
      offerId: pdCandidate.offers[0].offerId,
      descriptor: descriptor(),
      jurisdiction: 'US',
      decision,
      selectedFiles: [],
      createdAt: JOB_AT,
    });
    assert.equal(prepared.state, 'queued');
    assert.equal(prepared.rightsReceipt.evidenceRef, decision.receipt.evidenceRef);
    const created = store.createJob(prepared, { candidate: pdCandidate });
    const reopened = new LibraryAcquisitionStore({ workspacePath: workspace, recoverOnOpen: false, now: () => NOW });
    const durable = reopened.getJob(created.jobId);
    assert.equal(durable.candidateFingerprint, decision.candidateFingerprint);
    assert.deepEqual(durable.rightsReceipt, decision.receipt);
    assert.equal(durable.state, 'queued');
  });
});

test('unknown/restricted durable jobs remain outside queue and selectable offers await explicit selection', async () => {
  await withWorkspace(async workspace => {
    const store = new LibraryAcquisitionStore({ workspacePath: workspace, recoverOnOpen: false, now: () => NOW });
    for (const status of ['unknown', 'restricted']) {
      const item = candidate(status, { rights: rights(status) });
      const decision = evaluate(item);
      const prepared = rightsPolicy.prepareAcquisitionJob({
        jobId: `job-${status}`,
        intentId: `intent-${status}`,
        workspaceIdentity: store.workspaceIdentity,
        workspacePath: store.workspacePath,
        candidate: item,
        offerId: item.offers[0].offerId,
        descriptor: descriptor(),
        jurisdiction: status === 'unknown' ? 'US' : 'US',
        decision,
        selectedFiles: [],
        createdAt: NOW,
      });
      assert.equal(prepared.state, 'awaiting-rights');
      assert.equal(prepared.rightsReceipt, null);
      assert.equal(store.createJob(prepared, { candidate: item }).state, 'awaiting-rights');
    }

    const selectable = candidate('selectable', { offer: { selectableFiles: ['books/a.epub', 'books/b.pdf'] } });
    const prepared = rightsPolicy.prepareAcquisitionJob({
      jobId: 'job-selectable',
      intentId: 'intent-selectable',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: selectable,
      offerId: selectable.offers[0].offerId,
      descriptor: descriptor(),
      jurisdiction: 'US',
      decision: evaluate(selectable),
      selectedFiles: [],
      createdAt: NOW,
    });
    assert.equal(prepared.state, 'awaiting-selection');
    assert.throws(() => rightsPolicy.prepareAcquisitionJob({
      jobId: 'job-invalid-selection',
      intentId: 'intent-invalid-selection',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: selectable,
      offerId: selectable.offers[0].offerId,
      descriptor: descriptor(),
      jurisdiction: 'US',
      decision: evaluate(selectable),
      selectedFiles: ['books/not-offered.epub'],
      createdAt: NOW,
    }), /不属于/);
  });
});

test('strict decision and job inputs reject boxed, unknown, secret and mismatched identities', async () => {
  await withWorkspace(async workspace => {
    const store = new LibraryAcquisitionStore({ workspacePath: workspace, recoverOnOpen: false, now: () => NOW });
    const item = candidate('strict');
    const decision = evaluate(item);
    assert.throws(() => rightsPolicy.normalizeRightsDecision({ ...decision, reasonCode: ' RIGHTS_PASS ' }), /精确|opaque/);
    assert.throws(() => rightsPolicy.normalizeRightsDecision({ ...decision, extra: true }), /未知字段/);
    assert.throws(() => rightsPolicy.prepareAcquisitionJob({
      jobId: new String('job-boxed'),
      intentId: 'intent-boxed',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: item,
      offerId: item.offers[0].offerId,
      descriptor: descriptor(),
      jurisdiction: 'US',
      decision,
      selectedFiles: [],
      createdAt: NOW,
    }), /原生|opaque|可序列化/);
    assert.throws(() => rightsPolicy.prepareAcquisitionJob({
      jobId: 'job-mismatch',
      intentId: 'intent-mismatch',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: item,
      offerId: item.offers[0].offerId,
      descriptor: descriptor(),
      jurisdiction: 'US',
      decision: { ...decision, candidateFingerprint: `candidate-sha256-${'0'.repeat(64)}` },
      selectedFiles: [],
      createdAt: NOW,
    }), /未绑定|重新裁决/);
    assert.throws(() => rightsPolicy.prepareAcquisitionJob({
      jobId: 'job-forged-authority',
      intentId: 'intent-forged-authority',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: item,
      offerId: item.offers[0].offerId,
      descriptor: descriptor(),
      jurisdiction: 'US',
      decision: { ...decision, receipt: { ...decision.receipt, authority: 'attacker' } },
      selectedFiles: [],
      createdAt: NOW,
    }), /重新裁决/);
    assert.throws(() => rightsPolicy.prepareAcquisitionJob({
      jobId: 'job-null-selection',
      intentId: 'intent-null-selection',
      workspaceIdentity: store.workspaceIdentity,
      workspacePath: store.workspacePath,
      candidate: item,
      offerId: item.offers[0].offerId,
      descriptor: descriptor(),
      jurisdiction: 'US',
      decision,
      selectedFiles: null,
      createdAt: NOW,
    }), /selectedFiles 必须是数组/);
  });
});

test('W93C foundation contains no default network, timers or business count/text/token/file-size gates', () => {
  const registrySource = fs.readFileSync(path.join(process.cwd(), 'main/library-source-registry.js'), 'utf8');
  const policySource = fs.readFileSync(path.join(process.cwd(), 'main/library-rights-policy.js'), 'utf8');
  for (const text of [registrySource, policySource]) {
    assert.doesNotMatch(text, /\b(?:fetch|https?\.request|net\.connect|setInterval|setTimeout)\s*\(/);
    assert.doesNotMatch(text, /max(?:Pages|Items|Candidates|Tokens|Bytes)|slice\(0,\s*\d+\)|candidate[s]?\.length\s*[><=]/i);
  }
  const registry = new source.LibrarySourceRegistry({ now: NOW });
  assert.deepEqual(registry.snapshot(), {
    closed: false, registeredCount: 0, activeCalls: 0, timerCount: 0, listenerCount: 0, networkOwnerCount: 0,
  });
});
