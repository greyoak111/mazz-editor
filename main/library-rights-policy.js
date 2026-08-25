'use strict';

const crypto = require('crypto');
const contract = require('./library-resource-contract');
const source = require('./library-source-registry');

const DECISION_SCHEMA = 'mazz.library-rights-decision/v1';
const USER_ASSERTION_SCHEMA = 'mazz.library-user-rights-assertion/v1';
const OUTCOMES = Object.freeze(['pass', 'awaiting-rights', 'blocked']);

function codedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function plainRecord(value, label, fields) {
  if (!isPlainRecord(value)) throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', `${label} 必须是普通对象`);
  const unknown = Object.keys(value).filter(key => !fields.includes(key));
  if (unknown.length) throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', `${label} 含未知字段：${unknown.join(',')}`);
  contract.assertNoSecrets(value, label);
  return value;
}

function exactString(value, label, { optional = false } = {}) {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string' || (!optional && value.length === 0)
    || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', `${label} 必须是原生精确字符串`);
  }
  contract.assertNoSecretString(value, label);
  return value;
}

function opaqueId(value, label) {
  const text = exactString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', `${label} 必须是 opaque identity`);
  }
  return text;
}

function iso(value, label) {
  const text = exactString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', `${label} 必须是 ISO 时间`);
  return new Date(timestamp).toISOString();
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date());
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw codedError('LIBRARY_RIGHTS_CLOCK_INVALID', 'Rights policy clock 非法');
  return new Date(timestamp).toISOString();
}

function hashEvidence(value) {
  return `rights-evidence-${crypto.createHash('sha256').update(contract.stableJson(value)).digest('hex')}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeUserAssertion(input) {
  plainRecord(input, 'userAssertion', [
    'schema', 'authority', 'candidateFingerprint', 'jurisdiction', 'declarationId', 'confirmedAt',
  ]);
  if (input.schema !== USER_ASSERTION_SCHEMA) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'userAssertion schema 非法');
  }
  if (input.authority !== 'user') {
    throw codedError('LIBRARY_RIGHTS_USER_AUTHORITY_REQUIRED', 'user-owned 只能由当前用户明确确认');
  }
  const candidateFingerprint = exactString(input.candidateFingerprint, 'userAssertion.candidateFingerprint');
  if (!/^candidate-sha256-[a-f0-9]{64}$/.test(candidateFingerprint)) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'userAssertion candidateFingerprint 非法');
  }
  return deepFreeze({
    schema: USER_ASSERTION_SCHEMA,
    authority: 'user',
    candidateFingerprint,
    jurisdiction: exactString(input.jurisdiction, 'userAssertion.jurisdiction'),
    declarationId: opaqueId(input.declarationId, 'userAssertion.declarationId'),
    confirmedAt: iso(input.confirmedAt, 'userAssertion.confirmedAt'),
  });
}

function decisionBase(candidate, descriptor, jurisdiction, decidedAt) {
  return {
    schema: DECISION_SCHEMA,
    candidateId: candidate.candidateId,
    candidateFingerprint: contract.deriveCandidateFingerprint(candidate),
    providerId: descriptor.providerId,
    policyVersion: descriptor.policy.policyVersion,
    jurisdiction,
    sourceStatus: candidate.rights.status,
    decidedAt,
  };
}

function nonPassingDecision(candidate, descriptor, jurisdiction, decidedAt, outcome, reasonCode) {
  return deepFreeze({
    ...decisionBase(candidate, descriptor, jurisdiction, decidedAt),
    outcome,
    receipt: null,
    reasonCode,
  });
}

function evaluateRights(input = {}) {
  plainRecord(input, 'rights evaluation', ['candidate', 'descriptor', 'jurisdiction', 'userAssertion', 'now']);
  const at = nowIso(input.now);
  const descriptor = source.normalizeDescriptor(input.descriptor, { now: at });
  const candidate = source.assertCandidateBinding(input.candidate, descriptor, { now: at });
  const jurisdiction = exactString(input.jurisdiction, 'jurisdiction');
  const rights = candidate.rights;

  if (rights.checkedAt && Date.parse(rights.checkedAt) > Date.parse(at)) {
    throw codedError('LIBRARY_RIGHTS_EVIDENCE_FUTURE', 'Rights evidence checkedAt 不得晚于裁决时间');
  }
  if (rights.status === 'restricted') {
    return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'blocked', 'RIGHTS_RESTRICTED');
  }
  if (rights.status === 'unknown') {
    return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'awaiting-rights', 'RIGHTS_UNKNOWN');
  }
  if (!descriptor.policy.rightsModes.includes(rights.status)) {
    return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'awaiting-rights', 'POLICY_MODE_UNSUPPORTED');
  }
  if (!descriptor.policy.jurisdictions.includes(jurisdiction)
    || rights.jurisdiction !== jurisdiction) {
    return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'awaiting-rights', 'JURISDICTION_UNRESOLVED');
  }
  if (!rights.checkedAt || Date.parse(rights.checkedAt) < Date.parse(descriptor.policy.checkedAt)) {
    return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'awaiting-rights', 'EVIDENCE_PRECEDES_POLICY');
  }

  let authority;
  let evidencePackage;
  if (rights.status === 'public-domain') {
    if (!rights.evidenceUrl || !rights.assertedBy || !rights.rightsStatement) {
      return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'awaiting-rights', 'PUBLIC_DOMAIN_EVIDENCE_INCOMPLETE');
    }
    authority = `adapter-policy-${descriptor.providerId}`;
    evidencePackage = {
      candidateFingerprint: contract.deriveCandidateFingerprint(candidate),
      providerId: descriptor.providerId,
      adapterVersion: descriptor.adapterVersion,
      policyVersion: descriptor.policy.policyVersion,
      policyCheckedAt: descriptor.policy.checkedAt,
      jurisdiction,
      status: rights.status,
      licenseId: rights.licenseId,
      rightsStatement: rights.rightsStatement,
      evidenceUrl: rights.evidenceUrl,
      assertedBy: rights.assertedBy,
      evidenceCheckedAt: rights.checkedAt,
    };
  } else if (rights.status === 'open-license') {
    if (!rights.evidenceUrl || !rights.assertedBy || !rights.rightsStatement || !rights.licenseId) {
      return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'awaiting-rights', 'OPEN_LICENSE_EVIDENCE_INCOMPLETE');
    }
    authority = `adapter-policy-${descriptor.providerId}`;
    evidencePackage = {
      candidateFingerprint: contract.deriveCandidateFingerprint(candidate),
      providerId: descriptor.providerId,
      adapterVersion: descriptor.adapterVersion,
      policyVersion: descriptor.policy.policyVersion,
      policyCheckedAt: descriptor.policy.checkedAt,
      jurisdiction,
      status: rights.status,
      licenseId: rights.licenseId,
      rightsStatement: rights.rightsStatement,
      evidenceUrl: rights.evidenceUrl,
      assertedBy: rights.assertedBy,
      evidenceCheckedAt: rights.checkedAt,
    };
  } else if (rights.status === 'user-owned') {
    if (input.userAssertion === undefined) {
      return nonPassingDecision(candidate, descriptor, jurisdiction, at, 'awaiting-rights', 'USER_ASSERTION_REQUIRED');
    }
    const assertion = normalizeUserAssertion(input.userAssertion);
    const fingerprint = contract.deriveCandidateFingerprint(candidate);
    if (assertion.candidateFingerprint !== fingerprint
      || assertion.jurisdiction !== jurisdiction
      || Date.parse(assertion.confirmedAt) > Date.parse(at)) {
      throw codedError('LIBRARY_RIGHTS_USER_ASSERTION_MISMATCH', 'userAssertion 未绑定当前 Candidate、法域或裁决时间');
    }
    authority = 'user';
    evidencePackage = {
      candidateFingerprint: fingerprint,
      providerId: descriptor.providerId,
      adapterVersion: descriptor.adapterVersion,
      policyVersion: descriptor.policy.policyVersion,
      policyCheckedAt: descriptor.policy.checkedAt,
      jurisdiction,
      status: rights.status,
      declarationId: assertion.declarationId,
      confirmedAt: assertion.confirmedAt,
    };
  } else {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', '未处理的 Rights 状态');
  }

  const receipt = contract.normalizeRightsReceipt({
    decision: rights.status,
    authority,
    evidenceRef: hashEvidence(evidencePackage),
    at,
  }, { rights });
  return deepFreeze({
    ...decisionBase(candidate, descriptor, jurisdiction, at),
    outcome: 'pass',
    receipt,
    reasonCode: 'RIGHTS_PASS',
  });
}

function normalizeRightsDecision(input) {
  plainRecord(input, 'rights decision', [
    'schema', 'outcome', 'candidateId', 'candidateFingerprint', 'providerId', 'policyVersion',
    'jurisdiction', 'sourceStatus', 'decidedAt', 'receipt', 'reasonCode',
  ]);
  if (input.schema !== DECISION_SCHEMA) throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'rights decision schema 非法');
  const outcome = exactString(input.outcome, 'decision.outcome');
  if (!OUTCOMES.includes(outcome)) throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'decision.outcome 非法');
  const sourceStatus = exactString(input.sourceStatus, 'decision.sourceStatus');
  if (!contract.RIGHTS_STATUSES.includes(sourceStatus)) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'decision.sourceStatus 非法');
  }
  const fingerprint = exactString(input.candidateFingerprint, 'decision.candidateFingerprint');
  if (!/^candidate-sha256-[a-f0-9]{64}$/.test(fingerprint)) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'decision.candidateFingerprint 非法');
  }
  const receipt = contract.normalizeRightsReceipt(input.receipt);
  if (outcome === 'pass' && !receipt) throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'pass decision 必须有 Receipt');
  if (outcome !== 'pass' && receipt) throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', '非 pass decision 不得有 Receipt');
  if (outcome === 'pass' && receipt?.decision !== sourceStatus) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'pass Receipt 必须匹配 sourceStatus');
  }
  if (sourceStatus === 'restricted' && outcome !== 'blocked') {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'restricted decision 必须 blocked');
  }
  if (sourceStatus === 'unknown' && outcome !== 'awaiting-rights') {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'unknown decision 必须 awaiting-rights');
  }
  const reasonCode = opaqueId(input.reasonCode, 'decision.reasonCode');
  if (outcome === 'pass' && reasonCode !== 'RIGHTS_PASS') {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'pass decision reasonCode 非法');
  }
  if (sourceStatus === 'restricted' && reasonCode !== 'RIGHTS_RESTRICTED') {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'restricted decision reasonCode 非法');
  }
  if (sourceStatus === 'unknown' && reasonCode !== 'RIGHTS_UNKNOWN') {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'unknown decision reasonCode 非法');
  }
  const awaitingReasons = {
    'public-domain': [
      'POLICY_MODE_UNSUPPORTED', 'JURISDICTION_UNRESOLVED', 'EVIDENCE_PRECEDES_POLICY',
      'PUBLIC_DOMAIN_EVIDENCE_INCOMPLETE',
    ],
    'open-license': [
      'POLICY_MODE_UNSUPPORTED', 'JURISDICTION_UNRESOLVED', 'EVIDENCE_PRECEDES_POLICY',
      'OPEN_LICENSE_EVIDENCE_INCOMPLETE',
    ],
    'user-owned': [
      'POLICY_MODE_UNSUPPORTED', 'JURISDICTION_UNRESOLVED', 'EVIDENCE_PRECEDES_POLICY',
      'USER_ASSERTION_REQUIRED',
    ],
    unknown: ['RIGHTS_UNKNOWN'],
    restricted: [],
  };
  if (outcome === 'awaiting-rights' && !awaitingReasons[sourceStatus].includes(reasonCode)) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'awaiting-rights decision reasonCode 与 sourceStatus 不一致');
  }
  return deepFreeze({
    schema: DECISION_SCHEMA,
    outcome,
    candidateId: opaqueId(input.candidateId, 'decision.candidateId'),
    candidateFingerprint: fingerprint,
    providerId: opaqueId(input.providerId, 'decision.providerId'),
    policyVersion: opaqueId(input.policyVersion, 'decision.policyVersion'),
    jurisdiction: exactString(input.jurisdiction, 'decision.jurisdiction'),
    sourceStatus,
    decidedAt: iso(input.decidedAt, 'decision.decidedAt'),
    receipt,
    reasonCode,
  });
}

function prepareAcquisitionJob(input = {}) {
  plainRecord(input, 'prepareAcquisitionJob input', [
    'jobId', 'intentId', 'workspaceIdentity', 'workspacePath', 'candidate', 'offerId',
    'descriptor', 'jurisdiction', 'userAssertion', 'decision', 'selectedFiles', 'createdAt',
  ]);
  const candidate = contract.normalizeCandidate(input.candidate);
  const decision = normalizeRightsDecision(input.decision);
  const createdAt = iso(input.createdAt, 'createdAt');
  const recomputedDecision = evaluateRights({
    candidate,
    descriptor: input.descriptor,
    jurisdiction: input.jurisdiction,
    userAssertion: input.userAssertion,
    now: decision.decidedAt,
  });
  if (contract.stableJson(recomputedDecision) !== contract.stableJson(decision)) {
    throw codedError('LIBRARY_RIGHTS_DECISION_MISMATCH', 'Rights Decision 未通过当前 Policy 重新裁决');
  }
  if (Date.parse(createdAt) < Date.parse(decision.decidedAt)) {
    throw codedError('LIBRARY_RIGHTS_DECISION_MISMATCH', 'Job 创建时间不得早于 Rights Decision');
  }
  const fingerprint = contract.deriveCandidateFingerprint(candidate);
  if (decision.candidateId !== candidate.candidateId
    || decision.candidateFingerprint !== fingerprint
    || decision.sourceStatus !== candidate.rights.status) {
    throw codedError('LIBRARY_RIGHTS_DECISION_MISMATCH', 'Rights Decision 未绑定当前 Candidate');
  }
  const offerId = opaqueId(input.offerId, 'offerId');
  const offer = candidate.offers.find(item => item.offerId === offerId);
  if (!offer || offer.providerId !== decision.providerId) {
    throw codedError('LIBRARY_RIGHTS_DECISION_MISMATCH', 'Rights Decision 未绑定当前 Offer/Provider');
  }
  const selectedFilesInput = input.selectedFiles === undefined ? [] : input.selectedFiles;
  if (!Array.isArray(selectedFilesInput)) {
    throw codedError('LIBRARY_RIGHTS_SCHEMA_INVALID', 'selectedFiles 必须是数组');
  }
  const selectedFiles = contract.normalizeSelectedFiles(selectedFilesInput);
  if (offer.selectableFiles.length && selectedFiles.some(file => !offer.selectableFiles.includes(file))) {
    throw codedError('LIBRARY_RIGHTS_SELECTION_INVALID', 'selectedFiles 不属于 Candidate Offer');
  }
  const workspacePath = exactString(input.workspacePath, 'workspacePath');
  const workspaceIdentity = opaqueId(input.workspaceIdentity, 'workspaceIdentity');
  if (contract.deriveWorkspaceIdentity(workspacePath) !== workspaceIdentity) {
    throw codedError('LIBRARY_RIGHTS_WORKSPACE_MISMATCH', 'workspaceIdentity 与 canonical workspacePath 不一致');
  }
  let state = 'awaiting-rights';
  if (decision.outcome === 'pass') {
    state = offer.selectableFiles.length && selectedFiles.length === 0 ? 'awaiting-selection' : 'queued';
  }
  const job = {
    schema: contract.JOB_SCHEMA,
    revision: 1,
    jobId: opaqueId(input.jobId, 'jobId'),
    intentId: opaqueId(input.intentId, 'intentId'),
    idempotencyKey: '',
    idempotencyAliases: [],
    workspaceIdentity,
    workspacePath,
    candidateId: candidate.candidateId,
    candidateFingerprint: fingerprint,
    offerId: offer.offerId,
    providerId: offer.providerId,
    transport: offer.transport,
    transportIdentity: contract.deriveTransportIdentity(offer),
    selectedFiles,
    rightsStatus: candidate.rights.status,
    rightsReceipt: decision.receipt,
    state,
    retryFrom: null,
    bytes: { received: 0, total: offer.size },
    error: null,
    integrity: { sha256: '', declaredChecksum: offer.checksum, pieceVerified: false },
    stagingPath: '',
    finalPath: '',
    bookId: '',
    createdAt,
    updatedAt: createdAt,
  };
  return contract.normalizeJob(job, { candidate, now: createdAt });
}

module.exports = {
  DECISION_SCHEMA,
  USER_ASSERTION_SCHEMA,
  OUTCOMES,
  normalizeUserAssertion,
  normalizeRightsDecision,
  evaluateRights,
  prepareAcquisitionJob,
  _forTests: { hashEvidence, exactString, opaqueId },
};
