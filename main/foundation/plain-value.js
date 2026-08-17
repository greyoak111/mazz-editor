'use strict';

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clonePlain(value, label = 'value', seen = new WeakSet()) {
  if (value == null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} 不能包含 NaN 或 Infinity`);
    return value;
  }
  if (typeof value !== 'object') throw new Error(`${label} 必须是可移植的 JSON 值`);
  if (seen.has(value)) throw new Error(`${label} 不能包含循环引用`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => clonePlain(item, `${label}[${index}]`, seen));
    if (!isPlainObject(value)) throw new Error(`${label} 必须是普通对象、数组或基础值`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlain(item, `${label}.${key}`, seen)]));
  } finally {
    seen.delete(value);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function requiredString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} 必填`);
  return normalized;
}

function optionalString(value) {
  return value == null ? '' : String(value).trim();
}

function stringList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const normalized = value.map((item, index) => requiredString(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} 不能重复`);
  return normalized;
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} 含未冻结字段: ${unknown.join(', ')}`);
}

module.exports = {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  optionalString,
  requiredString,
  stringList,
};
