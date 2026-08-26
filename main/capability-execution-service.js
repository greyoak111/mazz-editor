// W94A main-process owner for capability registry, proposals, leases, receipts and artifact facts.
'use strict';

const crypto = require('crypto');
const contract = require('./capability-execution-contract');
const {
  CapabilityExecutionStore,
  createCapabilityExecutionOwnerCapability,
} = require('./capability-execution-store');
const { CapabilityArtifactStore } = require('./capability-artifact-store');
const { capabilityDomain, captureDomainEvent } = require('./foundation/domain-event-capture');

function errorCode(error, fallback = 'CAPABILITY_ADAPTER_FAILED') {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_.-]*$/.test(error.code)
    ? error.code
    : fallback;
  return code;
}

function clone(value) {
  return contract.clonePortable(value, 'Capability Service result');
}

function activeKey(workspaceIdentity, proposalId) {
  return `${workspaceIdentity}\u0000${proposalId}`;
}

function nowIso(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw contract.codedError('CAPABILITY_SERVICE_CLOCK_INVALID', 'Capability Service clock 非法');
  return date.toISOString();
}

function normalizeAdapterResult(value, descriptor) {
  contract.exactKeys(value, ['status', 'outputs', 'environment', 'diagnostics', 'resourceFinal', 'provenance', 'seed'], 'Capability Adapter result');
  if (value.status !== 'completed') throw contract.codedError('CAPABILITY_ADAPTER_RESULT_INVALID', 'Capability Adapter 只能返回 completed；失败必须 throw');
  if (!Array.isArray(value.outputs)) throw contract.codedError('CAPABILITY_ADAPTER_RESULT_INVALID', 'Capability Adapter outputs 必须是数组');
  const outputs = value.outputs.map((row, index) => {
    contract.exactKeys(row, [
      'schema', 'kind', 'mediaType', 'contentSchema', 'contentHash', 'definitionHash', 'storageRef',
      'sourceArtifacts', 'rightsRef', 'mutableHead',
    ], `Capability output[${index}]`);
    if (row.schema !== contract.ARTIFACT_SCHEMA) throw contract.codedError('CAPABILITY_ADAPTER_RESULT_INVALID', 'Capability output schema 不支持');
    if (!descriptor.outputSchemas.includes(row.contentSchema)) {
      throw contract.codedError('CAPABILITY_ADAPTER_RESULT_INVALID', `Adapter 输出未登记 schema: ${row.contentSchema}`);
    }
    return clone(row);
  });
  return Object.freeze({
    status: 'completed',
    outputs: Object.freeze(outputs),
    environment: contract.portableRecord(value.environment, 'adapter.environment'),
    diagnostics: contract.portableRecord(value.diagnostics, 'adapter.diagnostics'),
    resourceFinal: contract.portableRecord(value.resourceFinal, 'adapter.resourceFinal'),
    provenance: contract.portableRecord(value.provenance, 'adapter.provenance'),
    seed: value.seed === undefined ? null : contract.clonePortable(value.seed, 'adapter.seed'),
  });
}

class CapabilityExecutionService {
  constructor({
    resourceLedger = null,
    storeFactory = options => new CapabilityExecutionStore(options),
    artifactStoreFactory = options => new CapabilityArtifactStore(options),
    ownerCapability = createCapabilityExecutionOwnerCapability(),
    clock = () => new Date(),
    randomId = () => crypto.randomUUID(),
    grantClock = () => Date.now(),
    eventService = null,
  } = {}) {
    if (typeof storeFactory !== 'function') throw new TypeError('CapabilityExecutionService 需要 storeFactory');
    if (typeof artifactStoreFactory !== 'function') throw new TypeError('CapabilityExecutionService 需要 artifactStoreFactory');
    this.resourceLedger = resourceLedger;
    this.storeFactory = storeFactory;
    this.artifactStoreFactory = artifactStoreFactory;
    this.ownerCapability = ownerCapability;
    this.clock = clock;
    this.randomId = randomId;
    this.grantClock = grantClock;
    this.eventService = eventService;
    this.adapters = new Map();
    this.stores = new Map();
    this.artifactStores = new Map();
    this.active = new Map();
    this.artifactGrants = new Map();
    this.artifactStreams = new Map();
    this.durabilityFailures = new Map();
    this.accepting = true;
    this.shutdownPromise = null;
  }

  register(adapterInput) {
    if (!this.accepting) throw contract.codedError('CAPABILITY_SERVICE_CLOSED', 'Capability Service 已停止接收 adapter');
    const adapter = contract.normalizeAdapter(adapterInput);
    const key = contract.descriptorKey(adapter.descriptor.capabilityId, adapter.descriptor.version, adapter.descriptor.adapterId);
    if (this.adapters.has(key)) throw contract.codedError('CAPABILITY_ADAPTER_DUPLICATE', 'Capability Adapter 重复登记');
    this.adapters.set(key, adapter);
    return Object.freeze({
      descriptor: clone(adapter.descriptor),
      unregister: () => {
        if ([...this.active.values()].some(row => row.adapterKey === key)) {
          throw contract.codedError('CAPABILITY_ADAPTER_BUSY', 'Capability Adapter 仍有活动执行');
        }
        return this.adapters.delete(key);
      },
    });
  }

  _adapter(capabilityId, version, adapterId) {
    const key = contract.descriptorKey(capabilityId, version, adapterId);
    const adapter = this.adapters.get(key);
    if (!adapter) throw contract.codedError('CAPABILITY_ADAPTER_NOT_REGISTERED', `Capability Adapter 未登记: ${capabilityId}/${version}/${adapterId}`);
    return { key, adapter };
  }

  listCapabilities() {
    return Object.freeze([...this.adapters.values()]
      .map(adapter => clone(adapter.descriptor))
      .sort((left, right) => `${left.capabilityId}\u0000${left.version}\u0000${left.adapterId}`
        .localeCompare(`${right.capabilityId}\u0000${right.version}\u0000${right.adapterId}`, 'en')));
  }

  openWorkspace(workspacePath) {
    const candidate = this.storeFactory({ workspacePath });
    const current = this.stores.get(candidate.workspaceIdentity);
    if (current) return Object.freeze({ workspacePath: current.workspacePath, workspaceIdentity: current.workspaceIdentity });
    this.stores.set(candidate.workspaceIdentity, candidate);
    return Object.freeze({ workspacePath: candidate.workspacePath, workspaceIdentity: candidate.workspaceIdentity });
  }

  _store(selector) {
    if (typeof selector === 'string') {
      const opened = this.openWorkspace(selector);
      return this.stores.get(opened.workspaceIdentity);
    }
    if (!contract.isPlainRecord(selector)) throw contract.codedError('CAPABILITY_WORKSPACE_INVALID', 'Capability Workspace selector 非法');
    if (selector.workspaceIdentity) {
      const identity = contract.safeId(selector.workspaceIdentity, 'workspaceIdentity');
      const existing = this.stores.get(identity);
      if (!existing) throw contract.codedError('CAPABILITY_WORKSPACE_NOT_OPEN', 'Capability Workspace 尚未打开');
      if (selector.workspacePath !== undefined && existing.workspacePath !== selector.workspacePath) {
        throw contract.codedError('CAPABILITY_WORKSPACE_MISMATCH', 'Capability Workspace path/identity 不一致');
      }
      return existing;
    }
    return this._store(contract.exactText(selector.workspacePath, 'workspacePath'));
  }

  _artifactStore(store) {
    let current = this.artifactStores.get(store.workspaceIdentity);
    if (current) return current;
    current = this.artifactStoreFactory({ workspacePath: store.workspacePath });
    if (current.workspaceIdentity !== store.workspaceIdentity) {
      throw contract.codedError('CAPABILITY_ARTIFACT_WORKSPACE_MISMATCH', 'Artifact Store 与执行 Workspace identity 不一致');
    }
    this.artifactStores.set(store.workspaceIdentity, current);
    return current;
  }

  _artifactContext(store) {
    const artifactStore = this._artifactStore(store);
    return Object.freeze({
      workspacePath: store.workspacePath,
      workspaceIdentity: store.workspaceIdentity,
      getArtifact: artifactId => store.snapshot().artifacts.find(row => row.artifactId === artifactId) || null,
      publishReadable: options => artifactStore.publishReadable(options),
      publishBytes: (bytes, options) => artifactStore.publishBytes(bytes, options),
      open: (storageRef, options) => artifactStore.open(storageRef, options),
      snapshot: () => artifactStore.snapshot(),
    });
  }

  submitProposal(selector, input) {
    if (!this.accepting) throw contract.codedError('CAPABILITY_SERVICE_CLOSED', 'Capability Service 已停止接收任务');
    contract.exactKeys(input, [
      'taskId', 'seatId', 'capabilityId', 'capabilityVersion', 'adapterId', 'inputs',
      'parameters', 'expectedOutputs', 'constraints', 'authorityRef',
    ], 'Capability Proposal request');
    const store = this._store(selector);
    const { adapter } = this._adapter(input.capabilityId, input.capabilityVersion, input.adapterId);
    if (!['available', 'degraded'].includes(adapter.descriptor.availability.state)) {
      throw contract.codedError('CAPABILITY_UNAVAILABLE', `Capability 不可用: ${adapter.descriptor.availability.state}`);
    }
    if (!Array.isArray(input.inputs)) throw contract.codedError('CAPABILITY_CONTRACT_INVALID', 'inputs 必须是数组');
    for (const [index, row] of input.inputs.entries()) {
      if (!adapter.descriptor.inputSchemas.includes(row?.schema)) {
        throw contract.codedError('CAPABILITY_INPUT_SCHEMA_UNSUPPORTED', `inputs[${index}] schema 未登记`);
      }
    }
    if (!Array.isArray(input.expectedOutputs) || input.expectedOutputs.some(value => !adapter.descriptor.outputSchemas.includes(value))) {
      throw contract.codedError('CAPABILITY_OUTPUT_SCHEMA_UNSUPPORTED', 'expectedOutputs 含未登记 schema');
    }
    const proposal = contract.normalizeProposal({
      schema: contract.EXECUTION_PROPOSAL_SCHEMA,
      workspaceIdentity: store.workspaceIdentity,
      ...input,
      determinism: adapter.descriptor.determinism,
      state: 'proposed', receiptIds: [], artifactIds: [], activeLeaseId: '', failureCode: '',
    }, { now: nowIso(this.clock) });
    const transaction = store.transact({ apply: state => {
      const existing = state.proposals.find(row => row.proposalId === proposal.proposalId);
      if (existing) {
        return { state, result: { proposal: existing, idempotent: true }, changed: false };
      }
      state.proposals.push(proposal);
      return { state, result: { proposal, idempotent: false }, changed: true };
    } });
    if (!transaction.result.idempotent && String(input.authorityRef || '').startsWith('human:')) {
      captureDomainEvent(this.eventService, {
        domain: capabilityDomain(input.capabilityId), action: 'approve', outcome: 'approval', actorType: 'human',
        subjectId: `capability-${input.capabilityId}`, objectId: proposal.proposalId,
        idempotencyKey: `w94e:approval:${proposal.proposalId}`,
      });
    }
    return Object.freeze({ ...transaction.result, workspaceIdentity: store.workspaceIdentity, storeRevision: transaction.state.revision });
  }

  workspaceSnapshot(selector) {
    const store = this._store(selector);
    const state = store.snapshot();
    return Object.freeze({
      schema: 'mazz.capability-workspace-snapshot/v1',
      workspaceIdentity: store.workspaceIdentity,
      revision: state.revision,
      proposals: state.proposals,
      leases: state.leases,
      receipts: state.receipts,
      artifacts: state.artifacts,
    });
  }

  _resourceRegister(store, proposal, lease) {
    if (!this.resourceLedger) return '';
    return this.resourceLedger.register({
      type: 'capability-execution',
      id: lease.leaseId,
      owner: `${proposal.capabilityId}@${proposal.adapterId}`,
      state: 'running',
      meta: { workspaceIdentity: store.workspaceIdentity, proposalId: proposal.proposalId },
    });
  }

  _resourceRelease(record, reason, state = 'released') {
    if (record.resourceKey && this.resourceLedger) this.resourceLedger.release(record.resourceKey, { reason, state });
    record.resourceKey = '';
  }

  executeProposal(selector, proposalId) {
    if (!this.accepting) return Promise.reject(contract.codedError('CAPABILITY_SERVICE_CLOSED', 'Capability Service 已停止接收任务'));
    const store = this._store(selector);
    const id = contract.safeId(proposalId, 'proposalId');
    const key = activeKey(store.workspaceIdentity, id);
    const active = this.active.get(key);
    if (active) return active.done;

    const snapshot = store.snapshot();
    const current = snapshot.proposals.find(row => row.proposalId === id);
    if (!current) return Promise.reject(contract.codedError('CAPABILITY_PROPOSAL_NOT_FOUND', 'Capability Proposal 不存在'));
    if (current.state === 'completed') {
      const receipt = snapshot.receipts.find(row => row.receiptId === current.receiptIds.at(-1));
      return Promise.resolve(Object.freeze({ proposal: current, receipt, artifacts: snapshot.artifacts.filter(row => current.artifactIds.includes(row.artifactId)), idempotent: true }));
    }
    if (!['proposed', 'paused'].includes(current.state)) {
      return Promise.reject(contract.codedError('CAPABILITY_PROPOSAL_NOT_EXECUTABLE', `Capability Proposal 状态不可执行: ${current.state}`));
    }
    const { key: adapterKey, adapter } = this._adapter(current.capabilityId, current.capabilityVersion, current.adapterId);
    const acquiredAt = nowIso(this.clock);
    const leaseId = `lease-${this.randomId()}`;
    const lease = contract.normalizeLease({
      schema: contract.EXECUTION_LEASE_SCHEMA,
      leaseId, workspaceIdentity: store.workspaceIdentity, proposalId: id,
      ownerKind: 'main-process', ownerId: `process:${process.pid}`,
      state: 'active', acquiredAt, heartbeatAt: acquiredAt,
      cancelRequestedAt: '', releasedAt: '', releaseReason: '',
    });
    let queued;
    try {
      queued = store.transact({ apply: state => {
        const proposal = state.proposals.find(row => row.proposalId === id);
        if (!proposal) throw contract.codedError('CAPABILITY_PROPOSAL_NOT_FOUND', 'Capability Proposal 不存在');
        if (proposal.state === 'completed') return { state, result: { completed: true, proposal }, changed: false };
        if (!['proposed', 'paused'].includes(proposal.state)) throw contract.codedError('CAPABILITY_PROPOSAL_NOT_EXECUTABLE', `Capability Proposal 状态不可执行: ${proposal.state}`);
        if (state.leases.some(row => row.proposalId === id && row.state !== 'released')) throw contract.codedError('CAPABILITY_LEASE_CONFLICT', 'Capability Proposal 已有活动 Lease');
        const nextProposal = contract.normalizeProposal({ ...proposal, state: 'queued', activeLeaseId: leaseId, revision: proposal.revision + 1, updatedAt: acquiredAt }, { durable: true });
        state.proposals[state.proposals.indexOf(proposal)] = nextProposal;
        state.leases.push(lease);
        return { state, result: { completed: false, proposal: nextProposal }, changed: true };
      } });
    } catch (error) { return Promise.reject(error); }
    if (queued.result.completed) return this.executeProposal(selector, id);

    const controller = new AbortController();
    const record = {
      key, store, proposalId: id, leaseId, adapterKey, adapter, controller,
      resourceKey: '', done: null, startedAt: acquiredAt,
    };
    try { record.resourceKey = this._resourceRegister(store, queued.result.proposal, lease); }
    catch (error) {
      return Promise.reject(error);
    }
    this.active.set(key, record);

    const run = (async () => {
      const runningAt = nowIso(this.clock);
      const runningState = store.transact({ apply: state => {
        const proposal = state.proposals.find(row => row.proposalId === id);
        const currentLease = state.leases.find(row => row.leaseId === leaseId);
        if (!proposal || !currentLease || proposal.state !== 'queued' || currentLease.state !== 'active') {
          throw contract.codedError('CAPABILITY_EXECUTION_STATE_DRIFT', 'Capability queued→running 状态漂移');
        }
        const nextProposal = contract.normalizeProposal({ ...proposal, state: 'running', revision: proposal.revision + 1, updatedAt: runningAt }, { durable: true });
        state.proposals[state.proposals.indexOf(proposal)] = nextProposal;
        return { state, result: { proposal: nextProposal }, changed: true };
      } });
      const proposal = runningState.result.proposal;
      let result;
      try {
        const adapterValue = await adapter.execute({
          proposal: clone(proposal),
          lease: clone(lease),
          signal: controller.signal,
          artifacts: this._artifactContext(store),
        });
        result = normalizeAdapterResult(adapterValue, adapter.descriptor);
        if (controller.signal.aborted) throw Object.assign(new Error('Capability execution cancelled'), { code: 'CAPABILITY_CANCELLED' });
      } catch (error) {
        return this._commitFailure(record, proposal, error);
      }
      // Durable publication is deliberately outside the adapter error catch.
      // A rename/fsync failure must remain a durability hold; retrying it as a
      // business-failed Receipt would guess success from a partially visible
      // record and erase the primary storage error.
      return this._commitSuccess(record, proposal, result);
    })();
    record.done = run.finally(() => {
      this.active.delete(key);
    });
    return record.done;
  }

  _commitSuccess(record, proposal, result) {
    const finishedAt = nowIso(this.clock);
    const receiptId = `receipt-${this.randomId()}`;
    const provisionalArtifacts = result.outputs.map(output => contract.normalizeArtifact({
      ...output,
      workspaceIdentity: record.store.workspaceIdentity,
      createdByReceiptId: receiptId,
      createdAt: finishedAt,
    }));
    const receipt = contract.normalizeReceipt({
      schema: contract.EXECUTION_RECEIPT_SCHEMA,
      receiptId, proposalId: proposal.proposalId, leaseId: record.leaseId,
      workspaceIdentity: record.store.workspaceIdentity,
      capability: { id: proposal.capabilityId, version: proposal.capabilityVersion, adapterId: proposal.adapterId },
      state: 'completed', inputFacts: proposal.inputs,
      outputFacts: provisionalArtifacts.map(row => row.artifactId),
      environment: result.environment,
      determinism: proposal.determinism,
      seed: result.seed,
      startedAt: record.startedAt, finishedAt,
      diagnostics: { code: 'CAPABILITY_COMPLETED', summaryRef: result.diagnostics.summaryRef || '' },
      resourceFinal: result.resourceFinal,
      provenance: { ...record.adapter.descriptor.provenance, ...result.provenance },
    });
    try {
      const committed = record.store.transact({ apply: state => {
        const currentProposal = state.proposals.find(row => row.proposalId === proposal.proposalId);
        const currentLease = state.leases.find(row => row.leaseId === record.leaseId);
        if (!currentProposal || currentProposal.state !== 'running' || !currentLease || currentLease.state !== 'active') {
          throw contract.codedError('CAPABILITY_EXECUTION_STATE_DRIFT', 'Capability success commit 状态漂移');
        }
        const artifactIds = [];
        for (const artifact of provisionalArtifacts) {
          const existing = state.artifacts.find(row => row.artifactId === artifact.artifactId);
          if (existing) {
            if (existing.contentHash !== artifact.contentHash || existing.contentSchema !== artifact.contentSchema
                || existing.mediaType !== artifact.mediaType || existing.storageRef !== artifact.storageRef) {
              throw contract.codedError('CAPABILITY_ARTIFACT_CONFLICT', '相同 Artifact identity 对应不同事实');
            }
            artifactIds.push(existing.artifactId);
          } else {
            state.artifacts.push(artifact);
            artifactIds.push(artifact.artifactId);
          }
        }
        state.receipts.push(receipt);
        state.leases[state.leases.indexOf(currentLease)] = contract.normalizeLease({
          ...currentLease, state: 'released', releasedAt: finishedAt, releaseReason: 'CAPABILITY_COMPLETED', revision: currentLease.revision + 1,
        }, { durable: true });
        const nextProposal = contract.normalizeProposal({
          ...currentProposal, state: 'completed', activeLeaseId: '', receiptIds: [...currentProposal.receiptIds, receiptId],
          artifactIds: [...new Set([...currentProposal.artifactIds, ...artifactIds])], failureCode: '',
          revision: currentProposal.revision + 1, updatedAt: finishedAt,
        }, { durable: true });
        state.proposals[state.proposals.indexOf(currentProposal)] = nextProposal;
        return { state, result: { proposal: nextProposal, receipt, artifactIds }, changed: true };
      } });
      this._resourceRelease(record, 'capability-completed');
      const artifacts = committed.state.artifacts.filter(row => committed.result.artifactIds.includes(row.artifactId));
      captureDomainEvent(this.eventService, {
        domain: capabilityDomain(proposal.capabilityId), action: 'execute', outcome: 'success', actorType: 'system',
        subjectId: `capability-${proposal.capabilityId}`, objectId: proposal.proposalId,
      });
      return Object.freeze({ proposal: committed.result.proposal, receipt, artifacts, idempotent: false });
    } catch (error) {
      this.durabilityFailures.set(record.key, { code: errorCode(error, 'CAPABILITY_DURABILITY_FAILED'), error, leaseId: record.leaseId });
      if (record.resourceKey && this.resourceLedger) this.resourceLedger.update(record.resourceKey, { state: 'durability-failed' });
      throw error;
    }
  }

  _commitFailure(record, proposal, error) {
    const finishedAt = nowIso(this.clock);
    const cancelled = record.controller.signal.aborted || errorCode(error) === 'CAPABILITY_CANCELLED';
    const receiptState = cancelled ? 'cancelled' : 'failed';
    const proposalState = cancelled ? 'cancelled' : 'failed';
    const failureCode = cancelled ? 'CAPABILITY_CANCELLED' : errorCode(error);
    const receiptId = `receipt-${this.randomId()}`;
    const receipt = contract.normalizeReceipt({
      schema: contract.EXECUTION_RECEIPT_SCHEMA,
      receiptId, proposalId: proposal.proposalId, leaseId: record.leaseId,
      workspaceIdentity: record.store.workspaceIdentity,
      capability: { id: proposal.capabilityId, version: proposal.capabilityVersion, adapterId: proposal.adapterId },
      state: receiptState, inputFacts: proposal.inputs, outputFacts: [], environment: {},
      determinism: proposal.determinism, seed: null,
      startedAt: record.startedAt, finishedAt,
      diagnostics: { code: failureCode, summaryRef: `diagnostic:${receiptId}` },
      resourceFinal: {}, provenance: record.adapter.descriptor.provenance,
    });
    try {
      const committed = record.store.transact({ apply: state => {
        const currentProposal = state.proposals.find(row => row.proposalId === proposal.proposalId);
        const currentLease = state.leases.find(row => row.leaseId === record.leaseId);
        if (!currentProposal || !['running', 'queued'].includes(currentProposal.state)
            || !currentLease || !['active', 'cancel-requested'].includes(currentLease.state)) {
          throw contract.codedError('CAPABILITY_EXECUTION_STATE_DRIFT', 'Capability failure commit 状态漂移');
        }
        state.receipts.push(receipt);
        state.leases[state.leases.indexOf(currentLease)] = contract.normalizeLease({
          ...currentLease, state: 'released', releasedAt: finishedAt, releaseReason: failureCode,
          revision: currentLease.revision + 1,
        }, { durable: true });
        const nextProposal = contract.normalizeProposal({
          ...currentProposal, state: proposalState, activeLeaseId: '',
          receiptIds: [...currentProposal.receiptIds, receiptId], failureCode,
          revision: currentProposal.revision + 1, updatedAt: finishedAt,
        }, { durable: true });
        state.proposals[state.proposals.indexOf(currentProposal)] = nextProposal;
        return { state, result: { proposal: nextProposal }, changed: true };
      } });
      this._resourceRelease(record, cancelled ? 'capability-cancelled' : 'capability-failed', receiptState);
      captureDomainEvent(this.eventService, {
        domain: capabilityDomain(proposal.capabilityId), action: 'execute', outcome: cancelled ? 'cancelled' : 'failed', actorType: 'system',
        subjectId: `capability-${proposal.capabilityId}`, objectId: proposal.proposalId,
      });
      const publicError = contract.codedError(failureCode, cancelled ? 'Capability execution cancelled' : 'Capability execution failed', {
        durableReceipt: clone(receipt), proposal: clone(committed.result.proposal), cause: error,
      });
      throw publicError;
    } catch (persistenceOrPublicError) {
      if (persistenceOrPublicError?.durableReceipt) throw persistenceOrPublicError;
      this.durabilityFailures.set(record.key, { code: errorCode(persistenceOrPublicError, 'CAPABILITY_DURABILITY_FAILED'), error: persistenceOrPublicError, leaseId: record.leaseId });
      if (record.resourceKey && this.resourceLedger) this.resourceLedger.update(record.resourceKey, { state: 'durability-failed' });
      throw persistenceOrPublicError;
    }
  }

  async cancelProposal(selector, proposalId, authorityRef) {
    const store = this._store(selector);
    const id = contract.safeId(proposalId, 'proposalId');
    const authority = contract.opaqueRef(authorityRef, 'authorityRef');
    if (!authority.startsWith('human:') && !authority.startsWith('system:')) {
      throw contract.codedError('CAPABILITY_CANCEL_AUTHORITY_REQUIRED', 'Capability cancel 需要 human/system Authority');
    }
    const key = activeKey(store.workspaceIdentity, id);
    const record = this.active.get(key);
    if (!record) {
      const snapshot = store.snapshot();
      const proposal = snapshot.proposals.find(row => row.proposalId === id);
      if (!proposal) throw contract.codedError('CAPABILITY_PROPOSAL_NOT_FOUND', 'Capability Proposal 不存在');
      if (['completed', 'cancelled'].includes(proposal.state)) return Object.freeze({ proposal, idempotent: true });
      if (!['proposed', 'paused'].includes(proposal.state)) throw contract.codedError('CAPABILITY_PROPOSAL_NOT_CANCELLABLE', `Capability Proposal 状态不可取消: ${proposal.state}`);
      const at = nowIso(this.clock);
      const leaseId = `lease-${this.randomId()}`;
      const receiptId = `receipt-${this.randomId()}`;
      const lease = contract.normalizeLease({
        schema: contract.EXECUTION_LEASE_SCHEMA, leaseId, workspaceIdentity: store.workspaceIdentity,
        proposalId: id, ownerKind: 'main-process', ownerId: `process:${process.pid}`, state: 'released',
        acquiredAt: at, heartbeatAt: at, cancelRequestedAt: at, releasedAt: at,
        releaseReason: 'CAPABILITY_CANCELLED',
      });
      const receipt = contract.normalizeReceipt({
        schema: contract.EXECUTION_RECEIPT_SCHEMA, receiptId, proposalId: id, leaseId,
        workspaceIdentity: store.workspaceIdentity,
        capability: { id: proposal.capabilityId, version: proposal.capabilityVersion, adapterId: proposal.adapterId },
        state: 'cancelled', inputFacts: proposal.inputs, outputFacts: [], environment: {},
        determinism: proposal.determinism,
        seed: null, startedAt: at, finishedAt: at,
        diagnostics: { code: 'CAPABILITY_CANCELLED', summaryRef: `diagnostic:${receiptId}` },
        resourceFinal: {}, provenance: { authorityRef: authority },
      });
      const committed = store.transact({ apply: state => {
        const current = state.proposals.find(row => row.proposalId === id);
        if (!current || !['proposed', 'paused'].includes(current.state)) throw contract.codedError('CAPABILITY_PROPOSAL_NOT_CANCELLABLE', 'Capability Proposal 状态已改变');
        state.leases.push(lease); state.receipts.push(receipt);
        const next = contract.normalizeProposal({
          ...current, state: 'cancelled', activeLeaseId: '', receiptIds: [...current.receiptIds, receiptId],
          failureCode: 'CAPABILITY_CANCELLED', revision: current.revision + 1, updatedAt: at,
        }, { durable: true });
        state.proposals[state.proposals.indexOf(current)] = next;
        return { state, result: { proposal: next, receipt }, changed: true };
      } });
      captureDomainEvent(this.eventService, {
        domain: capabilityDomain(proposal.capabilityId), action: 'cancel', outcome: 'cancelled', actorType: 'human',
        subjectId: `capability-${proposal.capabilityId}`, objectId: proposal.proposalId,
      });
      return Object.freeze({ ...committed.result, idempotent: false });
    }
    const requestedAt = nowIso(this.clock);
    record.store.mutate({ apply: state => {
      const lease = state.leases.find(row => row.leaseId === record.leaseId);
      if (!lease || lease.state === 'released') return state;
      state.leases[state.leases.indexOf(lease)] = contract.normalizeLease({
        ...lease, state: 'cancel-requested', cancelRequestedAt: requestedAt,
        heartbeatAt: requestedAt, revision: lease.revision + 1,
      }, { durable: true });
      return state;
    } });
    record.controller.abort(contract.codedError('CAPABILITY_CANCELLED', 'Capability execution cancelled'));
    if (record.adapter.cancel) await record.adapter.cancel({ proposalId: id, leaseId: record.leaseId, authorityRef: authority });
    return record.done;
  }

  recoverWorkspace(selector) {
    const store = this._store(selector);
    const lockRepair = store.repairOrphanLock(this.ownerCapability);
    const at = nowIso(this.clock);
    const recovered = [];
    const transaction = store.transact({ apply: state => {
      for (const proposal of [...state.proposals]) {
        if (!['queued', 'running'].includes(proposal.state)) continue;
        const lease = state.leases.find(row => row.leaseId === proposal.activeLeaseId);
        if (!lease || !['active', 'cancel-requested'].includes(lease.state)) {
          throw contract.codedError('CAPABILITY_STORE_CORRUPT', '活动 Proposal 缺活动 Lease');
        }
        const receiptId = `receipt-${this.randomId()}`;
        const receipt = contract.normalizeReceipt({
          schema: contract.EXECUTION_RECEIPT_SCHEMA, receiptId, proposalId: proposal.proposalId,
          leaseId: lease.leaseId, workspaceIdentity: store.workspaceIdentity,
          capability: { id: proposal.capabilityId, version: proposal.capabilityVersion, adapterId: proposal.adapterId },
          state: 'paused', inputFacts: proposal.inputs, outputFacts: [], environment: {},
          determinism: proposal.determinism,
          seed: null, startedAt: lease.acquiredAt, finishedAt: at,
          diagnostics: { code: 'APP_RESTART_RECOVERY', summaryRef: `diagnostic:${receiptId}` },
          resourceFinal: {}, provenance: { authorityRef: 'system:single-instance-recovery' },
        });
        state.receipts.push(receipt);
        state.leases[state.leases.indexOf(lease)] = contract.normalizeLease({
          ...lease, state: 'released', releasedAt: at, releaseReason: 'APP_RESTART_RECOVERY', revision: lease.revision + 1,
        }, { durable: true });
        const next = contract.normalizeProposal({
          ...proposal, state: 'paused', activeLeaseId: '', receiptIds: [...proposal.receiptIds, receiptId],
          failureCode: 'APP_RESTART_RECOVERY', revision: proposal.revision + 1, updatedAt: at,
        }, { durable: true });
        state.proposals[state.proposals.indexOf(proposal)] = next;
        recovered.push(next.proposalId);
      }
      return { state, result: { recovered }, changed: recovered.length > 0 };
    } });
    return Object.freeze({ workspaceIdentity: store.workspaceIdentity, lockRepair, recovered: Object.freeze([...recovered]), revision: transaction.state.revision });
  }

  grantArtifact(selector, artifactId, { ttlMs = 60_000 } = {}) {
    if (!this.accepting) throw contract.codedError('CAPABILITY_SERVICE_CLOSED', 'Capability Service 已停止签发 Artifact grant');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw contract.codedError('CAPABILITY_ARTIFACT_GRANT_INVALID', 'Artifact grant TTL 非法');
    const store = this._store(selector);
    const id = contract.safeId(artifactId, 'artifactId');
    const artifact = store.snapshot().artifacts.find(row => row.artifactId === id);
    if (!artifact) throw contract.codedError('CAPABILITY_ARTIFACT_NOT_FOUND', 'Artifact 不存在');
    const token = `grant-${this.randomId()}`;
    this.artifactGrants.set(token, Object.freeze({
      token,
      workspaceIdentity: store.workspaceIdentity,
      artifactId: artifact.artifactId,
      contentHash: artifact.contentHash,
      storageRef: artifact.storageRef,
      mediaType: artifact.mediaType,
      expiresAt: this.grantClock() + ttlMs,
    }));
    return Object.freeze({
      schema: 'mazz.capability-artifact-grant/v1',
      artifactId: artifact.artifactId,
      contentHash: artifact.contentHash,
      mediaType: artifact.mediaType,
      url: `mazz-res://artifact/${encodeURIComponent(token)}`,
      expiresInMs: ttlMs,
    });
  }

  async openArtifactGrant(tokenInput) {
    const token = contract.opaqueRef(tokenInput, 'artifact grant token');
    const grant = this.artifactGrants.get(token);
    this.artifactGrants.delete(token);
    if (!grant) throw contract.codedError('CAPABILITY_ARTIFACT_GRANT_NOT_FOUND', 'Artifact grant 不存在或已消费');
    if (grant.expiresAt < this.grantClock()) throw contract.codedError('CAPABILITY_ARTIFACT_GRANT_EXPIRED', 'Artifact grant 已过期');
    const store = this.stores.get(grant.workspaceIdentity);
    if (!store) throw contract.codedError('CAPABILITY_WORKSPACE_NOT_OPEN', 'Artifact Workspace 已关闭');
    const artifact = store.snapshot().artifacts.find(row => row.artifactId === grant.artifactId);
    if (!artifact || artifact.storageRef !== grant.storageRef || artifact.contentHash !== grant.contentHash
        || artifact.mediaType !== grant.mediaType) {
      throw contract.codedError('CAPABILITY_ARTIFACT_GRANT_DRIFT', 'Artifact grant 对应事实已漂移');
    }
    const opened = await this._artifactStore(store).open(grant.storageRef, { expectedHash: grant.contentHash });
    const streamKey = `artifact-stream:${token}`;
    let resourceKey = '';
    if (this.resourceLedger) {
      resourceKey = this.resourceLedger.register({
        type: 'capability-artifact-stream', id: token, owner: grant.artifactId, state: 'streaming',
        meta: { workspaceIdentity: grant.workspaceIdentity },
      });
    }
    const release = reason => {
      if (!this.artifactStreams.delete(streamKey)) return;
      if (resourceKey && this.resourceLedger) this.resourceLedger.release(resourceKey, { reason, state: 'closed' });
      resourceKey = '';
    };
    this.artifactStreams.set(streamKey, { stream: opened.stream, release });
    opened.stream.once('end', () => release('artifact-stream-end'));
    opened.stream.once('close', () => release('artifact-stream-close'));
    opened.stream.once('error', () => release('artifact-stream-error'));
    return Object.freeze({ ...opened, mediaType: grant.mediaType, artifactId: grant.artifactId });
  }

  snapshot() {
    return Object.freeze({
      schema: 'mazz.capability-service-snapshot/v1',
      accepting: this.accepting,
      adapterCount: this.adapters.size,
      workspaceCount: this.stores.size,
      activeCount: this.active.size,
      artifactGrantCount: this.artifactGrants.size,
      artifactStreamCount: this.artifactStreams.size,
      durabilityFailureCount: this.durabilityFailures.size,
      active: Object.freeze([...this.active.values()].map(row => Object.freeze({
        workspaceIdentity: row.store.workspaceIdentity, proposalId: row.proposalId, leaseId: row.leaseId,
      }))),
    });
  }

  shutdown(reason = 'app-quit') {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.accepting = false;
    this.shutdownPromise = (async () => {
      const active = [...this.active.values()];
      for (const row of active) row.controller.abort(contract.codedError('CAPABILITY_CANCELLED', reason));
      await Promise.allSettled(active.map(row => row.adapter.cancel?.({
        proposalId: row.proposalId,
        leaseId: row.leaseId,
        authorityRef: 'system:app-quit',
      })));
      await Promise.allSettled(active.map(row => row.done));
      if (this.durabilityFailures.size) {
        throw contract.codedError('CAPABILITY_SHUTDOWN_DURABILITY_FAILED', 'Capability 执行存在未持久收敛事实', {
          failures: [...this.durabilityFailures.values()].map(row => ({ code: row.code, leaseId: row.leaseId })),
        });
      }
      this.artifactGrants.clear();
      for (const row of [...this.artifactStreams.values()]) {
        try { row.stream.destroy(contract.codedError('CAPABILITY_CANCELLED', reason)); } catch {}
        row.release('capability-shutdown');
      }
      const disposal = await Promise.allSettled([...this.adapters.values()].map(adapter => adapter.dispose?.(reason)));
      const rejected = disposal.find(row => row.status === 'rejected');
      if (rejected) throw rejected.reason;
      if (this.active.size || this.artifactStreams.size) throw contract.codedError('CAPABILITY_SHUTDOWN_BOUNDARY_FAILED', 'Capability active owner 未归零');
      return this.snapshot();
    })();
    return this.shutdownPromise;
  }
}

module.exports = {
  CapabilityExecutionService,
  normalizeAdapterResult,
};
