'use strict';

const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  optionalString,
  requiredString,
  stringList,
} = require('./plain-value');

const CAPABILITY_PROVIDER_SCHEMA = 'mazz.capability-provider/v0';
const EXECUTION_MODES = Object.freeze(['embedded', 'cli', 'service', 'external']);
const COST_TYPES = Object.freeze(['local', 'api']);
const HEALTH_STATES = Object.freeze(['unknown', 'available', 'degraded', 'unavailable']);
const PROVIDER_FIELDS = Object.freeze([
  'schema', 'capabilityId', 'providerId', 'displayName', 'inputTypes', 'outputTypes',
  'agentUsable', 'execution', 'cost', 'health', 'provenance',
]);

function normalizeHealth(input = { status: 'unknown' }) {
  if (!isPlainObject(input)) throw new Error('health 必须是对象');
  assertKnownKeys(input, ['status', 'checkedAt', 'reason'], 'health');
  const status = requiredString(input.status || 'unknown', 'health.status');
  if (!HEALTH_STATES.includes(status)) throw new Error(`不支持的 health.status: ${status}`);
  return deepFreeze({
    status,
    checkedAt: optionalString(input.checkedAt),
    reason: optionalString(input.reason),
  });
}

function normalizeCapabilityProvider(input) {
  if (!isPlainObject(input)) throw new Error('Capability Provider 必须是对象');
  assertKnownKeys(input, PROVIDER_FIELDS, 'Capability Provider');
  if (input.schema != null && input.schema !== CAPABILITY_PROVIDER_SCHEMA) {
    throw new Error(`不支持的 Capability Provider schema: ${input.schema}`);
  }
  if (!isPlainObject(input.execution)) throw new Error('execution 必须是对象');
  assertKnownKeys(input.execution, ['mode'], 'execution');
  const mode = requiredString(input.execution.mode, 'execution.mode');
  if (!EXECUTION_MODES.includes(mode)) throw new Error(`不支持的 execution.mode: ${mode}`);
  if (!isPlainObject(input.cost)) throw new Error('cost 必须是对象');
  assertKnownKeys(input.cost, ['type', 'note'], 'cost');
  const costType = requiredString(input.cost.type, 'cost.type');
  if (!COST_TYPES.includes(costType)) throw new Error(`不支持的 cost.type: ${costType}`);
  if (!isPlainObject(input.provenance)) throw new Error('provenance 必须是对象');
  if (typeof input.agentUsable !== 'boolean') throw new Error('agentUsable 必须是布尔值');
  const capabilityId = requiredString(input.capabilityId, 'capabilityId');
  const providerId = requiredString(input.providerId, 'providerId');
  return deepFreeze({
    schema: CAPABILITY_PROVIDER_SCHEMA,
    capabilityId,
    providerId,
    displayName: optionalString(input.displayName) || providerId,
    inputTypes: stringList(input.inputTypes || [], 'inputTypes'),
    outputTypes: stringList(input.outputTypes || [], 'outputTypes'),
    agentUsable: input.agentUsable === true,
    execution: { mode },
    cost: { type: costType, note: optionalString(input.cost.note) },
    health: normalizeHealth(input.health),
    provenance: clonePlain(input.provenance, 'provenance'),
  });
}

function providerKey(capabilityId, providerId) {
  return JSON.stringify([
    requiredString(capabilityId, 'capabilityId'),
    requiredString(providerId, 'providerId'),
  ]);
}

class CapabilityRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(input) {
    const provider = normalizeCapabilityProvider(input);
    const key = providerKey(provider.capabilityId, provider.providerId);
    if (this.providers.has(key)) throw new Error(`Capability Provider 重复: ${provider.capabilityId}/${provider.providerId}`);
    this.providers.set(key, provider);
    return () => this.unregister(provider.capabilityId, provider.providerId);
  }

  unregister(capabilityId, providerId) {
    return this.providers.delete(providerKey(capabilityId, providerId));
  }

  get(capabilityId, providerId) {
    return this.providers.get(providerKey(capabilityId, providerId)) || null;
  }

  list(capabilityId = '') {
    const target = String(capabilityId || '').trim();
    return [...this.providers.values()].filter(item => !target || item.capabilityId === target);
  }

  candidates(capabilityId, filters = {}) {
    const inputType = String(filters.inputType || '').trim();
    const outputType = String(filters.outputType || '').trim();
    const executionMode = String(filters.executionMode || '').trim();
    const health = String(filters.health || '').trim();
    return this.list(requiredString(capabilityId, 'capabilityId')).filter(item => (
      (!inputType || item.inputTypes.includes(inputType))
      && (!outputType || item.outputTypes.includes(outputType))
      && (!executionMode || item.execution.mode === executionMode)
      && (filters.agentUsable == null || item.agentUsable === !!filters.agentUsable)
      && (!health || item.health.status === health)
    ));
  }

  setHealth(capabilityId, providerId, health) {
    const key = providerKey(capabilityId, providerId);
    const current = this.providers.get(key);
    if (!current) throw new Error(`未登记 Capability Provider: ${capabilityId}/${providerId}`);
    const updated = deepFreeze({ ...current, health: normalizeHealth(health) });
    this.providers.set(key, updated);
    return updated;
  }
}

module.exports = {
  CAPABILITY_PROVIDER_SCHEMA,
  COST_TYPES,
  CapabilityRegistry,
  EXECUTION_MODES,
  HEALTH_STATES,
  normalizeCapabilityProvider,
  normalizeHealth,
  providerKey,
};
