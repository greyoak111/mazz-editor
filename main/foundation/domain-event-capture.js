'use strict';

// W94E producer-side event helper.  It deliberately accepts only opaque
// identities and emits metadata; callers must never pass content, paths,
// prompts, credentials, or transport coordinates here.

const DOMAINS = new Set(['factory', 'library', 'player', 'calc', 'chart', 'canvas', 'blender', 'world']);
const ACTORS = new Set(['human', 'factory', 'agent', 'system']);
const OUTCOMES = new Set(['success', 'cancelled', 'failed', 'partial', 'approval', 'unknown']);

function opaque(value, label) {
  const text = String(value ?? '').trim();
  if (!text || text.includes('\\') || text.includes('/') || /(?:api.?key|secret|token|password|credential|private.?key)/i.test(text)) {
    throw new TypeError(`${label} must be an opaque identity`);
  }
  return text;
}

function capabilityDomain(capabilityId) {
  const text = String(capabilityId || '').toLocaleLowerCase('en-US');
  for (const domain of ['calc', 'chart', 'blender', 'canvas', 'library', 'player', 'factory', 'world']) {
    if (text.includes(domain)) return domain;
  }
  return 'factory';
}

function captureDomainEvent(eventService, {
  domain,
  action,
  outcome = 'success',
  actorType = 'system',
  subjectId = '',
  objectId = '',
  contextId = '',
  idempotencyKey = '',
} = {}) {
  if (!eventService || typeof eventService.capture !== 'function') return { recorded: false, reason: 'NO_EVENT_SERVICE' };
  try {
    if (!DOMAINS.has(domain)) throw new TypeError('domain is not a W94E domain');
    const actor = ACTORS.has(actorType) ? actorType : 'system';
    if (!OUTCOMES.has(outcome)) throw new TypeError('outcome is not a workspace event outcome');
    const subject = opaque(subjectId || `${domain}:workspace`, 'subjectId');
    const object = objectId ? opaque(objectId, 'objectId') : '';
    const context = contextId ? opaque(contextId, 'contextId') : `domain:${domain}`;
    const key = idempotencyKey
      ? opaque(idempotencyKey, 'idempotencyKey')
      : `w94e:${domain}:${action}:${outcome}:${subject}:${object || 'none'}`;
    return eventService.capture({
      idempotencyKey: key,
      actorType: actor,
      sourceModule: `domain:${domain}`,
      action: opaque(action, 'action'),
      subjectRefs: [`${domain}:${subject}`],
      objectRefs: object ? [`${domain}:${object}`] : [],
      contextRefs: [context],
      outcome,
      provenance: { producer: 'w94e-domain-event', domain },
      privacyClass: 'operational',
      retentionClass: '1y',
      summary: `domain:${domain} action:${action} outcome:${outcome}`,
    });
  } catch (error) {
    // Event capture is an observability side effect.  It must not change the
    // durable business result; the caller can still inspect this diagnostic.
    return { recorded: false, reason: 'CAPTURE_FAILED', code: error?.code || error?.message || 'unknown' };
  }
}

module.exports = { DOMAINS, capabilityDomain, captureDomainEvent };
