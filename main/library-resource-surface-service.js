'use strict';

const crypto = require('crypto');
const path = require('path');
const contract = require('./library-resource-contract');
const source = require('./library-source-registry');
const rights = require('./library-rights-policy');
const { LibraryCatalogHttpClient } = require('./library-catalog-http-client');
const { LibrarySourceCheckpointStore } = require('./library-source-checkpoint-store');
const { LibraryFederatedDiscovery } = require('./library-federated-discovery');
const {
  GutenbergLibrarySourceAdapter,
  OpdsLibrarySourceAdapter,
  createManualHttpsCandidate,
} = require('./library-source-pack');
const { LibraryResourceCatalogStore } = require('./library-resource-catalog-store');

const CONFIG_SCHEMA = 'mazz.library-resource-surface-config/v1';
const CONFIG_KEY = 'libraryResourceSurface';
const ACTIONS = new Set(['pause', 'resume', 'retry', 'cancel']);
const TORRENT_PROVIDER_ID = 'manual-torrent';
const TORRENT_POLICY_CHECKED_AT = '2026-08-25T00:00:00.000Z';

function codedError(code, message, details) {
  return Object.assign(new Error(message), { code }, details || {});
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed, label) {
  if (!isPlainRecord(value) || Object.keys(value).some(key => !allowed.has(key))) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', `${label} 必须是严格普通对象`);
  }
  return value;
}

function exactString(value, label, { optional = false } = {}) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && !value) || value !== value.trim()
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', `${label} 必须是原生精确字符串`);
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function opaqueId(value, label) {
  const text = exactString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', `${label} 必须是 opaque identity`);
  }
  return text;
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_RESOURCE_SURFACE_CLOCK_INVALID', '资源服务 clock 非法');
  return new Date(timestamp).toISOString();
}

function validateContact(value) {
  const text = exactString(value, 'contact', { optional: true });
  if (!text) return '';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return text;
  try { return contract.assertHttpsPublicUrl(text, 'contact'); }
  catch { throw codedError('LIBRARY_RESOURCE_SURFACE_CONTACT_INVALID', 'contact 必须是 email 或公共 HTTPS URL'); }
}

function normalizeOpds(input, index) {
  exactKeys(input, new Set(['providerId', 'displayName', 'rootUrl', 'searchTemplate', 'version']), `opds[${index}]`);
  const providerId = opaqueId(input.providerId, `opds[${index}].providerId`);
  if (providerId === 'project-gutenberg' || providerId === 'manual-https') {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', '自定义 OPDS providerId 与内置来源冲突');
  }
  const version = exactString(input.version, `opds[${index}].version`);
  if (!['1.2', '2.0'].includes(version)) throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', 'OPDS version 非法');
  const rootUrl = contract.assertHttpsPublicUrl(exactString(input.rootUrl, `opds[${index}].rootUrl`), 'OPDS root URL');
  const searchTemplate = exactString(input.searchTemplate, `opds[${index}].searchTemplate`);
  if (!searchTemplate.includes('{query}') && !searchTemplate.includes('{?query}')) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', 'OPDS searchTemplate 必须含 {query} 或 {?query}');
  }
  const probe = searchTemplate.includes('{?query}')
    ? searchTemplate.replace('{?query}', '?query=probe') : searchTemplate.replace('{query}', 'probe');
  contract.assertHttpsPublicUrl(probe, 'OPDS searchTemplate');
  return Object.freeze({
    providerId,
    displayName: exactString(input.displayName, `opds[${index}].displayName`),
    rootUrl,
    searchTemplate,
    version,
  });
}

function normalizeConfig(input, { now } = {}) {
  if (input === undefined || input === null) input = {};
  exactKeys(input, new Set(['schema', 'contact', 'jurisdiction', 'opds']), 'resource config');
  if (input.schema !== undefined && input.schema !== CONFIG_SCHEMA) {
    throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', 'resource config schema 非法');
  }
  const jurisdiction = exactString(input.jurisdiction ?? '', 'jurisdiction', { optional: true });
  const list = input.opds === undefined ? [] : input.opds;
  if (!Array.isArray(list)) throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', 'opds 必须是数组');
  const seen = new Set();
  const opds = list.map((item, index) => {
    const normalized = normalizeOpds(item, index);
    if (seen.has(normalized.providerId)) throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', 'OPDS providerId 不得重复');
    seen.add(normalized.providerId);
    return normalized;
  });
  return Object.freeze({
    schema: CONFIG_SCHEMA,
    contact: validateContact(input.contact ?? ''),
    jurisdiction,
    opds: Object.freeze(opds),
  });
}

function descriptorForManual(at) {
  return source.normalizeDescriptor({
    schema: source.DESCRIPTOR_SCHEMA,
    providerId: 'manual-https',
    displayName: '手动 HTTPS',
    adapterVersion: 'manual-https-v1',
    capabilities: [],
    policy: {
      policyVersion: 'manual-rights-v1',
      checkedAt: at,
      jurisdictions: ['unspecified'],
      rightsModes: ['unknown'],
      termsUrl: '',
      rightsUrl: '',
    },
  }, { now: at });
}

function descriptorForTorrent(jurisdiction) {
  return source.normalizeDescriptor({
    schema: source.DESCRIPTOR_SCHEMA,
    providerId: TORRENT_PROVIDER_ID,
    displayName: '手动 Torrent',
    adapterVersion: 'manual-torrent-v1',
    capabilities: [],
    policy: {
      policyVersion: 'manual-torrent-user-owned-v1',
      checkedAt: TORRENT_POLICY_CHECKED_AT,
      jurisdictions: [jurisdiction],
      rightsModes: ['user-owned'],
      termsUrl: '',
      rightsUrl: '',
    },
  }, { now: TORRENT_POLICY_CHECKED_AT });
}

function torrentCandidateFromInspection(inspection, {
  jurisdiction,
  observedAt,
  snapshotId,
} = {}) {
  const infoHash = contract.normalizeInfoHash(inspection.infoHash, 'torrent infoHash');
  if (!/^[a-f0-9]{40}$/.test(infoHash) || !Array.isArray(inspection.files) || !inspection.files.length) {
    throw codedError('LIBRARY_RESOURCE_TORRENT_METADATA_INVALID', 'Torrent metadata did not pass the resource contract');
  }
  const title = typeof inspection.title === 'string'
    ? inspection.title.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    : '';
  if (/\b(?:https?|file|data|magnet|urn):/i.test(title)
    || /[A-Za-z]:[\\/]/.test(title) || /\\\\[^\\/]+[\\/]/.test(title)
    || /^\/(?:[^/]+\/)+/.test(title)) {
    throw codedError('LIBRARY_RESOURCE_TORRENT_METADATA_INVALID', 'Torrent title contains a non-display transport or path coordinate');
  }
  const providerId = TORRENT_PROVIDER_ID;
  const torrentResourceId = `torrent-${infoHash}`;
  const work = {
    workId: contract.deriveWorkId({ identifiers: {}, providerId, resourceId: torrentResourceId }),
    title: title || 'Torrent book',
    authors: [],
    languages: [],
    subjects: [],
    identifiers: {},
  };
  const editions = [];
  const offers = [];
  for (const [index, item] of inspection.files.entries()) {
    if (!item || Object.getPrototypeOf(item) !== Object.prototype
      || typeof item.path !== 'string' || !Number.isSafeInteger(item.size) || item.size < 0
      || !contract.FORMATS.includes(item.format)) {
      throw codedError('LIBRARY_RESOURCE_TORRENT_METADATA_INVALID', `Torrent file ${index} is invalid`);
    }
    const selectedPath = contract.normalizeRelativePosixPath(item.path, `torrent files[${index}]`);
    if (selectedPath !== item.path || path.posix.extname(selectedPath).slice(1).toLowerCase() !== item.format) {
      throw codedError('LIBRARY_RESOURCE_TORRENT_METADATA_INVALID', `Torrent file ${index} is not canonical`);
    }
    const resourceId = `torrent-file-${crypto.createHash('sha256')
      .update(`${infoHash}\0${selectedPath}`, 'utf8').digest('hex')}`;
    const editionId = contract.deriveEditionId({ identifiers: {}, providerId, resourceId });
    const offer = {
      offerId: '',
      editionId,
      providerId,
      resourceId,
      format: item.format,
      transport: 'magnet',
      size: item.size,
      checksum: '',
      infoHash,
      sourceUrl: '',
      acquisitionRef: '',
      selectableFiles: [selectedPath],
    };
    offer.offerId = contract.deriveOfferId(offer);
    editions.push({
      editionId,
      title: path.posix.basename(selectedPath),
      language: '',
      publisher: '',
      publishedAt: '',
      identifiers: {},
      description: '',
    });
    offers.push(offer);
  }
  const snapshotMaterial = `${infoHash}\0${observedAt}\0${snapshotId}`;
  return contract.normalizeCandidate({
    schema: contract.CANDIDATE_SCHEMA,
    candidateId: `candidate-torrent-${crypto.createHash('sha256').update(snapshotMaterial, 'utf8').digest('hex')}`,
    work,
    editions,
    offers,
    rights: {
      status: 'user-owned',
      licenseId: '',
      rightsStatement: '',
      jurisdiction,
      evidenceUrl: '',
      assertedBy: '',
      checkedAt: TORRENT_POLICY_CHECKED_AT,
      confidence: null,
    },
    provenance: [{
      providerId,
      resourceId: torrentResourceId,
      pageUrl: '',
      observedAt,
      adapterVersion: 'manual-torrent-v1',
    }],
  });
}

function descriptorForOpds(config, at) {
  return {
    schema: source.DESCRIPTOR_SCHEMA,
    providerId: config.providerId,
    displayName: config.displayName,
    adapterVersion: `opds${config.version.replace('.', '')}-v1`,
    capabilities: ['discover', 'health', 'resolve', 'search'],
    policy: {
      policyVersion: 'generic-opds-unknown-v1',
      checkedAt: at,
      jurisdictions: ['unspecified'],
      rightsModes: ['unknown'],
      termsUrl: '',
      rightsUrl: '',
    },
  };
}

function candidateProjection(record) {
  const candidate = record.candidate;
  return Object.freeze({
    candidateId: candidate.candidateId,
    candidateFingerprint: record.candidateFingerprint,
    title: candidate.work.title,
    authors: Object.freeze([...candidate.work.authors]),
    languages: Object.freeze([...candidate.work.languages]),
    providerId: record.descriptor.providerId,
    providerName: record.descriptor.displayName,
    rights: Object.freeze({
      status: candidate.rights.status,
      jurisdiction: candidate.rights.jurisdiction,
      licenseId: candidate.rights.licenseId,
    }),
    editionCount: candidate.editions.length,
    offers: Object.freeze(candidate.offers.map(offer => Object.freeze({
      offerId: offer.offerId,
      editionId: offer.editionId,
      format: offer.format,
      transport: offer.transport,
      size: offer.size,
      selectableFileCount: offer.selectableFiles.length,
      selectableFiles: Object.freeze([...offer.selectableFiles]),
    }))),
  });
}

function candidateProjectionWithDecision(record, config, now) {
  const jurisdiction = config.jurisdiction || 'unspecified';
  const decision = rights.evaluateRights({
    candidate: record.candidate,
    descriptor: record.descriptor,
    jurisdiction,
    now: nowIso(now),
  });
  return Object.freeze({
    ...candidateProjection(record),
    decision: Object.freeze({
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
      jurisdiction: decision.jurisdiction,
    }),
  });
}

function jobProjection(job) {
  return Object.freeze({
    jobId: job.jobId,
    intentId: job.intentId,
    revision: job.revision,
    candidateId: job.candidateId,
    candidateFingerprint: job.candidateFingerprint,
    offerId: job.offerId,
    providerId: job.providerId,
    transport: job.transport,
    state: job.state,
    retryFrom: job.retryFrom,
    rightsStatus: job.rightsStatus,
    bytes: Object.freeze({ received: job.bytes.received, total: job.bytes.total }),
    integrity: Object.freeze({ verified: !!job.integrity.sha256, pieceVerified: job.integrity.pieceVerified === true }),
    errorCode: typeof job.error?.code === 'string' ? job.error.code : '',
    updatedAt: job.updatedAt,
  });
}

class LibraryResourceSurfaceService {
  constructor(options = {}) {
    exactKeys(options, new Set([
      'acquisitionService', 'settings', 'resolver', 'requester', 'productToken',
      'now', 'randomId', 'onChanged', 'catalogStoreFactory', 'checkpointStoreFactory',
      'torrentTransport',
    ]), 'LibraryResourceSurfaceService options');
    if (!options.acquisitionService || typeof options.acquisitionService.openWorkspace !== 'function') {
      throw new TypeError('LibraryResourceSurfaceService requires acquisitionService');
    }
    if (!options.settings || typeof options.settings.get !== 'function' || typeof options.settings.set !== 'function') {
      throw new TypeError('LibraryResourceSurfaceService requires settings');
    }
    if (typeof options.resolver !== 'function' || typeof options.requester !== 'function') {
      throw new TypeError('LibraryResourceSurfaceService requires resolver/requester');
    }
    this.acquisition = options.acquisitionService;
    this.torrentTransport = options.torrentTransport || null;
    this.settings = options.settings;
    this.resolver = options.resolver;
    this.requester = options.requester;
    this.productToken = options.productToken || 'Mazz-Editor/0.2.0';
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    this.randomId = typeof options.randomId === 'function'
      ? options.randomId : () => crypto.randomBytes(16).toString('hex');
    this.onChanged = typeof options.onChanged === 'function' ? options.onChanged : null;
    this.catalogStoreFactory = options.catalogStoreFactory
      || (input => new LibraryResourceCatalogStore(input));
    this.checkpointStoreFactory = options.checkpointStoreFactory
      || (input => new LibrarySourceCheckpointStore(input));
    this.contexts = new Map();
    this.operations = new Set();
    this.background = new Set();
    this.controllers = new Set();
    this.torrentInspectors = new Map();
    this.accepting = true;
  }

  config() {
    return normalizeConfig(this.settings.get(CONFIG_KEY, {}), { now: this.now });
  }

  configure(input) {
    if (!this.accepting) throw codedError('LIBRARY_RESOURCE_SURFACE_SHUTTING_DOWN', '资源服务正在停止');
    if (this.operations.size || this.background.size) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_BUSY', '资源请求正在执行，不能更改来源配置');
    }
    const normalized = normalizeConfig(input, { now: this.now });
    for (const context of this.contexts.values()) this._closeContext(context);
    this.contexts.clear();
    this.settings.set(CONFIG_KEY, JSON.parse(JSON.stringify(normalized)));
    this._wake('configured');
    return normalized;
  }

  async _workspace(workspacePath) {
    if (!this.accepting) throw codedError('LIBRARY_RESOURCE_SURFACE_SHUTTING_DOWN', '资源服务正在停止');
    if (typeof workspacePath !== 'string' || !workspacePath || workspacePath !== workspacePath.trim()) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_WORKSPACE_INVALID', 'Workspace path 非法');
    }
    const opened = this.acquisition.openWorkspace(path.resolve(workspacePath));
    await this.acquisition.ensureWorkspaceRecovery(opened);
    let context = this.contexts.get(opened.workspaceIdentity);
    if (context) return context;
    const catalog = this.catalogStoreFactory({ workspacePath: path.resolve(workspacePath), now: this.now });
    if (catalog.workspaceIdentity !== opened.workspaceIdentity) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_WORKSPACE_MISMATCH', 'Candidate catalog 与 Acquisition Workspace 不一致');
    }
    const checkpoints = this.checkpointStoreFactory({ acquisitionStore: catalog.owner, now: this.now });
    context = {
      workspacePath: catalog.owner.workspacePath,
      workspaceIdentity: opened.workspaceIdentity,
      workspaceToken: opened.workspaceToken,
      catalog,
      checkpoints,
      registry: null,
      discovery: null,
      client: null,
      descriptors: new Map(),
    };
    this._buildSources(context);
    this.contexts.set(opened.workspaceIdentity, context);
    return context;
  }

  _buildSources(context) {
    const config = this.config();
    context.descriptors.set('manual-https', descriptorForManual(nowIso(this.now)));
    context.descriptors.set(TORRENT_PROVIDER_ID, descriptorForTorrent(config.jurisdiction || 'unspecified'));
    if (!config.contact) return;
    const client = new LibraryCatalogHttpClient({
      resolver: this.resolver,
      requester: this.requester,
      productToken: this.productToken,
      contact: config.contact,
      now: () => new Date(this.now()).getTime(),
    });
    const registry = new source.LibrarySourceRegistry({ now: this.now });
    const gutenberg = new GutenbergLibrarySourceAdapter({
      client,
      now: this.now,
      policyCheckedAt: this.now,
    });
    const descriptor = registry.register(gutenberg);
    context.descriptors.set(descriptor.providerId, descriptor);
    for (const opds of config.opds) {
      const adapter = new OpdsLibrarySourceAdapter({
        descriptor: descriptorForOpds(opds, nowIso(this.now)),
        client,
        rootUrl: opds.rootUrl,
        searchTemplate: opds.searchTemplate,
        version: opds.version,
        paginationMode: 'user-driven',
        minIntervalMs: 0,
        rightsMode: 'unknown',
        now: this.now,
      });
      const customDescriptor = registry.register(adapter);
      context.descriptors.set(customDescriptor.providerId, customDescriptor);
    }
    context.client = client;
    context.registry = registry;
    context.discovery = new LibraryFederatedDiscovery({ registry, checkpointStore: context.checkpoints });
  }

  _closeContext(context) {
    context.discovery?.close();
    context.registry?.close();
    context.client?.close();
    context.checkpoints?.close();
    context.catalog?.close();
  }

  _track(operation) {
    const task = Promise.resolve(operation);
    this.operations.add(task);
    task.finally(() => this.operations.delete(task)).catch(() => {});
    return task;
  }

  _background(operation) {
    const task = Promise.resolve(operation);
    this.background.add(task);
    task.finally(() => {
      this.background.delete(task);
      this._wake('acquisition-settled');
    }).catch(() => {});
    return task;
  }

  _wake(reason) {
    if (!this.onChanged) return;
    try {
      const result = this.onChanged(Object.freeze({ reason }));
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
    } catch {}
  }

  async snapshot(workspacePath) {
    const context = await this._workspace(workspacePath);
    const config = this.config();
    const candidates = context.catalog.list().map(record => candidateProjectionWithDecision(record, config, this.now));
    const jobs = this.acquisition.listJobs(context.workspaceIdentity).map(jobProjection);
    const pendingInbox = this.acquisition.listInbox(context.workspaceIdentity, { state: 'pending' }).receipts.length;
    return Object.freeze({
      workspaceIdentity: context.workspaceIdentity,
      contactConfigured: !!config.contact,
      jurisdiction: config.jurisdiction,
      configuration: Object.freeze({
        contact: config.contact,
        jurisdiction: config.jurisdiction,
        opds: Object.freeze(config.opds.map(item => Object.freeze({
          providerId: item.providerId,
          displayName: item.displayName,
          rootUrl: item.rootUrl,
          searchTemplate: item.searchTemplate,
          version: item.version,
        }))),
      }),
      providers: Object.freeze([
        Object.freeze({ providerId: 'project-gutenberg', displayName: 'Project Gutenberg', configured: !!config.contact }),
        ...config.opds.map(item => Object.freeze({ providerId: item.providerId, displayName: item.displayName, configured: !!config.contact })),
      ]),
      candidates: Object.freeze(candidates),
      jobs: Object.freeze(jobs),
      pendingInbox,
      corruptions: Object.freeze({
        candidates: context.catalog.listCorruptions().map(item => Object.freeze({ code: item.code })),
        checkpoints: context.checkpoints.listCorruptions().map(item => Object.freeze({ code: item.code })),
      }),
      resource: Object.freeze({
        discoveryActive: context.discovery?.snapshot().activeCalls || 0,
        catalogActive: context.client?.snapshot().activeRequests || 0,
        backgroundActive: this.background.size,
      }),
    });
  }

  async search(workspacePath, input, { signal } = {}) {
    exactKeys(input, new Set(['query', 'providers', 'continuations']), 'resource search');
    const context = await this._workspace(workspacePath);
    if (!context.discovery) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_CONTACT_REQUIRED', '先设置 catalog contact，才会发起来源请求');
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const page = await this._track(context.discovery.search({
        query: input.query,
        providers: input.providers,
        continuations: input.continuations,
        signal: controller.signal,
      }));
      const projected = [];
      for (const candidate of page.candidates) {
        const providerId = candidate.offers[0]?.providerId;
        const descriptor = context.descriptors.get(providerId);
        if (!descriptor) throw codedError('LIBRARY_RESOURCE_SURFACE_PROVIDER_MISSING', 'Candidate 来源未注册');
        const stored = context.catalog.put(candidate, descriptor).record;
        projected.push(candidateProjectionWithDecision(stored, this.config(), this.now));
      }
      return Object.freeze({
        query: page.query,
        candidates: Object.freeze(projected),
        continuations: page.continuations,
        failures: page.failures,
      });
    } finally {
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(controller);
    }
  }

  async addManual(workspacePath, input) {
    exactKeys(input, new Set(['url', 'format', 'title', 'authors', 'language']), 'manual candidate');
    const context = await this._workspace(workspacePath);
    const candidate = createManualHttpsCandidate({ ...input, observedAt: this.now });
    const descriptor = context.descriptors.get('manual-https');
    return candidateProjectionWithDecision(
      context.catalog.put(candidate, descriptor).record,
      this.config(),
      this.now,
    );
  }

  async inspectTorrent(workspacePath, input, { signal } = {}) {
    exactKeys(input, new Set(['inspectionId', 'magnet', 'p2pConsent']), 'torrent inspect');
    if (input.p2pConsent !== true) {
      throw codedError('LIBRARY_TORRENT_P2P_CONSENT_REQUIRED', '检查 Torrent 前必须明确同意 P2P 网络暴露');
    }
    if (!this.torrentTransport || typeof this.torrentTransport.inspect !== 'function') {
      throw codedError('LIBRARY_RESOURCE_TORRENT_UNAVAILABLE', 'Torrent transport 尚未装配');
    }
    const context = await this._workspace(workspacePath);
    const inspectionId = opaqueId(input.inspectionId, 'inspectionId');
    const inspectionKey = `${context.workspaceIdentity}:${inspectionId}`;
    if (this.torrentInspectors.has(inspectionKey)) {
      throw codedError('LIBRARY_RESOURCE_TORRENT_BUSY', '同一 Torrent 检查已在执行');
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    this.torrentInspectors.set(inspectionKey, controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const inspection = await this._track(this.torrentTransport.inspect({
        magnet: exactString(input.magnet, 'magnet'),
        p2pConsent: true,
        signal: controller.signal,
      }));
      const observedAt = nowIso(this.now);
      const config = this.config();
      const jurisdiction = config.jurisdiction || 'unspecified';
      const candidate = torrentCandidateFromInspection(inspection, {
        jurisdiction,
        observedAt,
        snapshotId: this.randomId(),
      });
      const descriptor = context.descriptors.get(TORRENT_PROVIDER_ID);
      const record = context.catalog.put(candidate, descriptor).record;
      this._wake('torrent-inspected');
      return candidateProjectionWithDecision(record, config, this.now);
    } finally {
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(controller);
      this.torrentInspectors.delete(inspectionKey);
    }
  }

  async cancelTorrentInspect(workspacePath, input) {
    exactKeys(input, new Set(['inspectionId']), 'torrent inspect cancel');
    const context = await this._workspace(workspacePath);
    const inspectionId = opaqueId(input.inspectionId, 'inspectionId');
    const controller = this.torrentInspectors.get(`${context.workspaceIdentity}:${inspectionId}`);
    if (controller) controller.abort();
    return Object.freeze({ cancelled: Boolean(controller) });
  }

  async acquireTorrent(workspacePath, input) {
    exactKeys(input, new Set([
      'candidateId', 'candidateFingerprint', 'offerId', 'selectedFile', 'intentId',
      'p2pConsent', 'rightsConfirmed',
    ]), 'torrent acquire');
    if (input.p2pConsent !== true || input.rightsConfirmed !== true) {
      throw codedError(
        'LIBRARY_TORRENT_CONFIRMATION_REQUIRED',
        'Torrent 取得需要当次 P2P 知情确认和自有/获准取得声明',
      );
    }
    const context = await this._workspace(workspacePath);
    const record = context.catalog.get(
      opaqueId(input.candidateId, 'candidateId'),
      exactString(input.candidateFingerprint, 'candidateFingerprint'),
    );
    if (!record || record.descriptor.providerId !== TORRENT_PROVIDER_ID) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_CANDIDATE_NOT_FOUND', 'Torrent Candidate 不存在或已变化');
    }
    const offerId = opaqueId(input.offerId, 'offerId');
    const offer = record.candidate.offers.find(item => item.offerId === offerId);
    const selectedFile = exactString(input.selectedFile, 'selectedFile');
    if (!offer || offer.transport !== 'magnet' || offer.selectableFiles.length !== 1
      || offer.selectableFiles[0] !== selectedFile) {
      throw codedError('LIBRARY_ACQUISITION_SELECTION_INVALID', '所选书文件不属于冻结的 Torrent 目录');
    }
    const intentId = input.intentId === undefined
      ? `intent-${this.randomId()}` : opaqueId(input.intentId, 'intentId');
    const at = nowIso(this.now);
    const jurisdiction = this.config().jurisdiction || 'unspecified';
    const userAssertion = {
      schema: rights.USER_ASSERTION_SCHEMA,
      authority: 'user',
      candidateFingerprint: record.candidateFingerprint,
      jurisdiction,
      declarationId: `declaration-${this.randomId()}`,
      confirmedAt: at,
    };
    const decision = rights.evaluateRights({
      candidate: record.candidate,
      descriptor: record.descriptor,
      jurisdiction,
      userAssertion,
      now: at,
    });
    if (decision.outcome !== 'pass') {
      throw codedError('LIBRARY_RIGHTS_REQUIRED', 'Torrent Candidate 未通过明确的 Rights 裁决');
    }
    const job = rights.prepareAcquisitionJob({
      jobId: `job-${this.randomId()}`,
      intentId,
      workspaceIdentity: context.workspaceIdentity,
      workspacePath: context.workspacePath,
      candidate: record.candidate,
      offerId,
      descriptor: record.descriptor,
      jurisdiction,
      userAssertion,
      decision,
      selectedFiles: [],
      createdAt: at,
    });
    const created = this.acquisition.createJob(context.workspaceIdentity, job, { candidate: record.candidate });
    let durable = created?.job || created;
    if (durable.state === 'awaiting-selection') {
      durable = this.acquisition.finalizeSelection(context.workspaceIdentity, durable.jobId, {
        expectedRevision: durable.revision,
        candidate: record.candidate,
        selectedFiles: [selectedFile],
      });
    } else if (durable.selectedFiles.length !== 1 || durable.selectedFiles[0] !== selectedFile) {
      throw codedError('LIBRARY_ACQUISITION_SELECTION_CONFLICT', '同一 intent 已绑定另一 Torrent 文件');
    }
    if (durable.state === 'queued') {
      try {
        this._background(this.acquisition.startTorrent(context.workspaceIdentity, durable.jobId, {
          expectedRevision: durable.revision,
          candidate: record.candidate,
          p2pConsent: true,
        }));
      } catch (error) {
        if (error?.code !== 'LIBRARY_ACQUISITION_BUSY') throw error;
      }
    }
    this._wake('torrent-acquisition-created');
    return Object.freeze({ decision, job: jobProjection(durable) });
  }

  async acquire(workspacePath, input) {
    exactKeys(input, new Set(['candidateId', 'candidateFingerprint', 'offerId', 'intentId']), 'resource acquire');
    const context = await this._workspace(workspacePath);
    const record = context.catalog.get(
      opaqueId(input.candidateId, 'candidateId'),
      exactString(input.candidateFingerprint, 'candidateFingerprint'),
    );
    if (!record) throw codedError('LIBRARY_RESOURCE_SURFACE_CANDIDATE_NOT_FOUND', 'Candidate 不存在或尚未持久化');
    const offerId = opaqueId(input.offerId, 'offerId');
    const intentId = input.intentId === undefined
      ? `intent-${this.randomId()}` : opaqueId(input.intentId, 'intentId');
    const at = nowIso(this.now);
    const config = this.config();
    const jurisdiction = config.jurisdiction || 'unspecified';
    const decision = rights.evaluateRights({
      candidate: record.candidate,
      descriptor: record.descriptor,
      jurisdiction,
      now: at,
    });
    const job = rights.prepareAcquisitionJob({
      jobId: `job-${this.randomId()}`,
      intentId,
      workspaceIdentity: context.workspaceIdentity,
      workspacePath: context.workspacePath,
      candidate: record.candidate,
      offerId,
      descriptor: record.descriptor,
      jurisdiction,
      decision,
      selectedFiles: [],
      createdAt: at,
    });
    const created = this.acquisition.createJob(context.workspaceIdentity, job, { candidate: record.candidate });
    const durable = created?.job || created;
    if (durable.state === 'queued' && durable.transport === 'https') {
      try {
        this._background(this.acquisition.startHttp(context.workspaceIdentity, durable.jobId, {
          expectedRevision: durable.revision,
          candidate: record.candidate,
        }));
      } catch (error) {
        this._wake('acquisition-start-failed');
        throw error;
      }
    }
    this._wake('acquisition-created');
    return Object.freeze({ decision, job: jobProjection(durable) });
  }

  async action(workspacePath, input) {
    exactKeys(input, new Set(['jobId', 'expectedRevision', 'action', 'p2pConsent']), 'resource action');
    const context = await this._workspace(workspacePath);
    const jobId = opaqueId(input.jobId, 'jobId');
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', 'expectedRevision 非法');
    }
    const action = exactString(input.action, 'action');
    if (!ACTIONS.has(action)) throw codedError('LIBRARY_RESOURCE_SURFACE_INVALID', 'action 非法');
    const current = this.acquisition.listJobs(context.workspaceIdentity).find(job => job.jobId === jobId);
    if (!current) throw codedError('LIBRARY_ACQUISITION_JOB_NOT_FOUND', 'Acquisition Job 不存在');
    if (current.revision !== input.expectedRevision) {
      throw codedError('LIBRARY_ACQUISITION_REVISION_CONFLICT', 'Acquisition Job revision 已变化');
    }
    let result;
    if (action === 'pause') result = await this.acquisition.pause(context.workspaceIdentity, jobId);
    else if (action === 'cancel') result = await this.acquisition.cancel(context.workspaceIdentity, jobId);
    else {
      const record = context.catalog.get(current.candidateId, current.candidateFingerprint);
      if (!record) throw codedError('LIBRARY_RESOURCE_SURFACE_CANDIDATE_NOT_FOUND', '恢复所需 Candidate 快照不存在');
      const resume = current.transport === 'magnet'
        ? this.acquisition.resumeTorrent.bind(this.acquisition)
        : this.acquisition.resumeHttp.bind(this.acquisition);
      if (current.transport === 'magnet' && input.p2pConsent !== true) {
        throw codedError('LIBRARY_TORRENT_P2P_CONSENT_REQUIRED', '继续 Torrent 任务需要重新确认 P2P 网络暴露');
      }
      const operation = resume(context.workspaceIdentity, jobId, {
        expectedRevision: current.revision,
        candidate: record.candidate,
        ...(current.transport === 'magnet' ? { p2pConsent: true } : {}),
      });
      this._background(operation);
      result = current;
    }
    this._wake(`action-${action}`);
    return jobProjection(result);
  }

  async repair(workspacePath) {
    const context = await this._workspace(workspacePath);
    const recovery = await this.acquisition.ensureWorkspaceRecovery(context.workspaceIdentity);
    const actions = await this.acquisition.reconcileWorkspace(context.workspaceIdentity);
    this._wake('repair');
    return Object.freeze({ recovery, actions, snapshot: await this.snapshot(context.workspacePath) });
  }

  snapshotResources() {
    const torrent = this.torrentTransport?.snapshot?.() || {
      activeCount: 0, inspectCount: 0, downloadCount: 0,
    };
    return Object.freeze({
      accepting: this.accepting,
      contextCount: this.contexts.size,
      operationCount: this.operations.size,
      backgroundCount: this.background.size,
      controllerCount: this.controllers.size,
      timerCount: 0,
      listenerCount: 0,
      torrentActiveCount: torrent.activeCount,
      torrentInspectCount: torrent.inspectCount,
      torrentDownloadCount: torrent.downloadCount,
      torrentInspectorCount: this.torrentInspectors.size,
    });
  }

  stopAccepting() {
    this.accepting = false;
    for (const controller of this.controllers) controller.abort();
    return this.snapshotResources();
  }

  async shutdown() {
    this.stopAccepting();
    await Promise.allSettled([...this.operations, ...this.background]);
    if (this.operations.size || this.background.size || this.controllers.size) {
      throw codedError('LIBRARY_RESOURCE_SURFACE_SHUTDOWN_FAILED', '资源服务 owner 未归零');
    }
    for (const context of this.contexts.values()) this._closeContext(context);
    this.contexts.clear();
    return this.snapshotResources();
  }
}

module.exports = {
  CONFIG_SCHEMA,
  CONFIG_KEY,
  LibraryResourceSurfaceService,
  normalizeConfig,
  candidateProjection,
  jobProjection,
  descriptorForTorrent,
  torrentCandidateFromInspection,
};
