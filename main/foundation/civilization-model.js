'use strict';

const crypto = require('node:crypto');
const {
  assertKnownKeys, clonePlain, deepFreeze, isPlainObject, optionalString, requiredString, stringList,
} = require('./plain-value');

const MODEL_SCHEMA = 'mazz.civilization-model/v0';
const SIMULATION_SCHEMA = 'mazz.civilization-simulation/v0';
const NARRATIVE_POOL_SCHEMA = 'mazz.narrative-event-pool/v0';
const RECONCILIATION_SCHEMA = 'mazz.civilization-ledger-reconciliation/v0';
const CLASSES = new Set(['CANON', 'DERIVED', 'ADAPTATION', 'SIMULATION', 'NON_CANON']);
const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'truthy']);
const SECRET_KEY = /(?:api.?key|secret|token|authorization|password|credential|private.?key|cookie)$/i;

function canonical(value) { return Array.isArray(value) ? value.map(canonical) : isPlainObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex'); }
function finite(value, label, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) { const number = Number(value); if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} 非法`); return number; }
function iso(value, label) { const text = requiredString(value, label); const at = Date.parse(text); if (!Number.isFinite(at)) throw new Error(`${label} 必须是 ISO 时间`); return new Date(at).toISOString(); }
function assertNoSecrets(value, label, prefix = '') { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { const at = prefix ? `${prefix}.${key}` : key; if (SECRET_KEY.test(key)) throw new Error(`${label} 禁止 secret 字段: ${at}`); assertNoSecrets(child, label, at); } }
function className(value, label) { const name = requiredString(value, label).toUpperCase(); if (!CLASSES.has(name)) throw new Error(`${label} 非法`); return name; }

function normalizeState(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`states[${index}] 必须是对象`);
  assertKnownKeys(input, ['stateId', 'subjectRef', 'property', 'value', 'classification', 'evidenceRefs', 'authorityRef', 'sourceRef', 'updatedAt'], `states[${index}]`);
  assertNoSecrets(input, `states[${index}]`);
  const classification = className(input.classification, `states[${index}].classification`);
  const evidenceRefs = stringList(input.evidenceRefs || [], `states[${index}].evidenceRefs`); const authorityRef = optionalString(input.authorityRef);
  if (classification === 'CANON' && (!authorityRef.startsWith('human:') || !evidenceRefs.length)) throw new Error('CANON State 必须有 human Authority 和 Evidence');
  return deepFreeze({
    stateId: requiredString(input.stateId, `states[${index}].stateId`), subjectRef: requiredString(input.subjectRef, `states[${index}].subjectRef`),
    property: requiredString(input.property, `states[${index}].property`), value: clonePlain(input.value, `states[${index}].value`), classification,
    evidenceRefs, authorityRef, sourceRef: requiredString(input.sourceRef, `states[${index}].sourceRef`), updatedAt: iso(input.updatedAt, `states[${index}].updatedAt`),
  });
}
function normalizeConstraint(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`constraints[${index}] 必须是对象`);
  assertKnownKeys(input, ['constraintId', 'stateRef', 'op', 'value', 'reason', 'evidenceRefs'], `constraints[${index}]`);
  const op = requiredString(input.op, `constraints[${index}].op`); if (!OPS.has(op)) throw new Error(`constraints[${index}].op 非法`);
  return deepFreeze({ constraintId: requiredString(input.constraintId, `constraints[${index}].constraintId`), stateRef: requiredString(input.stateRef, `constraints[${index}].stateRef`), op, value: clonePlain(input.value, `constraints[${index}].value`), reason: requiredString(input.reason, `constraints[${index}].reason`), evidenceRefs: stringList(input.evidenceRefs || [], `constraints[${index}].evidenceRefs`) });
}
function normalizeRule(input, index = 0) {
  if (!isPlainObject(input)) throw new Error(`rules[${index}] 必须是对象`);
  assertKnownKeys(input, ['ruleId', 'inputStateRef', 'op', 'compareValue', 'outputSubjectRef', 'outputProperty', 'outputValue', 'evidenceRefs', 'explanation'], `rules[${index}]`);
  const op = requiredString(input.op, `rules[${index}].op`); if (!OPS.has(op)) throw new Error(`rules[${index}].op 非法`);
  const evidenceRefs = stringList(input.evidenceRefs || [], `rules[${index}].evidenceRefs`); if (!evidenceRefs.length) throw new Error(`rules[${index}] 必须有 Evidence`);
  return deepFreeze({ ruleId: requiredString(input.ruleId, `rules[${index}].ruleId`), inputStateRef: requiredString(input.inputStateRef, `rules[${index}].inputStateRef`), op, compareValue: clonePlain(input.compareValue, `rules[${index}].compareValue`), outputSubjectRef: requiredString(input.outputSubjectRef, `rules[${index}].outputSubjectRef`), outputProperty: requiredString(input.outputProperty, `rules[${index}].outputProperty`), outputValue: clonePlain(input.outputValue, `rules[${index}].outputValue`), evidenceRefs, explanation: requiredString(input.explanation, `rules[${index}].explanation`) });
}
function normalizeModel(input) {
  if (!isPlainObject(input)) throw new Error('Civilization Model 必须是对象');
  assertKnownKeys(input, ['schema', 'modelId', 'title', 'states', 'constraints', 'rules', 'unknowns', 'provenance'], 'Civilization Model'); assertNoSecrets(input, 'Civilization Model');
  if (input.schema != null && input.schema !== MODEL_SCHEMA) throw new Error('Civilization Model schema 非法');
  const states = (input.states || []).map(normalizeState), constraints = (input.constraints || []).map(normalizeConstraint), rules = (input.rules || []).map(normalizeRule);
  for (const [label, rows, key] of [['states', states, 'stateId'], ['constraints', constraints, 'constraintId'], ['rules', rules, 'ruleId']]) { const ids = rows.map(row => row[key]); if (new Set(ids).size !== ids.length) throw new Error(`${label} ID 重复`); }
  const stateIds = new Set(states.map(row => row.stateId));
  for (const constraint of constraints) if (!stateIds.has(constraint.stateRef)) throw new Error(`Constraint 引用未知 State: ${constraint.stateRef}`);
  return deepFreeze({ schema: MODEL_SCHEMA, modelId: requiredString(input.modelId, 'modelId'), title: requiredString(input.title, 'title'), states, constraints, rules, unknowns: stringList(input.unknowns || [], 'unknowns'), provenance: clonePlain(input.provenance || {}, 'provenance') });
}
function matches(value, op, expected) {
  if (op === 'eq') return value === expected; if (op === 'neq') return value !== expected; if (op === 'truthy') return !!value;
  if (!['number', 'string'].includes(typeof value) || !['number', 'string'].includes(typeof expected)) return false;
  if (op === 'gt') return value > expected; if (op === 'gte') return value >= expected; if (op === 'lt') return value < expected; if (op === 'lte') return value <= expected; return false;
}
function normalizeChange(input) {
  if (!isPlainObject(input)) throw new Error('Change 必须是对象');
  assertKnownKeys(input, ['changeId', 'targetStateRef', 'value', 'classification', 'evidenceRefs', 'authorityRef', 'occurredAt'], 'Change'); assertNoSecrets(input, 'Change');
  const classification = className(input.classification || 'SIMULATION', 'change.classification');
  if (classification === 'CANON' && (!String(input.authorityRef || '').startsWith('human:') || !(input.evidenceRefs || []).length)) throw new Error('CANON Change 必须有 human Authority 和 Evidence');
  return deepFreeze({ changeId: requiredString(input.changeId, 'changeId'), targetStateRef: requiredString(input.targetStateRef, 'targetStateRef'), value: clonePlain(input.value, 'change.value'), classification, evidenceRefs: stringList(input.evidenceRefs || [], 'change.evidenceRefs'), authorityRef: optionalString(input.authorityRef), occurredAt: iso(input.occurredAt, 'change.occurredAt') });
}

function simulateCivilization(modelInput, changeInput, { maxDepth = 5 } = {}) {
  const model = normalizeModel(modelInput), change = normalizeChange(changeInput); const depthLimit = Math.floor(finite(maxDepth, 'maxDepth', 1, 5));
  const stateMap = new Map(model.states.map(row => [row.stateId, row])); const target = stateMap.get(change.targetStateRef);
  if (!target) return deepFreeze({ schema: SIMULATION_SCHEMA, simulationId: `simulation:${digest({ modelId: model.modelId, change })}`, modelId: model.modelId, change, status: 'UNKNOWN', effects: [], unknowns: [`MISSING_CHANGE_TARGET:${change.targetStateRef}`], eventPool: [], modelHashBefore: digest(model), modelMutated: false });
  const changed = { ...target, stateId: `${target.stateId}@${change.changeId}`, value: change.value, classification: change.classification, evidenceRefs: change.evidenceRefs, authorityRef: change.authorityRef, sourceRef: `change:${change.changeId}`, updatedAt: change.occurredAt };
  const effects = [{ effectId: `effect:${digest({ change: change.changeId, state: changed.stateId })}`, depth: 0, causeRef: change.changeId, ruleRef: '', state: changed, explanation: 'Explicit change input' }];
  const byOriginalRef = new Map([[target.stateId, changed]]); const applied = new Set(); const unknowns = [...model.unknowns];
  for (let depth = 1; depth <= depthLimit; depth++) {
    let added = 0;
    for (const rule of model.rules) {
      if (applied.has(rule.ruleId)) continue;
      const inputState = byOriginalRef.get(rule.inputStateRef) || (depth === 1 ? stateMap.get(rule.inputStateRef) : null);
      if (!inputState) { if (!stateMap.has(rule.inputStateRef)) unknowns.push(`MISSING_RULE_INPUT:${rule.ruleId}:${rule.inputStateRef}`); continue; }
      if (!effects.some(effect => effect.depth === depth - 1 && effect.state.stateId === inputState.stateId)) continue;
      if (!matches(inputState.value, rule.op, rule.compareValue)) continue;
      const original = model.states.find(row => row.subjectRef === rule.outputSubjectRef && row.property === rule.outputProperty);
      const originalRef = original?.stateId || `state:derived:${digest({ subject: rule.outputSubjectRef, property: rule.outputProperty })}`;
      const state = { stateId: `${originalRef}@${change.changeId}:${depth}`, subjectRef: rule.outputSubjectRef, property: rule.outputProperty, value: rule.outputValue, classification: 'DERIVED', evidenceRefs: rule.evidenceRefs, authorityRef: '', sourceRef: `rule:${rule.ruleId}`, updatedAt: change.occurredAt };
      effects.push({ effectId: `effect:${digest({ change: change.changeId, rule: rule.ruleId, depth })}`, depth, causeRef: inputState.stateId, ruleRef: rule.ruleId, state, explanation: rule.explanation });
      byOriginalRef.set(originalRef, state); applied.add(rule.ruleId); added++;
    }
    if (!added) break;
  }
  const eventPool = effects.filter(effect => effect.depth > 0).map(effect => ({
    eventId: `event-pool:${digest(effect)}`, effectRef: effect.effectId, classification: effect.state.classification,
    subjectRef: effect.state.subjectRef, property: effect.state.property, value: effect.state.value, evidenceRefs: effect.state.evidenceRefs,
    structuralConflict: /conflict|constraint|scarcity|tension/i.test(`${effect.state.property} ${effect.explanation}`),
    characterCost: /cost|casualty|migration|displacement|price/i.test(`${effect.state.property} ${effect.explanation}`),
    irreversibleChange: /irreversible|collapse|extinct|destroy/i.test(`${effect.state.property} ${effect.explanation}`),
    relationChange: /relation|alliance|trust|trade/i.test(`${effect.state.property} ${effect.explanation}`),
    thematicRelevance: 0,
  }));
  return deepFreeze({ schema: SIMULATION_SCHEMA, simulationId: `simulation:${digest({ modelId: model.modelId, change })}`, modelId: model.modelId, change, status: unknowns.length ? 'PARTIAL_WITH_UNKNOWNS' : 'COMPLETE', effects, unknowns: [...new Set(unknowns)].sort(), eventPool, modelHashBefore: digest(model), modelMutated: false });
}

function narrativeFilter(simulation, { themeTerms = [], limit = 20 } = {}) {
  if (!simulation || simulation.schema !== SIMULATION_SCHEMA) throw new Error('Narrative Filter 需要 Civilization Simulation');
  const terms = stringList(themeTerms, 'themeTerms').map(term => term.toLocaleLowerCase('zh-CN'));
  const rows = simulation.eventPool.map(event => {
    const corpus = `${event.subjectRef} ${event.property} ${JSON.stringify(event.value)}`.toLocaleLowerCase('zh-CN');
    const thematicRelevance = terms.length ? terms.filter(term => corpus.includes(term)).length / terms.length : 0;
    const score = Number(event.structuralConflict) * 3 + Number(event.characterCost) * 2.5 + Number(event.irreversibleChange) * 3 + Number(event.relationChange) * 2 + thematicRelevance;
    return { ...event, thematicRelevance, narrativeScore: score, reasons: [event.structuralConflict && 'structural-conflict', event.characterCost && 'character-cost', event.irreversibleChange && 'irreversible-change', event.relationChange && 'relation-change', thematicRelevance > 0 && 'theme-match'].filter(Boolean) };
  }).sort((a, b) => b.narrativeScore - a.narrativeScore || a.eventId.localeCompare(b.eventId)).slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)));
  return deepFreeze({ schema: NARRATIVE_POOL_SCHEMA, simulationRef: simulation.simulationId, events: rows, sourceEffectCount: simulation.effects.length, factMutationAllowed: false, modelHashBefore: simulation.modelHashBefore });
}

function reconcileLedgers({ model, simulation, narrative, evidenceRefs = [] } = {}) {
  const normalized = normalizeModel(model); const issues = [];
  if (!simulation || simulation.schema !== SIMULATION_SCHEMA || simulation.modelId !== normalized.modelId) issues.push('SIMULATION_MODEL_MISMATCH');
  if (simulation?.modelHashBefore && simulation.modelHashBefore !== digest(normalized)) issues.push('MODEL_HASH_MISMATCH');
  if (!narrative || narrative.schema !== NARRATIVE_POOL_SCHEMA || narrative.simulationRef !== simulation?.simulationId) issues.push('NARRATIVE_SIMULATION_MISMATCH');
  const knownEvidence = new Set(evidenceRefs);
  const missingEvidence = simulation?.effects?.flatMap(effect => effect.state.evidenceRefs || []).filter(ref => !knownEvidence.has(ref)) || [];
  if (missingEvidence.length) issues.push('MISSING_EVIDENCE');
  return deepFreeze({ schema: RECONCILIATION_SCHEMA, modelRef: normalized.modelId, simulationRef: simulation?.simulationId || '', narrativeRef: narrative?.simulationRef || '', status: issues.length ? 'UNKNOWN_OR_DIVERGED' : 'RECONCILED', issues: [...new Set(issues)], missingEvidence: [...new Set(missingEvidence)].sort(), modelRuntimeRenderingSeparated: true });
}

module.exports = { MODEL_SCHEMA, SIMULATION_SCHEMA, NARRATIVE_POOL_SCHEMA, RECONCILIATION_SCHEMA, CLASSES, normalizeState, normalizeConstraint, normalizeRule, normalizeModel, normalizeChange, simulateCivilization, narrativeFilter, reconcileLedgers };
