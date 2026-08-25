'use strict';

const contract = require('./library-resource-contract');
const { LibrarySourceRegistry } = require('./library-source-registry');
const { LibrarySourceCheckpointStore } = require('./library-source-checkpoint-store');

function codedError(code, message, details) {
  return Object.assign(new Error(message), { code }, details || {});
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', label + ' 必须是原生精确字符串');
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function opaqueId(value, label) {
  const text = exactString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', label + ' 必须是 opaque identity');
  }
  return text;
}

function abortIfNeeded(signal) {
  if (signal && signal.aborted) throw codedError('LIBRARY_SOURCE_ABORTED', '联邦发现已取消');
}

function uniqueProviders(input, descriptors) {
  const available = new Set(descriptors.map(item => item.providerId));
  if (input === undefined) return descriptors.map(item => item.providerId);
  if (!Array.isArray(input)) throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'providers 必须是数组');
  const result = [];
  const seen = new Set();
  for (let index = 0; index < input.length; index += 1) {
    const id = opaqueId(input[index], 'providers[' + index + ']');
    if (!available.has(id)) throw codedError('LIBRARY_SOURCE_NOT_FOUND', '联邦发现包含未注册来源');
    if (seen.has(id)) throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'providers 不得重复');
    seen.add(id);
    result.push(id);
  }
  return result;
}

function continuationMap(input, selected) {
  if (input === undefined) return new Map();
  if (!Array.isArray(input)) throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'continuations 必须是数组');
  const allowed = new Set(selected);
  const result = new Map();
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!isPlainRecord(item) || Object.keys(item).some(key => !['providerId', 'cursorToken'].includes(key))) {
      throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'continuation 必须是严格对象');
    }
    const providerId = opaqueId(item.providerId, 'continuation.providerId');
    const cursorToken = opaqueId(item.cursorToken, 'continuation.cursorToken');
    if (!allowed.has(providerId) || result.has(providerId)) {
      throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'continuation 来源非法或重复');
    }
    result.set(providerId, cursorToken);
  }
  return result;
}

function failureCode(error) {
  return error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_.-]*$/.test(error.code)
    ? error.code : 'ADAPTER_ERROR';
}

class LibraryFederatedDiscovery {
  constructor(options) {
    const input = options || {};
    if (!isPlainRecord(input)) throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'options 必须是普通对象');
    const unknown = Object.keys(input).filter(key => !['registry', 'checkpointStore'].includes(key));
    if (unknown.length) throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'options 含未知字段');
    if (!(input.registry instanceof LibrarySourceRegistry)) {
      throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'registry 非法');
    }
    if (input.checkpointStore !== undefined
      && !(input.checkpointStore instanceof LibrarySourceCheckpointStore)) {
      throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'checkpointStore 非法');
    }
    this.registry = input.registry;
    this.checkpointStore = input.checkpointStore || null;
    this.closed = false;
    this.activeCalls = 0;
  }

  _assertOpen() {
    if (this.closed) throw codedError('LIBRARY_FEDERATED_DISCOVERY_CLOSED', '联邦发现已关闭');
  }

  _restoreContinuation(providerId, query, cursorToken, descriptor) {
    try {
      const current = this.registry.cursorRecord(providerId, cursorToken);
      if (current.cursorToken === cursorToken) return;
    } catch (error) {
      if (!this.checkpointStore) throw error;
    }
    const loaded = this.checkpointStore.load({
      providerId,
      adapterVersion: descriptor.adapterVersion,
      policyVersion: descriptor.policy.policyVersion,
      query,
    });
    if (loaded.status !== 'ready' || !loaded.record || loaded.record.cursorToken !== cursorToken) {
      throw codedError('LIBRARY_SOURCE_CURSOR_UNAVAILABLE', 'continuation 无可用的当前版本 durable checkpoint');
    }
    this.registry.restoreCursor(providerId, {
      cursorToken: loaded.record.cursorToken,
      nextUrl: loaded.record.nextUrl,
    });
  }

  _persistContinuation(providerId, query, nextCursor, descriptor) {
    if (!this.checkpointStore) return null;
    const loaded = this.checkpointStore.load({
      providerId,
      adapterVersion: descriptor.adapterVersion,
      policyVersion: descriptor.policy.policyVersion,
      query,
    });
    let cursorRecord = { cursorToken: null, nextUrl: '' };
    if (nextCursor !== null) cursorRecord = this.registry.cursorRecord(providerId, nextCursor);
    return this.checkpointStore.save({
      providerId,
      adapterVersion: descriptor.adapterVersion,
      policyVersion: descriptor.policy.policyVersion,
      query,
      cursorToken: cursorRecord.cursorToken,
      nextUrl: cursorRecord.nextUrl,
      expectedRevision: loaded.record ? loaded.record.revision : 0,
    });
  }

  async search(options) {
    this._assertOpen();
    const input = options || {};
    if (!isPlainRecord(input)) throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'search options 必须是普通对象');
    const unknown = Object.keys(input).filter(key => !['query', 'providers', 'continuations', 'signal'].includes(key));
    if (unknown.length) throw codedError('LIBRARY_FEDERATED_DISCOVERY_INVALID', 'search options 含未知字段');
    const query = exactString(input.query, 'query');
    const descriptors = this.registry.descriptors();
    const selected = uniqueProviders(input.providers, descriptors);
    const continuationByProvider = continuationMap(input.continuations, selected);
    const descriptorByProvider = new Map(descriptors.map(item => [item.providerId, item]));
    const candidates = new Map();
    const continuations = [];
    const failures = [];
    this.activeCalls += 1;
    try {
      for (const providerId of selected) {
        abortIfNeeded(input.signal);
        const descriptor = descriptorByProvider.get(providerId);
        const cursor = continuationByProvider.get(providerId) || null;
        try {
          if (cursor !== null) this._restoreContinuation(providerId, query, cursor, descriptor);
          const page = await this.registry.search(providerId, { query, cursor, signal: input.signal });
          for (const candidate of page.candidates) {
            const fingerprint = contract.deriveCandidateFingerprint(candidate);
            const existing = candidates.get(candidate.candidateId);
            if (existing && existing.fingerprint !== fingerprint) {
              throw codedError('LIBRARY_SOURCE_CANDIDATE_CONFLICT', '联邦页 candidateId 内容冲突');
            }
            if (!existing) candidates.set(candidate.candidateId, { candidate, fingerprint });
          }
          this._persistContinuation(providerId, query, page.nextCursor, descriptor);
          if (page.nextCursor !== null) {
            continuations.push(Object.freeze({ providerId, cursorToken: page.nextCursor }));
          }
        } catch (error) {
          if (error && error.code === 'LIBRARY_SOURCE_ABORTED') throw error;
          failures.push(Object.freeze({ providerId, code: failureCode(error) }));
        }
      }
      const orderedCandidates = [...candidates.values()]
        .map(item => item.candidate)
        .sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en'));
      const groups = new Map();
      for (const candidate of orderedCandidates) {
        const workId = candidate.work.workId;
        if (!groups.has(workId)) groups.set(workId, []);
        groups.get(workId).push(candidate);
      }
      return Object.freeze({
        query,
        candidates: Object.freeze(orderedCandidates),
        groups: Object.freeze([...groups.entries()]
          .map(([workId, members]) => Object.freeze({ workId, candidates: Object.freeze(members) }))
          .sort((left, right) => left.workId.localeCompare(right.workId, 'en'))),
        continuations: Object.freeze(continuations.sort((left, right) => left.providerId.localeCompare(right.providerId, 'en'))),
        failures: Object.freeze(failures.sort((left, right) => left.providerId.localeCompare(right.providerId, 'en'))),
      });
    } finally {
      this.activeCalls -= 1;
    }
  }

  snapshot() {
    return Object.freeze({
      closed: this.closed,
      activeCalls: this.activeCalls,
      timerCount: 0,
      listenerCount: 0,
      networkOwnerCount: 0,
    });
  }

  close() {
    if (this.activeCalls !== 0) throw codedError('LIBRARY_FEDERATED_DISCOVERY_BUSY', '联邦发现仍有活动调用');
    this.closed = true;
    return this.snapshot();
  }
}

module.exports = { LibraryFederatedDiscovery, _forTests: { uniqueProviders, continuationMap, failureCode } };
