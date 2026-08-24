'use strict';

// W93A: pure, serializable contracts for Library resource discovery and acquisition.
// This module deliberately performs no I/O and imposes no content, count, token,
// text-length, or file-size business limits.

const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const {
  assertKnownKeys,
  deepFreeze,
  isPlainObject,
} = require('./foundation/plain-value');

const CANDIDATE_SCHEMA = 'mazz.library-resource-candidate/v1';
const JOB_SCHEMA = 'mazz.library-acquisition-job/v1';
const INBOX_SCHEMA = 'mazz.library-acquisition-inbox/v1';

const FORMATS = Object.freeze(['epub', 'cbz', 'txt', 'mobi', 'azw3', 'pdf']);
const TRANSPORTS = Object.freeze(['https', 'magnet', 'torrent-file', 'local']);
const RIGHTS_STATUSES = Object.freeze([
  'public-domain', 'open-license', 'user-owned', 'unknown', 'restricted',
]);
const PASSING_RIGHTS_STATUSES = Object.freeze(['public-domain', 'open-license', 'user-owned']);
const JOB_STATES = Object.freeze([
  'discovered', 'resolving', 'awaiting-rights', 'inspecting', 'awaiting-selection',
  'queued', 'downloading', 'paused', 'verifying', 'materializing',
  'awaiting-import', 'imported', 'failed', 'cancelled',
]);
const TERMINAL_JOB_STATES = Object.freeze(['imported', 'cancelled']);
const RESTART_PAUSE_STATES = Object.freeze([
  'downloading', 'verifying', 'materializing', 'awaiting-import',
]);
const RIGHTS_REQUIRED_STATES = new Set([
  'queued', 'downloading', 'paused', 'verifying', 'materializing',
  'awaiting-import', 'imported',
]);
const NON_TERMINAL_RETRY_STATES = new Set(JOB_STATES.filter(
  state => !TERMINAL_JOB_STATES.includes(state) && state !== 'failed',
));
const JOB_TRANSITIONS = deepFreeze({
  discovered: ['resolving', 'awaiting-rights', 'failed', 'cancelled'],
  resolving: ['awaiting-rights', 'inspecting', 'failed', 'cancelled'],
  'awaiting-rights': ['inspecting', 'failed', 'cancelled'],
  inspecting: ['awaiting-selection', 'queued', 'failed', 'cancelled'],
  'awaiting-selection': ['queued', 'failed', 'cancelled'],
  queued: ['downloading', 'paused', 'failed', 'cancelled'],
  downloading: ['paused', 'verifying', 'failed', 'cancelled'],
  paused: ['queued', 'downloading', 'failed', 'cancelled'],
  verifying: ['materializing', 'failed', 'cancelled'],
  materializing: ['awaiting-import', 'failed', 'cancelled'],
  'awaiting-import': ['imported', 'failed', 'cancelled'],
  failed: [],
  imported: [],
  cancelled: [],
});

const IDENTIFIER_FIELDS = Object.freeze(['isbn', 'olid', 'ia', 'gutenberg', 'doi']);
const CANDIDATE_FIELDS = Object.freeze([
  'schema', 'candidateId', 'work', 'editions', 'offers', 'rights', 'provenance',
]);
const WORK_FIELDS = Object.freeze([
  'workId', 'title', 'authors', 'languages', 'subjects', 'identifiers',
]);
const EDITION_FIELDS = Object.freeze([
  'editionId', 'title', 'language', 'publisher', 'publishedAt', 'identifiers', 'description',
]);
const OFFER_FIELDS = Object.freeze([
  'offerId', 'editionId', 'providerId', 'resourceId', 'format', 'transport', 'size',
  'checksum', 'infoHash', 'sourceUrl', 'acquisitionRef', 'selectableFiles',
]);
const RIGHTS_FIELDS = Object.freeze([
  'status', 'licenseId', 'rightsStatement', 'jurisdiction', 'evidenceUrl',
  'assertedBy', 'checkedAt', 'confidence',
]);
const PROVENANCE_FIELDS = Object.freeze([
  'providerId', 'resourceId', 'pageUrl', 'observedAt', 'adapterVersion',
]);
const RIGHTS_RECEIPT_FIELDS = Object.freeze(['decision', 'authority', 'evidenceRef', 'at']);
const JOB_FIELDS = Object.freeze([
  'schema', 'revision', 'jobId', 'intentId', 'idempotencyKey', 'idempotencyAliases', 'workspaceIdentity', 'workspacePath',
  'candidateId', 'candidateFingerprint', 'offerId', 'providerId', 'transport', 'transportIdentity',
  'selectedFiles', 'rightsStatus', 'rightsReceipt', 'state', 'retryFrom', 'bytes', 'error',
  'integrity', 'stagingPath', 'finalPath', 'bookId', 'createdAt', 'updatedAt',
]);
const BYTES_FIELDS = Object.freeze(['received', 'total']);
const ERROR_FIELDS = Object.freeze(['code', 'message']);
const INTEGRITY_FIELDS = Object.freeze(['sha256', 'declaredChecksum', 'pieceVerified']);
const INBOX_FIELDS = Object.freeze([
  'schema', 'revision', 'receiptId', 'jobId', 'workspaceIdentity', 'kind', 'state',
  'artifact', 'createdAt', 'acknowledgedAt',
]);
const ARTIFACT_FIELDS = Object.freeze(['path', 'sha256', 'size', 'format']);

const SECRET_KEY = /(?:authorization|proxyauthorization|cookie|setcookie|api.?key|access.?key|access.?token|refresh.?token|id.?token|password|passwd|secret|client.?secret|signature|private.?key|credential|bearer.?token|session.?token)$/i;
const BEARER_SECRET = /\bbearer\s+[a-z0-9._~+/=-]{8,}/i;
const COMMON_API_SECRET = /(?:\bsk-(?:proj-)?[a-z0-9_-]{16,}|\bgithub_pat_[a-z0-9_]{20,}|\bgh[pousr]_[a-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{20,}|\bxox[baprs]-[a-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,})/;
const SENSITIVE_HEADER = /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|access-token|refresh-token)\s*:/i;
const SENSITIVE_QUERY_KEY = /^(?:authorization|auth|cookie|api.?key|key|access.?key|access.?token|refresh.?token|id.?token|token|password|passwd|secret|client.?secret|signature|sig|signed|expires?|expiry|credential|policy|session|session.?token|jwt|x.?amz.*|x.?goog.*|googleaccessid|awsaccesskeyid)$/i;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

// Resource contracts must never coerce objects/arrays/numbers into protocol
// text (for example "[object Object]"). Provider and adapter payloads are
// untrusted; malformed field types fail closed at this boundary.
function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

function requiredExactString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value;
}

// Filesystem and archive entry identities must never be silently rewritten by
// trimming. A leading space can be a real filename byte; a trailing space is
// rejected explicitly by the path policy below rather than redirected to a
// different file.
function requiredExactPathString(value, label) {
  try { return requiredExactString(value, label); }
  catch { throw new Error(`${label} 必须是非空路径字符串`); }
}

function optionalString(value, label = 'value') {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
  return value.trim();
}

function arrayOrEmpty(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function objectOrEmpty(value, label) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function optionalStrictString(value, label, { exact = false } = {}) {
  if (value === undefined || value === '') return '';
  return exact ? requiredExactString(value, label) : requiredString(value, label);
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function iso(value, label) {
  const text = value instanceof Date ? value.toISOString() : requiredString(value, label);
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) throw new Error(`${label} 必须是 ISO 时间`);
  return new Date(epoch).toISOString();
}

function nowIso(value, label = 'now') {
  const actual = typeof value === 'function' ? value() : value;
  return iso(actual == null ? new Date().toISOString() : actual, label);
}

function plainObject(value, label, fields) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  assertKnownKeys(value, fields, label);
  return value;
}

function assertCompleteDurableRecord(value, fields, label, context) {
  if (context?.durableRecord !== true) return;
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label} durable record 缺少字段 ${field}`);
    }
  }
}

function assertOwnFields(value, fields, label) {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label} durable record 缺少字段 ${field}`);
    }
  }
}

function assertDurableJobEnvelopeTypes(input, context) {
  if (context?.durableRecord !== true) return;
  const stringFields = [
    'schema', 'jobId', 'intentId', 'idempotencyKey', 'workspaceIdentity', 'workspacePath',
    'candidateId', 'candidateFingerprint', 'offerId', 'providerId', 'transport', 'transportIdentity', 'rightsStatus',
    'state', 'stagingPath', 'finalPath', 'bookId', 'createdAt', 'updatedAt',
  ];
  if (stringFields.some(field => typeof input[field] !== 'string')
    || typeof input.revision !== 'number'
    || !Array.isArray(input.idempotencyAliases)
    || !Array.isArray(input.selectedFiles)
    || !(input.retryFrom === null || typeof input.retryFrom === 'string')
    || !(input.rightsReceipt === null || isPlainObject(input.rightsReceipt))
    || !(input.error === null || isPlainObject(input.error))
    || !isPlainObject(input.bytes)
    || !isPlainObject(input.integrity)) {
    throw new Error('Acquisition Job durable record 字段类型非法');
  }
  assertOwnFields(input.bytes, BYTES_FIELDS, 'bytes');
  assertOwnFields(input.integrity, INTEGRITY_FIELDS, 'integrity');
  if (typeof input.bytes.received !== 'number'
    || !(input.bytes.total === null || typeof input.bytes.total === 'number')
    || typeof input.integrity.sha256 !== 'string'
    || typeof input.integrity.declaredChecksum !== 'string'
    || typeof input.integrity.pieceVerified !== 'boolean') {
    throw new Error('Acquisition Job durable nested fields 类型非法');
  }
}

function assertDurableInboxEnvelopeTypes(input, context) {
  if (context?.durableRecord !== true) return;
  const stringFields = ['schema', 'receiptId', 'jobId', 'workspaceIdentity', 'kind', 'state', 'createdAt'];
  if (stringFields.some(field => typeof input[field] !== 'string')
    || typeof input.revision !== 'number'
    || !(input.acknowledgedAt === null || typeof input.acknowledgedAt === 'string')
    || !isPlainObject(input.artifact)) {
    throw new Error('Inbox Receipt durable record 字段类型非法');
  }
  assertOwnFields(input.artifact, ARTIFACT_FIELDS, 'artifact');
  if (typeof input.artifact.path !== 'string'
    || typeof input.artifact.sha256 !== 'string'
    || typeof input.artifact.size !== 'number'
    || typeof input.artifact.format !== 'string') {
    throw new Error('Inbox Receipt durable artifact 字段类型非法');
  }
}

function safeRef(value, label) {
  const ref = requiredExactString(value, label);
  if (ref !== ref.trim() || /[\u0000-\u001f\u007f]/.test(ref) || /[\\/]/.test(ref)) {
    throw new Error(`${label} 非法`);
  }
  return ref;
}

function safeRecordId(value, label) {
  const id = requiredExactString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || WINDOWS_DEVICE.test(id)) {
    throw new Error(`${label} 必须是系统生成的安全 ID`);
  }
  return id;
}

function uniqueStrings(value, label, { normalize = item => item, sort = false } = {}) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const result = [];
  const seen = new Set();
  value.forEach((item, index) => {
    const text = normalize(requiredString(item, `${label}[${index}]`));
    if (!seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  });
  if (sort) result.sort((left, right) => left.localeCompare(right, 'en'));
  return result;
}

function nonNegativeInteger(value, label, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 必须是非负安全整数`);
  return value;
}

function positiveRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} 必须是正整数`);
  return value;
}

function normalizeFormat(value, label = 'format') {
  const format = requiredString(value, label).toLowerCase();
  if (!FORMATS.includes(format)) throw new Error(`${label} 非法`);
  return format;
}

function normalizeTransport(value, label = 'transport') {
  const transport = requiredString(value, label).toLowerCase();
  if (!TRANSPORTS.includes(transport)) throw new Error(`${label} 非法`);
  return transport;
}

function decodePercentTextToStability(value, label, { plusAsSpace = false } = {}) {
  let current = String(value);
  if (plusAsSpace) current = current.replace(/\+/g, ' ');
  const seen = new Set();
  while (!seen.has(current)) {
    seen.add(current);
    let next;
    try { next = decodeURIComponent(current); }
    catch { throw new Error(`${label} 包含非法或不可审计的 query 编码`); }
    if (plusAsSpace) next = next.replace(/\+/g, ' ');
    if (next === current) return next.trim();
    current = next;
  }
  throw new Error(`${label} 包含不稳定 query 编码`);
}

function decodeQueryKeyToStability(value, label) {
  return decodePercentTextToStability(value, label, { plusAsSpace: true });
}

function decodeEmbeddedPercentEscapes(value, label) {
  let current = String(value);
  const seen = new Set();
  while (!seen.has(current)) {
    seen.add(current);
    // Preserve ordinary prose such as "50%" and "%PDF" while decoding
    // actual percent octets (including recursively encoded paths/URLs).
    const escapedBarePercents = current.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
    let next;
    try { next = decodeURIComponent(escapedBarePercents); }
    catch { throw new Error(`${label} 包含不可审计的百分号编码`); }
    if (next === current) return next;
    current = next;
  }
  throw new Error(`${label} 包含不稳定百分号编码`);
}

function assertNoSecretString(value, label = 'value', options = {}) {
  const text = String(value);
  const decoded = decodeEmbeddedPercentEscapes(text, label);
  const views = [...new Set([
    text,
    decoded,
    ...(options.formEncoded === true
      ? [text.replace(/\+/g, ' '), decoded.replace(/\+/g, ' ')]
      : []),
  ])];
  if (views.some(view => BEARER_SECRET.test(view)
    || COMMON_API_SECRET.test(view)
    || SENSITIVE_HEADER.test(view))) {
    throw new Error(`${label} 禁止包含 secret`);
  }
  // Match keys without consuming their values so nested/redirect URLs in a
  // value are scanned too (for example `redirect=...?...token=...`).
  const queryLike = /(?:^|[?&#;])([^=&#;?]+)=/g;
  const embeddedAssignment = /(?:^|[\s,{[(;])["']?([A-Za-z][A-Za-z0-9_.-]*)["']?\s*[:=]/g;
  for (const view of views) {
    queryLike.lastIndex = 0;
    let match;
    while ((match = queryLike.exec(view))) {
      const name = decodeQueryKeyToStability(match[1], label);
      if (SENSITIVE_QUERY_KEY.test(name)) throw new Error(`${label} 禁止包含敏感 query`);
    }
    embeddedAssignment.lastIndex = 0;
    while ((match = embeddedAssignment.exec(view))) {
      const name = match[1];
      const compact = name.replace(/[^a-z0-9]/gi, '');
      if (SECRET_KEY.test(compact) || SENSITIVE_QUERY_KEY.test(name)) {
        throw new Error(`${label} 禁止包含 secret 赋值`);
      }
    }
  }
  return value;
}

function assertNoSecrets(value, label = 'value', trail = '', seen = new WeakSet()) {
  if (typeof value === 'string') {
    assertNoSecretString(value, trail ? `${label}.${trail}` : label);
    return value;
  }
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new Error(`${label} 不能包含循环引用`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertNoSecrets(item, label, `${trail}[${index}]`, seen));
      return value;
    }
    if (!isPlainObject(value)) throw new Error(`${label} 必须是可序列化普通对象`);
    for (const [key, child] of Object.entries(value)) {
      const at = trail ? `${trail}.${key}` : key;
      if (SECRET_KEY.test(key.replace(/[^a-z0-9]/gi, ''))) {
        throw new Error(`${label} 禁止 secret 字段：${at}`);
      }
      assertNoSecrets(child, label, at, seen);
    }
    return value;
  } finally {
    seen.delete(value);
  }
}

function isPublicHostname(value) {
  const hostname = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.internal')
    || hostname.endsWith('.lan') || hostname.endsWith('.home')) return false;
  // Pure contracts cannot perform DNS/redirect re-resolution. Literal IP
  // origins (including every IPv4-in-IPv6 spelling) are therefore rejected
  // conservatively; W93D's transport boundary will resolve hostnames and
  // re-check every address and redirect before connecting.
  if (net.isIP(hostname) !== 0) return false;
  return hostname.includes('.') && !hostname.startsWith('.') && !hostname.endsWith('.');
}

function assertHttpsPublicUrl(value, label = 'URL') {
  const text = requiredString(value, label);
  assertNoSecretString(text, label);
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error(`${label} 必须是 HTTPS 公共 URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !isPublicHostname(parsed.hostname)) {
    throw new Error(`${label} 必须是无 userinfo 的 HTTPS 公共 URL`);
  }
  for (const [name, queryValue] of parsed.searchParams.entries()) {
    if (SENSITIVE_QUERY_KEY.test(decodeQueryKeyToStability(name, label))) {
      throw new Error(`${label} 禁止包含敏感 query`);
    }
    // URLSearchParams already applies form-urlencoded decoding (including
    // `+` -> space). Scan the decoded value as well, so a harmless outer key
    // cannot hide a Bearer/API secret or a recursively encoded signed URL.
    assertNoSecretString(queryValue, `${label}.query.${name}`, { formEncoded: true });
  }
  if (parsed.hash) assertNoSecretString(parsed.hash, `${label}.fragment`, { formEncoded: true });
  return parsed.href;
}

function normalizeRelativePosixPath(value, label = 'path') {
  const text = requiredExactPathString(value, label);
  if (text.includes('\0') || /[\u0001-\u001f\u007f]/.test(text)) throw new Error(`${label} 含控制字符`);
  if (text.includes('\\') || text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.endsWith('/')) {
    throw new Error(`${label} 必须是相对 POSIX 路径`);
  }
  const segments = text.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} 禁止空段、. 或 ..`);
  }
  for (const segment of segments) {
    if (segment.includes(':') || /[. ]$/.test(segment) || WINDOWS_DEVICE.test(segment)) {
      throw new Error(`${label} 禁止 ADS、设备名或非规范叶名`);
    }
  }
  if (path.posix.normalize(text) !== text) throw new Error(`${label} 不是规范 POSIX 路径`);
  return text;
}

function normalizeSelectedFiles(value, label = 'selectedFiles') {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const result = [];
  const seen = new Set();
  value.forEach((item, index) => {
    const normalized = normalizeRelativePosixPath(item, `${label}[${index}]`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function normalizeIdentifierValue(kind, value, options = {}) {
  let text = requiredString(value, `identifiers.${kind}`).normalize('NFC');
  if (kind === 'isbn') text = text.replace(/[\s-]/g, '').toUpperCase();
  if (kind === 'doi') text = text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  if (kind === 'olid') text = text.toUpperCase();
  text = requiredString(text, `identifiers.${kind}`);
  if (kind === 'isbn') {
    const shaped = /^(?:\d{9}[\dX]|\d{13})$/.test(text);
    const checksumValid = shaped && !/^0+$/.test(text) && (text.length === 10
      ? [...text].reduce((sum, char, index) => (
        sum + (char === 'X' ? 10 : Number(char)) * (10 - index)
      ), 0) % 11 === 0
      : /^97[89]/.test(text) && [...text].reduce((sum, char, index) => (
        sum + Number(char) * (index % 2 === 0 ? 1 : 3)
      ), 0) % 10 === 0);
    if (!checksumValid) throw new Error('identifiers.isbn 格式或校验位非法');
  }
  if (kind === 'doi' && !/^10\.\d{4,9}\/\S+$/i.test(text)) throw new Error('identifiers.doi 格式非法');
  if (kind === 'olid') {
    if (!/^OL\d+[WM]$/.test(text)) throw new Error('identifiers.olid 格式非法');
    if (options.entityKind === 'work' && !text.endsWith('W')) {
      throw new Error('work.identifiers.olid 必须是 Work OLID');
    }
    if (options.entityKind === 'edition' && !text.endsWith('M')) {
      throw new Error('edition.identifiers.olid 必须是 Edition OLID');
    }
  }
  if (kind === 'gutenberg' && !/^\d+$/.test(text)) throw new Error('identifiers.gutenberg 格式非法');
  if (kind === 'ia' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) throw new Error('identifiers.ia 格式非法');
  assertNoSecretString(text, `identifiers.${kind}`);
  return text;
}

function normalizeIdentifiers(value = {}, label = 'identifiers', options = {}) {
  plainObject(value, label, IDENTIFIER_FIELDS);
  const result = {};
  for (const kind of IDENTIFIER_FIELDS) {
    result[kind] = uniqueStrings(arrayOrEmpty(value[kind], `${label}.${kind}`), `${label}.${kind}`, {
      normalize: item => normalizeIdentifierValue(kind, item, options),
      sort: true,
    });
  }
  return deepFreeze(result);
}

function identityMaterial(identifiersInput, fallbackInput, label) {
  const identifiers = normalizeIdentifiers(objectOrEmpty(identifiersInput, `${label}.identifiers`), `${label}.identifiers`, { entityKind: label });
  for (const kind of IDENTIFIER_FIELDS) {
    if (identifiers[kind].length) return { kind, value: identifiers[kind][0] };
  }
  const fallback = fallbackInput || {};
  const providerId = safeRef(fallback.providerId, `${label}.providerId`);
  const resourceId = safeRef(fallback.resourceId, `${label}.resourceId`);
  return { kind: 'source', providerId, resourceId };
}

function deriveWorkId(input = {}) {
  return `work-${sha256Text(stableJson(identityMaterial(input.identifiers, input, 'work')))}`;
}

function deriveEditionId(input = {}) {
  return `edition-${sha256Text(stableJson(identityMaterial(input.identifiers, input, 'edition')))}`;
}

function normalizeSha256(value, label = 'sha256', { optional = false } = {}) {
  if (optional && (value === undefined || value === '')) return '';
  const text = requiredExactString(value, label).replace(/^sha256:/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} 必须是完整 SHA-256`);
  return text;
}

function deriveBlobId(value) {
  return `blob-sha256-${normalizeSha256(value)}`;
}

function normalizeInfoHash(value, label = 'infoHash', { optional = false } = {}) {
  if (optional && (value === undefined || value === '')) return '';
  const text = requiredExactString(value, label).replace(/^urn:btih:/i, '');
  if (/^[a-f0-9]{40}$/i.test(text)) return text.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(text)) return text.toUpperCase();
  throw new Error(`${label} 必须是 BTIH hex 或 base32`);
}

function normalizeChecksum(value, label = 'checksum') {
  if (value === undefined || value === '') return '';
  const text = requiredExactString(value, label);
  assertNoSecretString(text, label);
  if (/^(?:sha256:)?[a-f0-9]{64}$/i.test(text)) return `sha256:${text.replace(/^sha256:/i, '').toLowerCase()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+\/-]*$/.test(text)) throw new Error(`${label} 非法`);
  return text;
}

function normalizeAcquisitionRef(value, label = 'acquisitionRef') {
  if (value === undefined || value === '') return '';
  const ref = requiredExactString(value, label);
  if (!ref) return '';
  assertNoSecretString(ref, label);
  if (/[\u0000-\u001f\u007f\s]/.test(ref) || /:\/\/|[\\/?#]/.test(ref)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(ref)
    || ref === '.' || ref === '..' || /^[A-Za-z]:/.test(ref)) {
    throw new Error(`${label} 必须是不透明、无 secret 的主进程引用`);
  }
  return ref;
}

function deriveTransportIdentity(offerInput = {}) {
  const providerId = safeRef(offerInput.providerId, 'offer.providerId');
  const transport = normalizeTransport(offerInput.transport, 'offer.transport');
  const infoHash = normalizeInfoHash(offerInput.infoHash, 'offer.infoHash', { optional: true });
  if (infoHash) return `btih:${infoHash.toLowerCase()}`;
  const checksum = normalizeChecksum(offerInput.checksum, 'offer.checksum');
  if (checksum.toLowerCase().startsWith('sha256:')) return checksum.toLowerCase();
  const acquisitionRef = normalizeAcquisitionRef(offerInput.acquisitionRef, 'offer.acquisitionRef');
  if (acquisitionRef) return `ref:${providerId}:${transport}:${acquisitionRef}`;
  const sourceUrl = offerInput.sourceUrl === undefined || offerInput.sourceUrl === ''
    ? ''
    : assertHttpsPublicUrl(offerInput.sourceUrl, 'offer.sourceUrl');
  if (sourceUrl) return `url:${sourceUrl}`;
  throw new Error('Offer 缺少稳定 transport identity');
}

function deriveOfferId(input = {}) {
  const material = {
    providerId: safeRef(input.providerId, 'offer.providerId'),
    resourceId: safeRef(input.resourceId, 'offer.resourceId'),
    format: normalizeFormat(input.format, 'offer.format'),
    transportIdentity: input.transportIdentity === undefined || input.transportIdentity === ''
      ? deriveTransportIdentity(input)
      : safeRef(input.transportIdentity, 'offer.transportIdentity'),
  };
  return `offer-${sha256Text(stableJson(material))}`;
}

function deriveWorkspaceIdentity(workspacePath) {
  let normalized = path.resolve(requiredExactPathString(workspacePath, 'workspacePath')).replace(/\\/g, '/');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return `workspace-${sha256Text(normalized)}`;
}

function deriveAcquisitionIdempotencyKey(input = {}) {
  const workspaceIdentity = safeRef(input.workspaceIdentity, 'workspaceIdentity');
  const intentId = safeRef(input.intentId, 'intentId');
  const offerId = input.offerId === undefined || input.offerId === ''
    ? ''
    : safeRef(input.offerId, 'offerId');
  const transportIdentity = input.transportIdentity === undefined || input.transportIdentity === ''
    ? ''
    : requiredExactString(input.transportIdentity, 'transportIdentity');
  if (!offerId && !transportIdentity) throw new Error('幂等键必须有 offerId 或 transportIdentity');
  if (transportIdentity) {
    assertNoSecretString(transportIdentity, 'transportIdentity');
    if (/\s|\0/.test(transportIdentity)) throw new Error('transportIdentity 非法');
  }
  const selectedFiles = normalizeSelectedFiles(arrayOrEmpty(input.selectedFiles, 'selectedFiles'))
    .slice().sort((a, b) => a.localeCompare(b, 'en'));
  return `acq-${sha256Text(stableJson({ workspaceIdentity, intentId, offerId, transportIdentity, selectedFiles }))}`;
}

function normalizeRights(input, label = 'rights') {
  plainObject(input, label, RIGHTS_FIELDS);
  assertNoSecrets(input, label);
  const status = requiredString(input.status, `${label}.status`);
  if (!RIGHTS_STATUSES.includes(status)) throw new Error(`${label}.status 非法`);
  const evidenceUrl = input.evidenceUrl === undefined || input.evidenceUrl === ''
    ? '' : assertHttpsPublicUrl(input.evidenceUrl, `${label}.evidenceUrl`);
  const assertedBy = optionalStrictString(input.assertedBy, `${label}.assertedBy`);
  const checkedAt = input.checkedAt === undefined || input.checkedAt === ''
    ? '' : iso(input.checkedAt, `${label}.checkedAt`);
  if (['public-domain', 'open-license'].includes(status) && (!evidenceUrl || !assertedBy || !checkedAt)) {
    throw new Error(`${status} 必须有 evidenceUrl、assertedBy 与 checkedAt`);
  }
  let confidence = null;
  if (input.confidence != null) {
    if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence)
      || input.confidence < 0 || input.confidence > 1) throw new Error(`${label}.confidence 必须在 0..1`);
    confidence = input.confidence;
  }
  return deepFreeze({
    status,
    licenseId: optionalStrictString(input.licenseId, `${label}.licenseId`),
    rightsStatement: optionalStrictString(input.rightsStatement, `${label}.rightsStatement`),
    jurisdiction: optionalStrictString(input.jurisdiction, `${label}.jurisdiction`),
    evidenceUrl,
    assertedBy,
    checkedAt,
    confidence,
  });
}

function normalizeRightsReceipt(input, options = {}) {
  if (input == null) return null;
  plainObject(input, 'rightsReceipt', RIGHTS_RECEIPT_FIELDS);
  assertNoSecrets(input, 'rightsReceipt');
  const decision = requiredString(input.decision, 'rightsReceipt.decision');
  if (!PASSING_RIGHTS_STATUSES.includes(decision)) throw new Error('rightsReceipt.decision 不能通过 unknown/restricted');
  const authority = requiredString(input.authority, 'rightsReceipt.authority');
  if (decision === 'user-owned' && authority !== 'user') {
    throw new Error('user-owned 必须由 authority=user 的 Rights Receipt 确认');
  }
  const receipt = deepFreeze({
    decision,
    authority,
    evidenceRef: safeRef(input.evidenceRef, 'rightsReceipt.evidenceRef'),
    at: iso(input.at, 'rightsReceipt.at'),
  });
  const rights = options.rights ? normalizeRights(options.rights) : null;
  if (rights && rights.status !== receipt.decision) throw new Error('Rights Receipt 与 Candidate rights 不一致');
  return receipt;
}

function normalizeWork(input) {
  plainObject(input, 'work', WORK_FIELDS);
  return deepFreeze({
    workId: safeRef(input.workId, 'work.workId'),
    title: requiredString(input.title, 'work.title'),
    authors: uniqueStrings(arrayOrEmpty(input.authors, 'work.authors'), 'work.authors'),
    languages: uniqueStrings(arrayOrEmpty(input.languages, 'work.languages'), 'work.languages', { normalize: item => item.toLowerCase(), sort: true }),
    subjects: uniqueStrings(arrayOrEmpty(input.subjects, 'work.subjects'), 'work.subjects'),
    identifiers: normalizeIdentifiers(objectOrEmpty(input.identifiers, 'work.identifiers'), 'work.identifiers', { entityKind: 'work' }),
  });
}

function normalizeEdition(input, index) {
  const label = `editions[${index}]`;
  plainObject(input, label, EDITION_FIELDS);
  return deepFreeze({
    editionId: safeRef(input.editionId, `${label}.editionId`),
    title: requiredString(input.title, `${label}.title`),
    language: optionalStrictString(input.language, `${label}.language`).toLowerCase(),
    publisher: optionalStrictString(input.publisher, `${label}.publisher`),
    publishedAt: optionalStrictString(input.publishedAt, `${label}.publishedAt`),
    identifiers: normalizeIdentifiers(objectOrEmpty(input.identifiers, `${label}.identifiers`), `${label}.identifiers`, { entityKind: 'edition' }),
    description: optionalStrictString(input.description, `${label}.description`),
  });
}

function normalizeOffer(input, index) {
  const label = `offers[${index}]`;
  plainObject(input, label, OFFER_FIELDS);
  const transport = normalizeTransport(input.transport, `${label}.transport`);
  const sourceUrl = input.sourceUrl === undefined || input.sourceUrl === ''
    ? '' : assertHttpsPublicUrl(input.sourceUrl, `${label}.sourceUrl`);
  const acquisitionRef = normalizeAcquisitionRef(input.acquisitionRef, `${label}.acquisitionRef`);
  const infoHash = normalizeInfoHash(input.infoHash, `${label}.infoHash`, { optional: true });
  if (transport === 'magnet' && !infoHash) throw new Error(`${label} magnet 必须有 infoHash`);
  if (transport === 'https' && !sourceUrl && !acquisitionRef) throw new Error(`${label} https 必须有 sourceUrl 或 acquisitionRef`);
  if (['torrent-file', 'local'].includes(transport) && !acquisitionRef) {
    throw new Error(`${label} ${transport} 必须有 acquisitionRef`);
  }
  return deepFreeze({
    offerId: safeRef(input.offerId, `${label}.offerId`),
    editionId: safeRef(input.editionId, `${label}.editionId`),
    providerId: safeRef(input.providerId, `${label}.providerId`),
    resourceId: safeRef(input.resourceId, `${label}.resourceId`),
    format: normalizeFormat(input.format, `${label}.format`),
    transport,
    size: input.size == null ? null : nonNegativeInteger(input.size, `${label}.size`),
    checksum: normalizeChecksum(input.checksum, `${label}.checksum`),
    infoHash,
    sourceUrl,
    acquisitionRef,
    selectableFiles: normalizeSelectedFiles(arrayOrEmpty(input.selectableFiles, `${label}.selectableFiles`), `${label}.selectableFiles`),
  });
}

function normalizeProvenance(input, index) {
  const label = `provenance[${index}]`;
  plainObject(input, label, PROVENANCE_FIELDS);
  const pageUrl = input.pageUrl === undefined || input.pageUrl === ''
    ? ''
    : assertHttpsPublicUrl(input.pageUrl, `${label}.pageUrl`);
  return deepFreeze({
    providerId: safeRef(input.providerId, `${label}.providerId`),
    resourceId: safeRef(input.resourceId, `${label}.resourceId`),
    // Some catalog protocols do not expose a human-facing detail page.  An
    // absent page URL is therefore a valid lack of metadata, while every
    // supplied value still crosses the same strict HTTPS/secret/IP boundary.
    pageUrl,
    observedAt: iso(input.observedAt, `${label}.observedAt`),
    adapterVersion: safeRef(input.adapterVersion, `${label}.adapterVersion`),
  });
}

function assertUniqueIds(items, key, label) {
  const ids = items.map(item => item[key]);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} ${key} 重复`);
}

function hasStrongIdentifier(identifiers) {
  return IDENTIFIER_FIELDS.some(kind => identifiers[kind]?.length);
}

function normalizeCandidate(input) {
  plainObject(input, 'Resource Candidate', CANDIDATE_FIELDS);
  assertNoSecrets(input, 'Resource Candidate');
  if (input.schema !== CANDIDATE_SCHEMA) throw new Error('Resource Candidate schema 非法');
  if (!Array.isArray(input.editions) || !input.editions.length) throw new Error('Resource Candidate 至少有一个 Edition');
  if (!Array.isArray(input.offers) || !input.offers.length) throw new Error('Resource Candidate 至少有一个 Offer');
  if (!Array.isArray(input.provenance) || !input.provenance.length) throw new Error('Resource Candidate 必须有 provenance');
  const work = normalizeWork(input.work);
  const editions = input.editions.map(normalizeEdition);
  const offers = input.offers.map(normalizeOffer);
  const provenance = input.provenance.map(normalizeProvenance);
  assertUniqueIds(editions, 'editionId', 'editions');
  assertUniqueIds(offers, 'offerId', 'offers');
  const editionIds = new Set(editions.map(edition => edition.editionId));
  for (const offer of offers) {
    if (!editionIds.has(offer.editionId)) throw new Error('Offer 引用了不存在的 Edition');
    if (offer.offerId !== deriveOfferId(offer)) throw new Error('Offer ID 与强身份材料不一致');
  }
  const provenanceIdentity = provenance
    .map(item => ({ providerId: item.providerId, resourceId: item.resourceId }))
    .sort((left, right) => `${left.providerId}:${left.resourceId}`.localeCompare(`${right.providerId}:${right.resourceId}`, 'en'))[0];
  const expectedWorkId = deriveWorkId(hasStrongIdentifier(work.identifiers)
    ? { identifiers: work.identifiers }
    : { identifiers: work.identifiers, ...provenanceIdentity });
  if (work.workId !== expectedWorkId) throw new Error('Work ID 与强身份材料不一致');
  for (const edition of editions) {
    const editionOffer = offers
      .filter(offer => offer.editionId === edition.editionId)
      .sort((left, right) => `${left.providerId}:${left.resourceId}`.localeCompare(`${right.providerId}:${right.resourceId}`, 'en'))[0];
    const expectedEditionId = deriveEditionId(hasStrongIdentifier(edition.identifiers)
      ? { identifiers: edition.identifiers }
      : { identifiers: edition.identifiers, providerId: editionOffer.providerId, resourceId: editionOffer.resourceId });
    if (edition.editionId !== expectedEditionId) throw new Error('Edition ID 与强身份材料不一致');
  }
  return deepFreeze({
    schema: CANDIDATE_SCHEMA,
    candidateId: safeRef(input.candidateId, 'candidateId'),
    work,
    editions,
    offers,
    rights: normalizeRights(input.rights),
    provenance,
  });
}

function deriveCandidateFingerprint(input) {
  const candidate = normalizeCandidate(input);
  return `candidate-sha256-${sha256Text(stableJson(candidate))}`;
}

function isPathInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertSafeAbsolutePath(value, label) {
  const text = requiredExactPathString(value, label);
  if (!path.isAbsolute(text) || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${label} 必须是安全绝对路径`);
  }
  const parsed = path.parse(text);
  const relative = text.slice(parsed.root.length);
  const segments = relative.split(/[\\/]+/).filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes(':')
      || /[. ]$/.test(segment) || WINDOWS_DEVICE.test(segment)) {
      throw new Error(`${label} 禁止 ADS、设备名、尾随点空格或非规范路径段`);
    }
  }
  return path.resolve(text);
}

function assertPathInside(rootPath, targetPath, label) {
  const target = assertSafeAbsolutePath(targetPath, label);
  if (!isPathInside(rootPath, target)) {
    throw new Error(`${label} 必须位于指定根目录内`);
  }
  return target;
}

function normalizeContext(context = {}) {
  const workspacePath = context.workspacePath ? path.resolve(context.workspacePath) : '';
  const workspaceIdentity = context.workspaceIdentity || (workspacePath ? deriveWorkspaceIdentity(workspacePath) : '');
  const resourcesRoot = context.resourcesRoot
    ? path.resolve(context.resourcesRoot)
    : (workspacePath ? path.join(workspacePath, '书库', '.resources') : '');
  const libraryRoot = context.libraryRoot
    ? path.resolve(context.libraryRoot)
    : (workspacePath ? path.join(workspacePath, '书库') : (resourcesRoot ? path.dirname(resourcesRoot) : ''));
  const stagingRoot = context.stagingRoot
    ? path.resolve(context.stagingRoot)
    : (resourcesRoot ? path.join(resourcesRoot, 'staging') : '');
  return { workspacePath, workspaceIdentity, resourcesRoot, libraryRoot, stagingRoot };
}

function normalizeBytes(input) {
  if (input === undefined) return deepFreeze({ received: 0, total: null });
  if (typeof input === 'number') return deepFreeze({ received: nonNegativeInteger(input, 'bytes'), total: null });
  plainObject(input, 'bytes', BYTES_FIELDS);
  const received = nonNegativeInteger(input.received ?? 0, 'bytes.received');
  const total = nonNegativeInteger(input.total, 'bytes.total', { nullable: true });
  if (total != null && received > total) throw new Error('bytes.received 不能大于 bytes.total');
  return deepFreeze({ received, total });
}

function normalizeJobError(input) {
  if (input == null) return null;
  plainObject(input, 'error', ERROR_FIELDS);
  assertNoSecrets(input, 'error');
  const message = requiredString(input.message, 'error.message');
  const decodedMessage = decodeEmbeddedPercentEscapes(message, 'error.message');
  assertNoSecretString(decodedMessage, 'error.message');
  const views = [...new Set([message, decodedMessage])];
  const containsUrl = views.some(view => (
    /\b[a-z][a-z0-9+.-]*:\/\//i.test(view)
    || /\b(?:https?|ftps?|wss?|file|data|mailto|magnet|blob|urn):/i.test(view)
  ));
  // Error receipts are durable and may be surfaced outside the originating
  // machine. Match absolute paths wherever they occur and after recursive
  // percent-decoding, rather than relying on a whitespace prefix.
  const containsAbsolutePath = views.some(view => (
    /[A-Za-z]:[\\/][^\s\]})>'"`]*/.test(view)
    || /\\\\[^\\/\s]+[\\/][^\s\]})>'"`]*/.test(view)
    || /(?:^|[^A-Za-z0-9_])\/(?!\/)(?:[^\s/]+(?:\/[^\s/]*)?)/.test(view)
  ));
  if (containsUrl || containsAbsolutePath) {
    throw new Error('error.message 不得持久化绝对 URL 或路径');
  }
  const code = requiredExactString(input.code, 'error.code');
  assertNoSecretString(code, 'error.code');
  if (!/^[A-Z][A-Z0-9_.-]*$/.test(code)) {
    throw new Error('error.code 必须是内部稳定错误标识');
  }
  return deepFreeze({
    code,
    message,
  });
}

function normalizeIntegrity(input = {}) {
  plainObject(input, 'integrity', INTEGRITY_FIELDS);
  return deepFreeze({
    sha256: normalizeSha256(input.sha256, 'integrity.sha256', { optional: true }),
    declaredChecksum: normalizeChecksum(input.declaredChecksum, 'integrity.declaredChecksum'),
    pieceVerified: input.pieceVerified === true,
  });
}

function stateNeedsRightsReceipt(state, retryFrom = '') {
  return RIGHTS_REQUIRED_STATES.has(state) || (state === 'failed' && RIGHTS_REQUIRED_STATES.has(retryFrom));
}

function assertRightsState(rightsInput, state, receiptInput = null, retryFrom = '') {
  const rights = normalizeRights(rightsInput);
  const receipt = normalizeRightsReceipt(receiptInput, { rights });
  const effectiveState = state === 'failed' ? retryFrom : state;
  if (rights.status === 'unknown' && !['awaiting-rights', 'cancelled'].includes(effectiveState)) {
    throw new Error('unknown Rights 只能停在 awaiting-rights');
  }
  if (rights.status === 'restricted' && !['discovered', 'resolving', 'awaiting-rights', 'cancelled'].includes(effectiveState)) {
    throw new Error('restricted Rights 不得进入 inspect/queue/transport');
  }
  if (stateNeedsRightsReceipt(state, retryFrom) && !receipt) throw new Error(`${state} 必须有合法 Rights Receipt`);
  return true;
}

function assertDurableRightsState(rightsStatus, state, receipt, retryFrom = '') {
  if (!RIGHTS_STATUSES.includes(rightsStatus)) throw new Error('Job rightsStatus 非法');
  const effectiveState = state === 'failed' ? retryFrom : state;
  if (rightsStatus === 'restricted') {
    if (!['discovered', 'resolving', 'awaiting-rights', 'cancelled'].includes(effectiveState)) {
      throw new Error('restricted Rights 不得进入 inspect/queue/transport');
    }
    if (receipt) throw new Error('restricted Rights 不得附加通过 Receipt');
    return true;
  }
  if (rightsStatus === 'unknown') {
    const userOwned = receipt?.decision === 'user-owned' && receipt?.authority === 'user';
    if (!userOwned && !['awaiting-rights', 'cancelled'].includes(effectiveState)) {
      throw new Error('unknown Rights 只能停在 awaiting-rights，或由用户明确声明自有');
    }
    return true;
  }
  if (!receipt) throw new Error(`durable ${rightsStatus} Job 必须有 Rights Receipt`);
  if (receipt && receipt.decision !== rightsStatus) throw new Error('Rights Receipt 与 Job rightsStatus 不一致');
  return true;
}

function normalizeJob(input, context = {}) {
  plainObject(input, 'Acquisition Job', JOB_FIELDS);
  assertCompleteDurableRecord(input, JOB_FIELDS, 'Acquisition Job', context);
  assertDurableJobEnvelopeTypes(input, context);
  assertNoSecrets(input, 'Acquisition Job');
  if (input.schema !== JOB_SCHEMA) throw new Error('Acquisition Job schema 非法');
  const normalizedContext = normalizeContext(context);
  const workspacePath = path.resolve(requiredExactPathString(input.workspacePath, 'workspacePath'));
  const workspaceIdentity = safeRef(input.workspaceIdentity, 'workspaceIdentity');
  if (normalizedContext.workspacePath && path.resolve(normalizedContext.workspacePath) !== workspacePath) {
    throw new Error('Job workspacePath 与 Store 不一致');
  }
  if (normalizedContext.workspaceIdentity && normalizedContext.workspaceIdentity !== workspaceIdentity) {
    throw new Error('Job workspaceIdentity 与 Store 不一致');
  }
  const state = requiredString(input.state, 'state');
  if (!JOB_STATES.includes(state)) throw new Error('Job state 非法');
  const retryFrom = optionalString(input.retryFrom, 'retryFrom');
  if (retryFrom && !NON_TERMINAL_RETRY_STATES.has(retryFrom)) throw new Error('retryFrom 非法');
  if (state === 'failed' && !retryFrom) throw new Error('failed Job 必须有 retryFrom');
  if (retryFrom && !['failed', 'paused'].includes(state)) {
    throw new Error('retryFrom 只能存在于 failed 或 restart-paused Job');
  }
  const selectedFiles = normalizeSelectedFiles(arrayOrEmpty(input.selectedFiles, 'selectedFiles'));
  const transportIdentity = requiredExactString(input.transportIdentity, 'transportIdentity');
  assertNoSecretString(transportIdentity, 'transportIdentity');
  const offerId = safeRef(input.offerId, 'offerId');
  const intentId = safeRecordId(input.intentId, 'intentId');
  const expectedIdempotencyKey = deriveAcquisitionIdempotencyKey({
    workspaceIdentity, intentId, offerId, transportIdentity, selectedFiles,
  });
  const suppliedIdempotencyKey = input.idempotencyKey === undefined || input.idempotencyKey === ''
    ? '' : requiredExactString(input.idempotencyKey, 'idempotencyKey');
  if ((context.durableRecord === true && suppliedIdempotencyKey !== expectedIdempotencyKey)
    || (context.durableRecord !== true && suppliedIdempotencyKey
      && suppliedIdempotencyKey !== expectedIdempotencyKey)) {
    throw new Error('Job idempotencyKey 与身份材料不一致');
  }
  const idempotencyAliases = [...new Set(arrayOrEmpty(input.idempotencyAliases, 'idempotencyAliases')
    .map((alias, index) => requiredExactString(alias, `idempotencyAliases[${index}]`)))]
    .sort((left, right) => left.localeCompare(right, 'en'));
  for (const alias of idempotencyAliases) {
    if (!/^acq-[a-f0-9]{64}$/.test(alias)) throw new Error('Job idempotencyAliases 非法');
    if (alias === expectedIdempotencyKey) throw new Error('Job idempotencyAliases 不得重复当前键');
  }
  const preSelectionKey = selectedFiles.length
    ? deriveAcquisitionIdempotencyKey({
      workspaceIdentity, intentId, offerId, transportIdentity, selectedFiles: [],
    })
    : '';
  if (idempotencyAliases.length > 1
    || idempotencyAliases.some(alias => alias !== preSelectionKey)) {
    throw new Error('Job idempotencyAliases 只能保存可推导的选档前请求键');
  }
  if (context.durableRecord === true && selectedFiles.length
    && (idempotencyAliases.length !== 1 || idempotencyAliases[0] !== preSelectionKey)) {
    throw new Error('已定稿 Job 必须保存同一 intent 的选档前请求 alias');
  }
  if ((state === 'awaiting-selection' || (state === 'failed' && retryFrom === 'awaiting-selection'))
    && selectedFiles.length) {
    throw new Error('awaiting-selection Job 尚未定稿 selectedFiles');
  }
  let candidateRights = context.rights || null;
  let candidateFingerprint = input.candidateFingerprint === undefined || input.candidateFingerprint === ''
    ? '' : safeRef(input.candidateFingerprint, 'candidateFingerprint');
  if (candidateFingerprint && !/^candidate-sha256-[a-f0-9]{64}$/.test(candidateFingerprint)) {
    throw new Error('Job candidateFingerprint 必须是完整 Candidate SHA-256 快照指纹');
  }
  if (context.candidate) {
    const candidate = normalizeCandidate(context.candidate);
    const expectedCandidateFingerprint = `candidate-sha256-${sha256Text(stableJson(candidate))}`;
    if (candidateFingerprint && candidateFingerprint !== expectedCandidateFingerprint) {
      throw new Error('Job candidateFingerprint 与创建时 Candidate 快照不匹配');
    }
    candidateFingerprint = expectedCandidateFingerprint;
    if (candidate.candidateId !== input.candidateId) throw new Error('Job candidateId 不匹配');
    const offer = candidate.offers.find(item => item.offerId === offerId);
    if (!offer || offer.providerId !== input.providerId || offer.transport !== input.transport) {
      throw new Error('Job Offer 引用不匹配');
    }
    if (deriveTransportIdentity(offer) !== transportIdentity) {
      throw new Error('Job transportIdentity 与 Offer 不匹配');
    }
    if (offer.selectableFiles.length && selectedFiles.some(file => !offer.selectableFiles.includes(file))) {
      throw new Error('Job selectedFiles 不属于 Offer');
    }
    candidateRights = candidate.rights;
  }
  if (!candidateFingerprint) throw new Error('Job 必须绑定 Candidate 快照指纹');
  const rightsStatus = requiredString(input.rightsStatus, 'rightsStatus');
  if (!RIGHTS_STATUSES.includes(rightsStatus)) throw new Error('Job rightsStatus 非法');
  if (candidateRights && candidateRights.status !== rightsStatus) throw new Error('Job rightsStatus 与 Candidate 不一致');
  const rightsReceipt = normalizeRightsReceipt(input.rightsReceipt, candidateRights ? { rights: candidateRights } : {});
  if (candidateRights) assertRightsState(candidateRights, state, rightsReceipt, retryFrom);
  else assertDurableRightsState(rightsStatus, state, rightsReceipt, retryFrom);
  const resourcesRoot = normalizedContext.resourcesRoot;
  const libraryRoot = normalizedContext.libraryRoot || path.join(workspacePath, '书库');
  const stagingRoot = normalizedContext.stagingRoot || path.join(libraryRoot, '.resources', 'staging');
  const stagingPath = input.stagingPath === undefined || input.stagingPath === ''
    ? '' : assertPathInside(stagingRoot, input.stagingPath, 'stagingPath');
  const finalPath = input.finalPath === undefined || input.finalPath === ''
    ? '' : assertPathInside(libraryRoot, input.finalPath, 'finalPath');
  if (finalPath && resourcesRoot && (finalPath === resourcesRoot || isPathInside(resourcesRoot, finalPath))) {
    throw new Error('finalPath 不得位于 .resources 内部账');
  }
  const durableRecord = context.durableRecord === true;
  const createdAt = durableRecord
    ? iso(input.createdAt, 'createdAt')
    : (input.createdAt === undefined ? nowIso(context.now, 'now') : iso(input.createdAt, 'createdAt'));
  const updatedAt = durableRecord
    ? iso(input.updatedAt, 'updatedAt')
    : (input.updatedAt === undefined ? createdAt : iso(input.updatedAt, 'updatedAt'));
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error('updatedAt 不得早于 createdAt');
  const normalizedError = normalizeJobError(input.error);
  if (state === 'failed' && !normalizedError) throw new Error('failed Job 必须有脱敏 error');
  return deepFreeze({
    schema: JOB_SCHEMA,
    revision: positiveRevision(durableRecord ? input.revision : (input.revision ?? 1)),
    jobId: safeRecordId(input.jobId, 'jobId'),
    intentId,
    idempotencyKey: expectedIdempotencyKey,
    idempotencyAliases,
    workspaceIdentity,
    workspacePath,
    candidateId: safeRef(input.candidateId, 'candidateId'),
    candidateFingerprint,
    offerId,
    providerId: safeRef(input.providerId, 'providerId'),
    transport: normalizeTransport(input.transport),
    transportIdentity,
    selectedFiles,
    rightsStatus,
    rightsReceipt,
    state,
    retryFrom: retryFrom || null,
    bytes: normalizeBytes(input.bytes),
    error: normalizedError,
    integrity: normalizeIntegrity(objectOrEmpty(input.integrity, 'integrity')),
    stagingPath,
    finalPath,
    bookId: input.bookId === undefined || input.bookId === '' ? '' : safeRef(input.bookId, 'bookId'),
    createdAt,
    updatedAt,
  });
}

function assertJobTransition(fromInput, toInput, options = {}) {
  const from = typeof fromInput === 'string' ? fromInput : fromInput?.state;
  const to = typeof toInput === 'string' ? toInput : toInput?.state;
  if (!JOB_STATES.includes(from) || !JOB_STATES.includes(to)) throw new Error('Job 状态非法');
  if (from === to) return true;
  if (TERMINAL_JOB_STATES.includes(from)) throw new Error(`${from} 是终态`);
  const retryFrom = options.retryFrom || (typeof fromInput === 'object' ? fromInput.retryFrom : '');
  if (options.restartRecovery === true && RESTART_PAUSE_STATES.includes(from)
    && to === 'paused' && retryFrom === from) return true;
  if (to === 'failed') {
    if (retryFrom !== from) throw new Error('failed 必须把原状态保存为 retryFrom');
    return true;
  }
  if (from === 'failed') {
    if (to === 'cancelled') return true;
    if (!retryFrom || to !== retryFrom || !NON_TERMINAL_RETRY_STATES.has(to)) {
      throw new Error('failed 只能回到 retryFrom 指定的合法非终态');
    }
    return true;
  }
  if (from === 'paused' && retryFrom) {
    if (to === 'cancelled') return true;
    if (to !== retryFrom || !NON_TERMINAL_RETRY_STATES.has(to)) {
      throw new Error('restart-paused 只能回到 retryFrom 指定的合法非终态');
    }
    return true;
  }
  if (!JOB_TRANSITIONS[from].includes(to)) throw new Error(`非法 Job 状态迁移：${from} → ${to}`);
  return true;
}

function recoverJobAfterRestart(jobInput, options = {}) {
  const context = typeof options === 'string' || options instanceof Date ? { now: options } : options;
  const job = normalizeJob(jobInput, context);
  if (!RESTART_PAUSE_STATES.includes(job.state)) return job;
  const updated = {
    ...job,
    revision: job.revision + 1,
    state: 'paused',
    retryFrom: job.state,
    error: {
      code: 'APP_RESTART_RECOVERY',
      message: '应用重启后任务已安全暂停，可继续执行',
    },
    updatedAt: nowIso(context.now, 'now'),
  };
  return normalizeJob(updated, context);
}

function normalizeInboxReceipt(input, context = {}) {
  plainObject(input, 'Inbox Receipt', INBOX_FIELDS);
  assertCompleteDurableRecord(input, INBOX_FIELDS, 'Inbox Receipt', context);
  assertDurableInboxEnvelopeTypes(input, context);
  assertNoSecrets(input, 'Inbox Receipt');
  if (input.schema !== INBOX_SCHEMA) throw new Error('Inbox Receipt schema 非法');
  const normalizedContext = normalizeContext(context);
  const workspaceIdentity = safeRef(input.workspaceIdentity, 'workspaceIdentity');
  if (normalizedContext.workspaceIdentity && normalizedContext.workspaceIdentity !== workspaceIdentity) {
    throw new Error('Inbox workspaceIdentity 与 Store 不一致');
  }
  const state = requiredString(input.state, 'Inbox state');
  if (!['pending', 'acknowledged'].includes(state)) throw new Error('Inbox state 非法');
  plainObject(input.artifact, 'artifact', ARTIFACT_FIELDS);
  const libraryRoot = normalizedContext.libraryRoot;
  const artifactPath = libraryRoot
    ? assertPathInside(libraryRoot, input.artifact.path, 'artifact.path')
    : assertSafeAbsolutePath(input.artifact.path, 'artifact.path');
  const resourcesRoot = normalizedContext.resourcesRoot;
  if (resourcesRoot && (artifactPath === resourcesRoot || isPathInside(resourcesRoot, artifactPath))) {
    throw new Error('Inbox artifact 不得位于 .resources 内部账');
  }
  const acknowledgedAt = input.acknowledgedAt == null || input.acknowledgedAt === ''
    ? null : iso(input.acknowledgedAt, 'acknowledgedAt');
  if (state === 'pending' && acknowledgedAt) throw new Error('pending Receipt 不得有 acknowledgedAt');
  if (state === 'acknowledged' && !acknowledgedAt) throw new Error('acknowledged Receipt 必须有 acknowledgedAt');
  const durableRecord = context.durableRecord === true;
  const createdAt = durableRecord
    ? iso(input.createdAt, 'createdAt')
    : (input.createdAt === undefined ? nowIso(context.now, 'now') : iso(input.createdAt, 'createdAt'));
  if (acknowledgedAt && Date.parse(acknowledgedAt) < Date.parse(createdAt)) {
    throw new Error('acknowledgedAt 不得早于 createdAt');
  }
  return deepFreeze({
    schema: INBOX_SCHEMA,
    revision: positiveRevision(durableRecord ? input.revision : (input.revision ?? 1)),
    receiptId: safeRecordId(input.receiptId, 'receiptId'),
    jobId: safeRecordId(input.jobId, 'jobId'),
    workspaceIdentity,
    kind: safeRef(input.kind, 'kind'),
    state,
    artifact: deepFreeze({
      path: artifactPath,
      sha256: normalizeSha256(input.artifact.sha256, 'artifact.sha256'),
      size: nonNegativeInteger(input.artifact.size, 'artifact.size'),
      format: normalizeFormat(input.artifact.format, 'artifact.format'),
    }),
    createdAt,
    acknowledgedAt,
  });
}

function acknowledgeInboxReceipt(receiptInput, options = {}) {
  const receipt = normalizeInboxReceipt(receiptInput, options);
  if (receipt.state === 'acknowledged') return receipt;
  return normalizeInboxReceipt({
    ...receipt,
    revision: receipt.revision + 1,
    state: 'acknowledged',
    acknowledgedAt: nowIso(options.now, 'now'),
  }, options);
}

function isTerminalJobState(state) {
  return TERMINAL_JOB_STATES.includes(state);
}

module.exports = {
  CANDIDATE_SCHEMA,
  JOB_SCHEMA,
  INBOX_SCHEMA,
  FORMATS,
  TRANSPORTS,
  RIGHTS_STATUSES,
  PASSING_RIGHTS_STATUSES,
  JOB_STATES,
  TERMINAL_JOB_STATES,
  RESTART_PAUSE_STATES,
  JOB_TRANSITIONS,
  stableJson,
  assertNoSecretString,
  assertNoSecrets,
  isPublicHostname,
  assertHttpsPublicUrl,
  normalizeRelativePosixPath,
  normalizeSelectedFiles,
  normalizeIdentifiers,
  normalizeSha256,
  normalizeInfoHash,
  normalizeChecksum,
  deriveWorkId,
  deriveEditionId,
  deriveBlobId,
  deriveTransportIdentity,
  deriveOfferId,
  deriveWorkspaceIdentity,
  deriveCandidateFingerprint,
  deriveAcquisitionIdempotencyKey,
  normalizeRights,
  normalizeRightsReceipt,
  normalizeCandidate,
  isPathInside,
  assertPathInside,
  stateNeedsRightsReceipt,
  assertRightsState,
  assertDurableRightsState,
  normalizeJobError,
  normalizeJob,
  assertJobTransition,
  recoverJobAfterRestart,
  normalizeInboxReceipt,
  acknowledgeInboxReceipt,
  isTerminalJobState,
};
