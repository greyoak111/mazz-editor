'use strict';

const contract = require('./library-resource-contract');

const DESCRIPTOR_SCHEMA = 'mazz.library-source-adapter-descriptor/v1';
const PAGE_SCHEMA = 'mazz.library-source-page/v1';
const HEALTH_SCHEMA = 'mazz.library-source-health/v1';
const CAPABILITIES = Object.freeze(['search', 'discover', 'resolve', 'health']);
const HEALTH_STATES = Object.freeze(['ready', 'degraded', 'offline']);

function codedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function plainRecord(value, label, fields, options = {}) {
  if (!isPlainRecord(value)) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 必须是普通对象`);
  const unknown = Object.keys(value).filter(key => !fields.includes(key));
  if (unknown.length) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 含未知字段：${unknown.join(',')}`);
  if (options.scanSecrets !== false) contract.assertNoSecrets(value, label);
  return value;
}

function exactString(value, label, { optional = false } = {}) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && value.length === 0)) {
    throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 必须是原生非空字符串`);
  }
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 不得含边界空白或控制字符`);
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function opaqueId(value, label) {
  const text = exactString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 必须是稳定 opaque identity`);
  }
  return text;
}

function iso(value, label) {
  const text = exactString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 必须是 ISO 时间`);
  return new Date(timestamp).toISOString();
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date());
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_SOURCE_CLOCK_INVALID', 'Source registry clock 非法');
  return new Date(timestamp).toISOString();
}

function uniqueExactStrings(value, label, { allowed } = {}) {
  if (!Array.isArray(value)) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 必须是数组`);
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = exactString(value[index], `${label}[${index}]`);
    if (allowed && !allowed.includes(item)) {
      throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label}[${index}] 非法`);
    }
    if (seen.has(item)) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', `${label} 不得重复`);
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result.sort((left, right) => left.localeCompare(right, 'en')));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeDescriptor(input, options = {}) {
  plainRecord(input, 'SourceAdapter descriptor', [
    'schema', 'providerId', 'displayName', 'adapterVersion', 'capabilities', 'policy',
  ]);
  if (input.schema !== DESCRIPTOR_SCHEMA) {
    throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'SourceAdapter descriptor schema 非法');
  }
  const policy = plainRecord(input.policy, 'SourceAdapter policy', [
    'policyVersion', 'checkedAt', 'jurisdictions', 'rightsModes', 'termsUrl', 'rightsUrl',
  ]);
  const checkedAt = iso(policy.checkedAt, 'policy.checkedAt');
  const current = nowIso(options.now);
  if (Date.parse(checkedAt) > Date.parse(current)) {
    throw codedError('LIBRARY_SOURCE_POLICY_FUTURE', 'SourceAdapter policy.checkedAt 不得晚于当前时间');
  }
  const termsUrl = policy.termsUrl === undefined || policy.termsUrl === ''
    ? '' : contract.assertHttpsPublicUrl(policy.termsUrl, 'policy.termsUrl');
  const rightsUrl = policy.rightsUrl === undefined || policy.rightsUrl === ''
    ? '' : contract.assertHttpsPublicUrl(policy.rightsUrl, 'policy.rightsUrl');
  return deepFreeze({
    schema: DESCRIPTOR_SCHEMA,
    providerId: opaqueId(input.providerId, 'providerId'),
    displayName: exactString(input.displayName, 'displayName'),
    adapterVersion: opaqueId(input.adapterVersion, 'adapterVersion'),
    capabilities: uniqueExactStrings(input.capabilities, 'capabilities', { allowed: CAPABILITIES }),
    policy: {
      policyVersion: opaqueId(policy.policyVersion, 'policy.policyVersion'),
      checkedAt,
      jurisdictions: uniqueExactStrings(policy.jurisdictions, 'policy.jurisdictions'),
      rightsModes: uniqueExactStrings(policy.rightsModes, 'policy.rightsModes', {
        allowed: contract.RIGHTS_STATUSES,
      }),
      termsUrl,
      rightsUrl,
    },
  });
}

function assertCandidateBinding(candidateInput, descriptorInput, options = {}) {
  const descriptor = descriptorInput?.schema === DESCRIPTOR_SCHEMA
    ? normalizeDescriptor(descriptorInput, options)
    : normalizeDescriptor(descriptorInput, options);
  const candidate = contract.normalizeCandidate(candidateInput);
  for (const offer of candidate.offers) {
    if (offer.providerId !== descriptor.providerId) {
      throw codedError('LIBRARY_SOURCE_PROVIDER_MISMATCH', 'Candidate Offer 不属于当前 SourceAdapter');
    }
  }
  for (const provenance of candidate.provenance) {
    if (provenance.providerId !== descriptor.providerId
      || provenance.adapterVersion !== descriptor.adapterVersion) {
      throw codedError('LIBRARY_SOURCE_PROVIDER_MISMATCH', 'Candidate provenance 与当前 SourceAdapter 不一致');
    }
  }
  return candidate;
}

function normalizePage(input, descriptor, options = {}) {
  plainRecord(input, 'SourceAdapter page', [
    'schema', 'providerId', 'adapterVersion', 'policyVersion', 'candidates', 'nextCursor',
  ]);
  if (input.schema !== PAGE_SCHEMA) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'SourceAdapter page schema 非法');
  if (input.providerId !== descriptor.providerId
    || input.adapterVersion !== descriptor.adapterVersion
    || input.policyVersion !== descriptor.policy.policyVersion) {
    throw codedError('LIBRARY_SOURCE_SNAPSHOT_DRIFT', 'SourceAdapter page 与冻结 descriptor 不一致');
  }
  if (!Array.isArray(input.candidates)) {
    throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'SourceAdapter page.candidates 必须是数组');
  }
  const candidates = [];
  const fingerprints = new Map();
  for (const raw of input.candidates) {
    const candidate = assertCandidateBinding(raw, descriptor, options);
    const fingerprint = contract.deriveCandidateFingerprint(candidate);
    const previous = fingerprints.get(candidate.candidateId);
    if (previous && previous !== fingerprint) {
      throw codedError('LIBRARY_SOURCE_CANDIDATE_CONFLICT', '同一 candidateId 返回了不同内容');
    }
    if (!previous) {
      fingerprints.set(candidate.candidateId, fingerprint);
      candidates.push(candidate);
    }
  }
  let nextCursor = null;
  if (input.nextCursor !== null && input.nextCursor !== undefined) {
    nextCursor = exactString(input.nextCursor, 'nextCursor');
  }
  return deepFreeze({
    schema: PAGE_SCHEMA,
    providerId: descriptor.providerId,
    adapterVersion: descriptor.adapterVersion,
    policyVersion: descriptor.policy.policyVersion,
    candidates,
    nextCursor,
  });
}

function normalizeHealth(input, descriptor, options = {}) {
  plainRecord(input, 'SourceAdapter health', [
    'schema', 'providerId', 'adapterVersion', 'policyVersion', 'status', 'checkedAt', 'code',
  ]);
  if (input.schema !== HEALTH_SCHEMA) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'SourceAdapter health schema 非法');
  if (input.providerId !== descriptor.providerId
    || input.adapterVersion !== descriptor.adapterVersion
    || input.policyVersion !== descriptor.policy.policyVersion) {
    throw codedError('LIBRARY_SOURCE_SNAPSHOT_DRIFT', 'SourceAdapter health 与冻结 descriptor 不一致');
  }
  const status = exactString(input.status, 'health.status');
  if (!HEALTH_STATES.includes(status)) throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'health.status 非法');
  const checkedAt = iso(input.checkedAt, 'health.checkedAt');
  if (Date.parse(checkedAt) > Date.parse(nowIso(options.now))) {
    throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'health.checkedAt 不得晚于当前时间');
  }
  const code = input.code === undefined || input.code === '' ? '' : opaqueId(input.code, 'health.code');
  return deepFreeze({
    schema: HEALTH_SCHEMA,
    providerId: descriptor.providerId,
    adapterVersion: descriptor.adapterVersion,
    policyVersion: descriptor.policy.policyVersion,
    status,
    checkedAt,
    code,
  });
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw codedError('LIBRARY_SOURCE_ABORTED', 'SourceAdapter 调用已取消');
}

class LibrarySourceRegistry {
  constructor(options = {}) {
    this.now = options.now;
    this.entries = new Map();
    this.healthFacts = new Map();
    this.closed = false;
    this.activeCalls = 0;
  }

  _assertOpen() {
    if (this.closed) throw codedError('LIBRARY_SOURCE_REGISTRY_CLOSED', 'Source registry 已关闭');
  }

  register(adapter) {
    this._assertOpen();
    if (!adapter || typeof adapter !== 'object' || typeof adapter.descriptor !== 'function') {
      throw codedError('LIBRARY_SOURCE_ADAPTER_INVALID', 'SourceAdapter 必须提供 descriptor()');
    }
    const descriptor = normalizeDescriptor(adapter.descriptor(), { now: this.now });
    for (const capability of descriptor.capabilities) {
      if (typeof adapter[capability] !== 'function') {
        throw codedError('LIBRARY_SOURCE_ADAPTER_INVALID', `SourceAdapter 缺少 ${capability}()`);
      }
    }
    const existing = this.entries.get(descriptor.providerId);
    if (existing) {
      if (existing.adapter === adapter
        && contract.stableJson(existing.descriptor) === contract.stableJson(descriptor)) {
        return existing.descriptor;
      }
      throw codedError('LIBRARY_SOURCE_PROVIDER_CONFLICT', 'providerId 已被另一 SourceAdapter 注册');
    }
    this.entries.set(descriptor.providerId, { adapter, descriptor });
    return descriptor;
  }

  unregister(providerId) {
    this._assertOpen();
    return this.entries.delete(opaqueId(providerId, 'providerId'));
  }

  descriptors() {
    this._assertOpen();
    return Object.freeze([...this.entries.values()]
      .map(entry => entry.descriptor)
      .sort((left, right) => left.providerId.localeCompare(right.providerId, 'en')));
  }

  descriptor(providerId) {
    this._assertOpen();
    const entry = this.entries.get(opaqueId(providerId, 'providerId'));
    if (!entry) throw codedError('LIBRARY_SOURCE_NOT_FOUND', 'SourceAdapter 未注册');
    return entry.descriptor;
  }

  async _call(providerId, capability, request, signal) {
    this._assertOpen();
    abortIfNeeded(signal);
    const id = opaqueId(providerId, 'providerId');
    const entry = this.entries.get(id);
    if (!entry) throw codedError('LIBRARY_SOURCE_NOT_FOUND', 'SourceAdapter 未注册');
    if (!entry.descriptor.capabilities.includes(capability) || typeof entry.adapter[capability] !== 'function') {
      throw codedError('LIBRARY_SOURCE_CAPABILITY_UNAVAILABLE', `${id} 不支持 ${capability}`);
    }
    const before = contract.stableJson(entry.descriptor);
    this.activeCalls += 1;
    try {
      const raw = await entry.adapter[capability](deepFreeze(request), { signal });
      abortIfNeeded(signal);
      const after = normalizeDescriptor(entry.adapter.descriptor(), { now: this.now });
      if (contract.stableJson(after) !== before) {
        throw codedError('LIBRARY_SOURCE_SNAPSHOT_DRIFT', 'SourceAdapter descriptor 在调用中发生变化');
      }
      return { raw, descriptor: entry.descriptor };
    } catch (error) {
      this.healthFacts.set(id, deepFreeze({
        schema: HEALTH_SCHEMA,
        providerId: id,
        adapterVersion: entry.descriptor.adapterVersion,
        policyVersion: entry.descriptor.policy.policyVersion,
        status: 'offline',
        checkedAt: nowIso(this.now),
        code: error?.code && /^[A-Z][A-Z0-9_.-]*$/.test(error.code) ? error.code : 'ADAPTER_ERROR',
      }));
      throw error;
    } finally {
      this.activeCalls -= 1;
    }
  }

  async search(providerId, options = {}) {
    plainRecord(options, 'search options', ['query', 'cursor', 'signal'], { scanSecrets: false });
    const query = exactString(options.query, 'search.query');
    const cursor = options.cursor == null ? null : exactString(options.cursor, 'search.cursor');
    const { raw, descriptor } = await this._call(providerId, 'search', { query, cursor }, options.signal);
    return normalizePage(raw, descriptor, { now: this.now });
  }

  async discover(providerId, options = {}) {
    plainRecord(options, 'discover options', ['cursor', 'signal'], { scanSecrets: false });
    const cursor = options.cursor == null ? null : exactString(options.cursor, 'discover.cursor');
    const { raw, descriptor } = await this._call(providerId, 'discover', { cursor }, options.signal);
    return normalizePage(raw, descriptor, { now: this.now });
  }

  async resolve(providerId, options = {}) {
    plainRecord(options, 'resolve options', ['resourceId', 'signal'], { scanSecrets: false });
    const resourceId = opaqueId(options.resourceId, 'resolve.resourceId');
    const { raw, descriptor } = await this._call(providerId, 'resolve', { resourceId }, options.signal);
    const page = normalizePage(raw, descriptor, { now: this.now });
    if (page.candidates.length !== 1) {
      throw codedError('LIBRARY_SOURCE_RESOLVE_CARDINALITY', 'resolve 必须精确返回一个 Candidate');
    }
    return page.candidates[0];
  }

  async health(providerId, options = {}) {
    plainRecord(options, 'health options', ['signal'], { scanSecrets: false });
    const { raw, descriptor } = await this._call(providerId, 'health', {}, options.signal);
    const fact = normalizeHealth(raw, descriptor, { now: this.now });
    this.healthFacts.set(descriptor.providerId, fact);
    return fact;
  }

  lastHealth(providerId) {
    const id = opaqueId(providerId, 'providerId');
    return this.healthFacts.get(id) || null;
  }

  async collect(providerId, method, options = {}) {
    plainRecord(options, 'collect options', ['query', 'cursor', 'signal'], { scanSecrets: false });
    if (!['search', 'discover'].includes(method)) {
      throw codedError('LIBRARY_SOURCE_CAPABILITY_UNAVAILABLE', 'collect 仅支持 search/discover');
    }
    const seenCursors = new Set();
    const candidates = new Map();
    let cursor = options.cursor ?? null;
    if (cursor !== null) seenCursors.add(exactString(cursor, 'collect.cursor'));
    while (true) {
      abortIfNeeded(options.signal);
      const page = method === 'search'
        ? await this.search(providerId, { query: options.query, cursor, signal: options.signal })
        : await this.discover(providerId, { cursor, signal: options.signal });
      for (const candidate of page.candidates) {
        const fingerprint = contract.deriveCandidateFingerprint(candidate);
        const existing = candidates.get(candidate.candidateId);
        if (existing && existing.fingerprint !== fingerprint) {
          throw codedError('LIBRARY_SOURCE_CANDIDATE_CONFLICT', '跨页 candidateId 内容冲突');
        }
        if (!existing) candidates.set(candidate.candidateId, { candidate, fingerprint });
      }
      if (page.nextCursor === null || seenCursors.has(page.nextCursor)) break;
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    return Object.freeze([...candidates.values()]
      .map(item => item.candidate)
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en')));
  }

  snapshot() {
    return Object.freeze({
      closed: this.closed,
      registeredCount: this.entries.size,
      activeCalls: this.activeCalls,
      timerCount: 0,
      listenerCount: 0,
      networkOwnerCount: 0,
    });
  }

  close() {
    if (this.activeCalls !== 0) {
      throw codedError('LIBRARY_SOURCE_BUSY', 'Source registry 仍有活动调用，必须先取消并等待收敛');
    }
    this.closed = true;
    this.entries.clear();
    this.healthFacts.clear();
    return this.snapshot();
  }
}

function pageFor(descriptor, candidates, nextCursor = null) {
  return {
    schema: PAGE_SCHEMA,
    providerId: descriptor.providerId,
    adapterVersion: descriptor.adapterVersion,
    policyVersion: descriptor.policy.policyVersion,
    candidates,
    nextCursor,
  };
}

class FixtureLibrarySourceAdapter {
  constructor(options = {}) {
    plainRecord(options, 'FixtureLibrarySourceAdapter options', [
      'descriptor', 'searchPages', 'discoverPages', 'resolved', 'health', 'now',
    ], { scanSecrets: false });
    this._descriptor = normalizeDescriptor(options.descriptor, { now: options.now });
    if (options.searchPages !== undefined && !Array.isArray(options.searchPages)) {
      throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'searchPages 必须是数组');
    }
    if (options.discoverPages !== undefined && !Array.isArray(options.discoverPages)) {
      throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'discoverPages 必须是数组');
    }
    if (options.resolved !== undefined && !isPlainRecord(options.resolved)) {
      throw codedError('LIBRARY_SOURCE_SCHEMA_INVALID', 'resolved 必须是普通对象');
    }
    this.searchPages = options.searchPages || [];
    this.discoverPages = options.discoverPages || [];
    this.resolved = options.resolved || {};
    this.healthResult = options.health || {
      schema: HEALTH_SCHEMA,
      providerId: this._descriptor.providerId,
      adapterVersion: this._descriptor.adapterVersion,
      policyVersion: this._descriptor.policy.policyVersion,
      status: 'ready',
      checkedAt: this._descriptor.policy.checkedAt,
      code: '',
    };
    this.calls = { search: 0, discover: 0, resolve: 0, health: 0, network: 0 };
  }

  descriptor() { return this._descriptor; }

  _page(pages, cursor) {
    if (cursor === null) return pages[0] || pageFor(this._descriptor, [], null);
    const previousIndex = pages.findIndex(page => page?.nextCursor === cursor);
    return pages[previousIndex + 1] || pageFor(this._descriptor, [], null);
  }

  search(request, { signal } = {}) {
    abortIfNeeded(signal);
    this.calls.search += 1;
    return this._page(this.searchPages, request.cursor);
  }

  discover(request, { signal } = {}) {
    abortIfNeeded(signal);
    this.calls.discover += 1;
    return this._page(this.discoverPages, request.cursor);
  }

  resolve(request, { signal } = {}) {
    abortIfNeeded(signal);
    this.calls.resolve += 1;
    const candidate = this.resolved[request.resourceId];
    return pageFor(this._descriptor, candidate ? [candidate] : [], null);
  }

  health(_request, { signal } = {}) {
    abortIfNeeded(signal);
    this.calls.health += 1;
    return this.healthResult;
  }

  snapshot() { return deepFreeze({ ...this.calls }); }
}

module.exports = {
  DESCRIPTOR_SCHEMA,
  PAGE_SCHEMA,
  HEALTH_SCHEMA,
  CAPABILITIES,
  HEALTH_STATES,
  normalizeDescriptor,
  normalizePage,
  normalizeHealth,
  assertCandidateBinding,
  LibrarySourceRegistry,
  FixtureLibrarySourceAdapter,
  _forTests: { exactString, opaqueId, pageFor, abortIfNeeded },
};
