'use strict';

const crypto = require('crypto');
const {
  assertKnownKeys,
  clonePlain,
  deepFreeze,
  isPlainObject,
  requiredString,
  stringList,
} = require('./plain-value');
const kernel = require('./organizational-kernel');

const RECEIPT_FIELDS = Object.freeze([
  'schema', 'receiptId', 'stage', 'operationRef', 'toolRef', 'toolVersion', 'executorRef',
  'status', 'exitCode', 'startedAt', 'endedAt', 'inputDigest', 'outputDigest',
  'evidenceRefs', 'scope', 'published', 'externalMutation', 'message',
]);
const DECISION_FIELDS = Object.freeze([
  'schema', 'decisionId', 'gateId', 'authorityRef', 'actorRef', 'decision', 'scope',
  'evidenceRefs', 'reason',
]);
const EVALUATION_FIELDS = Object.freeze([
  'workflowPackage', 'compileRequest', 'artifactVersions', 'receipts', 'decisions', 'provenance',
]);
const SECRET_KEYS = new Set([
  'apikey', 'authorization', 'secret', 'password', 'accesstoken', 'refreshtoken',
  'credential', 'cookie', 'privatekey', 'sessiontoken',
]);

function rejectSecrets(value, trail = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const canonical = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SECRET_KEYS.has(canonical)) throw new Error(`Evidence Slice 禁止 secret 字段: ${trail ? `${trail}.` : ''}${key}`);
    rejectSecrets(item, trail ? `${trail}.${key}` : key);
  }
}

function object(value, label, fields) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  assertKnownKeys(value, fields, label);
  return value;
}

function required(value, label, max = 800) {
  const normalized = requiredString(value, label);
  if (normalized.length > max) throw new Error(`${label} 超过 ${max} 字符`);
  return normalized;
}

function strings(value, label, allowEmpty = false) {
  const normalized = stringList(value, label).sort((a, b) => a.localeCompare(b));
  if (!allowEmpty && !normalized.length) throw new Error(`${label} 不得为空`);
  return normalized;
}

function enumValue(value, allowed, label) {
  const normalized = required(value, label, 160);
  if (!allowed.includes(normalized)) throw new Error(`${label} 不支持: ${normalized}`);
  return normalized;
}

function iso(value, label) {
  const normalized = required(value, label, 80);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)
    || Number.isNaN(Date.parse(normalized))) throw new Error(`${label} 必须是 UTC ISO 时间`);
  return normalized;
}

function sha(value, label) {
  const normalized = required(value, label, 80).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} 必须是 sha256 摘要`);
  return normalized;
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(kernel.stableStringify(value), 'utf8').digest('hex')}`;
}

function validateDefinition(input) {
  const definition = clonePlain(input, 'Evidence Slice definition');
  for (const key of [
    'receiptSchema', 'decisionSchema', 'resultSchema', 'workflowId', 'scope', 'runtimeProtocol',
  ]) required(definition[key], `definition.${key}`, 240);
  if (!Array.isArray(definition.receiptStages) || !definition.receiptStages.length) throw new Error('definition.receiptStages 不得为空');
  if (!Array.isArray(definition.gates) || !definition.gates.length) throw new Error('definition.gates 不得为空');
  if (!isPlainObject(definition.stageArtifacts) || !isPlainObject(definition.gateFailureArtifacts)) throw new Error('definition 缺 stage/gate Artifact 映射');
  const stages = new Set(definition.receiptStages);
  const gateIds = new Set();
  for (const gate of definition.gates) {
    required(gate.gateId, 'definition.gate.gateId', 240);
    if (gateIds.has(gate.gateId)) throw new Error(`definition gate 重复: ${gate.gateId}`);
    gateIds.add(gate.gateId);
    for (const layer of ['verification', 'review', 'evaluation']) {
      if (!Array.isArray(gate[layer])) throw new Error(`definition gate ${gate.gateId} 缺 ${layer}`);
      for (const binding of gate[layer]) {
        enumValue(binding.source, ['decision', 'receipt'], 'definition.binding.source');
        required(binding.checkRef, 'definition.binding.checkRef', 240);
        if (binding.source === 'receipt' && !stages.has(binding.stage)) throw new Error(`definition binding 引用未知 receipt stage: ${binding.stage}`);
      }
    }
  }
  for (const stage of stages) if (!required(definition.stageArtifacts[stage], `definition.stageArtifacts.${stage}`, 240)) throw new Error(`stage ${stage} 缺 Artifact 映射`);
  for (const gateId of gateIds) if (!required(definition.gateFailureArtifacts[gateId], `definition.gateFailureArtifacts.${gateId}`, 240)) throw new Error(`gate ${gateId} 缺 failure Artifact`);
  return deepFreeze(definition);
}

function createEvidenceSliceRuntime(inputDefinition) {
  const definition = validateDefinition(inputDefinition);
  const gateIds = definition.gates.map(item => item.gateId);

  function normalizeReceipt(input) {
    rejectSecrets(input);
    object(input, 'Evidence Slice Receipt', RECEIPT_FIELDS);
    if (input.schema !== definition.receiptSchema) throw new Error(`未知 Receipt schema: ${input.schema || '空'}`);
    const status = enumValue(input.status, ['failed', 'passed', 'unknown'], 'receipt.status');
    let exitCode = null;
    if (input.exitCode != null) {
      if (!Number.isInteger(input.exitCode)) throw new Error('receipt.exitCode 必须是整数或 null');
      exitCode = input.exitCode;
    }
    if (status === 'passed' && exitCode !== 0) throw new Error('passed receipt 必须记录 exitCode=0');
    if (status === 'failed' && (exitCode == null || exitCode === 0)) throw new Error('failed receipt 必须记录非零 exitCode');
    if (status === 'unknown' && exitCode != null) throw new Error('unknown receipt 不得伪造 exitCode');
    const receipt = {
      schema: definition.receiptSchema,
      receiptId: required(input.receiptId, 'receipt.receiptId', 240),
      stage: enumValue(input.stage, definition.receiptStages, 'receipt.stage'),
      operationRef: required(input.operationRef, 'receipt.operationRef', 240),
      toolRef: required(input.toolRef, 'receipt.toolRef', 240),
      toolVersion: required(input.toolVersion, 'receipt.toolVersion', 240),
      executorRef: required(input.executorRef, 'receipt.executorRef', 240),
      status,
      exitCode,
      startedAt: iso(input.startedAt, 'receipt.startedAt'),
      endedAt: iso(input.endedAt, 'receipt.endedAt'),
      inputDigest: sha(input.inputDigest, 'receipt.inputDigest'),
      outputDigest: sha(input.outputDigest, 'receipt.outputDigest'),
      evidenceRefs: strings(input.evidenceRefs, 'receipt.evidenceRefs'),
      scope: enumValue(input.scope, [definition.scope], 'receipt.scope'),
      published: input.published === true,
      externalMutation: input.externalMutation === true,
      message: required(input.message, 'receipt.message', 1200),
    };
    if (receipt.published || receipt.externalMutation) throw new Error('Evidence Slice receipt 必须保持 published=false / externalMutation=false');
    if (Date.parse(receipt.endedAt) < Date.parse(receipt.startedAt)) throw new Error('receipt.endedAt 不得早于 startedAt');
    return deepFreeze(receipt);
  }

  function normalizeDecision(input) {
    rejectSecrets(input);
    object(input, 'Evidence Slice Decision', DECISION_FIELDS);
    if (input.schema !== definition.decisionSchema) throw new Error(`未知 Decision schema: ${input.schema || '空'}`);
    const decision = {
      schema: definition.decisionSchema,
      decisionId: required(input.decisionId, 'decision.decisionId', 240),
      gateId: enumValue(input.gateId, gateIds, 'decision.gateId'),
      authorityRef: required(input.authorityRef, 'decision.authorityRef', 240),
      actorRef: required(input.actorRef, 'decision.actorRef', 240),
      decision: enumValue(input.decision, ['approve', 'reject'], 'decision.decision'),
      scope: enumValue(input.scope, [definition.scope], 'decision.scope'),
      evidenceRefs: strings(input.evidenceRefs, 'decision.evidenceRefs'),
      reason: required(input.reason, 'decision.reason', 1200),
    };
    if (!decision.actorRef.startsWith('human:')) throw new Error('Evidence Slice Authority Decision 必须由 human:* actor 签发');
    return deepFreeze(decision);
  }

  function checkRows(bindings, receipts, decision) {
    return bindings.flatMap(binding => {
      const source = binding.source === 'receipt' ? receipts.get(binding.stage) : decision;
      if (!source) return [];
      return [{
        checkRef: binding.checkRef,
        status: binding.source === 'receipt' ? source.status : source.decision === 'approve' ? 'passed' : 'failed',
        evidenceRefs: source.evidenceRefs,
        message: source.message || source.reason,
      }];
    });
  }

  function authorityDecision(decision) {
    if (!decision) return null;
    return {
      authorityRef: decision.authorityRef,
      actorRef: decision.actorRef,
      decision: decision.decision,
      evidenceRefs: decision.evidenceRefs,
      reason: decision.reason,
    };
  }

  function enforceBinding(result, gate, decision, plan) {
    if (!decision) return result;
    const binding = plan.authoritySchedule.find(item => item.authorityRef === gate.authorityRef)?.binding;
    const reasons = [...result.reasons];
    if (!binding || binding.actorRef !== decision.actorRef) reasons.push('AUTHORITY_ACTOR_MISMATCH');
    if (decision.authorityRef !== gate.authorityRef) reasons.push('AUTHORITY_MISMATCH');
    if (reasons.length === result.reasons.length) return result;
    return deepFreeze({
      ...result,
      status: 'BLOCKED',
      nextState: gate.failState,
      recoveryPointId: gate.recoveryPointId,
      reasons: [...new Set(reasons)].sort(),
    });
  }

  function artifactVersions(value, workflow) {
    if (!isPlainObject(value)) throw new Error('artifactVersions 必须是对象');
    assertKnownKeys(value, workflow.artifacts.map(item => item.artifactId), 'artifactVersions');
    return Object.fromEntries(workflow.artifacts.map(item => [
      item.artifactId,
      required(value[item.artifactId], `artifactVersions.${item.artifactId}`, 160),
    ]));
  }

  function evaluate(input) {
    rejectSecrets(input);
    object(input, 'Evidence Slice Evaluation', EVALUATION_FIELDS);
    const workflow = kernel.normalizeWorkflowPackage(input.workflowPackage);
    if (workflow.workflowId !== definition.workflowId) throw new Error(`Evidence Slice 只接受 ${definition.workflowId}`);
    const plan = kernel.compileOrganization(workflow, input.compileRequest);
    const versions = artifactVersions(input.artifactVersions, workflow);
    if (!Array.isArray(input.receipts) || !Array.isArray(input.decisions)) throw new Error('receipts/decisions 必须是数组');
    const receipts = new Map();
    for (const row of input.receipts.map(normalizeReceipt)) {
      if (receipts.has(row.stage)) throw new Error(`同一 stage 只能有一份当前 receipt: ${row.stage}`);
      receipts.set(row.stage, row);
    }
    const decisions = new Map();
    for (const row of input.decisions.map(normalizeDecision)) {
      if (decisions.has(row.gateId)) throw new Error(`同一 gate 只能有一份当前 decision: ${row.gateId}`);
      decisions.set(row.gateId, row);
    }
    const transitions = definition.gates.map(binding => {
      const gate = workflow.gates.find(item => item.gateId === binding.gateId);
      if (!gate) throw new Error(`Workflow 缺 definition gate: ${binding.gateId}`);
      const decision = decisions.get(binding.gateId);
      const evidence = {
        schema: kernel.TRANSITION_EVIDENCE_SCHEMA,
        transitionId: `transition:${definition.runtimeProtocol}:${binding.gateId.split(':').at(-1)}`,
        gateId: binding.gateId,
        artifactVersions: Object.fromEntries(gate.artifactIds.map(id => [id, versions[id]])),
        verificationResults: checkRows(binding.verification, receipts, decision),
        reviewResults: checkRows(binding.review, receipts, decision),
        evaluationResults: checkRows(binding.evaluation, receipts, decision),
        authorityDecision: authorityDecision(decision),
      };
      return enforceBinding(kernel.evaluateEvidenceBackedTransition(gate, evidence), gate, decision, plan);
    });
    const firstBlocked = transitions.find(item => item.status === 'BLOCKED') || null;
    const planBlocked = plan.status === 'BLOCKED';
    const hasUnknown = plan.status === 'UNKNOWN' || transitions.some(item => item.status === 'UNKNOWN');
    const status = planBlocked || firstBlocked ? 'RECOVERY_REQUIRED' : hasUnknown ? 'UNKNOWN' : 'COMPLETED';
    let changedArtifactId = '';
    if (firstBlocked) {
      const gateDefinition = definition.gates.find(item => item.gateId === firstBlocked.gateId);
      const failedStage = [...gateDefinition.verification, ...gateDefinition.review, ...gateDefinition.evaluation]
        .find(binding => binding.source === 'receipt' && receipts.get(binding.stage)?.status === 'failed')?.stage;
      changedArtifactId = failedStage ? definition.stageArtifacts[failedStage] : definition.gateFailureArtifacts[firstBlocked.gateId];
    }
    const recoveryPoint = firstBlocked
      ? workflow.recoveryPoints.find(item => item.recoveryPointId === firstBlocked.recoveryPointId)
      : null;
    const affectedArtifactIds = changedArtifactId ? kernel.affectedArtifacts(workflow, [changedArtifactId]) : [];
    const core = {
      schema: definition.resultSchema,
      workflowRef: { workflowId: workflow.workflowId, version: workflow.version },
      planId: plan.planId,
      planStatus: plan.status,
      status,
      transitions,
      receiptRefs: [...receipts.values()].map(item => ({ receiptId: item.receiptId, stage: item.stage, executorRef: item.executorRef, status: item.status, digest: digest(item) })),
      decisionRefs: [...decisions.values()].map(item => ({ decisionId: item.decisionId, gateId: item.gateId, actorRef: item.actorRef, decision: item.decision, digest: digest(item) })),
      recovery: recoveryPoint ? {
        required: true,
        recoveryPointId: recoveryPoint.recoveryPointId,
        resumeSeatIds: recoveryPoint.resumeSeatIds,
        changedArtifactId,
        affectedArtifactIds,
        reasons: firstBlocked.reasons,
      } : {
        required: planBlocked,
        recoveryPointId: '',
        resumeSeatIds: [],
        changedArtifactId: '',
        affectedArtifactIds: [],
        reasons: plan.blockers.map(item => item.code),
      },
      localSealAllowed: status === 'COMPLETED',
      boundary: deepFreeze({
        scope: definition.scope,
        published: false,
        externalMutation: false,
        compilerOwner: 'W82',
        runtimeTruthOwner: 'W73',
        ...clonePlain(definition.boundary || {}, 'definition.boundary'),
      }),
      provenance: clonePlain(object(input.provenance, 'provenance', Object.keys(input.provenance || {})), 'provenance'),
    };
    return deepFreeze({ ...core, resultDigest: digest(core) });
  }

  function toW73Events(result) {
    if (!isPlainObject(result) || result.schema !== definition.resultSchema) throw new Error('W73 projection 需要匹配的 Evidence Slice result');
    if (result.boundary?.published !== false || result.boundary?.externalMutation !== false) throw new Error('W73 projection 拒绝越过本地证据边界');
    const events = [{ type: 'run-started', toStatus: 'running', reasonCode: `${definition.runtimeProtocol.toUpperCase()}_START`, protocolRefs: [result.planId] }];
    for (const receipt of result.receiptRefs) events.push({
      type: 'artifact-recorded',
      actorRef: receipt.executorRef,
      reasonCode: `${definition.runtimeProtocol.toUpperCase()}_${receipt.stage.toUpperCase()}_RECEIPT`,
      artifactRefs: [{ kind: 'evidence', id: receipt.receiptId, version: receipt.digest, role: `${receipt.stage}-receipt` }],
    });
    for (const decision of result.decisionRefs) events.push({
      type: 'review-recorded',
      actorRef: decision.actorRef,
      reasonCode: `${definition.runtimeProtocol.toUpperCase()}_${decision.decision.toUpperCase()}`,
      gateRefs: [decision.gateId],
      artifactRefs: [{ kind: 'decision', id: decision.decisionId, version: decision.digest, role: 'authority-decision' }],
    });
    events.push({
      type: 'audit-recorded',
      reasonCode: `${definition.runtimeProtocol.toUpperCase()}_EVIDENCE_TRANSITIONS`,
      gateRefs: result.transitions.map(item => item.gateId),
      evaluationRefs: result.transitions.map(item => `${item.gateId}:${item.status}`),
    });
    if (result.status === 'RECOVERY_REQUIRED') events.push({
      type: 'run-recovery-required',
      toStatus: 'blocked',
      reasonCode: result.recovery.reasons[0] || `${definition.runtimeProtocol.toUpperCase()}_RECOVERY_REQUIRED`,
      reworkRefs: result.recovery.affectedArtifactIds,
      artifactRefs: [{ kind: 'evidence', id: result.resultDigest, role: 'recovery-evidence' }],
    });
    else if (result.status === 'COMPLETED') events.push({
      type: 'run-completed',
      toStatus: 'completed',
      reasonCode: `${definition.runtimeProtocol.toUpperCase()}_LOCAL_SPECIMEN_APPROVED`,
      artifactRefs: [{ kind: 'artifact', id: definition.finalArtifactId, version: result.resultDigest, role: 'local-non-production-specimen' }],
    });
    else events.push({ type: 'run-paused', toStatus: 'paused', reasonCode: `${definition.runtimeProtocol.toUpperCase()}_EVIDENCE_UNKNOWN` });
    return deepFreeze(events);
  }

  return deepFreeze({ definition, normalizeReceipt, normalizeDecision, evaluate, toW73Events });
}

module.exports = { createEvidenceSliceRuntime };
