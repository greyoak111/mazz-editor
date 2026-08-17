'use strict';

const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  requiredString,
} = require('./plain-value');

const ASSET_ENVELOPE_SCHEMA = 'mazz.asset-envelope/v0';
const ASSET_FIELDS = Object.freeze([
  'schema', 'id', 'path', 'type', 'version', 'sourceRef', 'provenance', 'status', 'relations',
]);
const RELATION_FIELDS = Object.freeze(['type', 'targetId', 'sourceRef', 'provenance']);

function normalizeRelation(value, index) {
  if (!isPlainObject(value)) throw new Error(`relations[${index}] 必须是对象`);
  assertKnownKeys(value, RELATION_FIELDS, `relations[${index}]`);
  const relation = clonePlain(value, `relations[${index}]`);
  relation.type = requiredString(relation.type, `relations[${index}].type`);
  relation.targetId = requiredString(relation.targetId, `relations[${index}].targetId`);
  return relation;
}

function createAssetEnvelope(input) {
  if (!isPlainObject(input)) throw new Error('Asset Envelope 必须是对象');
  assertKnownKeys(input, ASSET_FIELDS, 'Asset Envelope');
  if (input.schema != null && input.schema !== ASSET_ENVELOPE_SCHEMA) {
    throw new Error(`不支持的 Asset Envelope schema: ${input.schema}`);
  }
  const id = requiredString(input.id, 'id');
  const assetPath = requiredString(input.path, 'path');
  const type = requiredString(input.type, 'type');
  const version = requiredString(input.version, 'version');
  const status = requiredString(input.status, 'status');
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  const relations = input.relations == null ? [] : input.relations;
  if (!Array.isArray(relations)) throw new Error('relations 必须是数组');
  const envelope = {
    schema: ASSET_ENVELOPE_SCHEMA,
    id,
    path: assetPath,
    type,
    version,
    sourceRef: input.sourceRef == null ? null : clonePlain(input.sourceRef, 'sourceRef'),
    provenance: clonePlain(input.provenance, 'provenance'),
    status,
    relations: relations.map(normalizeRelation),
  };
  return deepFreeze(envelope);
}

function isAssetEnvelope(value) {
  try {
    createAssetEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ASSET_ENVELOPE_SCHEMA,
  createAssetEnvelope,
  isAssetEnvelope,
};
