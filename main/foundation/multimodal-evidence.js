'use strict';

const crypto = require('node:crypto');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString, requiredString, stringList,
} = require('./plain-value');
const { createContentAnchor, resolveContentAnchor } = require('./addressable-evidence');

const MULTIMODAL_INDEX_SCHEMA = 'mazz.multimodal-evidence-index/v0';
const OBSERVATION_SCHEMA = 'mazz.evidence-observation/v0';
const INDEX_CHUNK_SCHEMA = 'mazz.evidence-index-chunk/v0';
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key)/i;

function assertNoSecrets(value, label, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) throw new Error(`${label} 禁止 secret 字段: ${childPath}`);
    assertNoSecrets(child, label, childPath);
  }
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

function normalizeObservation(input) {
  if (!isPlainObject(input)) throw new Error('Evidence Observation 必须是对象');
  assertKnownKeys(input, ['schema', 'observationId', 'anchorRef', 'ocrText', 'visualLabels', 'transcript', 'altText', 'perceptualHash', 'provenance', 'status'], 'Evidence Observation');
  assertNoSecrets(input, 'Evidence Observation');
  if (input.schema != null && input.schema !== OBSERVATION_SCHEMA) throw new Error(`不支持的 Observation schema: ${input.schema}`);
  const anchorRef = requiredString(input.anchorRef, 'anchorRef');
  const visualLabels = stringList(input.visualLabels || [], 'visualLabels');
  const row = {
    anchorRef,
    ocrText: optionalString(input.ocrText),
    visualLabels,
    transcript: optionalString(input.transcript),
    altText: optionalString(input.altText),
    perceptualHash: optionalString(input.perceptualHash),
  };
  if (!row.ocrText && !row.visualLabels.length && !row.transcript && !row.altText && !row.perceptualHash) throw new Error('Observation 至少需要一种可检索观察');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  return deepFreeze({
    schema: OBSERVATION_SCHEMA,
    observationId: optionalString(input.observationId) || `observation:${digest(row)}`,
    ...row,
    provenance: clonePlain(input.provenance, 'provenance'),
    status: optionalString(input.status) || 'active',
  });
}

function normalizeChunk(input) {
  if (!isPlainObject(input)) throw new Error('Evidence Index Chunk 必须是对象');
  assertKnownKeys(input, ['schema', 'chunkId', 'anchorRef', 'window', 'text', 'terms', 'provenance'], 'Evidence Index Chunk');
  assertNoSecrets(input, 'Evidence Index Chunk');
  if (input.schema != null && input.schema !== INDEX_CHUNK_SCHEMA) throw new Error(`不支持的 Chunk schema: ${input.schema}`);
  if (!isPlainObject(input.window)) throw new Error('window 必须是对象');
  assertKnownKeys(input.window, ['start', 'end'], 'Chunk window');
  const start = Number(input.window.start), end = Number(input.window.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) throw new Error('Chunk window 非法');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  const anchorRef = requiredString(input.anchorRef, 'anchorRef');
  const text = requiredString(input.text, 'text');
  return deepFreeze({
    schema: INDEX_CHUNK_SCHEMA,
    chunkId: optionalString(input.chunkId) || `index-chunk:${digest({ anchorRef, start, end, text })}`,
    anchorRef, window: { start, end }, text,
    terms: stringList(input.terms || [], 'terms'),
    provenance: clonePlain(input.provenance, 'provenance'),
  });
}

function chunkObservation(observation, maxChars = 600) {
  const normalized = normalizeObservation(observation);
  const text = [normalized.ocrText, normalized.transcript, normalized.altText, ...normalized.visualLabels, normalized.perceptualHash].filter(Boolean).join('\n');
  if (!Number.isInteger(maxChars) || maxChars < 64 || maxChars > 10000) throw new Error('maxChars 必须是 64–10000 的整数');
  const chunks = [];
  for (let start = 0; start < text.length; start += maxChars) {
    const end = Math.min(text.length, start + maxChars);
    const window = text.slice(start, end);
    const terms = [...new Set(window.toLocaleLowerCase('zh-CN').split(/[\s,，。.!！？;；:：/\\]+/).filter(Boolean))].sort();
    chunks.push(normalizeChunk({
      anchorRef: normalized.anchorRef, window: { start, end }, text: window, terms,
      provenance: { source: 'multimodal-observation', observationId: normalized.observationId },
    }));
  }
  return chunks;
}

function buildMultimodalIndex({ anchors = [], observations = [], maxChars = 600, builtAt = '' } = {}) {
  const normalizedAnchors = anchors.map(createContentAnchor);
  if (new Set(normalizedAnchors.map(item => item.anchorId)).size !== normalizedAnchors.length) throw new Error('Anchor ID 不能重复');
  const anchorIds = new Set(normalizedAnchors.map(item => item.anchorId));
  const normalizedObservations = observations.map(normalizeObservation);
  for (const observation of normalizedObservations) if (!anchorIds.has(observation.anchorRef)) throw new Error(`Observation Anchor 不存在: ${observation.anchorRef}`);
  const chunks = normalizedObservations.flatMap(item => chunkObservation(item, maxChars));
  return deepFreeze({
    schema: MULTIMODAL_INDEX_SCHEMA,
    anchors: normalizedAnchors,
    observations: normalizedObservations,
    chunks,
    builtAt: optionalString(builtAt),
    sourceOfTruth: 'domain-assets-and-observations',
    rebuildable: true,
    lazy: true,
    chunkIsAsset: false,
  });
}

function searchMultimodalIndex(index, query, { limit = 20 } = {}) {
  if (!isPlainObject(index) || index.schema !== MULTIMODAL_INDEX_SCHEMA) throw new Error('Multimodal Index schema 非法');
  const terms = requiredString(query, 'query').toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  const rows = [];
  for (const chunk of index.chunks) {
    const haystack = `${chunk.text}\n${chunk.terms.join(' ')}`.toLocaleLowerCase('zh-CN');
    const hits = terms.filter(term => haystack.includes(term));
    if (hits.length) rows.push({ anchorRef: chunk.anchorRef, chunkId: chunk.chunkId, score: hits.length / terms.length, reasons: hits.map(term => `term:${term}`), preview: chunk.text.slice(0, 180) });
  }
  rows.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
  return deepFreeze(rows.slice(0, limit));
}

function relocateEpub(anchorInput, snapshot) {
  const anchor = createContentAnchor(anchorInput);
  if (anchor.mediaType !== 'epub') throw new Error('relocateEpub 只接受 EPUB Anchor');
  if (!isPlainObject(snapshot)) throw new Error('EPUB snapshot 必须是对象');
  assertKnownKeys(snapshot, ['assetId', 'spineItems', 'layout'], 'EPUB snapshot');
  const item = (snapshot.spineItems || []).find(row => row.id === anchor.logicalLocation.spineItemId || row.href === anchor.logicalLocation.href);
  if (!item) return deepFreeze({ anchorId: anchor.anchorId, status: 'MISSING', method: 'epub:spine-missing', physicalLocation: null, evidence: [] });
  const exact = (item.cfiRanges || []).find(row => row.cfi === anchor.logicalLocation.cfi);
  if (exact) return deepFreeze({ anchorId: anchor.anchorId, status: 'RESOLVED', method: 'epub:cfi', physicalLocation: clonePlain(exact.physicalLocation || {}), evidence: ['spine-and-cfi'] });
  const quote = anchor.logicalLocation.textQuote || anchor.quote;
  const text = String(item.text || '');
  const first = quote ? text.indexOf(quote) : -1;
  const second = first >= 0 ? text.indexOf(quote, first + quote.length) : -1;
  if (first >= 0 && second < 0) return deepFreeze({ anchorId: anchor.anchorId, status: 'RESOLVED', method: 'epub:unique-quote', physicalLocation: { spineItemId: item.id, charRange: [first, first + quote.length], layoutRef: optionalString(snapshot.layout) }, evidence: ['spine-and-unique-quote'] });
  return deepFreeze({ anchorId: anchor.anchorId, status: second >= 0 ? 'AMBIGUOUS' : 'MISSING', method: 'epub:quote', physicalLocation: null, evidence: [second >= 0 ? 'quote-not-unique' : 'quote-missing'] });
}

function relocateMultimodal(anchor, snapshot) {
  const normalized = createContentAnchor(anchor);
  if (normalized.mediaType === 'epub') return relocateEpub(normalized, snapshot);
  return resolveContentAnchor(normalized, snapshot);
}

module.exports = {
  MULTIMODAL_INDEX_SCHEMA, OBSERVATION_SCHEMA, INDEX_CHUNK_SCHEMA,
  normalizeObservation, normalizeChunk, chunkObservation, buildMultimodalIndex, searchMultimodalIndex,
  relocateEpub, relocateMultimodal,
};
