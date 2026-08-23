// Factory 最后一组跨模块桥：只定义可审计协议，不取得 W73 Run 所有权。
// Asset 是事实，桥接记录是行为证据；这里不创建 universal data model。

import { buildLineDiff, classifyFactoryInstruction } from './command-gate.js';

export const FACTORY_BRIDGE_SCHEMA = 'mazz.factory-bridge/v0';
export const FACTORY_REVISION_SCHEMA = 'mazz.factory-artifact-revision/v0';
export const FACTORY_FEED_SCHEMA = 'mazz.factory-feed-envelope/v0';
export const FACTORY_USAGE_SCHEMA = 'mazz.factory-usage-record/v0';
export const FACTORY_MOBILE_APPROVAL_SCHEMA = 'mazz.factory-mobile-approval/v0';
export const FACTORY_LIVE_REF_MIME = 'application/x-mazz-live-reference';
export const FACTORY_INSTRUCTION_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3']);
export const FACTORY_USAGE_KINDS = Object.freeze(['estimate', 'provider-reported', 'settled-actual', 'unknown']);

const clean = value => String(value ?? '').replace(/\r\n?/g, '\n');
const nonEmpty = (value, label) => {
  const text = clean(value).trim();
  if (!text) throw new Error(`${label} 不能为空`);
  return text;
};
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const iso = value => {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error('时间格式无效');
  return date.toISOString();
};
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
export function factoryDigest(value) {
  const text = typeof value === 'string' ? value : stable(value);
  let left = 2166136261, right = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    left = Math.imul(left ^ text.charCodeAt(i), 16777619);
    right = Math.imul(right ^ (text.charCodeAt(i) + i), 2246822519);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

export function createArtifactRevision({ taskId, path, before = '', after = '', authorityRef = 'human:maintainer', reviewStatus = '', at } = {}) {
  const targetPath = nonEmpty(path, '工件路径');
  const oldText = clean(before), nextText = clean(after);
  const changed = oldText !== nextText;
  const observedAt = iso(at);
  const identity = { taskId: nonEmpty(taskId, 'taskId'), path: targetPath, beforeHash: factoryDigest(oldText), afterHash: factoryDigest(nextText), observedAt };
  return Object.freeze({
    schema: FACTORY_REVISION_SCHEMA,
    revisionId: `revision:${factoryDigest(identity)}`,
    ...identity,
    authorityRef: nonEmpty(authorityRef, 'Authority'),
    changed,
    diff: changed ? buildLineDiff(oldText, nextText, { filename: targetPath.split(/[\\/]/).pop() || 'artifact.md' }) : '',
    previousReviewStatus: clean(reviewStatus) || 'unknown',
    reviewRequired: changed,
    nextReviewStatus: changed ? 'RE_REVIEW_REQUIRED' : (clean(reviewStatus) || 'unchanged'),
    executionStarted: false,
  });
}

// 三方合并仅自动接受“只有一方变化”或等值结果；双方都改时必须由人裁决。
export function reconcileLockedBible({ base = '', human = '', aiProposal = '' } = {}) {
  const original = clean(base), humanText = clean(human), aiText = clean(aiProposal);
  if (humanText === aiText) return Object.freeze({ status: 'identical', merged: humanText, conflict: false, requiresHumanDecision: false });
  if (humanText === original) return Object.freeze({ status: 'ai-only', merged: aiText, conflict: false, requiresHumanDecision: true });
  if (aiText === original) return Object.freeze({ status: 'human-only', merged: humanText, conflict: false, requiresHumanDecision: false });
  return Object.freeze({
    status: 'conflict', merged: null, conflict: true, requiresHumanDecision: true,
    baseHash: factoryDigest(original), humanHash: factoryDigest(humanText), aiHash: factoryDigest(aiText),
    humanDiff: buildLineDiff(original, humanText, { filename: '圣经.md' }),
    aiDiff: buildLineDiff(original, aiText, { filename: '圣经.md' }),
    choices: ['keep-human', 'accept-ai'],
  });
}

export function makeBibleConflictCard({ targetPath, base, human, aiProposal, instruction = '' } = {}) {
  const reconciliation = reconcileLockedBible({ base, human, aiProposal });
  return Object.freeze({
    kind: 'bible-conflict', targetPath: nonEmpty(targetPath, '设定集路径'),
    base: clean(base), human: clean(human), aiProposal: clean(aiProposal), instruction: clean(instruction).trim(),
    reconciliation,
  });
}

export function classifyInstructionMailbox(input, options = {}) {
  const decision = classifyFactoryInstruction(input, options);
  const level = decision.family === 'chat' ? 'L0'
    : decision.ambiguous ? 'L1'
      : ['quality', 'legislation'].includes(decision.family) ? 'L2' : 'L3';
  return Object.freeze({
    schema: FACTORY_BRIDGE_SCHEMA,
    kind: 'instruction-mailbox', level, ...decision,
    automaticExecution: false,
    requiresHumanDecision: level === 'L1' || level === 'L2',
    requiresExplicitDispatch: level === 'L3',
  });
}

export function createFactoryFeedEnvelope({ assetPath, assetId = '', title = '', sourceKind = 'local-file', provenanceSource = 'factory.feed-anywhere', requestedBy = 'human:maintainer', at } = {}) {
  const path = nonEmpty(assetPath, '投喂资产路径');
  const observedAt = iso(at);
  const body = { path, assetId: clean(assetId) || `asset:factory-feed:${factoryDigest(path)}`, sourceKind: nonEmpty(sourceKind, 'sourceKind'), observedAt };
  return Object.freeze({
    schema: FACTORY_FEED_SCHEMA, envelopeId: `feed:${factoryDigest(body)}`, ...body,
    title: clean(title).trim() || path.split(/[\\/]/).pop(), provenanceSource: nonEmpty(provenanceSource, 'provenanceSource'),
    requestedBy: nonEmpty(requestedBy, 'requestedBy'), approvalState: 'human-approved-import',
    queueState: 'material-only', automaticStart: false, executionAuthorized: false,
  });
}

export function createArtifactLiveReference({ artifactPath, eventId, label = '' } = {}) {
  const path = nonEmpty(artifactPath, '工件路径').replace(/\\/g, '/');
  const anchor = `factory-event-${nonEmpty(eventId, 'eventId').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 96)}`;
  const syntax = `{{ref:${path}!^${anchor}}}`;
  return Object.freeze({ schema: FACTORY_BRIDGE_SCHEMA, kind: 'artifact-live-reference', targetAssetRef: path, targetAnchorRef: `^${anchor}`, label: clean(label).trim(), syntax, mime: FACTORY_LIVE_REF_MIME, copiedAsset: false });
}

export function normalizeFactoryUsageRecord(value = {}) {
  const kind = clean(value.kind).trim();
  if (!FACTORY_USAGE_KINDS.includes(kind)) throw new Error(`非法 usage kind：${kind}`);
  const observedAt = iso(value.observedAt);
  const inputTokens = Math.max(0, finite(value.inputTokens));
  const outputTokens = Math.max(0, finite(value.outputTokens));
  const totalTokens = Math.max(0, finite(value.totalTokens) || inputTokens + outputTokens);
  const amount = value.amount == null || value.amount === '' ? null : Math.max(0, finite(value.amount));
  const currency = clean(value.currency).trim().toUpperCase();
  if (kind === 'provider-reported' && (!totalTokens || !clean(value.sourceRef).trim())) throw new Error('Provider 实收必须有 token 与 sourceRef');
  if (kind === 'settled-actual' && (amount == null || !currency || !clean(value.sourceRef).trim())) throw new Error('实际结算必须有金额、币种与凭据');
  if (kind === 'unknown' && !clean(value.reason).trim()) throw new Error('未知成本必须说明原因');
  const identity = { kind, observedAt, taskRef: clean(value.taskRef).trim(), sourceRef: clean(value.sourceRef).trim(), totalTokens, amount, currency };
  return Object.freeze({
    schema: FACTORY_USAGE_SCHEMA, usageId: clean(value.usageId).trim() || `usage:${factoryDigest(identity)}`, ...identity,
    inputTokens, outputTokens, modelRef: clean(value.modelRef).trim(), providerRef: clean(value.providerRef).trim(),
    reason: clean(value.reason).trim(), evidenceRefs: [...new Set((value.evidenceRefs || []).map(String).filter(Boolean))],
  });
}

export function reconcileMonthlyUsage(values = [], { month = '', quotaTokens = null } = {}) {
  const records = values.map(normalizeFactoryUsageRecord);
  const wantedMonth = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const rows = records.filter(row => row.observedAt.slice(0, 7) === wantedMonth);
  const tokensByKind = Object.fromEntries(FACTORY_USAGE_KINDS.map(kind => [kind, rows.filter(row => row.kind === kind).reduce((sum, row) => sum + row.totalTokens, 0)]));
  const amountsByKind = Object.fromEntries(FACTORY_USAGE_KINDS.map(kind => [kind, {}]));
  for (const row of rows) if (row.amount != null) amountsByKind[row.kind][row.currency] = (amountsByKind[row.kind][row.currency] || 0) + row.amount;
  const actualTokens = tokensByKind['provider-reported'];
  const quota = Number.isFinite(Number(quotaTokens)) && Number(quotaTokens) > 0 ? Number(quotaTokens) : null;
  // Provider usage is accounting evidence only. Product code must not turn token counts into a workflow gate.
  const quotaState = quota == null ? 'gray' : 'tracked';
  return Object.freeze({
    schema: 'mazz.factory-monthly-reconciliation/v0', month: wantedMonth, recordCount: rows.length, tokensByKind, amountsByKind,
    estimatedVarianceTokens: actualTokens && tokensByKind.estimate ? actualTokens - tokensByKind.estimate : null,
    unknownCount: rows.filter(row => row.kind === 'unknown').length,
    quota: { capTokens: quota, usedTokens: actualTokens, remainingTokens: quota == null ? null : Math.max(0, quota - actualTokens), state: quotaState, hardStopAuthorized: false },
    note: 'estimate、Provider 实收与 settled actual 分栏；unknown 不补零，不把 Token 冒充货币。',
  });
}

export function createMobileApprovalRequest({ taskId, gateId, artifactRefs = [], expiresAt, authorityRequired = 'human:maintainer', at } = {}) {
  const createdAt = iso(at);
  const expiry = iso(expiresAt || (Date.parse(createdAt) + 24 * 3600_000));
  if (Date.parse(expiry) <= Date.parse(createdAt)) throw new Error('审批包必须在未来失效');
  const payload = { taskId: nonEmpty(taskId, 'taskId'), gateId: nonEmpty(gateId, 'gateId'), artifactRefs: [...new Set(artifactRefs.map(String).filter(Boolean))], createdAt, expiresAt: expiry, authorityRequired: nonEmpty(authorityRequired, 'authorityRequired') };
  return Object.freeze({
    schema: FACTORY_MOBILE_APPROVAL_SCHEMA, kind: 'request', requestId: `mobile-approval:${factoryDigest(payload)}`, ...payload,
    payloadDigest: factoryDigest(payload), transport: 'local-sync-envelope', executionAuthorized: false,
    clientGate: 'CONDITIONAL_MOBILE_CLIENT', fieldClientAvailable: false,
  });
}

export function decideMobileApproval(request, { decision, authorityRef, payloadDigest, decidedAt, seenRequestIds = [] } = {}) {
  if (request?.schema !== FACTORY_MOBILE_APPROVAL_SCHEMA || request.kind !== 'request') throw new Error('不是有效手机审批请求');
  if (seenRequestIds.includes(request.requestId)) throw new Error('审批回执重放');
  if (Date.parse(iso(decidedAt)) > Date.parse(request.expiresAt)) throw new Error('审批请求已过期');
  if (payloadDigest !== request.payloadDigest) throw new Error('审批对象已变化');
  if (!['approve', 'reject', 'return'].includes(decision)) throw new Error('审批决定非法');
  if (!clean(authorityRef).startsWith('human:')) throw new Error('手机审批必须由 human Authority 作出');
  const body = { requestId: request.requestId, decision, authorityRef, payloadDigest, decidedAt: iso(decidedAt) };
  return Object.freeze({ schema: FACTORY_MOBILE_APPROVAL_SCHEMA, kind: 'decision', ...body, decisionId: `mobile-decision:${factoryDigest(body)}`, executionAuthorized: decision === 'approve' });
}
