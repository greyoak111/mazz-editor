'use strict';

const crypto = require('node:crypto');
const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  optionalString,
  requiredString,
} = require('./plain-value');

const CONTENT_ANCHOR_SCHEMA = 'mazz.content-anchor/v0';
const LIVE_REFERENCE_SCHEMA = 'mazz.live-reference/v0';
const ANCHOR_RESOLUTION_SCHEMA = 'mazz.anchor-resolution/v0';
const REFERENCE_INDEX_SCHEMA = 'mazz.reference-index/v0';

const MEDIA_TYPES = new Set([
  'markdown', 'sheet', 'mindmap', 'code', 'pdf', 'epub', 'comic', 'image',
  'video', 'audio', 'conversation', 'browser',
]);
const ANCHOR_STATUSES = new Set(['active', 'stale', 'missing', 'superseded']);
const ANCHOR_FIELDS = [
  'schema', 'anchorId', 'assetId', 'mediaType', 'logicalLocation', 'physicalLocation',
  'quote', 'context', 'provenance', 'resolver', 'status', 'updatedAt',
];
const LOGICAL_FIELDS = [
  'kind', 'blockId', 'headingPath', 'sheetId', 'cellRange', 'nodeId', 'symbol',
  'lineStart', 'lineEnd', 'page', 'spineItemId', 'href', 'cfi', 'domPath',
  'charRange', 'panelId', 'bbox', 'startMs', 'endMs', 'episodeId', 'messageId',
  'turnId', 'canonicalUrl', 'textQuote',
];
const PHYSICAL_FIELDS = [
  'path', 'page', 'bbox', 'charRange', 'domPath', 'lineStart', 'lineEnd', 'sheetId',
  'cellRange', 'nodeId', 'startMs', 'endMs', 'layoutRef',
];
const REFERENCE_FIELDS = [
  'schema', 'referenceId', 'sourceAssetId', 'sourceAnchorId', 'targetAssetRef',
  'targetAnchorRef', 'relationType', 'provenance', 'status',
];
const TARGET_FIELDS = ['assetId', 'text', 'sheets', 'roots', 'durationMs', 'selectors'];
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key)/i;

function assertNoSecrets(value, label, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) throw new Error(`${label} 禁止 secret 字段: ${childPath}`);
    assertNoSecrets(child, label, childPath);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}

function normalizePair(value, label, { integer = true, min = 0 } = {}) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} 必须是二元数组`);
  const result = value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min) {
      throw new Error(`${label}[${index}] 非法`);
    }
    return number;
  });
  if (result[1] < result[0]) throw new Error(`${label} 终点不能早于起点`);
  return result;
}

function normalizeBbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4) throw new Error(`${label} 必须是 [x,y,width,height]`);
  const result = value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label}[${index}] 非法`);
    return number;
  });
  if (result[2] <= 0 || result[3] <= 0) throw new Error(`${label} 宽高必须大于 0`);
  return result;
}

function normalizeLogicalLocation(value, mediaType) {
  if (!isPlainObject(value)) throw new Error('logicalLocation 必须是对象');
  assertKnownKeys(value, LOGICAL_FIELDS, 'logicalLocation');
  assertNoSecrets(value, 'logicalLocation');
  const out = clonePlain(value, 'logicalLocation');
  out.kind = requiredString(out.kind, 'logicalLocation.kind');
  if (out.headingPath != null) {
    if (!Array.isArray(out.headingPath) || !out.headingPath.length) throw new Error('headingPath 必须是非空数组');
    out.headingPath = out.headingPath.map((item, index) => requiredString(item, `headingPath[${index}]`));
  }
  if (out.charRange != null) out.charRange = normalizePair(out.charRange, 'logicalLocation.charRange');
  if (out.bbox != null) out.bbox = normalizeBbox(out.bbox, 'logicalLocation.bbox');
  if (out.lineStart != null) out.lineStart = normalizePositiveInteger(out.lineStart, 'logicalLocation.lineStart');
  if (out.lineEnd != null) out.lineEnd = normalizePositiveInteger(out.lineEnd, 'logicalLocation.lineEnd');
  if (out.lineEnd != null && out.lineStart != null && out.lineEnd < out.lineStart) throw new Error('lineEnd 不能早于 lineStart');
  if (out.page != null) out.page = normalizePositiveInteger(out.page, 'logicalLocation.page');
  if (out.startMs != null) out.startMs = normalizeNonNegativeInteger(out.startMs, 'logicalLocation.startMs');
  if (out.endMs != null) out.endMs = normalizeNonNegativeInteger(out.endMs, 'logicalLocation.endMs');
  if (out.endMs != null && out.startMs != null && out.endMs < out.startMs) throw new Error('endMs 不能早于 startMs');

  const requirements = {
    markdown: () => out.blockId || out.headingPath || out.textQuote,
    sheet: () => out.sheetId && out.cellRange,
    mindmap: () => out.nodeId,
    code: () => out.symbol || out.lineStart,
    pdf: () => out.page && (out.textQuote || out.bbox || out.charRange),
    epub: () => out.spineItemId && (out.cfi || out.domPath || out.textQuote),
    comic: () => out.page && (out.panelId || out.bbox),
    image: () => out.bbox,
    video: () => out.startMs != null,
    audio: () => out.startMs != null,
    conversation: () => out.messageId || out.turnId,
    browser: () => out.canonicalUrl && (out.domPath || out.textQuote),
  };
  if (!requirements[mediaType]?.()) throw new Error(`${mediaType} logicalLocation 缺稳定选择器`);
  return out;
}

function normalizePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} 必须是正整数`);
  return number;
}

function normalizeNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} 必须是非负整数`);
  return number;
}

function normalizePhysicalLocation(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw new Error('physicalLocation 必须是对象');
  assertKnownKeys(value, PHYSICAL_FIELDS, 'physicalLocation');
  assertNoSecrets(value, 'physicalLocation');
  const out = clonePlain(value, 'physicalLocation');
  if (out.charRange != null) out.charRange = normalizePair(out.charRange, 'physicalLocation.charRange');
  if (out.bbox != null) out.bbox = normalizeBbox(out.bbox, 'physicalLocation.bbox');
  return out;
}

function createContentAnchor(input) {
  if (!isPlainObject(input)) throw new Error('Content Anchor 必须是对象');
  assertKnownKeys(input, ANCHOR_FIELDS, 'Content Anchor');
  assertNoSecrets(input, 'Content Anchor');
  if (input.schema != null && input.schema !== CONTENT_ANCHOR_SCHEMA) throw new Error(`不支持的 Anchor schema: ${input.schema}`);
  const assetId = requiredString(input.assetId, 'assetId');
  const mediaType = requiredString(input.mediaType, 'mediaType');
  if (!MEDIA_TYPES.has(mediaType)) throw new Error(`不支持的 mediaType: ${mediaType}`);
  const logicalLocation = normalizeLogicalLocation(input.logicalLocation, mediaType);
  const expectedId = `anchor:${digest({ assetId, mediaType, logicalLocation })}`;
  const anchorId = optionalString(input.anchorId) || expectedId;
  if (anchorId !== expectedId) throw new Error('anchorId 与稳定逻辑位置不匹配');
  const status = optionalString(input.status) || 'active';
  if (!ANCHOR_STATUSES.has(status)) throw new Error(`非法 Anchor status: ${status}`);
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  if (!isPlainObject(input.resolver)) throw new Error('resolver 必须是对象');
  return deepFreeze({
    schema: CONTENT_ANCHOR_SCHEMA,
    anchorId,
    assetId,
    mediaType,
    logicalLocation,
    physicalLocation: normalizePhysicalLocation(input.physicalLocation),
    quote: optionalString(input.quote),
    context: input.context == null ? null : clonePlain(input.context, 'context'),
    provenance: clonePlain(input.provenance, 'provenance'),
    resolver: clonePlain(input.resolver, 'resolver'),
    status,
    updatedAt: optionalString(input.updatedAt),
  });
}

function createLiveReference(input) {
  if (!isPlainObject(input)) throw new Error('Live Reference 必须是对象');
  assertKnownKeys(input, REFERENCE_FIELDS, 'Live Reference');
  assertNoSecrets(input, 'Live Reference');
  if (input.schema != null && input.schema !== LIVE_REFERENCE_SCHEMA) throw new Error(`不支持的 Reference schema: ${input.schema}`);
  const row = {
    sourceAssetId: requiredString(input.sourceAssetId, 'sourceAssetId'),
    sourceAnchorId: requiredString(input.sourceAnchorId, 'sourceAnchorId'),
    targetAssetRef: requiredString(input.targetAssetRef, 'targetAssetRef'),
    targetAnchorRef: requiredString(input.targetAnchorRef, 'targetAnchorRef'),
    relationType: optionalString(input.relationType) || 'live-reference',
  };
  const expectedId = `reference:${digest(row)}`;
  const referenceId = optionalString(input.referenceId) || expectedId;
  if (referenceId !== expectedId) throw new Error('referenceId 与引用端点不匹配');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  const status = optionalString(input.status) || 'active';
  if (!ANCHOR_STATUSES.has(status)) throw new Error(`非法 Reference status: ${status}`);
  return deepFreeze({
    schema: LIVE_REFERENCE_SCHEMA,
    referenceId,
    ...row,
    provenance: clonePlain(input.provenance, 'provenance'),
    status,
  });
}

function enclosingMarkdownBlock(text, offset) {
  const before = text.slice(0, offset);
  const blockStart = Math.max(before.lastIndexOf('\n\n') + 2, 0);
  const afterBoundary = text.indexOf('\n\n', offset);
  const blockEnd = afterBoundary < 0 ? text.length : afterBoundary;
  const block = text.slice(blockStart, blockEnd);
  const explicit = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]{0,127})(?:\s|$)/m.exec(block)?.[1] || '';
  return { blockStart, blockEnd, block, explicit };
}

function parseLiveReferences(markdown, sourceAssetId) {
  const text = String(markdown || '');
  const assetId = requiredString(sourceAssetId, 'sourceAssetId');
  const matches = [];
  const pattern = /\{\{ref:([^!{}\r\n]+)!([^{}\r\n]+)\}\}/g;
  let match;
  while ((match = pattern.exec(text))) {
    const targetAssetRef = match[1].trim();
    const targetAnchorRef = match[2].trim();
    if (!targetAssetRef || !targetAnchorRef) continue;
    const block = enclosingMarkdownBlock(text, match.index);
    const sourceAnchor = createContentAnchor({
      assetId,
      mediaType: 'markdown',
      logicalLocation: block.explicit
        ? { kind: 'markdown-block', blockId: block.explicit }
        : { kind: 'markdown-quote', textQuote: block.block.trim().slice(0, 500) || match[0] },
      physicalLocation: { charRange: [block.blockStart, block.blockEnd] },
      quote: block.block.trim().slice(0, 500),
      provenance: { source: 'w63-markdown-parser', syntax: match[0] },
      resolver: { strategy: block.explicit ? 'block-id-then-quote' : 'quote-then-context' },
      status: 'active',
    });
    matches.push(createLiveReference({
      sourceAssetId: assetId,
      sourceAnchorId: sourceAnchor.anchorId,
      targetAssetRef,
      targetAnchorRef,
      provenance: { source: 'w63-markdown-parser', charRange: [match.index, match.index + match[0].length] },
    }));
  }
  return deepFreeze(matches);
}

function occurrenceIndexes(text, needle) {
  const indexes = [];
  if (!needle) return indexes;
  let cursor = 0;
  while (cursor <= text.length) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) break;
    indexes.push(index);
    cursor = index + Math.max(needle.length, 1);
  }
  return indexes;
}

function resolution(anchor, status, method, physicalLocation = null, evidence = []) {
  return deepFreeze({
    schema: ANCHOR_RESOLUTION_SCHEMA,
    anchorId: anchor.anchorId,
    assetId: anchor.assetId,
    status,
    method,
    physicalLocation,
    evidence: [...evidence],
  });
}

function resolveMarkdown(anchor, text) {
  const logical = anchor.logicalLocation;
  if (logical.blockId) {
    const pattern = new RegExp(`(?:^|\\s)\\^${logical.blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'm');
    const hit = pattern.exec(text);
    if (hit) {
      const block = enclosingMarkdownBlock(text, hit.index);
      return resolution(anchor, 'RESOLVED', 'markdown:block-id', { charRange: [block.blockStart, block.blockEnd] }, ['exact-block-id']);
    }
  }
  const quote = logical.textQuote || anchor.quote;
  const hits = occurrenceIndexes(text, quote);
  if (hits.length === 1) return resolution(anchor, 'RESOLVED', 'markdown:unique-quote', { charRange: [hits[0], hits[0] + quote.length] }, ['unique-text-quote']);
  if (hits.length > 1) return resolution(anchor, 'AMBIGUOUS', 'markdown:quote', null, [`quote-occurrences:${hits.length}`]);
  if (logical.headingPath?.length) {
    const heading = logical.headingPath.at(-1);
    const linePattern = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
    const hit = linePattern.exec(text);
    if (hit) return resolution(anchor, 'RESOLVED', 'markdown:heading-path', { charRange: [hit.index, hit.index + hit[0].length] }, ['heading-fallback']);
  }
  return resolution(anchor, 'MISSING', 'markdown:no-match', null, ['no-stable-selector-match']);
}

function findMindmapNode(roots, nodeId) {
  const stack = [...(Array.isArray(roots) ? roots : [])];
  while (stack.length) {
    const node = stack.shift();
    if (String(node?.id || '') === nodeId) return node;
    if (Array.isArray(node?.children)) stack.unshift(...node.children);
  }
  return null;
}

function resolveContentAnchor(anchorInput, target) {
  const anchor = createContentAnchor(anchorInput);
  if (!isPlainObject(target)) throw new Error('Anchor target 必须是对象');
  assertKnownKeys(target, TARGET_FIELDS, 'Anchor target');
  assertNoSecrets(target, 'Anchor target');
  const targetAssetId = requiredString(target.assetId, 'target.assetId');
  if (targetAssetId !== anchor.assetId) return resolution(anchor, 'MISSING', 'asset-id-mismatch', null, ['asset-id-mismatch']);
  if (anchor.mediaType === 'markdown') return resolveMarkdown(anchor, String(target.text || ''));
  if (anchor.mediaType === 'sheet') {
    const sheet = target.sheets?.[anchor.logicalLocation.sheetId];
    const exists = !!sheet && Object.prototype.hasOwnProperty.call(sheet, anchor.logicalLocation.cellRange);
    return exists
      ? resolution(anchor, 'RESOLVED', 'sheet:cell-range', { sheetId: anchor.logicalLocation.sheetId, cellRange: anchor.logicalLocation.cellRange }, ['cell-range-exists'])
      : resolution(anchor, 'MISSING', 'sheet:cell-range', null, ['cell-range-missing']);
  }
  if (anchor.mediaType === 'mindmap') {
    const node = findMindmapNode(target.roots, anchor.logicalLocation.nodeId);
    return node
      ? resolution(anchor, 'RESOLVED', 'mindmap:node-id', { nodeId: anchor.logicalLocation.nodeId }, ['node-id-exists'])
      : resolution(anchor, 'MISSING', 'mindmap:node-id', null, ['node-id-missing']);
  }
  if (['video', 'audio'].includes(anchor.mediaType)) {
    const durationMs = Number(target.durationMs);
    const startMs = anchor.logicalLocation.startMs;
    const endMs = anchor.logicalLocation.endMs ?? startMs;
    if (Number.isFinite(durationMs) && endMs <= durationMs) return resolution(anchor, 'RESOLVED', `${anchor.mediaType}:time-range`, { startMs, endMs }, ['time-range-within-duration']);
    return resolution(anchor, 'MISSING', `${anchor.mediaType}:time-range`, null, ['time-range-outside-duration']);
  }
  const selectors = Array.isArray(target.selectors) ? target.selectors : [];
  const logicalDigest = digest(anchor.logicalLocation);
  const hits = selectors.filter(item => digest(item?.logicalLocation || item) === logicalDigest);
  if (hits.length === 1) return resolution(anchor, 'RESOLVED', `${anchor.mediaType}:declared-selector`, clonePlain(hits[0].physicalLocation || anchor.physicalLocation), ['declared-selector-match']);
  if (hits.length > 1) return resolution(anchor, 'AMBIGUOUS', `${anchor.mediaType}:declared-selector`, null, [`selector-matches:${hits.length}`]);
  return resolution(anchor, 'MISSING', `${anchor.mediaType}:declared-selector`, null, ['selector-missing']);
}

function buildReferenceIndex(input) {
  if (!isPlainObject(input)) throw new Error('Reference Index input 必须是对象');
  assertKnownKeys(input, ['anchors', 'references', 'builtAt'], 'Reference Index input');
  const anchors = (input.anchors || []).map(createContentAnchor);
  const references = (input.references || []).map(createLiveReference);
  const anchorById = new Map(anchors.map(anchor => [anchor.anchorId, anchor]));
  if (anchorById.size !== anchors.length) throw new Error('Anchor ID 不能重复');
  if (new Set(references.map(ref => ref.referenceId)).size !== references.length) throw new Error('Reference ID 不能重复');
  const outgoing = {};
  const incoming = {};
  for (const ref of references) {
    (outgoing[ref.sourceAssetId] ||= []).push(ref.referenceId);
    (incoming[`${ref.targetAssetRef}!${ref.targetAnchorRef}`] ||= []).push(ref.referenceId);
  }
  for (const rows of [...Object.values(outgoing), ...Object.values(incoming)]) rows.sort();
  return deepFreeze({
    schema: REFERENCE_INDEX_SCHEMA,
    anchors: anchors.sort((a, b) => a.anchorId.localeCompare(b.anchorId)),
    references: references.sort((a, b) => a.referenceId.localeCompare(b.referenceId)),
    outgoing: canonical(outgoing),
    incoming: canonical(incoming),
    builtAt: optionalString(input.builtAt),
    rebuildable: true,
    sourceOfTruth: 'domain-files',
  });
}

function impactedReferences(index, changedAssetRef) {
  if (!isPlainObject(index) || index.schema !== REFERENCE_INDEX_SCHEMA) throw new Error('Reference Index schema 非法');
  const target = requiredString(changedAssetRef, 'changedAssetRef');
  return deepFreeze(index.references
    .filter(ref => ref.targetAssetRef === target || ref.sourceAssetId === target)
    .map(ref => ref.referenceId)
    .sort());
}

module.exports = {
  CONTENT_ANCHOR_SCHEMA,
  LIVE_REFERENCE_SCHEMA,
  ANCHOR_RESOLUTION_SCHEMA,
  REFERENCE_INDEX_SCHEMA,
  MEDIA_TYPES: Object.freeze([...MEDIA_TYPES]),
  createContentAnchor,
  createLiveReference,
  parseLiveReferences,
  resolveContentAnchor,
  buildReferenceIndex,
  impactedReferences,
};
