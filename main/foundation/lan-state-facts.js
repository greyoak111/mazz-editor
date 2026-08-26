'use strict';

const crypto = require('node:crypto');
const { assertKnownKeys, deepFreeze, isPlainObject, requiredString } = require('./plain-value');

const STATE_FACT_SCHEMA = 'mazz.lan-state-fact/v0';
const FACT_KINDS = new Set(['relation', 'context', 'branch', 'event']);
const BAD = /(?:^|[\\/])\.\.?(?:[\\/]|$)|^(?:[A-Za-z]:[\\/]|\\\\|\/)|^(?:https?|file|ws|wss):\/\//i;
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function signatureDigest(fact) {
  return digest({ workspaceId: fact.workspaceId, factKind: fact.factKind, factId: fact.factId, revision: fact.revision, payloadRef: fact.payloadRef });
}
function verifyDefaultSignature(fact) {
  if (fact.signature.startsWith('sig:')) return fact.signature === `sig:${signatureDigest(fact)}`;
  return /^device:[A-Za-z0-9._-]+$/.test(fact.signature);
}
function stableRef(value, label) {
  const ref = requiredString(value, label);
  if (BAD.test(ref) || ref.includes('://') || ref.includes('..') || /[\r\n\t\s]/.test(ref)) throw new Error(`${label} 不得包含路径、网络定位器或空白`);
  return ref;
}

function normalizeStateFact(input, { workspaceId } = {}) {
  if (!isPlainObject(input)) throw new Error('LAN state fact 必须是对象');
  assertKnownKeys(input, ['schema', 'type', 'workspaceId', 'factKind', 'factId', 'revision', 'payloadRef', 'signature'], 'LAN state fact');
  if (input.schema != null && input.schema !== STATE_FACT_SCHEMA) throw new Error(`不支持的 state fact schema: ${input.schema}`);
  if (input.type != null && input.type !== 'state-fact') throw new Error('state fact type 非法');
  const actualWorkspace = stableRef(input.workspaceId, 'workspaceId');
  if (workspaceId != null && actualWorkspace !== workspaceId) throw new Error('state fact Workspace identity 不匹配');
  const factKind = requiredString(input.factKind, 'factKind');
  if (!FACT_KINDS.has(factKind)) throw new Error(`factKind 非法: ${factKind}`);
  const factId = stableRef(input.factId, 'factId');
  const revision = stableRef(input.revision, 'revision');
  const payloadRef = stableRef(input.payloadRef, 'payloadRef');
  const signature = stableRef(input.signature, 'signature');
  if (!signature.startsWith('sig:') && !signature.startsWith('device:')) throw new Error('signature 必须是 device/sig 身份引用');
  return deepFreeze({ schema: STATE_FACT_SCHEMA, type: 'state-fact', workspaceId: actualWorkspace, factKind, factId, revision, payloadRef, signature });
}

function mergeStateFacts(existing = [], incoming = [], { workspaceId, verifySignature } = {}) {
  const accepted = [], rejected = [], duplicates = [], conflicts = [];
  // Keep every known revision under one logical fact key.  The previous
  // implementation collapsed an existing conflict to whichever row happened
  // to be visited last; reopening then made a harmless replay look like a new
  // conflict.  Buckets make duplicate, out-of-order and reconnect replays
  // deterministic while retaining each divergent fact for later human review.
  const buckets = new Map();
  const logicalKey = fact => `${fact.factKind}:${fact.factId}`;
  const variantKey = fact => `${fact.revision}\u0000${fact.payloadRef}`;
  const addExisting = fact => {
    const key = logicalKey(fact);
    const bucket = buckets.get(key) || new Map();
    bucket.set(variantKey(fact), fact);
    buckets.set(key, bucket);
  };
  for (const raw of (Array.isArray(existing) ? existing : [])) {
    try { addExisting(normalizeStateFact(raw, { workspaceId })); }
    catch { /* existing corrupted entries are not re-published */ }
  }
  for (const raw of (Array.isArray(incoming) ? incoming : [])) {
    let fact;
    try {
      fact = normalizeStateFact(raw, { workspaceId });
      const verifier = typeof verifySignature === 'function' ? verifySignature : verifyDefaultSignature;
      if (verifier(fact) !== true) throw new Error('signature rejected');
    } catch (error) { rejected.push({ factId: String(raw?.factId || ''), reason: error.message }); continue; }
    const key = logicalKey(fact);
    const bucket = buckets.get(key) || new Map();
    const variant = variantKey(fact);
    if (bucket.has(variant)) { duplicates.push(fact); continue; }
    if (bucket.size) {
      const allFacts = [...bucket.values(), fact].sort((a, b) => `${a.revision}:${a.payloadRef}`.localeCompare(`${b.revision}:${b.payloadRef}`));
      conflicts.push({ key, revisions: [...new Set(allFacts.map(row => row.revision))].sort(), facts: allFacts });
    }
    bucket.set(variant, fact);
    buckets.set(key, bucket);
    accepted.push(fact);
  }
  const facts = [...buckets.values()].flatMap(bucket => [...bucket.values()])
    .sort((a, b) => `${a.factKind}:${a.factId}:${a.revision}:${a.payloadRef}`.localeCompare(`${b.factKind}:${b.factId}:${b.revision}:${b.payloadRef}`));
  return deepFreeze({ facts, accepted, rejected, duplicates, conflicts, offline: true, pending: rejected.length === 0 && conflicts.length === 0 ? false : true });
}

function createStateFact(input = {}) {
  const body = { ...input, type: 'state-fact', schema: STATE_FACT_SCHEMA };
  if (!body.signature) body.signature = `sig:${signatureDigest(body)}`;
  return normalizeStateFact(body);
}

module.exports = { STATE_FACT_SCHEMA, FACT_KINDS, normalizeStateFact, mergeStateFacts, createStateFact };
