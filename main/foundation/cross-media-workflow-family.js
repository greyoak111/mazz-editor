'use strict';

const crypto = require('crypto');
const { assertKnownKeys, deepFreeze, isPlainObject, requiredString, stringList } = require('./plain-value');

const WORLD_CONTEXT_SCHEMA = 'mazz.world-production-context/v0';
const CROSS_MEDIA_FAMILY_SCHEMA = 'mazz.cross-media-workflow-family/v0';
const MEDIA_EDITION_SCHEMA = 'mazz.media-edition-plan/v0';
const MEDIA_KINDS = Object.freeze(['novel', 'comic', 'audio', 'animation']);
const SECRET_KEYS = /^(api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|token)$/i;

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((row, index) => rejectSecrets(row, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.test(key)) throw new Error(`Cross-media package 禁止 secret: ${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(child, trail ? `${trail}.${key}` : key);
  }
}

function required(value, label, max = 300) {
  const out = requiredString(value, label);
  if (out.length > max) throw new Error(`${label} 超过 ${max} 字符`);
  return out;
}

function strings(value, label, allowEmpty = false) {
  const out = stringList(value, label);
  if (!allowEmpty && !out.length) throw new Error(`${label} 不得为空`);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeWorldContext(input) {
  if (!isPlainObject(input)) throw new Error('World Context 必须是对象');
  rejectSecrets(input);
  assertKnownKeys(input, ['schema', 'worldId', 'version', 'branchId', 'canonEventIds', 'assetRefs', 'styleRefs', 'rightsRefs', 'lockedFactIds'], 'World Context');
  const world = {
    schema: WORLD_CONTEXT_SCHEMA,
    worldId: required(input.worldId, 'worldId'),
    version: required(input.version, 'version', 120),
    branchId: required(input.branchId, 'branchId', 160),
    canonEventIds: strings(input.canonEventIds, 'canonEventIds'),
    assetRefs: strings(input.assetRefs, 'assetRefs', true),
    styleRefs: strings(input.styleRefs, 'styleRefs', true),
    rightsRefs: strings(input.rightsRefs, 'rightsRefs'),
    lockedFactIds: strings(input.lockedFactIds, 'lockedFactIds'),
  };
  return deepFreeze({ ...world, digest: digest(world) });
}

function normalizeProfessionalProfile(input, index) {
  if (!isPlainObject(input)) throw new Error(`professionalProfiles[${index}] 必须是对象`);
  assertKnownKeys(input, ['mediaKind', 'workflowRef', 'artifactTypes', 'gateRefs', 'migrationPolicyRef'], `professionalProfiles[${index}]`);
  const mediaKind = required(input.mediaKind, `professionalProfiles[${index}].mediaKind`, 40);
  if (!MEDIA_KINDS.includes(mediaKind)) throw new Error(`不支持的媒体类型: ${mediaKind}`);
  return {
    mediaKind,
    workflowRef: required(input.workflowRef, `professionalProfiles[${index}].workflowRef`),
    artifactTypes: strings(input.artifactTypes, `professionalProfiles[${index}].artifactTypes`),
    gateRefs: strings(input.gateRefs, `professionalProfiles[${index}].gateRefs`),
    migrationPolicyRef: required(input.migrationPolicyRef, `professionalProfiles[${index}].migrationPolicyRef`),
  };
}

function createCrossMediaWorkflowFamily({ familyId = 'workflow-family:cross-media:v1', version = '1.0.0' } = {}) {
  const value = {
    schema: CROSS_MEDIA_FAMILY_SCHEMA,
    familyId: required(familyId, 'familyId'),
    version: required(version, 'version', 120),
    common: {
      inputTypes: ['world-context', 'event-selection', 'adaptation-policy', 'budget'],
      invariants: ['world-version-pinned', 'canon-never-auto-mutated', 'edition-anchor-isolated', 'edition-progress-isolated', 'rights-required'],
      artifactRefsAreSharedByReference: true,
      runtimeTruthOwner: 'W73',
    },
    professionalProfiles: [
      { mediaKind: 'novel', workflowRef: 'workflow:novel-edition:v1', artifactTypes: ['chapter-script', 'novel-chapter'], gateRefs: ['gate:continuity', 'gate:editorial'], migrationPolicyRef: 'migration:novel:v1' },
      { mediaKind: 'comic', workflowRef: 'workflow:comic-edition:v1', artifactTypes: ['comic-script', 'panel-layout', 'comic-chapter'], gateRefs: ['gate:visual-continuity', 'gate:lettering'], migrationPolicyRef: 'migration:comic:v1' },
      { mediaKind: 'audio', workflowRef: 'workflow:audio-edition:v1', artifactTypes: ['audio-script', 'voice-track', 'audio-master'], gateRefs: ['gate:voice-rights', 'gate:audio-qc'], migrationPolicyRef: 'migration:audio:v1' },
      { mediaKind: 'animation', workflowRef: 'workflow:mazz-local-animation-short:v1', artifactTypes: ['storyboard', 'visual-shot', 'audio-track', 'animation.local-master-manifest'], gateRefs: ['gate:preproduction', 'gate:timeline-qc', 'gate:master'], migrationPolicyRef: 'migration:animation:v1' },
    ].map(normalizeProfessionalProfile),
    migration: {
      commonFields: ['worldId', 'worldVersion', 'branchId', 'eventIds', 'lockedFactIds', 'rightsRefs'],
      professionalFieldsNeverCoerced: ['anchors', 'progress', 'artifactVersion', 'gateEvidence'],
      unsupportedTargetState: 'BLOCKED_PROFILE_MIGRATION_REQUIRED',
    },
  };
  return deepFreeze({ ...value, digest: digest(value) });
}

function createMediaEditionPlan({ editionId, mediaKind, world, eventIds, adaptationPolicyRef, outputArtifactRefs = [] }) {
  const normalizedWorld = normalizeWorldContext(world);
  const kind = required(mediaKind, 'mediaKind', 40);
  if (!MEDIA_KINDS.includes(kind)) throw new Error(`不支持的媒体类型: ${kind}`);
  const events = strings(eventIds, 'eventIds');
  for (const eventId of events) if (!normalizedWorld.canonEventIds.includes(eventId)) throw new Error(`Event 不在钉住的 World 版本: ${eventId}`);
  const id = required(editionId, 'editionId');
  const value = {
    schema: MEDIA_EDITION_SCHEMA,
    editionId: id,
    mediaKind: kind,
    worldRef: { worldId: normalizedWorld.worldId, version: normalizedWorld.version, branchId: normalizedWorld.branchId, digest: normalizedWorld.digest },
    eventIds: events,
    lockedFactIds: normalizedWorld.lockedFactIds,
    rightsRefs: normalizedWorld.rightsRefs,
    adaptationPolicyRef: required(adaptationPolicyRef, 'adaptationPolicyRef'),
    outputArtifactRefs: strings(outputArtifactRefs, 'outputArtifactRefs', true),
    anchorNamespace: `edition:${id}:anchors`,
    progressNamespace: `edition:${id}:progress`,
    publicationAuthorized: false,
    canonMutationAllowed: false,
  };
  return deepFreeze({ ...value, digest: digest(value) });
}

function inspectEditionIsolation(editions) {
  const rows = editions.map((item, index) => {
    if (!isPlainObject(item) || item.schema !== MEDIA_EDITION_SCHEMA) throw new Error(`editions[${index}] 不是 Media Edition`);
    return item;
  });
  const duplicate = key => rows.map(row => row[key]).find((value, index, all) => all.indexOf(value) !== index);
  const duplicateAnchor = duplicate('anchorNamespace');
  const duplicateProgress = duplicate('progressNamespace');
  return deepFreeze({
    isolated: !duplicateAnchor && !duplicateProgress,
    duplicateAnchor: duplicateAnchor || '', duplicateProgress: duplicateProgress || '',
    sharedEvents: [...new Set(rows.flatMap(row => row.eventIds))].sort(),
    canonMutationAllowed: false,
  });
}

function previewWorldMigration({ previous, next, editions }) {
  const from = normalizeWorldContext(previous);
  const to = normalizeWorldContext(next);
  if (from.worldId !== to.worldId) throw new Error('World migration 不得跨 semantic identity');
  const removedEvents = from.canonEventIds.filter(id => !to.canonEventIds.includes(id));
  const changedLocks = from.lockedFactIds.filter(id => !to.lockedFactIds.includes(id));
  const affectedEditionIds = editions.filter(row => row.worldRef?.worldId === from.worldId
    && row.eventIds.some(id => removedEvents.includes(id))).map(row => row.editionId).sort();
  return deepFreeze({
    fromVersion: from.version, toVersion: to.version,
    state: affectedEditionIds.length || changedLocks.length ? 'REVIEW_REQUIRED' : 'COMPATIBLE',
    removedEvents, changedLocks, affectedEditionIds,
    automaticCanonMutation: false, automaticEditionRewrite: false,
  });
}

module.exports = {
  WORLD_CONTEXT_SCHEMA, CROSS_MEDIA_FAMILY_SCHEMA, MEDIA_EDITION_SCHEMA, MEDIA_KINDS,
  createCrossMediaWorkflowFamily, normalizeWorldContext, createMediaEditionPlan,
  inspectEditionIsolation, previewWorldMigration, digest,
};
